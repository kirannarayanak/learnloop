-- 001 — Structure and incentives.
-- Every choice here traces to evidence in docs/10-motivation.md. The comments say
-- which finding, because the tempting "improvements" to this schema are the ones
-- the research says cause harm.

-- ============================================================= points
-- Append-only ledger, same philosophy as `attempts`: never update, never delete.
-- Balance is a sum, so it is always reconstructible and never drifts.
--
-- CRITICAL (docs/10-motivation.md, finding 5): there is deliberately NO event kind
-- for answering correctly. Rewarding correctness punishes the struggling learner and
-- pushes everyone toward material that is too easy for them. Points track EFFORT and
-- CONSISTENCY only. Do not add a 'correct_answer' kind.
create table point_events (
  id         uuid primary key default uuid_generate_v4(),
  user_id    uuid not null references profiles(id) on delete cascade,
  kind       text not null check (kind in (
               'lesson_completed',     -- engaged with the material
               'review_completed',     -- showed up for scheduled review: the behaviour we most want
               'skill_mastered',       -- competence feedback, the SDT-aligned one
               'path_completed',
               'streak_milestone',
               'flag_accepted',        -- found a real content error: contribution
               'translation_accepted'  -- improved a translation: contribution
             )),
  points     int not null check (points > 0),
  skill_id   uuid references skills(id) on delete set null,
  path_id    uuid references paths(id) on delete set null,
  -- Idempotency: the same underlying event must never be credited twice, including
  -- when an offline client replays its queue.
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index on point_events (user_id, created_at desc);

-- ============================================================= streaks
-- Duolingo's published numbers (docs/10-motivation.md, finding 4): streak freeze beat a
-- gem bonus 2:1 and cut churn 21% for at-risk users; reaching 7 days makes a learner
-- 2.4x more likely to return; decoupling the streak from the daily GOAL raised 7-day-plus
-- streaks by 40%.
--
-- Two rules encoded here:
--   1. ANY genuine activity extends the streak — not just hitting the daily goal.
--      `last_active_date`, not `last_goal_met_date`.
--   2. Freezes are EARNED and applied automatically. Never sold. Monetising a motivation
--      mechanic corrupts it, and the evidence says protection motivates more than reward
--      anyway — so the kind design is also the effective one.
create table streaks (
  user_id          uuid primary key references profiles(id) on delete cascade,
  current_days     int  not null default 0,
  longest_days     int  not null default 0,
  last_active_date date,
  freezes_available int not null default 2 check (freezes_available >= 0),
  freezes_used     int  not null default 0,
  -- A broken streak resets this counter and NOTHING else. Mastery, points and
  -- credentials are never withdrawn. Punishment is not a feature.
  updated_at       timestamptz not null default now()
);

-- ============================================================= badges
-- Finding 5: a badge must name a real capability ("can implement a binary search"),
-- never a trinket ("logged in 5 times"). Three kinds only; resist adding a fourth.
create table badges (
  id          uuid primary key default uuid_generate_v4(),
  slug        text unique not null,
  title       text not null,
  description text not null,
  kind        text not null check (kind in ('mastery','consistency','contribution')),
  -- Machine-checkable award condition, so badges can never be granted by vibes.
  criteria    jsonb not null,
  skill_id    uuid references skills(id) on delete cascade,
  domain_id   uuid references domains(id) on delete cascade
);

create table user_badges (
  user_id    uuid not null references profiles(id) on delete cascade,
  badge_id   uuid not null references badges(id) on delete cascade,
  -- What actually justified it: attempt ids, mastery state at award time. A badge a
  -- learner can't see the basis for is a trinket.
  evidence   jsonb not null,
  awarded_at timestamptz not null default now(),
  primary key (user_id, badge_id)
);

-- ============================================================= leagues
-- Finding 3: macro leaderboards specifically harm lower performers by accumulating a
-- perception of repeated failure (JMIR Serious Games, 2021). So there is no global
-- ranking table in this schema, and there must never be one.
--
-- Instead: small bucketed cohorts with promotion/relegation, so everyone is plausibly
-- near the top of something. Opt-in, because a learner who doesn't want to compete
-- should never be ranked.
create table leagues (
  id           uuid primary key default uuid_generate_v4(),
  tier         int  not null check (tier >= 0),
  period_start date not null,
  period_end   date not null,
  -- Hard cap. Enforced in the assignment worker; ~30 keeps every member within
  -- plausible reach of the top of their own bucket.
  max_members  int  not null default 30 check (max_members between 10 and 50),
  check (period_end > period_start)
);

create table league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  user_id   uuid not null references profiles(id) on delete cascade,
  -- Points earned within this league period only. Never lifetime totals — that would
  -- rebuild the macro leaderboard the research tells us to avoid.
  points    int  not null default 0 check (points >= 0),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index on league_members (league_id, points desc);

-- Opt-in, and off by default. Competition is a preference, not a default setting.
alter table profiles add column if not exists ranking_opt_in boolean not null default false;

-- Learner-chosen, which is the cheapest autonomy lever we have (finding 6).
-- `daily_goal_min` already exists on profiles for the same reason.
alter table profiles add column if not exists show_personal_best boolean not null default true;

-- ============================================================= mastery gating
-- Finding 2, the uncomfortable one: mastery gating can REDUCE completion, and our
-- wave-0 exit gate is >=35% completion. So gating is SOFT by construction.
--
-- Mastery is required to be CREDITED with a skill. It is never required to VIEW the
-- next lesson. A learner who moves ahead sees a plain, non-punitive note naming the
-- prerequisite they skipped. Autonomy preserved, prerequisite made visible.
--
-- This view is what the UI reads to decide whether to show that note. It does not,
-- and must not, block anything.
create or replace view skill_readiness as
select
  m_user.user_id,
  s.id as skill_id,
  -- Hard edges (strength >= 0.9) gate credit and credentials. Soft edges only
  -- reorder suggestions. See docs/03-data-model.md.
  coalesce(bool_and(
    case when e.strength >= 0.9
         then coalesce(pm.state, 'new') in ('review','relearning')
         else true
    end
  ), true) as prereqs_met,
  array_remove(array_agg(
    case when e.strength >= 0.9
              and coalesce(pm.state, 'new') not in ('review','relearning')
         then e.prereq_id end
  ), null) as missing_prereqs
from (select distinct user_id from mastery) m_user
cross join skills s
left join skill_edges e on e.skill_id = s.id
left join mastery pm on pm.skill_id = e.prereq_id and pm.user_id = m_user.user_id
group by m_user.user_id, s.id;

comment on view skill_readiness is
  'Advisory only. Tells the UI which prerequisites a learner has not yet shown, so it '
  'can say so without blocking. Mastery gating that hard-locks content reduces course '
  'completion (docs/10-motivation.md finding 2) and would fight our own wave-0 gate.';
