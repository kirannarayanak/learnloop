'use client';

/**
 * Learner state, held in the browser.
 *
 * This is not a shortcut — it is the architecture. The app is offline-first
 * (docs/02-architecture.md), so the client is the primary writer and the server
 * reconciles later. Attempts are append-only with an idempotency key, which is exactly
 * what makes that sync trivial (docs/03-data-model.md).
 *
 * The streak and points rules are imported from `engine/incentives` rather than
 * reimplemented, so the client and the server can never disagree about them. Those
 * functions are pure for this reason.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  recordActivity,
  MAX_FREEZES,
  type StreakState,
} from '@learnloop/engine/incentives/streak.ts';
import { award, awardStreakMilestones, type PointEvent } from '@learnloop/engine/incentives/points.ts';

const STORAGE_KEY = 'learnloop.learner.v1';

export interface SkillProgress {
  attempts: number;
  correct: number;
  /** Wave 0 stand-in for FSRS: 3 correct answers credits the skill. Replaced when the
   *  real scheduler lands — the point here is that mastery is EARNED, not clicked. */
  mastered: boolean;
}

export interface LearnerState {
  streak: StreakState;
  /** Append-only ledger, same shape as point_events. Balance is a sum. */
  pointEvents: PointEvent[];
  skills: Record<string, SkillProgress>;
  lessonsRead: string[];
  dailyGoalMin: number;
  /** Competition is a preference, not a default (docs/10-motivation.md finding 3). */
  rankingOptIn: boolean;
}

const MASTERY_THRESHOLD = 3;
const USER_ID = 'local';

function initial(): LearnerState {
  return {
    streak: {
      currentDays: 0,
      longestDays: 0,
      lastActiveDate: null,
      freezesAvailable: MAX_FREEZES,
      freezesUsed: 0,
    },
    pointEvents: [],
    skills: {},
    lessonsRead: [],
    dailyGoalMin: 15,
    rankingOptIn: false,
  };
}

/** The learner's local date — streaks must follow their day, not UTC. */
export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function load(): LearnerState {
  if (typeof window === 'undefined') return initial();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return initial();
    return { ...initial(), ...(JSON.parse(raw) as Partial<LearnerState>) };
  } catch {
    // A corrupt or blocked store must never break the lesson. Start fresh.
    return initial();
  }
}

function save(state: LearnerState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Private mode, blocked storage, quota. Progress is lost but the session works.
  }
}

export function pointsTotal(state: LearnerState): number {
  return state.pointEvents.reduce((sum, e) => sum + e.points, 0);
}

/** Dedupe on the ledger, so a replayed event never credits twice. */
function appendEvents(existing: PointEvent[], incoming: PointEvent[]): PointEvent[] {
  const seen = new Set(existing.map((e) => e.dedupeKey));
  return [...existing, ...incoming.filter((e) => !seen.has(e.dedupeKey))];
}

export function useLearner() {
  const [state, setState] = useState<LearnerState>(initial);
  const [loaded, setLoaded] = useState(false);

  // Read after mount: localStorage doesn't exist during SSR, and reading it in the
  // initializer would make the server and client markup disagree.
  useEffect(() => {
    setState(load());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) save(state);
  }, [state, loaded]);

  /** Any genuine activity extends the streak — never only hitting the daily goal. */
  const touchStreak = useCallback((prev: LearnerState): LearnerState => {
    const update = recordActivity(prev.streak, localToday());
    return {
      ...prev,
      streak: update.state,
      pointEvents: appendEvents(
        prev.pointEvents,
        awardStreakMilestones(USER_ID, update.milestonesReached),
      ),
    };
  }, []);

  const readLesson = useCallback(
    (lessonId: string) => {
      setState((prev) => {
        if (prev.lessonsRead.includes(lessonId)) return prev;
        const next = touchStreak(prev);
        return {
          ...next,
          lessonsRead: [...next.lessonsRead, lessonId],
          pointEvents: appendEvents(next.pointEvents, [
            award(USER_ID, 'lesson_completed', lessonId),
          ]),
        };
      });
    },
    [touchStreak],
  );

  /**
   * Record an attempt.
   *
   * Note what is NOT here: no points for being correct. Points come from doing the
   * work and from reaching mastery, never from accuracy — rewarding accuracy punishes
   * the struggling learner and drives avoidance of hard material
   * (docs/10-motivation.md finding 5).
   */
  const recordAttempt = useCallback(
    (skillId: string, correct: boolean) => {
      setState((prev) => {
        const withStreak = touchStreak(prev);
        const before = withStreak.skills[skillId] ?? { attempts: 0, correct: 0, mastered: false };
        const after: SkillProgress = {
          attempts: before.attempts + 1,
          correct: before.correct + (correct ? 1 : 0),
          mastered: before.mastered || before.correct + (correct ? 1 : 0) >= MASTERY_THRESHOLD,
        };

        const newlyMastered = after.mastered && !before.mastered;
        return {
          ...withStreak,
          skills: { ...withStreak.skills, [skillId]: after },
          pointEvents: appendEvents(
            withStreak.pointEvents,
            newlyMastered ? [award(USER_ID, 'skill_mastered', skillId, { skillId })] : [],
          ),
        };
      });
    },
    [touchStreak],
  );

  const setRankingOptIn = useCallback((on: boolean) => {
    setState((prev) => ({ ...prev, rankingOptIn: on }));
  }, []);

  const reset = useCallback(() => setState(initial()), []);

  return {
    state,
    loaded,
    points: pointsTotal(state),
    readLesson,
    recordAttempt,
    setRankingOptIn,
    reset,
    isMastered: (skillId: string) => state.skills[skillId]?.mastered ?? false,
    progressOf: (skillId: string) => state.skills[skillId],
  };
}
