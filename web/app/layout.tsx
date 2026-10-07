import type { Metadata, Viewport } from 'next';
import './globals.css';

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
        <div className="mx-auto max-w-3xl px-4 pb-24">{children}</div>
      </body>
    </html>
  );
}
