/**
 * Static renderer for review.
 *
 * Deliberately the opposite of `LessonPlayer`. A learner gets one block at a time with
 * answers hidden — that is what makes the retrieval work. A reviewer needs the whole
 * lesson at once with **every answer marked**, because their job is to judge correctness,
 * not to experience the lesson. Hiding the answer key from the person checking the answer
 * key would be absurd.
 *
 * Narration is shown in full here for the same reason: the redundancy penalty applies to
 * someone learning, not to someone auditing.
 */

import type { LessonBlock } from '@learnloop/engine/stages/blocks.ts';

function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{children}</p>;
}

function Narration({ text }: { text: string }) {
  return (
    <p className="mt-2 border-l-2 border-accent/40 pl-3 text-sm italic text-ink-soft">
      <span className="not-italic" aria-hidden>🔊 </span>
      {text}
    </p>
  );
}

function Options({
  options,
  correctIndex,
}: {
  options: string[];
  correctIndex: number;
}) {
  return (
    <ul className="mt-2 space-y-1">
      {options.map((opt, i) => (
        <li
          key={opt}
          className={`rounded border px-2.5 py-1.5 text-sm ${
            i === correctIndex
              ? 'border-accent bg-accent-soft font-medium'
              : 'border-border text-ink-soft'
          }`}
        >
          {i === correctIndex && <span className="mr-1.5 text-accent" aria-label="marked correct">✓</span>}
          {opt}
        </li>
      ))}
    </ul>
  );
}

function Block({ block, index }: { block: LessonBlock; index: number }) {
  const header = (
    <div className="flex items-baseline gap-2">
      <span className="text-xs tabular-nums text-ink-soft">{index + 1}</span>
      <Label>{block.type.replace('_', ' ')}</Label>
    </div>
  );

  switch (block.type) {
    case 'pretrain':
      return (
        <section>
          {header}
          <dl className="mt-2 space-y-1">
            {block.terms.map((t) => (
              <div key={t.term} className="text-sm">
                <dt className="inline font-medium">{t.term}</dt>
                <dd className="inline text-ink-soft"> — {t.gloss}</dd>
              </div>
            ))}
          </dl>
          <Narration text={block.narration} />
        </section>
      );

    case 'concept':
      return (
        <section>
          {header}
          <h3 className="mt-1 font-semibold">{block.heading}</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {block.keyPoints.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <Narration text={block.narration} />
        </section>
      );

    case 'diagram':
      return (
        <section>
          {header}
          <p className="mt-1 font-medium">{block.caption}</p>
          <p className="mt-1 text-xs text-ink-soft">
            {block.nodes.map((n) => n.label).join(' · ')}
          </p>
          <ol className="mt-2 space-y-2">
            {block.steps.map((s, i) => (
              <li key={i} className="text-sm">
                <span className="font-medium">{s.label}</span>
                <span className="ml-2 text-xs text-ink-soft">
                  [{s.highlight.join(', ')}]
                </span>
                <Narration text={s.narration} />
              </li>
            ))}
          </ol>
        </section>
      );

    case 'predict':
      return (
        <section>
          {header}
          <p className="mt-1 font-medium">{block.question}</p>
          <Options options={block.options} correctIndex={block.correctIndex} />
          <p className="mt-2 text-sm text-ink-soft">{block.reveal}</p>
        </section>
      );

    case 'worked_example':
      return (
        <section>
          {header}
          <p className="mt-1 font-medium">{block.goal}</p>
          <ol className="mt-2 space-y-2">
            {block.steps.map((s, i) => (
              <li key={i} className="rounded border border-border p-2">
                <p className="font-mono text-xs">{s.show}</p>
                <p className="mt-1 text-sm text-ink-soft">{s.explain}</p>
                {s.faded === true && s.options !== undefined && (
                  <>
                    <p className="mt-1.5 text-xs text-accent">learner supplies this step</p>
                    <Options options={s.options} correctIndex={s.correctIndex ?? 0} />
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      );

    case 'check':
      return (
        <section>
          {header}
          <p className="mt-1 font-medium">{block.question}</p>
          <Options options={block.options} correctIndex={block.correctIndex} />
          <p className="mt-2 text-sm text-ink-soft">{block.explanation}</p>
          {block.targetsMisconception !== undefined && (
            <p className="mt-1 text-xs text-warn">
              probes: {block.targetsMisconception}
            </p>
          )}
        </section>
      );

    case 'explain_back':
      return (
        <section>
          {header}
          <p className="mt-1 font-medium">{block.prompt}</p>
          <p className="mt-2 text-sm text-ink-soft">{block.modelAnswer}</p>
          {block.mustMention.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
              {block.mustMention.map((m) => <li key={m}>{m}</li>)}
            </ul>
          )}
        </section>
      );

    case 'recap':
      return (
        <section>
          {header}
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
            {block.points.map((p) => <li key={p}>{p}</li>)}
          </ul>
          <Narration text={block.narration} />
        </section>
      );
  }
}

export function ReviewBlocks({ blocks }: { blocks: LessonBlock[] }) {
  return (
    <div className="divide-y divide-border">
      {blocks.map((block, i) => (
        <div key={i} className="py-4 first:pt-0 last:pb-0">
          <Block block={block} index={i} />
        </div>
      ))}
    </div>
  );
}
