# 11 — What a lesson actually is

Researched 2026-10-07. Sources at the bottom. This document replaces "a lesson is some
markdown with questions at the end", which is what the pipeline produced in its first pass
and which the evidence says is close to the weakest thing we could build.

## The three results that set the design

**1. The study methods learners actually use are the ones that don't work.**
Dunlosky et al. rated ten techniques by utility. **Practice testing** and **distributed
practice** came out HIGH. **Highlighting, rereading and summarisation came out LOW** — and
those are exactly what students report relying on most. A lesson that is a wall of text to
read and re-read is optimised for the illusion of learning.

**2. Cognitive engagement has a strict ordering: Interactive > Constructive > Active >
Passive** (ICAP), with roughly **8–10% better learning at each step up**. Reading is Passive.
Highlighting is Active. *Generating an explanation in your own words* is Constructive.
Every block in a lesson should be pushed as far up that ladder as the format allows.

**3. Narration and on-screen text are not additive — they compete.**

| Principle | Finding | Effect size |
| --- | --- | --- |
| **Modality** | Graphics + narration beats graphics + on-screen text | **d = 1.17** |
| **Temporal contiguity** | Words and pictures together, not in sequence | **d = 1.30** |
| **Redundancy** | Graphics + narration beats graphics + narration + *the same text* | **d = 0.69** |

The redundancy result is the one that overrules intuition. **A "read this page aloud" button
is a measurable harm**, because the learner's verbal channel is then processing the same
words twice and the visual channel is doing nothing useful.

## What this means we build

### Voice is a separate channel, not a text-to-speech button

- Every narrated block carries a `narration` string that is **different from what is on
  screen**. The screen shows a diagram and short labels; the voice carries the explanation.
- When narration is playing, the full prose is **not** displayed. A transcript is available
  on demand — for accessibility, for noisy rooms, for learners who prefer reading — but
  showing it *simultaneously with audio* is the exact redundancy penalty, so it replaces the
  audio rather than accompanying it.
- Voice is **off by default and remembered**. Autoplaying audio is hostile on a shared phone.

### Synthetic voice is fine — the old objection expired

Mayer's original voice principle preferred human narration. His own 2012 follow-up with
better synthesis found **no difference**, and later work found a **modern TTS voice beating
both classic TTS and human voice on transfer**. Quality of the engine is what matters.

Practical consequence: we use the **browser's built-in `SpeechSynthesis`**. It is free, needs
no network, works offline, and costs us nothing per learner — which is the only way narrated
lessons are compatible with being free at the point of use (`docs/05-economics.md`). Voice
quality varies by device, so it is offered, never required, and never the only way to get
the content.

### Lessons are segmented and learner-paced

Segmenting: the learner advances each step rather than receiving a wall. This also makes the
lesson work on a phone on bad data — each segment is small.

### Retrieval practice is woven through, not bolted on the end

Practice testing is the highest-utility technique available, so questions appear *inside* the
lesson, not only after it. A question before the explanation (prediction) is more valuable
than the same question after it, because generating an answer — even a wrong one — primes
the explanation.

## The block types

Each is a cognitive move, not a layout. The ICAP mode each targets is noted, because that
is the thing being maximised.

| Block | What it does | ICAP |
| --- | --- | --- |
| `pretrain` | Names the key terms *before* the explanation, so working memory isn't learning vocabulary and mechanism at once (pre-training principle) | Passive |
| `concept` | Short claim on screen + narration carrying the explanation. Never both | Passive |
| `diagram` | Stepped visual with signalling; narration synchronised to the highlighted part (temporal contiguity + signalling) | Active |
| `predict` | Asks what happens *before* revealing it. The generation effect — a wrong guess still primes the explanation | Constructive |
| `worked_example` | Steps through a solution, then **fades**: later steps are blanked for the learner to supply | Constructive |
| `check` | Inline retrieval. Several per lesson, not a block at the end | Active |
| `explain_back` | "Say it in your own words." Self-explanation, compared against a model answer the learner sees only after writing | **Constructive** |
| `recap` | Closes the loop, names what is now credited | Passive |

Rules that apply across all of them:

- **Coherence**: no decorative imagery, no fun facts, no seductive details. Everything that
  isn't load-bearing is removed, because interesting-but-irrelevant material measurably
  depresses learning.
- **Signalling**: the diagram highlights the part being discussed, nothing else.
- **Personalisation**: conversational second person ("you"), not formal third person.
- **Every block is still cited.** Provenance doesn't lapse because the format got richer.

## What we deliberately do not build

- **No autoplaying video.** It is Passive, it is expensive, and it is the thing YouTube
  already does infinitely and for free.
- **No "read the page aloud" button.** Covered above — it is a measured harm, not a feature.
- **No auto-graded free text.** `explain_back` shows the learner a model answer and lets
  *them* judge. Grading prose with a model is expensive, wrong often enough to be unfair,
  and unnecessary — the value is in generating the explanation, not in scoring it.
- **No points for getting the inline checks right.** Unchanged from `docs/10-motivation.md`.

## Honest caveat

These effect sizes come from controlled multimedia-learning experiments, mostly short
lab studies with university students. They justify the *direction* confidently — segmenting,
narration that isn't redundant, retrieval woven through, pushing up the ICAP ladder — but
not a specific predicted gain for our learners. The per-domain funnel instrumentation in
`docs/06-roadmap.md` is how we check it on real ones.

## Sources

- [Dunlosky et al. (2013), Improving Students' Learning With Effective Learning Techniques](https://pubmed.ncbi.nlm.nih.gov/26173288/) — practice testing and distributed practice HIGH; highlighting, rereading, summarisation LOW
- [Strengthening the Student Toolbox (Dunlosky, summary for practitioners)](https://www.aft.org/ae/fall2013/dunlosky)
- [Chi & Wylie, The ICAP Framework: Linking Cognitive Engagement to Active Learning Outcomes](https://education.asu.edu/sites/g/files/litvpz656/files/lcl/chiwylie2014icap_2.pdf)
- [The ICAP framework predicts learning gains in active classrooms (Wiggins et al., 2017)](https://journals.sagepub.com/doi/10.1177/2332858417708567)
- [Mayer's principles of multimedia learning — modality, redundancy, temporal contiguity](https://educationaltechnology.net/mayers-principles-of-multimedia-learning/)
- [Nine ways to reduce cognitive load in multimedia learning (Mayer & Moreno)](https://www.uky.edu/~gmswan3/544/9_ways_to_reduce_CL.pdf)
- [Text-to-Speech Software and Learning: Investigating the Relevancy of the Voice Effect](https://www.researchgate.net/publication/327795958_Text-to-Speech_Software_and_Learning_Investigating_the_Relevancy_of_the_Voice_Effect)
- [The Promise of Synthetic Voices to Improve Learning Outcomes](https://www.readspeaker.com/v4/uploads/learning-library-readspeaker-The-Promise-of-Synthetic-Voices.pdf)
- [Is Natural Necessary? Human Voice versus Synthetic Voice for Intelligent Virtual Agents](https://www.mdpi.com/2414-4088/6/7/51)
