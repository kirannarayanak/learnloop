import 'server-only';

/**
 * Access control for the review tool.
 *
 * Approving is the ONLY route a high-risk lesson has to publication (docs/07-risks.md).
 * An unauthenticated approve button would make the entire gate decorative, so this is a
 * real check rather than a TODO — even though it is a deliberately simple one.
 *
 * It is a shared secret, not identity. That has a consequence worth stating plainly:
 * `reviews.reviewer_id` stays NULL, because recording a made-up reviewer would be worse
 * than recording none. "Who approved this" becomes answerable when Supabase Auth lands
 * in wave 1; until then the audit row honestly says a human approved it and does not
 * claim to know which.
 *
 * Consequence of that: do not expose this to the public internet. It is for an operator
 * on a trusted network, and the roadmap treats real auth as a prerequisite for the first
 * school cohort.
 */

import { cookies } from 'next/headers';

export const REVIEW_COOKIE = 'learnloop_review';

export type AccessState =
  | { ok: true }
  | { ok: false; reason: 'not_configured' }
  | { ok: false; reason: 'unauthorized' };

/** Constant-time comparison, so the token can't be recovered a character at a time. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function checkAccess(tokenFromQuery?: string): Promise<AccessState> {
  const expected = process.env.REVIEW_TOKEN;

  // Fail closed. With no token configured the tool shows setup instructions and no data —
  // it never falls back to open access.
  if (expected === undefined || expected === '') return { ok: false, reason: 'not_configured' };

  if (tokenFromQuery !== undefined && tokensMatch(tokenFromQuery, expected)) return { ok: true };

  const jar = await cookies();
  const fromCookie = jar.get(REVIEW_COOKIE)?.value;
  if (fromCookie !== undefined && tokensMatch(fromCookie, expected)) return { ok: true };

  return { ok: false, reason: 'unauthorized' };
}

/** Throws unless access is granted. For server actions, where rendering is not an option. */
export async function requireAccess(): Promise<void> {
  const access = await checkAccess();
  if (!access.ok) {
    throw new Error(
      access.reason === 'not_configured'
        ? 'REVIEW_TOKEN is not set — the review tool is disabled.'
        : 'Not authorised to review.',
    );
  }
}
