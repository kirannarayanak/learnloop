import 'server-only';

/**
 * Access control for the review tool.
 *
 * Approving is the ONLY route a high-risk lesson has to publication (docs/07-risks.md), so
 * this is the most security-sensitive check in the app.
 *
 * Two modes, and which one applies is decided by the environment rather than by a flag:
 *
 *  - **Supabase configured** → real identity. The signed-in user must have
 *    `profiles.platform_role` of reviewer or admin, which is granted by a database
 *    function and cannot be self-assigned (db/migrations/007). `reviewer_id` is recorded,
 *    so "who approved this" is genuinely answerable.
 *
 *  - **Supabase NOT configured** → the REVIEW_TOKEN shared secret, for local development
 *    only. It is identity-free, so reviews are recorded with a null reviewer.
 *
 * The token path is REFUSED when Supabase is configured. Otherwise deploying with both set
 * would leave a credential-free backdoor to the approve button alongside real auth, and
 * nobody would notice because everything would appear to work.
 */

import { cookies } from 'next/headers';
import { supabaseConfigured } from './supabase/config.ts';
import { currentUser, supabaseServer } from './supabase/server.ts';

export const REVIEW_COOKIE = 'learnloop_review';

export type AccessState =
  | { ok: true; reviewerId: string | null; email: string | null }
  | { ok: false; reason: 'not_configured' | 'unauthorized' | 'not_a_reviewer' | 'signed_out' };

/** Constant-time comparison, so the token can't be recovered a character at a time. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function checkSupabaseAccess(): Promise<AccessState> {
  const user = await currentUser();
  if (user === null) return { ok: false, reason: 'signed_out' };

  const supabase = await supabaseServer();
  // RLS lets a learner read only their own profile, which is exactly this row.
  const { data } = await supabase
    .from('profiles')
    .select('platform_role')
    .eq('id', user.id)
    .single();

  const role = (data as { platform_role?: string } | null)?.platform_role;
  if (role !== 'reviewer' && role !== 'admin') return { ok: false, reason: 'not_a_reviewer' };

  return { ok: true, reviewerId: user.id, email: user.email ?? null };
}

async function checkTokenAccess(tokenFromQuery?: string): Promise<AccessState> {
  const expected = process.env.REVIEW_TOKEN;
  // Fail closed: with nothing configured the tool shows setup instructions and no data.
  if (expected === undefined || expected === '') return { ok: false, reason: 'not_configured' };

  if (tokenFromQuery !== undefined && tokensMatch(tokenFromQuery, expected)) {
    return { ok: true, reviewerId: null, email: null };
  }

  const jar = await cookies();
  const fromCookie = jar.get(REVIEW_COOKIE)?.value;
  if (fromCookie !== undefined && tokensMatch(fromCookie, expected)) {
    return { ok: true, reviewerId: null, email: null };
  }

  return { ok: false, reason: 'unauthorized' };
}

export async function checkAccess(tokenFromQuery?: string): Promise<AccessState> {
  // Real auth wins whenever it exists. The token is never a fallback FROM it — only an
  // alternative to having it at all.
  return supabaseConfigured() ? checkSupabaseAccess() : checkTokenAccess(tokenFromQuery);
}

/** Throws unless access is granted, and returns who. For server actions. */
export async function requireReviewer(): Promise<{ reviewerId: string | null }> {
  const access = await checkAccess();
  if (!access.ok) {
    throw new Error(
      access.reason === 'not_configured'
        ? 'Review is disabled: configure Supabase, or set REVIEW_TOKEN for local development.'
        : access.reason === 'not_a_reviewer'
          ? 'This account does not have the reviewer role.'
          : 'Not authorised to review.',
    );
  }
  return { reviewerId: access.reviewerId };
}
