/**
 * Lesson blocks.
 *
 * Each type is a cognitive move, not a layout choice — see docs/11-lesson-design.md for
 * the evidence behind each one. Two rules are structural rather than stylistic, and the
 * types are shaped to make breaking them awkward:
 *
 *  1. `narration` must NOT restate what is on screen. Graphics + narration beats graphics
 *     + narration + the same text (redundancy, d = 0.69). That is why narrated blocks
 *     carry short `keyPoints` for the eye and a separate `narration` for the ear, instead
 *     of one `body` field that something could read aloud.
 *
 *  2. Retrieval is woven through, not appended. `check` and `predict` are ordinary blocks
 *     that belong in the middle of a lesson — practice testing is the highest-utility
 *     technique available (Dunlosky et al.), so it does not wait until the end.
 */

/** Named so the renderer and the generator agree on the cognitive intent. */
export type BlockType =
  | 'pretrain'
  | 'concept'
  | 'diagram'
  | 'predict'
  | 'worked_example'
  | 'check'
  | 'explain_back'
  | 'recap';

/**
 * Pre-training: name the terms before the mechanism, so working memory isn't learning
 * vocabulary and process simultaneously.
 */
export interface PretrainBlock {
  type: 'pretrain';
  terms: { term: string; gloss: string }[];
  narration: string;
}

/**
 * A single claim. `keyPoints` are for the eye — short, scannable, NOT sentences.
 * `narration` carries the actual explanation for the ear.
 */
export interface ConceptBlock {
  type: 'concept';
  heading: string;
  keyPoints: string[];
  narration: string;
}

/** A node in a stepped diagram. Positions are on a 0–100 grid, so it scales to any width. */
export interface DiagramNode {
  id: string;
  label: string;
  x: number;
  y: number;
  /** Optional short tag rendered under the label, e.g. a type or a count. */
  note?: string;
}

export interface DiagramEdge {
  from: string;
  to: string;
  label?: string;
  /** Draw as a returning/dashed edge — loops back in a cycle. */
  back?: boolean;
}

/**
 * Stepped diagram. Signalling (highlight only what is being discussed) and temporal
 * contiguity (narration arrives with the highlight, not before or after it) are the two
 * largest effects available to us — d = 1.30 for contiguity.
 */
export interface DiagramBlock {
  type: 'diagram';
  caption: string;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  steps: {
    /** Short label shown on screen for this step. */
    label: string;
    /** Node ids lit for this step. Everything else dims — that is the signalling. */
    highlight: string[];
    /** Carried by voice. Must not duplicate `label`. */
    narration: string;
  }[];
}

/**
 * Prediction before reveal. The generation effect: committing to an answer — even a wrong
 * one — primes the explanation that follows. This is why it comes BEFORE the concept it
 * tests, which looks backwards and is not.
 */
export interface PredictBlock {
  type: 'predict';
  question: string;
  options: string[];
  correctIndex: number;
  /** Shown after the learner commits. Explains every option, not just the right one. */
  reveal: string;
  narration: string;
}

/**
 * Worked example with fading: early steps are shown complete, later steps blank out for
 * the learner to supply. Fading beats both pure worked examples and pure problem-solving.
 */
export interface WorkedExampleBlock {
  type: 'worked_example';
  goal: string;
  steps: {
    show: string;
    explain: string;
    /** When true the learner supplies this step before it is revealed — the fading. */
    faded?: boolean;
    /** Options offered for a faded step. */
    options?: string[];
    correctIndex?: number;
  }[];
}

/** Inline retrieval. Several per lesson, in the middle, not a quiz at the end. */
export interface CheckBlock {
  type: 'check';
  question: string;
  options: string[];
  correctIndex: number;
  /** Shown whether right or wrong. The explanation is the teaching moment. */
  explanation: string;
  /** The wrong belief this deliberately probes, if any. */
  targetsMisconception?: string;
}

/**
 * Self-explanation — the highest ICAP mode a single learner can reach alone.
 *
 * Deliberately NOT auto-graded. The learner writes, then sees a model answer and judges
 * for themselves. Grading prose with a model is expensive, unfair often enough to matter,
 * and beside the point: the value is in generating the explanation, not in scoring it.
 */
