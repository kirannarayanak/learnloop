'use client';

import { createBrowserClient } from '@supabase/ssr';
import { supabaseEnv } from './config.ts';

/** Browser client. Anon key only — it is public by design and constrained by RLS. */
export function supabaseBrowser() {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient(url, anonKey);
}
