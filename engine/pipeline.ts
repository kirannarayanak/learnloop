/**
 * The pipeline: one source in, one published path out.
 *
 *   ingest -> graph -> draft -> verify -> publish
 *
 * Design rules this file exists to honour (docs/04-content-pipeline.md):
 *   - The source material is the STABLE prompt prefix, shared by every lesson drafted
 *     from it. The volatile per-skill part goes in the suffix. Reversing these costs
 *     ~10x and nothing errors.
 *   - Verification sees ONLY the cited spans, never the draft's own reasoning. A
 *     verifier handed the draft's justification will agree with it.
 *   - A cycle in the prerequisite graph FAILS the job. It is data corruption.
 *   - Nothing publishes except through the gate.
 */

import { validateSkillGraph, type SkillEdge } from './graph/validate.ts';
import { evaluatePublishGate, type LessonForPublish, type Refusal } from './publish/gate.ts';
import { generateCached, newStats, type CacheStats } from './cache/content-cache.ts';
import { assertVerifierIndependence, routing } from './providers/routing.ts';
import type { Provider } from './providers/types.ts';
import { blocksToPlainText, exercisesFromBlocks, validateLessonStructure } from './stages/blocks.ts';
import { parseDraft } from './stages/parse.ts';
import {
  DRAFT_SCHEMA, DRAFT_SYSTEM, GRAPH_SCHEMA, GRAPH_SYSTEM, VERIFY_SCHEMA, VERIFY_SYSTEM,
  draftPrompt, graphPrompt, verifyPrompt,
} from './stages/prompts.ts';
import {
  assertSkillStatements,
  PROMPT_VERSION,
  type DraftOutput,
  type GraphOutput,
  type VerifyOutput,
} from './stages/schema.ts';
import { contentHash } from './store/memory.ts';
import type { LessonRecord, SourceKind, Store } from './store/types.ts';

export interface PipelineInput {
  domainSlug: string;
  sourceKind: SourceKind;
  uri: string | null;
  /** Already-fetched source text. Fetching is the caller's job, not the pipeline's. */
  rawText: string;
  /** null = unknown licence. The pipeline will refuse to reproduce it. */
  license: string | null;
  locale?: string;
}

export interface PipelineResult {
  pathId: string;
  status: 'published' | 'blocked';
  skillCount: number;
  lessonCount: number;
  exerciseCount: number;
  /** Lessons the gate refused, with reasons. Non-empty means status is 'blocked'. */
  blocked: { lessonId: string; skillId: string; refusals: Refusal[] }[];
  /** Lessons that published but were sampled into the human review queue. */
  sampledForReview: string[];
  stats: CacheStats;
  costUsd: number;
}

export interface Providers {
  /** Handles ingest, graph, draft, translate. */
  generator: Provider;
  /** MUST be a different family than `generator`. See assertVerifierIndependence(). */
  verifier: Provider;
}

