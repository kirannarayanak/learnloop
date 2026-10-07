/**
 * Graders.
 *
 * Two tiers, deliberately. The deterministic checks are free, instant and run on every
 * commit; the rubric judge costs money and only sees what already passed them. Spending a
 * judge call on a lesson that has no citations is wasted either way.
 *
 * What is NOT graded here: similarity to the golden lesson. Scoring generated output
 * against one hand-written reference rewards imitating that lesson rather than teaching
 * well, and penalises a better lesson for being different. The graders score against the
 * design rules themselves (docs/11-lesson-design.md).
 */

import { validateLessonStructure, type LessonBlock } from '../stages/blocks.ts';

export interface GradeResult {
  /** 0 to 1. */
  score: number;
  /** Why it is not 1. Empty when it is. */
  notes: string[];
}

export interface DeterministicGrades {
  structure: GradeResult;
  retrievalPlacement: GradeResult;
  narrationDistinct: GradeResult;
  citationsGrounded: GradeResult;
  diagramCoherent: GradeResult;
  /** Unweighted mean of the above. */
  overall: number;
}

const pass: GradeResult = { score: 1, notes: [] };

function fail(notes: string[], score = 0): GradeResult {
  return { score, notes };
}

/** Normalise for comparison: case, punctuation and whitespace are not the signal. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ====================================================================== structural rules

function gradeStructure(blocks: readonly LessonBlock[]): GradeResult {
  const problems = validateLessonStructure(blocks);
  if (problems.length === 0) return pass;
  // Partial credit: a lesson failing one rule is meaningfully better than one failing four.
  const RULES = 4;
  return {
    score: Math.max(0, (RULES - problems.length) / RULES),
    notes: problems.map((p) => `${p.code}: ${p.detail}`),
  };
}

/**
 * Retrieval must appear before the halfway point.
 *
 * A lesson that defers every question to the end is the format we are replacing — and it
 * passes a naive "has at least two checks" rule, which is exactly why this is separate.
 */
function gradeRetrievalPlacement(blocks: readonly LessonBlock[]): GradeResult {
  const positions = blocks
    .map((b, i) => (b.type === 'check' || b.type === 'predict' ? i : -1))
    .filter((i) => i >= 0);

  if (positions.length === 0) return fail(['no retrieval blocks at all']);

  const half = blocks.length / 2;
  const early = positions.filter((i) => i < half).length;
  if (early === 0) {
    return fail([
      `all ${positions.length} retrieval block(s) are in the second half — that is a quiz at the end`,
    ]);
  }
  return pass;
}

/**
 * Narration must not restate what is on screen (redundancy, d = 0.69).
 *
 * Stricter than the publish-time check: that one looks for a verbatim line, this looks for
 * heavy phrase overlap, because a narration that paraphrases the bullet points is the same
 * failure wearing a hat.
 */
function gradeNarrationDistinct(blocks: readonly LessonBlock[]): GradeResult {
  const notes: string[] = [];
  let narrated = 0;

  for (const [i, block] of blocks.entries()) {
    const onScreen =
      block.type === 'concept'
        ? [block.heading, ...block.keyPoints]
        : block.type === 'recap'
          ? block.points
          : block.type === 'pretrain'
            ? block.terms.map((t) => `${t.term} ${t.gloss}`)
            : block.type === 'diagram'
              ? block.steps.map((s) => s.label)
              : [];

    if (onScreen.length === 0) continue;

    const narrations =
      block.type === 'diagram' ? block.steps.map((s) => s.narration) : [narrationOf(block)];

    for (const narration of narrations) {
      if (narration === undefined) continue;
      narrated += 1;
      const spoken = new Set(norm(narration).split(' ').filter((w) => w.length > 4));
      for (const line of onScreen) {
        const words = norm(line).split(' ').filter((w) => w.length > 4);
        if (words.length < 3) continue;
        const shared = words.filter((w) => spoken.has(w)).length;
        if (shared / words.length > 0.8) {
          notes.push(`block ${i} (${block.type}): narration echoes on-screen text "${line}"`);
        }
      }
    }
  }

  if (narrated === 0) return pass;
  return notes.length === 0
    ? pass
    : { score: Math.max(0, 1 - notes.length / narrated), notes };
}

function narrationOf(block: LessonBlock): string | undefined {
  return 'narration' in block ? block.narration : undefined;
}

/**
 * Citations must appear in the source, roughly verbatim.
 *
 * This is the grader that catches a fabricated quote — a model inventing a plausible
 * sentence and attributing it to the source. Provenance is the whole trust argument
 * (docs/07-risks.md), so a confidently-invented citation is worse than none.
 *
 * Matched loosely on normalised text: models reflow whitespace and fix typos when quoting,
 * and failing those would make the grader noise rather than signal.
 */
function gradeCitationsGrounded(
  citations: readonly { quote: string }[],
  sourceText: string,
): GradeResult {
  if (citations.length === 0) return fail(['no citations']);

  const haystack = norm(sourceText);
  const notes: string[] = [];
  let grounded = 0;

  for (const { quote } of citations) {
    const needle = norm(quote);
    if (needle.length < 20) {
      notes.push(`citation too short to verify: "${quote}"`);
      continue;
    }
    if (haystack.includes(needle)) {
      grounded += 1;
      continue;
    }
    // Allow a partial match on a long quote: models sometimes elide a clause.
    const words = needle.split(' ');
    const firstHalf = words.slice(0, Math.ceil(words.length / 2)).join(' ');
    if (firstHalf.length >= 25 && haystack.includes(firstHalf)) {
      grounded += 1;
      continue;
    }
    notes.push(`FABRICATED: citation not found in the source — "${quote.slice(0, 90)}"`);
  }

  return { score: grounded / citations.length, notes };
}

