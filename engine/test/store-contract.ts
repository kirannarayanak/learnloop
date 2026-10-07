/**
 * The Store contract.
 *
 * One suite, run against every implementation. This exists because the pipeline is tested
 * against `MemoryStore` and runs against `PostgresStore` — so any behaviour that differs
 * between them is a bug that only ever appears in production, which is the worst possible
 * place to find it.
 *
 * Not named `*.test.ts` on purpose: it is invoked by `store.test.ts`, not collected
 * directly by the runner.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Store } from '../store/types.ts';

export interface ContractHarness {
  name: string;
  /** A clean store with no rows. Called before every test. */
  create: () => Promise<Store>;
  /** Seed a domain, since there is no public Store method for it. */
  seedDomain: (store: Store, slug: string, title: string, riskTier: 'low' | 'medium' | 'high') => Promise<string>;
  teardown?: () => Promise<void>;
}

const BLOCKS = [
  { type: 'check' as const, question: 'q', options: ['a', 'b'], correctIndex: 0, explanation: 'e' },
];

export function runStoreContract(harness: ContractHarness): void {
  const label = (name: string) => `[${harness.name}] ${name}`;

  // --- domains

  test(label('finds a domain by slug and by id, with its risk tier'), async () => {
    const store = await harness.create();
    const id = await harness.seedDomain(store, 'd1', 'Domain One', 'high');

    const bySlug = await store.getDomainBySlug('d1');
    assert.equal(bySlug?.id, id);
    assert.equal(bySlug?.riskTier, 'high', 'the risk tier is what the publish gate reads');
    assert.equal((await store.getDomain(id))?.slug, 'd1');
    assert.equal(await store.getDomainBySlug('missing'), undefined);
  });

  // --- sources

  test(label('upserting the same content hash returns the same source'), async () => {
    const store = await harness.create();
    const base = {
      kind: 'url' as const, uri: 'https://e.test/a', title: null,
      license: 'CC-BY-4.0', contentHash: 'hash-1', retrievedAt: new Date().toISOString(),
    };
    const first = await store.upsertSource(base);
    const second = await store.upsertSource({ ...base, uri: 'https://e.test/b' });

    // The freshness cron re-ingests constantly; a second row per run would fork the
    // derived content tree.
    assert.equal(second.id, first.id);
    assert.equal((await store.findSourceByHash('hash-1'))?.id, first.id);
    assert.equal(await store.findSourceByHash('nope'), undefined);
  });

  test(label('a null licence round-trips as null, not as a string'), async () => {
    const store = await harness.create();
    const s = await store.upsertSource({
      kind: 'url', uri: null, title: null, license: null,
      contentHash: 'h-null', retrievedAt: new Date().toISOString(),
    });
    // The licence gate tests for null exactly; "null" the string would pass it.
    assert.equal(s.license, null);
  });

  // --- skills and the graph

  test(label('inserts skills and finds near-duplicates by statement'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');

    const [skill] = await store.insertSkills([
      { domainId, slug: 'recursion', title: 'Recursion', statement: 'Trace a recursive call to its base case', estMinutes: 8 },
    ]);
    assert.ok(skill);

    // Dedup is load-bearing: without it mastery stops transferring between paths.
    const same = await store.findSimilarSkill(domainId, 'Trace a recursive call to its base case');
    assert.equal(same?.id, skill.id);

    assert.equal(await store.findSimilarSkill(domainId, 'Balance a chemical equation'), undefined);
  });

  test(label('dedup does not leak across domains'), async () => {
    const store = await harness.create();
    const a = await harness.seedDomain(store, 'da', 'A', 'low');
    const b = await harness.seedDomain(store, 'db', 'B', 'low');
    await store.insertSkills([
      { domainId: a, slug: 's', title: 'S', statement: 'Trace a recursive call to its base case', estMinutes: 8 },
    ]);
    assert.equal(await store.findSimilarSkill(b, 'Trace a recursive call to its base case'), undefined);
  });

  test(label('edges insert idempotently'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');
    const skills = await store.insertSkills([
      { domainId, slug: 'a', title: 'A', statement: 'Do A', estMinutes: 5 },
      { domainId, slug: 'b', title: 'B', statement: 'Do B', estMinutes: 5 },
    ]);
    const [a, b] = skills;
    assert.ok(a && b);
    const edge = [{ prereqId: a.id, skillId: b.id, strength: 1 }];
    await store.insertEdges(edge);
    // A re-run of the pipeline must not fail on a duplicate edge.
    await store.insertEdges(edge);
  });

  // --- lessons

  test(label('a lesson round-trips its blocks and is reusable by prompt version'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');
    const [skill] = await store.insertSkills([
      { domainId, slug: 's', title: 'S', statement: 'Do S', estMinutes: 8 },
    ]);
    assert.ok(skill);

    const lesson = await store.insertLesson({
      skillId: skill.id, locale: 'en', title: 'L', bodyMd: 'flat text',
      blocks: BLOCKS, estMinutes: 8, genModel: 'm', genCostUsd: 0.01,
      verifyState: 'unverified', promptVersion: 'v3',
    });

    assert.deepEqual(lesson.blocks, BLOCKS, 'blocks must survive the round trip');

    // The reuse key. Without it the freshness cron duplicates every lesson on every run.
    assert.equal((await store.findLesson(skill.id, 'en', 'v3'))?.id, lesson.id);
    assert.equal(await store.findLesson(skill.id, 'en', 'v4'), undefined, 'a prompt bump must regenerate');
    assert.equal(await store.findLesson(skill.id, 'hi', 'v3'), undefined, 'a different locale is a different lesson');
  });

  test(label('verify state updates, and an unknown lesson throws'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');
    const [skill] = await store.insertSkills([{ domainId, slug: 's', title: 'S', statement: 'Do S', estMinutes: 8 }]);
    assert.ok(skill);
    const lesson = await store.insertLesson({
      skillId: skill.id, locale: 'en', title: 'L', bodyMd: '', blocks: BLOCKS, estMinutes: 8,
      genModel: 'm', genCostUsd: 0, verifyState: 'unverified', promptVersion: 'v3',
    });

    await store.updateLessonVerifyState(lesson.id, 'auto_passed');
    assert.equal((await store.findLesson(skill.id, 'en', 'v3'))?.verifyState, 'auto_passed');

    await assert.rejects(() =>
      store.updateLessonVerifyState('00000000-0000-0000-0000-000000000000', 'auto_passed'));
  });

  test(label('citations and exercises attach to a lesson'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');
    const [skill] = await store.insertSkills([{ domainId, slug: 's', title: 'S', statement: 'Do S', estMinutes: 8 }]);
    assert.ok(skill);
    const source = await store.upsertSource({
      kind: 'url', uri: null, title: null, license: 'CC-BY-4.0',
      contentHash: 'h', retrievedAt: new Date().toISOString(),
    });
    const lesson = await store.insertLesson({
      skillId: skill.id, locale: 'en', title: 'L', bodyMd: '', blocks: BLOCKS, estMinutes: 8,
      genModel: 'm', genCostUsd: 0, verifyState: 'auto_passed', promptVersion: 'v3',
    });

    await store.insertCitations([{ lessonId: lesson.id, sourceId: source.id, quote: 'a span' }]);
    const citations = await store.getCitations(lesson.id);
    assert.equal(citations.length, 1);
    assert.equal(citations[0]?.quote, 'a span');

    const exercises = await store.insertExercises([
      { skillId: skill.id, lessonId: lesson.id, locale: 'en', kind: 'mcq', promptMd: 'q',
        answer: { correct: 1 }, explanationMd: 'e', difficulty: 0.5, verifyState: 'unverified' },
    ]);
    assert.equal(exercises.length, 1);
    const fetched = await store.getExercisesForLesson(lesson.id);
    assert.equal(fetched.length, 1);
    assert.deepEqual(fetched[0]?.answer, { correct: 1 }, 'the answer is jsonb and must round-trip');
  });

  // --- paths

  test(label('a path keeps its item order and publishes'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');
    const skills = await store.insertSkills([
      { domainId, slug: 'a', title: 'A', statement: 'Do A', estMinutes: 5 },
      { domainId, slug: 'b', title: 'B', statement: 'Do B', estMinutes: 5 },
      { domainId, slug: 'c', title: 'C', statement: 'Do C', estMinutes: 5 },
    ]);
    const order = skills.map((s) => s.id);

    const path = await store.insertPath({
      domainId, slug: 'p1', title: 'P', summary: 'S', locale: 'en',
      status: 'draft', promptVersion: 'v3', itemSkillIds: order, publishedAt: null,
    });

    // Item order IS the topological order from the graph stage. Losing it teaches a
    // broken prerequisite chain.
    assert.deepEqual((await store.getPath(path.id))?.itemSkillIds, order);
    assert.equal((await store.findPathBySlug('p1'))?.id, path.id);
    assert.equal(await store.findPathBySlug('nope'), undefined);

    assert.equal((await store.listPublishedPaths()).length, 0, 'a draft is not published');
    await store.publishPath(path.id, new Date().toISOString());
    const published = await store.listPublishedPaths();
    assert.equal(published.length, 1);
    assert.deepEqual(published[0]?.itemSkillIds, order);
  });

  test(label('lessons for a path come back in path order'), async () => {
    const store = await harness.create();
    const domainId = await harness.seedDomain(store, 'd1', 'D', 'low');
    const skills = await store.insertSkills([
      { domainId, slug: 'a', title: 'A', statement: 'Do A', estMinutes: 5 },
      { domainId, slug: 'b', title: 'B', statement: 'Do B', estMinutes: 5 },
    ]);
    const [a, b] = skills;
    assert.ok(a && b);

    // Inserted out of order on purpose.
    for (const [skill, title] of [[b, 'Lesson B'], [a, 'Lesson A']] as const) {
      await store.insertLesson({
        skillId: skill.id, locale: 'en', title, bodyMd: '', blocks: BLOCKS, estMinutes: 8,
        genModel: 'm', genCostUsd: 0, verifyState: 'auto_passed', promptVersion: 'v3',
      });
    }

    const path = await store.insertPath({
      domainId, slug: 'p', title: 'P', summary: '', locale: 'en', status: 'draft',
      promptVersion: 'v3', itemSkillIds: [a.id, b.id], publishedAt: null,
    });

    const lessons = await store.getLessonsForPath(path.id);
    assert.deepEqual(lessons.map((l) => l.title), ['Lesson A', 'Lesson B']);
  });

  // --- generation cache

  test(label('the cache stores, reads and counts hits'), async () => {
    const store = await harness.create();
    assert.equal(await store.getCached('k'), undefined);

    await store.putCached({ cacheKey: 'k', model: 'm', output: { a: 1 }, costUsd: 0.02 });
    const hit = await store.getCached('k');
    assert.deepEqual(hit?.output, { a: 1 });
    assert.equal(hit?.costUsd, 0.02, 'cost must round-trip — it is the business-model metric');
    assert.equal(hit?.hits, 0);

    await store.bumpCacheHit('k');
    assert.equal((await store.getCached('k'))?.hits, 1);
    await store.bumpCacheHit('missing'); // must not throw
  });

  // --- jobs

  test(label('jobs lease in priority order and only once'), async () => {
    const store = await harness.create();
    await store.enqueue('draft', { n: 1 }, 200);
    const urgent = await store.enqueue('graph', { n: 2 }, 10);

    const first = await store.leaseNext(60_000);
    assert.equal(first?.id, urgent.id, 'lower priority number goes first');
    assert.equal(first?.status, 'running');
    assert.equal(first?.attempts, 1);

    const second = await store.leaseNext(60_000);
    // Two workers polling at once must never get the same job.
    assert.notEqual(second?.id, first?.id);

    assert.equal(await store.leaseNext(60_000), undefined, 'nothing left to claim');
  });

  test(label('an expired lease is reclaimable, so a crashed worker self-heals'), async () => {
    const store = await harness.create();
    const job = await store.enqueue('draft', {});

    const now = new Date();
    const leased = await store.leaseNext(1000, now);
    assert.equal(leased?.id, job.id);

    const during = new Date(now.getTime() + 500);
    assert.equal(await store.leaseNext(1000, during), undefined, 'still held');

    const after = new Date(now.getTime() + 2000);
    const reclaimed = await store.leaseNext(1000, after);
    assert.equal(reclaimed?.id, job.id);
    assert.equal(reclaimed?.attempts, 2, 'the retry count must increment');
  });

  test(label('completing and failing a job records cost and error'), async () => {
    const store = await harness.create();
    const a = await store.enqueue('draft', {});
    const b = await store.enqueue('draft', {});

    await store.completeJob(a.id, 0.0123);
    await store.failJob(b.id, 'boom');

    // Completed and failed jobs must not be re-leased.
    assert.equal(await store.leaseNext(60_000), undefined);
    await assert.rejects(() => store.completeJob('00000000-0000-0000-0000-000000000000', 0));
  });

  // --- human review

  /** A domain, a skill, a lesson with a citation, and a path containing it. */
  async function seedReviewable(
    store: Store,
    riskTier: 'low' | 'medium' | 'high',
    skillCount = 1,
  ): Promise<{ domainId: string; lessonIds: string[]; pathId: string }> {
    const domainId = await harness.seedDomain(store, `d-${riskTier}`, 'D', riskTier);
    const skills = await store.insertSkills(
      Array.from({ length: skillCount }, (_, i) => ({
        domainId, slug: `s${i}`, title: `S${i}`, statement: `Do S${i}`, estMinutes: 5,
      })),
    );
    const source = await store.upsertSource({
      kind: 'url', uri: 'https://e.test/s', title: null, license: 'CC-BY-4.0',
      contentHash: `h-${riskTier}`, retrievedAt: new Date().toISOString(),
    });

    const lessonIds: string[] = [];
    for (const skill of skills) {
      const lesson = await store.insertLesson({
        skillId: skill.id, locale: 'en', title: `L ${skill.slug}`, bodyMd: '',
        blocks: BLOCKS, estMinutes: 8, genModel: 'm', genCostUsd: 0,
        verifyState: 'auto_passed', promptVersion: 'v3',
      });
      await store.insertCitations([{ lessonId: lesson.id, sourceId: source.id, quote: 'a span' }]);
      lessonIds.push(lesson.id);
    }

    const path = await store.insertPath({
      domainId, slug: `p-${riskTier}`, title: 'P', summary: '', locale: 'en',
      status: 'draft', promptVersion: 'v3', itemSkillIds: skills.map((s) => s.id), publishedAt: null,
    });
    return { domainId, lessonIds, pathId: path.id };
  }

  test(label('the detailed queue carries enough context to triage'), async () => {
    const store = await harness.create();
    const { lessonIds } = await seedReviewable(store, 'high');
    const lessonId = lessonIds[0];
    assert.ok(lessonId);
    await store.enqueueReview({ entity: 'lesson', entityId: lessonId, reason: 'high_risk', createdAt: new Date().toISOString() });

    const queue = await store.listReviewQueueDetailed();
    assert.equal(queue.length, 1);
    const entry = queue[0];
    assert.equal(entry?.riskTier, 'high', 'the reviewer must see why it is here');
    assert.equal(entry?.reason, 'high_risk');
    assert.equal(entry?.blockCount, BLOCKS.length);
    assert.ok((entry?.skillStatement ?? '').length > 0);
  });

  test(label('a lesson for review comes with its citations and risk tier'), async () => {
    const store = await harness.create();
    const { lessonIds } = await seedReviewable(store, 'high');
    const lessonId = lessonIds[0];
    assert.ok(lessonId);
    await store.enqueueReview({ entity: 'lesson', entityId: lessonId, reason: 'high_risk', createdAt: new Date().toISOString() });

    const forReview = await store.getLessonForReview(lessonId);
    assert.equal(forReview?.riskTier, 'high');
    assert.equal(forReview?.reason, 'high_risk');
    // The reviewer judges correctness, which is impossible without the evidence.
    assert.equal(forReview?.citations.length, 1);
    assert.equal(forReview?.citations[0]?.quote, 'a span');
    assert.equal(forReview?.citations[0]?.sourceLicense, 'CC-BY-4.0');
    assert.deepEqual(forReview?.lesson.blocks, BLOCKS);

    assert.equal(await store.getLessonForReview('00000000-0000-0000-0000-000000000000'), undefined);
  });

  // The whole point of the queue: this is the ONLY route a high-risk lesson has to
  // publication.
  test(label('approving a high-risk lesson sets human_approved and publishes its path'), async () => {
    const store = await harness.create();
    const { lessonIds, pathId } = await seedReviewable(store, 'high');
    const lessonId = lessonIds[0];
    assert.ok(lessonId);
    await store.enqueueReview({ entity: 'lesson', entityId: lessonId, reason: 'high_risk', createdAt: new Date().toISOString() });

    assert.equal((await store.listPublishedPaths()).length, 0, 'blocked before approval');

    const outcome = await store.recordReview({
      lessonId, verdict: 'approve', notes: 'checked against the syllabus',
      reviewerId: null, isExpert: true,
    });

    assert.equal(outcome.verifyState, 'human_approved');
    assert.equal(outcome.publishedPathId, pathId, 'approval must do something visible');
    assert.equal((await store.listPublishedPaths()).length, 1);
    assert.equal((await store.listReviewQueueDetailed()).length, 0, 'resolved items leave the queue');
  });

  test(label('rejecting marks the lesson disputed and publishes nothing'), async () => {
    const store = await harness.create();
    const { lessonIds } = await seedReviewable(store, 'high');
    const lessonId = lessonIds[0];
    assert.ok(lessonId);
    await store.enqueueReview({ entity: 'lesson', entityId: lessonId, reason: 'high_risk', createdAt: new Date().toISOString() });

    const outcome = await store.recordReview({
      lessonId, verdict: 'reject', notes: 'the second claim is wrong',
      reviewerId: null, isExpert: true,
    });
    assert.equal(outcome.verifyState, 'disputed');
    assert.equal(outcome.publishedPathId, null);
    assert.equal((await store.listPublishedPaths()).length, 0);
  });

  test(label('a path publishes only when EVERY lesson in it is approved'), async () => {
    const store = await harness.create();
    const { lessonIds, pathId } = await seedReviewable(store, 'high', 3);
    for (const id of lessonIds) {
      await store.enqueueReview({ entity: 'lesson', entityId: id, reason: 'high_risk', createdAt: new Date().toISOString() });
    }

    const [first, second, third] = lessonIds;
    assert.ok(first && second && third);

    const a = await store.recordReview({ lessonId: first, verdict: 'approve', notes: '', reviewerId: null, isExpert: true });
    assert.equal(a.publishedPathId, null, 'one of three is not enough');

    const b = await store.recordReview({ lessonId: second, verdict: 'approve', notes: '', reviewerId: null, isExpert: true });
    assert.equal(b.publishedPathId, null);

    // A path with a hole teaches a prerequisite chain that is actually broken, so it
    // waits for all of them.
    const c = await store.recordReview({ lessonId: third, verdict: 'approve', notes: '', reviewerId: null, isExpert: true });
    assert.equal(c.publishedPathId, pathId);
  });

  test(label('needs_edit keeps the lesson unpublishable and leaves it queued'), async () => {
    const store = await harness.create();
    const { lessonIds } = await seedReviewable(store, 'medium');
    const lessonId = lessonIds[0];
    assert.ok(lessonId);
    await store.enqueueReview({ entity: 'lesson', entityId: lessonId, reason: 'sampled', createdAt: new Date().toISOString() });

    const outcome = await store.recordReview({
      lessonId, verdict: 'needs_edit', notes: 'the diagram labels are reversed',
      reviewerId: null, isExpert: false,
    });
    assert.equal(outcome.verifyState, 'auto_failed');
    assert.equal(outcome.publishedPathId, null);
  });

  test(label('reviewing an unknown lesson throws rather than silently succeeding'), async () => {
    const store = await harness.create();
    await assert.rejects(() =>
      store.recordReview({
        lessonId: '00000000-0000-0000-0000-000000000000',
        verdict: 'approve', notes: '', reviewerId: null, isExpert: true,
      }));
  });

  test(label('the review queue records entity, reason and order'), async () => {
    const store = await harness.create();
    await store.enqueueReview({ entity: 'lesson', entityId: '11111111-1111-1111-1111-111111111111', reason: 'high_risk', createdAt: new Date(Date.now() - 1000).toISOString() });
    await store.enqueueReview({ entity: 'lesson', entityId: '22222222-2222-2222-2222-222222222222', reason: 'sampled', createdAt: new Date().toISOString() });

    const queue = await store.listReviewQueue();
    assert.equal(queue.length, 2);
    assert.equal(queue[0]?.reason, 'high_risk', 'oldest first — this is a work queue');
    assert.equal(queue[1]?.reason, 'sampled');
  });
}
