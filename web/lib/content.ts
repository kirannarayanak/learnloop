import 'server-only';

/**
 * Content access.
 *
 * Reads Postgres when `DATABASE_URL` is set, and the generated snapshot otherwise. The
 * snapshot is not a mock — it is produced by the real pipeline (`npm run seed`) — but its
 * ids are in-memory ids, so **learner progress cannot sync against it**: an attempt would
 * reference a skill that does not exist. Which source is in use therefore decides whether
 * signing in can do anything, and `canSyncProgress()` is how the UI knows.
 *
 * Published, non-org paths are readable by anon under RLS, so the public reads here are
 * safe to serve to a signed-out visitor.
 */

import { reviewStore, databaseConfigured } from './review-store.ts';
import seed from './seed.json';
import type { LessonBlock } from '@learnloop/engine/stages/blocks.ts';

export type RiskTier = 'low' | 'medium' | 'high';

export interface PathItem {
  skillId: string;
  skillTitle: string;
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
  bodyMd: string;
  blocks: LessonBlock[];
  estMinutes: number;
  verifyState: string;
  genModel: string;
  citations: { quote: string }[];
  sampledForReview: boolean;
}

export interface Exercise {
  id: string;
  kind: string;
  promptMd: string;
  answer: { correct: number };
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

/**
 * Whether progress can be synced to an account.
 *
 * False against the snapshot, because its ids are in-memory ids with no rows behind them.
 * The UI uses this to avoid promising that signing in will keep a streak when it cannot.
 */
export function canSyncProgress(): boolean {
  return databaseConfigured();
}

// ============================================================================ from the DB

async function pathsFromDb(): Promise<LearningPath[]> {
  const store = reviewStore();
  const paths = await store.listPublishedPaths();

  return Promise.all(
    paths.map(async (p) => {
      const domain = await store.getDomain(p.domainId);
      const lessons = await store.getLessonsForPath(p.id);

      const items: PathItem[] = [];
      for (const skillId of p.itemSkillIds) {
        const lesson = lessons.find((l) => l.skillId === skillId);
        if (lesson === undefined) continue;
        const skill = await store.getSkill(skillId);
        const exercises = await store.getExercisesForLesson(lesson.id);
        items.push({
          skillId,
          skillTitle: skill?.title ?? lesson.title,
          statement: skill?.statement ?? '',
          estMinutes: skill?.estMinutes ?? lesson.estMinutes,
          lessonId: lesson.id,
          exerciseCount: exercises.length,
          hardPrereqs: await store.hardPrerequisitesOf(skillId),
        });
      }

      return {
        id: p.id,
        slug: p.slug,
        title: p.title,
        summary: p.summary,
        domainSlug: domain?.slug ?? '',
        domainTitle: domain?.title ?? '',
        riskTier: domain?.riskTier ?? 'low',
        sourceUri: '',
        items,
      };
    }),
  );
}

// ================================================================================= public

export async function allPaths(): Promise<LearningPath[]> {
  return canSyncProgress() ? pathsFromDb() : snapshot.paths;
}

export async function pathBySlug(slug: string): Promise<LearningPath | undefined> {
  return (await allPaths()).find((p) => p.slug === slug);
}

export async function lesson(lessonId: string): Promise<Lesson | undefined> {
  if (!canSyncProgress()) return snapshot.lessons[lessonId];

  const store = reviewStore();
  const record = await store.getLessonById(lessonId);
  if (record === undefined) return undefined;
  const citations = await store.getCitations(lessonId);

  return {
    id: record.id,
    skillId: record.skillId,
    title: record.title,
    bodyMd: record.bodyMd,
    blocks: record.blocks,
    estMinutes: record.estMinutes,
    verifyState: record.verifyState,
    genModel: record.genModel,
    citations: citations.map((c) => ({ quote: c.quote })),
    sampledForReview: false,
  };
}

export async function exercisesFor(lessonId: string): Promise<Exercise[]> {
  if (!canSyncProgress()) return snapshot.exercises[lessonId] ?? [];
  const records = await reviewStore().getExercisesForLesson(lessonId);
  return records.map((e) => ({
    id: e.id,
    kind: e.kind,
    promptMd: e.promptMd,
    answer: e.answer as { correct: number },
    explanationMd: e.explanationMd,
    difficulty: e.difficulty,
  }));
}

/** The path and item a lesson belongs to, for prev/next navigation. */
export async function locate(
  lessonId: string,
): Promise<{ path: LearningPath; index: number; item: PathItem } | undefined> {
  for (const p of await allPaths()) {
    const index = p.items.findIndex((i) => i.lessonId === lessonId);
    const item = p.items[index];
    if (index !== -1 && item !== undefined) return { path: p, index, item };
  }
  return undefined;
}

/** Content blocked by the publish gate. Surfaced honestly rather than hidden. */
export async function pendingReview(): Promise<PendingReview[]> {
  if (!canSyncProgress()) return snapshot.pendingReview;
  const queue = await reviewStore().listReviewQueueDetailed();
  const byPath = new Map<string, PendingReview>();
  for (const item of queue) {
    const existing = byPath.get(item.domainTitle);
    if (existing === undefined) {
      byPath.set(item.domainTitle, {
        title: item.lessonTitle,
        domainTitle: item.domainTitle,
        riskTier: item.riskTier,
        lessonCount: 1,
        reason: item.reason,
      });
    } else {
      existing.lessonCount += 1;
    }
  }
  return [...byPath.values()];
}

export async function snapshotMeta(): Promise<{
  generatedAt: string;
  costUsd: number;
  reviewQueueSize: number;
}> {
  if (!canSyncProgress()) {
    return {
      generatedAt: snapshot.generatedAt,
      costUsd: snapshot.costUsd,
      reviewQueueSize: snapshot.reviewQueueSize,
    };
  }
  const queue = await reviewStore().listReviewQueueDetailed();
  return { generatedAt: new Date().toISOString(), costUsd: 0, reviewQueueSize: queue.length };
}
