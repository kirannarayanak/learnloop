import 'server-only';

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 *
 * Always the ANON key, never the service role key. The anon key is subject to RLS, so a
 * bug in a query leaks nothing a policy forbids — which is the entire reason the policies
 * exist (db/migrations/006-rls.sql). The service role key bypasses RLS and belongs only in
 * the pipeline, server-side, where no user input reaches it.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { supabaseConfigured, supabaseEnv } from './config.ts';

export async function supabaseServer() {
  const { url, anonKey } = supabaseEnv();
  const jar = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (toSet) => {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // Server Components cannot set cookies. Harmless: middleware refreshes the
          // session on every request, so the write always lands somewhere.
        }
      },
    },
  });
}

/**
 * The signed-in user, or null. Never throws — callers decide what unauthenticated means.
 *
 * Includes the unconfigured case: without Supabase there is simply nobody signed in, which
 * callers already handle. Throwing here turned a 401 into a 500 on /api/sync.
 */
export async function currentUser() {
  if (!supabaseConfigured()) return null;
  const supabase = await supabaseServer();
  // getUser() revalidates against the auth server. getSession() reads a cookie the client
  // could have tampered with, so it must not be trusted for an access decision.
  const { data, error } = await supabase.auth.getUser();
  return error !== null ? null : data.user;
}
