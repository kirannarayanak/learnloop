/**
 * The prompts.
 *
 * This file is the highest-leverage thing in the repo: the difference between a lesson
 * that teaches and a wall of text is almost entirely here, not in the model choice.
 *
 * Two structural rules every prompt below obeys:
 *
 *  1. **Stable content first.** The system instruction and the source material are
 *     identical across every call about one source, so they go in the cached prefix.
 *     The per-skill part goes in the suffix. Reversing this costs ~10x and nothing
 *     errors (docs/05-economics.md).
 *
 *  2. **The rules are stated as constraints, not preferences.** A model asked for a
 *     "rich, engaging lesson" returns eight paragraphs with a quiz. Asked for "at least
 *     two retrieval blocks, one of them before the halfway point, and narration that
 *     shares no sentence with the on-screen text", it returns a lesson. The structural
 *     validator then rejects what slips through (engine/stages/blocks.ts).
 */

import type { GraphOutput } from './schema.ts';

// ===================================================================== graph extraction

export const GRAPH_SYSTEM = `You decompose source material into a prerequisite graph of atomic, testable skills.

A SKILL is one teachable idea that a learner can be observed doing. Rules:
- Phrase every statement as an observable action: "Trace a recursive call to its base case", NOT "Understand recursion".
- If you cannot write a question that distinguishes someone who has the skill from someone who does not, it is not a skill. Drop it.
- Each skill is 5-15 minutes of learning. Split anything larger.
- Produce 4-12 skills. Fewer means you did not decompose; more means you are listing facts, not skills.

PREREQUISITE EDGES connect skills:
- strength 1.0 = genuinely cannot be done first.
- strength 0.3-0.8 = helps but is not required.
- The graph MUST be acyclic. A cycle means a learner reaches a skill they can never unlock, and the job will be rejected.
- Do not connect everything to everything. Most skills have 0-2 prerequisites.

Cover only what the source actually supports. Do not add skills from your own knowledge — every skill must be teachable from this text alone.`;

export function graphPrompt(sourceMarkdown: string, domainTitle: string) {
  return {
    // Stable: identical for every call about this source.
    prefix: `SOURCE MATERIAL\n\n${sourceMarkdown}`,
    // Volatile: the instruction for this particular call.
    suffix: `\n\nDomain: ${domainTitle}\n\nExtract the skill graph and a path title and summary for this source.`,
  };
}

/** Flat-ish schema: nested unions are where provider schema support diverges. */
export const GRAPH_SCHEMA = {
  type: 'object',
  properties: {
    pathTitle: { type: 'string' },
    pathSummary: { type: 'string' },
    skills: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slug: { type: 'string', description: 'kebab-case, unique within this path' },
          title: { type: 'string' },
          statement: { type: 'string', description: 'Observable "can do X"' },
          estMinutes: { type: 'integer' },
        },
        required: ['slug', 'title', 'statement', 'estMinutes'],
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prereqSlug: { type: 'string' },
          skillSlug: { type: 'string' },
          strength: { type: 'number' },
        },
        required: ['prereqSlug', 'skillSlug', 'strength'],
      },
    },
  },
  required: ['pathTitle', 'pathSummary', 'skills', 'edges'],
} as const;

// ============================================================================= drafting

/**
 * The draft system prompt carries the evidence from docs/11-lesson-design.md as hard
 * constraints. The numbers are included deliberately — a model told "narration must not
 * repeat the screen, because that costs d=0.69" complies far more reliably than one told
 * "avoid redundancy".
 */
export const DRAFT_SYSTEM = `You write interactive lessons as a sequence of typed blocks. You are NOT writing an article.

The single most common failure is returning explanation blocks with a quiz at the end. That is the format we are replacing. A lesson is a sequence of things the learner DOES.

BLOCK TYPES:
- pretrain: name 2-4 key terms before the mechanism, so working memory isn't learning vocabulary and process at once.
- concept: ONE claim. keyPoints are SHORT LABELS for the eye (3-8 words, not sentences). narration carries the actual explanation for the ear.
- diagram: nodes and edges on a 0-100 coordinate grid, plus ordered steps. Each step highlights a subset of node ids and narrates ONLY that part.
- predict: ask what happens BEFORE explaining it. Committing to an answer — even a wrong one — primes the explanation. This block goes BEFORE the concept it sets up.
- worked_example: step through a solution. Mark the LAST OR SECOND-TO-LAST step faded:true with options — the learner supplies it instead of reading it.
- check: a retrieval question mid-lesson. Its explanation is shown whether the learner was right or wrong.
- explain_back: ask the learner to state something in their own words. Supply a modelAnswer and 2-3 mustMention points for them to self-check against.
- recap: 3-5 short takeaway lines.

HARD REQUIREMENTS — output violating any of these is rejected and regenerated:
1. At least TWO retrieval blocks (check or predict), and at least one BEFORE the halfway point. Not a quiz at the end.
2. At least one constructive block (explain_back, predict, or a faded worked_example).
3. No more than 60% of blocks may be concept or pretrain.
4. NARRATION MUST NOT RESTATE WHAT IS ON SCREEN. Narration and on-screen text compete for the same channel: a learner reading the same words they are hearing learns measurably LESS (redundancy effect, d=0.69). The eye gets short labels and a diagram; the ear gets the explanation. Never put a sentence in both.
5. Every factual claim must be supported by the source. Quote the exact supporting span in citations.

TONE: second person, conversational, direct. No filler, no "in this lesson we will", no motivational padding. Irrelevant-but-interesting detail measurably depresses learning, so cut anything not load-bearing.

A GOOD SHAPE looks like: pretrain, diagram, predict, concept, check, worked_example, check, explain_back, recap. Vary it to fit the skill — but keep retrieval in the middle.`;

