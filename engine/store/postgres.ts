/**
 * Postgres implementation of `Store`.
 *
 * Behaviour must match `MemoryStore` exactly — the pipeline is tested against one and runs
 * against the other, so a divergence is a bug that only appears in production.
 * `test/store-contract.ts` runs the same suite against both for that reason.
 *
 * Two things here are genuinely different from the in-memory version rather than just
 * translated, and both are called out at their definitions: job leasing uses
 * `FOR UPDATE SKIP LOCKED` so concurrent workers never claim the same job, and skill
 * deduplication uses real similarity rather than a token overlap.
 */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import type {
  CacheRecord, CitationRecord, DomainRecord, ExerciseRecord, JobKind, JobRecord,
  LearnerState, LearnerSyncInput, LessonForReview, LessonRecord, PathRecord, ReviewDecision,
  ReviewOutcome, ReviewQueueEntry, ReviewQueueItem, SkillRecord, SourceRecord, Store,
  VerifyState,
} from './types.ts';
import { evaluatePublishGate } from '../publish/gate.ts';
import { projectMastery, projectPoints, projectStreak } from '../incentives/project.ts';
import type { LessonBlock } from '../stages/blocks.ts';

export interface PostgresStoreOptions {
  connectionString?: string;
  /**
   * Turns a statement into an embedding for near-duplicate detection. Supply one and
   * dedup uses pgvector cosine; omit it and dedup falls back to trigram similarity on
   * the statement text, which is weaker but needs no model and no network.
   *
   * Always an open model — there is no reason to ever pay for embeddings here.
   */
  embed?: (text: string) => Promise<number[]>;
  /** Cosine distance below which two skills are the same idea. Lower = stricter. */
  similarityThreshold?: number;
  max?: number;
}

/** Trigram similarity above which two statements are treated as the same skill. */
const TRIGRAM_THRESHOLD = 0.6;
/** pgvector cosine DISTANCE below which two statements are the same skill. */
const COSINE_THRESHOLD = 0.15;

export class PostgresStore implements Store {
  private readonly pool: Pool;
  private readonly embed: ((text: string) => Promise<number[]>) | undefined;
  private readonly cosineThreshold: number;

  constructor(options: PostgresStoreOptions = {}) {
    const connectionString = options.connectionString ?? process.env.DATABASE_URL;
    if (connectionString === undefined || connectionString === '') {
      throw new Error('PostgresStore needs DATABASE_URL, or pass connectionString.');
    }
    this.pool = new Pool({ connectionString, max: options.max ?? 10 });
    this.embed = options.embed;
    this.cosineThreshold = options.similarityThreshold ?? COSINE_THRESHOLD;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async rows<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  private async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.rows<T>(sql, params))[0];
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  // ============================================================================ domains

  async getDomainBySlug(slug: string): Promise<DomainRecord | undefined> {
    const row = await this.one<{ id: string; slug: string; title: string; risk_tier: DomainRecord['riskTier'] }>(
      'select id, slug, title, risk_tier from domains where slug = $1',
      [slug],
    );
    return row === undefined ? undefined : { id: row.id, slug: row.slug, title: row.title, riskTier: row.risk_tier };
  }

  async getDomain(id: string): Promise<DomainRecord | undefined> {
    const row = await this.one<{ id: string; slug: string; title: string; risk_tier: DomainRecord['riskTier'] }>(
      'select id, slug, title, risk_tier from domains where id = $1',
      [id],
    );
    return row === undefined ? undefined : { id: row.id, slug: row.slug, title: row.title, riskTier: row.risk_tier };
  }

  // ============================================================================ sources

  async upsertSource(s: Omit<SourceRecord, 'id'>): Promise<SourceRecord> {
    // content_hash is unique; `do update` rather than `do nothing` so RETURNING always
    // yields a row. `do nothing` returns zero rows on conflict, which is the classic way
    // this pattern silently breaks.
    const row = await this.one<SourceRow>(
      `insert into sources (kind, uri, title, license, content_hash, retrieved_at)
       values ($1,$2,$3,$4,$5,$6)
       on conflict (content_hash) do update set retrieved_at = sources.retrieved_at
       returning id, kind, uri, title, license, content_hash, retrieved_at`,
      [s.kind, s.uri, s.title, s.license, s.contentHash, s.retrievedAt],
    );
    if (row === undefined) throw new Error('upsertSource returned no row');
    return toSource(row);
  }

