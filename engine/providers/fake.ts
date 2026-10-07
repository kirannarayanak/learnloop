/**
 * Deterministic fake provider.
 *
 * Exists so the pipeline can be exercised end-to-end in CI with no API key and no
 * network. It is NOT a quality stand-in — it proves the plumbing, the gate, the cache
 * and the cost accounting work. Content quality is measured against the eval set
 * (docs/09-model-strategy.md), never against this.
 *
 * Deliberately supports being told to fail: `failVerifyFor` makes the verifier reject a
 * skill, which is how the repair loop and the review queue get tested.
 */

import type {
  Family, GenRequest, GenResult, ModelRef, Provider, Stage, Usage,
} from './types.ts';
import type { DraftOutput, GraphOutput, VerifyOutput } from '../stages/schema.ts';

export interface FakeOptions {
  family?: Family;
  /** Skill slugs whose verification should fail, to exercise the repair path. */
  failVerifyFor?: readonly string[];
  /** Simulate a provider that reports no prompt-cache reads, to test the cost warning. */
  neverCachePrefix?: boolean;
  /** How many exercises each draft produces. */
  exercisesPerSkill?: number;
}

/** Roughly 4 characters per token — close enough for cost accounting in tests. */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export class FakeProvider implements Provider {
  readonly family: Family;
  /** Every request seen, so tests can assert on prompt construction. */
  readonly calls: { stage: Stage; prefixLen: number; suffix: string }[] = [];

  private readonly opts: Required<Omit<FakeOptions, 'family'>>;
  private seenPrefixes = new Set<string>();

  constructor(options: FakeOptions = {}) {
    this.family = options.family ?? 'open';
    this.opts = {
      failVerifyFor: options.failVerifyFor ?? [],
      neverCachePrefix: options.neverCachePrefix ?? false,
      exercisesPerSkill: options.exercisesPerSkill ?? 4,
    };
  }

  supports(_stage: Stage): boolean {
    return true;
  }

  async generate<T>(req: GenRequest, model: ModelRef): Promise<GenResult<T>> {
    this.calls.push({ stage: req.stage, prefixLen: req.prefix.length, suffix: req.suffix });

    // Model the real caching behaviour: the first call on a given prefix pays full
    // price, later calls on the same prefix read from cache. This is what makes the
    // cache-effectiveness assertions in the tests meaningful.
    const prefixSeen = this.seenPrefixes.has(req.prefix);
    this.seenPrefixes.add(req.prefix);

    const inputTokens = estimateTokens(req.prefix + req.suffix);
    const cachedInputTokens =
      prefixSeen && !this.opts.neverCachePrefix ? estimateTokens(req.prefix) : 0;

    const output = this.outputFor(req) as T;
    const outputTokens = estimateTokens(JSON.stringify(output));

    const billedInput = inputTokens - cachedInputTokens;
    const cacheReadMultiplier = model.caching?.readMultiplier ?? 0.1;
    const discount = req.batchable ? 1 - (model.batchDiscount ?? 0) : 1;

    const usage: Usage = {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      costUsd:
        ((billedInput * model.inputPerMTok +
          cachedInputTokens * model.inputPerMTok * cacheReadMultiplier +
          outputTokens * model.outputPerMTok) /
          1_000_000) *
        discount,
    };

    return { output, usage, model, cacheHit: false };
  }

  private outputFor(req: GenRequest): unknown {
    switch (req.stage) {
      case 'ingest':
        return { markdown: req.prefix, title: 'Fake Source' };

      case 'graph':
        return this.graph();

      case 'draft':
        return this.draft(req.suffix);

      case 'verify':
        return this.verify(req.suffix);

      case 'translate':
        return { value: `[translated] ${req.suffix}` };

      case 'tutor':
        return { reply: 'Because the base case was never reached.' };

      case 'embed':
        return { vector: [] };
    }
  }

  /**
   * A small acyclic graph: two roots, one skill depending on both, one leaf.
   * Statements are phrased as observable "can do X" so assertSkillStatements passes —
   * if they weren't, the pipeline would correctly reject this fixture.
   */
  private graph(): GraphOutput {
    return {
      pathTitle: 'Recursion, end to end',
      pathSummary: 'Read, trace and write recursive functions with confidence.',
      skills: [
        { slug: 'call-stack', title: 'The call stack', statement: 'Trace a function call through the stack', estMinutes: 8 },
        { slug: 'base-case', title: 'Base cases', statement: 'Identify the base case of a recursive function', estMinutes: 7 },
        { slug: 'write-recursion', title: 'Writing recursion', statement: 'Write a recursive function for a simple problem', estMinutes: 12 },
        { slug: 'tail-calls', title: 'Tail calls', statement: 'Rewrite a recursive function in tail position', estMinutes: 10 },
      ],
      edges: [
        { prereqSlug: 'call-stack', skillSlug: 'base-case', strength: 1 },
        { prereqSlug: 'base-case', skillSlug: 'write-recursion', strength: 1 },
        { prereqSlug: 'call-stack', skillSlug: 'write-recursion', strength: 0.6 },
        { prereqSlug: 'write-recursion', skillSlug: 'tail-calls', strength: 1 },
      ],
    };
  }

  private draft(skillSlug: string): DraftOutput {
    const exercises = Array.from({ length: this.opts.exercisesPerSkill }, (_, i) => ({
      kind: 'mcq' as const,
      promptMd: `Question ${i + 1} about ${skillSlug}?`,
      answer: { correct: i % 3 },
      // Present whether the learner was right or wrong.
      explanationMd: `The answer is option ${(i % 3) + 1} because of how ${skillSlug} works.`,
      difficulty: 0.2 + i * 0.2,
    }));

    return {
      title: `Lesson: ${skillSlug}`,
      bodyMd: `## ${skillSlug}\n\nExplanation, worked example, common misconception, recap.`,
      estMinutes: 8,
      exercises,
      citations: [{ quote: `authoritative sentence about ${skillSlug}` }],
    };
  }

  private verify(skillSlug: string): VerifyOutput {
    const shouldFail = this.opts.failVerifyFor.includes(skillSlug);
    return {
      claimsSupported: !shouldFail,
      answersCorrect: true,
      teachesSkill: true,
      issues: shouldFail ? [`claim about ${skillSlug} is not supported by any cited span`] : [],
    };
  }
}