/** A diagram whose edges or highlights point at nothing renders as lines into empty space. */
function gradeDiagramCoherent(blocks: readonly LessonBlock[]): GradeResult {
  const diagrams = blocks.filter((b): b is Extract<LessonBlock, { type: 'diagram' }> => b.type === 'diagram');
  if (diagrams.length === 0) return pass; // not every skill needs one

  const notes: string[] = [];
  for (const [i, d] of diagrams.entries()) {
    const ids = new Set(d.nodes.map((n) => n.id));
    for (const e of d.edges) {
      if (!ids.has(e.from) || !ids.has(e.to)) notes.push(`diagram ${i}: edge ${e.from}->${e.to} points at a missing node`);
    }
    for (const [si, step] of d.steps.entries()) {
      if (step.highlight.length === 0) notes.push(`diagram ${i} step ${si}: highlights nothing, so the signalling does nothing`);
      for (const h of step.highlight) {
        if (!ids.has(h)) notes.push(`diagram ${i} step ${si}: highlights missing node '${h}'`);
      }
    }
    if (d.steps.length < 2) notes.push(`diagram ${i}: a single step is a static picture, not a walkthrough`);
  }

  return notes.length === 0 ? pass : fail(notes, Math.max(0, 1 - notes.length / 5));
}

export function gradeDeterministic(
  blocks: readonly LessonBlock[],
  citations: readonly { quote: string }[],
  sourceText: string,
): DeterministicGrades {
  const structure = gradeStructure(blocks);
  const retrievalPlacement = gradeRetrievalPlacement(blocks);
  const narrationDistinct = gradeNarrationDistinct(blocks);
  const citationsGrounded = gradeCitationsGrounded(citations, sourceText);
  const diagramCoherent = gradeDiagramCoherent(blocks);

  const parts = [structure, retrievalPlacement, narrationDistinct, citationsGrounded, diagramCoherent];
  return {
    structure,
    retrievalPlacement,
    narrationDistinct,
    citationsGrounded,
    diagramCoherent,
    overall: parts.reduce((sum, g) => sum + g.score, 0) / parts.length,
  };
}

// ============================================================================ rubric judge

export const JUDGE_SYSTEM = `You score a generated lesson against a fixed rubric. You are not comparing it to any reference lesson — judge it on its own terms, against the rules below.

Score each dimension 1-5:

1. explanationCorrectness — is every explanation accurate given the source material shown? 5 = nothing wrong. 3 = one arguable or imprecise claim. 1 = something plainly false.

2. distractorQuality — for each question, are the wrong options PLAUSIBLE but clearly wrong once understood? 5 = a learner with a real misconception would pick one. 3 = some are obviously filler. 1 = wrong options are nonsense nobody would choose.

3. narrationComplementarity — the on-screen text and the spoken narration must carry DIFFERENT content. The eye gets short labels; the ear gets the explanation. 5 = narration adds what the screen cannot show. 3 = some overlap. 1 = narration reads the screen aloud.

4. teachesTheSkill — would a learner who completed this actually be able to do the stated skill? 5 = yes, it is practised directly. 3 = it is explained but never practised. 1 = the lesson is about something adjacent.

5. noFiller — irrelevant-but-interesting material measurably depresses learning. 5 = every sentence is load-bearing. 3 = some padding. 1 = anecdotes, motivational framing, "in this lesson we will".

Be strict. A 5 means you would show this to a paying learner. Most first drafts are 3s. List concrete problems — name the block and quote the text.`;

export const JUDGE_SCHEMA = {
  type: 'object',
  properties: {
    explanationCorrectness: { type: 'integer' },
    distractorQuality: { type: 'integer' },
    narrationComplementarity: { type: 'integer' },
    teachesTheSkill: { type: 'integer' },
    noFiller: { type: 'integer' },
    problems: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'explanationCorrectness', 'distractorQuality', 'narrationComplementarity',
    'teachesTheSkill', 'noFiller', 'problems',
  ],
} as const;

export interface JudgeScores {
  explanationCorrectness: number;
  distractorQuality: number;
  narrationComplementarity: number;
  teachesTheSkill: number;
  noFiller: number;
  problems: string[];
}

export function judgePrompt(sourceExcerpt: string, skillStatement: string, blocks: readonly LessonBlock[]) {
  return {
    // The source is the stable prefix across every skill judged from one case.
    prefix: `SOURCE MATERIAL the lesson was generated from:\n\n${sourceExcerpt}`,
    suffix: `\n\nSKILL THE LESSON CLAIMS TO TEACH: ${skillStatement}\n\nLESSON BLOCKS:\n${JSON.stringify(blocks, null, 1)}\n\nScore it.`,
  };
}

/** Mean of the five dimensions, rescaled to 0-1 so it composes with the free graders. */
export function judgeOverall(scores: JudgeScores): number {
  const dims = [
    scores.explanationCorrectness,
    scores.distractorQuality,
    scores.narrationComplementarity,
    scores.teachesTheSkill,
    scores.noFiller,
  ];
  return (dims.reduce((a, b) => a + b, 0) / dims.length - 1) / 4;
}
