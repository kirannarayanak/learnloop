# 01 — Vision & Wedge

## The mission (unchanged)
Give anyone, anywhere, in any domain, a path from "I don't know this" to "I can do this" —
free at the point of use.

## The problem with starting there
"Learn anything" is already occupied: YouTube (infinite free video), Khan Academy (K-12 math,
excellent, free), Coursera/Udemy (credentialed courses), ChatGPT/Claude (ask anything).
A new platform that is "all of education for everyone" has no wedge, no distribution story,
and no reason for a first user to switch. It dies at 200 users.

## The actual gap (2026)
Four things are genuinely unsolved. We attack #1 and #2 first; #3 and #4 are the moat.

1. **Freshness.** A new framework, model, standard or regulation appears weekly. Course
   production takes 3–9 months. Every structured course about anything new is stale on
   arrival. Nobody has built curriculum that *regenerates itself*.
2. **Practice, not video.** Video is commoditised and free. What is scarce is a correct
   sequence, graded practice, feedback on *your* wrong answer, and spaced review that
   makes it stick. Most platforms ship content and call it learning.
3. **Access.** Billions are on expensive, intermittent data and not learning in English.
   Video-first, always-online, English-first platforms structurally exclude them.
4. **Proof.** A certificate nobody trusts is worth nothing. Verifiable proof-of-skill is
   what converts learning into income — and income is what makes learning worth the time.

## The wedge: a learning *engine*, not a course catalogue
> Point it at any source — a syllabus PDF, a docs site, a GitHub repo, a spec, a paper,
> a YouTube lecture, a government exam blueprint — and it produces a **verified learning
> path**: prerequisite-ordered lessons, graded practice, spaced review, and a skill record.

Why this is the right shape:

- **It scales to all domains without authoring all domains.** We never hire 10,000 subject
  experts. The engine is domain-agnostic; the domains arrive as inputs.
- **It is the only way to be fresh.** React 20 ships Tuesday, the path exists Tuesday.
- **Cost collapses with scale.** Generate a path once, serve it to a million learners from
  cache. Marginal cost per learner approaches zero (see `05-economics.md`).
- **Both revenue doors open from one engine.** Individuals get a free path; institutions pay
  to point the engine at *their* syllabus and watch their cohort through it.

## Positioning in one line
**LearnLoop turns any source into a path you can actually finish — including the things
invented last week.** (Working name. Check trademark + domain before committing.)

## Who we build for first — then widen
The failure mode is serving everyone on day one. The sequence is deliberate:

| Wave | Learner | Why them first |
| --- | --- | --- |
| 0 | Working professionals chasing new tech | They feel the freshness pain daily, they're reachable online, they can pay, and they'll tell you loudly when content is wrong |
| 1 | Students on a fixed syllabus (board/university/competitive exam) | Huge volume, a well-defined source document, clear outcome, parents pay |
| 2 | Institutions: colleges, bootcamps, NGOs, employer L&D | They bring their own syllabus and their own cohort. **This is the revenue engine** |
| 3 | Low-bandwidth / local-language learners at scale | Offline PWA + translation. Hardest, highest mission value, needs waves 0–2 funding it |
| 4 | Everyone, every domain, via creators publishing paths | The engine becomes a platform; we take a cut, not a wage |

Each wave reuses the same engine. None of them require a second product.

## What we explicitly refuse to build
Saying no here is what keeps this shippable by a small team.

- **No video studio.** We link and cite existing video. We never film.
- **No live-tutor marketplace.** Different business (ops-heavy, low margin, local).
- **No social feed.** Study groups later, maybe. Never a timeline.
- **No unverified generated content on a hard subject.** See `07-risks.md`. Wrong maths or
  wrong medicine is worse than no maths. A path ships only past the verification gate.
- **No gated content.** Monetise *tooling, cohorts, and proof* — never the knowledge itself.
  This is a constraint on the business model, written down on purpose.

## How we know it's working
Not signups. Not MAU. Three numbers:

1. **Path completion rate** (target >35% on a 10-lesson path — Coursera-type MOOCs sit near 5–10%).
2. **D30 retained learners** doing scheduled review (proof the loop, not the novelty, is working).
3. **Verified-skill → outcome events**: a job, a promotion, a passed exam, a shipped project.
   Instrument this from day one even when the number is 0. It is the only number that
   matters to a funder, an institution, or a learner's parent.
