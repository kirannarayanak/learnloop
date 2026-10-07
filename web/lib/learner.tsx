'use client';

/**
 * Learner state: one owner, offline-first, synced when signed in.
 *
 * Previously every component called `useLearner()` and got its own `useState`, so
 * answering a question in `Practice` did not update the points in `Header` until a
 * navigation. A single provider fixes that and is also the only sane place to own sync —
 * several components each flushing their own outbox would be a race.
 *
 * The model is unchanged and deliberate: **localStorage is the primary writer.** Every
 * action is recorded locally first and works offline; the server is a merge target, not
 * the source of truth for a keystroke. Attempts and point events are append-only with
 * idempotency keys, so flushing is a union and a replayed outbox cannot double-count
 * (docs/03-data-model.md).
 *
 * Streak, points and mastery are PROJECTIONS of those two logs
 * (engine/incentives/project.ts), computed with the same pure functions on both sides —
 * so the client shows the right number immediately and the server agrees when it replies.
 */

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import { MAX_FREEZES, type StreakState } from '@learnloop/engine/incentives/streak.ts';
import { award, awardStreakMilestones, type PointEvent } from '@learnloop/engine/incentives/points.ts';
import {
  MASTERY_THRESHOLD, projectMastery, projectPoints, projectStreak,
} from '@learnloop/engine/incentives/project.ts';
import type { SyncAttempt, SyncPointEvent } from '@learnloop/engine/store/types.ts';

const STORAGE_KEY = 'learnloop.learner.v2';

export interface LearnerLogs {
  /** Append-only. The idempotency key is what makes replay safe. */
  attempts: SyncAttempt[];
  pointEvents: SyncPointEvent[];
  lessonsRead: string[];
  dailyGoalMin: number;
  rankingOptIn: boolean;
  /** Keys the server has confirmed. Everything else is still outbound. */
  syncedClientIds: string[];
  syncedDedupeKeys: string[];
}

function empty(): LearnerLogs {
  return {
    attempts: [],
    pointEvents: [],
    lessonsRead: [],
    dailyGoalMin: 15,
    rankingOptIn: false,
    syncedClientIds: [],
    syncedDedupeKeys: [],
  };
}

export function localToday(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function load(): LearnerLogs {
  if (typeof window === 'undefined') return empty();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return empty();
    return { ...empty(), ...(JSON.parse(raw) as Partial<LearnerLogs>) };
  } catch {
    // Corrupt or blocked storage must never break the lesson.
    return empty();
  }
}

function save(logs: LearnerLogs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch {
    // Private mode, blocked storage, quota. Progress is lost; the session still works.
  }
}

export interface LearnerContextValue {
  loaded: boolean;
  points: number;
  streak: StreakState;
  isMastered: (skillId: string) => boolean;
  progressOf: (skillId: string) => { attempts: number; correct: number } | undefined;
  lessonsRead: string[];
  /** Items waiting to reach the server. Drives the "not synced yet" affordance. */
  pending: number;
  syncState: 'off' | 'idle' | 'syncing' | 'error';
  readLesson: (lessonId: string) => void;
  recordAttempt: (skillId: string, correct: boolean, exerciseId?: string) => void;
  reset: () => void;
}

const LearnerContext = createContext<LearnerContextValue | null>(null);

