-- 006 — Row-level security.
--
-- Multi-tenant isolation is RLS, not `WHERE org_id = ?` (CLAUDE.md). A forgotten filter in
-- one handler leaks another institution's student data; a policy cannot be forgotten
-- per-query. This file is the isolation.
--
-- Three roles, from Supabase:
--   anon           not signed in. Reads published public content and nothing else.
--   authenticated  a learner. Reads public content plus their OWN rows.
--   service_role   the pipeline and the workers. BYPASSRLS — trusted server-side code.
--
-- The rule for everything below: a table gets RLS enabled, then policies add back exactly
-- what is allowed. Enabling RLS with no policy denies everything, which is the correct
-- default for anything we forget.

-- ========================================================== platform roles
-- Reviewing is a platform-level capability, separate from org membership: an expert
-- reviewing K-12 biology is not a member of every school using it.
alter table profiles
  add column if not exists platform_role text not null default 'learner'
    check (platform_role in ('learner', 'reviewer', 'admin'));

-- ========================================================== helpers
--
-- SECURITY DEFINER on purpose. A policy on `profiles` that calls a function which reads
-- `profiles` would recurse forever; definer rights break the cycle. These functions are
-- therefore the most security-sensitive code here — each one answers exactly one question
-- and touches nothing else.

create or replace function public.is_platform_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from profiles
     where id = auth.uid() and platform_role in ('reviewer', 'admin')
  )
$$;

create or replace function public.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from org_members where org_id = target_org and user_id = auth.uid()
  )
$$;

/** Owner, admin or instructor — the roles that may see a cohort's learners. */
create or replace function public.is_org_staff(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from org_members
     where org_id = target_org and user_id = auth.uid()
       and role in ('owner', 'admin', 'instructor')
  )
$$;

/**
 * A path is readable when it is published and public, or when the reader belongs to the
 * org that owns it. Draft and blocked paths are invisible to everyone but service_role —
 * which is what makes the publish gate meaningful rather than cosmetic.
 */
create or replace function public.can_read_path(target_path uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from paths p
     where p.id = target_path
       and p.status = 'published'
       and (p.owner_org_id is null or public.is_org_member(p.owner_org_id))
  )
$$;

/** A skill is visible when any readable path routes through it. */
create or replace function public.can_read_skill(target_skill uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1 from path_items pi
     where pi.skill_id = target_skill and public.can_read_path(pi.path_id)
  )
$$;

-- ========================================================== grants
-- RLS only constrains a role that has table privileges at all. Granting broadly and
-- constraining with policies is the Supabase model; the grants below are what the policies
-- then narrow.

grant select on
  domains, skills, skill_edges, sources, paths, path_items, lessons, lesson_sources,
  exercises, badges, translations, leagues, league_members
  to anon, authenticated;

grant select, insert on flags to authenticated;
grant select, insert on attempts to authenticated;
grant select, insert on point_events to authenticated;
grant select, insert, update on mastery, streaks, enrollments to authenticated;
grant select on user_badges, credentials, orgs, org_members, cohorts to authenticated;
grant select, update on profiles to authenticated;
grant insert on profiles to authenticated;
grant select, insert, update on reviews to authenticated;

-- Privilege escalation: a learner must never be able to make themselves a reviewer.
-- Column-level, so it holds regardless of what any policy says.
revoke update (platform_role) on profiles from authenticated;

-- Never exposed to a client at all. No grant, so no policy is needed either.
revoke all on generation_jobs, content_cache, path_bundles from anon, authenticated;

-- ========================================================== content: public read
-- Writes are service_role only throughout — the pipeline writes content, nobody else.

alter table domains      enable row level security;
alter table skills       enable row level security;
alter table skill_edges  enable row level security;
alter table sources      enable row level security;
alter table paths        enable row level security;
alter table path_items   enable row level security;
alter table lessons      enable row level security;
alter table lesson_sources enable row level security;
alter table exercises    enable row level security;
alter table translations enable row level security;
alter table badges       enable row level security;

create policy domains_read on domains for select using (true);
create policy sources_read on sources for select using (true);
create policy badges_read  on badges  for select using (true);
create policy translations_read on translations for select using (true);

-- A path that is draft or blocked is invisible. This is the publish gate expressed as
-- visibility: unapproved high-risk content cannot be read even by guessing its id.
create policy paths_read on paths for select
  using (status = 'published' and (owner_org_id is null or public.is_org_member(owner_org_id)));

create policy path_items_read on path_items for select
  using (public.can_read_path(path_id));

create policy skills_read on skills for select
  using (public.can_read_skill(id));

create policy skill_edges_read on skill_edges for select
  using (public.can_read_skill(skill_id));

create policy lessons_read on lessons for select
  using (public.can_read_skill(skill_id));

