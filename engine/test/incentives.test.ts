import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordActivity, MAX_FREEZES, type StreakState } from '../incentives/streak.ts';
import { POINT_VALUES, award, awardStreakMilestones } from '../incentives/points.ts';

function state(over: Partial<StreakState> = {}): StreakState {
  return {
    currentDays: 0,
    longestDays: 0,
    lastActiveDate: null,
    freezesAvailable: 0,
    freezesUsed: 0,
    ...over,
  };
}

test('first ever activity starts the streak at 1', () => {
  const r = recordActivity(state(), '2026-10-07');
  assert.equal(r.state.currentDays, 1);
  assert.equal(r.state.lastActiveDate, '2026-10-07');
});

test('same-day activity is idempotent — offline replay must not double-count', () => {
  const prev = state({ currentDays: 5, lastActiveDate: '2026-10-07' });
  const r = recordActivity(prev, '2026-10-07');
  assert.equal(r.state.currentDays, 5);
});

test('consecutive days extend the streak and track the longest', () => {
  let s = state({ currentDays: 2, longestDays: 9, lastActiveDate: '2026-10-06' });
  const r = recordActivity(s, '2026-10-07');
  assert.equal(r.state.currentDays, 3);
  assert.equal(r.state.longestDays, 9, 'longest must not regress');
});

test('a freeze is earned every 7 consecutive days, capped', () => {
  const r = recordActivity(
    state({ currentDays: 6, lastActiveDate: '2026-10-06', freezesAvailable: 0 }),
    '2026-10-07',
  );
  assert.equal(r.state.currentDays, 7);
  assert.equal(r.state.freezesAvailable, 1);

  const atCap = recordActivity(
    state({ currentDays: 13, lastActiveDate: '2026-10-06', freezesAvailable: MAX_FREEZES }),
    '2026-10-07',
  );
  assert.equal(atCap.state.freezesAvailable, MAX_FREEZES, 'freezes must not be hoarded');
});

// docs/10-motivation.md finding 4: freeze cut churn 21% for at-risk learners.
// It is applied automatically — the learner is never asked to spend it at the
// exact moment they are about to churn.
test('one missed day is bridged automatically when a freeze is available', () => {
  const r = recordActivity(
    state({ currentDays: 9, lastActiveDate: '2026-10-05', freezesAvailable: 1 }),
    '2026-10-07',
  );
  assert.equal(r.freezeApplied, true);
  assert.equal(r.broken, false);
  assert.equal(r.state.currentDays, 10);
  assert.equal(r.state.freezesAvailable, 0);
  assert.equal(r.state.freezesUsed, 1);
});

test('one missed day with no freeze breaks the streak but keeps longest', () => {
  const r = recordActivity(
    state({ currentDays: 9, longestDays: 9, lastActiveDate: '2026-10-05', freezesAvailable: 0 }),
    '2026-10-07',
  );
  assert.equal(r.broken, true);
  assert.equal(r.state.currentDays, 1, "today's activity still counts for something");
  assert.equal(r.state.longestDays, 9, 'a broken streak resets a counter and nothing else');
});

test('a long gap breaks the streak even with freezes banked', () => {
  const r = recordActivity(
    state({ currentDays: 30, lastActiveDate: '2026-09-01', freezesAvailable: MAX_FREEZES }),
    '2026-10-07',
  );
  assert.equal(r.broken, true);
  assert.equal(r.state.freezesAvailable, MAX_FREEZES, 'freezes are not burned on a lapse');
});

test('a backwards date (timezone change or clock skew) is not punished', () => {
  const prev = state({ currentDays: 4, lastActiveDate: '2026-10-07' });
  const r = recordActivity(prev, '2026-10-06');
  assert.equal(r.broken, false);
  assert.equal(r.state.currentDays, 4);
});

test('the 7-day milestone fires exactly once', () => {
  const r = recordActivity(state({ currentDays: 6, lastActiveDate: '2026-10-06' }), '2026-10-07');
  assert.deepEqual(r.milestonesReached, [7]);
  const again = recordActivity(
    state({ currentDays: 7, lastActiveDate: '2026-10-07' }),
    '2026-10-07',
  );
  assert.deepEqual(again.milestonesReached, []);
});

// docs/10-motivation.md finding 5. This test exists to fail loudly if anyone adds a
// correctness reward later.
test('no point kind rewards being correct', () => {
  for (const kind of Object.keys(POINT_VALUES)) {
    assert.ok(
      !/correct|right_answer|accuracy|score/i.test(kind),
      `'${kind}' looks like a correctness reward; points are for effort and consistency only`,
    );
  }
});

test('review is weighted above passive lesson reading', () => {
  assert.ok(POINT_VALUES.review_completed > POINT_VALUES.lesson_completed);
});

test('contribution is weighted highest — it is rare and human-verified', () => {
  assert.ok(POINT_VALUES.flag_accepted > POINT_VALUES.skill_mastered);
});

test('dedupe keys are deterministic, so replayed events never double-credit', () => {
  const a = award('u1', 'lesson_completed', 'L1');
  const b = award('u1', 'lesson_completed', 'L1');
  assert.equal(a.dedupeKey, b.dedupeKey);
  assert.notEqual(a.dedupeKey, award('u1', 'lesson_completed', 'L2').dedupeKey);
});

test('streak milestones produce one distinct event each', () => {
  const events = awardStreakMilestones('u1', [3, 7]);
  assert.equal(events.length, 2);
  assert.equal(new Set(events.map((e) => e.dedupeKey)).size, 2);
});