export function LearnerProvider({
  children,
  syncEnabled,
}: {
  children: React.ReactNode;
  /** False against the generated snapshot, whose ids have no rows behind them. */
  syncEnabled: boolean;
}) {
  const [logs, setLogs] = useState<LearnerLogs>(empty);
  const [loaded, setLoaded] = useState(false);
  const [syncState, setSyncState] = useState<LearnerContextValue['syncState']>('off');
  const flushing = useRef(false);

  // Read after mount: localStorage does not exist during SSR, and reading it in the
  // initialiser would make server and client markup disagree.
  useEffect(() => {
    setLogs(load());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) save(logs);
  }, [logs, loaded]);

  // Another tab is the same learner. Without this, two open tabs silently diverge and
  // whichever saves last wins.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setLogs(load());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const outbox = useMemo(() => {
    const syncedAttempts = new Set(logs.syncedClientIds);
    const syncedPoints = new Set(logs.syncedDedupeKeys);
    return {
      attempts: logs.attempts.filter((a) => !syncedAttempts.has(a.clientId)),
      pointEvents: logs.pointEvents.filter((p) => !syncedPoints.has(p.dedupeKey)),
    };
  }, [logs]);

  const flush = useCallback(async () => {
    if (!syncEnabled || flushing.current) return;
    flushing.current = true;
    setSyncState('syncing');

    try {
      const response = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          attempts: outbox.attempts,
          pointEvents: outbox.pointEvents,
          timeZone: timeZone(),
          today: localToday(),
        }),
      });

      if (response.status === 401 || response.status === 503) {
        // Signed out, or sync unavailable. Not an error — just keep working locally.
        setSyncState('off');
        return;
      }
      if (!response.ok) {
        setSyncState('error');
        return;
      }

      const state = (await response.json()) as {
        acceptedClientIds: string[];
        acceptedDedupeKeys: string[];
      };

      // Adopt what the server holds, which includes rows from OTHER devices. That is the
      // merge: the server's accepted set becomes this device's synced set.
      setLogs((prev) => ({
        ...prev,
        syncedClientIds: state.acceptedClientIds,
        syncedDedupeKeys: state.acceptedDedupeKeys,
      }));
      setSyncState('idle');
    } catch {
      // Offline. The outbox survives in localStorage and flushes on reconnect.
      setSyncState('error');
    } finally {
      flushing.current = false;
    }
  }, [syncEnabled, outbox]);

  // Flush on load, when the outbox grows, and when connectivity returns.
  useEffect(() => {
    if (!loaded || !syncEnabled) return;
    if (outbox.attempts.length === 0 && outbox.pointEvents.length === 0) return;
    const timer = setTimeout(() => void flush(), 1500);
    return () => clearTimeout(timer);
  }, [loaded, syncEnabled, outbox, flush]);

  useEffect(() => {
    if (!syncEnabled) return;
    const onOnline = () => void flush();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [syncEnabled, flush]);

  // --- projections, computed with the same pure functions the server uses
  const activity = useMemo(
    () => [...logs.attempts.map((a) => ({ at: a.at })), ...logs.pointEvents.map((p) => ({ at: p.at }))],
    [logs],
  );
  const streak = useMemo(
    () => projectStreak(activity, timeZone(), loaded ? localToday() : undefined),
    [activity, loaded],
  );
  const mastery = useMemo(() => projectMastery(
    logs.attempts.map((a) => ({ skillId: a.skillId, correct: a.correct, at: a.at })),
  ), [logs.attempts]);
  const points = useMemo(() => projectPoints(logs.pointEvents), [logs.pointEvents]);

  const appendPoints = useCallback((prev: LearnerLogs, incoming: PointEvent[], at: string): LearnerLogs => {
    const seen = new Set(prev.pointEvents.map((e) => e.dedupeKey));
    const fresh: SyncPointEvent[] = incoming
      .filter((e) => !seen.has(e.dedupeKey))
      .map((e) => ({
        dedupeKey: e.dedupeKey,
        kind: e.kind,
        points: e.points,
        ...(e.skillId !== undefined ? { skillId: e.skillId } : {}),
        at,
      }));
    return fresh.length === 0 ? prev : { ...prev, pointEvents: [...prev.pointEvents, ...fresh] };
  }, []);

  const readLesson = useCallback((lessonId: string) => {
    setLogs((prev) => {
      if (prev.lessonsRead.includes(lessonId)) return prev;
      const at = new Date().toISOString();
      const withRead = { ...prev, lessonsRead: [...prev.lessonsRead, lessonId] };
      const milestones = projectStreak(
        [...activity, { at }], timeZone(), localToday(),
      );
      const crossed = milestones.currentDays > streak.currentDays
        ? awardStreakMilestones('local', [milestones.currentDays].filter((d) => [3, 7, 14, 30, 60, 100, 182, 365].includes(d)))
        : [];
      return appendPoints(withRead, [award('local', 'lesson_completed', lessonId), ...crossed], at);
    });
  }, [activity, streak.currentDays, appendPoints]);

  /**
   * Record an attempt.
   *
   * Note what is NOT here: no points for being correct. Points come from doing the work
   * and from reaching mastery — rewarding accuracy punishes the struggling learner and
   * drives avoidance of hard material (docs/10-motivation.md finding 5).
   */
  const recordAttempt = useCallback((skillId: string, correct: boolean, exerciseId?: string) => {
    setLogs((prev) => {
      const at = new Date().toISOString();
      const clientId = `${skillId}:${prev.attempts.length}:${at}`;
      const attempts = [...prev.attempts, {
        clientId, skillId, exerciseId: exerciseId ?? null, correct, at,
      }];

      const before = prev.attempts.filter((a) => a.skillId === skillId && a.correct).length;
      const after = before + (correct ? 1 : 0);
      const newlyMastered = before < MASTERY_THRESHOLD && after >= MASTERY_THRESHOLD;

      return appendPoints(
        { ...prev, attempts },
        newlyMastered ? [award('local', 'skill_mastered', skillId, { skillId })] : [],
        at,
      );
    });
  }, [appendPoints]);

  const value: LearnerContextValue = {
    loaded,
    points,
    streak: loaded ? streak : { currentDays: 0, longestDays: 0, lastActiveDate: null, freezesAvailable: MAX_FREEZES, freezesUsed: 0 },
    isMastered: (skillId) => mastery.find((m) => m.skillId === skillId)?.mastered ?? false,
    progressOf: (skillId) => {
      const m = mastery.find((x) => x.skillId === skillId);
      return m === undefined ? undefined : { attempts: m.attempts, correct: m.correct };
    },
    lessonsRead: logs.lessonsRead,
    pending: outbox.attempts.length + outbox.pointEvents.length,
    syncState: syncEnabled ? syncState : 'off',
    readLesson,
    recordAttempt,
    reset: () => setLogs(empty()),
  };

  return <LearnerContext.Provider value={value}>{children}</LearnerContext.Provider>;
}

export function useLearner(): LearnerContextValue {
  const value = useContext(LearnerContext);
  if (value === null) {
    throw new Error('useLearner must be used inside <LearnerProvider>');
  }
  return value;
}
