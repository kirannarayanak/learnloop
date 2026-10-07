import 'server-only';

/**
 * Store access for the review tool.
 *
 * This is the first part of the web app that talks to Postgres directly. The learner app
 * still reads the generated snapshot; reviewing cannot, because it writes — and a tool
 * that approves content has to act on the same rows the pipeline reads.
 *
 * A single pooled store is reused across requests. Next re-evaluates modules per request
 * in development, so without the global a reload would leak a pool per edit until
 * Postgres refused new connections.
 *
 * **This connection BYPASSES RLS.** It is a direct Postgres connection as the database
 * owner, not a Supabase client holding a user's JWT — so the policies in
 * db/migrations/006-rls.sql do not constrain anything read through here. That is
 * intentional for trusted server code (the pipeline writes content this way, and the
 * review tool must see unpublished lessons), but it means the trust boundary on this path
 * is the session check in the calling route, NOT the database.
 *
 * Consequences to respect:
 *   - Never pass a user-supplied id straight into a query here. Derive it from the
 *     session (`currentUser()`), as /api/sync does.
 *   - Reads served to anonymous visitors must filter themselves. `listPublishedPaths()`
 *     does; a new query that forgets to will happily serve a draft.
 *   - Anything that can be done with the anon Supabase client SHOULD be, because there
 *     RLS is a second line of defence rather than absent.
 */

import { PostgresStore } from '@learnloop/engine/store/postgres.ts';

declare global {
  // eslint-disable-next-line no-var
  var __learnloopStore: PostgresStore | undefined;
}

export function reviewStore(): PostgresStore {
  const url = process.env.DATABASE_URL;
  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. The review tool writes to the database, so it cannot run ' +
        'against the generated snapshot the learner app uses.',
    );
  }
  globalThis.__learnloopStore ??= new PostgresStore({ connectionString: url });
  return globalThis.__learnloopStore;
}

export function databaseConfigured(): boolean {
  const url = process.env.DATABASE_URL;
  return url !== undefined && url !== '';
}
