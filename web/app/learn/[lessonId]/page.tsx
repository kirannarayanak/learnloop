import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/Header.tsx';
import { Markdown } from '../../../components/Markdown.tsx';
import { Practice } from '../../../components/Practice.tsx';
import { MarkRead } from '../../../components/MarkRead.tsx';
import { exercisesFor, lesson, locate } from '../../../lib/content.ts';

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  const l = lesson(lessonId);
  const where = locate(lessonId);
  if (l === undefined || where === undefined) notFound();

  const exercises = exercisesFor(lessonId);
  const next = where.path.items[where.index + 1];

  return (
    <main>
      <Header />
      <MarkRead lessonId={lessonId} />

      <section className="py-8">
        <Link href={`/path/${where.path.slug}`} className="text-sm text-ink-soft hover:text-accent">
          ← {where.path.title}
        </Link>

        <p className="mt-4 text-xs text-ink-soft">
          Skill {where.index + 1} of {where.path.items.length} · {l.estMinutes} min
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">
          {where.item.skillTitle}
        </h1>
        {/* What being credited actually means — stated before the lesson, not after. */}
        <p className="mt-2 text-ink-soft">
          By the end: <span className="text-ink">{where.item.statement}</span>
        </p>
      </section>

      <article className="rounded-lg border border-border bg-surface p-6">
        <Markdown source={l.bodyMd} />
      </article>

      {/* Provenance, visible to the learner. "A model wrote it" is a reason to doubt a
          lesson; "here is the sentence it rests on" is a reason to believe it. */}
      <section className="mt-4 rounded-lg border border-border p-4">
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

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-ink-soft">
          Practice
        </h2>
        <Practice exercises={exercises} skillId={where.item.skillId} />
      </section>

      {next !== undefined && (
        <nav className="mt-8 border-t border-border pt-4">
          <Link
            href={`/learn/${next.lessonId}`}
            className="text-sm text-accent hover:underline"
          >
            Next skill: {next.skillTitle} →
          </Link>
        </nav>
      )}
    </main>
  );
}
