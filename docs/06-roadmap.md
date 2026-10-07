# 06 — Roadmap

Sized for one person plus AI assistance. Every wave has an **exit criterion that is a number**,
not a feature list. If a wave misses its number, fix that before starting the next one —
building wave N+1 on a broken wave N is how projects like this die at 300 users.

Dates assume a start of 2026-10-07 and real-life part-time pace. Slip the dates, not the gates.

---

## Wave 0 — Prove the engine (6 weeks → ~2026-11-18)
**Goal: one source in, one finishable path out, 50 real learners.**

Build:
- `engine/` pipeline end to end, ingest → publish, across **all four seeded domains**
  (`db/seed/01-domains.sql` — see the reasoning and accepted cost in `00-decisions.md`).
- `db/schema.sql` applied; the five job kinds running off `generation_jobs`.
- **The risk gate, working, on day one.** `publish_lesson()` must refuse a high-risk lesson
  that is only `auto_passed`. This has a test before any K-12 content is generated.
- **The human review queue**, because `exam-prep` and `school-curriculum` need it immediately.
  Minimal: a list, a diff, approve/reject. It does not need to be pretty.
- A deliberately plain web app: path list → lesson → exercise → next. No dashboard, no
  profile page, no settings.
- FSRS review queue.
- The flag button. From the very first lesson.
- **Per-domain funnel instrumentation** — starts, completions and flags broken out by domain.
  This is the instrument that decides where to concentrate; without it, four domains is just
  four guesses.

Do **not** build: auth beyond magic-link, payments, offline, i18n, orgs, tutor, certificates.

**Also in wave 0 now, because K-12 is in scope:** settle the minors data-protection policy
(COPPA / GDPR-K / DPDP). No school cohort is onboarded before it exists. This moved up from
wave 3 as a direct consequence of the four-domain decision.

**Exit gate:** 50 learners start a path; **≥35% finish it**; **<2% of items flagged as wrong**;
and **zero high-risk lessons published without human approval** (this one is binary — a single
breach means the gate is broken, stop and fix it).

Measure the first three **per domain**. If attention splits four ways and no single domain
reaches 50 learners, collapse to the best performer — that is the expected failure mode of
this decision and the one to watch for. If completion is under 20% everywhere, the problem is
content quality or item size, not distribution. Do not proceed on a broken loop.

---

## Wave 1 — Open the engine to any source (5 weeks → ~2026-12-23)
**Goal: a learner pastes a URL or PDF and gets a verified path.**

- Public ingest endpoint with a rate limit and the licence gate.
- Dedupe against the existing skill graph (pgvector) — this is what makes the graph compound.
- Freshness cron: re-fetch sources, diff hashes, regenerate only what changed.
- AI tutor, Haiku 4.5, scoped to the current lesson's context, **capped at 20 turns/month free**.
- Attempt-driven difficulty calibration (pure SQL, scheduled).

**Exit gate:** 60% of self-serve ingests produce a path that passes verification **without
human repair**. Under 40% means the graph-extraction prompt is the bottleneck — go fix that,
it is the moat.

---

## Wave 2 — Reach (6 weeks → ~2027-02-03)
**Goal: usable on a cheap phone, on bad data, in a second language.**

- PWA: installable, offline path bundles, write-ahead attempt queue + sync.
- Machine translation into 3 launch locales + a community correction flow.
- Accessibility pass: keyboard-complete, screen-reader-correct, contrast-checked.
- PPP pricing tiers, Stripe + Razorpay, Pro tier live.

**Exit gate:** a full lesson + 5 exercises completed **offline on a sub-$100 Android phone**,
syncing cleanly on reconnect. 100 paying Pro subscribers.

---

## Wave 3 — Institutions (8 weeks → ~2027-03-31)
**Goal: the first signature. This is where the money is.**

- Orgs, cohorts, instructor dashboards, mastery heatmaps, assignments, CSV roster import, SSO.
- "Point it at our syllabus" flow: private paths, `owner_org_id`, RLS-enforced isolation.
- Audit logs, data export, deletion. Minors policy settled before the first school.

**Exit gate:** **3 paying institutions**, ≥200 seats total, one of them willing to be named
publicly as a reference.

**Start the five validation conversations now, in wave 0 — not in wave 3.** Do not build this
dashboard until three institutions have told you what they'd pay for. This is the single
highest-risk assumption in the whole plan.

---

## Wave 4 — Proof and platform (ongoing, from ~2027-04)
- Verified assessments; Open Badges with a public `/verify/<slug>` URL.
- Creator publishing + revenue share → the long tail of "all domains".
- Employer-facing skill verification.
- High-risk domains unlocked **only** behind a funded expert review panel.

**Exit gate:** 10 verified-skill → real-outcome events (job, promotion, passed exam) that you
can actually point at. This is the number that makes the mission real rather than claimed.

---

## Running in parallel from day one
- **Instrument the three metrics in `01-vision.md`** before you have users to measure.
- **Nightly `pg_dump` to R2.** Before wave 0 ships, not after the first data loss.
- **Open-source the core** (AGPL) once wave 0 passes its gate. Early enough to attract
  contributors, late enough that the shape is settled.
- **Write down every "the engine got this wrong" case.** That file becomes the eval set, and
  the eval set is what lets you improve generation quality without guessing.
