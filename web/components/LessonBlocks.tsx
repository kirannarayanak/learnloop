'use client';

/**
 * Renderers for each lesson block type.
 *
 * Each block is a cognitive move (docs/11-lesson-design.md), so the rendering rules below
 * are pedagogical rather than decorative:
 *
 *  - Narration text is NOT displayed while audio is on. Showing it alongside the audio is
 *    the redundancy penalty (d = 0.69), so the transcript substitutes for the voice and
 *    never accompanies it.
 *  - The diagram dims everything except the step being discussed (signalling) and the
 *    narration arrives with the highlight, not before or after it (temporal contiguity,
 *    the largest effect available to us at d = 1.30).
 *  - Nothing here awards points for a correct answer. Unchanged from docs/10-motivation.md.
 */

import { useEffect, useState } from 'react';
import type {
  CheckBlock, ConceptBlock, DiagramBlock, DiagramNode, ExplainBackBlock, PretrainBlock,
  PredictBlock, RecapBlock, WorkedExampleBlock,
} from '@learnloop/engine/stages/blocks.ts';

export interface BlockProps {
  /** Called when the learner has done what this block asks, unlocking Continue. */
  onSatisfied: () => void;
  /** Speak this text now, if narration is on. */
  speak: (text: string) => void;
  /** True when audio is off or unsupported — then and only then, show the words. */
  showTranscript: boolean;
  /** Recorded as an attempt. Correctness affects mastery, never points. */
  onAttempt: (correct: boolean) => void;
}

/** Narration shown as text ONLY when it is replacing the audio, never alongside it. */
function Transcript({ text, show }: { text: string; show: boolean }) {
  if (!show) return null;
  return <p className="mt-3 leading-relaxed text-ink-soft">{text}</p>;
}

// ============================================================================ pretrain
export function Pretrain({ block, speak, showTranscript, onSatisfied }: BlockProps & { block: PretrainBlock }) {
  useEffect(() => {
    speak(block.narration);
    onSatisfied();
  }, [block, speak, onSatisfied]);

  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-ink-soft">Before we start</p>
      <dl className="mt-3 space-y-2">
        {block.terms.map((t) => (
          <div key={t.term} className="rounded-md border border-border bg-surface px-3 py-2">
            <dt className="text-sm font-medium">{t.term}</dt>
            <dd className="text-sm text-ink-soft">{t.gloss}</dd>
          </div>
        ))}
      </dl>
      <Transcript text={block.narration} show={showTranscript} />
    </section>
  );
}

