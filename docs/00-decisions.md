# 00 — Decisions log

Append-only. Each entry records what was decided, when, and the reasoning — so a future
session (or a future contributor) doesn't relitigate it or quietly reverse it.

---

## 2026-10-07 — Open source, public from day one
**Decision:** AGPL-3.0, public repo immediately. Not held back until the wave-0 gate.

**Why:** for a project asking people to trust it with their education, building in the open is
worth more than the optionality of building in private. AGPL specifically means a competitor
cannot take the engine, host it closed, and outspend us on ads.

**Accepted cost:** the plan, the economics and the generation prompts are visible to
competitors from commit one. Judged acceptable — the moat is the accumulated skill graph and
the attempt-calibration data, neither of which is in the repo.

---

## 2026-10-07 — Cloud-hosted, and cloud-developed
**Decision:** nothing depends on a laptop. App runs on free cloud tiers
(Cloudflare Pages/Workers + R2, Supabase Postgres); development continues in Claude Code
cloud sessions against the GitHub remote.

**Implication:** no local-only steps in any runbook. Every pipeline stage must be runnable as
a scheduled worker, not only as a CLI on someone's machine.

---

## 2026-10-07 — Wave 0 ships all four beachhead domains, not one
**Decision:** seed `emerging-tech`, `fintech-eng`, `exam-prep`, and `school-curriculum`
together. Let per-domain wave-0 completion data choose where to concentrate, rather than
choosing up front.

**The advice this overrides:** the recommendation was one narrow domain, because a solo
founder has one distribution channel, not four, and four markets at once usually means four
sets of 10 users instead of one set of 50.

**Why it is nonetheless workable:** the engine is domain-agnostic by design, so four domains
is a seed file, not four codebases. The real cost is elsewhere, and is now explicit:

1. **The human-review gate becomes a day-one requirement, not a wave-4 one.** `exam-prep` is
   medium risk and `school-curriculum` is high. So `domains.risk_tier` and `publish_lesson()`
   shipped in the schema immediately — a high-risk lesson cannot publish on auto-verification.
2. **The minors data-protection policy must be settled before any school cohort**, because
   K-12 is in scope from the start. This moved from wave 3 to wave 0.
3. **Distribution stays the binding constraint.** Code supports four domains; one person
   does not support four go-to-market motions. Mitigation: measure completion *per domain*
   in wave 0 and concentrate on whichever one clears the 35% gate first.

**What would falsify this:** if no single domain reaches 50 learners because attention is
split four ways, collapse to the best-performing one. That is the signal to watch for, and
it is a wave-0 decision, not a wave-1 one.

---

## 2026-10-07 — Gemini as primary provider, behind a provider-agnostic adapter
**Decision:** Gemini is the default for ingest, graph, draft, translate and tutor.
No stage names a vendor; `engine/providers/routing.ts` holds every model choice.

**Why Gemini specifically** — three reasons that are about this product, not generic quality:
1. **Long context** — ingest a whole textbook or board syllabus in one pass instead of
   chunking it, which makes graph extraction better, not merely cheaper.
2. **Native PDF and video understanding** — scanned syllabi and lecture recordings are real
   inputs for `exam-prep` and `school-curriculum`.
3. **Strong Indic-language support** — wave 2's translation layer is a core mission feature.

**The one constraint kept:** `verify` is routed to a **different model family** than `draft`.
A model checking its own output shares its own blind spots and will approve its own
hallucinations — silently, with nothing erroring, until a learner is taught something false.
`assertVerifierIndependence()` throws at startup. This is about independence, not vendors:
route either side to an open model and the rule is equally satisfied.

**Also settled:** embeddings are always an open model (BGE/E5/Nomic/Qwen), self-run. There is
no reason to ever pay for embeddings in this project.

**Not decided, deliberately deferred:** fine-tuning. Fine-tuning teaches form, not facts, and
a frozen model fights the freshness differentiator. It also needs training data we don't have
yet and an eval set to judge it with. Revisit in wave 2, and tune an *open* model we can host —
tuning a proprietary hosted model would give up the cost, self-hosting and data-residency
reasons for wanting open models in the first place.

**Open risk:** free tiers commonly permit provider training on submitted data. That matters for
licensed source material and student responses. Confirm the tier's terms before any real
learner data or licensed text goes through it — this is a checklist item in
`engine/providers/README.md`.
