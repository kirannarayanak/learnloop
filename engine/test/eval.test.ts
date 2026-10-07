import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeDeterministic, judgeOverall, type JudgeScores } from '../eval/graders.ts';
import { EVAL_CASES, SMOKE_CASES, loadCaseText } from '../eval/cases.ts';
import { goldenLessonBlocks, goldenCitations } from '../fixtures/golden-lesson.ts';
import type { LessonBlock } from '../stages/blocks.ts';

/**
 * A source that contains the golden lesson's cited spans. The eval-health checklist
 * requires a reference solution that actually passes the grader: a 0% score across
 * everything is more often a broken grader than a hard task.
 */
const GOLDEN_SOURCE = `
Agent loops are driven by the stop reason. The loop continues while stop_reason is "tool_use" and ends on "end_turn".
Return all tool_result blocks in a single user message; splitting them across messages discourages parallel tool use.
`;

test('the golden lesson scores perfectly — the reference solution passes the grader', () => {
  const grades = gradeDeterministic(goldenLessonBlocks, goldenCitations, GOLDEN_SOURCE);
  assert.equal(grades.overall, 1, JSON.stringify(grades, null, 1));
});

// This is the grader that catches a model inventing a plausible sentence and attributing
// it to the source. Provenance is the whole trust argument, so a confidently-invented
// citation is worse than no citation at all.
test('a fabricated citation is caught and named', () => {
  const grades = gradeDeterministic(
    goldenLessonBlocks,
    [{ quote: 'The loop terminates when the model emits a sentinel token called HALT.' }],
    GOLDEN_SOURCE,
  );
  assert.equal(grades.citationsGrounded.score, 0);
  assert.ok(grades.citationsGrounded.notes.some((n) => n.startsWith('FABRICATED')));
});

test('a citation that is reflowed or lightly edited still counts as grounded', () => {
  const grades = gradeDeterministic(
    goldenLessonBlocks,
    [{ quote: 'The loop continues while stop_reason is "tool_use",\n  and ends on "end_turn"!' }],
    GOLDEN_SOURCE,
  );
  // Models reflow whitespace and fix punctuation when quoting; failing those would make
  // this grader noise rather than signal.
  assert.equal(grades.citationsGrounded.score, 1);
});

// A quiz at the end satisfies "has at least two checks" while being exactly the format
// docs/11-lesson-design.md replaces. That is why placement is graded separately.
test('a quiz at the end passes the structure rule but fails placement', () => {
  const blocks: LessonBlock[] = [
    { type: 'pretrain', terms: [{ term: 't', gloss: 'g' }], narration: 'Spoken content that is nowhere on screen.' },
    { type: 'concept', heading: 'H', keyPoints: ['short label'], narration: 'A different explanation entirely.' },
    { type: 'explain_back', prompt: 'p', modelAnswer: 'm', mustMention: [] },
    { type: 'check', question: 'q1', options: ['a', 'b'], correctIndex: 0, explanation: 'e' },
    { type: 'check', question: 'q2', options: ['a', 'b'], correctIndex: 0, explanation: 'e' },
  ];
  const grades = gradeDeterministic(blocks, goldenCitations, GOLDEN_SOURCE);

  assert.equal(grades.structure.score, 1, 'the structure rule is satisfied');
  assert.equal(grades.retrievalPlacement.score, 0, 'but every question is in the second half');
});

test('narration that paraphrases the on-screen text is caught, not just verbatim copies', () => {
  const blocks: LessonBlock[] = [
    {
      type: 'concept',
      heading: 'Ending the loop',
      keyPoints: ['The loop finishes when the stop reason reports end_turn'],
      // Same content words, different order — the publish-time check looks for a verbatim
      // line and would miss this. Same failure wearing a hat.
      narration: 'The loop finishes when the reason reports end_turn, and the stop happens there.',
    },
    { type: 'check', question: 'q', options: ['a', 'b'], correctIndex: 0, explanation: 'e' },
    { type: 'predict', question: 'q', options: ['a', 'b'], correctIndex: 0, reveal: 'r', narration: 'Decide first.' },
    { type: 'explain_back', prompt: 'p', modelAnswer: 'm', mustMention: [] },
  ];
  const grades = gradeDeterministic(blocks, goldenCitations, GOLDEN_SOURCE);
  assert.ok(grades.narrationDistinct.score < 1);
  assert.ok(grades.narrationDistinct.notes.some((n) => n.includes('echoes on-screen text')));
});

