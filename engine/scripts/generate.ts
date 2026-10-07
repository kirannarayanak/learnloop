/**
 * Run the real pipeline against a real source.
 *
 *   npm run generate -- --url https://example.com/docs --domain emerging-tech
 *   npm run generate -- --file ./notes.md --domain exam-prep --license CC-BY-4.0
 *   npm run generate -- --file ./notes.md --domain emerging-tech --dry-run
 *
 * This spends real money. It prints what it will cost to attempt and asks for
 * confirmation unless --yes is passed, because a mistyped flag over a long document is a
 * surprising bill rather than a surprising error.
 */

import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { runPipeline } from '../pipeline.ts';
import { MemoryStore } from '../store/memory.ts';
import { fakeProviders, hasRealCredentials, realProviders } from '../providers/index.ts';
import { routing } from '../providers/routing.ts';
import type { RiskTier, SourceKind } from '../store/types.ts';

interface Args {
  url?: string;
  file?: string;
  domain: string;
  license: string;
  risk: RiskTier;
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => {
    const at = argv.indexOf(`--${name}`);
    return at === -1 ? undefined : argv[at + 1];
  };
  const has = (name: string): boolean => argv.includes(`--${name}`);

  const domain = get('domain');
  if (domain === undefined) {
    throw new Error('--domain is required (e.g. --domain emerging-tech)');
  }
  const risk = (get('risk') ?? 'low') as RiskTier;
  if (!['low', 'medium', 'high'].includes(risk)) {
    throw new Error(`--risk must be low, medium or high (got '${risk}')`);
  }

  const url = get('url');
  const file = get('file');
  if (url === undefined && file === undefined) {
    throw new Error('one of --url or --file is required');
  }

  return {
    ...(url !== undefined ? { url } : {}),
    ...(file !== undefined ? { file } : {}),
    domain,
    // An unknown licence means cite-and-link only, so the pipeline would refuse anyway.
    // Making it explicit here forces the decision up front.
    license: get('license') ?? 'CC-BY-4.0',
    risk,
    dryRun: has('dry-run'),
    yes: has('yes'),
  };
}

/** Crude HTML to text. Good enough to feed a model; not a parser. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function loadSource(args: Args): Promise<{ text: string; kind: SourceKind; uri: string | null }> {
  if (args.file !== undefined) {
    return { text: readFileSync(args.file, 'utf8'), kind: 'manual', uri: null };
  }
  const url = args.url as string;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`fetching ${url} failed: ${response.status} ${response.statusText}`);
  }
  const body = await response.text();
  const isHtml = (response.headers.get('content-type') ?? '').includes('html');
  return { text: isHtml ? htmlToText(body) : body, kind: 'url', uri: url };
}

/** Order-of-magnitude estimate so the confirmation prompt means something. */
function estimateCostUsd(sourceChars: number): number {
  const sourceTokens = sourceChars / 4;
  const SKILLS = 8;

  // Graph: one pass over the source.
  const graph = (sourceTokens * routing.graph.inputPerMTok + 3000 * routing.graph.outputPerMTok) / 1e6;

  // Draft: one pass per skill. The source is the cached prefix after the first call,
  // which is the single biggest lever on this number.
  const readMultiplier = routing.draft.caching?.readMultiplier ?? 0.1;
  const draftFirst = (sourceTokens * routing.draft.inputPerMTok + 4000 * routing.draft.outputPerMTok) / 1e6;
  const draftRest =
    ((SKILLS - 1) * (sourceTokens * routing.draft.inputPerMTok * readMultiplier + 4000 * routing.draft.outputPerMTok)) / 1e6;

  // Verify: small input (citations only) per skill, on the expensive model.
  const verify = (SKILLS * (2000 * routing.verify.inputPerMTok + 800 * routing.verify.outputPerMTok)) / 1e6;

  return graph + draftFirst + draftRest + verify;
}

async function confirm(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return answer.trim().toLowerCase().startsWith('y');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const source = await loadSource(args);

  const useReal = hasRealCredentials();
  const estimate = estimateCostUsd(source.text.length);

  console.log(`source:    ${args.file ?? args.url} (${source.text.length.toLocaleString()} chars)`);
  console.log(`domain:    ${args.domain} (risk: ${args.risk})`);
  console.log(`licence:   ${args.license}`);
  console.log(`models:    graph=${routing.graph.id} draft=${routing.draft.id} verify=${routing.verify.id}`);
  console.log(`providers: ${useReal ? 'REAL — this spends money' : 'FAKE — no credentials found, nothing will be spent'}`);
  console.log(`estimate:  ~$${estimate.toFixed(3)} (order of magnitude, not a quote)`);

  if (args.dryRun) {
    console.log('\n--dry-run: stopping before any model call.');
    return;
  }

  if (useReal && !args.yes && !(await confirm('\nProceed?'))) {
    console.log('Aborted. Nothing was spent.');
    return;
  }

  const store = new MemoryStore();
  store.seedDomain(args.domain, args.domain, args.risk);

  const started = Date.now();
  const result = await runPipeline(
    store,
    useReal ? realProviders() : fakeProviders(),
    {
      domainSlug: args.domain,
      sourceKind: source.kind,
      uri: source.uri,
      rawText: source.text,
      license: args.license,
    },
  );

  console.log(`\n--- ${result.status} in ${((Date.now() - started) / 1000).toFixed(1)}s ---`);
  console.log(`skills:    ${result.skillCount}`);
  console.log(`lessons:   ${result.lessonCount}`);
  console.log(`exercises: ${result.exerciseCount}`);
  console.log(`cost:      $${result.costUsd.toFixed(4)} (${result.stats.hits}/${result.stats.calls} cache hits)`);

  if (result.stats.coldPrefixCalls > 0) {
    console.log(
      `WARNING:   ${result.stats.coldPrefixCalls} repeated prefix(es) were not cached — ` +
        `that is roughly a 10x cost regression, see docs/05-economics.md`,
    );
  }

  if (result.blocked.length > 0) {
    console.log(`\nblocked (${result.blocked.length}):`);
    for (const b of result.blocked) {
      console.log(`  ${b.lessonId}: ${b.refusals.map((r) => r.code).join(', ')}`);
    }
  }

  // Print the first lesson so the output can actually be judged, which is the point of
  // running this at all.
  const lessons = await store.getLessonsForPath(result.pathId);
  const first = lessons[0];
  if (first !== undefined) {
    console.log(`\n--- first lesson: ${first.title} ---`);
    console.log(first.blocks.map((b, i) => `  ${i + 1}. ${b.type}`).join('\n'));
  }
}

await main();
