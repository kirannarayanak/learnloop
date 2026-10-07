# 09 — Model strategy

## Why AI at all

AI is not the product. The product is **structured practice with proof of skill**. AI is the
only economically possible way to produce that structure at this breadth.

The counterfactual is the whole argument. Remove AI and you hire people to write curriculum:

| | Human-authored | Engine |
| --- | --- | --- |
| Cost per path | ~$2,000–10,000 (SME + instructional designer) | **~$0.52** |
| Time per path | 3–6 months | ~10 minutes |
| 1,000 topics | ~$5M, several years | **~$520** |
| Something released Tuesday | next year, if ever | Tuesday |

Three to four orders of magnitude. The project's three requirements — *free for learners*,
*all domains*, *always current* — are achievable in any two with human authoring and all three
only with generation. Coursera's authoring costs are exactly why Coursera charges money and is
stale; they didn't choose that, the economics did.

**The four jobs AI actually does**, ranked by whether anything else could:

1. **Decompose a source into atomic, testable skills with prerequisite ordering.** The hard one
   and the moat. An expert does it better but takes hours; for anything new there is no
   expert-written curriculum at all, so 80%-instantly beats 100%-never.
2. **Generate practice.** 60 questions with plausible distractors and a real explanation each.
   The scarce thing (video is already free and infinite) and the work experts most dislike.
3. **Answer "why was my answer wrong?"** at 2am, free, in the learner's language. The only part
   that is genuinely *new for the learner* rather than merely cheaper for us.
4. **Translate and keep translations current.** The alternative for most languages is nothing.

**Where we deliberately don't use it** — this is what makes the above credible:

- Review scheduling → FSRS, a published algorithm. A model would be worse *and* cost money.
- Difficulty calibration → SQL over real attempts. Grounded beats guessed.
- Correctness in high-stakes domains → humans. `publish_lesson()` is a gate built *against* the
  model.
- Making people finish → interface and habit design (`docs/10-motivation.md`).
- Trust → citations. "A model wrote it" is a reason to doubt a lesson; "here is the paragraph
  this rests on" is a reason to believe it.

**"We use AI" is not a differentiator.** Every competitor has the same models at the same
prices. What compounds and can't be bought: the deduplicated **skill graph**, the
**attempt-calibration data**, and **offline + local-language reach**.

## Which model, per stage

Routing lives in `engine/providers/routing.ts` — the only place in the codebase a model is
named. Everything else takes a `ModelRef`, so a swap is config plus an eval run, not a refactor.

| Stage | Share of tokens | Family | Why |
| --- | --- | --- | --- |
| `ingest` | — | Gemini | Long context takes a whole syllabus in one pass; native PDF/video for scanned papers and lecture recordings |
| `graph` | ~5% | Gemini | ~5% of tokens, ~90% of the quality outcome. Never the stage to economise on |
| `draft` | ~80% | Gemini Flash | Easy and format-bound. **First** stage to move to an open model — once an eval can prove quality held |
| `verify` | ~10% | **Different family** | See below |
| `translate` | — | Gemini | Strong Indic-language support; wave 2 runs on this |
| `tutor` | recurring | Gemini Flash | Self-hosting an open model starts paying at ~100k free learners |
| `embed` | — | **Open, self-run** | No reason to ever pay for embeddings here |

### The one hard rule: the verifier is a different family than the drafter

A model checking its own output shares its own blind spots and will approve its own
hallucinations — silently, with nothing erroring, until a learner is taught something false.
`assertVerifierIndependence()` throws at startup rather than warning, because that failure is
invisible otherwise.

This is about independence, not vendors. Route either side to an open model and the rule is
satisfied equally.

## Open models: where they genuinely win

First, the thing to internalise: **generation cost is not the binding constraint.** 1,000 paths
is ~$520. That will never kill this project; content quality and distribution will. A swap that
saves 30% while risking quality is a bad trade in waves 0–2.

- **Embeddings — do this now.** BGE, E5, Nomic, Qwen-embed: all open, all excellent, all
  1024-dim, matching `vector(1024)` in the schema. Pin one and never pay for embeddings.
- **Serverless open-model inference** (Groq, Together, DeepInfra, Fireworks) beats renting GPUs
  until real volume: open models at roughly 3–4× cheaper than a hosted mid-tier model with no
  GPU to operate.
- **Renting a GPU** only wins at scale. One H100 for a day is ~$50–70 — the same as generating
  *all* of wave 0's content via API. Self-hosting pays for the **tutor** at ~100k free learners
  (~$6k/mo of API becomes ~$1k/mo of GPU), not for wave-0 drafting.
- **Ollama locally for development.** Debugging the job queue, JSON parsing and the DAG
  validator needs plumbing, not intelligence. Free iteration.

## Fine-tuning: deferred, and probably not what's wanted

**Fine-tuning teaches form, not facts.** Tuning on exam physics doesn't make a model know
physics; it makes it *sound* like exam physics — which often makes hallucination worse, because
confidence in the register rises without grounding. Confidently-wrong exam content is the
existential risk in `docs/07-risks.md`.

| Fine-tuning is good at | Fine-tuning cannot do |
| --- | --- |
| "Emit this exact JSON shape" | Add knowledge reliably |
| "Phrase as observable can-do statements" | Keep up with anything new |
| Consistent distractors and explanations | Replace citations |
| Shorter prompts → cheaper inference | Make itself verifiable |

**And it fights our core feature.** The differentiator is content about things that shipped
Tuesday; a tuned model is a frozen snapshot. Chasing it means retraining per domain, forever.

Knowledge injection is what the architecture already does: the real source in context, a
citation required per claim. Strictly better than tuning for correctness.

**If we ever do tune, tune an open model we can host.** Tuning a proprietary hosted model gives
up the cost, self-hosting and data-residency reasons for wanting open models at all.

## Sequence

| Wave | Models |
| --- | --- |
| 0–1 | Frontier everywhere, strong prompts, citations. **Log every output judged good or bad** |
| 1–2 | Turn that log into an eval set. Only now can a swap be *measured* |
| 2 | Move `draft` to an open model, scored against the eval. Tune for format if it helps |
| 3+ | Self-host the tutor; keep `graph` and `verify` frontier far longer |

**The eval set gates all of it.** Without one, "we switched to a cheaper model" is
indistinguishable from "we quietly made the content worse" — and for an education product,
quietly worse is what ends you. Start the log in wave 0; it is cheap now and expensive to
reconstruct later.

## Strategic reason beyond cost

Keep the engine model-agnostic because it becomes a **sales requirement**. Government schools,
EU institutions and some NGOs will demand data residency or on-prem inference. "Runs on open
models you host yourself" turns a cost optimisation into a reason an institution can sign — and
it fits the AGPL stance.

## Open checklist

- [ ] Pin real model ids and per-MTok prices in `.env`. Cost-per-path in `docs/05-economics.md`
      is only as trustworthy as those numbers.
- [ ] Pin the embedding model and make `EMBED_DIMENSIONS` match `vector(N)` in the schema.
      Changing it later means re-embedding everything.
- [ ] Confirm whether the chosen provider tier permits training on submitted data. Free tiers
      commonly do, which matters for licensed source text and student responses.
