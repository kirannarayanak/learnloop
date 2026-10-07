# 10 — Structure and incentives: what the evidence actually says

Researched 2026-10-07. Sources at the bottom. Two findings reshaped the design, and one
contradicts our own wave-0 exit gate — that one is called out explicitly.

## The headline split

> **Structure is what teaches. Incentives are what brings them back tomorrow.
> They are different systems with different jobs, and conflating them is the usual mistake.**

The meta-analytic record is unambiguous on this. Gamification reliably lifts **intrinsic
motivation, perceived autonomy and relatedness** — and has **minimal impact on competency**
(Springer, 2023). Meanwhile **mastery learning** moves exam scores by **g ≈ 0.52** across 108
studies, group-based mastery reaching ~1 SD over conventional instruction (Kulik et al.).

So points and badges are a **retention mechanism**, not a learning mechanism. That's fine —
retention is exactly our wave-0 bottleneck (≥35% path completion). But we should not expect
them to make anyone learn more per session, and we should not let them substitute for
structure.

## Finding 1 — mastery learning helps weakest learners most

Mastery effects are **most pronounced in weaker students**, moving average scores from the
50th to the **70th percentile**. For a product whose mission is reach rather than elite
performance, this is the single most important result in the literature: the structural
choice that helps learning most also helps *our* learners most.

**Design consequence:** mastery-based progression is not optional, and it is not a premium
feature. It's the default path shape.

## Finding 2 — mastery gating can *reduce* completion, which fights our own exit gate

This is the uncomfortable one. Mastery programs can **hurt course completion** — only 28% of
studied mastery classes achieved higher completion. Our wave-0 gate is **≥35% completion**.
So a naive implementation of mastery gating could cause us to fail our own gate.

**Design consequence — soft gates, not hard locks:**
- Mastery is required to be *credited* with a skill, never to *view* the next lesson.
- A learner who moves ahead sees a plain, non-punitive note: *"this builds on Closures, which
  you haven't shown yet — want to do that first, or carry on?"* Autonomy preserved, prerequisite
  made visible.
- **Hard** prerequisite edges (`skill_edges.strength ≈ 1.0`) gate credit and credentials.
  **Soft** edges only reorder suggestions.
- Measure completion and mastery separately. If completion drops when gating tightens, loosen
  the gate — not the measurement.

## Finding 3 — global leaderboards harm most of the people on them

Macro leaderboards showing overall rank **harm lower performers specifically**, by accumulating
a perception of repeated failure; only mid-to-upper ranked users experience success
(*JMIR Serious Games*, 2021). Put 10,000 learners on one ranking and you manufacture one
winner and thousands of people who learn they are losing.

**Design consequence — no global leaderboard. Ever.** Instead:
- **Small bucketed leagues**, ~30 learners, with promotion and relegation. Everyone is
  plausibly near the top of *something*.
- **Personal-best comparison as the default view.** "You vs. last week" beats "you vs. 9,000
  strangers" for exactly the learners we most want to keep.
- Rank is opt-in. A learner who doesn't want to compete should never be ranked.

## Finding 4 — loss aversion beats rewards, and forgiveness beats punishment

Duolingo's streak work is the best-instrumented public data on this (600+ experiments):

| Finding | Number |
| --- | --- |
| Streak Freeze vs. gem bonus | **Freeze won 2:1** |
| Streak Freeze effect on at-risk users | **−21% churn** |
| Reaching a 7-day streak | **2.4× more likely to continue next day** |
| Decoupling streak from *daily goal* (any lesson counts) | **+40%** learners on 7-day-plus streaks |

**Design consequences, directly lifted:**
- **Streaks with forgiveness built in.** Freezes are earned and automatic, not a paid upsell.
  The evidence says protection motivates more than reward *and* it's the kinder mechanic —
  rare alignment, take it.
- **Any genuine activity counts toward the streak**, not just hitting the daily goal. A learner
  with 5 spare minutes keeps their streak.
- **Concentrate effort on days 0–7.** That's where the habit forms or doesn't.
- A broken streak must never reset progress. It resets a counter, nothing more.

## Finding 5 — the overjustification trap

Points used as *controlling* mechanisms crowd out a learner's own interest; motivation then
collapses once the points stop. Points used as **competence feedback** produce sustained
engagement and real learning gains. Same mechanic, opposite outcome, decided by framing.

