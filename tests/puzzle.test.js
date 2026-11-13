import test from 'node:test';
import assert from 'node:assert/strict';
import { COUNT, INITIAL_POSITIONS, xy, valid, solved, groups, groupFor, linked, clampDelta, moveGroup, findHint, connectionCount } from '../src/puzzle.js';

test('first level is shuffled, full, and has no accidental linked groups', () => {
  assert.ok(valid(INITIAL_POSITIONS));
  assert.equal(solved(INITIAL_POSITIONS), false);
  assert.equal(connectionCount(INITIAL_POSITIONS), 0);
  assert.equal(groups(INITIAL_POSITIONS).length, 9);
});

test('single piece swaps and correct neighbours automatically form a draggable group', () => {
  const next = moveGroup(INITIAL_POSITIONS, 1, 0, -1);
  assert.equal(next[1], 1);
  assert.equal(next[4], 4);
  assert.ok(linked(next, 0, 1));
  assert.ok(linked(next, 1, 2));
  assert.deepEqual(new Set(groupFor(next, 0)), new Set([0, 1, 2, 4, 7]));
});

test('group translation preserves relative positions and never leaves the board', () => {
  const joined = moveGroup(INITIAL_POSITIONS, 1, 0, 1);
  const group = groupFor(joined, 4);
  assert.equal(group.length, 4);
  const next = moveGroup(joined, 4, 0, 1);
  for (const id of group) {
    const before = xy(joined[id]), after = xy(next[id]);
    assert.deepEqual({ x: after.x - before.x, y: after.y - before.y }, { x: 0, y: 1 });
  }
  assert.ok(valid(next));
  assert.ok(solved(next));
  assert.equal(connectionCount(next), 12);
  assert.deepEqual(moveGroup(next, 0, 10, -10), next);
});

test('zero distance and outward drags return unchanged states without mutations', () => {
  const input = [...INITIAL_POSITIONS], copy = [...input];
  assert.deepEqual(moveGroup(input, 0, -4, -4), copy);
  assert.deepEqual(moveGroup(input, 5, 0, 0), copy);
  assert.deepEqual(input, copy);
});

test('random legal group moves always retain all pieces and rigid dragged groups', () => {
  let seed = 8675309;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  let positions = [...INITIAL_POSITIONS];
  for (let step = 0; step < 1500; step++) {
    if (solved(positions)) positions = [...INITIAL_POSITIONS].sort(() => random() - .5);
    const id = Math.floor(random() * COUNT), dx = Math.floor(random() * 7) - 3, dy = Math.floor(random() * 7) - 3;
    const group = groupFor(positions, id), delta = clampDelta(positions, group, dx, dy);
    const copy = [...positions], next = moveGroup(positions, id, dx, dy);
    assert.ok(valid(next), `invalid at step ${step}`);
    assert.deepEqual(positions, copy);
    for (const piece of group) {
      const old = xy(positions[piece]), now = xy(next[piece]);
      assert.ok(now.x - old.x === delta.x && now.y - old.y === delta.y);
    }
    positions = next;
  }
});

test('hints solve the level using ordinary moves without breaking groups', () => {
  let positions = [...INITIAL_POSITIONS], steps = 0;
  while (!solved(positions) && steps < 5) {
    const hint = findHint(positions);
    assert.ok(hint);
    positions = moveGroup(positions, hint.id, hint.dx, hint.dy);
    steps++;
  }
  assert.ok(solved(positions));
  assert.equal(findHint(positions), null);
});
