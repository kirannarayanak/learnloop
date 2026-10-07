-- Local-only shim.
--
-- db/schema.sql and db/policies.sql reference things Supabase provides: the `auth` schema,
-- `auth.uid()`, and the `anon` / `authenticated` / `service_role` database roles. A bare
-- Postgres (local dev, CI, the test container) has none of them, so this stands in.
--
-- NEVER apply this to a Supabase database. The migration runner applies it only when
-- `auth.users` is absent, so on Supabase it skips itself.
--
-- The point of shimming rather than skipping: RLS policies are security code, and security
-- code that is only exercised in production is security code nobody has tested.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);

-- Supabase derives this from the request's JWT. Locally, tests set the claim directly:
--   set local request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claim.sub', true),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'),
    'anon'
  )
$$;

-- The three roles Supabase ships. `nologin` because nothing connects as them directly;
-- PostgREST switches into them per request, and tests do the same with SET ROLE.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- bypassrls: the pipeline and the workers are trusted server-side code.
    create role service_role nologin noinherit bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
