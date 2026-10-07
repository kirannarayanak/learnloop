import { NextResponse, type NextRequest } from 'next/server';
import { refreshSession } from './lib/supabase/middleware.ts';
import { supabaseConfigured } from './lib/supabase/config.ts';

/**
 * Two jobs, in order:
 *
 *  1. Refresh the Supabase session on every request. Access tokens are short-lived, and
 *     without this a learner is signed out mid-lesson — which means losing the answer
 *     they just gave.
 *
 *  2. For the review tool in local development only, exchange `?token=…` for a cookie and
 *     strip it from the URL. A token in the URL leaks into history and into the Referer
 *     header on outbound links — and reviewing means clicking through to cited sources, so
 *     outbound links are the normal case here, not an edge case.
 */
export async function middleware(request: NextRequest) {
  // Once Supabase is configured the token path is dead, so don't honour it at all. A
  // credential-free route to the approve button sitting alongside real auth is the kind
  // of backdoor nobody notices, because everything appears to work.
  if (!supabaseConfigured() && request.nextUrl.pathname.startsWith('/review')) {
    const expected = process.env.REVIEW_TOKEN;
    const token = request.nextUrl.searchParams.get('token');

    if (expected !== undefined && expected !== '' && token !== null) {
      const url = request.nextUrl.clone();
      url.searchParams.delete('token');

      if (token !== expected) {
        // Don't echo a wrong token back; let the route render "not authorised".
        return NextResponse.redirect(url);
      }

      const response = NextResponse.redirect(url);
      response.cookies.set('learnloop_review', expected, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/review',
        maxAge: 60 * 60 * 12,
      });
      return response;
    }
  }

  return refreshSession(request);
}

export const config = {
  // Everything except static assets — the session refresh has to run app-wide.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