export async function runPipeline(
  store: Store,
  providers: Providers,
  input: PipelineInput,
  log: (msg: string) => void = console.warn,
): Promise<PipelineResult> {
  // Fail here, loudly, rather than silently shipping self-approved content.
  assertVerifierIndependence();
  if (providers.verifier.family === providers.generator.family) {
    throw new Error(
      `verifier family '${providers.verifier.family}' matches the generator's; a model ` +
        `cannot independently verify its own output`,
    );
  }

  const locale = input.locale ?? 'en';
  const stats = newStats();

  const domain = await store.getDomainBySlug(input.domainSlug);
  if (domain === undefined) throw new Error(`unknown domain '${input.domainSlug}'`);

  // ===================================================================== 1. ingest
  const hash = contentHash(input.rawText);
  const source = await store.upsertSource({
    kind: input.sourceKind,
    uri: input.uri,
    title: null,
    license: input.license,
    contentHash: hash,
    retrievedAt: new Date().toISOString(),
  });

  // The licence gate. An unknown licence means we may cite and link but never
  // reproduce — so there is nothing for the draft stage to do.
  if (source.license === null) {
    throw new Error(
      `source ${source.id} has an unknown licence; it may be cited and linked but not ` +
        `reproduced (docs/07-risks.md)`,
    );
  }

  // This is the stable prefix for every subsequent call about this source.
  const sourcePrefix = input.rawText;

  // ====================================================================== 2. graph
  const graphResult = await generateCached<GraphOutput>(
    store,
    providers.generator,
    routing.graph,
    {
      stage: 'graph',
      system: GRAPH_SYSTEM,
      ...graphPrompt(sourcePrefix, domain.title),
      schema: GRAPH_SCHEMA,
      maxOutputTokens: 8000,
      batchable: true,
    },
    stats,
    log,
  );
  const graph = graphResult.output;

  // A vague statement ("understand recursion") can't be tested, so the exercise
  // generator and the mastery model would both have nothing to key off.
  assertSkillStatements(graph.skills);

  // Dedupe against the existing graph. Without this the graph fragments into
  // near-duplicates, mastery stops transferring, and the whole skills-primary
  // model collapses into a course catalogue (docs/03-data-model.md).
  const slugToId = new Map<string, string>();
  const freshSkills: { slug: string; rec: Omit<import('./store/types.ts').SkillRecord, 'id'> }[] = [];

  for (const s of graph.skills) {
    const existing = await store.findSimilarSkill(domain.id, s.statement);
    if (existing !== undefined) {
      slugToId.set(s.slug, existing.id);
      continue;
    }
    freshSkills.push({
      slug: s.slug,
      rec: {
        domainId: domain.id,
        slug: s.slug,
        title: s.title,
        statement: s.statement,
        estMinutes: s.estMinutes,
      },
    });
  }

  const inserted = await store.insertSkills(freshSkills.map((f) => f.rec));
  freshSkills.forEach((f, i) => {
    const rec = inserted[i];
    if (rec !== undefined) slugToId.set(f.slug, rec.id);
  });

  // Resolve slug edges to ids, dropping any that reference an unknown slug — the
  // validator will report those as problems rather than letting them pass silently.
  const edges: SkillEdge[] = [];
  for (const e of graph.edges) {
    const prereqId = slugToId.get(e.prereqSlug);
    const skillId = slugToId.get(e.skillSlug);
    if (prereqId === undefined || skillId === undefined) {
      throw new Error(
        `graph edge references an unknown skill slug: ` +
          `${e.prereqSlug} -> ${e.skillSlug}`,
      );
    }
    edges.push({ prereqId, skillId, strength: e.strength });
  }

  const skillIds = [...slugToId.values()];
  const validation = validateSkillGraph(skillIds, edges);
  if (!validation.ok || validation.order === undefined) {
    throw new Error(
      `prerequisite graph is invalid, refusing to build a path: ` +
        validation.problems.map((p) => p.detail).join('; '),
    );
  }
  await store.insertEdges(edges);

  // Reuse the row on a re-run: paths.slug is unique, and the freshness cron re-runs
  // this pipeline on every source change.
  const pathSlug = `${input.domainSlug}-${hash.slice(0, 8)}`;
  const path =
    (await store.findPathBySlug(pathSlug)) ??
    (await store.insertPath({
      domainId: domain.id,
      slug: pathSlug,
      title: graph.pathTitle,
      summary: graph.pathSummary,
      locale,
      status: 'draft',
      promptVersion: PROMPT_VERSION,
      itemSkillIds: validation.order,
      publishedAt: null,
    }));

  // ============================================================ 3. draft + 4. verify
  const lessons: LessonRecord[] = [];
  let exerciseCount = 0;
  const blocked: PipelineResult['blocked'] = [];
  const sampledForReview: string[] = [];

  for (const skillId of validation.order) {
    const slug = [...slugToId.entries()].find(([, v]) => v === skillId)?.[0];
    if (slug === undefined) continue; // a reused skill from a previous path

    const spec = graph.skills.find((s) => s.slug === slug);
    const skillTitle = spec?.title ?? slug;
    const skillStatement = spec?.statement ?? slug;
    const skillMinutes = spec?.estMinutes ?? 8;
    // Told to the drafter as "assume known", so lessons don't re-teach each other.
    const coveredStatements = lessons
      .map((l) => graph.skills.find((sk) => slugToId.get(sk.slug) === l.skillId)?.statement)
      .filter((x): x is string => x !== undefined);

    // Idempotence: an unchanged source at the same prompt version must not re-draft.
    // Without this the freshness cron would duplicate every lesson on every run.
    const existingLesson = await store.findLesson(skillId, locale, PROMPT_VERSION);
    if (existingLesson !== undefined) {
      lessons.push(existingLesson);
      exerciseCount += (await store.getExercisesForLesson(existingLesson.id)).length;
      continue;
    }

    // --- draft. Source material in the prefix (cached), skill in the suffix.
    const drafted = await generateCached<unknown>(
      store,
      providers.generator,
      routing.draft,
      {
        stage: 'draft',
        tag: slug,
        system: DRAFT_SYSTEM,
        ...draftPrompt(
          sourcePrefix,
          { title: skillTitle, statement: skillStatement, estMinutes: skillMinutes },
          coveredStatements,
        ),
        schema: DRAFT_SCHEMA,
        maxOutputTokens: 16000,
        batchable: true,
      },
      stats,
      log,
    );

    // Everything past this line is typed; everything before it is untrusted model output.
    const draft = parseDraft(drafted.output);

    // A model asked for a "rich lesson" will happily return eight concept blocks in a
    // row, which is a wall of text in a costume. These checks encode
    // docs/11-lesson-design.md: retrieval woven through, at least one constructive
    // block, and narration that does not restate the screen.
    const structureProblems = validateLessonStructure(draft.blocks);
    if (structureProblems.length > 0) {
      throw new Error(
        `lesson for skill '${slug}' is structurally unsound, refusing to draft it: ` +
          structureProblems.map((pb) => `[${pb.code}] ${pb.detail}`).join('; '),
      );
    }

    const lesson = await store.insertLesson({
      skillId,
      locale,
      title: draft.title,
      // Searchable flattening; the blocks are the lesson.
      bodyMd: blocksToPlainText(draft.blocks),
      blocks: draft.blocks,
      estMinutes: draft.estMinutes,
      genModel: routing.draft.id,
      genCostUsd: drafted.usage.costUsd,
      verifyState: 'unverified',
      promptVersion: PROMPT_VERSION,
    });

    await store.insertCitations(
      draft.citations.map((c) => ({ lessonId: lesson.id, sourceId: source.id, quote: c.quote })),
    );

    // Review items come from the lesson's own retrieval blocks rather than a second
    // generated bank — cheaper, and the learner reviews what they actually saw.
    const exercises = await store.insertExercises(
      exercisesFromBlocks(draft.blocks).map((e) => ({
        skillId,
        lessonId: lesson.id,
        locale,
        kind: e.kind,
        promptMd: e.promptMd,
        answer: e.answer,
        explanationMd: e.explanationMd,
        difficulty: e.difficulty,
        verifyState: 'unverified' as const,
      })),
    );
    exerciseCount += exercises.length;

    // --- verify. ONLY the cited spans go in the prefix. The draft's own reasoning is
    // deliberately withheld: a verifier shown the justification will agree with it.
    const verified = await generateCached<VerifyOutput>(
      store,
      providers.verifier,
      routing.verify,
      {
        stage: 'verify',
        tag: slug,
        system: VERIFY_SYSTEM,
        ...verifyPrompt(
          draft.citations.map((c) => c.quote),
          JSON.stringify(draft.blocks),
          skillStatement,
        ),
        schema: VERIFY_SCHEMA,
        maxOutputTokens: 4000,
        batchable: true,
      },
      stats,
      log,
    );
    const v = verified.output;

    const passed = v.claimsSupported && v.answersCorrect && v.teachesSkill;
    await store.updateLessonVerifyState(lesson.id, passed ? 'auto_passed' : 'auto_failed');
    const state = passed ? ('auto_passed' as const) : ('auto_failed' as const);

    // --- gate
    const citations = await store.getCitations(lesson.id);
    const forGate: LessonForPublish = {
      lessonId: lesson.id,
      riskTier: domain.riskTier,
      verifyState: state,
      citedSourceIds: citations.map((c) => c.sourceId),
      unlicensedSourceIds: [],
    };

    const decision = evaluatePublishGate(forGate);
    if (decision.publish) {
      if (decision.sampleForReview) {
        sampledForReview.push(lesson.id);
        await store.enqueueReview({
          entity: 'lesson',
          entityId: lesson.id,
          reason: 'sampled',
          createdAt: new Date().toISOString(),
        });
      }
    } else {
      blocked.push({ lessonId: lesson.id, skillId, refusals: decision.refusals });
      await store.enqueueReview({
        entity: 'lesson',
        entityId: lesson.id,
        reason: domain.riskTier === 'high' ? 'high_risk' : 'auto_failed',
        createdAt: new Date().toISOString(),
      });
    }

    lessons.push({ ...lesson, verifyState: state });
  }

  // ==================================================================== 5. publish
  // Conservative on purpose: a path publishes only when every lesson in it passed the
  // gate. A path with a hole in the middle teaches a prerequisite chain that is
  // actually broken, which is worse than not publishing at all.
  const status: PipelineResult['status'] = blocked.length === 0 ? 'published' : 'blocked';
  if (status === 'published') {
    await store.publishPath(path.id, new Date().toISOString());
  }

  return {
    pathId: path.id,
    status,
    skillCount: skillIds.length,
    lessonCount: lessons.length,
    exerciseCount,
    blocked,
    sampledForReview,
    stats,
    costUsd: stats.costUsd,
  };
}
