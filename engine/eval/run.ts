/**
 * The eval runner.
 *
 *   npm run eval -- --dry-run              estimate only, spends nothing
 *   npm run eval                           generate + free deterministic graders
 *   npm run eval -- --judge                adds the paid rubric judge
 *   npm run eval -- --judge --budget 5     raise the cap
 *   npm run eval -- --full                 all 8 cases (costs more than the default budget)
 *   npm run eval -- --cases closures-js,iso-20022
 *
 * Without API keys it runs the fake providers end to end, so the harness itself is
 * testable for free. The numbers are then about the harness, not the generator, and the
 * output says so.
 *
 * The budget is a HARD stop checked before each case, not a warning afterwards. An eval
 * that can surprise you with a bill is an eval you hesitate to run, and one you hesitate
 * to run does not get run — which defeats the entire point of having it.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { runPipeline } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';
import { fakeProviders, hasRealCredentials, realProviders } from '../providers/index.ts';
import { routing } from '../providers/routing.ts';
import { EVAL_CASES, SMOKE_CASES, loadCaseText, type EvalCase } from './cases.ts';
import {
  JUDGE_SCHEMA, JUDGE_SYSTEM, gradeDeterministic, judgeOverall, judgePrompt,
  type DeterministicGrades, type JudgeScores,
} from './graders.ts';
import type { Provider } from '../providers/types.ts';
import type { LessonBlock } from '../stages/blocks.ts';

interface Options {
  dryRun: boolean;
  judge: boolean;
  budgetUsd: number;
  caseIds: string[] | null;
  full: boolean;
}

function parseOptions(argv: readonly string[]): Options {
  const get = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const ids = get('cases');
  return {
    dryRun: argv.includes('--dry-run'),
    judge: argv.includes('--judge'),
    budgetUsd: Number(get('budget') ?? 2),
    caseIds: ids === undefined ? null : ids.split(',').map((s) => s.trim()),
    full: argv.includes('--full'),
  };
}

interface LessonResult {
  caseId: string;
  skillId: string;
  skillStatement: string;
  lessonTitle: string;
  blockTypes: string[];
  deterministic: DeterministicGrades;
  judge?: JudgeScores;
  judgeOverall?: number;
}

interface CaseResult {
  caseId: string;
  domainSlug: string;
  riskTier: string;
  status: 'published' | 'blocked' | 'error';
  /** For a high-risk case, being blocked is the CORRECT outcome. */
  gateCorrect: boolean;
  error?: string;
  skillCount: number;
  costUsd: number;
  lessons: LessonResult[];
  deterministicMean: number;
  judgeMean?: number;
}

/** Order-of-magnitude, used for the pre-flight estimate and the budget check. */
function estimateCaseCostUsd(sourceChars: number, withJudge: boolean): number {
  const sourceTokens = sourceChars / 4;
  const SKILLS = 7;
  const readMul = routing.draft.caching?.readMultiplier ?? 0.1;

  const graph = (sourceTokens * routing.graph.inputPerMTok + 3000 * routing.graph.outputPerMTok) / 1e6;
  const draft =
    (sourceTokens * routing.draft.inputPerMTok + 4000 * routing.draft.outputPerMTok) / 1e6 +
    ((SKILLS - 1) * (sourceTokens * routing.draft.inputPerMTok * readMul + 4000 * routing.draft.outputPerMTok)) / 1e6;
  const verify = (SKILLS * (2000 * routing.verify.inputPerMTok + 800 * routing.verify.outputPerMTok)) / 1e6;
  // The judge reads the source once per case (cached after) plus the lesson each time.
  const judge = withJudge
    ? (sourceTokens * routing.verify.inputPerMTok +
        SKILLS * (sourceTokens * routing.verify.inputPerMTok * readMul + 3000 * routing.verify.inputPerMTok / 3 + 600 * routing.verify.outputPerMTok)) / 1e6
    : 0;

  return graph + draft + verify + judge;
}

