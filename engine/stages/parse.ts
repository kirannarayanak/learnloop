/**
 * Narrow raw model JSON into typed lesson blocks.
 *
 * The wire schema is flat (every field of every block type, all optional) because
 * discriminated unions are supported unevenly across providers. The narrowing happens
 * here instead, and the errors are written to be actionable: they go straight back to the
 * model in the repair pass, so "block 3 (check) has no options" is useful and
 * "validation failed" is not.
 *
 * This is also the safety boundary. Everything past this point is typed; everything
 * before it is untrusted output from a model.
 */

import type { DiagramEdge, DiagramNode, LessonBlock } from './blocks.ts';

export class BlockParseError extends Error {
  readonly problems: string[];

  constructor(problems: string[]) {
    super(`could not parse lesson blocks:\n- ${problems.join('\n- ')}`);
    this.name = 'BlockParseError';
    this.problems = problems;
  }
}

type Raw = Record<string, unknown>;

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function strArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return out.length > 0 ? out : undefined;
}

/** Index into options, clamped into range rather than rejected — an off-by-one is not
 *  worth discarding an otherwise good block for. */
function optionIndex(v: unknown, optionCount: number): number {
  const n = num(v);
  if (n === undefined) return 0;
  return Math.min(Math.max(Math.round(n), 0), Math.max(optionCount - 1, 0));
}

function parseNodes(v: unknown, at: string, problems: string[]): DiagramNode[] {
  if (!Array.isArray(v)) {
    problems.push(`${at}: diagram has no nodes array`);
    return [];
  }
  const nodes: DiagramNode[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Raw;
    const id = str(r.id);
    const label = str(r.label);
    const x = num(r.x);
    const y = num(r.y);
    if (id === undefined || label === undefined || x === undefined || y === undefined) {
      problems.push(`${at}: a diagram node is missing id, label, x or y`);
      continue;
    }
    const note = str(r.note);
    // Clamp to the authoring grid; a model that drifts outside it would render off-canvas.
    const node: DiagramNode = { id, label, x: Math.min(Math.max(x, 0), 100), y: Math.min(Math.max(y, 0), 100) };
    nodes.push(note === undefined ? node : { ...node, note });
  }
  return nodes;
}

function parseEdges(v: unknown, nodeIds: Set<string>, at: string, problems: string[]): DiagramEdge[] {
  if (!Array.isArray(v)) return [];
  const edges: DiagramEdge[] = [];
  for (const raw of v) {
    if (typeof raw !== 'object' || raw === null) continue;
    const r = raw as Raw;
    const from = str(r.from);
    const to = str(r.to);
    if (from === undefined || to === undefined) continue;
    // An edge to a node that doesn't exist draws a line into empty space.
    if (!nodeIds.has(from) || !nodeIds.has(to)) {
      problems.push(`${at}: diagram edge ${from} -> ${to} references a node that does not exist`);
      continue;
    }
    const label = str(r.label);
    const edge: DiagramEdge = { from, to };
    edges.push({
      ...edge,
      ...(label !== undefined ? { label } : {}),
      ...(r.back === true ? { back: true } : {}),
    });
  }
  return edges;
}

