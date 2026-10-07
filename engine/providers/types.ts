/**
 * Provider-agnostic generation interface.
 *
 * Every pipeline stage goes through this. No stage names a vendor, so the
 * routing table in `routing.ts` is the only place a model choice exists —
 * which is what makes per-stage A/B testing against the eval set possible
 * (see docs/09-model-strategy.md).
 *
 * Two rules this file exists to enforce:
 *   1. The VERIFY stage must run on a different model family than DRAFT.
 *      A model checking its own output shares its own blind spots.
 *   2. Every call reports token usage and cost, because cost-per-path is the
 *      metric the business model rests on (docs/05-economics.md).
 */

export type Stage =
  | 'ingest'     // source -> normalised markdown; needs long context + PDF/vision
  | 'graph'      // source -> skills + prereq DAG; the hard reasoning task
  | 'draft'      // skill -> lesson + exercises; high volume, format-bound
  | 'verify'     // claims vs. cited sources; correctness gate
  | 'translate'  // locale fan-out
  | 'tutor'      // live, latency-sensitive, per-user cost
  | 'embed';     // always an open model; see docs/09-model-strategy.md

/** A model family, NOT a specific model. Used to enforce verifier independence. */
export type Family = 'gemini' | 'claude' | 'open' | 'local';

export interface ModelRef {
  family: Family;
  /** Exact provider model id, e.g. a Gemini or Claude model string. */
  id: string;
  /** Per-million-token prices, for cost accounting. Verify against the
   *  provider's current pricing page — these drift, and the economics in
   *  docs/05-economics.md are only as good as these numbers. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** Does this provider offer a batch/async discount for this model? */
  batchDiscount?: number;
  /** Prompt-caching support. Absent means "assume none and don't rely on it". */
  caching?: { minPrefixTokens: number; readMultiplier: number };
}

export interface GenRequest {
  stage: Stage;
  /** Stable prefix — source material, instructions. Cache this. */
  prefix: string;
  /** Volatile per-item part. Must come AFTER the prefix, or caching breaks. */
  suffix: string;
  /** JSON schema the output must satisfy. Providers differ in how they
   *  enforce this; the adapter normalises it and validates client-side
   *  regardless, because a silently malformed output is worse than an error. */
  schema?: unknown;
  maxOutputTokens: number;
  /** Non-urgent work should set this so the adapter can use a batch endpoint.
   *  Everything except `tutor` is non-urgent. */
  batchable?: boolean;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  costUsd: number;
}

export interface GenResult<T = unknown> {
  output: T;
  usage: Usage;
  model: ModelRef;
  /** True when the adapter served this from content_cache rather than calling
   *  the provider. Re-running the pipeline should be free until a source or a
   *  prompt version actually changes. */
  cacheHit: boolean;
}

export interface Provider {
  family: Family;
  supports(stage: Stage): boolean;
  generate<T>(req: GenRequest, model: ModelRef): Promise<GenResult<T>>;
}

export interface EmbedProvider {
  /** Must match the vector(N) column in db/schema.sql. Changing this later
   *  means re-embedding every skill and lesson, so pin it before first insert. */
  dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Thrown when the routing table would run verification on the same family that
 * drafted the content. This is a configuration error, not a runtime condition —
 * fail loudly at startup rather than quietly shipping self-approved content.
 */
export class VerifierIndependenceError extends Error {
  constructor(family: Family) {
    super(
      `verify stage is routed to family '${family}', which also handles draft. ` +
        `A model cannot independently verify its own output — route verify to a ` +
        `different family. See docs/09-model-strategy.md.`,
    );
    this.name = 'VerifierIndependenceError';
  }
}