  async findSourceByHash(contentHash: string): Promise<SourceRecord | undefined> {
    const row = await this.one<SourceRow>(
      'select id, kind, uri, title, license, content_hash, retrieved_at from sources where content_hash = $1',
      [contentHash],
    );
    return row === undefined ? undefined : toSource(row);
  }

  // ============================================================================= skills

  async insertSkills(skills: Omit<SkillRecord, 'id'>[]): Promise<SkillRecord[]> {
    if (skills.length === 0) return [];

    return this.tx(async (client) => {
      const out: SkillRecord[] = [];
      for (const s of skills) {
        const embedding = this.embed === undefined ? null : toVector(await this.embed(s.statement));
        const result = await client.query<SkillRow>(
          `insert into skills (domain_id, slug, title, statement, est_minutes, embedding)
           values ($1,$2,$3,$4,$5,$6)
           on conflict (domain_id, slug) do update
             set title = excluded.title, statement = excluded.statement
           returning id, domain_id, slug, title, statement, est_minutes`,
          [s.domainId, s.slug, s.title, s.statement, s.estMinutes, embedding],
        );
        const row = result.rows[0];
        if (row !== undefined) out.push(toSkill(row));
      }
      return out;
    });
  }

  /**
   * Near-duplicate detection.
   *
   * This is load-bearing: without it the graph fragments into near-duplicate nodes,
   * mastery stops transferring between paths, and the skills-primary model collapses into
   * a course catalogue (docs/03-data-model.md).
   *
   * With an embedder this is pgvector cosine. Without one it falls back to trigram
   * similarity, which catches rewording but not genuine synonyms — weaker, but honest and
   * free, and it means the pipeline runs before an embedding model is chosen.
   */
  async findSimilarSkill(domainId: string, statement: string): Promise<SkillRecord | undefined> {
    if (this.embed !== undefined) {
      const vector = toVector(await this.embed(statement));
      const row = await this.one<SkillRow>(
        `select id, domain_id, slug, title, statement, est_minutes
           from skills
          where domain_id = $1 and embedding is not null
            and (embedding <=> $2::vector) < $3
          order by embedding <=> $2::vector
          limit 1`,
        [domainId, vector, this.cosineThreshold],
      );
      return row === undefined ? undefined : toSkill(row);
    }

    const row = await this.one<SkillRow>(
      `select id, domain_id, slug, title, statement, est_minutes
         from skills
        where domain_id = $1 and similarity(statement, $2) > $3
        order by similarity(statement, $2) desc
        limit 1`,
      [domainId, statement, TRIGRAM_THRESHOLD],
    );
    return row === undefined ? undefined : toSkill(row);
  }

  async insertEdges(edges: { prereqId: string; skillId: string; strength: number }[]): Promise<void> {
    if (edges.length === 0) return;
    await this.pool.query(
      `insert into skill_edges (prereq_id, skill_id, strength)
       select * from unnest($1::uuid[], $2::uuid[], $3::real[])
       on conflict (prereq_id, skill_id) do update set strength = excluded.strength`,
      [edges.map((e) => e.prereqId), edges.map((e) => e.skillId), edges.map((e) => e.strength)],
    );
  }

  // ============================================================================ content

  async getSkill(skillId: string): Promise<SkillRecord | undefined> {
    const row = await this.one<SkillRow>(
      'select id, domain_id, slug, title, statement, est_minutes from skills where id = $1',
      [skillId],
    );
    return row === undefined ? undefined : toSkill(row);
  }

  async hardPrerequisitesOf(skillId: string): Promise<string[]> {
    const rows = await this.rows<{ prereq_id: string }>(
      'select prereq_id from skill_edges where skill_id = $1 and strength >= 0.9 order by prereq_id',
      [skillId],
    );
    return rows.map((r) => r.prereq_id);
  }

  async getLessonById(lessonId: string): Promise<LessonRecord | undefined> {
    const row = await this.one<LessonRow>(
      `select id, skill_id, locale, title, body_md, blocks, est_minutes, gen_model,
              gen_cost_usd, verify_state, prompt_version
         from lessons where id = $1`,
      [lessonId],
    );
    return row === undefined ? undefined : toLesson(row);
  }