create policy lesson_sources_read on lesson_sources for select
  using (exists (select 1 from lessons l where l.id = lesson_id and public.can_read_skill(l.skill_id)));

create policy exercises_read on exercises for select
  using (public.can_read_skill(skill_id));

-- ========================================================== learner's own data

alter table profiles     enable row level security;
alter table attempts     enable row level security;
alter table mastery      enable row level security;
alter table point_events enable row level security;
alter table streaks      enable row level security;
alter table user_badges  enable row level security;
alter table enrollments  enable row level security;
alter table credentials  enable row level security;

create policy profiles_read_own   on profiles for select using (id = auth.uid());
create policy profiles_insert_own on profiles for insert with check (id = auth.uid());
create policy profiles_update_own on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- Attempts are append-only (docs/03-data-model.md): no update or delete policy exists, so
-- neither is possible. Offline sync and difficulty calibration both depend on that.
create policy attempts_read_own   on attempts for select using (user_id = auth.uid());
create policy attempts_insert_own on attempts for insert with check (user_id = auth.uid());

-- Same for the points ledger: a balance is a sum, so a deletable row is a forgeable balance.
create policy points_read_own   on point_events for select using (user_id = auth.uid());
create policy points_insert_own on point_events for insert with check (user_id = auth.uid());

create policy mastery_read_own   on mastery for select using (user_id = auth.uid());
create policy mastery_write_own  on mastery for insert with check (user_id = auth.uid());
create policy mastery_update_own on mastery for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy streaks_read_own   on streaks for select using (user_id = auth.uid());
create policy streaks_write_own  on streaks for insert with check (user_id = auth.uid());
create policy streaks_update_own on streaks for update using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy badges_read_own on user_badges for select using (user_id = auth.uid());

create policy enrollments_read_own   on enrollments for select using (user_id = auth.uid());
create policy enrollments_write_own  on enrollments for insert with check (user_id = auth.uid());
create policy enrollments_update_own on enrollments for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A credential is a public claim: anyone with the verification link can check it, which is
-- the entire point of issuing one (docs/01-vision.md).
create policy credentials_read on credentials for select
  using (user_id = auth.uid() or revoked_at is null);

-- ========================================================== orgs and cohorts

alter table orgs        enable row level security;
alter table org_members enable row level security;
alter table cohorts     enable row level security;

create policy orgs_read_member on orgs for select using (public.is_org_member(id));
create policy org_members_read on org_members for select
  using (user_id = auth.uid() or public.is_org_staff(org_id));
create policy cohorts_read on cohorts for select using (public.is_org_member(org_id));

-- Instructors may see their own cohort's enrolments. Narrow on purpose: staff of one org
-- see that org's learners and nobody else's.
create policy enrollments_read_staff on enrollments for select
  using (
    cohort_id is not null
    and exists (
      select 1 from cohorts c where c.id = enrollments.cohort_id and public.is_org_staff(c.org_id)
    )
  );

-- ========================================================== review and flags

alter table reviews enable row level security;
alter table flags   enable row level security;

-- Approving is the only route a high-risk lesson has to publication, so the queue and the
-- verdicts are reviewers-only.
create policy reviews_read_reviewer   on reviews for select using (public.is_platform_reviewer());
create policy reviews_insert_reviewer on reviews for insert with check (public.is_platform_reviewer());
create policy reviews_update_reviewer on reviews for update using (public.is_platform_reviewer());

-- Anyone signed in can report content — the flag button is on every lesson. Only reviewers
-- read the reports.
create policy flags_insert_any    on flags for insert with check (user_id = auth.uid());
create policy flags_read_own      on flags for select using (user_id = auth.uid());
create policy flags_read_reviewer on flags for select using (public.is_platform_reviewer());

-- ========================================================== leagues

alter table leagues        enable row level security;
alter table league_members enable row level security;

-- A league is a small bucket you are in. You see your own bucket and no other, which is
-- also what stops anyone reconstructing the global leaderboard we refuse to build
-- (docs/10-motivation.md finding 3).
create policy leagues_read on leagues for select
  using (exists (select 1 from league_members m where m.league_id = id and m.user_id = auth.uid()));

create policy league_members_read on league_members for select
  using (exists (select 1 from league_members m where m.league_id = league_members.league_id and m.user_id = auth.uid()));

-- ========================================================== never client-visible

alter table generation_jobs enable row level security;
alter table content_cache   enable row level security;
alter table path_bundles    enable row level security;

-- No policies, and no grants above. RLS with no policy denies everything to anon and
-- authenticated; service_role has BYPASSRLS and is unaffected.

comment on function public.is_platform_reviewer() is
  'SECURITY DEFINER to avoid recursive RLS on profiles. Answers exactly one question.';
