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
import type { LessonBlock } from '../stages/blocks.ts';
import { goldenLessonBlocks, goldenCitations } from '../fixtures/golden-lesson.ts';

export interface FakeOptions {
  family?: Family;
  /** Skill slugs whose verification should fail, to exercise the repair path. */
  failVerifyFor?: readonly string[];
  /** Simulate a provider that reports no prompt-cache reads, to test the cost warning. */
  neverCachePrefix?: boolean;
  /**
   * Emit the hand-authored golden lesson for this skill slug instead of the generic
   * structure. The seed uses it so the app shows what the generator is actually aimed
   * at, rather than only its scaffolding (engine/fixtures/golden-lesson.ts).
   */
  goldenForSlug?: string;
}

/** First markdown heading of the source, so generated content is recognisably about it. */
function topicOf(prefix: string): string {
  const heading = prefix.split('\n').find((l) => l.startsWith('# '));
  return heading === undefined ? 'the topic' : heading.replace(/^#\s*/, '').trim();
}

/** Roughly 4 characters per token — close enough for cost accounting in tests. */
function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export class FakeProvider implements Provider {
  readonly family: Family;
  /** Every request seen, so tests can assert on prompt construction. */
  readonly calls: { stage: Stage; prefixLen: number; suffix: string; tag: string }[] = [];

  private readonly opts: Required<Omit<FakeOptions, 'family'>>;
  private seenPrefixes = new Set<string>();

  constructor(options: FakeOptions = {}) {
    this.family = options.family ?? 'open';
    this.opts = {
      failVerifyFor: options.failVerifyFor ?? [],
      neverCachePrefix: options.neverCachePrefix ?? false,
      goldenForSlug: options.goldenForSlug ?? '',
    };
  }

  supports(_stage: Stage): boolean {
    return true;
  }

  async generate<T>(req: GenRequest, model: ModelRef): Promise<GenResult<T>> {
    this.calls.push({
      stage: req.stage,
      prefixLen: req.prefix.length,
      suffix: req.suffix,
      tag: req.tag ?? '',
    });

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
        return this.graph(topicOf(req.prefix));

      case 'draft':
        return this.draft(req.tag ?? 'unknown-skill');


      case 'verify':
        return this.verify(req.tag ?? 'unknown-skill');

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
  private graph(topic: string): GraphOutput {
    return {
      pathTitle: `${topic}, end to end`,
      pathSummary: `Read, trace and apply the core ideas in ${topic} with confidence.`,
      skills: [
        { slug: 'call-stack', title: `${topic}: the mechanism`, statement: `Trace how ${topic} works step by step`, estMinutes: 8 },
        { slug: 'base-case', title: `${topic}: the boundary cases`, statement: `Identify the boundary cases in ${topic}`, estMinutes: 7 },
        { slug: 'write-recursion', title: `${topic}: applying it`, statement: `Apply ${topic} to a simple problem`, estMinutes: 12 },
        { slug: 'tail-calls', title: `${topic}: the refinement`, statement: `Rewrite a ${topic} solution more efficiently`, estMinutes: 10 },
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
    const golden = skillSlug === this.opts.goldenForSlug;
    return {
      title: `Lesson: ${skillSlug}`,
      bodyMd: `## ${skillSlug}\n\nExplanation, worked example, common misconception, recap.`,
      blocks: golden ? goldenLessonBlocks : genericBlocks(skillSlug),
      estMinutes: 8,
      citations: golden ? goldenCitations : [{ quote: `authoritative sentence about ${skillSlug}` }],
    };
  }

  private verify(skillSlug: string): VerifyOutput {
    const failing = this.opts.failVerifyFor.find((slug) => slug === skillSlug);
    return {
      claimsSupported: failing === undefined,
      answersCorrect: true,
      teachesSkill: true,
      issues: failing === undefined ? [] : [`claim about ${failing} is not supported by any cited span`],
    };
  }
}

/**
 * Generic rich structure for skills without a hand-authored lesson.
 *
 * It is scaffolding, not content — but it is scaffolding of the RIGHT SHAPE, so the
 * renderer and the structural validator are exercised on every path, not only on the
 * golden one.
 */
function genericBlocks(slug: string): LessonBlock[] {
  return [
    {
      type: 'pretrain',
      terms: [
        { term: 'The mechanism', gloss: `How ${slug} actually operates` },
        { term: 'The boundary', gloss: 'Where it stops applying' },
      ],
      narration: `Two ideas carry most of the weight here, and it is worth meeting them before the explanation rather than during it.`,
    },
    {
      type: 'diagram',
      caption: `How ${slug} fits together`,
      nodes: [
        { id: 'a', label: 'Input', x: 15, y: 50 },
        { id: 'b', label: 'Process', x: 50, y: 50 },
        { id: 'c', label: 'Result', x: 85, y: 50 },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
      steps: [
        { label: 'Start here', highlight: ['a'], narration: 'Everything begins with what goes in, and the shape of that input constrains what the rest can possibly do.' },
        { label: 'The middle', highlight: ['b'], narration: 'This is the part worth slowing down on, because it is where the interesting decisions are made.' },
        { label: 'What comes out', highlight: ['c'], narration: 'And the outcome follows from the two steps before it, which is why tracing backwards from a wrong result usually finds the problem fast.' },
      ],
    },
    {
      type: 'predict',
      question: `Before reading on — what do you think breaks first when ${slug} is applied carelessly?`,
      options: ['The input assumptions', 'The processing step', 'The interpretation of the result'],
      correctIndex: 0,
      reveal: 'Assumptions about the input fail first, and they fail quietly — which is what makes them worth checking before anything else.',
      narration: 'Commit to an answer before you read them properly. Being wrong here still does the work.',
    },
    {
      type: 'concept',
      heading: 'The part people get wrong',
      keyPoints: ['Check the input first', 'The failure is usually silent'],
      narration: 'The reason this ordering matters is that a bad assumption upstream produces a plausible-looking answer downstream, so nothing alerts you. You find it by checking, not by noticing.',
    },
    {
      type: 'check',
      question: `Which signal tells you ${slug} has been applied outside its boundary?`,
      options: ['The result looks plausible', 'The inputs violated a stated assumption', 'The process took longer'],
      correctIndex: 1,
      explanation: 'Plausibility is exactly what you cannot rely on, and timing tells you about cost rather than correctness. The assumption is the thing with a definite answer.',
    },
    {
      type: 'worked_example',
      goal: `Work through one application of ${slug}`,
      steps: [
        { show: 'Step 1 — state the assumption', explain: 'Written down, it becomes checkable.' },
        { show: 'Step 2 — apply the mechanism', explain: 'Mechanical once the assumption holds.' },
        {
          show: '???',
          explain: 'Check the result against the assumption you started from.',
          faded: true,
          options: ['Accept the result', 'Check it against the original assumption', 'Start over'],
          correctIndex: 1,
        },
      ],
    },
    {
      type: 'check',
      question: 'Why is the last step of the worked example the one most often skipped?',
      options: ['It is the hardest', 'It feels redundant once you have an answer', 'It needs extra tools'],
      correctIndex: 1,
      explanation: 'Having an answer in hand makes checking feel like work already done. That feeling is the failure mode.',
      targetsMisconception: 'An answer that looks right has been checked.',
    },
    {
      type: 'explain_back',
      prompt: `In your own words: when would you NOT reach for ${slug}?`,
      modelAnswer: 'When the assumptions it depends on cannot be established, because it will still return something that looks reasonable and you will have no signal that it is wrong.',
      mustMention: ['The assumptions cannot be established', 'A wrong result still looks plausible'],
    },
    {
      type: 'recap',
      points: ['State the assumption', 'Apply the mechanism', 'Check the result against the assumption'],
      narration: 'If only one thing survives from this, let it be the habit of writing the assumption down before you start, because it is the only part that makes the rest checkable.',
    },
  ];
}