  async insertLesson(l: Omit<LessonRecord, 'id'>): Promise<LessonRecord> {
    const row = await this.one<LessonRow>(
      `insert into lessons
         (skill_id, locale, title, body_md, blocks, est_minutes, gen_model, gen_cost_usd, verify_state, prompt_version)
       values ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
       on conflict (skill_id, locale, prompt_version) do update
         set title = excluded.title, body_md = excluded.body_md, blocks = excluded.blocks,
             updated_at = now()
       returning id, skill_id, locale, title, body_md, blocks, est_minutes, gen_model,
                 gen_cost_usd, verify_state, prompt_version`,
      [l.skillId, l.locale, l.title, l.bodyMd, JSON.stringify(l.blocks), l.estMinutes,
       l.genModel, l.genCostUsd, l.verifyState, l.promptVersion],
    );
    if (row === undefined) throw new Error('insertLesson returned no row');
    return toLesson(row);
  }

  async findLesson(skillId: string, locale: string, promptVersion: string): Promise<LessonRecord | undefined> {
    const row = await this.one<LessonRow>(
      `select id, skill_id, locale, title, body_md, blocks, est_minutes, gen_model,
              gen_cost_usd, verify_state, prompt_version
         from lessons where skill_id = $1 and locale = $2 and prompt_version = $3`,
      [skillId, locale, promptVersion],
    );
    return row === undefined ? undefined : toLesson(row);
  }

  async updateLessonVerifyState(lessonId: string, state: VerifyState): Promise<void> {
    const result = await this.pool.query(
      'update lessons set verify_state = $2, updated_at = now() where id = $1',
      [lessonId, state],
    );
    if (result.rowCount === 0) throw new Error(`no such lesson ${lessonId}`);
  }

  async insertExercises(ex: Omit<ExerciseRecord, 'id'>[]): Promise<ExerciseRecord[]> {
    if (ex.length === 0) return [];
    const rows = await this.rows<ExerciseRow>(
      `insert into exercises (skill_id, lesson_id, locale, kind, prompt_md, answer, explanation_md, difficulty, verify_state)
       select * from unnest(
         $1::uuid[], $2::uuid[], $3::text[], $4::text[], $5::text[], $6::jsonb[], $7::text[], $8::real[], $9::text[]
       )
       returning id, skill_id, lesson_id, locale, kind, prompt_md, answer, explanation_md, difficulty, verify_state`,
      [
        ex.map((e) => e.skillId), ex.map((e) => e.lessonId), ex.map((e) => e.locale),
        ex.map((e) => e.kind), ex.map((e) => e.promptMd), ex.map((e) => JSON.stringify(e.answer)),
        ex.map((e) => e.explanationMd), ex.map((e) => e.difficulty), ex.map((e) => e.verifyState),
      ],
    );
    return rows.map(toExercise);
  }

  async insertCitations(c: CitationRecord[]): Promise<void> {
    if (c.length === 0) return;
    await this.pool.query(
      `insert into lesson_sources (lesson_id, source_id, quote)
       select * from unnest($1::uuid[], $2::uuid[], $3::text[])
       on conflict (lesson_id, source_id) do update set quote = excluded.quote`,
      [c.map((x) => x.lessonId), c.map((x) => x.sourceId), c.map((x) => x.quote)],
    );
  }

  async getCitations(lessonId: string): Promise<CitationRecord[]> {
    const rows = await this.rows<{ lesson_id: string; source_id: string; quote: string | null }>(
      'select lesson_id, source_id, quote from lesson_sources where lesson_id = $1',
      [lessonId],
    );
    return rows.map((r) => ({ lessonId: r.lesson_id, sourceId: r.source_id, quote: r.quote ?? '' }));
  }

  // ============================================================================== paths

  async insertPath(p: Omit<PathRecord, 'id'>): Promise<PathRecord> {
    return this.tx(async (client) => {
      const result = await client.query<PathRow>(
        `insert into paths (domain_id, slug, title, summary, locale, status, prompt_version, published_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         returning id, domain_id, slug, title, summary, locale, status, prompt_version, published_at`,
        [p.domainId, p.slug, p.title, p.summary, p.locale, p.status, p.promptVersion, p.publishedAt],
      );
      const row = result.rows[0];
      if (row === undefined) throw new Error('insertPath returned no row');

      // path_items is the ordered route through the graph; position carries the
      // topological order the graph stage computed.
      for (const [i, skillId] of p.itemSkillIds.entries()) {
        await client.query(
          `insert into path_items (path_id, position, kind, title, skill_id)
           select $1, $2, 'lesson', s.title, s.id from skills s where s.id = $3
           on conflict (path_id, position) do nothing`,
          [row.id, i, skillId],
        );
      }
      return { ...toPath(row), itemSkillIds: [...p.itemSkillIds] };
    });
  }

