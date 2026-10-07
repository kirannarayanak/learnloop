/**
 * Minimal markdown renderer for lesson bodies.
 *
 * Deliberately dependency-free and deliberately NOT dangerouslySetInnerHTML: lesson
 * bodies are model-generated, so they are untrusted input. Rendering them as React
 * elements means a generated `<script>` is text, not a script.
 *
 * Supports what the draft stage actually produces: h2/h3, paragraphs, inline code,
 * bold, and bullet lists. Anything else renders as plain text, which is the safe
 * failure mode.
 */

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  // Split on inline code and bold, keeping the delimiters' contents.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.filter(Boolean).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={key}>{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    return <span key={key}>{part}</span>;
  });
}

export function Markdown({ source }: { source: string }) {
  const blocks = source.split(/\n{2,}/);

  return (
    <div className="prose-lesson">
      {blocks.map((block, i) => {
        const key = `b${i}`;
        const trimmed = block.trim();

        if (trimmed.startsWith('### ')) {
          return <h3 key={key}>{inline(trimmed.slice(4), key)}</h3>;
        }
        if (trimmed.startsWith('## ')) {
          return <h2 key={key}>{inline(trimmed.slice(3), key)}</h2>;
        }
        if (trimmed.startsWith('# ')) {
          return <h2 key={key}>{inline(trimmed.slice(2), key)}</h2>;
        }
        if (/^[-*] /m.test(trimmed)) {
          const items = trimmed.split('\n').filter((l) => /^[-*] /.test(l.trim()));
          return (
            <ul key={key} className="my-3 list-disc space-y-1 pl-5">
              {items.map((li, j) => (
                <li key={`${key}-${j}`}>{inline(li.trim().slice(2), `${key}-${j}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{inline(trimmed, key)}</p>;
      })}
    </div>
  );
}