test('a diagram highlighting a node that does not exist is caught', () => {
  const blocks: LessonBlock[] = [
    {
      type: 'diagram',
      caption: 'c',
      nodes: [{ id: 'a', label: 'A', x: 20, y: 50 }],
      edges: [],
      steps: [
        { label: 's1', highlight: ['a'], narration: 'First part of the mechanism explained aloud.' },
        { label: 's2', highlight: ['ghost'], narration: 'Second part explained aloud.' },
      ],
    },
    { type: 'check', question: 'q', options: ['a', 'b'], correctIndex: 0, explanation: 'e' },
    { type: 'predict', question: 'q', options: ['a', 'b'], correctIndex: 0, reveal: 'r', narration: 'Decide.' },
    { type: 'explain_back', prompt: 'p', modelAnswer: 'm', mustMention: [] },
  ];
  const grades = gradeDeterministic(blocks, goldenCitations, GOLDEN_SOURCE);
  assert.ok(grades.diagramCoherent.score < 1);
  assert.ok(grades.diagramCoherent.notes.some((n) => n.includes("missing node 'ghost'")));
});

test('a single-step diagram is flagged — that is a picture, not a walkthrough', () => {
  const blocks: LessonBlock[] = [
    {
      type: 'diagram',
      caption: 'c',
      nodes: [{ id: 'a', label: 'A', x: 20, y: 50 }],
      edges: [],
      steps: [{ label: 's', highlight: ['a'], narration: 'All of it at once.' }],
    },
    { type: 'check', question: 'q', options: ['a', 'b'], correctIndex: 0, explanation: 'e' },
    { type: 'predict', question: 'q', options: ['a', 'b'], correctIndex: 0, reveal: 'r', narration: 'Decide.' },
    { type: 'explain_back', prompt: 'p', modelAnswer: 'm', mustMention: [] },
  ];
  const grades = gradeDeterministic(blocks, goldenCitations, GOLDEN_SOURCE);
  assert.ok(grades.diagramCoherent.notes.some((n) => n.includes('not a walkthrough')));
});

test('judge scores map 1-5 onto 0-1 so they compose with the free graders', () => {
  const allFives: JudgeScores = {
    explanationCorrectness: 5, distractorQuality: 5, narrationComplementarity: 5,
    teachesTheSkill: 5, noFiller: 5, problems: [],
  };
  const allOnes: JudgeScores = { ...allFives, explanationCorrectness: 1, distractorQuality: 1, narrationComplementarity: 1, teachesTheSkill: 1, noFiller: 1 };
  assert.equal(judgeOverall(allFives), 1);
  assert.equal(judgeOverall(allOnes), 0);
  assert.equal(judgeOverall({ ...allOnes, explanationCorrectness: 5 }), 0.2);
});

// --- eval health: checks on the case set itself, per shared/evals/eval-audit.md

test('the smoke set covers every domain — the cheap default must not drop one silently', () => {
  const allDomains = new Set(EVAL_CASES.map((c) => c.domainSlug));
  const smokeDomains = new Set(SMOKE_CASES.map((c) => c.domainSlug));
  assert.deepEqual([...smokeDomains].sort(), [...allDomains].sort());
});

test('the smoke set includes a high-risk case — the gate is what we most need to not break', () => {
  assert.ok(SMOKE_CASES.some((c) => c.riskTier === 'high'));
});

test('every case has real, loadable, openly licensed source material', () => {
  for (const c of EVAL_CASES) {
    const text = loadCaseText(c);
    assert.ok(text.length > 3000, `${c.id}: source is too short to decompose into a path`);
    // The pipeline's own licence gate would refuse an unlicensed source, so an eval built
    // on one could not exercise the drafting path at all.
    assert.match(c.license, /^CC-/, `${c.id}: needs an open licence`);
    assert.ok(c.sourceUrl.startsWith('https://'), `${c.id}: needs a provenance URL`);
  }
});

test('case ids are unique', () => {
  const ids = EVAL_CASES.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});