  async findPathBySlug(slug: string): Promise<PathRecord | undefined> {
    const row = await this.one<PathRow>(
      `select id, domain_id, slug, title, summary, locale, status, prompt_version, published_at
         from paths where slug = $1`,
      [slug],
    );
    if (row === undefined) return undefined;
    return { ...toPath(row), itemSkillIds: await this.pathSkillIds(row.id) };
  }

  private async pathSkillIds(pathId: string): Promise<string[]> {
    const rows = await this.rows<{ skill_id: string | null }>(
      'select skill_id from path_items where path_id = $1 order by position',
      [pathId],
    );
    return rows.map((r) => r.skill_id).filter((id): id is string => id !== null);
  }

  async publishPath(pathId: string, at: string): Promise<void> {
    const result = await this.pool.query(
      `update paths set status = 'published', published_at = $2 where id = $1`,
      [pathId, at],
    );
    if (result.rowCount === 0) throw new Error(`no such path ${pathId}`);
  }

  async getPath(pathId: string): Promise<PathRecord | undefined> {
    const row = await this.one<PathRow>(
      `select id, domain_id, slug, title, summary, locale, status, prompt_version, published_at
         from paths where id = $1`,
      [pathId],
    );
    if (row === undefined) return undefined;
    return { ...toPath(row), itemSkillIds: await this.pathSkillIds(row.id) };
  }

  async listPublishedPaths(): Promise<PathRecord[]> {
    const rows = await this.rows<PathRow>(
      `select id, domain_id, slug, title, summary, locale, status, prompt_version, published_at
         from paths where status = 'published' order by published_at desc nulls last`,
    );
    return Promise.all(
      rows.map(async (r) => ({ ...toPath(r), itemSkillIds: await this.pathSkillIds(r.id) })),
    );
  }

  async getLessonsForPath(pathId: string): Promise<LessonRecord[]> {
    const rows = await this.rows<LessonRow>(
      `select l.id, l.skill_id, l.locale, l.title, l.body_md, l.blocks, l.est_minutes,
              l.gen_model, l.gen_cost_usd, l.verify_state, l.prompt_version
         from path_items pi
         join lessons l on l.skill_id = pi.skill_id
        where pi.path_id = $1
        order by pi.position`,
      [pathId],
    );
    return rows.map(toLesson);
  }

  async getExercisesForLesson(lessonId: string): Promise<ExerciseRecord[]> {
    const rows = await this.rows<ExerciseRow>(
      `select id, skill_id, lesson_id, locale, kind, prompt_md, answer, explanation_md, difficulty, verify_state
         from exercises where lesson_id = $1 order by difficulty`,
      [lessonId],
    );
    return rows.map(toExercise);
  }

  // ============================================================================== cache

  async getCached(cacheKey: string): Promise<CacheRecord | undefined> {
    const row = await this.one<{ cache_key: string; model: string; output: unknown; cost_usd: string; hits: number }>(
      'select cache_key, model, output, cost_usd, hits from content_cache where cache_key = $1',
      [cacheKey],
    );
    return row === undefined
      ? undefined
      : { cacheKey: row.cache_key, model: row.model, output: row.output, costUsd: Number(row.cost_usd), hits: row.hits };
  }

  async putCached(r: Omit<CacheRecord, 'hits'>): Promise<void> {
    await this.pool.query(
      `insert into content_cache (cache_key, model, output, cost_usd)
       values ($1,$2,$3::jsonb,$4)
       on conflict (cache_key) do nothing`,
      [r.cacheKey, r.model, JSON.stringify(r.output), r.costUsd],
    );
  }

  async bumpCacheHit(cacheKey: string): Promise<void> {
    await this.pool.query('update content_cache set hits = hits + 1 where cache_key = $1', [cacheKey]);
  }

  // =============================================================================== jobs

  async enqueue(kind: JobKind, payload: Record<string, unknown>, priority = 100): Promise<JobRecord> {
    const row = await this.one<JobRow>(
      `insert into generation_jobs (kind, payload, priority)
       values ($1,$2::jsonb,$3)
       returning id, kind, payload, status, attempts, priority, cost_usd, error, locked_until`,
      [kind, JSON.stringify(payload), priority],
    );
    if (row === undefined) throw new Error('enqueue returned no row');
    return toJob(row);
  }