**Design consequences:**
- **Never award points for being correct.** Rewarding correctness punishes the struggling
  learner and pushes everyone toward material that is too easy for them. Points go to
  *effort and consistency*: reviews completed, attempts made, skills mastered, content
  improved.
- **Badges must name a real capability** — "can implement a binary search" — not a trinket
  ("logged in 5 times"). Three badge kinds only: `mastery`, `consistency`, `contribution`.
- Points are never purchasable and never buy content. Knowledge isn't paywalled
  (`docs/01-vision.md`), so it can't be points-walled either.

## Finding 6 — autonomy is the cheapest lever we have

Self-determination theory: intrinsic motivation needs **competence, autonomy, relatedness**.
Autonomy support — choice of path, self-pacing, optional tasks — costs nothing to build and
is the lever most gamified products skip entirely.

**Design consequences:** learner picks their own daily goal (already `profiles.daily_goal_min`),
picks domains, picks order wherever the DAG permits, can skip ahead with a visible reason, and
can turn ranking off. Relatedness comes from **shared progress, not rivalry** — cohort progress
and group celebration rather than head-to-head.

## What we are building, in one table

| Element | Verdict | Why |
| --- | --- | --- |
| Mastery-based progression | **Core**, soft-gated | g ≈ 0.52; helps weakest learners most; soft to protect completion |
| Visible skill map | **Core** | Competence feedback — makes invisible progress legible |
| Streaks + automatic freezes | **Yes** | −21% churn; 7 days ⇒ 2.4× retention; forgiveness beats punishment |
| Points for effort/consistency | **Yes** | Competence feedback framing, not control |
| Badges naming real capabilities | **Yes** | Must be informational, 3 kinds only |
| Small bucketed leagues (~30), opt-in | **Yes** | Avoids the macro-leaderboard harm |
| **Global leaderboard** | **Never** | Demonstrably harms the learners we most want to keep |
| **Points for correct answers** | **Never** | Punishes strugglers; drives avoidance of hard material |
| Paid streak repair / purchasable points | **Never** | Monetising a motivation mechanic corrupts it |

## The honest caveat on all of this

Reported gamification effect sizes range from g ≈ 0.46 to 1.30 across meta-analyses, and the
moderator analyses say effectiveness depends heavily on *implementation*, user type and
discipline. That spread means the literature justifies the **direction** here, not the
magnitude. Duolingo ran 600+ experiments on streaks alone; we should expect to need our own
measurements, and `docs/06-roadmap.md`'s per-domain funnel instrumentation is what makes that
possible. Treat this document as a well-grounded starting hypothesis, not settled fact.

## Sources

- [Gamification enhances intrinsic motivation, autonomy and relatedness, but minimal impact on competency — meta-analysis (Springer, 2023)](https://link.springer.com/article/10.1007/s11423-023-10337-7)
- [The impact of gamification on student learning outcomes: a meta-analysis (Springer)](https://link.springer.com/article/10.1007/s11423-020-09807-z)
- [Exploring the impact of gamification on academic performance: meta-analysis 2008–2023 (BJET, 2024)](https://bera-journals.onlinelibrary.wiley.com/doi/full/10.1111/bjet.13471)
- [Gamified learning impact: meta-analysis of game element combinations (Springer, 2025)](https://link.springer.com/article/10.1007/s11423-025-10493-y)
- [Effectiveness of Mastery Learning Programs: A Meta-Analysis (Kulik, Kulik & Bangert-Drowns)](https://www.uky.edu/~gmswan3/575/kulik_kulik_Bangert-Drowns_1990.pdf)
- [On Bloom's two sigma problem: systematic review of mastery learning, tutoring and direct instruction](https://nintil.com/bloom-sigma/)
- [Leaderboards and the other 90% — why macro leaderboards demotivate](https://yukaichou.com/advanced-gamification/how-to-design-effective-leaderboards-boosting-motivation-and-engagement/)
- [Three downsides to leaderboards, and five ways to make them work](https://www.levelup.plus/blog/leaderboards-good-or-bad/)
- [Behind the product: Duolingo streaks (Jackson Shuttleworth, Retention team)](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team)
- [Streak design: the 5 steps behind Duolingo's daily loop](https://yukaichou.com/gamification-study/master-the-art-of-streak-design-for-short-term-engagement-and-long-term-success/)
- [Gamification game elements, motivation and the evidence — overjustification effect](https://www.cogn-iq.org/learn/theory/gamification/)
