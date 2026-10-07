-- 005 — Reviews carry a resolution timestamp.
--
-- The queue was "rows with verdict = 'needs_edit' and reviewer_id is null", which made
-- closing an item require writing a reviewer_id. There is no auth yet, so that meant a
-- placeholder uuid — which violates the foreign key to profiles, and would also have
-- falsely recorded WHO approved a lesson. For high-risk content that audit row is the
-- entire point (docs/07-risks.md), so it must never carry a made-up name.
--
-- An open queue item is now one with resolved_at null. Resolving preserves the row.

alter table reviews
  add column if not exists resolved_at timestamptz;

-- The queue read, by far the most common. Partial so it stays small as history grows.
create index if not exists reviews_open_queue_idx
  on reviews (created_at)
  where resolved_at is null and verdict = 'needs_edit';

-- Decisions are append-only and auditable; nothing may quietly overwrite one.
comment on table reviews is
  'Append-only audit trail of human review decisions. An approval is the only route a '
  'high-risk lesson has to publication, so "who approved this, when, and were they an '
  'expert" must stay answerable. Never UPDATE a verdict — insert a new row.';
