import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSkillGraph, hardPrerequisites, type SkillEdge } from '../graph/validate.ts';

test('accepts a linear chain and orders it', () => {
  const r = validateSkillGraph(['a', 'b', 'c'], [
    { prereqId: 'a', skillId: 'b', strength: 1 },
    { prereqId: 'b', skillId: 'c', strength: 1 },
  ]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.order, ['a', 'b', 'c']);
});

test('a cycle fails the job and reports the cycle path', () => {
  const r = validateSkillGraph(['a', 'b', 'c'], [
    { prereqId: 'a', skillId: 'b', strength: 1 },
    { prereqId: 'b', skillId: 'c', strength: 1 },
    { prereqId: 'c', skillId: 'a', strength: 1 },
  ]);
  assert.equal(r.ok, false);
  const cycle = r.problems.find((p) => p.kind === 'cycle');
  assert.ok(cycle, 'expected a cycle problem');
  // Canonical rotation starts at the lexicographically smallest node and closes.
  assert.deepEqual(cycle.path, ['a', 'b', 'c', 'a']);
  assert.equal(r.order, undefined);
});

test('reports the same cycle once, not once per entry point', () => {
  const r = validateSkillGraph(['a', 'b'], [
    { prereqId: 'a', skillId: 'b', strength: 1 },
    { prereqId: 'b', skillId: 'a', strength: 1 },
  ]);
  assert.equal(r.problems.filter((p) => p.kind === 'cycle').length, 1);
});

test('catches self-edges, unknown skills and bad strengths', () => {
  const r = validateSkillGraph(['a'], [
    { prereqId: 'a', skillId: 'a', strength: 1 },
    { prereqId: 'a', skillId: 'ghost', strength: 1 },
    { prereqId: 'a', skillId: 'a', strength: 0 },
  ]);
  assert.equal(r.ok, false);
  const kinds = new Set(r.problems.map((p) => p.kind));
  assert.ok(kinds.has('self_edge'));
  assert.ok(kinds.has('unknown_skill'));
  assert.ok(kinds.has('invalid_strength'));
});

test('ordering is deterministic regardless of edge input order', () => {
  const edges: SkillEdge[] = [
    { prereqId: 'a', skillId: 'c', strength: 1 },
    { prereqId: 'a', skillId: 'b', strength: 1 },
  ];
  const first = validateSkillGraph(['a', 'b', 'c'], edges).order;
  const second = validateSkillGraph(['a', 'b', 'c'], [...edges].reverse()).order;
  assert.deepEqual(first, second, 'regenerating a path must not reshuffle lessons');
});

test('only strength >= 0.9 counts as a hard prerequisite', () => {
  const edges: SkillEdge[] = [
    { prereqId: 'hard', skillId: 'x', strength: 1 },
    { prereqId: 'alsoHard', skillId: 'x', strength: 0.9 },
    { prereqId: 'soft', skillId: 'x', strength: 0.5 },
  ];
  assert.deepEqual(hardPrerequisites('x', edges), ['alsoHard', 'hard']);
});
