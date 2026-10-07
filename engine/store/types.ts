/**
 * The persistence boundary.
 *
 * The pipeline talks to this interface, never to Postgres directly. Two reasons:
 * the whole pipeline is testable against an in-memory store with no database, and
 * the SQL stays in one place where the RLS and gate rules can be audited.
 *
 * Field names mirror db/schema.sql. When they diverge, the schema wins.
 */

import type { RiskTier, VerifyState } from '../publish/gate.ts';
import type { LessonBlock } from '../stages/blocks.ts';

export type { RiskTier, VerifyState };

export type SourceKind = 'url' | 'pdf' | 'repo' | 'video' | 'paper' | 'syllabus' | 'manual';

export interface SourceRecord {
  id: string;
  kind: SourceKind;
  uri: string | null;
  title: string | null;
  /** null means unknown — blocks reproduction. See docs/07-risks.md. */
  license: string | null;
  contentHash: string;
  retrievedAt: string;
}

export interface SkillRecord {
  id: string;
  domainId: string;
  slug: string;
  title: string;
  /** Observable "can do X". If you can't write a question for it, it isn't a skill. */
  statement: string;
  estMinutes: number;
}

export interface LessonRecord {
  id: string;
  skillId: string;
  locale: string;
  title: string;
  bodyMd: string;
  /** The structured lesson. See engine/stages/blocks.ts. */
  blocks: LessonBlock[];
  estMinutes: number;
  genModel: string;
  genCostUsd: number;
  verifyState: VerifyState;
  /** Which generator produced it. Part of the reuse key: a prompt bump means regenerate. */
  promptVersion: string;
}

export type ExerciseKind = 'mcq' | 'multi' | 'cloze' | 'short' | 'code' | 'numeric' | 'order';

export interface ExerciseRecord {
  id: string;
  skillId: string;
  lessonId: string;
  locale: string;
  kind: ExerciseKind;
  promptMd: string;
  answer: unknown;
  /** Shown whether the learner was right or wrong — the explanation IS the teaching. */
  explanationMd: string;
  difficulty: number;
  verifyState: VerifyState;
}

/** A cited span. No citation, no publish. */
export interface CitationRecord {
  lessonId: string;
  sourceId: string;
  quote: string;
}

export interface PathRecord {
  id: string;
  domainId: string;
  slug: string;
  title: string;
  summary: string;
  locale: string;
  status: 'draft' | 'in_review' | 'published' | 'deprecated';
  promptVersion: string;
  /** Skill ids in topological order. */
  itemSkillIds: string[];
  publishedAt: string | null;
}

export interface DomainRecord {
  id: string;
  slug: string;
  title: string;
  riskTier: RiskTier;
}

export interface CacheRecord {
  cacheKey: string;
  model: string;
  output: unknown;
  costUsd: number;
  hits: number;
}

export type JobKind = 'ingest' | 'graph' | 'lesson' | 'exercise' | 'verify' | 'translate' | 'bundle';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export interface JobRecord {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  priority: number;
  costUsd: number;
  error: string | null;
  /** Lease expiry. A crashed worker's job self-releases. */
  lockedUntil: string | null;
}

export interface ReviewQueueItem {
  entity: 'lesson' | 'exercise' | 'path';
  entityId: string;
  reason: 'high_risk' | 'sampled' | 'auto_failed' | 'flagged';
  createdAt: string;
}

export interface Store {
  // --- domains
  getDomainBySlug(slug: string): Promise<DomainRecord | undefined>;
  getDomain(id: string): Promise<DomainRecord | undefined>;

  // --- sources
  upsertSource(s: Omit<SourceRecord, 'id'>): Promise<SourceRecord>;
  findSourceByHash(contentHash: string): Promise<SourceRecord | undefined>;

  // --- skills
  insertSkills(skills: Omit<SkillRecord, 'id'>[]): Promise<SkillRecord[]>;
  /** Near-duplicate detection via embedding cosine. Returns an existing skill to reuse. */
  findSimilarSkill(domainId: string, statement: string): Promise<SkillRecord | undefined>;
  insertEdges(edges: { prereqId: string; skillId: string; strength: number }[]): Promise<void>;

  // --- content
  insertLesson(l: Omit<LessonRecord, 'id'>): Promise<LessonRecord>;
  /** Reuse key, so re-running on an unchanged source is idempotent rather than
   *  duplicating every lesson. The freshness cron depends on this. */
  findLesson(
    skillId: string, locale: string, promptVersion: string,
  ): Promise<LessonRecord | undefined>;
  updateLessonVerifyState(lessonId: string, state: VerifyState): Promise<void>;
  insertExercises(ex: Omit<ExerciseRecord, 'id'>[]): Promise<ExerciseRecord[]>;
  insertCitations(c: CitationRecord[]): Promise<void>;
  getCitations(lessonId: string): Promise<CitationRecord[]>;

  // --- paths
  insertPath(p: Omit<PathRecord, 'id'>): Promise<PathRecord>;
  /** paths.slug is unique, so a re-run must reuse the row rather than conflict. */
  findPathBySlug(slug: string): Promise<PathRecord | undefined>;
  publishPath(pathId: string, at: string): Promise<void>;
  getPath(pathId: string): Promise<PathRecord | undefined>;
  listPublishedPaths(): Promise<PathRecord[]>;
  getLessonsForPath(pathId: string): Promise<LessonRecord[]>;
  getExercisesForLesson(lessonId: string): Promise<ExerciseRecord[]>;

  // --- generation cache (the cost killer: docs/05-economics.md)
  getCached(cacheKey: string): Promise<CacheRecord | undefined>;
  putCached(r: Omit<CacheRecord, 'hits'>): Promise<void>;
  bumpCacheHit(cacheKey: string): Promise<void>;

  // --- jobs
  enqueue(kind: JobKind, payload: Record<string, unknown>, priority?: number): Promise<JobRecord>;
  leaseNext(leaseMs: number, now?: Date): Promise<JobRecord | undefined>;
  completeJob(id: string, costUsd: number): Promise<void>;
  failJob(id: string, error: string): Promise<void>;

  // --- human review
  enqueueReview(item: ReviewQueueItem): Promise<void>;
  listReviewQueue(): Promise<ReviewQueueItem[]>;
}
