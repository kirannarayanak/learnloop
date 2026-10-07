# 04 — The content pipeline (the actual product)

Everything else is a wrapper around this. Five stages, each a row in `generation_jobs`,
each independently retryable, each cached on its inputs.

```
source ──▶ 1 INGEST ──▶ 2 GRAPH ──▶ 3 DRAFT ──▶ 4 VERIFY ──▶ 5 PUBLISH ──▶ path
                                        ▲            │
                                        └──── fail ──┘  (repair loop, max 2 passes)
```

## 1. Ingest
**In:** a URL, PDF, repo, syllabus scan, paper, or video transcript.
**Out:** normalised markdown + a `sources` row with `license` and `content_hash`.

- Archive the original to R2 so the citation still resolves when the web rots.
- **Licence gate:** unknown or incompatible licence ⇒ we may *cite and link* but never
  reproduce. This blocks publication, deliberately. Enforce it in code, not in a policy doc.
- `content_hash` is the invalidation key for every downstream artefact.

## 2. Graph extraction — *the hard part, and the moat*
**In:** normalised source. **Out:** `skills` + `skill_edges` + a `paths` skeleton.

This is where quality is won or lost, so it gets the expensive model (Opus 5 / Sonnet 5):

- Decompose into **atomic skills**: one teachable, *testable* idea each, phrased as an
  observable "can do X". If you can't write a question for it, it isn't a skill.
- Infer prerequisite edges, then **validate the DAG is acyclic** (`engine/graph/validate.ts`).
  A cycle means a learner hits an unlearnable loop. Fail the job; never publish.
- **Dedupe against the existing graph** via pgvector cosine on `skills.embedding`. This is
  what lets the graph accumulate instead of fragmenting: "closures" learned in a JS path
  is the same skill a Python path needs, and mastery must transfer. Without this step the
  graph becomes 50,000 near-duplicate nodes and the whole thesis fails.
- Order into a path by topological sort, then chunk into ~8-minute items.

## 3. Draft
Per skill, in parallel, on Haiku 4.5 via the Batch API:

- **Lesson**: ~400–700 words of MDX. Explanation → worked example → common misconception →
  one-line recap. Must cite the source spans it rests on (`lesson_sources.quote`).
- **Exercises**: 4–6 per skill, mixed kinds, spread across the difficulty range. Every one
  carries an `explanation_md` that is shown whether the learner was right or wrong — the
  explanation *is* the teaching moment.
- **Caching**: the source material is a stable prompt prefix shared by every lesson from that
  source. Put it before the last `cache_control` breakpoint and keep everything volatile
  (skill spec, item index) after it. Assert `usage.cache_read_input_tokens > 0` in the
  worker and log when it isn't — a silent cache miss here is a ~10x cost regression.

## 4. Verify — the gate
Generated education that is confidently wrong is worse than nothing. A second model, with
**only the cited source spans in context** (not the draft's reasoning), checks:

1. Is every factual claim supported by a cited span? Unsupported ⇒ `auto_failed`.
2. Is the marked answer actually correct, and the distractors actually wrong?
3. Does the lesson teach the skill its `statement` claims?
4. Does it assume anything not in the prerequisite closure of this skill?

Outcomes: `auto_passed` → publishable. `auto_failed` → one repair pass, then the human queue.

**Risk tiering decides what `auto_passed` is allowed to do:**

| Tier | Domains | Publish rule |
| --- | --- | --- |
| Low | programming, tools, general tech, hobbies | `auto_passed` publishes |
| Medium | maths, physics, exam syllabi, finance basics | `auto_passed` publishes, flagged for sampled human review |
| **High** | medicine, law, mental health, safety-critical engineering, anything a wrong answer can hurt someone with | **`human_approved` required. No exceptions. Enforced in the publish query, not by convention.** |

Wave 0 ships low-tier only. That is not a limitation — it's how we earn the right to the rest.

## 5. Publish
- Write rows, set `paths.status = 'published'`, stamp `published_at`.
- Build the offline bundle → R2 → `path_bundles`.
- Enqueue translation jobs for the target locales (`provenance = 'machine'`, upgradeable to
  `'community'` or `'expert'` — a machine translation is a starting point, never the end state).

## Continuous freshness — what makes this different from a course
A cron job re-fetches every `sources.uri` and compares `content_hash`. On a change:
re-run graph extraction on the diff, mark affected lessons stale, regenerate only those,
re-verify, republish. **Learners get a "this updated" note and only the changed items
re-enter their review queue.** This closes the loop on the freshness gap from `01-vision.md`
and is the single feature no incumbent can retrofit cheaply.

## Learning from attempts (free signal, no model calls)
`attempts` is append-only, so difficulty calibration is just SQL on a schedule:
- Observed p(correct) updates `exercises.difficulty`.
- Item-total correlation updates `discrimination`; near-zero or negative means the item is
  broken, not hard → auto-flag for review.
- High lapse rates on a skill mean the *lesson* is bad, not the learner. Flag the lesson.

This is the compounding asset. Content any competitor can generate; **calibration data from
real learners, they cannot.**
