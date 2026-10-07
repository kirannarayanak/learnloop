/**
 * Streak logic.
 *
 * Every rule here is lifted from measured results in docs/10-motivation.md (finding 4):
 *   - Streak freeze beat a gem bonus 2:1, and cut churn 21% for at-risk learners.
 *   - Reaching 7 days makes a learner 2.4x more likely to return the next day.
 *   - Counting ANY activity rather than only goal completion raised 7-day-plus
 *     streaks by 40%.
 *
 * Two things this module must never do, however convenient it looks later:
 *   - Require the daily GOAL to be met. Any genuine activity counts.
 *   - Sell freezes. They are earned and auto-applied. Monetising a motivation
 *     mechanic corrupts it, and the evidence says protection beats reward anyway.
 */

export interface StreakState {
  currentDays: number;
  longestDays: number;
  /** ISO date (YYYY-MM-DD) in the LEARNER's timezone, not UTC. */
  lastActiveDate: string | null;
  freezesAvailable: number;
  freezesUsed: number;
}

export interface StreakUpdate {
  state: StreakState;
  /** Day counts that just became true, for awarding points once. */
  milestonesReached: number[];
  /** A freeze was spent to bridge a missed day. */
  freezeApplied: boolean;
  /** The streak lapsed. Resets a counter and nothing else — never mastery or points. */
  broken: boolean;
}

/** Milestones worth marking. 7 is the one the evidence singles out. */
export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 182, 365] as const;

/** One freeze earned per 7 consecutive days, capped so they can't be hoarded. */
export const MAX_FREEZES = 2;
const FREEZE_EARNED_EVERY = 7;

function daysBetween(fromIso: string, toIso: string): number {
  const MS_PER_DAY = 86_400_000;
  const from = Date.parse(`${fromIso}T00:00:00Z`);
  const to = Date.parse(`${toIso}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    throw new Error(`invalid ISO date in streak calculation: ${fromIso} -> ${toIso}`);
  }
  return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Record activity on `today` (the learner's local date) and return the new state.
 *
 * Pure, so it is testable without a clock or a database, and so an offline client can
 * compute the same answer the server will.
 */
export function recordActivity(prev: StreakState, today: string): StreakUpdate {
  if (prev.lastActiveDate === null) {
    return milestones(prev, { ...prev, currentDays: 1, longestDays: Math.max(1, prev.longestDays), lastActiveDate: today }, false, false);
  }

  const gap = daysBetween(prev.lastActiveDate, today);

  // Same day: already counted. Idempotent, which matters because offline clients
  // replay their queue.
  if (gap === 0) {
    return { state: prev, milestonesReached: [], freezeApplied: false, broken: false };
  }

  // A clock skew or a timezone change moved the date backwards. Don't punish it.
  if (gap < 0) {
    return { state: prev, milestonesReached: [], freezeApplied: false, broken: false };
  }

  // Consecutive day: extend.
  if (gap === 1) {
    const currentDays = prev.currentDays + 1;
    const earnedFreeze =
      currentDays % FREEZE_EARNED_EVERY === 0 && prev.freezesAvailable < MAX_FREEZES;
    return milestones(
      prev,
      {
        ...prev,
        currentDays,
        longestDays: Math.max(currentDays, prev.longestDays),
        lastActiveDate: today,
        freezesAvailable: prev.freezesAvailable + (earnedFreeze ? 1 : 0),
      },
      false,
      false,
    );
  }

  // Exactly one day missed, and a freeze is available: bridge it automatically.
  // The learner is told afterwards; they are never asked to spend it in the moment,
  // because the moment they'd be asked is the moment they're about to churn.
  if (gap === 2 && prev.freezesAvailable > 0) {
    const currentDays = prev.currentDays + 1;
    return milestones(
      prev,
      {
        ...prev,
        currentDays,
        longestDays: Math.max(currentDays, prev.longestDays),
        lastActiveDate: today,
        freezesAvailable: prev.freezesAvailable - 1,
        freezesUsed: prev.freezesUsed + 1,
      },
      true,
      false,
    );
  }

  // Lapsed. Reset the counter, keep `longestDays`, keep everything else. Starting
  // again at 1 rather than 0 means today's activity still counted for something.
  return {
    state: {
      ...prev,
      currentDays: 1,
      longestDays: Math.max(prev.longestDays, prev.currentDays),
      lastActiveDate: today,
    },
    milestonesReached: [],
    freezeApplied: false,
    broken: true,
  };
}

function milestones(
  prev: StreakState,
  next: StreakState,
  freezeApplied: boolean,
  broken: boolean,
): StreakUpdate {
  const reached = STREAK_MILESTONES.filter(
    (m) => next.currentDays >= m && prev.currentDays < m,
  );
  return { state: next, milestonesReached: [...reached], freezeApplied, broken };
}
