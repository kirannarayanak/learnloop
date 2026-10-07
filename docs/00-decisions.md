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
