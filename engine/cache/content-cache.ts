/**
 * Generation cache — the reason cost-per-path stays near $0.50 (docs/05-economics.md).
 *
 * Keyed on everything that could change the output: prompt version, model, stage and
 * both prompt halves. Re-running the pipeline is therefore free until a source or a
 * prompt actually changes, which is what makes the continuous-freshness cron affordable.
 */

import { createHash } from 'node:crypto';
import type { GenRequest, GenResult, ModelRef, Provider } from '../providers/types.ts';
import type { Store } from '../store/types.ts';
import { PROMPT_VERSION } from '../stages/schema.ts';

/** Separator that cannot appear in a model id or stage name, so parts can't collide. */
const SEP = '\n--8<--\n';

export function cacheKeyFor(req: GenRequest, model: ModelRef): string {
  return createHash('sha256')
    .update([PROMPT_VERSION, model.id, req.stage, req.tag ?? '', req.prefix, req.suffix].join(SEP))
    .digest('hex');
}

export interface CacheStats {
  calls: number;
  hits: number;
  /** Repeat uses of a prefix that still reported zero cached input tokens. */
  coldPrefixCalls: number;
  costUsd: number;
  /** Prefixes already sent this run. The FIRST use of a prefix is always cold —
   *  only a repeat that is still cold indicates a real regression. */
  seenPrefixes: Set<string>;
}

export function newStats(): CacheStats {
  return { calls: 0, hits: 0, coldPrefixCalls: 0, costUsd: 0, seenPrefixes: new Set() };
}

/** Below this, prompt caching wouldn't engage anyway, so a cold prefix means nothing. */
const PREFIX_WORTH_CACHING = 4000;

/**
 * Generate through the cache.
 *
 * Also watches prompt-cache effectiveness: the source material is a stable prefix shared
 * by every lesson from one source, so after the first call `cachedInputTokens` should be
 * non-zero. When it stays zero something volatile has leaked into the prefix, which is a
 * ~10x cost regression that is otherwise completely silent. CLAUDE.md requires this be
 * logged rather than swallowed.
 */
export async function generateCached<T>(
  store: Store,
  provider: Provider,
  model: ModelRef,
  req: GenRequest,
  stats: CacheStats,
  log: (msg: string) => void = console.warn,
): Promise<GenResult<T>> {
  const key = cacheKeyFor(req, model);
  stats.calls += 1;

  const hit = await store.getCached(key);
  if (hit !== undefined) {
    await store.bumpCacheHit(key);
    stats.hits += 1;
    return {
      output: hit.output as T,
      usage: { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, costUsd: 0 },
      model,
      cacheHit: true,
    };
  }

  const result = await provider.generate<T>(req, model);

  // The first call on any prefix is necessarily a cache write, not a read. Warning on
  // that would make this message routine, and a routine warning gets ignored — so only
  // a REPEAT use of the same prefix that is still cold counts as a regression.
  const prefixRepeated = stats.seenPrefixes.has(req.prefix);
  stats.seenPrefixes.add(req.prefix);

  if (
    prefixRepeated &&
    result.usage.cachedInputTokens === 0 &&
    req.prefix.length > PREFIX_WORTH_CACHING
  ) {
    stats.coldPrefixCalls += 1;
    log(
      `[cost] prompt cache MISS on a repeated ${req.prefix.length}-char prefix for stage ` +
        `'${req.stage}' (model ${model.id}). Something volatile has leaked into the ` +
        `cached prefix — this is a ~10x cost regression.`,
    );
  }

  stats.costUsd += result.usage.costUsd;
  await store.putCached({
    cacheKey: key,
    model: model.id,
    output: result.output,
    costUsd: result.usage.costUsd,
  });
  return result;
}
