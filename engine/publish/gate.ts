/**
 * The publish gate.
 *
 * Mirrors `publish_lesson()` in db/schema.sql. Both exist on purpose: the database
 * function is the backstop that no code path can bypass, and this is the check the
 * pipeline runs first so a failure is a job error with a readable reason rather than
 * a raised Postgres exception.
 *
 * If you change one, change the other, and update the tests. The rules come from
 * docs/07-risks.md and are the difference between a learner being taught something
 * false and not.
 */

export type RiskTier = 'low' | 'medium' | 'high';

export type VerifyState =
  | 'unverified'
  | 'auto_passed'
  | 'auto_failed'
  | 'human_approved'
  | 'disputed';

export interface LessonForPublish {
  lessonId: string;
  riskTier: RiskTier;
  verifyState: VerifyState;
  /** Source ids with a cited span. Empty means no provenance. */
  citedSourceIds: readonly string[];
  /** Sources whose licence is unknown (null in the DB). */
  unlicensedSourceIds: readonly string[];
}

export type Refusal =
  | { code: 'not_verified'; message: string }
  | { code: 'needs_human_approval'; message: string }
  | { code: 'no_citation'; message: string }
  | { code: 'unlicensed_source'; message: string };

export type GateDecision =
  | { publish: true; sampleForReview: boolean }
  | { publish: false; refusals: Refusal[] };

/**
 * Decide whether a lesson may be published. Returns every reason it may not, so the
 * repair pass gets the full picture in one round-trip.
 */
export function evaluatePublishGate(lesson: LessonForPublish): GateDecision {
  const refusals: Refusal[] = [];

  // Rule 1 — verification. `unverified`, `auto_failed` and `disputed` never publish.
  if (lesson.verifyState !== 'auto_passed' && lesson.verifyState !== 'human_approved') {
    refusals.push({
      code: 'not_verified',
      message:
        `lesson ${lesson.lessonId} is '${lesson.verifyState}'; only 'auto_passed' or ` +
        `'human_approved' may publish`,
    });
  }

  // Rule 2 — the risk gate. A high-risk domain cannot publish on auto-verification
  // alone, however confident the verifier was. This is the rule that exists because
  // wrong medicine or wrong exam content harms someone.
  if (lesson.riskTier === 'high' && lesson.verifyState !== 'human_approved') {
    refusals.push({
      code: 'needs_human_approval',
      message:
        `lesson ${lesson.lessonId} is in a high-risk domain and requires ` +
        `'human_approved' (is: '${lesson.verifyState}')`,
    });
  }

  // Rule 3 — provenance. No citation, no publish. An uncited claim is unverifiable
  // by construction, so the verification above would have been meaningless.
  if (lesson.citedSourceIds.length === 0) {
    refusals.push({
      code: 'no_citation',
      message: `lesson ${lesson.lessonId} cites no source span`,
    });
  }

  // Rule 4 — licensing. Unknown licence means we may cite and link, never reproduce.
  // This is a legal gate, not a quality one, so it blocks regardless of verification.
  if (lesson.unlicensedSourceIds.length > 0) {
    refusals.push({
      code: 'unlicensed_source',
      message:
        `lesson ${lesson.lessonId} reproduces source(s) with unknown licence: ` +
        `${lesson.unlicensedSourceIds.join(', ')}`,
    });
  }

  if (refusals.length > 0) return { publish: false, refusals };

  // Medium-risk content publishes, but is sampled into the human review queue.
  // Low-risk auto-publishes outright. See the risk-tier table in
  // docs/04-content-pipeline.md.
  return {
    publish: true,
    sampleForReview: lesson.riskTier === 'medium' && lesson.verifyState === 'auto_passed',
  };
}

/** Throwing wrapper for pipeline call sites that treat a refusal as a job failure. */
export class PublishRefusedError extends Error {
  // Explicit fields rather than TS parameter properties: Node's native type
  // stripping runs these files directly and cannot transform parameter properties.
  readonly lessonId: string;
  readonly refusals: readonly Refusal[];

  constructor(lessonId: string, refusals: readonly Refusal[]) {
    super(
      `refusing to publish lesson ${lessonId}: ` +
        refusals.map((r) => `[${r.code}] ${r.message}`).join('; '),
    );
    this.name = 'PublishRefusedError';
    this.lessonId = lessonId;
    this.refusals = refusals;
  }
}

export function assertPublishable(lesson: LessonForPublish): { sampleForReview: boolean } {
  const decision = evaluatePublishGate(lesson);
  if (!decision.publish) throw new PublishRefusedError(lesson.lessonId, decision.refusals);
  return { sampleForReview: decision.sampleForReview };
}
