import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateLessonStructure, isInteractive, type LessonBlock } from '../stages/blocks.ts';
import { goldenLessonBlocks } from '../fixtures/golden-lesson.ts';

const concept = (heading: string): LessonBlock => ({
  type: 'concept',
  heading,
  keyPoints: ['a point'],
  narration: 'Something said aloud that is nowhere on the screen.',
});

const check = (q: string): LessonBlock => ({
  type: 'check',
  question: q,
  options: ['a', 'b'],
  correctIndex: 0,
  explanation: 'because',
});

// The golden lesson is the quality target the generator is aimed at, so it must itself
// satisfy every rule we hold generated lessons to. If it stops doing so, the target moved.
test('the golden lesson passes its own structural rules', () => {
  assert.deepEqual(validateLessonStructure(goldenLessonBlocks), []);
});

test('the golden lesson weaves retrieval through the middle, not just the end', () => {
  const retrievalAt = goldenLessonBlocks
    .map((b, i) => (b.type === 'check' || b.type === 'predict' ? i : -1))
    .filter((i) => i >= 0);

  assert.ok(retrievalAt.length >= 3, 'expected at least three retrieval blocks');
  // At least one in the first half — a lesson that defers all testing to the end is the
  // format docs/11-lesson-design.md moves away from.
  assert.ok(
    retrievalAt.some((i) => i < goldenLessonBlocks.length / 2),
    'retrieval must appear before the halfway point',
  );
});

test('the golden lesson reaches the constructive ICAP mode', () => {
  assert.ok(goldenLessonBlocks.some((b) => b.type === 'explain_back'));
  assert.ok(goldenLessonBlocks.some((b) => b.type === 'predict'));
});

test('prediction comes before the concept it primes', () => {
  const predictAt = goldenLessonBlocks.findIndex((b) => b.type === 'predict');
  const conceptAt = goldenLessonBlocks.findIndex((b) => b.type === 'concept');
  // Looks backwards and is not: committing to an answer first is what makes the
  // explanation land (the generation effect).
  assert.ok(predictAt < conceptAt, 'predict must precede the concept it sets up');
});

test('a wall of concept blocks is rejected', () => {
  const problems = validateLessonStructure([
    concept('one'),
    concept('two'),
    concept('three'),
    concept('four'),
  ]);
  assert.ok(problems.some((p) => p.code === 'no_retrieval'));
  assert.ok(problems.some((p) => p.code === 'no_constructive'));
  assert.ok(problems.some((p) => p.code === 'too_passive'));
});

test('retrieval alone is not enough — a constructive block is required', () => {
  const problems = validateLessonStructure([concept('one'), check('q1'), check('q2')]);
  assert.ok(problems.some((p) => p.code === 'no_constructive'));
  assert.ok(!problems.some((p) => p.code === 'no_retrieval'));
});

// The redundancy penalty (d = 0.69) is the one that overrules intuition: narrating the
// text already on screen is a measured harm, not an accessibility feature.
test('narration that restates the on-screen text is rejected', () => {
  const onScreen = 'The loop ends when the stop reason says end turn and not before';
  const problems = validateLessonStructure([
    {
      type: 'concept',
      heading: 'Ending the loop',
      keyPoints: [onScreen],
      narration: `Here is the thing. ${onScreen}. Remember it.`,
    },
    check('q1'),
    check('q2'),
    {
      type: 'explain_back',
      prompt: 'say it back',
      modelAnswer: 'model',
      mustMention: ['x'],
    },
  ]);
  assert.ok(problems.some((p) => p.code === 'narration_redundant'));
});

test('narration that complements the screen is accepted', () => {
  const problems = validateLessonStructure([
    {
      type: 'concept',
      heading: 'Ending the loop',
      keyPoints: ['stop_reason: end_turn → done'],
      narration:
        'The tempting shortcut is to look at whether any text came back and decide from that, which breaks on the first chatty response.',
    },
    check('q1'),
    check('q2'),
    { type: 'explain_back', prompt: 'say it back', modelAnswer: 'model', mustMention: ['x'] },
  ]);
  assert.deepEqual(problems, []);
});

test('an empty lesson is rejected', () => {
  assert.deepEqual(validateLessonStructure([]), [
    { code: 'empty', detail: 'lesson has no blocks' },
  ]);
});

test('isInteractive identifies blocks the learner must act on', () => {
  assert.equal(isInteractive(concept('x')), false);
  assert.equal(isInteractive(check('q')), true);
  assert.equal(
    isInteractive({ type: 'explain_back', prompt: 'p', modelAnswer: 'm', mustMention: [] }),
    true,
  );
  // A worked example with no faded step is just reading.
  assert.equal(
    isInteractive({ type: 'worked_example', goal: 'g', steps: [{ show: 's', explain: 'e' }] }),
    false,
  );
  assert.equal(
    isInteractive({
      type: 'worked_example',
      goal: 'g',
      steps: [{ show: 's', explain: 'e', faded: true }],
    }),
    true,
  );
});
