/**
 * Claude adapter — the verifier.
 *
 * This provider exists to be a DIFFERENT model family from the one that drafted the
 * lesson. A model checking its own output shares its own blind spots and will approve its
 * own hallucinations, silently, until a learner is taught something false. That is the
 * whole reason there are two providers (engine/providers/routing.ts).
 *
 * It runs on Opus rather than a cheaper tier on purpose: verification is ~10% of tokens
 * and 100% of the safety gate. docs/09-model-strategy.md names this as the stage never to
 * economise on.
 */

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { GenRequest, GenResult, ModelRef, Provider, Stage, Usage } from './types.ts';

export interface ClaudeOptions {
  apiKey?: string;
  maxAttempts?: number;
  log?: (msg: string) => void;
}

/**
 * Raised when safety classifiers decline the request.
 *
 * Deliberately NOT handled with a server-side fallback to another model. A fallback here
 * would mean: the verifier declined to judge this content, so we asked something else
 * until we got a verdict. For a safety gate that is exactly backwards — a refusal is a
 * signal to involve a human, which is what the pipeline does with it.
 */
export class VerifierRefusedError extends Error {
  readonly category: string | null;

  constructor(category: string | null, explanation?: string) {
    super(
      `the verifier declined to judge this content (category: ${category ?? 'unspecified'})` +
        `${explanation !== undefined ? `: ${explanation}` : ''}. Routing to human review.`,
    );
    this.name = 'VerifierRefusedError';
    this.category = category;
  }
}

/** The verify stage's output. Mirrors VerifyOutput in stages/schema.ts. */
const VerifySchema = z.object({
  claimsSupported: z.boolean(),
  answersCorrect: z.boolean(),
  teachesSkill: z.boolean(),
  issues: z.array(z.string()),
});

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  return error instanceof Anthropic.APIConnectionError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ClaudeProvider implements Provider {
  readonly family = 'claude' as const;

  private readonly client: Anthropic;
  private readonly maxAttempts: number;
  private readonly log: (msg: string) => void;

  constructor(options: ClaudeOptions = {}) {
    // The SDK resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login`
    // profile on its own, so a bare constructor is correct when no key is injected.
    this.client =
      options.apiKey !== undefined ? new Anthropic({ apiKey: options.apiKey }) : new Anthropic();
    this.maxAttempts = options.maxAttempts ?? 4;
    this.log = options.log ?? console.warn;
  }

  supports(stage: Stage): boolean {
    return stage !== 'embed';
  }

  async generate<T>(req: GenRequest, model: ModelRef): Promise<GenResult<T>> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
      try {
        const response = await this.client.messages.parse({
          model: model.id,
          max_tokens: Math.max(req.maxOutputTokens, 4096),
          // The system prompt is identical across every verification, so it is the
          // cacheable prefix. The evidence and the lesson go in the message, which is
          // different every time.
          ...(req.system !== undefined
            ? {
                system: [
                  { type: 'text' as const, text: req.system, cache_control: { type: 'ephemeral' as const } },
                ],
              }
            : {}),
          messages: [{ role: 'user' as const, content: `${req.prefix}${req.suffix}` }],
          // Verification is a judgement call about whether claims are supported, which is
          // exactly the kind of work adaptive thinking is for.
          thinking: { type: 'adaptive' as const },
          output_config: { format: zodOutputFormat(VerifySchema) },
        });

        // Always check the stop reason before reading content.
        if (response.stop_reason === 'refusal') {
          const details = response.stop_details;
          throw new VerifierRefusedError(
            details !== null && details !== undefined && 'category' in details
              ? ((details as { category?: string | null }).category ?? null)
              : null,
            details !== null && details !== undefined && 'explanation' in details
              ? (details as { explanation?: string }).explanation
              : undefined,
          );
        }

        const parsed = response.parsed_output;
        if (parsed === null || parsed === undefined) {
          throw new Error(
            `Claude returned no parsed output for stage '${req.stage}' ` +
              `(stop_reason: ${response.stop_reason}). If this is max_tokens, raise maxOutputTokens.`,
          );
        }

        return { output: parsed as T, usage: usageFrom(response.usage, model), model, cacheHit: false };
      } catch (error) {
        lastError = error;
        // A refusal is a routing decision, not a transient failure. Never retry it.
        if (error instanceof VerifierRefusedError) throw error;
        if (attempt === this.maxAttempts || !isRetryable(error)) break;

        const backoffMs = Math.round(500 * 2 ** (attempt - 1) * (0.5 + Math.random()));
        this.log(
          `[claude] attempt ${attempt}/${this.maxAttempts} for stage '${req.stage}' failed ` +
            `(${error instanceof Error ? error.message : String(error)}); retrying in ${backoffMs}ms`,
        );
        await sleep(backoffMs);
      }
    }

    throw new Error(
      `Claude call failed for stage '${req.stage}' after ${this.maxAttempts} attempt(s): ` +
        `${lastError instanceof Error ? lastError.message : String(lastError)}`,
      { cause: lastError },
    );
  }
}

/** Cache reads are billed at a fraction of the input rate; count them separately. */
function usageFrom(usage: unknown, model: ModelRef): Usage {
  const asNumber = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const u = (usage ?? {}) as Record<string, unknown>;

  const freshInput = asNumber(u.input_tokens);
  const cacheRead = asNumber(u.cache_read_input_tokens);
  const cacheWrite = asNumber(u.cache_creation_input_tokens);
  const outputTokens = asNumber(u.output_tokens);

  const readMultiplier = model.caching?.readMultiplier ?? 0.1;
  // Writing to the cache costs more than a plain input token; reading costs much less.
  const WRITE_MULTIPLIER = 1.25;

  return {
    inputTokens: freshInput + cacheRead + cacheWrite,
    outputTokens,
    cachedInputTokens: cacheRead,
    costUsd:
      (freshInput * model.inputPerMTok +
        cacheWrite * model.inputPerMTok * WRITE_MULTIPLIER +
        cacheRead * model.inputPerMTok * readMultiplier +
        outputTokens * model.outputPerMTok) /
      1_000_000,
  };
}
