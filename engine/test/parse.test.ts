import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDraft, BlockParseError } from '../stages/parse.ts';
import { validateLessonStructure } from '../stages/blocks.ts';
import { goldenLessonBlocks, goldenCitations } from '../fixtures/golden-lesson.ts';

const CITATIONS = [{ quote: 'a supporting span from the source' }];

function draft(blocks: unknown[], over: Record<string, unknown> = {}) {
  return { title: 'T', estMinutes: 8, citations: CITATIONS, blocks, ...over };
}

const okCheck = {
  type: 'check',
  question: 'q?',
  options: ['a', 'b', 'c'],
  correctIndex: 1,
  explanation: 'because',
};
const okExplainBack = {
  type: 'explain_back',
  prompt: 'say it back',
  modelAnswer: 'one way to put it',
  mustMention: ['x'],
};

// The golden lesson is what the generator is aimed at, so it must survive the parser
// that generated output goes through. If it doesn't, the target and the gate disagree.
test('the golden lesson round-trips through the parser unchanged in shape', () => {
  const parsed = parseDraft(draft(goldenLessonBlocks as unknown[], { citations: goldenCitations }));
  assert.deepEqual(
    parsed.blocks.map((b) => b.type),
    goldenLessonBlocks.map((b) => b.type),
  );
  assert.deepEqual(validateLessonStructure(parsed.blocks), []);
});

test('a lesson with no citations is rejected before a verification call is spent', () => {
  assert.throws(
    () => parseDraft(draft([okCheck, okCheck, okExplainBack], { citations: [] })),
    (e: unknown) => e instanceof BlockParseError && e.problems.some((p) => p.includes('no citations')),
  );
});

test('every problem is reported at once, so repair needs one round-trip', () => {
  try {
    parseDraft(draft([{ type: 'check' }, { type: 'concept' }, { type: 'nonsense' }]));
    assert.fail('expected a parse error');
  } catch (e) {
    assert.ok(e instanceof BlockParseError);
    assert.equal(e.problems.length, 3);
    assert.ok(e.problems.some((p) => p.includes("unknown block type 'nonsense'")));
  }
});

test('an out-of-range correctIndex is clamped rather than discarding the block', () => {
  const parsed = parseDraft(
    draft([{ ...okCheck, correctIndex: 99 }, okCheck, okExplainBack]),
  );
  const first = parsed.blocks[0];
  assert.equal(first?.type, 'check');
  // An off-by-one is not worth throwing away an otherwise good question for.
  assert.equal(first.type === 'check' ? first.correctIndex : -1, 2);
});

test('a faded worked-example step with no options is demoted, not rendered as a dead end', () => {
  const parsed = parseDraft(
    draft([
      {
        type: 'worked_example',
        goal: 'g',
        steps: [
          { show: 'one', explain: 'e1' },
          { show: 'two', explain: 'e2', faded: true },
        ],
      },
      okCheck,
      okCheck,
    ]),
  );
  const block = parsed.blocks[0];
  assert.equal(block?.type, 'worked_example');
  if (block.type === 'worked_example') {
    // Still a step, just no longer asking the learner to pick from nothing.
    assert.equal(block.steps[1]?.faded, undefined);
  }
});

test('a diagram edge pointing at a missing node is rejected, not drawn into empty space', () => {
  try {
    parseDraft(
      draft([
        {
          type: 'diagram',
          caption: 'c',
          nodes: [{ id: 'a', label: 'A', x: 10, y: 50 }],
          edges: [{ from: 'a', to: 'ghost' }],
          steps: [{ label: 'step', highlight: ['a'], narration: 'n' }],
        },
        okCheck,
        okCheck,
      ]),
    );
    assert.fail('expected a parse error');
  } catch (e) {
    assert.ok(e instanceof BlockParseError);
    assert.ok(e.problems.some((p) => p.includes('references a node that does not exist')));
  }
});

test('diagram coordinates outside the authoring grid are clamped, not rendered off-canvas', () => {
  const parsed = parseDraft(
    draft([
      {
        type: 'diagram',
        caption: 'c',
        nodes: [
          { id: 'a', label: 'A', x: -40, y: 500 },
          { id: 'b', label: 'B', x: 50, y: 50 },
        ],
        edges: [{ from: 'a', to: 'b' }],
        steps: [{ label: 's', highlight: ['a'], narration: 'n' }],
      },
      okCheck,
      okCheck,
    ]),
  );
  const block = parsed.blocks[0];
  if (block?.type === 'diagram') {
    assert.equal(block.nodes[0]?.x, 0);
    assert.equal(block.nodes[0]?.y, 100);
  } else {
    assert.fail('expected a diagram block');
  }
});

test('a non-object response fails cleanly rather than throwing a type error', () => {
  assert.throws(() => parseDraft('not json'), BlockParseError);
  assert.throws(() => parseDraft(null), BlockParseError);
});

test('errors name the block and its type, so a repair pass can act on them', () => {
  try {
    parseDraft(draft([okCheck, okCheck, { type: 'check', question: 'q?' }]));
    assert.fail('expected a parse error');
  } catch (e) {
    assert.ok(e instanceof BlockParseError);
    const problem = e.problems[0] ?? '';
    assert.ok(problem.includes('block 2'), `expected the index: ${problem}`);
    assert.ok(problem.includes('check'), `expected the type: ${problem}`);
  }
});
