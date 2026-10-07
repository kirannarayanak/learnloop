/**
 * Prerequisite graph validation.
 *
 * A cycle here means a learner reaches a skill whose prerequisites can never be
 * satisfied — an unlearnable loop. Postgres can't express acyclicity cheaply, so this
 * is the enforcement point, and a cycle FAILS the generation job rather than warning.
 * Treat it as data corruption (docs/03-data-model.md).
 */

export interface SkillEdge {
  prereqId: string;
  skillId: string;
  /** (0,1]. >= 0.9 is a hard prerequisite: it gates credit. Below that only reorders. */
  strength: number;
}

export const HARD_EDGE_THRESHOLD = 0.9;

export interface GraphProblem {
  kind: 'cycle' | 'self_edge' | 'unknown_skill' | 'invalid_strength';
  /** For a cycle, the skill ids in traversal order, closing back on the first. */
  path: string[];
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  problems: GraphProblem[];
  /** Topological order, only present when ok. Deterministic for a given input. */
  order?: string[];
}

/** Adjacency from prerequisite -> dependents, restricted to known skills. */
function buildAdjacency(
  skillIds: Set<string>,
  edges: readonly SkillEdge[],
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of skillIds) adj.set(id, []);
  for (const e of edges) {
    if (!skillIds.has(e.prereqId) || !skillIds.has(e.skillId)) continue;
    if (e.prereqId === e.skillId) continue;
    adj.get(e.prereqId)!.push(e.skillId);
  }
  // Sort for determinism: the same graph must always yield the same path order,
  // or regenerating a path reshuffles lessons for no reason.
  for (const list of adj.values()) list.sort();
  return adj;
}

/**
 * DFS with three-colour marking. Returns every distinct cycle it can reach, so one
 * job failure reports all the problems rather than making the generator fix them
 * one round-trip at a time.
 */
function findCycles(adj: Map<string, string[]>): string[][] {
  const WHITE = 0, GREY = 1, BLACK = 2;
  const colour = new Map<string, number>();
  for (const id of adj.keys()) colour.set(id, WHITE);

  const cycles: string[][] = [];
  const seen = new Set<string>();
  const stack: string[] = [];

  const visit = (node: string): void => {
    colour.set(node, GREY);
    stack.push(node);

    for (const next of adj.get(node) ?? []) {
      const c = colour.get(next) ?? WHITE;
      if (c === GREY) {
        // Back edge: the cycle is the stack from `next` onward, closed.
        const start = stack.indexOf(next);
        const cycle = stack.slice(start);
        // Canonical rotation so the same cycle found from different entry points
        // is reported once.
        const min = cycle.reduce((a, b) => (a < b ? a : b));
        const pivot = cycle.indexOf(min);
        const canonical = [...cycle.slice(pivot), ...cycle.slice(0, pivot)];
        const key = canonical.join('>');
        if (!seen.has(key)) {
          seen.add(key);
          cycles.push([...canonical, min]);
        }
      } else if (c === WHITE) {
        visit(next);
      }
    }

    stack.pop();
    colour.set(node, BLACK);
  };

  // Sorted entry order keeps the reported problems stable across runs.
  for (const id of [...adj.keys()].sort()) {
    if ((colour.get(id) ?? WHITE) === WHITE) visit(id);
  }
  return cycles;
}

/** Kahn's algorithm. Only called once the graph is known acyclic. */
function topologicalOrder(adj: Map<string, string[]>): string[] {
  const indegree = new Map<string, number>();
  for (const id of adj.keys()) indegree.set(id, 0);
  for (const dependents of adj.values()) {
    for (const d of dependents) indegree.set(d, (indegree.get(d) ?? 0) + 1);
  }

  // Lexicographic tie-breaking, again for deterministic path ordering.
  const ready = [...indegree.entries()]
    .filter(([, n]) => n === 0)
    .map(([id]) => id)
    .sort();

  const order: string[] = [];
  while (ready.length > 0) {
    const node = ready.shift()!;
    order.push(node);
    for (const next of adj.get(node) ?? []) {
      const left = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, left);
      if (left === 0) {
        // Keep `ready` sorted rather than re-sorting the whole array each step.
        const at = ready.findIndex((x) => x > next);
        if (at === -1) ready.push(next);
        else ready.splice(at, 0, next);
      }
    }
  }
  return order;
}

/**
 * Validate a generated skill graph before anything downstream trusts it.
 * Call this at the end of the `graph` stage; a non-ok result fails the job.
 */
export function validateSkillGraph(
  skillIds: readonly string[],
  edges: readonly SkillEdge[],
): ValidationResult {
  const known = new Set(skillIds);
  const problems: GraphProblem[] = [];

  for (const e of edges) {
    if (e.prereqId === e.skillId) {
      problems.push({
        kind: 'self_edge',
        path: [e.skillId],
        detail: `skill ${e.skillId} lists itself as a prerequisite`,
      });
    }
    if (!known.has(e.prereqId) || !known.has(e.skillId)) {
      const missing = !known.has(e.prereqId) ? e.prereqId : e.skillId;
      problems.push({
        kind: 'unknown_skill',
        path: [e.prereqId, e.skillId],
        detail: `edge references skill ${missing}, which is not in the graph`,
      });
    }
    if (!(e.strength > 0) || e.strength > 1) {
      problems.push({
        kind: 'invalid_strength',
        path: [e.prereqId, e.skillId],
        detail: `strength must be in (0,1], got ${e.strength}`,
      });
    }
  }

  const adj = buildAdjacency(known, edges);
  for (const cycle of findCycles(adj)) {
    problems.push({
      kind: 'cycle',
      path: cycle,
      detail: `prerequisite cycle: ${cycle.join(' -> ')}`,
    });
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, problems: [], order: topologicalOrder(adj) };
}

/** Hard prerequisites of a skill — the ones that gate credit and credentials. */
export function hardPrerequisites(
  skillId: string,
  edges: readonly SkillEdge[],
): string[] {
  return edges
    .filter((e) => e.skillId === skillId && e.strength >= HARD_EDGE_THRESHOLD)
    .map((e) => e.prereqId)
    .sort();
}
