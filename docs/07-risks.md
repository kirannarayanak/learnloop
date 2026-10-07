# 07 — Risks, and what we actually do about each

Honest list. The first two are the ones that kill the project.

## 1. Wrong content at scale  — *existential*
An AI-generated lesson that is confidently wrong, multiplied by a million learners, is the
end of the project's credibility and a genuine harm to people.

**Mitigations, all mandatory, all in code not policy:**
- Every claim cites a source span (`lesson_sources.quote`); no citation, no publish.
- Independent verification pass with only the sources in context (`04-content-pipeline.md`).
- **Risk tiering**: high-stakes domains require `human_approved`, enforced in the publish
  query. Wave 0 ships low-tier domains only.
- One-tap "this is wrong" on every lesson and exercise → `flags` → triage SLA.
- Public version history per lesson. Corrections are visible, not silent.
- Expert review queue; pay reviewers once revenue exists. Credit them publicly either way.

## 2. Nobody finishes  — *the quiet killer*
MOOC completion sits around 5–10%. Content was never the bottleneck; finishing is.
**Mitigations:** ~8-minute items; FSRS review scheduled around the learner's real timezone and
stated daily goal; streaks that forgive (a missed day doesn't reset); cohort deadlines for org
learners; a visible skill map so progress is legible. **Measure completion from week one and
treat a drop as a P0 bug**, not a marketing problem.

## 3. Inference cost outrunning revenue
**Mitigations:** no model call in the content path; generate-once-cache-forever; hard free-tier
tutor caps; Batch API everywhere; model ladder. A per-user monthly cost ceiling enforced
server-side, with a circuit breaker that degrades the tutor to retrieval-only rather than
silently running up a bill. Alert on cost-per-active-learner, weekly.

## 4. Copyright and licensing
Ingesting a textbook and regenerating it is infringement regardless of paraphrase.
**Mitigations:** `sources.license` is required; unknown licence ⇒ cite-and-link only, never
reproduce; prefer openly licensed and public-domain material (OpenStax, Wikipedia, MIT OCW,
arXiv, official docs, government syllabi); honour robots.txt and takedowns fast; publish a
DMCA contact before launch, not after the first letter.

## 5. Moderation and abuse
Open ingestion means someone will try to generate propaganda, extremism, or a bomb recipe
and have it wear our credibility.
**Mitigations:** classify every ingest source and every generated path; block disallowed
categories at generation, not at display; rate-limit custom generation per account;
human review for anything political, medical, or legal; keep an audit trail of who
generated what.

## 6. Minors and data protection
Education means under-18 learners, which means COPPA / GDPR-K / India's DPDP Act.
**Mitigations:** collect the minimum (no phone number, no address, no precise location);
org-managed accounts for school cohorts so the school holds consent; no behavioural ads ever;
age gate on self-serve signup; data export and deletion endpoints built in wave 1, not bolted
on later. Decide the under-13 policy *before* the first school signs.

## 7. Platform and vendor risk
Free tiers change. **Mitigation:** every row in the `02-architecture.md` table has a named
escape hatch; everything is Postgres + object storage + stateless workers, which is portable
by construction. Nightly `pg_dump` to R2 from day one. No vendor-specific feature in the data
layer that isn't trivially replaceable.

## 8. Single-maintainer risk
One person cannot staff a global education platform.
**Mitigations:** open-source the core early so the work survives you; keep `docs/` in the repo
so context isn't only in your head; automate verification so quality doesn't depend on your
attention; recruit domain reviewers as volunteers before you need them. Be realistic about
scope per wave — the roadmap in `06-roadmap.md` is sized for one person plus AI, which is why
each wave is small.

## 9. Trust and distribution
Nobody trusts a new education brand, and "we have AI" is not a reason to switch.
**Mitigations:** lead with the *freshness* claim, which is checkable and falsifiable; publish
the verification methodology openly; show sources on every lesson; let people take a full path
without an account; partner with one visible institution early and say its name.

## 10. Incumbents
Khan Academy, Coursera, or a model provider could ship this.
**Honest answer:** we don't win on resources. We win on three things that are hard to copy:
the accumulated **skill graph** (deduped across domains), the **attempt-calibration data**,
and **offline + local-language reach** that an English-first, video-first incumbent is
structurally bad at. Build those three deliberately, early, and in that order.
