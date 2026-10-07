-- 003 — path_items references the skill directly.
--
-- Without this the only way back from a path item to its skill is by matching titles,
-- which breaks the moment two skills in a domain share one — and title collisions are
-- likely precisely because skills are deduplicated across paths. A path whose items
-- resolve to the wrong skills teaches a broken prerequisite chain, silently.

alter table path_items
  add column if not exists skill_id uuid references skills(id) on delete cascade;

create index if not exists path_items_skill_idx on path_items (skill_id);
