-- 004 — Align generation_jobs.kind with the pipeline's actual stages.
--
-- The original kinds ('lesson', 'exercise') predate two changes: drafting now produces a
-- whole lesson as blocks rather than prose plus a separate exercise bank, and review items
-- derive from the lesson's own retrieval blocks (docs/11-lesson-design.md). So 'exercise'
-- is dead work that can never be enqueued, and 'draft' — which the pipeline actually
-- runs — could not be.
--
-- Queueing a 'draft' job would have failed the check constraint at runtime. Caught by
-- running the Store contract against a real database.

alter table generation_jobs drop constraint if exists generation_jobs_kind_check;

alter table generation_jobs
  add constraint generation_jobs_kind_check
  check (kind in ('ingest', 'graph', 'draft', 'verify', 'translate', 'bundle'));
