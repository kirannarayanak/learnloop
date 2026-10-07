'use client';

import { useEffect } from 'react';
import { useLearner } from '../lib/learner.tsx';

/**
 * Credits reading the lesson, which also extends the streak — any genuine activity
 * counts, not just hitting the daily goal (docs/10-motivation.md finding 4).
 *
 * A separate component so the lesson page itself stays a server component.
 */
export function MarkRead({ lessonId }: { lessonId: string }) {
  const { readLesson, loaded } = useLearner();

  useEffect(() => {
    if (loaded) readLesson(lessonId);
  }, [loaded, lessonId, readLesson]);

  return null;
}
