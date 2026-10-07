import {
  type Family,
  type ModelRef,
  type Stage,
  VerifierIndependenceError,
} from './types.ts';

/**
 * The ONLY place a model choice lives.
 *
 * Model ids and prices are read from env rather than hard-coded, for two
 * reasons: provider model strings and prices change faster than this repo
 * does, and per-stage A/B testing against the eval set means swapping these
 * without a deploy.
 *
 * Defaults reflect the 2026-10-07 decision (docs/00-decisions.md): Gemini is
 * the primary provider — long context for whole-syllabus ingest, native PDF
 * and video understanding for scanned board syllabi and lecture recordings,
 * and strong Indic-language support for the wave-2 translation layer.
 *
 * VERIFY is deliberately routed elsewhere. See assertVerifierIndependence().
 */

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (v === undefined) throw new Error(`missing required env var ${key}`);
  return v;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`env var ${key} is not a number: ${raw}`);
  return n;
}

/**
 * Prices below were read from provider pricing pages on this date. They drift, and the
 * cost-per-path figure in docs/05-economics.md is only as trustworthy as they are, so
 * `assertPricesConfigured()` complains about anything still at zero.
 */
export const PRICES_CHECKED_ON = '2026-10-07';
export const routing: Record<Stage, ModelRef> = {
  // Long context + native PDF/vision. The whole point of choosing Gemini.
  ingest: {
    family: 'gemini',
    id: env('MODEL_INGEST', 'gemini-3.1-pro-preview'),
    inputPerMTok: num('PRICE_INGEST_IN', 2),
    outputPerMTok: num('PRICE_INGEST_OUT', 12),
    batchDiscount: 0.5,
    // Gemini caches implicitly on 2.5+ models: a reused prefix gets ~90% off with
    // nothing to manage. That is why the pipeline guards prefix stability so carefully.
    caching: { minPrefixTokens: 1024, readMultiplier: 0.1 },
  },

  // The hard reasoning task: decompose into atomic skills, order prerequisites,
  // keep the DAG acyclic. ~5% of tokens, ~90% of the quality outcome — this is
  // the stage never to cheap out on, whichever family wins the eval.
  graph: {
    family: 'gemini',
    id: env('MODEL_GRAPH', 'gemini-3.1-pro-preview'),
    inputPerMTok: num('PRICE_GRAPH_IN', 2),
    outputPerMTok: num('PRICE_GRAPH_OUT', 12),
    batchDiscount: 0.5,
    caching: { minPrefixTokens: 1024, readMultiplier: 0.1 },
  },

  // ~80% of all tokens. Easy and format-bound, so this is the stage to move to
  // a cheaper or open model FIRST — but only once the eval set can prove
  // quality held (docs/09-model-strategy.md).
  draft: {
    family: 'gemini',
    id: env('MODEL_DRAFT', 'gemini-3.8-flash'),
    // VERIFY THESE before trusting any cost figure — Flash pricing was not confirmed
    // when this was written, and these are a placeholder of the right order of
    // magnitude, not a quote. assertPricesConfigured() cannot catch a wrong number,
    // only a missing one.
    inputPerMTok: num('PRICE_DRAFT_IN', 0.3),
    outputPerMTok: num('PRICE_DRAFT_OUT', 2.5),
    batchDiscount: 0.5,
    caching: { minPrefixTokens: 1024, readMultiplier: 0.1 },
  },

  // Correctness gate. MUST be a different family than `draft` — a model
  // checking its own output shares its own blind spots and will approve its
  // own hallucinations. Independence is worth a few cents a path.
  verify: {
    family: (env('MODEL_VERIFY_FAMILY', 'claude') as Family),
    // Opus, not a cheaper tier: verification is ~10% of tokens and 100% of the safety
    // gate. docs/09-model-strategy.md names this the stage never to economise on.
    id: env('MODEL_VERIFY', 'claude-opus-5'),
    inputPerMTok: num('PRICE_VERIFY_IN', 5),
    outputPerMTok: num('PRICE_VERIFY_OUT', 25),
    batchDiscount: 0.5,
    caching: { minPrefixTokens: 2048, readMultiplier: 0.1 },
  },

  translate: {
    family: 'gemini',
    id: env('MODEL_TRANSLATE', 'gemini-3.8-flash'),
    inputPerMTok: num('PRICE_TRANSLATE_IN', 0.3),
    outputPerMTok: num('PRICE_TRANSLATE_OUT', 2.5),
    batchDiscount: 0.5,
    caching: { minPrefixTokens: 1024, readMultiplier: 0.1 },
  },

  // Live and latency-sensitive, and the only cost that grows per-user forever.
  // Self-hosting an open model starts to pay here at ~100k free learners.
  tutor: {
    family: (env('MODEL_TUTOR_FAMILY', 'gemini') as Family),
    id: env('MODEL_TUTOR', 'gemini-3.8-flash'),
    inputPerMTok: num('PRICE_TUTOR_IN', 0.3),
    outputPerMTok: num('PRICE_TUTOR_OUT', 2.5),
    caching: { minPrefixTokens: 1024, readMultiplier: 0.1 },
  },

  // Always open. There is no reason to ever pay for embeddings in this project.
  // `dimensions` must match the vector(N) column in db/schema.sql.
  embed: {
    family: 'open',
    id: env('MODEL_EMBED', 'bge-large-en-v1.5'),
    inputPerMTok: 0,
    outputPerMTok: 0,
  },
};

/**
 * Fail at startup, not at publish time, if the verifier is not independent.
 * Quietly self-approved content is the failure mode in docs/07-risks.md that
 * ends the project, so this is an assertion rather than a warning.
 */
export function assertVerifierIndependence(
  table: Record<Stage, ModelRef> = routing,
): void {
  if (table.verify.family === table.draft.family) {
    throw new VerifierIndependenceError(table.verify.family);
  }
}

/** Embedding dimensions, kept beside the schema's vector(N) for one source of truth. */
export const EMBEDDING_DIMENSIONS = num('EMBED_DIMENSIONS', 1024);

/**
 * Warn about any priced stage still reporting zero.
 *
 * A zero price does not fail a run — it silently reports that generation was free, which
 * is worse than erroring, because cost per path is the number the business model rests on
 * (docs/05-economics.md) and nobody re-checks a figure that looks fine.
 */
export function assertPricesConfigured(
  table: Record<Stage, ModelRef> = routing,
  log: (msg: string) => void = console.warn,
): string[] {
  const unpriced = (Object.entries(table) as [Stage, ModelRef][])
    .filter(([stage, m]) => stage !== 'embed' && (m.inputPerMTok === 0 || m.outputPerMTok === 0))
    .map(([stage]) => stage);

  if (unpriced.length > 0) {
    log(
      `[cost] no price set for stage(s): ${unpriced.join(', ')}. Generation will be ` +
        `reported as free, which it is not. Set PRICE_<STAGE>_IN / _OUT in .env.`,
    );
  }
  return unpriced;
}
