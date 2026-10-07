-- Local-only shim.
--
-- db/schema.sql references `auth.users`, which Supabase provides. A bare Postgres (local
-- dev, CI, the test container) has no such schema, so this stands in for it.
--
-- NEVER apply this to a Supabase database — it would shadow the real auth schema.
-- The migration runner applies it only when `auth.users` is absent.
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);
