/**
 * The contracts between pipeline stages — and the shapes each model call must return.
 *
 * Bumping PROMPT_VERSION invalidates every cached generation that used the old prompts.
 * That is the intended way to roll out a prompt change: bump, let the cache miss,
 * regenerate. Never edit a prompt without bumping, or you get a silent mix of outputs
 * from two different prompts in the same path.
 */

import type { LessonBlock } from './blocks.ts';

/** v3: real prompts; review items derive from the lesson's own retrieval blocks. */
export const PROMPT_VERSION = 'v3';

export interface NormalizedSource {
  markdown: string;
  title: string;
  /** null = unknown licence. Blocks reproduction; see docs/07-risks.md. */
  license: string | null;
  contentHash: string;
}

/** Edges reference skill SLUGS here; the stage resolves them to ids after insert. */
export interface GraphOutput {
  pathTitle: string;
  pathSummary: string;
  skills: {
    slug: string;
    title: string;
    /** Must be an observable "can do X". Enforced by assertSkillStatements(). */
    statement: string;
    estMinutes: number;
  }[];
  edges: { prereqSlug: string; skillSlug: string; strength: number }[];
}

export interface DraftOutput {
  title: string;
  /** Plain-text fallback. The real lesson is `blocks`. */
  bodyMd: string;
  /** The lesson proper. Structure is validated before publish — see blocks.ts. */
  blocks: LessonBlock[];
  estMinutes: number;
  /** Spans from the source that the lesson's claims rest on. Empty means cannot publish. */
  citations: { quote: string }[];
}

export interface VerifyOutput {
  /** Is every factual claim supported by a cited span? */
  claimsSupported: boolean;
  /** Is the marked answer right and are the distractors actually wrong? */
  answersCorrect: boolean;
  /** Does the lesson teach the skill its statement claims? */
  teachesSkill: boolean;
  issues: string[];
}

/**
 * A skill must be phrased as something a learner can be observed doing, because the
 * exercise generator and the mastery model both key off it. "Understand recursion" is
 * not testable; "trace a recursive call to its base case" is.
 */
const VAGUE_OPENERS = /^(understand|know|learn|be aware|appreciate|familiar)/i;

export function assertSkillStatements(skills: readonly GraphOutput['skills'][number][]): void {
  const bad = skills.filter((s) => VAGUE_OPENERS.test(s.statement.trim()));
  if (bad.length > 0) {
    throw new Error(
      `skill statements must be observable "can do X", not vague: ` +
        bad.map((s) => `${s.slug} ("${s.statement}")`).join('; '),
    );
  }
}
