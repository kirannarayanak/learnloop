'use client';

/**
 * Narration via the browser's built-in SpeechSynthesis.
 *
 * Why the built-in engine rather than a hosted TTS API: it is free, needs no network,
 * works offline, and costs nothing per learner. Narrated lessons are only compatible with
 * being free at the point of use if the audio is free (docs/05-economics.md).
 *
 * Mayer's original voice principle preferred human narration over synthetic. His own 2012
 * follow-up found no difference with better synthesis, and later work found modern TTS
 * beating human voice on transfer — so the old objection has expired
 * (docs/11-lesson-design.md). Engine quality is what matters, and it varies by device,
 * which is why voice here is offered and never required.
 *
 * Off by default, and remembered. Audio that starts by itself is hostile on a shared
 * phone or in a classroom.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

const PREF_KEY = 'learnloop.narration.v1';

export interface NarrationPrefs {
  enabled: boolean;
  rate: number;
}

const DEFAULTS: NarrationPrefs = { enabled: false, rate: 1 };

function loadPrefs(): NarrationPrefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    return raw === null ? DEFAULTS : { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NarrationPrefs>) };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(p: NarrationPrefs): void {
  try {
    window.localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    // Blocked storage just means the preference doesn't persist. Not fatal.
  }
}

/** Prefer a natural-sounding local voice; engine quality is what the evidence turns on. */
function pickVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | undefined {
  const english = voices.filter((v) => v.lang.startsWith('en'));
  const pool = english.length > 0 ? english : voices;
  return (
    pool.find((v) => /natural|neural|premium|enhanced/i.test(v.name)) ??
    pool.find((v) => v.localService) ??
    pool[0]
  );
}

export function useNarration() {
  const [prefs, setPrefs] = useState<NarrationPrefs>(DEFAULTS);
  const [speaking, setSpeaking] = useState(false);
  const [supported, setSupported] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | undefined>(undefined);
  const prefsRef = useRef<NarrationPrefs>(DEFAULTS);
  const supportedRef = useRef(false);

  useEffect(() => {
    const initial = loadPrefs();
    prefsRef.current = initial;
    setPrefs(initial);
    setLoaded(true);

    const ok = typeof window !== 'undefined' && 'speechSynthesis' in window;
    supportedRef.current = ok;
    setSupported(ok);
    if (!ok) return;

    // Voices populate asynchronously in several browsers, so read them twice.
    const read = () => {
      voiceRef.current = pickVoice(window.speechSynthesis.getVoices());
    };
    read();
    window.speechSynthesis.addEventListener('voiceschanged', read);

    return () => {
      window.speechSynthesis.removeEventListener('voiceschanged', read);
      window.speechSynthesis.cancel();
    };
  }, []);

  const stop = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, []);

  // Reads prefs from a ref so its identity never changes — see the note above.
  const speak = useCallback((text: string) => {
    if (!supportedRef.current || !prefsRef.current.enabled || text.trim() === '') return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    if (voiceRef.current !== undefined) utterance.voice = voiceRef.current;
    utterance.rate = prefsRef.current.rate;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);

    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, []);

  const setEnabled = useCallback(
    (enabled: boolean) => {
      setPrefs((p) => {
        const next = { ...p, enabled };
        prefsRef.current = next;
        savePrefs(next);
        return next;
      });
      if (!enabled) stop();
    },
    [stop],
  );

  const setRate = useCallback((rate: number) => {
    setPrefs((p) => {
      const next = { ...p, rate };
      prefsRef.current = next;
      savePrefs(next);
      return next;
    });
  }, []);

  return {
    ...prefs,
    loaded,
    supported,
    speaking,
    speak,
    stop,
    setEnabled,
    setRate,
    /**
     * Whether the written narration should be shown.
     *
     * This is the redundancy principle in one line: narration PLUS the same words on
     * screen is measurably worse than narration alone (d = 0.69). So the transcript is a
     * substitute for the audio, never an accompaniment — it shows when voice is off, when
     * the browser can't speak, or when the learner asks for it explicitly.
     */
    showTranscript: !prefs.enabled || !supported,
  };
}
