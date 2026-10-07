'use client';

/**
 * The skill map — the "structure" half of the product.
 *
 * Structure is what teaches; incentives are what bring the learner back
 * (docs/10-motivation.md). This component is the structure made visible: the
 * prerequisite order, what is credited, and what a given item builds on.
 *
 * The critical behaviour: prerequisites are shown, never enforced. Mastery gates
 * CREDIT, not ACCESS. Hard-locking content measurably reduces completion (finding 2),
 * and our own wave-0 exit gate is a completion number — so every item is clickable and
 * a skipped prerequisite is stated plainly instead of blocking.
 */

import Link from 'next/link';
import type { PathItem } from '../lib/content.ts';
import { useLearner } from '../lib/learner.tsx';

export function SkillMap({ items }: { items: PathItem[] }) {
  const { isMastered, progressOf, loaded, lessonsRead } = useLearner();

  const titleOf = (skillId: string) =>
    items.find((i) => i.skillId === skillId)?.skillTitle ?? 'an earlier skill';

  const masteredCount = items.filter((i) => isMastered(i.skillId)).length;

  return (
    <div className="space-y-3">
      {loaded && (
        <p className="text-sm text-ink-soft">
          {masteredCount} of {items.length} skills credited
          {/* Progress is competence feedback, which is the framing that works. */}
          {masteredCount > 0 && masteredCount < items.length && ' — keep going'}
        </p>
      )}

      <ol className="space-y-2">
        {items.map((item, i) => {
          const mastered = isMastered(item.skillId);
          const progress = progressOf(item.skillId);
          const read = lessonsRead.includes(item.lessonId);

          // Hard prerequisites not yet credited. Advisory only.
          const missing = item.hardPrereqs.filter((id) => !isMastered(id));

          return (
            <li key={item.skillId}>
              <Link
                href={`/learn/${item.lessonId}`}
                className="block rounded-lg border border-border bg-surface p-4 transition hover:border-accent"
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium ${
                      mastered
                        ? 'bg-accent text-white'
                        : read
                          ? 'bg-accent-soft text-accent'
                          : 'border border-border text-ink-soft'
                    }`}
                    aria-hidden
                  >
                    {mastered ? '✓' : i + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="font-medium leading-snug">{item.skillTitle}</p>
                    {/* The observable "can do X" — what being credited actually means. */}
                    <p className="mt-0.5 text-sm text-ink-soft">{item.statement}</p>

                    <p className="mt-2 text-xs text-ink-soft">
                      {item.estMinutes} min · {item.exerciseCount} exercises
                      {loaded && progress !== undefined && !mastered && (
                        <> · {progress.correct}/3 toward credit</>
                      )}
                    </p>

                    {/* The soft gate. Named, not locked. */}
                    {loaded && missing.length > 0 && (
                      <p className="mt-2 rounded border border-warn/30 bg-warn-soft px-2 py-1.5 text-xs text-warn">
                        Builds on {missing.map(titleOf).join(' and ')}, which you haven&apos;t
                        shown yet. You can carry on — it may just be harder.
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