function parseBlock(raw: unknown, i: number, problems: string[]): LessonBlock | undefined {
  const at = `block ${i}`;
  if (typeof raw !== 'object' || raw === null) {
    problems.push(`${at}: not an object`);
    return undefined;
  }
  const r = raw as Raw;
  const type = str(r.type);

  switch (type) {
    case 'pretrain': {
      const terms = Array.isArray(r.terms)
        ? r.terms
            .filter((t): t is Raw => typeof t === 'object' && t !== null)
            .map((t) => ({ term: str(t.term), gloss: str(t.gloss) }))
            .filter((t): t is { term: string; gloss: string } => t.term !== undefined && t.gloss !== undefined)
        : [];
      const narration = str(r.narration);
      if (terms.length === 0 || narration === undefined) {
        problems.push(`${at} (pretrain): needs at least one {term, gloss} and a narration`);
        return undefined;
      }
      return { type: 'pretrain', terms, narration };
    }

    case 'concept': {
      const heading = str(r.heading);
      const keyPoints = strArray(r.keyPoints);
      const narration = str(r.narration);
      if (heading === undefined || keyPoints === undefined || narration === undefined) {
        problems.push(`${at} (concept): needs heading, keyPoints and narration`);
        return undefined;
      }
      return { type: 'concept', heading, keyPoints, narration };
    }

    case 'diagram': {
      const caption = str(r.caption);
      const nodes = parseNodes(r.nodes, at, problems);
      if (caption === undefined || nodes.length === 0) {
        problems.push(`${at} (diagram): needs a caption and at least one node`);
        return undefined;
      }
      const edges = parseEdges(r.edges, new Set(nodes.map((n) => n.id)), at, problems);
      const steps = Array.isArray(r.steps)
        ? r.steps
            .filter((s): s is Raw => typeof s === 'object' && s !== null)
            .map((s) => ({
              label: str(s.label),
              highlight: strArray(s.highlight) ?? [],
              narration: str(s.narration),
            }))
            .filter((s): s is { label: string; highlight: string[]; narration: string } =>
              s.label !== undefined && s.narration !== undefined)
        : [];
      if (steps.length === 0) {
        problems.push(`${at} (diagram): needs at least one step with a label and narration`);
        return undefined;
      }
      return { type: 'diagram', caption, nodes, edges, steps };
    }

    case 'predict': {
      const question = str(r.question);
      const options = strArray(r.options);
      const reveal = str(r.reveal);
      const narration = str(r.narration);
      if (question === undefined || options === undefined || options.length < 2 || reveal === undefined) {
        problems.push(`${at} (predict): needs a question, 2+ options and a reveal`);
        return undefined;
      }
      return {
        type: 'predict',
        question,
        options,
        correctIndex: optionIndex(r.correctIndex, options.length),
        reveal,
        // Narration is optional here; the block works silently.
        narration: narration ?? 'Commit to an answer before you read on.',
      };
    }

    case 'worked_example': {
      const goal = str(r.goal);
      const steps = Array.isArray(r.steps)
        ? r.steps
            .filter((s): s is Raw => typeof s === 'object' && s !== null)
            .map((s) => {
              const show = str(s.show);
              const explain = str(s.explain);
              if (show === undefined || explain === undefined) return undefined;
              const options = strArray(s.options);
              // A faded step with no options has nothing for the learner to pick, so
              // demote it to an ordinary shown step rather than rendering a dead end.
              const faded = s.faded === true && options !== undefined && options.length >= 2;
              return {
                show,
                explain,
                ...(faded ? { faded: true, options, correctIndex: optionIndex(s.correctIndex, options.length) } : {}),
              };
            })
            .filter((s): s is NonNullable<typeof s> => s !== undefined)
        : [];
      if (goal === undefined || steps.length < 2) {
        problems.push(`${at} (worked_example): needs a goal and at least two steps`);
        return undefined;
      }
      return { type: 'worked_example', goal, steps };
    }

    case 'check': {
      const question = str(r.question);
      const options = strArray(r.options);
      const explanation = str(r.explanation);
      if (question === undefined || options === undefined || options.length < 2 || explanation === undefined) {
        problems.push(`${at} (check): needs a question, 2+ options and an explanation`);
        return undefined;
      }
      const targetsMisconception = str(r.targetsMisconception);
      return {
        type: 'check',
        question,
        options,
        correctIndex: optionIndex(r.correctIndex, options.length),
        explanation,
        ...(targetsMisconception !== undefined ? { targetsMisconception } : {}),
      };
    }

    case 'explain_back': {
      const prompt = str(r.prompt);
      const modelAnswer = str(r.modelAnswer);
      if (prompt === undefined || modelAnswer === undefined) {
        problems.push(`${at} (explain_back): needs a prompt and a modelAnswer`);
        return undefined;
      }
      return { type: 'explain_back', prompt, modelAnswer, mustMention: strArray(r.mustMention) ?? [] };
    }

    case 'recap': {
      const points = strArray(r.points);
      const narration = str(r.narration);
      if (points === undefined || narration === undefined) {
        problems.push(`${at} (recap): needs points and a narration`);
        return undefined;
      }
      return { type: 'recap', points, narration };
    }

    default:
      problems.push(`${at}: unknown block type '${type ?? '(missing)'}'`);
      return undefined;
  }
}

export interface ParsedDraft {
  title: string;
  estMinutes: number;
  blocks: LessonBlock[];
  citations: { quote: string }[];
}

/**
 * Parse a draft response. Throws BlockParseError listing every problem at once, so the
 * repair pass gets the full picture in one round-trip rather than one issue at a time.
 */
export function parseDraft(raw: unknown): ParsedDraft {
  const problems: string[] = [];

  if (typeof raw !== 'object' || raw === null) {
    throw new BlockParseError(['response was not a JSON object']);
  }
  const r = raw as Raw;

  const title = str(r.title) ?? 'Untitled lesson';
  const estMinutes = num(r.estMinutes) ?? 8;

  const citations = Array.isArray(r.citations)
    ? r.citations
        .filter((c): c is Raw => typeof c === 'object' && c !== null)
        .map((c) => str(c.quote))
        .filter((q): q is string => q !== undefined)
        .map((quote) => ({ quote }))
    : [];

  if (citations.length === 0) {
    // Not a soft warning: an uncited lesson cannot publish anyway (docs/07-risks.md),
    // so failing here saves a verification call.
    problems.push('no citations — every lesson must quote the source spans it rests on');
  }

  if (!Array.isArray(r.blocks)) {
    throw new BlockParseError([...problems, 'blocks was not an array']);
  }

  const blocks: LessonBlock[] = [];
  for (const [i, rawBlock] of r.blocks.entries()) {
    const block = parseBlock(rawBlock, i, problems);
    if (block !== undefined) blocks.push(block);
  }

  if (problems.length > 0) throw new BlockParseError(problems);
  return { title, estMinutes, blocks, citations };
}
