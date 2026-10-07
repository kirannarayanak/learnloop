import { NextResponse, type NextRequest } from 'next/server';

/**
 * Exchanges `?token=…` for a cookie, once, and strips it from the URL.
 *
 * Two reasons this is middleware rather than a check inside the page:
 *
 *  1. A Server Component cannot set a cookie, so without this the token would have to be
 *     threaded through every link — and the first link that forgot it would 401.
 *  2. A token in the URL leaks: into browser history, into the Referer header on any
 *     outbound link, into logs. Reviewing a lesson means clicking through to its cited
 *     sources, so outbound links are the normal case here, not an edge case.
 */
export function middleware(request: NextRequest) {
  const expected = process.env.REVIEW_TOKEN;
  if (expected === undefined || expected === '') return NextResponse.next();

  const token = request.nextUrl.searchParams.get('token');
  if (token === null) return NextResponse.next();

  if (token !== expected) {
    // Don't echo a wrong token back into the page; let the route render "not authorised".
    const url = request.nextUrl.clone();
    url.searchParams.delete('token');
    return NextResponse.redirect(url);
  }

  const url = request.nextUrl.clone();
  url.searchParams.delete('token');
  const response = NextResponse.redirect(url);
  response.cookies.set('learnloop_review', expected, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/review',
    // Session-length. A reviewer's access should not outlive their browser.
    maxAge: 60 * 60 * 12,
  });
  return response;
}

export const config = { matcher: '/review/:path*' };
