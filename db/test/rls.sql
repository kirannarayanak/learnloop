-- RLS verification.
--
-- Policies are security code. These assertions are the only thing standing between
-- "we wrote policies" and "the policies do what we think". Run after every change to
-- db/migrations/006-rls.sql.
--
--   docker exec -i learnloop-pg psql -U postgres -d learnloop -f - < db/test/rls.sql

\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on

-- ============================================================ fixtures (as superuser)
-- Re-runnable: clear anything a previous run left behind. The fixtures commit rather than
-- roll back, because each assertion block needs its own transaction to SET LOCAL ROLE in.
begin;

delete from attempts where client_id in ('alice-1', 'bob-1');
delete from reviews where entity_id::text like 'dddddddd-%';
delete from exercises where id = 'ffffffff-0000-0000-0000-000000000001';
delete from path_items where path_id::text like 'eeeeeeee-%';
delete from paths where id::text like 'eeeeeeee-%';
delete from lessons where id::text like 'dddddddd-%';
delete from skills where id::text like 'cccccccc-%';
delete from org_members where org_id::text like 'bbbbbbbb-%';
delete from orgs where id::text like 'bbbbbbbb-%';
delete from domains where id::text like 'aaaaaaaa-%';
delete from profiles where id in (
  '11111111-1111-1111-1111-111111111111',
  '22222222-2222-2222-2222-222222222222',
  '33333333-3333-3333-3333-333333333333');
delete from auth.users where email in ('alice@test', 'bob@test', 'reviewer@test');

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'alice@test'),
  ('22222222-2222-2222-2222-222222222222', 'bob@test'),
  ('33333333-3333-3333-3333-333333333333', 'reviewer@test');

insert into profiles (id, handle, platform_role) values
  ('11111111-1111-1111-1111-111111111111', 'alice', 'learner'),
  ('22222222-2222-2222-2222-222222222222', 'bob', 'learner'),
  ('33333333-3333-3333-3333-333333333333', 'rev', 'reviewer');

insert into domains (id, slug, title, risk_tier) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'rls-pub', 'Public', 'low');

insert into orgs (id, slug, name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'org-a', 'Org A'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'org-b', 'Org B');
insert into org_members (org_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'learner');

insert into skills (id, domain_id, slug, title, statement) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'pub', 'Public skill', 'Do a public thing'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'draft', 'Draft skill', 'Do a draft thing'),
  ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'orgb', 'Org B skill', 'Do an org B thing');

insert into lessons (id, skill_id, title, body_md, verify_state) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'Public lesson', '', 'human_approved'),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'UNAPPROVED lesson', '', 'auto_passed'),
  ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000003', 'Org B lesson', '', 'human_approved');