// ============================================================================= concept
export function Concept({ block, speak, showTranscript, onSatisfied }: BlockProps & { block: ConceptBlock }) {
  useEffect(() => {
    speak(block.narration);
    onSatisfied();
  }, [block, speak, onSatisfied]);

  return (
    <section>
      <h3 className="text-lg font-semibold">{block.heading}</h3>
      {/* Short, scannable, deliberately NOT sentences — the eye gets labels, the ear
          gets the explanation. */}
      <ul className="mt-3 space-y-1.5">
        {block.keyPoints.map((p) => (
          <li key={p} className="flex gap-2 text-sm">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Transcript text={block.narration} show={showTranscript} />
    </section>
  );
}

// ============================================================================= diagram
export function Diagram({ block, speak, showTranscript, onSatisfied }: BlockProps & { block: DiagramBlock }) {
  const [step, setStep] = useState(0);
  const current = block.steps[step];

  useEffect(() => {
    if (current !== undefined) speak(current.narration);
  }, [current, speak]);

  useEffect(() => {
    if (step === block.steps.length - 1) onSatisfied();
  }, [step, block.steps.length, onSatisfied]);

  const lit = new Set(current?.highlight ?? []);
  const nodeAt = (id: string) => block.nodes.find((n) => n.id === id);
  const sy = (y: number) => y * 0.7; // map the 0-100 authoring grid onto a 3:2 canvas

  // Boxes size to their label, and edges stop at the box edge rather than the centre —
  // otherwise arrowheads disappear under the node and labels collide with it.
  const halfW = (label: string) => Math.max(10, label.length * 0.95 + 3);
  const HALF_H = 5;

  /** Where an edge should meet a box: the point on its border along the line of travel. */
  function anchor(n: DiagramNode, towardX: number, towardY: number) {
    const dx = towardX - n.x;
    const dy = sy(towardY) - sy(n.y);
    const w = halfW(n.label);
    // Scale the direction vector until it hits whichever border it reaches first.
    const scale = Math.min(
      Math.abs(dx) < 0.01 ? Infinity : w / Math.abs(dx),
      Math.abs(dy) < 0.01 ? Infinity : HALF_H / Math.abs(dy),
    );
    return { x: n.x + dx * scale, y: sy(n.y) + dy * scale };
  }

  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-ink-soft">{block.caption}</p>

      <div className="mt-3 overflow-hidden rounded-lg border border-border bg-surface">
        <svg viewBox="0 0 100 70" className="w-full" role="img" aria-label={block.caption}>
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4"
              markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--ink-soft)" />
            </marker>
            <marker id="arrow-on" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4"
              markerHeight="4" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)" />
            </marker>
          </defs>

          {block.edges.map((e, i) => {
            const from = nodeAt(e.from);
            const to = nodeAt(e.to);
            if (from === undefined || to === undefined) return null;

            const active = lit.has(e.from) && lit.has(e.to);
            const a = anchor(from, to.x, to.y);
            const b = anchor(to, from.x, from.y);

            // Push the label off the line along its perpendicular, so it never sits on
            // the stroke or on a box. Back edges go to the other side so a pair of
            // opposing edges doesn't stack two labels in the same place.
            const vx = b.x - a.x;
            const vy = b.y - a.y;
            const len = Math.hypot(vx, vy) || 1;
            // Clear the box half-height (5), or a label on a horizontal edge sits level
            // with the boxes it runs between.
            //
            // No sign flip for back edges: the perpendicular is derived from the travel
            // direction, which is already reversed for the return leg, so an opposing
            // pair lands on opposite sides for free. Flipping as well cancels out and
            // stacks both labels in the same place.
            const offset = 6.2;
            const lx = (a.x + b.x) / 2 + (-vy / len) * offset;
            const ly = (a.y + b.y) / 2 + (vx / len) * offset;

            return (
              <g key={i} opacity={active ? 1 : 0.2}>
                <line
                  x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? 'var(--accent)' : 'var(--ink-soft)'}
                  strokeWidth={active ? 0.6 : 0.4}
                  strokeDasharray={e.back === true ? '2 1.5' : undefined}
                  markerEnd={active ? 'url(#arrow-on)' : 'url(#arrow)'}
                />
                {e.label !== undefined && (
                  // A halo in the surface colour keeps the label readable wherever it lands.
                  <text
                    x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize="2.3"
                    fill={active ? 'var(--accent)' : 'var(--ink-soft)'}
                    stroke="var(--surface)" strokeWidth="0.9" paintOrder="stroke"
                  >
                    {e.label}
                  </text>
                )}
              </g>
            );
          })}

          {block.nodes.map((n) => {
            const active = lit.has(n.id);
            const w = halfW(n.label);
            return (
              // Signalling: only what is being discussed stays bright.
              <g key={n.id} opacity={active ? 1 : 0.3}>
                <rect
                  x={n.x - w} y={sy(n.y) - HALF_H} width={w * 2} height={HALF_H * 2} rx="2"
                  fill={active ? 'var(--accent-soft)' : 'var(--surface)'}
                  stroke={active ? 'var(--accent)' : 'var(--border)'}
                  strokeWidth="0.5"
                />
                <text x={n.x} y={sy(n.y)} textAnchor="middle" dominantBaseline="middle"
                  fontSize="3" fill="var(--ink)" fontWeight="500">
                  {n.label}
                </text>
                {n.note !== undefined && (
                  <text x={n.x} y={sy(n.y) + HALF_H + 3} textAnchor="middle" fontSize="2.1"
                    fill="var(--ink-soft)">
                    {n.note}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{current?.label}</p>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-soft">
            {step + 1}/{block.steps.length}
          </span>
          <button
            type="button"
            disabled={step === block.steps.length - 1}
            onClick={() => setStep((s) => Math.min(s + 1, block.steps.length - 1))}
            className="rounded-md border border-border px-2.5 py-1 text-xs hover:border-accent disabled:opacity-40"
          >
            Next step
          </button>
        </div>
      </div>

      {current !== undefined && <Transcript text={current.narration} show={showTranscript} />}
    </section>
  );
}

// ============================================================================= predict
export function Predict({
  block, speak, showTranscript, onSatisfied, onAttempt,
}: BlockProps & { block: PredictBlock }) {
  const [picked, setPicked] = useState<number | null>(null);

  useEffect(() => {
    speak(block.narration);
  }, [block, speak]);

  function choose(i: number): void {
    if (picked !== null) return;
    setPicked(i);
    onAttempt(i === block.correctIndex);
    onSatisfied();
  }

  return (
    <section className="rounded-lg border border-accent/40 bg-accent-soft/40 p-4">
      <p className="text-xs uppercase tracking-wide text-accent">Predict first</p>
      <p className="mt-2 font-medium">{block.question}</p>

      <div className="mt-3 space-y-2">
        {block.options.map((opt, i) => {
          const chosen = picked === i;
          const correct = i === block.correctIndex;
          let tone = 'border-border bg-surface hover:border-accent';
          if (picked !== null && correct) tone = 'border-accent bg-accent-soft';
          else if (chosen) tone = 'border-warn bg-warn-soft';
          else if (picked !== null) tone = 'border-border opacity-50';

          return (
            <button key={opt} type="button" disabled={picked !== null} onClick={() => choose(i)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition ${tone}`}>
              {opt}
            </button>
          );
        })}
      </div>

      {/* A wrong guess still primes the explanation — that is the point of guessing. */}
      {picked !== null && (
        <p className="mt-3 border-t border-accent/20 pt-3 text-sm text-ink-soft">
          {block.reveal}
        </p>
      )}
      {picked === null && <Transcript text={block.narration} show={showTranscript} />}
    </section>
  );
}

// ====================================================================== worked example
export function WorkedExample({
  block, onSatisfied, onAttempt,
}: BlockProps & { block: WorkedExampleBlock }) {
  const [revealed, setRevealed] = useState(0);
  const [fadedAnswers, setFadedAnswers] = useState<Record<number, number>>({});

  const visible = block.steps.slice(0, revealed + 1);
  const currentStep = block.steps[revealed];
  const needsAnswer = currentStep?.faded === true && fadedAnswers[revealed] === undefined;
  const atEnd = revealed === block.steps.length - 1;

  useEffect(() => {
    if (atEnd && !needsAnswer) onSatisfied();
  }, [atEnd, needsAnswer, onSatisfied]);

  return (
    <section>
      <p className="text-xs uppercase tracking-wide text-ink-soft">Worked example</p>
      <p className="mt-1 font-medium">{block.goal}</p>

      <ol className="mt-3 space-y-2">
        {visible.map((s, i) => {
          const answered = fadedAnswers[i];
          const isFadedUnanswered = s.faded === true && answered === undefined;

          return (
            <li key={i} className="rounded-md border border-border bg-surface p-3">
              {isFadedUnanswered ? (
                <>
                  {/* The fading: the learner supplies this step instead of reading it. */}
                  <p className="text-sm font-medium">Your turn — what comes next?</p>
                  <div className="mt-2 space-y-1.5">
                    {(s.options ?? []).map((opt, oi) => (
                      <button key={opt} type="button"
                        onClick={() => {
                          setFadedAnswers((p) => ({ ...p, [i]: oi }));
                          onAttempt(oi === s.correctIndex);
                        }}
                        className="block w-full rounded border border-border px-3 py-2 text-left text-sm hover:border-accent">
                        {opt}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <p className="font-mono text-xs leading-relaxed text-ink">
                    {s.faded === true ? (s.options?.[s.correctIndex ?? 0] ?? s.show) : s.show}
                  </p>
                  <p className="mt-1.5 text-sm text-ink-soft">{s.explain}</p>
                  {s.faded === true && answered !== undefined && answered !== s.correctIndex && (
                    <p className="mt-1.5 text-xs text-warn">
                      You picked something else — compare it with the line above.
                    </p>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ol>

      {!atEnd && !needsAnswer && (
        <button type="button" onClick={() => setRevealed((r) => r + 1)}
          className="mt-3 rounded-md border border-border px-3 py-1.5 text-sm hover:border-accent">
          Next step
        </button>
      )}
    </section>
  );
}

// =============================================================================== check
export function Check({ block, onSatisfied, onAttempt }: BlockProps & { block: CheckBlock }) {
  const [picked, setPicked] = useState<number | null>(null);

  function choose(i: number): void {
    if (picked !== null) return;
    setPicked(i);
    onAttempt(i === block.correctIndex);
    onSatisfied();
  }

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-ink-soft">Quick check</p>
      <p className="mt-2 font-medium">{block.question}</p>

      <div className="mt-3 space-y-2">
        {block.options.map((opt, i) => {
          const correct = i === block.correctIndex;
          let tone = 'border-border hover:border-accent';
          if (picked !== null && correct) tone = 'border-accent bg-accent-soft';
          else if (picked === i) tone = 'border-warn bg-warn-soft';
          else if (picked !== null) tone = 'border-border opacity-50';

          return (
            <button key={opt} type="button" disabled={picked !== null} onClick={() => choose(i)}
              className={`block w-full rounded-md border px-3 py-2 text-left text-sm transition ${tone}`}>
              {opt}
            </button>
          );
        })}
      </div>

      {/* Shown right or wrong — the explanation IS the teaching moment. */}
      {picked !== null && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-sm font-medium">
            {picked === block.correctIndex ? 'Correct.' : 'Not that one.'}
          </p>
          <p className="mt-1 text-sm text-ink-soft">{block.explanation}</p>
        </div>
      )}
    </section>
  );
}

// ======================================================================== explain back
export function ExplainBack({ block, onSatisfied }: BlockProps & { block: ExplainBackBlock }) {
  const [text, setText] = useState('');
  const [revealed, setRevealed] = useState(false);

  return (
    <section className="rounded-lg border border-accent/40 bg-accent-soft/40 p-4">
      <p className="text-xs uppercase tracking-wide text-accent">In your own words</p>
      <p className="mt-2 font-medium">{block.prompt}</p>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={revealed}
        rows={4}
        placeholder="Write it out — badly is fine. Generating the explanation is the part that works."
        className="mt-3 w-full rounded-md border border-border bg-surface p-3 text-sm outline-none focus:border-accent disabled:opacity-70"
      />

      {!revealed ? (
        <button
          type="button"
          disabled={text.trim().length < 15}
          onClick={() => {
            setRevealed(true);
            onSatisfied();
          }}
          className="mt-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
        >
          Compare with a model answer
        </button>
      ) : (
        /* Deliberately not auto-graded: the learner judges. Scoring prose with a model is
           expensive and unfair often enough to matter, and the value was in writing it. */
        <div className="mt-3 border-t border-accent/20 pt-3">
          <p className="text-sm font-medium">One way to put it</p>
          <p className="mt-1 text-sm text-ink-soft">{block.modelAnswer}</p>
          <p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-soft">
            Did yours cover
          </p>
          <ul className="mt-1 space-y-1">
            {block.mustMention.map((m) => (
              <li key={m} className="flex gap-2 text-sm text-ink-soft">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

// =============================================================================== recap
export function Recap({ block, speak, showTranscript, onSatisfied }: BlockProps & { block: RecapBlock }) {
  useEffect(() => {
    speak(block.narration);
    onSatisfied();
  }, [block, speak, onSatisfied]);

  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs uppercase tracking-wide text-ink-soft">Worth keeping</p>
      <ul className="mt-2 space-y-1.5">
        {block.points.map((p) => (
          <li key={p} className="flex gap-2 text-sm">
            <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
            <span>{p}</span>
          </li>
        ))}
      </ul>
      <Transcript text={block.narration} show={showTranscript} />
    </section>
  );
}
