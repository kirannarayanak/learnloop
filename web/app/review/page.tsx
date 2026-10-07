import Link from 'next/link';
import { checkAccess } from '../../lib/review-auth.ts';
import { databaseConfigured, reviewStore } from '../../lib/review-store.ts';

export const dynamic = 'force-dynamic';

const REASON_LABEL: Record<string, string> = {
  high_risk: 'High-risk domain — human approval required',
  sampled: 'Sampled from medium-risk content',
  auto_failed: 'Automated verification failed',
  flagged: 'Reported by a learner',
};

function Setup({ children }: { children: React.ReactNode }) {
  return (
    <main className="py-16">
      <h1 className="text-xl font-semibold">Review</h1>
      <div className="mt-3 max-w-prose space-y-3 text-sm text-ink-soft">{children}</div>
    </main>
  );
}

export default async function ReviewQueue() {
  // middleware.ts has already exchanged any ?token= for a cookie and stripped it.
  const access = await checkAccess();

  // Fails closed: with no token configured the tool shows setup instructions and no data.
  if (!access.ok && access.reason === 'not_configured') {
    return (
      <Setup>
        <p>
          The review tool is disabled because <code>REVIEW_TOKEN</code> is not set.
        </p>
        <p>
          Approving is the only route a high-risk lesson has to publication, so this tool
          will not run without one. Set it in <code>.env</code> and open{' '}
          <code>/review?token=…</code>.
        </p>
        <p>
          It is a shared secret, not identity — don&apos;t expose this to the public
          internet. Real auth arrives with Supabase.
        </p>
      </Setup>
    );
  }

  if (!access.ok && access.reason === 'signed_out') {
    return (
      <Setup>
        <p>You need to be signed in to review.</p>
        <p>
          <Link href="/login" className="underline hover:text-accent">Sign in</Link>, then
          come back.
        </p>
      </Setup>
    );
  }

  if (!access.ok && access.reason === 'not_a_reviewer') {
    return (
      <Setup>
        <p>This account does not have the reviewer role.</p>
        <p>
          Reviewing is granted from the database, deliberately — approving is the only
          route high-risk content has to publication, so it should not be a button someone
          can be talked into pressing. An admin runs:
        </p>
        <pre className="rounded border border-border bg-surface p-3 text-xs">
          select public.grant_platform_role(&apos;you@example.org&apos;, &apos;reviewer&apos;);
        </pre>
      </Setup>
    );
  }

  if (!access.ok) {
    return (
      <Setup>
        <p>Not authorised.</p>
        <p>
          Open <code>/review?token=…</code> with the value of <code>REVIEW_TOKEN</code>.
        </p>
      </Setup>
    );
  }

  if (!databaseConfigured()) {
    return (
      <Setup>
        <p>
          <code>DATABASE_URL</code> is not set.
        </p>
        <p>
          Reviewing writes to the database, so it cannot run against the generated snapshot
          the learner app reads. Start one with <code>docker compose up -d</code> and run{' '}
          <code>npm run migrate</code>.
        </p>
      </Setup>
    );
  }

  const queue = await reviewStore().listReviewQueueDetailed();

  return (
    <main className="py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-ink-soft">
          {queue.length} waiting
        </p>
      </div>

      <p className="mt-2 max-w-prose text-sm text-ink-soft">
        Nothing here has reached a learner. High-risk content cannot publish at all until
        someone approves it.
      </p>

      {queue.length === 0 ? (
        <p className="mt-10 rounded-lg border border-border bg-surface p-6 text-sm text-ink-soft">
          Queue is empty. Generated content lands here when its domain is high-risk, when
          it is sampled from medium-risk content, when automated verification fails, or
          when a learner reports it.
        </p>
      ) : (
        <ul className="mt-6 space-y-3">
          {queue.map((item) => (
            <li key={item.entityId}>
              <Link
                href={`/review/${item.entityId}`}
                className="block rounded-lg border border-border bg-surface p-4 transition hover:border-accent"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-xs text-ink-soft">{item.domainTitle}</p>
                  {item.riskTier === 'high' && (
                    <span className="shrink-0 rounded border border-warn/40 bg-warn-soft px-1.5 py-0.5 text-xs font-medium text-warn">
                      high risk
                    </span>
                  )}
                </div>
                <p className="mt-1 font-medium">{item.lessonTitle}</p>
                <p className="mt-0.5 text-sm text-ink-soft">{item.skillStatement}</p>
                <p className="mt-2 text-xs text-ink-soft">
                  {REASON_LABEL[item.reason] ?? item.reason} · {item.blockCount} blocks ·{' '}
                  verification: {item.verifyState}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
