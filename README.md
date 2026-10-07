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
| [docs/01-vision.md](docs/01-vision.md) | The gap, the wedge, who we serve first, what we refuse to build |
| [docs/02-architecture.md](docs/02-architecture.md) | Stack on free tiers + OSS, with an escape hatch per choice |
| [docs/03-data-model.md](docs/03-data-model.md) | Why skills are primary and paths are routes |
| [docs/04-content-pipeline.md](docs/04-content-pipeline.md) | ingest → graph → draft → verify → publish |
| [docs/05-economics.md](docs/05-economics.md) | Cost per path, free-tier caps, PPP pricing, break-even |
| [docs/06-roadmap.md](docs/06-roadmap.md) | Four waves, each with a numeric exit gate |
| [docs/07-risks.md](docs/07-risks.md) | Wrong content, nobody finishing, cost, licensing, incumbents |

## Repo layout

```
web/      Next.js PWA + API routes (offline-first)
engine/   ingest → draft → verify → publish pipeline (standalone TS; no web framework)
db/       schema.sql, migrations, seed
docs/     the thinking, kept in the repo on purpose
```

## Status

**Pre-wave-0.** The schema and the plan exist; the pipeline does not yet. Next commit is the
wave-0 vertical slice: one source in, one finishable path out.

## Non-negotiables

These are constraints, not preferences, and they're enforced in code rather than convention:

1. **Knowledge is never paywalled.** We monetise tooling, cohorts and proof — never content.
2. **Every claim cites a licensed source.** No citation, no publish.
3. **High-stakes domains require human approval** before publication. It's a `WHERE` clause.
4. **No model call in a learner's content path.** Content is cached rows.
5. **It works offline.** If it needs a connection to study, it excludes the people who need
   it most.

## Licence

Core: AGPL-3.0 (planned, on wave-0 completion). Hosted org/cohort layer: proprietary.