export interface ExplainBackBlock {
  type: 'explain_back';
  prompt: string;
  /** Revealed only after the learner has written something. */
  modelAnswer: string;
  /** Points to self-check against. Helps the learner grade themselves honestly. */
  mustMention: string[];
}

export interface RecapBlock {
  type: 'recap';
  points: string[];
  narration: string;
}

export type LessonBlock =
  | PretrainBlock
  | ConceptBlock
  | DiagramBlock
  | PredictBlock
  | WorkedExampleBlock
  | CheckBlock
  | ExplainBackBlock
  | RecapBlock;

/** Blocks the learner must act on before advancing. Used for progress and for pacing. */
export function isInteractive(block: LessonBlock): boolean {
  return (
    block.type === 'predict' ||
    block.type === 'check' ||
    block.type === 'explain_back' ||
    (block.type === 'worked_example' && block.steps.some((s) => s.faded === true))
  );
}

/** The narration for a block, if it has any. */
export function narrationOf(block: LessonBlock): string | undefined {
  if ('narration' in block) return block.narration;
  return undefined;
}

/**
 * Structural checks a generated lesson must pass before it can be published.
 *
 * These encode docs/11-lesson-design.md as assertions, because a model asked for a rich
 * lesson will happily return eight `concept` blocks in a row — which is a wall of text
 * wearing a costume, and the weakest thing we could ship.
 */
export interface LessonStructureProblem {
  code: 'no_retrieval' | 'no_constructive' | 'narration_redundant' | 'too_passive' | 'empty';
  detail: string;
}

/** A narration that merely restates the on-screen text triggers the redundancy penalty. */
function looksRedundant(narration: string, onScreen: string[]): boolean {
  if (onScreen.length === 0) return false;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  const spoken = norm(narration);
  // Any on-screen line of real length appearing verbatim in the narration.
  return onScreen.some((line) => {
    const l = norm(line);
    return l.length > 25 && spoken.includes(l);
  });
}

export function validateLessonStructure(blocks: readonly LessonBlock[]): LessonStructureProblem[] {
  const problems: LessonStructureProblem[] = [];

  if (blocks.length === 0) {
    return [{ code: 'empty', detail: 'lesson has no blocks' }];
  }

  // Practice testing is the highest-utility technique available; a lesson without
  // retrieval woven through is the format we are explicitly moving away from.
  const retrieval = blocks.filter((b) => b.type === 'check' || b.type === 'predict').length;
  if (retrieval < 2) {
    problems.push({
      code: 'no_retrieval',
      detail: `only ${retrieval} retrieval block(s); a lesson needs at least 2 woven through, not a quiz at the end`,
    });
  }

  // ICAP: without a constructive block the ceiling is Active, which is two rungs down.
  const constructive = blocks.some(
    (b) => b.type === 'explain_back' || b.type === 'predict' || b.type === 'worked_example',
  );
  if (!constructive) {
    problems.push({
      code: 'no_constructive',
      detail: 'no constructive block (explain_back / predict / worked_example); the lesson tops out at Active on ICAP',
    });
  }

  const passive = blocks.filter((b) => b.type === 'concept' || b.type === 'pretrain').length;
  if (passive > blocks.length * 0.6) {
    problems.push({
      code: 'too_passive',
      detail: `${passive} of ${blocks.length} blocks are passive; this is a wall of text in a costume`,
    });
  }

  for (const [i, block] of blocks.entries()) {
    const narration = narrationOf(block);
    if (narration === undefined) continue;

    const onScreen =
      block.type === 'concept'
        ? [block.heading, ...block.keyPoints]
        : block.type === 'recap'
          ? block.points
          : block.type === 'pretrain'
            ? block.terms.map((t) => `${t.term} ${t.gloss}`)
            : [];

    if (looksRedundant(narration, onScreen)) {
      problems.push({
        code: 'narration_redundant',
        detail: `block ${i} (${block.type}) narrates text that is already on screen — that is the redundancy penalty (d = 0.69), not an accessibility feature`,
      });
    }
  }

  return problems;
}
