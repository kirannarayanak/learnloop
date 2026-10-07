/**
 * Gemini adapter.
 *
 * Chosen as the primary provider for reasons specific to this product rather than general
 * quality (docs/00-decisions.md): long context swallows a whole board syllabus in one
 * pass, native PDF and video handle scanned papers and lecture recordings, and Indic
 * language support is what wave 2's translation layer runs on.
 *
 * Caching: Gemini does this IMPLICITLY on 2.5+ models — a request that reuses a prefix
 * you have sent before gets roughly a 90% discount on those tokens with nothing to
 * manage. That is why the pipeline is so careful about putting the source material in the
 * stable prefix: the discount is automatic but only if the bytes actually match.
 * Explicit caching exists too, but it bills storage by the hour whether used or not, so
 * it only pays for a context reused many times in a short window — not our shape.
 */

import { GoogleGenAI } from '@google/genai';
import type { GenRequest, GenResult, ModelRef, Provider, Stage, Usage } from './types.ts';

export interface GeminiOptions {
  apiKey?: string;
  /** Attempts per call, including the first. Retries are for 429 and 5xx only. */
  maxAttempts?: number;
  log?: (msg: string) => void;
}

/** Retryable: rate limits and transient server failures. Never a 400 — that is our bug. */
function isRetryable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(429|500|502|503|504)\b|rate.?limit|quota|unavailable|overloaded|deadline/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiProvider implements Provider {
  readonly family = 'gemini' as const;

  private readonly client: GoogleGenAI;
  private readonly maxAttempts: number;
  private readonly log: (msg: string) => void;

  constructor(options: GeminiOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
    if (apiKey === undefined || apiKey === '') {
      throw new Error(
        'GeminiProvider needs an API key: set GOOGLE_API_KEY (or GEMINI_API_KEY), or pass apiKey.',
      );
    }
    this.client = new GoogleGenAI({ apiKey });
    this.maxAttempts = options.maxAttempts ?? 4;
    this.log = options.log ?? console.warn;
  }

  supports(stage: Stage): boolean {
    // Embeddings go to an open model — there is no reason to ever pay for them here.
    return stage !== 'embed';
  }

  async generate<T>(req: GenRequest, model: ModelRef): Promise<GenResult<T>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.client.models.generateContent({
          model: model.id,
          // Prefix then suffix, in that order and in one part, so the cached prefix is
          // byte-identical across calls about the same source.
          contents: `${req.prefix}${req.suffix}`,
          config: {
            ...(req.system !== undefined ? { systemInstruction: req.system } : {}),
            maxOutputTokens: req.maxOutputTokens,
            ...(req.schema !== undefined
              ? { responseMimeType: 'application/json', responseJsonSchema: req.schema }
              : {}),
          },
        });

        const text = response.text;
        if (text === undefined || text.trim() === '') {
          // An empty body usually means the output cap was hit mid-object, or a safety
          // filter fired. Both are worth saying out loud rather than failing to parse.
          throw new Error(
            `Gemini returned no text for stage '${req.stage}'. ` +
              `finishReason=${response.candidates?.[0]?.finishReason ?? 'unknown'}. ` +
              `If this is MAX_TOKENS, raise maxOutputTokens for this stage.`,
          );
        }

        const output = (req.schema !== undefined ? safeParseJson(text, req.stage) : text) as T;

        return { output, usage: usageFrom(response, model), model, cacheHit: false };
      } catch (error) {
        lastError = error;
        if (attempt === this.maxAttempts || !isRetryable(error)) break;

        // Exponential backoff with jitter, so a batch of parallel drafts doesn't
        // synchronise its retries and hit the same limit together.
        const backoffMs = Math.round(500 * 2 ** (attempt - 1) * (0.5 + Math.random()));
        this.log(
          `[gemini] attempt ${attempt}/${this.maxAttempts} for stage '${req.stage}' failed ` +
            `(${error instanceof Error ? error.message : String(error)}); retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }

    throw new Error(
      `Gemini call failed for stage '${req.stage}' after ${this.maxAttempts} attempt(s): ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
      { cause: lastError },
    );
  }
}

/** Models sometimes wrap JSON in a fence despite responseMimeType. Tolerate it. */
function safeParseJson(text: string, stage: Stage): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(
      `Gemini returned unparseable JSON for stage '${stage}': ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        `First 200 chars: ${cleaned.slice(0, 200)}`,
    );
  }
}

/**
 * Read usage defensively.
 *
 * These field names have changed across SDK versions, and cost accounting silently
 * reporting zero is worse than it erroring — cost per path is the number the whole
 * business model rests on (docs/05-economics.md).
 */
function usageFrom(response: unknown, model: ModelRef): Usage {
  const meta =
    typeof response === 'object' && response !== null && 'usageMetadata' in response
      ? ((response as { usageMetadata?: Record<string, unknown> }).usageMetadata ?? {})
      : {};

  const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

  const inputTokens = asNumber(meta.promptTokenCount);
  // Thinking tokens are billed as output, so they belong in the output count.
  const outputTokens = asNumber(meta.candidatesTokenCount) + asNumber(meta.thoughtsTokenCount);
  const cachedInputTokens = asNumber(meta.cachedContentTokenCount);

  const billedInput = Math.max(inputTokens - cachedInputTokens, 0);
  const cacheReadMultiplier = model.caching?.readMultiplier ?? 0.1;

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd:
      (billedInput * model.inputPerMTok +
        cachedInputTokens * model.inputPerMTok * cacheReadMultiplier +
        outputTokens * model.outputPerMTok) /
      1_000_000,
  };
}
