/**
 * Runs the Store contract against every implementation.
 *
 * MemoryStore always. PostgresStore only when **TEST_DATABASE_URL** is set.
 *
 * It is deliberately NOT `DATABASE_URL`. This suite TRUNCATES every table it touches, and
 * `DATABASE_URL` is the variable a developer already has pointed at the database they are
 * working in — so reading it here means running the tests silently destroys your content.
 * That happened. A separate variable makes the destruction something you opt into.
 *
 *   docker compose up -d
 *   export TEST_DATABASE_URL=postgres://postgres:learnloop@localhost:55432/learnloop_test
 *   createdb, migrate, then: npm test
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
  // No auth table in memory; any stable id will do.
  seedUser: async (_store, email) => `user-${email}`,
};

runStoreContract(memoryHarness);

const DATABASE_URL = process.env.TEST_DATABASE_URL;

if (DATABASE_URL === undefined || DATABASE_URL === '') {
  test('postgres contract (skipped — set TEST_DATABASE_URL to run it)', { skip: true }, () => {});
} else if (DATABASE_URL === process.env.DATABASE_URL) {
  // Belt and braces: even if someone sets both to the same value, refuse rather than
  // truncate the database they are developing against.
  throw new Error(
    'TEST_DATABASE_URL must not be the same as DATABASE_URL — this suite truncates every ' +
      'table it touches. Point it at a throwaway database.',
  );
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
           path_items, paths, lessons, skill_edges, skills, sources, domains,
           point_events, mastery, streaks, enrollments
         restart identity cascade`,
      );
      // Learner fixtures cascade from auth.users.
      await (shared as unknown as { pool: { query: (sql: string) => Promise<unknown> } }).pool.query(
        "delete from auth.users where email like '%@test'",
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
    seedUser: async (store, email) => {
      // The on_auth_user_created trigger makes the profile and streak rows.
      const pg = store as unknown as { pool: { query: (sql: string, p: unknown[]) => Promise<{ rows: { id: string }[] }> } };
      const { rows } = await pg.pool.query(
        'insert into auth.users (email) values ($1) returning id',
        [email],
      );
      const row = rows[0];
      if (row === undefined) throw new Error('seedUser inserted nothing');
      return row.id;
    },
  };

  runStoreContract(postgresHarness);

  test('postgres teardown', async () => {
    for (const p of pools) await p.close();
  });
}
