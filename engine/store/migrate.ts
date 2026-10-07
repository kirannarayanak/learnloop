/**
 * Migration runner.
 *
 *   npm run migrate                      applies to DATABASE_URL
 *   npm run migrate -- --status          what has been applied
 *
 * Forward-only and numbered, one concern each (CLAUDE.md). Each file is applied once,
 * inside a transaction, and recorded with a hash of its contents — so editing a migration
 * that has already run is detected rather than silently ignored, which is the failure mode
 * that leaves two environments with different schemas and no way to tell.
 */

import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';

const DB_DIR = resolve(import.meta.dirname, '../../db');

interface Migration {
  name: string;
  sql: string;
  hash: string;
}

function read(path: string, name: string): Migration {
  const sql = readFileSync(path, 'utf8');
  return { name, sql, hash: createHash('sha256').update(sql).digest('hex').slice(0, 16) };
}

function collect(): Migration[] {
  const out: Migration[] = [read(resolve(DB_DIR, 'schema.sql'), '000-schema.sql')];

  const dir = resolve(DB_DIR, 'migrations');
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
      out.push(read(resolve(dir, file), file));
    }
  }
  return out;
}

/**
 * Supabase provides `auth.users`; a bare Postgres does not. Applied only when absent, and
 * never on Supabase, where it would shadow the real auth schema.
 */
async function ensureAuthShim(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables where table_schema = 'auth' and table_name = 'users'
     ) as exists`,
  );
  if (rows[0]?.exists === true) return false;

  const shim = resolve(DB_DIR, 'local/00-auth-shim.sql');
  if (!existsSync(shim)) {
    throw new Error(
      'auth.users is missing and db/local/00-auth-shim.sql was not found. On Supabase this ' +
        'table exists already; elsewhere the shim provides it.',
    );
  }
  await pool.query(readFileSync(shim, 'utf8'));
  return true;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
  /** Migrations whose file changed after being applied. A deploy hazard, not a warning. */
  drifted: { name: string; appliedHash: string; currentHash: string }[];
}

export async function migrate(
  connectionString: string,
  log: (msg: string) => void = console.log,
): Promise<MigrateResult> {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    if (await ensureAuthShim(pool)) log('applied db/local/00-auth-shim.sql (no Supabase auth schema present)');

    await pool.query(`
      create table if not exists _migrations (
        name        text primary key,
        hash        text not null,
        applied_at  timestamptz not null default now()
      )
    `);

    const { rows: done } = await pool.query<{ name: string; hash: string }>('select name, hash from _migrations');
    const appliedHashes = new Map(done.map((r) => [r.name, r.hash]));

    const result: MigrateResult = { applied: [], skipped: [], drifted: [] };

    for (const migration of collect()) {
      const previous = appliedHashes.get(migration.name);

      if (previous !== undefined) {
        if (previous !== migration.hash) {
          // Editing an applied migration leaves environments with different schemas and
          // no way to tell which is right. Say so loudly; do not re-run it.
          result.drifted.push({ name: migration.name, appliedHash: previous, currentHash: migration.hash });
        }
        result.skipped.push(migration.name);
        continue;
      }

      const client = await pool.connect();
      try {
        await client.query('begin');
        await client.query(migration.sql);
        await client.query('insert into _migrations (name, hash) values ($1, $2)', [migration.name, migration.hash]);
        await client.query('commit');
        result.applied.push(migration.name);
        log(`applied ${migration.name}`);
      } catch (error) {
        await client.query('rollback');
        throw new Error(
          `migration ${migration.name} failed and was rolled back: ` +
            `${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      } finally {
        client.release();
      }
    }

    return result;
  } finally {
    await pool.end();
  }
}

/** Drop every object this project owns. Test fixtures only — never pointed at a real DB. */
export async function resetDatabase(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 2 });
  try {
    await pool.query('drop schema if exists public cascade');
    await pool.query('create schema public');
    await pool.query('drop schema if exists auth cascade');
  } finally {
    await pool.end();
  }
}

// --- CLI
if (import.meta.filename === process.argv[1]) {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const result = await migrate(connectionString);

  if (process.argv.includes('--status')) {
    console.log(`applied: ${result.applied.length}, already present: ${result.skipped.length}`);
  }
  if (result.drifted.length > 0) {
    console.error('\nDRIFT — these migrations were edited after being applied:');
    for (const d of result.drifted) {
      console.error(`  ${d.name}: applied ${d.appliedHash}, file is now ${d.currentHash}`);
    }
    console.error('Migrations are forward-only. Add a new one instead of editing these.');
    process.exitCode = 1;
  } else if (result.applied.length === 0) {
    console.log('up to date');
  }
}
