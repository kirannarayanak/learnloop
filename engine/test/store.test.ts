/**
 * Runs the Store contract against every implementation.
 *
 * MemoryStore always. PostgresStore only when DATABASE_URL points at a database — so the
 * suite stays green with no services running, and gets stricter the moment one is
 * available.
 *
 *   docker run -d --name learnloop-pg -e POSTGRES_PASSWORD=learnloop \
 *     -e POSTGRES_DB=learnloop -p 55432:5432 pgvector/pgvector:pg17
 *   DATABASE_URL=postgres://postgres:learnloop@localhost:55432/learnloop npm test
 */

import { test } from 'node:test';
import { MemoryStore, resetIds } from '../store/memory.ts';
import { runStoreContract, type ContractHarness } from './store-contract.ts';
import type { Store } from '../store/types.ts';

const memoryHarness: ContractHarness = {
  name: 'memory',
  create: async () => {
    resetIds();
    return new MemoryStore();
  },
  seedDomain: async (store, slug, title, riskTier) =>
    (store as MemoryStore).seedDomain(slug, title, riskTier).id,
};

runStoreContract(memoryHarness);

const DATABASE_URL = process.env.DATABASE_URL;

if (DATABASE_URL === undefined || DATABASE_URL === '') {
  test('postgres contract (skipped — set DATABASE_URL to run it)', { skip: true }, () => {});
} else {
  const { PostgresStore } = await import('../store/postgres.ts');
  const { migrate, resetDatabase } = await import('../store/migrate.ts');

  // One schema build for the whole file; each test truncates instead of re-migrating,
  // which keeps the suite fast enough to actually run on every change.
  await resetDatabase(DATABASE_URL);
  await migrate(DATABASE_URL, () => {});

  const pools: { close: () => Promise<void> }[] = [];
  let shared: InstanceType<typeof PostgresStore> | undefined;

  const postgresHarness: ContractHarness = {
    name: 'postgres',
    create: async (): Promise<Store> => {
      if (shared === undefined) {
        shared = new PostgresStore({ connectionString: DATABASE_URL });
        pools.push(shared);
      }
      // Truncate everything the contract touches. RESTART IDENTITY and CASCADE so
      // foreign keys don't dictate the order.
      await (shared as unknown as { pool: { query: (sql: string) => Promise<unknown> } }).pool.query(
        `truncate table
           generation_jobs, content_cache, reviews, lesson_sources, exercises,
           path_items, paths, lessons, skill_edges, skills, sources, domains
         restart identity cascade`,
      );
      return shared;
    },
    seedDomain: async (store, slug, title, riskTier) => {
      const pg = store as unknown as { pool: { query: (sql: string, p: unknown[]) => Promise<{ rows: { id: string }[] }> } };
      const { rows } = await pg.pool.query(
        'insert into domains (slug, title, risk_tier) values ($1,$2,$3) returning id',
        [slug, title, riskTier],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('seedDomain inserted nothing');
      return row.id;
    },
  };

  runStoreContract(postgresHarness);

  test('postgres teardown', async () => {
    for (const p of pools) await p.close();
  });
}
