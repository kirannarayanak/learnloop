/**
 * In-memory Store. Exists so the whole pipeline can be exercised end-to-end with no
 * database — which is how `test/pipeline.test.ts` runs in CI with no secrets.
 *
 * Deliberately faithful on the two behaviours that are easy to get wrong in the real
 * store and silently broken in a fake one: job leasing (a crashed worker's job must
 * self-release) and cache hit accounting.
 */

import { createHash } from 'node:crypto';
import type {
  CacheRecord, CitationRecord, DomainRecord, ExerciseRecord, JobKind, JobRecord,
  LessonRecord, PathRecord, ReviewQueueItem, SkillRecord, SourceRecord, Store, VerifyState,
} from './types.ts';

let counter = 0;
/** Deterministic ids keep test assertions and golden files stable. */
function id(prefix: string): string {
  counter += 1;
  return `${prefix}_${String(counter).padStart(4, '0')}`;
}

export function resetIds(): void {
  counter = 0;
}

/** Cheap lexical similarity, standing in for pgvector cosine in tests. */
function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}
function jaccard(a: string, b: string): number {
  const sa = tokenSet(a), sb = tokenSet(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const t of sa) if (sb.has(t)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

export const SIMILARITY_THRESHOLD = 0.8;

export class MemoryStore implements Store {
  readonly domains = new Map<string, DomainRecord>();
  readonly sources = new Map<string, SourceRecord>();
  readonly skills = new Map<string, SkillRecord>();
  readonly edges: { prereqId: string; skillId: string; strength: number }[] = [];
  readonly lessons = new Map<string, LessonRecord>();
  readonly exercises = new Map<string, ExerciseRecord>();
  readonly citations: CitationRecord[] = [];
  readonly paths = new Map<string, PathRecord>();
  readonly cache = new Map<string, CacheRecord>();
  readonly jobs = new Map<string, JobRecord>();
  readonly reviewQueue: ReviewQueueItem[] = [];

  seedDomain(slug: string, title: string, riskTier: DomainRecord['riskTier']): DomainRecord {
    const d: DomainRecord = { id: id('dom'), slug, title, riskTier };
    this.domains.set(d.id, d);
    return d;
  }

  async getDomainBySlug(slug: string): Promise<DomainRecord | undefined> {
    return [...this.domains.values()].find((d) => d.slug === slug);
  }
  async getDomain(domainId: string): Promise<DomainRecord | undefined> {
    return this.domains.get(domainId);
  }

  async upsertSource(s: Omit<SourceRecord, 'id'>): Promise<SourceRecord> {
    const existing = await this.findSourceByHash(s.contentHash);
    if (existing) return existing;
    const rec: SourceRecord = { id: id('src'), ...s };
    this.sources.set(rec.id, rec);
    return rec;
  }
  async findSourceByHash(contentHash: string): Promise<SourceRecord | undefined> {
    return [...this.sources.values()].find((s) => s.contentHash === contentHash);
  }

  async insertSkills(skills: Omit<SkillRecord, 'id'>[]): Promise<SkillRecord[]> {
    return skills.map((s) => {
      const rec: SkillRecord = { id: id('skl'), ...s };
      this.skills.set(rec.id, rec);
      return rec;
    });
  }

  async findSimilarSkill(domainId: string, statement: string): Promise<SkillRecord | undefined> {
    for (const s of this.skills.values()) {
      if (s.domainId !== domainId) continue;
      if (jaccard(s.statement, statement) >= SIMILARITY_THRESHOLD) return s;
    }
    return undefined;
  }

  async insertEdges(edges: { prereqId: string; skillId: string; strength: number }[]): Promise<void> {
    this.edges.push(...edges);
  }

  async insertLesson(l: Omit<LessonRecord, 'id'>): Promise<LessonRecord> {
    const rec: LessonRecord = { id: id('lsn'), ...l };
    this.lessons.set(rec.id, rec);
    return rec;
  }
  async findLesson(
    skillId: string,
    locale: string,
    promptVersion: string,
  ): Promise<LessonRecord | undefined> {
    return [...this.lessons.values()].find(
      (l) => l.skillId === skillId && l.locale === locale && l.promptVersion === promptVersion,
    );
  }

  async updateLessonVerifyState(lessonId: string, state: VerifyState): Promise<void> {
    const l = this.lessons.get(lessonId);
    if (!l) throw new Error(`no such lesson ${lessonId}`);
    this.lessons.set(lessonId, { ...l, verifyState: state });
  }
  async insertExercises(ex: Omit<ExerciseRecord, 'id'>[]): Promise<ExerciseRecord[]> {
    return ex.map((e) => {
      const rec: ExerciseRecord = { id: id('exr'), ...e };
      this.exercises.set(rec.id, rec);
      return rec;
    });
  }
  async insertCitations(c: CitationRecord[]): Promise<void> {
    this.citations.push(...c);
  }
  async getCitations(lessonId: string): Promise<CitationRecord[]> {
    return this.citations.filter((c) => c.lessonId === lessonId);
  }

  async insertPath(p: Omit<PathRecord, 'id'>): Promise<PathRecord> {
    const rec: PathRecord = { id: id('pth'), ...p };
    this.paths.set(rec.id, rec);
    return rec;
  }
  async findPathBySlug(slug: string): Promise<PathRecord | undefined> {
    return [...this.paths.values()].find((p) => p.slug === slug);
  }

  async publishPath(pathId: string, at: string): Promise<void> {
    const p = this.paths.get(pathId);
    if (!p) throw new Error(`no such path ${pathId}`);
    this.paths.set(pathId, { ...p, status: 'published', publishedAt: at });
  }
  async getPath(pathId: string): Promise<PathRecord | undefined> {
    return this.paths.get(pathId);
  }
  async listPublishedPaths(): Promise<PathRecord[]> {
    return [...this.paths.values()].filter((p) => p.status === 'published');
  }
  async getLessonsForPath(pathId: string): Promise<LessonRecord[]> {
    const p = this.paths.get(pathId);
    if (!p) return [];
    // Path item order is the topological order from the graph stage; preserve it.
    return p.itemSkillIds.flatMap((skillId) =>
      [...this.lessons.values()].filter((l) => l.skillId === skillId),
    );
  }
  async getExercisesForLesson(lessonId: string): Promise<ExerciseRecord[]> {
    return [...this.exercises.values()].filter((e) => e.lessonId === lessonId);
  }

  async getCached(cacheKey: string): Promise<CacheRecord | undefined> {
    return this.cache.get(cacheKey);
  }
  async putCached(r: Omit<CacheRecord, 'hits'>): Promise<void> {
    this.cache.set(r.cacheKey, { ...r, hits: 0 });
  }
  async bumpCacheHit(cacheKey: string): Promise<void> {
    const r = this.cache.get(cacheKey);
    if (r) this.cache.set(cacheKey, { ...r, hits: r.hits + 1 });
  }

  async enqueue(
    kind: JobKind,
    payload: Record<string, unknown>,
    priority = 100,
  ): Promise<JobRecord> {
    const rec: JobRecord = {
      id: id('job'), kind, payload, status: 'queued',
      attempts: 0, priority, costUsd: 0, error: null, lockedUntil: null,
    };
    this.jobs.set(rec.id, rec);
    return rec;
  }

  /**
   * Lease semantics matter: a job whose lease has expired is reclaimable, which is how
   * a crashed worker's work gets retried without a separate reaper process.
   */
  async leaseNext(leaseMs: number, now = new Date()): Promise<JobRecord | undefined> {
    const claimable = [...this.jobs.values()]
      .filter((j) => {
        if (j.status === 'queued') return true;
        if (j.status !== 'running') return false;
        return j.lockedUntil !== null && Date.parse(j.lockedUntil) <= now.getTime();
      })
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

    const job = claimable[0];
    if (job === undefined) return undefined;

    const leased: JobRecord = {
      ...job,
      status: 'running',
      attempts: job.attempts + 1,
      lockedUntil: new Date(now.getTime() + leaseMs).toISOString(),
    };
    this.jobs.set(job.id, leased);
    return leased;
  }

  async completeJob(jobId: string, costUsd: number): Promise<void> {
    const j = this.jobs.get(jobId);
    if (!j) throw new Error(`no such job ${jobId}`);
    this.jobs.set(jobId, { ...j, status: 'done', costUsd, lockedUntil: null });
  }
  async failJob(jobId: string, error: string): Promise<void> {
    const j = this.jobs.get(jobId);
    if (!j) throw new Error(`no such job ${jobId}`);
    this.jobs.set(jobId, { ...j, status: 'failed', error, lockedUntil: null });
  }

  async enqueueReview(item: ReviewQueueItem): Promise<void> {
    this.reviewQueue.push(item);
  }
  async listReviewQueue(): Promise<ReviewQueueItem[]> {
    return [...this.reviewQueue];
  }

  /** Total generation spend. The metric the business model rests on. */
  totalCostUsd(): number {
    return [...this.jobs.values()].reduce((sum, j) => sum + j.costUsd, 0);
  }
}

export function contentHash(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}
