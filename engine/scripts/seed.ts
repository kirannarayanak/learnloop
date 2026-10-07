/**
 * Build a content snapshot for the web app by running the real pipeline.
 *
 * Wave 0 has no database yet, so `web/` reads this JSON where it will later read
 * Postgres. The point is that the app is fed by the actual pipeline — the gate, the
 * topological ordering and the review queue in the UI are real outputs, not fixtures.
 *
 *   npm run seed    (from engine/)
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runPipeline } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';
import { FakeProvider } from '../providers/fake.ts';
import type { RiskTier } from '../store/types.ts';

const OUT = resolve(import.meta.dirname, '../../web/lib/seed.json');

/** Stand-in source text. Long enough that prompt caching is worth measuring. */
function source(topic: string, detail: string): string {
  return `# ${topic}\n\n${(detail + ' ').repeat(120)}`;
}

const SOURCES: {
  domainSlug: string;
  domainTitle: string;
  riskTier: RiskTier;
  topic: string;
  detail: string;
  uri: string;
  /** Use the hand-authored golden lesson for this source's first skill. */
  golden?: boolean;
}[] = [
  {
    domainSlug: 'emerging-tech',
    domainTitle: 'Emerging Tech for Working Engineers',
    riskTier: 'low',
    topic: 'Agent tool-calling loops',
    detail: 'A tool-calling loop sends a request, executes the returned tool call, appends the result, and repeats until the model stops asking.',
    uri: 'https://example.test/agents',
    golden: true,
  },
  {
    domainSlug: 'fintech-eng',
    domainTitle: 'Fintech & Payments Engineering',
    riskTier: 'medium',
    topic: 'ISO 20022 message flow',
    detail: 'An ISO 20022 payment carries structured remittance data through pacs.008 and is acknowledged by pacs.002 with a status reason code.',
    uri: 'https://example.test/iso20022',
  },
  {
    domainSlug: 'exam-prep',
    domainTitle: 'Competitive Exam Preparation',
    riskTier: 'medium',
    topic: 'Rotational motion',
    detail: 'Angular momentum is conserved when no external torque acts on a system, which is why a spinning skater speeds up on pulling their arms in.',
    uri: 'https://example.test/rotational-motion',
  },
  {
    domainSlug: 'school-curriculum',
    domainTitle: 'School Curriculum (K-12)',
    riskTier: 'high',
    topic: 'Photosynthesis',
    detail: 'Photosynthesis converts light energy into chemical energy, storing it in glucose and releasing oxygen as a by-product.',
    uri: 'https://example.test/photosynthesis',
  },
];

async function main(): Promise<void> {
  const store = new MemoryStore();

  const paths: unknown[] = [];
  const lessons: Record<string, unknown> = {};
  const exercises: Record<string, unknown[]> = {};
  const pending: unknown[] = [];
  let totalCost = 0;

  for (const s of SOURCES) {
    const domain = store.seedDomain(s.domainSlug, s.domainTitle, s.riskTier);

    // One source gets the hand-authored golden lesson, so the app shows what the
    // generator is AIMED at rather than only its scaffolding. The rest get the generic
    // block structure, which exercises the renderer and the structural validator.
    const providers = {
      generator: new FakeProvider(
        s.golden === true
          ? { family: 'gemini' as const, goldenForSlug: 'call-stack' }
          : { family: 'gemini' as const },
      ),
      verifier: new FakeProvider({ family: 'claude' as const }),
    };

    const result = await runPipeline(store, providers, {
      domainSlug: s.domainSlug,
      sourceKind: 'url',
      uri: s.uri,
      rawText: source(s.topic, s.detail),
      license: 'CC-BY-4.0',
    });
    totalCost += result.costUsd;

    const path = await store.getPath(result.pathId);
    if (path === undefined) continue;

    // A high-risk domain is blocked pending human approval. The UI shows that
    // honestly rather than hiding it — it is the gate working, not an error.
    if (result.status === 'blocked') {
      pending.push({
        title: path.title,
        domainTitle: s.domainTitle,
        riskTier: s.riskTier,
        lessonCount: result.blocked.length,
        reason: result.blocked[0]?.refusals[0]?.code ?? 'unknown',
      });
      continue;
    }

    const pathLessons = await store.getLessonsForPath(path.id);
    const items = [];

    for (const skillId of path.itemSkillIds) {
      const skill = store.skills.get(skillId);
      const lesson = pathLessons.find((l) => l.skillId === skillId);
      if (skill === undefined || lesson === undefined) continue;

      const ex = await store.getExercisesForLesson(lesson.id);
      const citations = await store.getCitations(lesson.id);

      items.push({
        skillId,
        skillTitle: skill.title,
        statement: skill.statement,
        estMinutes: skill.estMinutes,
        lessonId: lesson.id,
        exerciseCount: ex.length,
        // Hard prerequisites gate CREDIT, never access (docs/10-motivation.md finding 2).
        hardPrereqs: store.edges
          .filter((e) => e.skillId === skillId && e.strength >= 0.9)
          .map((e) => e.prereqId),
      });

      lessons[lesson.id] = {
        id: lesson.id,
        skillId,
        title: lesson.title,
        bodyMd: lesson.bodyMd,
        blocks: lesson.blocks,
        estMinutes: lesson.estMinutes,
        verifyState: lesson.verifyState,
        genModel: lesson.genModel,
        citations: citations.map((c) => ({ quote: c.quote })),
        sampledForReview: result.sampledForReview.includes(lesson.id),
      };
      exercises[lesson.id] = ex.map((e) => ({
        id: e.id,
        kind: e.kind,
        promptMd: e.promptMd,
        answer: e.answer,
        explanationMd: e.explanationMd,
        difficulty: e.difficulty,
      }));
    }

    paths.push({
      id: path.id,
      slug: path.slug,
      title: path.title,
      summary: path.summary,
      domainSlug: s.domainSlug,
      domainTitle: s.domainTitle,
      riskTier: s.riskTier,
      sourceUri: s.uri,
      items,
    });
  }

  const snapshot = {
    generatedAt: new Date().toISOString(),
    costUsd: Number(totalCost.toFixed(6)),
    reviewQueueSize: (await store.listReviewQueue()).length,
    paths,
    lessons,
    exercises,
    pendingReview: pending,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(
    `seeded ${paths.length} published path(s), ${Object.keys(lessons).length} lessons, ` +
      `${pending.length} blocked pending review, $${totalCost.toFixed(4)} of generation`,
  );
}

await main();
