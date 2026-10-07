'use client';

/**
 * The lesson player.
 *
 * Segmenting principle: the learner advances one block at a time rather than receiving a
 * wall. Previously completed blocks stay on screen so they can be scrolled back to, but
 * only the newest one is live — which also keeps each step small enough to work on a
 * phone over bad data.
 *
 * Interactive blocks gate the Continue button. That is not a nag: a lesson that lets you
 * skip the retrieval is a lesson you can read passively, and reading passively is the
 * technique the evidence rates lowest (docs/11-lesson-design.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LessonBlock } from '@learnloop/engine/stages/blocks.ts';
import { useNarration } from '../lib/narration.ts';
import { useLearner } from '../lib/learner.tsx';
import {
  Check, Concept, Diagram, ExplainBack, Predict, Pretrain, Recap, WorkedExample,
  type BlockProps,
} from './LessonBlocks.tsx';

function renderBlock(block: LessonBlock, props: BlockProps) {
  switch (block.type) {
    case 'pretrain': return <Pretrain block={block} {...props} />;
    case 'concept': return <Concept block={block} {...props} />;
    case 'diagram': return <Diagram block={block} {...props} />;
    case 'predict': return <Predict block={block} {...props} />;
    case 'worked_example': return <WorkedExample block={block} {...props} />;
    case 'check': return <Check block={block} {...props} />;
    case 'explain_back': return <ExplainBack block={block} {...props} />;
    case 'recap': return <Recap block={block} {...props} />;
  }
}

export function LessonPlayer({
  blocks,
  skillId,
  nextHref,
  nextLabel,
}: {
  blocks: LessonBlock[];
  skillId: string;
  nextHref?: string;
  nextLabel?: string;
}) {
  const narration = useNarration();
  const { recordAttempt } = useLearner();
  const [revealed, setRevealed] = useState(0);
  const [satisfied, setSatisfied] = useState<Record<number, boolean>>({});
  const endRef = useRef<HTMLDivElement>(null);

  const atEnd = revealed === blocks.length - 1;
  const canContinue = satisfied[revealed] === true;

  const markSatisfied = useCallback((index: number) => {
    setSatisfied((prev) => (prev[index] === true ? prev : { ...prev, [index]: true }));
  }, []);

  // Stop any speech when leaving the lesson. Audio outliving the page is jarring.
  useEffect(() => () => narration.stop(), [narration]);

  function advance(): void {
    narration.stop();
    setRevealed((r) => Math.min(r + 1, blocks.length - 1));
    // Let the new block mount before scrolling to it.
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
  }

  return (
    <div>
      {/* --- narration controls ------------------------------------------------ */}
      <div className="sticky top-0 z-10 -mx-4 mb-6 flex items-center justify-between gap-3 border-b border-border bg-bg/95 px-4 py-2 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="h-1 w-24 overflow-hidden rounded-full bg-border sm:w-40">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${((revealed + 1) / blocks.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-ink-soft">
            {revealed + 1}/{blocks.length}
          </span>
        </div>

        {narration.loaded && (
          <div className="flex items-center gap-2">
            {narration.supported ? (
              <>
                <button
                  type="button"
                  onClick={() => narration.setEnabled(!narration.enabled)}
                  aria-pressed={narration.enabled}
                  className={`rounded-md border px-2.5 py-1 text-xs transition ${
                    narration.enabled
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-border text-ink-soft hover:border-accent'
                  }`}
                >
                  <span aria-hidden>{narration.enabled ? '🔊' : '🔇'}</span>{' '}
                  {narration.enabled ? 'Voice on' : 'Voice off'}
                </button>

                {narration.enabled && (
                  <select
                    value={narration.rate}
                    onChange={(e) => narration.setRate(Number(e.target.value))}
                    aria-label="Narration speed"
                    className="rounded-md border border-border bg-surface px-1.5 py-1 text-xs text-ink-soft"
                  >
                    <option value={0.8}>0.8×</option>
                    <option value={1}>1×</option>
                    <option value={1.25}>1.25×</option>
                    <option value={1.5}>1.5×</option>
                  </select>
                )}
              </>
            ) : (
              <span className="text-xs text-ink-soft">Voice unavailable on this device</span>
            )}
          </div>
        )}
      </div>

      {/* --- blocks ------------------------------------------------------------- */}
      <div className="space-y-8">
        {blocks.slice(0, revealed + 1).map((block, i) => (
          <div key={i} className={i < revealed ? 'opacity-60 transition-opacity' : ''}>
            {renderBlock(block, {
              onSatisfied: () => markSatisfied(i),
              // Only the live block speaks; earlier ones are mounted but their mount
              // effect has already run, and `speak` has a stable identity so they never
              // re-fire. Without that stability they would all talk at once.
              speak: i === revealed ? narration.speak : () => {},
              showTranscript: narration.showTranscript,
              onAttempt: (correct) => recordAttempt(skillId, correct),
            })}
          </div>
        ))}
      </div>

      <div ref={endRef} />

      {/* --- advance ------------------------------------------------------------ */}
      <div className="mt-8 border-t border-border pt-4">
        {!atEnd ? (
          <button
            type="button"
            onClick={advance}
            disabled={!canContinue}
            className="rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
          >
            Continue
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-ink-soft">
              That&apos;s the lesson. It will come back for review before you forget it.
            </p>
            {nextHref !== undefined && (
              <a
                href={nextHref}
                className="inline-block rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:opacity-90"
              >
                {nextLabel ?? 'Next skill'} →
              </a>
            )}
          </div>
        )}

        {!atEnd && !canContinue && (
          <p className="mt-2 text-xs text-ink-soft">
            Answer above to continue — skipping the practice is the part that stops it sticking.
          </p>
        )}
      </div>
    </div>
  );
}
