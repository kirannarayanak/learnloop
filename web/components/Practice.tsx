'use client';

/**
 * Practice — one question at a time.
 *
 * This is the scarce thing the product sells (video is already free and infinite), so
 * two rules matter more than the interface:
 *
 *   1. The explanation shows whether the learner was right OR wrong. Being right
 *      without knowing why isn't learning, and only explaining failures teaches people
 *      to fear being wrong.
 *   2. Getting it right earns no points. Points come from doing the work and from
 *      reaching mastery (docs/10-motivation.md finding 5). The copy here never
 *      congratulates accuracy — it reports it and moves on.
 */

import { useState } from 'react';
import type { Exercise } from '../lib/content.ts';
import { useLearner } from '../lib/learner.tsx';
import { Markdown } from './Markdown.tsx';

const OPTION_COUNT = 3;

export function Practice({ exercises, skillId }: { exercises: Exercise[]; skillId: string }) {
  const { recordAttempt, isMastered, progressOf, loaded } = useLearner();
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);

  const exercise = exercises[index];
  if (exercise === undefined) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="font-medium">That&apos;s the practice for this skill.</p>
        <p className="mt-1 text-sm text-ink-soft">
          {loaded && isMastered(skillId)
            ? 'Credited. It will come back for review before you forget it.'
            : 'Not credited yet — come back and try the rest when you have a few minutes.'}
        </p>
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setPicked(null);
          }}
          className="mt-4 rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent"
        >
          Practise again
        </button>
      </div>
    );
  }

  const answered = picked !== null;
  const exerciseId = exercise.id;
  const correctIndex = exercise.answer.correct;
  const wasCorrect = picked === correctIndex;
  const progress = progressOf(skillId);

  function choose(option: number): void {
    if (answered) return;
    setPicked(option);
    recordAttempt(skillId, option === correctIndex, exerciseId);
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-xs uppercase tracking-wide text-ink-soft">
          Question {index + 1} of {exercises.length}
        </p>
        {loaded && progress !== undefined && (
          <p className="text-xs text-ink-soft">{progress.correct}/3 toward credit</p>
        )}
      </div>

      <div className="mt-3">
        <Markdown source={exercise.promptMd} />
      </div>

      <div className="mt-4 space-y-2">
        {Array.from({ length: OPTION_COUNT }, (_, option) => {
          const isCorrect = option === correctIndex;
          const isPicked = option === picked;

          // After answering, mark the right answer and the learner's wrong pick.
          // Everything else stays neutral.
          let tone = 'border-border hover:border-accent';
          if (answered && isCorrect) tone = 'border-accent bg-accent-soft';
          else if (answered && isPicked) tone = 'border-warn bg-warn-soft';
          else if (answered) tone = 'border-border opacity-60';

          return (
            <button
              key={option}
              type="button"
              disabled={answered}
              onClick={() => choose(option)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition ${tone}`}
            >
              Option {option + 1}
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="mt-4 border-t border-border pt-4">
          {/* Reported, not celebrated. No points either way. */}
          <p className="text-sm font-medium">
            {wasCorrect ? 'Correct.' : 'Not that one.'}
          </p>
          {/* The explanation is the teaching moment, so it shows both ways. */}
          <div className="mt-1 text-sm text-ink-soft">
            <Markdown source={exercise.explanationMd} />
          </div>

          <button
            type="button"
            onClick={() => {
              setIndex(index + 1);
              setPicked(null);
            }}
            className="mt-4 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {index + 1 === exercises.length ? 'Finish practice' : 'Next question'}
          </button>
        </div>
      )}
    </div>
  );
}
