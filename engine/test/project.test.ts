import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  localDate, projectMastery, projectPoints, projectStreak,
  type ActivityRecord, type AttemptRecord,
} from '../incentives/project.ts';
import { MAX_FREEZES } from '../incentives/streak.ts';

const IST = 'Asia/Kolkata';

function activity(...instants: string[]): ActivityRecord[] {
  return instants.map((at) => ({ at }));
}

// The whole reason projections exist: the result must not depend on arrival order, or
// two devices syncing could disagree about the same history.
test('a projection is order-independent — this is what makes sync conflict-free', () => {
  const days = activity(
    '2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z', '2026-10-03T09:00:00Z',
  );
  const forwards = projectStreak(days, 'UTC');
  const backwards = projectStreak([...days].reverse(), 'UTC');
  const shuffled = projectStreak([days[1]!, days[2]!, days[0]!], 'UTC');

  assert.deepEqual(forwards, backwards);
  assert.deepEqual(forwards, shuffled);
  assert.equal(forwards.currentDays, 3);
});

test('duplicate activity on one day counts once', () => {
  const state = projectStreak(
    activity('2026-10-01T06:00:00Z', '2026-10-01T18:00:00Z', '2026-10-01T23:00:00Z'),
    'UTC',
  );
  assert.equal(state.currentDays, 1);
});

// Streaks follow the learner's day, not UTC. Getting this wrong breaks the streak of
// exactly the learners furthest from UTC, which for this product is most of them.
test('a late-night session in Mumbai is one day, not two', () => {
  // 23:30 IST on the 1st and 00:30 IST on the 2nd are consecutive LOCAL days...
  const state = projectStreak(
    activity('2026-10-01T18:00:00Z', '2026-10-01T19:00:00Z'),
    IST,
  );
  // ...but both of these instants are the same local day (23:30 and 00:30 IST).
  assert.equal(localDate('2026-10-01T18:00:00Z', IST), '2026-10-01');
  assert.equal(localDate('2026-10-01T19:00:00Z', IST), '2026-10-02');
  assert.equal(state.currentDays, 2, 'two local days in IST, one UTC day');

  assert.equal(projectStreak(activity('2026-10-01T18:00:00Z', '2026-10-01T19:00:00Z'), 'UTC').currentDays, 1);
});

test('an unknown timezone falls back to UTC rather than losing the streak', () => {
  assert.equal(localDate('2026-10-01T18:00:00Z', 'Mars/Olympus'), '2026-10-01');
});

test('a gap is bridged by a freeze, exactly as the live logic does', () => {
  // 1st, 2nd, (missed 3rd), 4th — one freeze covers it.
  const state = projectStreak(
    activity('2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z', '2026-10-04T09:00:00Z'),
    'UTC',
  );
  assert.equal(state.currentDays, 3);
  assert.equal(state.freezesUsed, 1);
  assert.equal(state.freezesAvailable, MAX_FREEZES - 1);
});

test('a long gap breaks the streak but keeps the personal best', () => {
  const state = projectStreak(
    activity(
      '2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z', '2026-10-03T09:00:00Z',
      '2026-11-01T09:00:00Z',
    ),
    'UTC',
  );
  assert.equal(state.currentDays, 1, 'restarted');
  assert.equal(state.longestDays, 3, 'a broken streak resets a counter and nothing else');
});

// A streak that ended last week should read as ended, not as whatever it was the last
// time they studied.
test('a streak that has already lapsed reads as zero today', () => {
  const state = projectStreak(
    activity('2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z'),
    'UTC',
    '2026-10-20',
  );
  assert.equal(state.currentDays, 0);
  assert.equal(state.longestDays, 2);
});

test('a streak still alive today is not reset by the lapse check', () => {
  const state = projectStreak(
    activity('2026-10-01T09:00:00Z', '2026-10-02T09:00:00Z'),
    'UTC',
    '2026-10-03',
  );
  assert.equal(state.currentDays, 2, 'today is still reachable, so nothing lapsed');
});

test('no activity projects to an empty streak rather than throwing', () => {
  const state = projectStreak([], 'UTC');
  assert.equal(state.currentDays, 0);
  assert.equal(state.lastActiveDate, null);
});

// --- mastery

test('mastery derives from the attempt log and is order-independent', () => {
  const attempts: AttemptRecord[] = [
    { skillId: 's1', correct: true, at: '2026-10-01T09:00:00Z' },
    { skillId: 's1', correct: false, at: '2026-10-01T09:01:00Z' },
    { skillId: 's1', correct: true, at: '2026-10-02T09:00:00Z' },
    { skillId: 's1', correct: true, at: '2026-10-03T09:00:00Z' },
    { skillId: 's2', correct: true, at: '2026-10-03T09:05:00Z' },
  ];

  const forwards = projectMastery(attempts);
  const backwards = projectMastery([...attempts].reverse());
  assert.deepEqual(forwards, backwards);

  const s1 = forwards.find((m) => m.skillId === 's1');
  assert.equal(s1?.attempts, 4);
  assert.equal(s1?.correct, 3);
  assert.equal(s1?.mastered, true, 'three correct credits the skill');

  const s2 = forwards.find((m) => m.skillId === 's2');
  assert.equal(s2?.mastered, false, 'one correct is not mastery');
});

test('wrong answers never un-master a skill', () => {
  const mastered = projectMastery([
    { skillId: 's', correct: true, at: '2026-10-01T09:00:00Z' },
    { skillId: 's', correct: true, at: '2026-10-01T09:01:00Z' },
    { skillId: 's', correct: true, at: '2026-10-01T09:02:00Z' },
    { skillId: 's', correct: false, at: '2026-10-02T09:00:00Z' },
    { skillId: 's', correct: false, at: '2026-10-02T09:01:00Z' },
  ]);
  // Credit is earned, not rented. Review scheduling is what handles forgetting.
  assert.equal(mastered[0]?.mastered, true);
});

test('points are a sum, so merging two devices is union then add', () => {
  const deviceA = [{ points: 10 }, { points: 50 }];
  const deviceB = [{ points: 15 }];
  assert.equal(projectPoints([...deviceA, ...deviceB]), 75);
  assert.equal(projectPoints([...deviceB, ...deviceA]), 75);
  assert.equal(projectPoints([]), 0);
});
