# 03 — Data model notes

Schema: `db/schema.sql`. This file explains the decisions that aren't obvious from the DDL.

## Skills are the unit, paths are routes
The temptation is to make the course the primary entity. Don't. A **skill** — one teachable,
testable idea — is primary, and a **path** is an ordered route through the skill graph.

Why it matters: the same skill is reached from many directions. "Recursion" appears in a
Python path, a DSA path and a compilers path. If each path owns its own copy, a learner who
mastered it once is taught it three times and mastery can't transfer. With skills primary,
`mastery` is keyed on `(user_id, skill_id)` and transfers everywhere for free.

Consequence: **dedupe at graph-extraction time is load-bearing** (`04-content-pipeline.md`).
Skip it and you get 50k near-duplicate nodes, no transfer, and the model collapses into a
course catalogue — which is the thing we said we weren't building.

## The prerequisite DAG
`skill_edges` is a directed acyclic graph. Acyclicity is **not** enforced by a database
constraint (Postgres can't express it cheaply) — it's validated in `engine/graph/validate.ts`
and a cycle fails the generation job. A cycle in production means some learner hits a
prerequisite loop they can never exit. Treat it as data corruption.

`strength` (0–1] lets us distinguish "you cannot proceed without this" from "this helps".
The path builder respects hard edges (≈1.0) strictly and uses soft edges for ordering only.

## Attempts are append-only — and that's the offline design
`attempts` is never updated or deleted. Two things fall out of that:

1. **Offline sync becomes trivial.** The client queues attempts with a `client_id`
   idempotency key; `unique (user_id, client_id)` makes replay safe. There is no merge
   conflict because there is nothing mutable to conflict.
2. **Calibration is free.** Difficulty, discrimination, and "is this item broken?" are all
   SQL aggregates over history. No model calls, and the signal improves as the corpus grows.

`mastery` is the only derived, mutable learning state. It is recomputable from `attempts`,
which means a bad FSRS parameter change is recoverable — rebuild it, don't migrate it.

## Verification state is on the content, not in a side table
`lessons.verify_state` and `exercises.verify_state` sit on the row because the publish query
filters on them. The rule from `07-risks.md` — high-risk domains require `human_approved` —
must be a `WHERE` clause, not a convention someone remembers. Enforce it in one place
(the publish function) and test it.

## Provenance is mandatory
`sources` + `lesson_sources` exist so that every claim is traceable to a span of a licensed
source. `sources.content_hash` is the invalidation key for the whole derived tree, which is
what makes continuous freshness possible. `sources.license` being null blocks reproduction —
this is a hard gate in code, because getting it wrong is a legal problem, not a quality one.

## Multi-tenancy via RLS, not application filters
Org-private paths (`paths.owner_org_id`) and cohort data are isolated with Postgres row-level
security, not `WHERE org_id = ?` in application code. A forgotten filter in one handler leaks
another institution's student data; an RLS policy can't be forgotten per-query. Policies live
in `db/policies.sql` (to be written alongside wave 3) and need their own tests.

## Translations are rows
A locale is never a fork of the content. `translations (entity, entity_id, field, locale)`
with a `provenance` ladder — `machine` → `community` → `expert` — means a machine translation
ships immediately and gets upgraded in place by people who speak the language, without any
content migration.

## Embeddings
`vector(1024)` is a placeholder — set it to your actual embedding model's dimension before the
first insert, because changing it later means a full re-embed. HNSW index (not IVFFlat): no
training pass, good recall while the table is small, which is the whole of wave 0 and 1.

## Cost accounting in the schema
`lessons.gen_cost_usd`, `generation_jobs.cost_usd`, and `content_cache.cost_usd` exist so
"what did this path cost to produce?" is a query, not a guess. Given the economics in
`05-economics.md` rest entirely on cost-per-path, measuring it from day one is not optional.
