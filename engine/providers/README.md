# Provider layer

No pipeline stage names a vendor. `routing.ts` is the only place a model choice
exists, which is what makes per-stage A/B testing against the eval set possible.

## Current routing (2026-10-07)

| Stage | Family | Why |
| --- | --- | --- |
| `ingest` | Gemini | Long context swallows a whole syllabus; native PDF + video for scanned board papers and lecture recordings |
| `graph` | Gemini | Hard reasoning. ~5% of tokens, ~90% of quality outcome — never the stage to economise on |
| `draft` | Gemini Flash | ~80% of tokens, easy and format-bound. First stage to move to an open model, once the eval proves quality held |
| `verify` | **Claude (deliberately not Gemini)** | Independence — see below |
| `translate` | Gemini | Strong Indic-language support; wave 2 depends on this |
| `tutor` | Gemini Flash | Live. Self-hosting an open model starts paying at ~100k free learners |
| `embed` | Open (BGE/E5/Nomic/Qwen) | No reason to ever pay for embeddings here |

## The one hard rule: the verifier is a different family than the drafter

A model checking its own output shares its own blind spots and will wave through
its own hallucinations. That is exactly how wrong content reaches a learner, which
is the existential risk in `docs/07-risks.md`.

`assertVerifierIndependence()` throws at startup if `verify.family === draft.family`.
It's an assertion, not a warning, because the failure is silent otherwise — content
gets published, nothing errors, and nobody finds out until a learner is taught
something false.

This is about independence, not vendor preference: swap either side for an open
model and the rule is satisfied just as well.

## Before the first production run

- [ ] Pin real model ids in `.env` — the defaults here are placeholders and provider
      model strings change faster than this repo does.
- [ ] Fill in real per-MTok prices. The cost-per-path number in `docs/05-economics.md`
      is only as trustworthy as these, and it's the figure the business model rests on.
- [ ] Pin `EMBED_DIMENSIONS` to the chosen embedding model and make it match the
      `vector(N)` column in `db/schema.sql`. Changing it later means re-embedding
      every skill and lesson.
- [ ] Confirm whether the chosen tier allows your data to be used for provider
      training. Free tiers commonly do; that matters for licensed source material
      and student responses.
- [ ] Check batch/async discounts and prompt-caching support per provider, and wire
      `batchable` through. Nothing except `tutor` is latency-sensitive.
