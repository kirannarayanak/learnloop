/**
 * Content access.
 *
 * Wave 0 reads a snapshot produced by the real pipeline (`cd engine && npm run seed`).
 * This module is the seam: when Supabase exists, these functions query Postgres and
 * nothing above them changes. The app never talks to the engine directly — in
 * production the engine is a worker, not a dependency of the web request path
 * (docs/02-architecture.md).
 */

import type { LessonBlock } from '@learnloop/engine/stages/blocks.ts';
import seed from './seed.json';

export type RiskTier = 'low' | 'medium' | 'high';

export interface PathItem {
  skillId: string;
  skillTitle: string;
  /** The observable "can do X" this item is responsible for. */
  statement: string;
  estMinutes: number;
  lessonId: string;
  exerciseCount: number;
  /** Hard prerequisites. These gate CREDIT, never access — docs/10-motivation.md. */
  hardPrereqs: string[];
}

export interface LearningPath {
  id: string;
  slug: string;
  title: string;
  summary: string;
  domainSlug: string;
  domainTitle: string;
  riskTier: RiskTier;
  sourceUri: string;
  items: PathItem[];
}

export interface Lesson {
  id: string;
  skillId: string;
  title: string;
  /** Plain-text fallback; the real lesson is `blocks`. */
  bodyMd: string;
  /** The lesson proper — see engine/stages/blocks.ts and docs/11-lesson-design.md. */
  blocks: LessonBlock[];
  estMinutes: number;
  verifyState: string;
  genModel: string;
  /** Shown to the learner. Provenance is the reason to trust the lesson. */
  citations: { quote: string }[];
  sampledForReview: boolean;
}

export interface Exercise {
  id: string;
  kind: string;
  promptMd: string;
  answer: { correct: number };
  /** Shown whether the learner was right or wrong. */
  explanationMd: string;
  difficulty: number;
}

export interface PendingReview {
  title: string;
  domainTitle: string;
  riskTier: RiskTier;
  lessonCount: number;
  reason: string;
}

interface Snapshot {
  generatedAt: string;
  costUsd: number;
  reviewQueueSize: number;
  paths: LearningPath[];
  lessons: Record<string, Lesson>;
  exercises: Record<string, Exercise[]>;
  pendingReview: PendingReview[];
}

const snapshot = seed as unknown as Snapshot;

export function allPaths(): LearningPath[] {
  return snapshot.paths;
}

export function pathBySlug(slug: string): LearningPath | undefined {
  return snapshot.paths.find((p) => p.slug === slug);
}

export function lesson(lessonId: string): Lesson | undefined {
  return snapshot.lessons[lessonId];
}

export function exercisesFor(lessonId: string): Exercise[] {
  return snapshot.exercises[lessonId] ?? [];
}

/** The path and item a lesson belongs to, for prev/next navigation. */
export function locate(lessonId: string):
  | { path: LearningPath; index: number; item: PathItem }
  | undefined {
  for (const p of snapshot.paths) {
    const index = p.items.findIndex((i) => i.lessonId === lessonId);
    const item = p.items[index];
    if (index !== -1 && item !== undefined) return { path: p, index, item };
  }
  return undefined;
}

/** Content blocked by the publish gate. Surfaced honestly rather than hidden. */
export function pendingReview(): PendingReview[] {
  return snapshot.pendingReview;
}

export function snapshotMeta(): { generatedAt: string; costUsd: number; reviewQueueSize: number } {
  return {
    generatedAt: snapshot.generatedAt,
    costUsd: snapshot.costUsd,
    reviewQueueSize: snapshot.reviewQueueSize,
  };
}
