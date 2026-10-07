'use client';

/**
 * The learner header: streak, points, freezes.
 *
 * Kept deliberately quiet. The research says rewards framed as *control* crowd out a
 * learner's own interest, while the same numbers framed as *competence feedback*
 * sustain engagement (docs/10-motivation.md finding 5). So these read as a status line,
 * not a scoreboard — no confetti, no pulsing, no "YOU'RE ON FIRE".
 */

import Link from 'next/link';
import { useLearner } from '../lib/learner.ts';

export function Header() {
  const { state, points, loaded } = useLearner();
  const { currentDays, longestDays, freezesAvailable } = state.streak;

  return (
    <header className="flex items-center justify-between gap-4 border-b border-border py-4">
      <Link href="/" className="font-semibold tracking-tight hover:text-accent">
        LearnLoop
      </Link>

      {/* Nothing renders until localStorage has been read, so the server and client
          markup agree and the numbers never flash a wrong value. */}
      {loaded && (
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-soft" title="Any activity counts — not just hitting your goal">
            <span aria-hidden>🔥</span>{' '}
            <span className="font-medium text-ink">{currentDays}</span> day
            {currentDays === 1 ? '' : 's'}
          </span>

          {/* Freezes are earned and auto-applied, never sold. Showing them is the
              point: knowing protection exists is what reduces churn. */}
          {freezesAvailable > 0 && (
            <span
              className="text-ink-soft"
              title={`${freezesAvailable} streak freeze${freezesAvailable === 1 ? '' : 's'} — used automatically if you miss a day`}
            >
              <span aria-hidden>🛡</span> {freezesAvailable}
            </span>
          )}

          <span className="text-ink-soft">
            <span className="font-medium text-ink">{points}</span> pts
          </span>

          {longestDays > currentDays && (
            <span className="hidden text-ink-soft sm:inline" title="Your personal best">
              best {longestDays}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
