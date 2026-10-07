import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluatePublishGate,
  assertPublishable,
  PublishRefusedError,
  type LessonForPublish,
} from '../publish/gate.ts';

function lesson(over: Partial<LessonForPublish> = {}): LessonForPublish {
  return {
    lessonId: 'L1',
    riskTier: 'low',
    verifyState: 'auto_passed',
    citedSourceIds: ['S1'],
    unlicensedSourceIds: [],
    ...over,
  };
}

test('low risk + auto_passed publishes without review', () => {
  const d = evaluatePublishGate(lesson());
  assert.equal(d.publish, true);
  assert.equal(d.sampleForReview, false);
});

test('medium risk + auto_passed publishes but is sampled for review', () => {
  const d = evaluatePublishGate(lesson({ riskTier: 'medium' }));
  assert.equal(d.publish, true);
  assert.equal(d.sampleForReview, true);
});

// This is THE test. docs/07-risks.md and CLAUDE.md both make it non-negotiable.
test('HIGH risk + auto_passed is REFUSED — human approval required', () => {
  const d = evaluatePublishGate(lesson({ riskTier: 'high' }));
  assert.equal(d.publish, false);
  assert.ok(d.refusals.some((r) => r.code === 'needs_human_approval'));
});

test('high risk + human_approved publishes', () => {
  const d = evaluatePublishGate(lesson({ riskTier: 'high', verifyState: 'human_approved' }));
  assert.equal(d.publish, true);
});

test('no state other than auto_passed or human_approved may publish', () => {
  for (const state of ['unverified', 'auto_failed', 'disputed'] as const) {
    const d = evaluatePublishGate(lesson({ verifyState: state }));
    assert.equal(d.publish, false, `${state} must not publish`);
    assert.ok(d.refusals.some((r) => r.code === 'not_verified'));
  }
});

test('an uncited lesson is refused however well it verified', () => {
  const d = evaluatePublishGate(lesson({ verifyState: 'human_approved', citedSourceIds: [] }));
  assert.equal(d.publish, false);
  assert.ok(d.refusals.some((r) => r.code === 'no_citation'));
});

test('an unlicensed source blocks publication regardless of verification', () => {
  const d = evaluatePublishGate(
    lesson({ verifyState: 'human_approved', unlicensedSourceIds: ['S9'] }),
  );
  assert.equal(d.publish, false);
  assert.ok(d.refusals.some((r) => r.code === 'unlicensed_source'));
});

test('all refusals are reported at once, so repair needs one round-trip', () => {
  const d = evaluatePublishGate(
    lesson({ riskTier: 'high', verifyState: 'unverified', citedSourceIds: [], unlicensedSourceIds: ['S9'] }),
  );
  assert.equal(d.publish, false);
  assert.equal(d.refusals.length, 4);
});

test('assertPublishable throws PublishRefusedError on a high-risk auto_passed lesson', () => {
  assert.throws(
    () => assertPublishable(lesson({ riskTier: 'high' })),
    (e: unknown) => e instanceof PublishRefusedError && e.lessonId === 'L1',
  );
});