insert into paths (id, domain_id, slug, title, status, owner_org_id, published_at) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'published-public', 'Published', 'published', null, now()),
  ('eeeeeeee-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'still-draft', 'Draft', 'draft', null, null),
  ('eeeeeeee-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'org-b-private', 'Org B only', 'published', 'bbbbbbbb-0000-0000-0000-000000000002', now());

insert into path_items (path_id, position, kind, title, skill_id) values
  ('eeeeeeee-0000-0000-0000-000000000001', 0, 'lesson', 'Public skill', 'cccccccc-0000-0000-0000-000000000001'),
  ('eeeeeeee-0000-0000-0000-000000000002', 0, 'lesson', 'Draft skill', 'cccccccc-0000-0000-0000-000000000002'),
  ('eeeeeeee-0000-0000-0000-000000000003', 0, 'lesson', 'Org B skill', 'cccccccc-0000-0000-0000-000000000003');

insert into exercises (id, skill_id, lesson_id, kind, prompt_md, answer) values
  ('ffffffff-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001', 'mcq', 'q', '{}');

insert into attempts (user_id, exercise_id, correct, client_id) values
  ('11111111-1111-1111-1111-111111111111', 'ffffffff-0000-0000-0000-000000000001', true, 'alice-1'),
  ('22222222-2222-2222-2222-222222222222', 'ffffffff-0000-0000-0000-000000000001', false, 'bob-1');

insert into reviews (entity, entity_id, verdict, notes) values
  ('lesson', 'dddddddd-0000-0000-0000-000000000002', 'needs_edit', 'high_risk');

insert into generation_jobs (kind, payload) values ('draft', '{}');

commit;

-- ============================================================ assertions
create or replace function assert(label text, actual anyelement, expected anyelement)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL % — expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

-- ---------------------------------------------------------------- anonymous
begin;
set local role anon;
select assert('anon sees the published public path', (select count(*) from paths), 1::bigint);
select assert('anon CANNOT see a draft path', (select count(*) from paths where slug = 'still-draft'), 0::bigint);
select assert('anon CANNOT see an org-private path', (select count(*) from paths where slug = 'org-b-private'), 0::bigint);
select assert('anon CANNOT read an unapproved lesson', (select count(*) from lessons where title = 'UNAPPROVED lesson'), 0::bigint);
select assert('anon reads the approved lesson', (select count(*) from lessons where title = 'Public lesson'), 1::bigint);
rollback;

-- ---------------------------------------------------------- learner: own data
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select assert('alice sees her own attempt', (select count(*) from attempts), 1::bigint);
select assert('alice CANNOT see bob''s attempt', (select count(*) from attempts where client_id = 'bob-1'), 0::bigint);
select assert('alice sees only her own profile', (select count(*) from profiles), 1::bigint);
rollback;

-- attempts are append-only: no update or delete policy exists, so neither is possible
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
begin
  begin
    update attempts set correct = false where client_id = 'alice-1';
    raise exception 'FAIL attempts are append-only — update succeeded';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'ok  attempts cannot be UPDATED (append-only)';
  begin
    delete from attempts where client_id = 'alice-1';
    raise exception 'FAIL attempts are append-only — delete succeeded';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  raise notice 'ok  attempts cannot be DELETED (append-only)';
end $$;
rollback;

-- a learner must never be able to make themselves a reviewer
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
begin
  begin
    update profiles set platform_role = 'admin' where id = auth.uid();
    raise exception 'FAIL privilege escalation — a learner promoted themselves';
  exception when insufficient_privilege then
    raise notice 'ok  a learner CANNOT grant themselves a platform role';
  end;

  -- The same table-level grant also exposed the tutor quota. A learner who can reset
  -- this has an uncapped tutor, which is the one cost that scales per user.
  begin
    update profiles set tutor_turns_used = 0 where id = auth.uid();
    raise exception 'FAIL a learner reset their own tutor quota';
  exception when insufficient_privilege then
    raise notice 'ok  a learner CANNOT reset their own tutor quota';
  end;

  -- ...but they must still be able to edit what is genuinely theirs.
  update profiles set display_name = 'Alice', daily_goal_min = 20 where id = auth.uid();
  raise notice 'ok  a learner CAN still edit their own display name and goal';
end $$;
rollback;

-- ------------------------------------------------------------- org isolation
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select assert('alice (org A) CANNOT read org B''s private path', (select count(*) from paths where slug = 'org-b-private'), 0::bigint);
select assert('alice CANNOT read org B''s lesson', (select count(*) from lessons where title = 'Org B lesson'), 0::bigint);
select assert('alice sees only her own org', (select count(*) from orgs), 1::bigint);
rollback;

-- -------------------------------------------------------------- review queue
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select assert('a learner CANNOT read the review queue', (select count(*) from reviews), 0::bigint);
rollback;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select assert('a reviewer CAN read the review queue', (select count(*) from reviews), 1::bigint);
rollback;

-- ------------------------------------------------------- never client-visible
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
do $$
begin
  begin
    perform count(*) from generation_jobs;
    raise exception 'FAIL generation_jobs is readable by a client';
  exception when insufficient_privilege then
    raise notice 'ok  generation_jobs is invisible to clients';
  end;
  begin
    perform count(*) from content_cache;
    raise exception 'FAIL content_cache is readable by a client';
  exception when insufficient_privilege then
    raise notice 'ok  content_cache is invisible to clients';
  end;
end $$;
rollback;

-- ------------------------------------------------------------- service_role
begin;
set local role service_role;
select assert('service_role sees every path (BYPASSRLS)', (select count(*) from paths), 3::bigint);
select assert('service_role sees every attempt', (select count(*) from attempts), 2::bigint);
rollback;

\echo 'ALL RLS ASSERTIONS PASSED'
