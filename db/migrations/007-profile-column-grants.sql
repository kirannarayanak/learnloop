-- 007 — Fix a privilege escalation: learners could grant themselves a platform role.
--
-- 006 did `grant select, update on profiles` and then
-- `revoke update (platform_role) on profiles`. That does not work: in Postgres a
-- table-level UPDATE grant is not narrowed by a column-level REVOKE, so the revoke was
-- silently ineffective and any learner could run
--   update profiles set platform_role = 'admin' where id = auth.uid();
-- and gain the ability to approve high-risk content.
--
-- Caught by db/test/rls.sql. The fix is to never grant table-wide UPDATE at all and list
-- the columns a learner owns instead.
--
-- The same hole covered `tutor_turns_used`: a learner could reset their own counter and
-- make the free-tier cap meaningless, which is the one variable cost that scales with
-- every user (docs/05-economics.md).

revoke update on profiles from authenticated;

-- Exactly the columns a learner owns. Anything server-controlled — tier, platform_role,
-- the tutor quota — is absent, and absent is the safe default for anything added later.
grant update (
  handle,
  display_name,
  locale,
  country,
  timezone,
  daily_goal_min,
  ranking_opt_in,
  show_personal_best
) on profiles to authenticated;

comment on column profiles.platform_role is
  'Server-controlled. Deliberately NOT in the column grant to authenticated — see '
  'db/migrations/007. Granting table-wide UPDATE here reopens a privilege escalation.';

comment on column profiles.tutor_turns_used is
  'Server-controlled. A learner who can reset this has an uncapped tutor, which is the '
  'one cost that scales per user.';
