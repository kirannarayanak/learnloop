# LearnLoop

**An engine that turns any source into a learning path you can actually finish — including
the things invented last week.**

Point it at a syllabus PDF, a docs site, a GitHub repo, a spec or a paper. It produces
prerequisite-ordered lessons, graded practice, spaced review, and a verifiable skill record.
Free at the point of use, offline-capable, and designed to work on a cheap phone on bad data.

*(Working name — check trademark and domain availability before committing to it.)*

## Why an engine and not a course catalogue

Courses go stale in months; new tech ships weekly. We never author all domains — the engine is
domain-agnostic and the domains arrive as inputs. A path is generated **once** (~$0.50) and
then served to every learner as cached database rows, so marginal cost per learner approaches
zero. That is what makes "free for learners, all domains" arithmetically possible rather than
aspirational.

Read the thinking in order:

| Doc | What's in it |
| --- | --- |
| [docs/00-decisions.md](docs/00-decisions.md) | Decisions log — what was chosen, when, and the accepted cost |
| [docs/01-vision.md](docs/01-vision.md) | The gap, the wedge, who we serve first, what we refuse to build |
| [docs/02-architecture.md](docs/02-architecture.md) | Stack on free tiers + OSS, with an escape hatch per choice |
| [docs/03-data-model.md](docs/03-data-model.md) | Why skills are primary and paths are routes |
| [docs/04-content-pipeline.md](docs/04-content-pipeline.md) | ingest → graph → draft → verify → publish |
| [docs/05-economics.md](docs/05-economics.md) | Cost per path, free-tier caps, PPP pricing, break-even |
| [docs/06-roadmap.md](docs/06-roadmap.md) | Four waves, each with a numeric exit gate |
| [docs/07-risks.md](docs/07-risks.md) | Wrong content, nobody finishing, cost, licensing, incumbents |
| [docs/09-model-strategy.md](docs/09-model-strategy.md) | Which model per stage, open vs. hosted, why not fine-tuning |
| [docs/10-motivation.md](docs/10-motivation.md) | Structure and incentives, from the evidence — and what the evidence says not to build |

## Run it

```
npm install
npm run dev     # seeds content from the pipeline, serves on http://localhost:3310
npm test        # 42 tests, no API key and no network needed
```

## Repo layout

```
web/      Next.js PWA + API routes (offline-first)
engine/   ingest → draft → verify → publish pipeline (standalone TS; no web framework)
db/       schema.sql, migrations, seed
docs/     the thinking, kept in the repo on purpose
```

## Status

**Wave 0 — the vertical slice is closed.** A source goes in, a verified path comes out, and
the app renders it. 42 tests, no API key or network required.

Working: the full pipeline (ingest → graph → draft → verify → publish), the prerequisite-DAG
validator, the publish gate, the generation cache and cost accounting, the streak/points
rules, and a learner app showing the skill map, lesson provenance and practice.

Not yet: real model adapters (the interface exists, the HTTP calls don't), the Postgres
store, the human review UI, FSRS, offline service worker, auth.

**Nothing has run against a real model yet.** The fake provider proves the plumbing, the
gate and the economics — never content quality. That is what the eval set is for
([docs/09-model-strategy.md](docs/09-model-strategy.md)).

## Non-negotiables

These are constraints, not preferences, and they're enforced in code rather than convention:

1. **Knowledge is never paywalled.** We monetise tooling, cohorts and proof — never content.
2. **Every claim cites a licensed source.** No citation, no publish.
3. **High-stakes domains require human approval** before publication. It's a `WHERE` clause.
4. **No model call in a learner's content path.** Content is cached rows.
5. **It works offline.** If it needs a connection to study, it excludes the people who need
   it most.

## Licence

Core: **AGPL-3.0** — see [LICENSE](LICENSE). Hosted org/cohort layer: proprietary.

Contributions welcome. The highest-value contribution is not code — it is reviewing generated
content in a domain you actually know, and telling us where the engine is wrong.
