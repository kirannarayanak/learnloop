-- 010 — Attempts record the skill, and survive their exercise.
--
-- Two problems with `exercise_id uuid not null references exercises(id)`:
--
-- 1. Exercises are DERIVED content. Bumping a prompt version regenerates a lesson and its
--    questions as new rows (docs/11-lesson-design.md). A hard NOT NULL reference means
--    regenerating either deletes learner history or is blocked by the constraint. Neither
--    is acceptable: an attempt is a fact about what a person did, and it does not stop
--    being true because we rewrote the question.
--
-- 2. Everything downstream — mastery, the skill map, credit — is keyed on the SKILL, so
--    every read had to join through exercises to find it. That join is on the hot path and
--    it breaks entirely once exercise_id can be null.
--
-- Difficulty calibration still uses exercise_id while the row survives; it is the one
-- consumer that cares which specific question was asked.

alter table attempts
  add column if not exists skill_id uuid references skills(id) on delete cascade;

update attempts a
   set skill_id = e.skill_id
  from exercises e
 where e.id = a.exercise_id and a.skill_id is null;

alter table attempts alter column skill_id set not null;

-- The exercise may be regenerated away; the attempt stays.
alter table attempts alter column exercise_id drop not null;
alter table attempts drop constraint if exists attempts_exercise_id_fkey;
alter table attempts
  add constraint attempts_exercise_id_fkey
  foreign key (exercise_id) references exercises(id) on delete set null;

-- Mastery is projected per (user, skill) on every sync.
create index if not exists attempts_user_skill_idx on attempts (user_id, skill_id);

comment on column attempts.skill_id is
  'Denormalised on purpose: mastery and credit are keyed on the skill, and the exercise '
  'may be regenerated away under a new prompt version. The attempt outlives the question.';
