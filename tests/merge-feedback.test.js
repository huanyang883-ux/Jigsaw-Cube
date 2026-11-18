import test from 'node:test';
import assert from 'node:assert/strict';
import { INITIAL_POSITIONS, newlyConnectedGroups, moveGroup, findHint } from '../src/puzzle.js';

const sorted = (groups) => groups.map((ids) => [...ids].sort((a, b) => a - b));

test('displaced pieces trigger feedback even when the dragged piece makes no connection', () => {
  const before = [...INITIAL_POSITIONS], copy = [...before];
  const after = moveGroup(before, 1, 0, 1);
  assert.deepEqual(sorted(newlyConnectedGroups(before, after)), [[4, 6, 7, 8]]);
  assert.deepEqual(before, copy);
  assert.deepEqual(newlyConnectedGroups(after, after), [], 'existing connections do not flash again');
});

test('one move can create separate active and passive connection groups', () => {
  const before = [6, 4, 0, 8, 3, 7, 1, 5, 2];
  const after = moveGroup(before, 0, 0, -1);
  assert.deepEqual(sorted(newlyConnectedGroups(before, after)), [[0, 1], [4, 5]]);
});

test('hint moves also report new passive connections', () => {
  const before = [1, 8, 6, 4, 7, 5, 0, 2, 3], hint = findHint(before);
  assert.equal(hint.id, 0);
  const after = moveGroup(before, hint.id, hint.dx, hint.dy);
  assert.deepEqual(sorted(newlyConnectedGroups(before, after)), [[6, 7]]);
});

test('moving or splitting existing groups without new connections produces no feedback', () => {
  const before = [6, 0, 1, 4, 3, 2, 5, 8, 7];
  for (const [id, dx, dy] of [[0, 0, -1], [1, 0, 1], [1, 0, 0]]) {
    assert.deepEqual(newlyConnectedGroups(before, moveGroup(before, id, dx, dy)), []);
  }
});
