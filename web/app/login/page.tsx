'use client';

import { useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase/client.ts';

/**
 * Sign-in by emailed link.
 *
 * No password on purpose: a password is one more thing to be breached, reset and
 * forgotten, and for a product aimed at people on shared and borrowed devices the reset
 * flow is the part that actually fails. A link to an inbox they already have works on a
 * borrowed phone.
 */
export default function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    try {
      const { error } = await supabaseBrowser().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error !== null) throw error;
      setState('sent');
    } catch (error) {
      setState('error');
      setMessage(error instanceof Error ? error.message : 'Could not send the link.');
    }
  }

  if (state === 'sent') {
    return (
      <main className="py-16">
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="mt-2 max-w-prose text-sm text-ink-soft">
          We sent a sign-in link to <span className="text-ink">{email}</span>. It works once
          and expires shortly.
        </p>
      </main>
    );
  }

  return (
    <main className="py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
      <p className="mt-2 max-w-prose text-sm text-ink-soft">
        An account keeps your progress when you change device. You can learn without one —
        everything works signed out, it just stays in this browser.
      </p>

      <form onSubmit={send} className="mt-6 max-w-sm">
        <label className="block">
          <span className="text-sm">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-border bg-surface p-3 text-sm outline-none focus:border-accent"
          />
        </label>

        <button
          type="submit"
          disabled={state === 'sending'}
          className="mt-3 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {state === 'sending' ? 'Sending…' : 'Email me a link'}
        </button>

        {state === 'error' && <p className="mt-3 text-sm text-warn">{message}</p>}
      </form>
    </main>
  );
}
