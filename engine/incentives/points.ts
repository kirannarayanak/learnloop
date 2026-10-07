/**
 * Points.
 *
 * The one rule that matters (docs/10-motivation.md, finding 5): points reward EFFORT
 * and CONSISTENCY, never correctness. Rewarding correct answers punishes the learner
 * who is struggling — exactly the learner mastery learning helps most — and pushes
 * everyone toward material that is too easy for them.
 *
 * There is deliberately no 'correct_answer' kind. If someone adds one, this comment is
 * the reason to take it back out.
 *
 * Points are also never purchasable and never unlock content. Knowledge isn't paywalled
 * (docs/01-vision.md), so it can't be points-walled either.
 */

export type PointKind =
  | 'lesson_completed'
  | 'review_completed'
  | 'skill_mastered'
  | 'path_completed'
  | 'streak_milestone'
  | 'flag_accepted'
  | 'translation_accepted';

/**
 * Showing up for scheduled review is the single behaviour most predictive of actually
 * learning, so it is weighted above passively reading a lesson. Contribution — finding
 * a real content error, fixing a translation — is weighted highest of all, because it
 * is rare, it is verified by a human, and it makes the platform better for everyone.
 */
export const POINT_VALUES: Record<PointKind, number> = {
  lesson_completed: 10,
  review_completed: 15,
  skill_mastered: 50,
  path_completed: 200,
  streak_milestone: 25,
  flag_accepted: 100,
  translation_accepted: 75,
};

export interface PointEvent {
  userId: string;
  kind: PointKind;
  points: number;
  skillId?: string;
  pathId?: string;
  /** Idempotency key. Same underlying event must never be credited twice, including
   *  when an offline client replays its queue. Maps to point_events.dedupe_key. */
  dedupeKey: string;
}

/**
 * Build the dedupe key. Deterministic from the event's identity, never from a
 * timestamp — a timestamp would let a replayed offline queue double-credit.
 */
export function dedupeKey(kind: PointKind, subjectId: string, qualifier?: string): string {
  return qualifier ? `${kind}:${subjectId}:${qualifier}` : `${kind}:${subjectId}`;
}

export function award(
  userId: string,
  kind: PointKind,
  subjectId: string,
  opts: { skillId?: string; pathId?: string; qualifier?: string } = {},
): PointEvent {
  const event: PointEvent = {
    userId,
    kind,
    points: POINT_VALUES[kind],
    dedupeKey: dedupeKey(kind, subjectId, opts.qualifier),
  };
  // exactOptionalPropertyTypes is on, so only set these when actually present.
  if (opts.skillId !== undefined) event.skillId = opts.skillId;
  if (opts.pathId !== undefined) event.pathId = opts.pathId;
  return event;
}

/** Points for streak milestones, one event per milestone crossed. */
export function awardStreakMilestones(userId: string, milestones: readonly number[]): PointEvent[] {
  return milestones.map((days) =>
    award(userId, 'streak_milestone', String(days), { qualifier: 'days' }),
  );
}
