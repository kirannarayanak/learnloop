import Link from 'next/link';
import { notFound } from 'next/navigation';
import { checkAccess } from '../../../lib/review-auth.ts';
import { databaseConfigured, reviewStore } from '../../../lib/review-store.ts';
import { ReviewBlocks } from '../../../components/ReviewBlocks.tsx';
import { submitReview } from '../actions.ts';

export const dynamic = 'force-dynamic';

export default async function ReviewLesson({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const access = await checkAccess();
  if (!access.ok) {
    return (
      <main className="py-16 text-sm text-ink-soft">
        Not authorised.{' '}
        <Link href="/review" className="underline hover:text-accent">Back to the queue</Link>
        {' '}for how to get access.
      </main>
    );
  }
  if (!databaseConfigured()) notFound();

  const { lessonId } = await params;
  const item = await reviewStore().getLessonForReview(lessonId);
  if (item === undefined) notFound();

  const isHighRisk = item.riskTier === 'high';

  return (
    <main className="py-8">
      <Link href="/review" className="text-sm text-ink-soft hover:text-accent">
        ← Review queue
      </Link>

      <header className="mt-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs text-ink-soft">{item.domainTitle}</p>
          {isHighRisk && (
            <span className="rounded border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
              high risk — approval required to publish
            </span>
          )}
        </div>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{item.skillTitle}</h1>
        <p className="mt-2 text-ink-soft">
          Claims to teach: <span className="text-ink">{item.skillStatement}</span>
        </p>
      </header>

      {/* The evidence first. A reviewer judging correctness without the source is just
          guessing, and the whole point of this queue is that a model already guessed. */}
      <section className="mt-6 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
          What it is allowed to rest on
        </h2>
        {item.citations.length === 0 ? (
          <p className="mt-2 text-sm text-warn">
            No citations. This cannot publish regardless of your verdict — an uncited claim
            is unverifiable by construction.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {item.citations.map((c, i) => (
              <li key={i} className="border-l-2 border-border pl-3 text-sm">
                <p className="italic text-ink-soft">&ldquo;{c.quote}&rdquo;</p>
                <p className="mt-0.5 text-xs text-ink-soft">
                  {c.sourceUri !== null ? (
                    <a href={c.sourceUri} target="_blank" rel="noreferrer noopener" className="underline hover:text-accent">
                      source
                    </a>
                  ) : (
                    'source: uploaded'
                  )}
                  {c.sourceLicense !== null && ` · ${c.sourceLicense}`}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-ink-soft">
          Check the quotes against the source. A plausible sentence that is not actually in
          the source is the failure mode worth looking for.
        </p>
      </section>

      {/* Whole lesson, answers marked. The reviewer is auditing, not learning. */}
      <section className="mt-6 rounded-lg border border-border bg-surface p-5">
        <ReviewBlocks blocks={item.lesson.blocks} />
      </section>

      <form action={submitReview} className="mt-8 rounded-lg border border-border p-5">
        <input type="hidden" name="lessonId" value={item.lesson.id} />

        <h2 className="font-medium">Your verdict</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Drafted by {item.lesson.genModel}, checked by a different model, queued because:{' '}
          {item.reason.replace('_', ' ')}.
        </p>

        <label className="mt-4 block">
          <span className="text-sm">Notes</span>
          <textarea
            name="notes"
            rows={3}
            placeholder="What is wrong, or what you checked. Required unless you are approving."
            className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" name="isExpert" className="size-4 accent-[var(--accent)]" />
          <span>
            I have subject knowledge in {item.domainTitle.toLowerCase()}
          </span>
        </label>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="submit" name="verdict" value="approve"
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Approve{isHighRisk && ' and publish'}
          </button>
          <button
            type="submit" name="verdict" value="needs_edit"
            className="rounded-md border border-border px-4 py-2 text-sm hover:border-accent"
          >
            Needs edit
          </button>
          <button
            type="submit" name="verdict" value="reject"
            className="rounded-md border border-warn/40 px-4 py-2 text-sm text-warn hover:bg-warn-soft"
          >
            Reject
          </button>
        </div>

        <p className="mt-3 text-xs text-ink-soft">
          Your decision is recorded permanently. Approving is the only thing that lets this
          reach a learner.
        </p>
      </form>
    </main>
  );
}
