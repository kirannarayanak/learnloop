/**
 * Eval cases.
 *
 * Real source documents, two per beachhead domain, committed to the repo rather than
 * fetched at run time — a page that changes under you turns a regression into a mystery,
 * and an eval you cannot re-run next quarter is worse than a synthetic one you can.
 *
 * Every source is openly licensed (CC BY-SA, via Wikipedia), which is also what the
 * pipeline's own licence gate requires: unknown licence means cite-and-link only, so an
 * eval built on unlicensed material could not legally exercise the drafting path at all.
 *
 * Excerpts are capped at ~14k characters. That is enough to decompose into a real path and
 * cheap enough that a full run stays inside the budget, which is the point — an eval you
 * hesitate to run does not get run.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { RiskTier } from '../store/types.ts';

export interface EvalCase {
  id: string;
  /** Filename under engine/eval/cases/. */
  file: string;
  domainSlug: string;
  domainTitle: string;
  riskTier: RiskTier;
  license: string;
  sourceUrl: string;
  /** What makes this case hard. Used to stratify a sample and to read results. */
  hardBecause: string;
  /**
   * 'smoke' cases run by default — one per domain, which keeps a routine run inside the
   * $2 budget. The full set costs more than that, and an eval you hesitate to run does
   * not get run, so the cheap set is the default and `--full` is deliberate.
   */
  tier: 'smoke' | 'full';
}

export const EVAL_CASES: EvalCase[] = [
  // --- emerging tech: low risk, the beachhead the engine was built against.
  {
    id: 'closures-js',
    file: 'closures-js.txt',
    domainSlug: 'emerging-tech',
    domainTitle: 'Emerging Tech for Working Engineers',
    riskTier: 'low',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/Closure_(computer_programming)',
    hardBecause: 'A mechanism with a well-known misconception, so distractor quality is testable.',
    tier: 'smoke',
  },
  {
    id: 'transformers',
    file: 'transformers.txt',
    domainSlug: 'emerging-tech',
    domainTitle: 'Emerging Tech for Working Engineers',
    riskTier: 'low',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture)',
    hardBecause: 'Heavily represented in training data — the generator can answer from memory rather than from the source, so citation grounding matters most here.',
    tier: 'full',
  },

  // --- fintech: medium risk, dense jargon, the domain where being vague is easiest.
  {
    id: 'iso-20022',
    file: 'iso-20022.txt',
    domainSlug: 'fintech-eng',
    domainTitle: 'Fintech & Payments Engineering',
    riskTier: 'medium',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/ISO_20022',
    hardBecause: 'Short source. Tests whether the generator over-decomposes thin material into skills the text cannot support.',
    tier: 'full',
  },
  {
    id: 'chargeback',
    file: 'chargeback.txt',
    domainSlug: 'fintech-eng',
    domainTitle: 'Fintech & Payments Engineering',
    riskTier: 'medium',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/Chargeback',
    hardBecause: 'A multi-party process with a natural sequence — a good diagram is possible, so a bad one is a visible failure.',
    tier: 'smoke',
  },

  // --- exam prep: medium risk, where a wrong answer costs a learner marks.
  {
    id: 'angular-momentum',
    file: 'angular-momentum.txt',
    domainSlug: 'exam-prep',
    domainTitle: 'Competitive Exam Preparation',
    riskTier: 'medium',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/Angular_momentum',
    hardBecause: 'Mathematical. Tests whether worked examples are actually worked rather than asserted.',
    tier: 'smoke',
  },
  {
    id: 'newtons-laws',
    file: 'newtons-laws.txt',
    domainSlug: 'exam-prep',
    domainTitle: 'Competitive Exam Preparation',
    riskTier: 'medium',
    license: 'CC-BY-SA-4.0',
    sourceUrl: "https://en.wikipedia.org/wiki/Newton's_laws_of_motion",
    hardBecause: 'Famous misconceptions exist and are documented — the strongest test of whether checks probe real wrong beliefs.',
    tier: 'full',
  },

  // --- school curriculum: HIGH risk. These must never auto-publish.
  {
    id: 'photosynthesis',
    file: 'photosynthesis.txt',
    domainSlug: 'school-curriculum',
    domainTitle: 'School Curriculum (K-12)',
    riskTier: 'high',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/Photosynthesis',
    hardBecause: 'High risk, so the gate must block it regardless of how well it scores. A high score here that publishes is a failure, not a success.',
    tier: 'smoke',
  },
  {
    id: 'cell-division',
    file: 'cell-division.txt',
    domainSlug: 'school-curriculum',
    domainTitle: 'School Curriculum (K-12)',
    riskTier: 'high',
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://en.wikipedia.org/wiki/Mitosis',
    hardBecause: 'A staged process children routinely confuse with meiosis — tests whether the lesson distinguishes them.',
    tier: 'full',
  },
];

export function loadCaseText(evalCase: EvalCase): string {
  return readFileSync(resolve(import.meta.dirname, 'cases', evalCase.file), 'utf8');
}

/** The default run: one case per domain, cheap enough to run on every prompt change. */
export const SMOKE_CASES = EVAL_CASES.filter((c) => c.tier === 'smoke');
