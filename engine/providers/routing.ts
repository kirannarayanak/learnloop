import {
  type Family,
  type ModelRef,
  type Stage,
  VerifierIndependenceError,
} from './types.js';

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
 * Pin these to real model ids before the first production run, and re-check the
 * prices against each provider's pricing page — the cost-per-path figure in
 * docs/05-economics.md is only as trustworthy as these numbers.
 */
export const routing: Record<Stage, ModelRef> = {
  // Long context + native PDF/vision. The whole point of choosing Gemini.
  ingest: {
    family: 'gemini',
    id: env('MODEL_INGEST', 'gemini-pro-latest'),
    inputPerMTok: num('PRICE_INGEST_IN', 0),
    outputPerMTok: num('PRICE_INGEST_OUT', 0),
  },

  // The hard reasoning task: decompose into atomic skills, order prerequisites,
  // keep the DAG acyclic. ~5% of tokens, ~90% of the quality outcome — this is
  // the stage never to cheap out on, whichever family wins the eval.
  graph: {
    family: 'gemini',
    id: env('MODEL_GRAPH', 'gemini-pro-latest'),
    inputPerMTok: num('PRICE_GRAPH_IN', 0),
    outputPerMTok: num('PRICE_GRAPH_OUT', 0),
  },

  // ~80% of all tokens. Easy and format-bound, so this is the stage to move to
  // a cheaper or open model FIRST — but only once the eval set can prove
  // quality held (docs/09-model-strategy.md).
  draft: {
    family: 'gemini',
    id: env('MODEL_DRAFT', 'gemini-flash-latest'),
    inputPerMTok: num('PRICE_DRAFT_IN', 0),
    outputPerMTok: num('PRICE_DRAFT_OUT', 0),
  },

  // Correctness gate. MUST be a different family than `draft` — a model
  // checking its own output shares its own blind spots and will approve its
  // own hallucinations. Independence is worth a few cents a path.
  verify: {
    family: (env('MODEL_VERIFY_FAMILY', 'claude') as Family),
    id: env('MODEL_VERIFY', 'claude-sonnet-5'),
    inputPerMTok: num('PRICE_VERIFY_IN', 2),
    outputPerMTok: num('PRICE_VERIFY_OUT', 10),
    batchDiscount: 0.5,
    caching: { minPrefixTokens: 2048, readMultiplier: 0.1 },
  },

  translate: {
    family: 'gemini',
    id: env('MODEL_TRANSLATE', 'gemini-flash-latest'),
    inputPerMTok: num('PRICE_TRANSLATE_IN', 0),
    outputPerMTok: num('PRICE_TRANSLATE_OUT', 0),
  },

  // Live and latency-sensitive, and the only cost that grows per-user forever.
  // Self-hosting an open model starts to pay here at ~100k free learners.
  tutor: {
    family: (env('MODEL_TUTOR_FAMILY', 'gemini') as Family),
    id: env('MODEL_TUTOR', 'gemini-flash-latest'),
    inputPerMTok: num('PRICE_TUTOR_IN', 0),
    outputPerMTok: num('PRICE_TUTOR_OUT', 0),
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