  /**
   * Claim the next job.
   *
   * `for update skip locked` is the whole point: two workers polling simultaneously must
   * never claim the same job. Without it you get duplicate generation — which is not just
   * wasted money but duplicate lessons, since the pipeline's idempotence is keyed on rows
   * that do not exist yet at the moment both workers start.
   *
   * A job whose lease has expired is reclaimable, so a crashed worker's work is retried
   * without needing a separate reaper process.
   */
  async leaseNext(leaseMs: number, now = new Date()): Promise<JobRecord | undefined> {
    const row = await this.one<JobRow>(
      `update generation_jobs j
          set status = 'running',
              attempts = j.attempts + 1,
              locked_until = $1::timestamptz + make_interval(secs => $2)
        where j.id = (
          select id from generation_jobs
           where status = 'queued'
              or (status = 'running' and locked_until is not null and locked_until <= $1::timestamptz)
           order by priority, created_at
           for update skip locked
           limit 1
        )
      returning j.id, j.kind, j.payload, j.status, j.attempts, j.priority, j.cost_usd, j.error, j.locked_until`,
      [now.toISOString(), leaseMs / 1000],
    );
    return row === undefined ? undefined : toJob(row);
  }

  async completeJob(id: string, costUsd: number): Promise<void> {
    const result = await this.pool.query(
      `update generation_jobs set status = 'done', cost_usd = $2, locked_until = null, finished_at = now() where id = $1`,
      [id, costUsd],
    );
    if (result.rowCount === 0) throw new Error(`no such job ${id}`);
  }

  async failJob(id: string, error: string): Promise<void> {
    const result = await this.pool.query(
      `update generation_jobs set status = 'failed', error = $2, locked_until = null, finished_at = now() where id = $1`,
      [id, error],
    );
    if (result.rowCount === 0) throw new Error(`no such job ${id}`);
  }

  // ============================================================================= review

  async enqueueReview(item: ReviewQueueItem): Promise<void> {
    await this.pool.query(
      `insert into reviews (entity, entity_id, verdict, notes, created_at)
       values ($1,$2,'needs_edit',$3,$4)`,
      [item.entity, item.entityId, item.reason, item.createdAt],
    );
  }

  async listReviewQueue(): Promise<ReviewQueueItem[]> {
    const rows = await this.rows<{ entity: string; entity_id: string; notes: string | null; created_at: Date }>(
      `select entity, entity_id, notes, created_at
         from reviews where verdict = 'needs_edit' and resolved_at is null order by created_at`,
    );
    return rows.map((r) => ({
      entity: r.entity as ReviewQueueItem['entity'],
      entityId: r.entity_id,
      reason: (r.notes ?? 'flagged') as ReviewQueueItem['reason'],
      createdAt: r.created_at.toISOString(),
    }));
  }

  async syncLearner(input: LearnerSyncInput): Promise<LearnerState> {
    if (input.attempts.length > 0 || input.pointEvents.length > 0) {
      await this.tx(async (client) => {
        if (input.attempts.length > 0) {
          // Union by idempotency key. An outbox IS replayed whenever a device reconnects
          // mid-flush, so double-counting is the normal case to defend against, not an
          // edge case.
          await client.query(
            `insert into attempts (user_id, skill_id, exercise_id, correct, ms_elapsed, client_id, attempted_at)
             select $1, s.skill_id, s.exercise_id, s.correct, s.ms_elapsed, s.client_id, s.attempted_at
               from unnest($2::uuid[], $3::uuid[], $4::boolean[], $5::int[], $6::text[], $7::timestamptz[])
                 as s(skill_id, exercise_id, correct, ms_elapsed, client_id, attempted_at)
             on conflict (user_id, client_id) do nothing`,
            [
              input.userId,
              input.attempts.map((a) => a.skillId),
              input.attempts.map((a) => a.exerciseId),
              input.attempts.map((a) => a.correct),
              input.attempts.map((a) => a.msElapsed ?? null),
              input.attempts.map((a) => a.clientId),
              input.attempts.map((a) => a.at),
            ],
          );
        }

        if (input.pointEvents.length > 0) {
          await client.query(
            `insert into point_events (user_id, kind, points, skill_id, path_id, dedupe_key, created_at)
             select $1, s.kind, s.points, s.skill_id, s.path_id, s.dedupe_key, s.created_at
               from unnest($2::text[], $3::int[], $4::uuid[], $5::uuid[], $6::text[], $7::timestamptz[])
                 as s(kind, points, skill_id, path_id, dedupe_key, created_at)
             on conflict (user_id, dedupe_key) do nothing`,
            [
              input.userId,
              input.pointEvents.map((p) => p.kind),
              input.pointEvents.map((p) => p.points),
              input.pointEvents.map((p) => p.skillId ?? null),
              input.pointEvents.map((p) => p.pathId ?? null),
              input.pointEvents.map((p) => p.dedupeKey),
              input.pointEvents.map((p) => p.at),
            ],
          );
        }
      });
    }

    return this.getLearnerState(input.userId, input.timeZone, input.today);
  }

