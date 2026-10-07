'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireReviewer } from '../../lib/review-auth.ts';
import { reviewStore } from '../../lib/review-store.ts';
import type { ReviewVerdict } from '@learnloop/engine/store/types.ts';

/**
 * Record a verdict.
 *
 * Checks access again here rather than trusting that the page rendered — a server action
 * is a public endpoint, and "the UI wouldn't let you" is not access control.
 */
export async function submitReview(formData: FormData): Promise<void> {
  const { reviewerId } = await requireReviewer();

  const lessonId = String(formData.get('lessonId') ?? '');
  const verdict = String(formData.get('verdict') ?? '') as ReviewVerdict;
  const notes = String(formData.get('notes') ?? '').trim();
  const isExpert = formData.get('isExpert') === 'on';

  if (lessonId === '' || !['approve', 'reject', 'needs_edit'].includes(verdict)) {
    throw new Error('a review needs a lesson and a verdict');
  }

  // Rejecting without a word leaves nobody able to fix it.
  if (verdict !== 'approve' && notes.length < 10) {
    throw new Error('rejecting or requesting an edit needs a note saying what is wrong');
  }

  await reviewStore().recordReview({
    lessonId,
    verdict,
    notes,
    // Real identity when Supabase is configured; null under the dev token, because a
    // made-up reviewer id would be worse than none. See lib/review-auth.ts.
    reviewerId,
    isExpert,
  });

  revalidatePath('/review');
  redirect('/review');
}