export function draftPrompt(
  sourceMarkdown: string,
  skill: { title: string; statement: string; estMinutes: number },
  alreadyCovered: readonly string[],
) {
  return {
    // Stable across every skill drafted from this source — the cached prefix.
    prefix: `SOURCE MATERIAL\n\n${sourceMarkdown}`,
    suffix: `\n\nWrite the lesson for exactly ONE skill.

SKILL: ${skill.title}
THE LEARNER MUST BE ABLE TO: ${skill.statement}
TARGET LENGTH: about ${skill.estMinutes} minutes

Already taught earlier in this path (assume known, do not re-teach): ${alreadyCovered.length > 0 ? alreadyCovered.join('; ') : 'nothing yet — this is the first skill'}

Return the blocks.`,
  };
}

/**
 * Every optional field of every block type, flattened.
 *
 * Discriminated unions via anyOf are supported unevenly across providers and across
 * versions of the same provider, so the schema stays flat and `parseBlocks` does the
 * narrowing with errors precise enough for the repair pass to act on.
 */
export const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    estMinutes: { type: 'integer' },
    citations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { quote: { type: 'string', description: 'Exact span from the source' } },
        required: ['quote'],
      },
    },
    blocks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['pretrain', 'concept', 'diagram', 'predict', 'worked_example', 'check', 'explain_back', 'recap'],
          },
          narration: { type: 'string', description: 'For the ear. Must share no sentence with on-screen text.' },
          heading: { type: 'string' },
          keyPoints: { type: 'array', items: { type: 'string' }, description: 'Short labels, not sentences' },
          points: { type: 'array', items: { type: 'string' } },
          terms: {
            type: 'array',
            items: {
              type: 'object',
              properties: { term: { type: 'string' }, gloss: { type: 'string' } },
              required: ['term', 'gloss'],
            },
          },
          caption: { type: 'string' },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                label: { type: 'string' },
                x: { type: 'number', description: '0-100' },
                y: { type: 'number', description: '0-100' },
                note: { type: 'string' },
              },
              required: ['id', 'label', 'x', 'y'],
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
                label: { type: 'string' },
                back: { type: 'boolean' },
              },
              required: ['from', 'to'],
            },
          },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                highlight: { type: 'array', items: { type: 'string' } },
                narration: { type: 'string' },
                show: { type: 'string' },
                explain: { type: 'string' },
                faded: { type: 'boolean' },
                options: { type: 'array', items: { type: 'string' } },
                correctIndex: { type: 'integer' },
              },
            },
          },
          question: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          reveal: { type: 'string' },
          explanation: { type: 'string' },
          targetsMisconception: { type: 'string' },
          goal: { type: 'string' },
          prompt: { type: 'string' },
          modelAnswer: { type: 'string' },
          mustMention: { type: 'array', items: { type: 'string' } },
        },
        required: ['type'],
      },
    },
  },
  required: ['title', 'estMinutes', 'citations', 'blocks'],
} as const;

// ========================================================================= verification

/**
 * The verifier sees ONLY the cited spans and the lesson — never the source, and never the
 * drafter's reasoning. A verifier shown the justification agrees with it.
 */
export const VERIFY_SYSTEM = `You check a generated lesson against the ONLY evidence it is allowed to rest on: the cited source spans below.

You are not the author and you do not know what the author intended. Judge only what is in front of you. Being wrong in the lenient direction means a learner is taught something false, so when a claim is not clearly supported, say it is not.

Answer three questions:
1. claimsSupported — is EVERY factual claim in the lesson supported by one of the cited spans? A claim that is true in general but not supported by these spans is NOT supported. Say so.
2. answersCorrect — for every question, is the marked answer actually correct, and is every other option actually wrong? An ambiguous question where two options could be defended counts as incorrect.
3. teachesSkill — does the lesson actually teach the stated skill, or something adjacent to it?

List each specific problem in issues. Be concrete: name the block and the claim.`;

export function verifyPrompt(
  citedSpans: readonly string[],
  lessonJson: string,
  skillStatement: string,
) {
  return {
    // Only the evidence. Deliberately NOT the source and NOT the draft's reasoning.
    prefix: `CITED SOURCE SPANS — the only evidence this lesson may rest on:\n\n${citedSpans.map((s, i) => `[${i + 1}] ${s}`).join('\n\n')}`,
    suffix: `\n\nSKILL THE LESSON CLAIMS TO TEACH: ${skillStatement}\n\nLESSON:\n${lessonJson}\n\nCheck it.`,
  };
}

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    claimsSupported: { type: 'boolean' },
    answersCorrect: { type: 'boolean' },
    teachesSkill: { type: 'boolean' },
    issues: { type: 'array', items: { type: 'string' } },
  },
  required: ['claimsSupported', 'answersCorrect', 'teachesSkill', 'issues'],
} as const;

/** Skills already covered earlier in a path, for the draft prompt's "assume known" list. */
export function coveredBefore(graph: GraphOutput, order: readonly string[], upto: number): string[] {
  return order
    .slice(0, upto)
    .map((slug) => graph.skills.find((s) => s.slug === slug)?.statement)
    .filter((s): s is string => s !== undefined);
}