  async getLearnerState(userId: string, timeZone: string, today?: string): Promise<LearnerState> {
    const attempts = await this.rows<{ client_id: string; skill_id: string; correct: boolean; attempted_at: Date }>(
      'select client_id, skill_id, correct, attempted_at from attempts where user_id = $1',
      [userId],
    );
    const points = await this.rows<{ dedupe_key: string; points: number; created_at: Date }>(
      'select dedupe_key, points, created_at from point_events where user_id = $1',
      [userId],
    );

    // Any genuine activity extends the streak, so both logs count — not just hitting a
    // goal (docs/10-motivation.md finding 4).
    const activity = [
      ...attempts.map((a) => ({ at: a.attempted_at.toISOString() })),
      ...points.map((p) => ({ at: p.created_at.toISOString() })),
    ];

    const streak = projectStreak(activity, timeZone, today);
    const mastery = projectMastery(
      attempts.map((a) => ({ skillId: a.skill_id, correct: a.correct, at: a.attempted_at.toISOString() })),
    );

    // Materialise the projections so other readers — league standings, cohort dashboards,
    // the review of a learner's progress — do not each recompute them.
    await this.persistProjection(userId, streak, mastery);

    return {
      streak,
      points: projectPoints(points),
      mastery,
      acceptedClientIds: attempts.map((a) => a.client_id),
      acceptedDedupeKeys: points.map((p) => p.dedupe_key),
    };
  }

  private async persistProjection(
    userId: string,
    streak: LearnerState['streak'],
    mastery: LearnerState['mastery'],
  ): Promise<void> {
    await this.pool.query(
      `insert into streaks (user_id, current_days, longest_days, last_active_date, freezes_available, freezes_used, updated_at)
       values ($1,$2,$3,$4,$5,$6, now())
       on conflict (user_id) do update set
         current_days = excluded.current_days,
         longest_days = excluded.longest_days,
         last_active_date = excluded.last_active_date,
         freezes_available = excluded.freezes_available,
         freezes_used = excluded.freezes_used,
         updated_at = now()`,
      [userId, streak.currentDays, streak.longestDays, streak.lastActiveDate,
       streak.freezesAvailable, streak.freezesUsed],
    );

    if (mastery.length === 0) return;
    await this.pool.query(
      `insert into mastery (user_id, skill_id, state, reps)
       select $1, s.skill_id, s.state, s.reps
         from unnest($2::uuid[], $3::text[], $4::int[]) as s(skill_id, state, reps)
       on conflict (user_id, skill_id) do update set
         state = excluded.state, reps = excluded.reps`,
      [
        userId,
        mastery.map((m) => m.skillId),
        // FSRS replaces this stand-in; until then 'review' means credited.
        mastery.map((m) => (m.mastered ? 'review' : 'learning')),
        mastery.map((m) => m.attempts),
      ],
    );
  }

  async listReviewQueueDetailed(): Promise<ReviewQueueEntry[]> {
    const rows = await this.rows<{
      entity: string; entity_id: string; notes: string | null; created_at: Date;
      title: string; statement: string; domain_title: string;
      risk_tier: DomainRecord['riskTier']; verify_state: string; block_count: string;
    }>(
      `select r.entity, r.entity_id, r.notes, r.created_at,
              l.title, s.statement, d.title as domain_title, d.risk_tier, l.verify_state,
              jsonb_array_length(l.blocks) as block_count
         from reviews r
         join lessons l on l.id = r.entity_id
         join skills  s on s.id = l.skill_id
         join domains d on d.id = s.domain_id
        where r.entity = 'lesson' and r.verdict = 'needs_edit' and r.resolved_at is null
        order by r.created_at`,
    );
    return rows.map((r) => ({
      entity: 'lesson',
      entityId: r.entity_id,
      reason: (r.notes ?? 'flagged') as ReviewQueueItem['reason'],
      createdAt: r.created_at.toISOString(),
      lessonTitle: r.title,
      skillStatement: r.statement,
      domainTitle: r.domain_title,
      riskTier: r.risk_tier,
      verifyState: r.verify_state as VerifyState,
      blockCount: Number(r.block_count),
    }));
  }

