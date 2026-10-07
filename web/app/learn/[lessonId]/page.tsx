import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/Header.tsx';
import { LessonPlayer } from '../../../components/LessonPlayer.tsx';
import { MarkRead } from '../../../components/MarkRead.tsx';
import { lesson, locate } from '../../../lib/content.ts';

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const l = lesson(lessonId);
  const where = locate(lessonId);
  if (l === undefined || where === undefined) notFound();

  const next = where.path.items[where.index + 1];

  return (
    <main>
      <Header />
      <MarkRead lessonId={lessonId} />

      <section className="pt-8 pb-6">
        <Link href={`/path/${where.path.slug}`} className="text-sm text-ink-soft hover:text-accent">
          ← {where.path.title}
        </Link>

        <p className="mt-4 text-xs text-ink-soft">
          Skill {where.index + 1} of {where.path.items.length} · {l.estMinutes} min
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{where.item.skillTitle}</h1>
        {/* What being credited actually means — stated up front, not discovered at the end. */}
        <p className="mt-2 text-ink-soft">
          By the end: <span className="text-ink">{where.item.statement}</span>
        </p>
      </section>

      <LessonPlayer
        blocks={l.blocks}
        skillId={where.item.skillId}
        {...(next !== undefined
          ? { nextHref: `/learn/${next.lessonId}`, nextLabel: next.skillTitle }
          : {})}
      />

      {/* Provenance, visible to the learner. "A model wrote it" is a reason to doubt a
          lesson; "here is the sentence it rests on" is a reason not to. */}
      <section className="mt-10 rounded-lg border border-border p-4">
        <h2 className="text-xs font-medium uppercase tracking-wide text-ink-soft">
          What this rests on
        </h2>
        <ul className="mt-2 space-y-1 text-sm text-ink-soft">
          {l.citations.map((c, i) => (
            <li key={i} className="border-l-2 border-border pl-3 italic">
              &ldquo;{c.quote}&rdquo;
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-soft">
          Drafted by {l.genModel}, checked against these sources by a different model.
          {l.sampledForReview && ' Also queued for human review.'}{' '}
          <button type="button" className="underline hover:text-warn">
            Something wrong?
          </button>
        </p>
      </section>
    </main>
  );
}
