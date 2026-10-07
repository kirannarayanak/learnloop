import type { Metadata, Viewport } from 'next';
import './globals.css';
import { LearnerProvider } from '../lib/learner.tsx';
import { canSyncProgress } from '../lib/content.ts';

export const metadata: Metadata = {
  title: 'LearnLoop',
  description:
    'Any source, turned into a learning path you can actually finish — including the things invented last week.',
};

// Built for a cheap phone on bad data first; see docs/02-architecture.md.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        {/* One owner for learner state. Without it each component held its own copy and
            the header's points went stale the moment you answered a question. */}
        <LearnerProvider syncEnabled={canSyncProgress()}>
          <div className="mx-auto max-w-3xl px-4 pb-24">{children}</div>
        </LearnerProvider>
      </body>
    </html>
  );
}
