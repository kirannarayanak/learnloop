/**
 * Projections: derive learner state from the append-only logs.
 *
 * This is what makes multi-device sync tractable. Streak, points and mastery are NOT
 * stored state that two devices could disagree about — they are functions of `attempts`
 * and `point_events`, both of which are append-only with an idempotency key
 * (docs/03-data-model.md). Two devices merge by union, and the projection of a union is
 * the same whichever order the rows arrived in.
 *
 * The alternative — syncing a streak counter — needs a conflict resolution policy, and
 * every policy is wrong sometimes: last-write-wins loses a day, max() rewards clock
 * skew, and summing is nonsense. Deriving avoids the question.
 *
 * Everything here is pure, so the client can compute the same answer the server will and
 * show it immediately instead of waiting for a round trip.
 */

import { recordActivity, type StreakState } from './streak.ts';
import { MAX_FREEZES } from './streak.ts';

export interface ActivityRecord {
  /** ISO instant. */
  at: string;
}

export interface AttemptRecord {
  skillId: string;
  correct: boolean;
  at: string;
}

/** Wave 0 stand-in for FSRS: three correct answers credits a skill. */
export const MASTERY_THRESHOLD = 3;

/**
 * The learner's local date for an instant.
 *
 * Streaks follow the learner's day, not UTC. Someone studying at 11pm in Mumbai has not
 * skipped a day because it is already tomorrow in London — and getting this wrong breaks
 * the streak of exactly the learners furthest from UTC, which for this product is most of
 * them.
 */
export function localDate(instant: string, timeZone: string): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error(`invalid instant: ${instant}`);
  try {
    // en-CA formats as YYYY-MM-DD, which is the shape the streak logic expects.
    return new Intl.DateTimeFormat('en-CA', { timeZone }).format(date);
  } catch {
    // An unknown timezone must not lose someone's streak; fall back to UTC.
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Replay the streak over every distinct day the learner was active.
 *
 * Deterministic: the same set of activity dates always yields the same streak, freezes
 * included. That is what makes it safe to recompute on every sync rather than storing a
 * counter and hoping two devices agree.
 */
export function projectStreak(
  activity: readonly ActivityRecord[],
  timeZone: string,
  today?: string,
): StreakState {
  const days = [...new Set(activity.map((a) => localDate(a.at, timeZone)))].sort();

  let state: StreakState = {
    currentDays: 0,
    longestDays: 0,
    lastActiveDate: null,
    freezesAvailable: MAX_FREEZES,
    freezesUsed: 0,
  };

  for (const day of days) {
    state = recordActivity(state, day).state;
  }

  // A streak that ended days ago should read as ended, not as whatever it was when they
  // last studied. Replaying "today" with no activity is how that surfaces.
  if (today !== undefined && state.lastActiveDate !== null && today > state.lastActiveDate) {
    const peek = recordActivity(state, today);
    if (peek.broken) {
      return { ...state, currentDays: 0, longestDays: Math.max(state.longestDays, state.currentDays) };
    }
  }

  return state;
}

export interface SkillMastery {
  skillId: string;
  attempts: number;
  correct: number;
  mastered: boolean;
}

/** Mastery per skill, from the attempt log. */
export function projectMastery(attempts: readonly AttemptRecord[]): SkillMastery[] {
  const bySkill = new Map<string, { attempts: number; correct: number }>();

  for (const a of attempts) {
    const current = bySkill.get(a.skillId) ?? { attempts: 0, correct: 0 };
    bySkill.set(a.skillId, {
      attempts: current.attempts + 1,
      correct: current.correct + (a.correct ? 1 : 0),
    });
  }

  return [...bySkill.entries()]
    .map(([skillId, counts]) => ({
      skillId,
      ...counts,
      mastered: counts.correct >= MASTERY_THRESHOLD,
    }))
    // Deterministic order, so a projection can be compared across devices in a test.
    .sort((a, b) => a.skillId.localeCompare(b.skillId));
}

/** Points are a sum of an append-only ledger, so merging is union then add. */
export function projectPoints(events: readonly { points: number }[]): number {
  return events.reduce((sum, e) => sum + e.points, 0);
}