  async getLessonForReview(lessonId: string): Promise<LessonForReview | undefined> {
    const row = await this.one<LessonRow & {
      skill_title: string; statement: string; domain_title: string;
      risk_tier: DomainRecord['riskTier']; path_id: string | null; reason: string | null;
    }>(
      `select l.id, l.skill_id, l.locale, l.title, l.body_md, l.blocks, l.est_minutes,
              l.gen_model, l.gen_cost_usd, l.verify_state, l.prompt_version,
              s.title as skill_title, s.statement, d.title as domain_title, d.risk_tier,
              pi.path_id,
              (select notes from reviews r
                where r.entity_id = l.id and r.verdict = 'needs_edit' and r.resolved_at is null
                order by r.created_at limit 1) as reason
         from lessons l
         join skills  s on s.id = l.skill_id
         join domains d on d.id = s.domain_id
         left join path_items pi on pi.skill_id = s.id
        where l.id = $1
        limit 1`,
      [lessonId],
    );
    if (row === undefined) return undefined;

    const citations = await this.rows<{ quote: string | null; uri: string | null; license: string | null }>(
      `select ls.quote, src.uri, src.license
         from lesson_sources ls join sources src on src.id = ls.source_id
        where ls.lesson_id = $1`,
      [lessonId],
    );

    return {
      lesson: toLesson(row),
      skillTitle: row.skill_title,
      skillStatement: row.statement,
      domainTitle: row.domain_title,
      riskTier: row.risk_tier,
      citations: citations.map((c) => ({
        quote: c.quote ?? '',
        sourceUri: c.uri,
        sourceLicense: c.license,
      })),
      reason: (row.reason ?? 'flagged') as ReviewQueueItem['reason'],
      pathId: row.path_id,
    };
  }

  async recordReview(decision: ReviewDecision): Promise<ReviewOutcome> {
    const verifyState: VerifyState =
      decision.verdict === 'approve' ? 'human_approved'
      : decision.verdict === 'reject' ? 'disputed'
      : 'auto_failed';

    const skillId = await this.tx(async (client) => {
      const lesson = await client.query<{ skill_id: string }>(
        'select skill_id from lessons where id = $1',
        [decision.lessonId],
      );
      const row = lesson.rows[0];
      if (row === undefined) throw new Error(`no such lesson ${decision.lessonId}`);

      // The audit row and the state change are one transaction: a lesson that became
      // human_approved with no record of who approved it is exactly what this table is
      // for (docs/07-risks.md).
      await client.query(
        `insert into reviews (entity, entity_id, reviewer_id, verdict, notes, is_expert, resolved_at)
         values ('lesson', $1, $2, $3, $4, $5, now())`,
        [decision.lessonId, decision.reviewerId, decision.verdict, decision.notes, decision.isExpert],
      );

      // Close the open queue entry. Resolving it keeps the row — the audit trail must
      // show that this lesson WAS queued, and why.
      await client.query(
        `update reviews set resolved_at = now()
          where entity_id = $1 and verdict = 'needs_edit' and resolved_at is null`,
        [decision.lessonId],
      );

      await client.query(
        'update lessons set verify_state = $2, updated_at = now() where id = $1',
        [decision.lessonId, verifyState],
      );

      return row.skill_id;
    });

    return { verifyState, publishedPathId: await this.tryPublishPathFor(skillId) };
  }

