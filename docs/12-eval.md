# 12 — The eval

```
npm run eval -- --dry-run     estimate, spends nothing
npm run eval                  4 cases, free deterministic graders
npm run eval -- --judge       adds the paid rubric judge
npm run eval -- --full        all 8 cases (costs more than the default budget)
```

Without API keys it runs the fake providers end to end, so the harness itself is testable
for free — the numbers are then about the harness, not the generator, and the output says
so.

## Why this exists

Every cheaper-model swap from here on is a decision about quality, and without a measured
number *"we switched to a cheaper model"* and *"we quietly made the content worse"* are
indistinguishable. For an education product, quietly worse is the thing that ends you
(`docs/07-risks.md`). This is the gate on all of it.

## The cases

Eight real documents, two per beachhead domain, **committed to the repo** rather than
fetched at run time — a page that changes under you turns a regression into a mystery, and
an eval you cannot re-run next quarter is worse than a synthetic one you can.

All are CC BY-SA via Wikipedia. That is not incidental: the pipeline's own licence gate
refuses unknown-licence sources, so an eval built on unlicensed material could not legally
exercise the drafting path at all.

| Tier | Cases | Cost | When |
| --- | --- | --- | --- |
| **smoke** (default) | 4, one per domain | ~$1.30 | Every prompt change |
| **full** (`--full`) | 8 | ~$2.60 | Before a model swap or a release |

The split exists because the full set costs more than the chosen $2 budget, and **an eval
you hesitate to run does not get run**. The smoke set is checked by a test to cover every
domain and to include a high-risk case, so the cheap default can never silently drop one.

## The graders

Two tiers. The free ones gate first — spending a judge call on a lesson with fabricated
citations tells you nothing you did not already know.

### Deterministic (free, instant, runs in CI)

| Grader | Catches |
| --- | --- |
| `structure` | Walls of concept blocks, missing retrieval, no constructive block |
| `retrievalPlacement` | A quiz at the end. This passes the structure rule, which is exactly why it is graded separately |
| `narrationDistinct` | Narration echoing the screen — **paraphrase too**, not just verbatim copies |
| `citationsGrounded` | **A fabricated quote.** The single most important grader here |
| `diagramCoherent` | Edges and highlights pointing at nodes that do not exist; single-step "walkthroughs" |

`citationsGrounded` earns its place first: it catches a model inventing a plausible sentence
and attributing it to the source. Provenance is the entire trust argument, so a
confidently-invented citation is worse than no citation. It matched loosely on normalised
text, because models reflow whitespace and fix punctuation when quoting and failing those
would make the grader noise rather than signal.

### Rubric judge (paid, `--judge`)

Five dimensions, 1–5: explanation correctness, distractor quality, narration
complementarity, whether it teaches the stated skill, and absence of filler.

**It never sees the golden lesson.** Scoring generated output against one hand-written
reference rewards *imitating that lesson* rather than teaching well, and penalises a better
lesson for being different. The judge scores against the design rules themselves.

### The gate is pass/fail, never an average

A high-risk case must be **blocked**. A high-risk lesson that scores 95% and publishes is a
failed run, and the runner exits non-zero for it. No score compensates.

## Honest limitations

Per the eval-health checklist, written down rather than discovered later:

1. **One run per case — no variance measured.** A difference between two configurations
   could be noise. Before trusting a small delta, run the same configuration twice and see
   how much it moves on its own.
2. **The judge and the verifier are the same model.** Independence from the *generator* is
   real; a systematic blind spot in the judge is not caught by anything here.
3. **Wikipedia is heavily represented in training data.** The generator can answer from
   memory rather than from the source, which is precisely why `citationsGrounded` is the
   load-bearing grader and why `transformers` is in the set.
4. **No human-labelled quality gold.** The rubric judge is a proxy for a human reader. The
   golden lesson is the only hand-written reference, and it is used as a grader *target*,
   never as an answer key.
5. **The deterministic graders are gameable.** A model could place weak questions early to
   satisfy `retrievalPlacement`. The rubric judge is what notices; the free graders are a
   floor, not a ceiling.

## Reading a result

Results land in `engine/eval/results/<timestamp>.jsonl`, one JSON object per case, with
per-lesson grades and the notes behind every score below 1. The console prints the five
worst-scoring lessons with their first two problems, because the aggregate tells you
whether something broke and the notes tell you what.

A first run against the fake providers scores 80% and flags every citation as fabricated —
correctly, because the fake's placeholder quotes are not in the source. That is the harness
working, not a bug.
