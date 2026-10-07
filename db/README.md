# Database

```
docker compose up -d
export DATABASE_URL=postgres://postgres:learnloop@localhost:55432/learnloop
npm run migrate
npm test            # the Store contract now also runs against Postgres
```

## Layout

| Path | What it is |
| --- | --- |
| `schema.sql` | The **immutable baseline**. A fresh install applies this, then every migration in order |
| `migrations/NNN-*.sql` | Forward-only, numbered, one concern each |
| `seed/01-domains.sql` | The four beachhead domains, with the risk tier the publish gate reads |
| `local/00-auth-shim.sql` | Stands in for Supabase's `auth.users`. Applied only when that schema is absent — **never on Supabase** |

## Migrations are forward-only, including the baseline

`store/migrate.ts` records a hash of every applied file. Editing one that has already run
is reported as **drift** and fails the command, rather than being silently ignored — the
failure mode that otherwise leaves two environments with different schemas and no way to
tell which is right.

So `schema.sql` is not updated when something changes: a migration carries existing
databases forward, and a fresh install reaches the same place by applying the baseline and
then the same migrations. Both paths converge.

## Supabase

The baseline references `auth.users`, which Supabase provides. Point `DATABASE_URL` at the
project's connection string and run `npm run migrate`; the shim detects the existing `auth`
schema and skips itself.

Row-level security is **not yet written** — `db/policies.sql` lands with orgs and cohorts in
wave 3. Until then nothing multi-tenant should hold real learner data: isolation is RLS, not
a `WHERE` clause (CLAUDE.md).

## What a real database caught

Running the schema for the first time found three drifts that the in-memory store could
never surface, each now a migration:

- `002` — `lessons.blocks` and `lessons.prompt_version` existed in TypeScript but not in
  SQL. Would have failed on first deploy.
- `003` — `path_items` had no `skill_id`, so items resolved back to skills by matching
  titles. Title collisions are likely precisely because skills are deduplicated across
  paths, and a path whose items resolve wrongly teaches a broken prerequisite chain.
- `004` — `generation_jobs.kind` allowed `lesson` and `exercise` but not `draft`, so the
  stage the pipeline actually runs could not be queued.
