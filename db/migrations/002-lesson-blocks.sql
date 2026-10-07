-- 002 — Lessons carry structured blocks and the prompt version that produced them.
--
-- Drift caught by running the schema against a real Postgres for the first time: both
-- fields were added to the TypeScript LessonRecord when lessons became interactive
-- blocks (docs/11-lesson-design.md) and when the pipeline was made idempotent, but the
-- SQL was never updated. This would have failed on first deploy.

alter table lessons
  -- The lesson proper. `body_md` remains as a flattened, searchable fallback.
  add column if not exists blocks jsonb not null default '[]'::jsonb,
  -- Part of the reuse key: bumping a prompt regenerates, leaving it alone does not.
  -- Without this the freshness cron cannot tell a stale lesson from a current one.
  add column if not exists prompt_version text not null default 'v1';

-- The pipeline looks lessons up by exactly this triple to decide whether to re-draft.
create unique index if not exists lessons_reuse_key
  on lessons (skill_id, locale, prompt_version);

-- Exercises derive from a lesson's retrieval blocks, so they are regenerated with it
-- rather than accumulating duplicates across prompt versions.
create index if not exists exercises_lesson_idx on exercises (lesson_id);
