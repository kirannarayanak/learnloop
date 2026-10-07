import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { supabaseConfigured, supabaseEnv } from './config.ts';

/**
 * Refresh the auth session on every request.
 *
 * Supabase access tokens are short-lived. Without a refresh here a user is signed out
 * mid-session, which on a lesson page means losing an answer they just gave.
 */
export async function refreshSession(request: NextRequest): Promise<NextResponse> {
  if (!supabaseConfigured()) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const { url, anonKey } = supabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Do not remove: this call is what performs the refresh.
  await supabase.auth.getUser();
  return response;
}
