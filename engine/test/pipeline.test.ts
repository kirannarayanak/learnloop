import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, type PipelineInput } from '../pipeline.ts';
import { MemoryStore, resetIds } from '../store/memory.ts';
import { FakeProvider } from '../providers/fake.ts';

const SOURCE = `# Recursion\n${'A sentence about the call stack and base cases. '.repeat(200)}`;

function providers(opts: { failVerifyFor?: string[]; neverCachePrefix?: boolean } = {}) {
  return {
    generator: new FakeProvider({ family: 'gemini', ...opts }),
    // Different family on purpose — a model cannot verify its own output.
    verifier: new FakeProvider({ family: 'claude', ...opts }),
  };
}

function input(over: Partial<PipelineInput> = {}): PipelineInput {
  return {
    domainSlug: 'emerging-tech',
    sourceKind: 'url',
    uri: 'https://example.test/recursion',
    rawText: SOURCE,
    license: 'CC-BY-4.0',
    ...over,
  };
}

beforeEach(() => resetIds());

test('low-risk source produces a published path end to end', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');

  const r = await runPipeline(store, providers(), input(), () => {});

  assert.equal(r.status, 'published');
  assert.equal(r.skillCount, 4);
  assert.equal(r.lessonCount, 4);
  assert.equal(r.exerciseCount, 16);
  assert.deepEqual(r.blocked, []);

  const published = await store.listPublishedPaths();
  assert.equal(published.length, 1);
  assert.equal(published[0]?.title, 'Recursion, end to end');
});

test('path items are in topological order — prerequisites come first', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');
  const r = await runPipeline(store, providers(), input(), () => {});

  const path = await store.getPath(r.pathId);
  const order = path?.itemSkillIds ?? [];
  const titleAt = (i: number) => store.skills.get(order[i] ?? '')?.slug;

  // call-stack -> base-case -> write-recursion -> tail-calls
  assert.equal(titleAt(0), 'call-stack');
  assert.ok(order.indexOf(order[1] ?? '') < order.indexOf(order[2] ?? ''));
  assert.equal(titleAt(3), 'tail-calls');
});

// The rule from docs/07-risks.md, proven through the whole pipeline rather than
// just at the gate function.
test('HIGH-risk domain blocks publication even when verification passes', async () => {
  const store = new MemoryStore();
  store.seedDomain('school-curriculum', 'K-12', 'high');

  const r = await runPipeline(store, providers(), input({ domainSlug: 'school-curriculum' }), () => {});

  assert.equal(r.status, 'blocked');
  assert.equal(r.blocked.length, 4, 'every lesson needs human approval');
  assert.ok(r.blocked.every((b) => b.refusals.some((f) => f.code === 'needs_human_approval')));
  assert.equal((await store.listPublishedPaths()).length, 0);

  const queue = await store.listReviewQueue();
  assert.equal(queue.length, 4);
  assert.ok(queue.every((q) => q.reason === 'high_risk'));
});

test('medium-risk domain publishes but is sampled into the review queue', async () => {
  const store = new MemoryStore();
  store.seedDomain('exam-prep', 'Exam Prep', 'medium');

  const r = await runPipeline(store, providers(), input({ domainSlug: 'exam-prep' }), () => {});

  assert.equal(r.status, 'published');
  assert.equal(r.sampledForReview.length, 4);
  assert.ok((await store.listReviewQueue()).every((q) => q.reason === 'sampled'));
});

test('a failed verification blocks the path and queues the lesson', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');

  const r = await runPipeline(store, providers({ failVerifyFor: ['base-case'] }), input(), () => {});

  assert.equal(r.status, 'blocked');
  assert.equal(r.blocked.length, 1);
  assert.ok(r.blocked[0]?.refusals.some((f) => f.code === 'not_verified'));
  // Conservative on purpose: a path with a hole teaches a broken prerequisite chain.
  assert.equal((await store.listPublishedPaths()).length, 0);
});

// docs/05-economics.md: generate once, serve forever. A re-run must cost nothing.
test('re-running on an unchanged source is free and does not duplicate content', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');

  const first = await runPipeline(store, providers(), input(), () => {});
  assert.ok(first.costUsd > 0, 'the first run must actually cost something');

  const second = await runPipeline(store, providers(), input(), () => {});
  assert.equal(second.costUsd, 0, 'a re-run must be free');
  assert.equal(second.lessonCount, 4);
  assert.equal(store.lessons.size, 4, 'no duplicate lessons');
  assert.equal(store.paths.size, 1, 'no duplicate path row — paths.slug is unique');
  assert.equal(store.skills.size, 4, 'skills were reused, not re-created');
});

test('the source prefix is reused across lessons, so prompt caching engages', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');
  const p = providers();

  await runPipeline(store, p, input(), () => {});

  const draftCalls = p.generator.calls.filter((c) => c.stage === 'draft');
  assert.equal(draftCalls.length, 4);
  // Every draft call carries the same long prefix and differs only in the suffix.
  assert.equal(new Set(draftCalls.map((c) => c.prefixLen)).size, 1);
  assert.equal(new Set(draftCalls.map((c) => c.suffix)).size, 4);
});

test('a cold prompt prefix is counted and warned about, not swallowed', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');
  const warnings: string[] = [];

  const r = await runPipeline(
    store,
    providers({ neverCachePrefix: true }),
    input(),
    (m) => warnings.push(m),
  );

  assert.ok(r.stats.coldPrefixCalls > 0);
  assert.ok(warnings.some((w) => w.includes('prompt cache miss')));
});

test('verification sees only the cited spans, never the full source', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');
  const p = providers();

  await runPipeline(store, p, input(), () => {});

  const verifyCalls = p.verifier.calls.filter((c) => c.stage === 'verify');
  assert.equal(verifyCalls.length, 4);
  // A verifier handed the whole source (or the draft's reasoning) will agree with it.
  assert.ok(
    verifyCalls.every((c) => c.prefixLen < SOURCE.length / 10),
    'the verifier prefix must be the citations, not the source',
  );
});

test('a generator and verifier of the same family is refused', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');

  await assert.rejects(
    () =>
      runPipeline(
        store,
        { generator: new FakeProvider({ family: 'gemini' }), verifier: new FakeProvider({ family: 'gemini' }) },
        input(),
        () => {},
      ),
    /cannot independently verify its own output/,
  );
});

test('an unknown licence stops the pipeline before anything is reproduced', async () => {
  const store = new MemoryStore();
  store.seedDomain('emerging-tech', 'Emerging Tech', 'low');

  await assert.rejects(
    () => runPipeline(store, providers(), input({ license: null }), () => {}),
    /unknown licence/,
  );
  assert.equal(store.lessons.size, 0);
});

test('an unknown domain is rejected', async () => {
  const store = new MemoryStore();
  await assert.rejects(
    () => runPipeline(store, providers(), input({ domainSlug: 'nope' }), () => {}),
    /unknown domain/,
  );
});
