-- 008 — Grant service_role actual table privileges.
--
-- BYPASSRLS skips policies; it does not grant privileges. 006 enabled RLS and granted
-- narrowly to anon/authenticated, which left service_role — the role the pipeline and
-- workers connect as — able to ignore policies on tables it could not touch at all.
--
-- Caught by db/test/rls.sql. On Supabase these grants already exist; this makes a
-- self-hosted or local database match.

grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant all on all functions in schema public to service_role;

-- Tables added by later migrations must not silently exclude the pipeline.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
