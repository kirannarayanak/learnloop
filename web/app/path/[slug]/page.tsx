import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/Header.tsx';
import { SkillMap } from '../../../components/SkillMap.tsx';
import { pathBySlug } from '../../../lib/content.ts';

export const dynamic = 'force-dynamic';

export default async function PathPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const path = await pathBySlug(slug);
  if (path === undefined) notFound();

  return (
    <main>
      <Header />

      <section className="py-8">
        <Link href="/" className="text-sm text-ink-soft hover:text-accent">
          ← All paths
        </Link>
        <p className="mt-4 text-xs text-ink-soft">{path.domainTitle}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{path.title}</h1>
        <p className="mt-2 text-ink-soft">{path.summary}</p>
        <p className="mt-3 text-xs text-ink-soft">
          Built from{' '}
          <a
            href={path.sourceUri}
            className="underline hover:text-accent"
            rel="noreferrer noopener"
            target="_blank"
          >
            one source
          </a>
          . Skills are in prerequisite order.
        </p>
      </section>

      <SkillMap items={path.items} />
    </main>
  );
}
