import { NextResponse, type NextRequest } from 'next/server';
import { currentUser } from '../../../lib/supabase/server.ts';
import { databaseConfigured, reviewStore } from '../../../lib/review-store.ts';
import type { SyncAttempt, SyncPointEvent } from '@learnloop/engine/store/types.ts';

export const dynamic = 'force-dynamic';

/** Keep one request bounded. A client with a year of offline history flushes in batches. */
const MAX_BATCH = 500;

/**
 * Push queued learner activity and get the merged state back.
 *
 * The user id comes from the session, NEVER from the body. A client that could name the
 * user whose progress it is writing could write anyone's — and RLS would allow it, because
 * the policy compares against auth.uid() and we would be handing it a different id.
 */
export async function POST(request: NextRequest) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: 'sync is unavailable' }, { status: 503 });
  }

  const user = await currentUser();
  if (user === null) {
    return NextResponse.json({ error: 'sign in to sync progress' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }

  const payload = body as {
    attempts?: SyncAttempt[];
    pointEvents?: SyncPointEvent[];
    timeZone?: string;
    today?: string;
  };

  const attempts = (payload.attempts ?? []).slice(0, MAX_BATCH);
  const pointEvents = (payload.pointEvents ?? []).slice(0, MAX_BATCH);

  try {
    const state = await reviewStore().syncLearner({
      userId: user.id,
      // Streaks follow the learner's day, and the browser is the only thing that knows
      // which day that is.
      timeZone: payload.timeZone ?? 'UTC',
      attempts,
      pointEvents,
      ...(payload.today !== undefined ? { today: payload.today } : {}),
    });
    return NextResponse.json(state);
  } catch (error) {
    // A skill id that no longer exists (regenerated content, a stale client) must not
    // wedge the outbox forever — report it so the client can drop the batch.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'sync failed' },
      { status: 422 },
    );
  }
}

/** Pull state for a device that has nothing to push — a fresh sign-in. */
export async function GET(request: NextRequest) {
  if (!databaseConfigured()) {
    return NextResponse.json({ error: 'sync is unavailable' }, { status: 503 });
  }
  const user = await currentUser();
  if (user === null) {
    return NextResponse.json({ error: 'sign in to sync progress' }, { status: 401 });
  }

  const timeZone = request.nextUrl.searchParams.get('tz') ?? 'UTC';
  const today = request.nextUrl.searchParams.get('today') ?? undefined;
  const state = await reviewStore().getLearnerState(user.id, timeZone, today);
  return NextResponse.json(state);
}