  /**
   * Publish a path once every lesson in it clears the gate.
   *
   * Without this an approval changes a state field and nothing visible happens — and a
   * reviewer who believes their work does nothing stops doing it.
   */
  private async tryPublishPathFor(skillId: string): Promise<string | null> {
    const path = await this.one<{ id: string; risk_tier: DomainRecord['riskTier'] }>(
      `select p.id, d.risk_tier
         from path_items pi
         join paths p on p.id = pi.path_id
         join domains d on d.id = p.domain_id
        where pi.skill_id = $1 and p.status <> 'published'
        limit 1`,
      [skillId],
    );
    if (path === undefined) return null;

    const lessons = await this.rows<{ id: string; verify_state: string; citation_count: string }>(
      `select l.id, l.verify_state,
              (select count(*) from lesson_sources ls where ls.lesson_id = l.id) as citation_count
         from path_items pi
         join lessons l on l.skill_id = pi.skill_id
        where pi.path_id = $1`,
      [path.id],
    );

    const items = await this.rows<{ n: string }>(
      'select count(*) as n from path_items where path_id = $1',
      [path.id],
    );
    if (lessons.length < Number(items[0]?.n ?? 0)) return null; // a skill still has no lesson

    for (const l of lessons) {
      const decision = evaluatePublishGate({
        lessonId: l.id,
        riskTier: path.risk_tier,
        verifyState: l.verify_state as VerifyState,
        citedSourceIds: Number(l.citation_count) > 0 ? ['present'] : [],
        unlicensedSourceIds: [],
      });
      if (!decision.publish) return null;
    }

    await this.publishPath(path.id, new Date().toISOString());
    return path.id;
  }
}

// ======================================================================== row conversion

interface SourceRow { id: string; kind: string; uri: string | null; title: string | null; license: string | null; content_hash: string; retrieved_at: Date }
interface SkillRow { id: string; domain_id: string; slug: string; title: string; statement: string; est_minutes: number }
interface LessonRow { id: string; skill_id: string; locale: string; title: string; body_md: string; blocks: unknown; est_minutes: number; gen_model: string | null; gen_cost_usd: string | null; verify_state: string; prompt_version: string }
interface ExerciseRow { id: string; skill_id: string; lesson_id: string | null; locale: string; kind: string; prompt_md: string; answer: unknown; explanation_md: string | null; difficulty: number; verify_state: string }
interface PathRow { id: string; domain_id: string; slug: string; title: string; summary: string | null; locale: string; status: string; prompt_version: string | null; published_at: Date | null }
interface JobRow { id: string; kind: string; payload: Record<string, unknown>; status: string; attempts: number; priority: number; cost_usd: string | null; error: string | null; locked_until: Date | null }

function toSource(r: SourceRow): SourceRecord {
  return {
    id: r.id, kind: r.kind as SourceRecord['kind'], uri: r.uri, title: r.title,
    license: r.license, contentHash: r.content_hash, retrievedAt: r.retrieved_at.toISOString(),
  };
}

function toSkill(r: SkillRow): SkillRecord {
  return { id: r.id, domainId: r.domain_id, slug: r.slug, title: r.title, statement: r.statement, estMinutes: r.est_minutes };
}

function toLesson(r: LessonRow): LessonRecord {
  return {
    id: r.id, skillId: r.skill_id, locale: r.locale, title: r.title, bodyMd: r.body_md,
    blocks: (r.blocks ?? []) as LessonBlock[], estMinutes: r.est_minutes,
    genModel: r.gen_model ?? '', genCostUsd: Number(r.gen_cost_usd ?? 0),
    verifyState: r.verify_state as VerifyState, promptVersion: r.prompt_version,
  };
}

function toExercise(r: ExerciseRow): ExerciseRecord {
  return {
    id: r.id, skillId: r.skill_id, lessonId: r.lesson_id ?? '', locale: r.locale,
    kind: r.kind as ExerciseRecord['kind'], promptMd: r.prompt_md, answer: r.answer,
    explanationMd: r.explanation_md ?? '', difficulty: r.difficulty,
    verifyState: r.verify_state as VerifyState,
  };
}

function toPath(r: PathRow): Omit<PathRecord, 'itemSkillIds'> {
  return {
    id: r.id, domainId: r.domain_id, slug: r.slug, title: r.title, summary: r.summary ?? '',
    locale: r.locale, status: r.status as PathRecord['status'],
    promptVersion: r.prompt_version ?? '', publishedAt: r.published_at?.toISOString() ?? null,
  };
}

function toJob(r: JobRow): JobRecord {
  return {
    id: r.id, kind: r.kind as JobKind, payload: r.payload, status: r.status as JobRecord['status'],
    attempts: r.attempts, priority: r.priority, costUsd: Number(r.cost_usd ?? 0),
    error: r.error, lockedUntil: r.locked_until?.toISOString() ?? null,
  };
}

/** pgvector's text input format. */
function toVector(values: readonly number[]): string {
  return `[${values.join(',')}]`;
}