async function judgeLesson(
  provider: Provider,
  sourceExcerpt: string,
  skillStatement: string,
  blocks: readonly LessonBlock[],
): Promise<{ scores: JudgeScores; costUsd: number }> {
  const result = await provider.generate<JudgeScores>(
    {
      stage: 'verify',
      system: JUDGE_SYSTEM,
      ...judgePrompt(sourceExcerpt, skillStatement, blocks),
      schema: JUDGE_SCHEMA,
      maxOutputTokens: 4000,
    },
    routing.verify,
  );
  return { scores: result.output, costUsd: result.usage.costUsd };
}

async function runCase(
  evalCase: EvalCase,
  useReal: boolean,
  withJudge: boolean,
): Promise<CaseResult> {
  const sourceText = loadCaseText(evalCase);
  const store = new MemoryStore();
  store.seedDomain(evalCase.domainSlug, evalCase.domainTitle, evalCase.riskTier);

  const providers = useReal ? realProviders(() => {}) : fakeProviders();

  const base: Omit<CaseResult, 'status' | 'gateCorrect' | 'skillCount' | 'costUsd' | 'lessons' | 'deterministicMean'> = {
    caseId: evalCase.id,
    domainSlug: evalCase.domainSlug,
    riskTier: evalCase.riskTier,
  };

  let result;
  try {
    result = await runPipeline(
      store,
      providers,
      {
        domainSlug: evalCase.domainSlug,
        sourceKind: 'url',
        uri: evalCase.sourceUrl,
        rawText: sourceText,
        license: evalCase.license,
      },
      () => {},
    );
  } catch (error) {
    return {
      ...base,
      status: 'error',
      gateCorrect: false,
      error: error instanceof Error ? error.message : String(error),
      skillCount: 0,
      costUsd: 0,
      lessons: [],
      deterministicMean: 0,
    };
  }

  // A high-risk domain MUST be blocked. Scoring well and publishing is a failure.
  const gateCorrect =
    evalCase.riskTier === 'high' ? result.status === 'blocked' : result.status === 'published';

  const lessonRecords = [...store.lessons.values()];
  const lessons: LessonResult[] = [];
  let judgeCost = 0;

  for (const lesson of lessonRecords) {
    const skill = store.skills.get(lesson.skillId);
    const citations = await store.getCitations(lesson.id);
    const deterministic = gradeDeterministic(lesson.blocks, citations, sourceText);

    const entry: LessonResult = {
      caseId: evalCase.id,
      skillId: lesson.skillId,
      skillStatement: skill?.statement ?? '',
      lessonTitle: lesson.title,
      blockTypes: lesson.blocks.map((b) => b.type),
      deterministic,
    };

    // The judge only sees what already passed the free checks — spending a judge call on
    // a lesson with fabricated citations tells you nothing you did not already know.
    if (withJudge && useReal && deterministic.overall > 0.5) {
      const judged = await judgeLesson(
        providers.verifier,
        sourceText,
        entry.skillStatement,
        lesson.blocks,
      );
      judgeCost += judged.costUsd;
      entry.judge = judged.scores;
      entry.judgeOverall = judgeOverall(judged.scores);
    }

    lessons.push(entry);
  }

  const judged = lessons.filter((l) => l.judgeOverall !== undefined);

  return {
    ...base,
    status: result.status,
    gateCorrect,
    skillCount: result.skillCount,
    costUsd: result.costUsd + judgeCost,
    lessons,
    deterministicMean:
      lessons.length === 0 ? 0 : lessons.reduce((s, l) => s + l.deterministic.overall, 0) / lessons.length,
    ...(judged.length > 0
      ? { judgeMean: judged.reduce((s, l) => s + (l.judgeOverall ?? 0), 0) / judged.length }
      : {}),
  };
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const pool = options.full || options.caseIds !== null ? EVAL_CASES : SMOKE_CASES;
  const cases = pool.filter((c) => options.caseIds === null || options.caseIds.includes(c.id));
  if (cases.length === 0) throw new Error('no cases matched --cases');

  const useReal = hasRealCredentials();
  const estimates = cases.map((c) => estimateCaseCostUsd(loadCaseText(c).length, options.judge));
  const totalEstimate = estimates.reduce((a, b) => a + b, 0);

  console.log(
    `cases:     ${cases.length}${options.full ? ' (full set)' : ' (smoke set — use --full for all 8)'}: ` +
      cases.map((c) => c.id).join(', '),
  );
  console.log(`graders:   deterministic${options.judge ? ' + rubric judge (paid)' : ' only (free)'}`);
  console.log(`providers: ${useReal ? 'REAL — this spends money' : 'FAKE — no credentials, nothing will be spent'}`);
  console.log(`estimate:  ~$${totalEstimate.toFixed(2)} of a $${options.budgetUsd.toFixed(2)} budget`);

  if (options.dryRun) {
    console.log('\n--dry-run: stopping before any model call.');
    return;
  }
  if (useReal && totalEstimate > options.budgetUsd) {
    throw new Error(
      `estimated $${totalEstimate.toFixed(2)} exceeds the $${options.budgetUsd.toFixed(2)} budget. ` +
        `Raise it with --budget, or narrow with --cases.`,
    );
  }

  const results: CaseResult[] = [];
  let spent = 0;

  for (const [i, evalCase] of cases.entries()) {
    // Hard stop BEFORE the call, using what has actually been spent so far plus this
    // case's estimate — not a post-hoc apology.
    const projected = spent + (estimates[i] ?? 0);
    if (useReal && projected > options.budgetUsd) {
      console.log(`\nstopping at ${results.length}/${cases.length} cases: next would reach $${projected.toFixed(2)}`);
      break;
    }

    process.stdout.write(`  ${evalCase.id}... `);
    const result = await runCase(evalCase, useReal, options.judge);
    spent += result.costUsd;
    results.push(result);

    const gate = result.gateCorrect ? 'gate ok' : 'GATE WRONG';
    console.log(
      `${result.status}, ${result.skillCount} skills, det ${pct(result.deterministicMean)}` +
        `${result.judgeMean !== undefined ? `, judge ${pct(result.judgeMean)}` : ''}, ${gate}, $${result.costUsd.toFixed(4)}`,
    );
  }

  // --- report
  const outDir = resolve(import.meta.dirname, 'results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  writeFileSync(
    resolve(outDir, `${stamp}.jsonl`),
    results.map((r) => JSON.stringify(r)).join('\n') + '\n',
  );

  const graded = results.filter((r) => r.status !== 'error');
  const detMean = graded.length === 0 ? 0 : graded.reduce((s, r) => s + r.deterministicMean, 0) / graded.length;
  const judgedCases = results.filter((r) => r.judgeMean !== undefined);
  const gateFailures = results.filter((r) => !r.gateCorrect);

  console.log(`\n--- ${results.length} case(s), $${spent.toFixed(4)} spent ---`);
  console.log(`deterministic: ${pct(detMean)}`);
  if (judgedCases.length > 0) {
    console.log(
      `rubric judge:  ${pct(judgedCases.reduce((s, r) => s + (r.judgeMean ?? 0), 0) / judgedCases.length)}`,
    );
  }

  // The gate is pass/fail, never an average. One high-risk lesson published without
  // human approval is a failed run regardless of how well everything else scored.
  if (gateFailures.length > 0) {
    console.log(`\nGATE FAILURES (${gateFailures.length}) — these are not score problems:`);
    for (const f of gateFailures) {
      console.log(`  ${f.caseId} (${f.riskTier}): expected ${f.riskTier === 'high' ? 'blocked' : 'published'}, got ${f.status}${f.error !== undefined ? ` — ${f.error}` : ''}`);
    }
  }

  const worst = graded
    .flatMap((r) => r.lessons)
    .filter((l) => l.deterministic.overall < 1)
    .sort((a, b) => a.deterministic.overall - b.deterministic.overall)
    .slice(0, 5);

  if (worst.length > 0) {
    console.log('\nworst-scoring lessons:');
    for (const l of worst) {
      const notes = Object.values(l.deterministic)
        .filter((g): g is { score: number; notes: string[] } => typeof g === 'object')
        .flatMap((g) => g.notes);
      console.log(`  ${pct(l.deterministic.overall)} ${l.caseId} — ${l.lessonTitle}`);
      for (const n of notes.slice(0, 2)) console.log(`      ${n}`);
    }
  }

  console.log(`\nresults: engine/eval/results/${stamp}.jsonl`);
  if (gateFailures.length > 0) process.exitCode = 1;
}

await main();
