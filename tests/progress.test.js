import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { freshProgress, faceSize, puzzleSize, faceComplete, themeUnlocked, unlockedFaces, currentFace, markComplete, restoreProgress, initialLayout, levelArt, useProp } from '../src/progress.js';
import { valid, solved, findHint, moveGroup, groupFor, clampDelta, xy } from '../src/puzzle.js';
import { faceQuaternion } from '../src/cube-scene.js';

test('orders define chapter and puzzle sizes; only first theme and face start unlocked', () => {
  assert.equal(faceSize(0), 4); assert.equal(faceSize(1), 9);
  assert.equal(puzzleSize(0), 3); assert.equal(puzzleSize(1), 4);
  const p = freshProgress(); assert.equal(unlockedFaces(p, 0), 1); assert.equal(unlockedFaces(p, 1), 0); assert.equal(themeUnlocked(p, 2), false);
  assert.equal(markComplete(p, 0, 1, 0), null); assert.equal(markComplete(p, 1, 0, 0), null);
});

test('old saves gain 28 of each prop without losing progress; counts persist independently down to zero', () => {
  const old = freshProgress(); delete old.props;
  markComplete(old, 0, 0, 1);
  const p = restoreProgress(old);
  assert.deepEqual(p.props, { hint: 28, preview: 28 });
  assert.equal(p.completed[0][1], true);
  assert.equal(useProp(p, 'unknown'), false);
  for (let i = 0; i < 28; i++) assert.equal(useProp(p, 'hint'), true);
  assert.equal(useProp(p, 'hint'), false);
  assert.equal(useProp(p, 'preview'), true);
  assert.deepEqual(restoreProgress(JSON.parse(JSON.stringify(p))).props, { hint: 0, preview: 27 });
  assert.deepEqual(freshProgress().props, { hint: 28, preview: 28 }, 'inventories do not share mutable state');
});

test('inventory restore sanitizes corrupt counts without creating negative or fractional balances', () => {
  for (const [input, expected] of [[-8, 0], [3.8, 3], [999, 28], [null, 0], ['28', 0], [NaN, 0], [Infinity, 0]]) {
    const p = freshProgress(); p.props = { hint: input, preview: 0 };
    assert.deepEqual(restoreProgress(p).props, { hint: expected, preview: 0 });
  }
});

test('all six faces unlock sequentially, finishing the first theme unlocks the second only', () => {
  const p = freshProgress();
  for (let face = 0; face < 6; face++) {
    assert.equal(currentFace(p, 0), face);
    for (const level of [2, 0, 3]) assert.deepEqual(markComplete(p, 0, face, level), { newFace: false, newTheme: false });
    assert.equal(faceComplete(p, 0, face), false);
    assert.deepEqual(markComplete(p, 0, face, 1), { newFace: true, newTheme: face === 5 });
    assert.deepEqual(markComplete(p, 0, face, 1), { newFace: false, newTheme: false });
  }
  assert.equal(themeUnlocked(p, 1), true); assert.equal(unlockedFaces(p, 1), 1);
  for (let face = 0; face < 6; face++) for (let level = 0; level < 9; level++) markComplete(p, 1, face, level);
  assert.equal(themeUnlocked(p, 2), false);
});

test('restore rejects fake future progress, malformed saves, and incompatible puzzle sizes', () => {
  const raw = freshProgress(); raw.completed[0][5] = true; raw.completed[1].fill(true);
  raw.puzzles['0:0:0'] = { positions: Array.from({ length: 16 }, (_, i) => i) };
  raw.puzzles['0:0:1'] = { positions: initialLayout(0, 0, 1) };
  raw.puzzles['0:5:0'] = { positions: initialLayout(0, 0, 0) };
  const p = restoreProgress(raw); assert.equal(p.completed[0][5], false); assert.equal(p.completed[1][0], false);
  assert.deepEqual(Object.keys(p.puzzles), ['0:0:1']);
  assert.deepEqual(restoreProgress(null), freshProgress());
  assert.equal(markComplete(p, 0, 0, 4), null); assert.equal(markComplete(p, 0, -1, 0), null);
});

test('all four first-face puzzles have distinct art and solvable starts', () => {
  assert.equal(new Set([0, 1, 2, 3].map((i) => levelArt(0, 0, i))).size, 4);
  for (let level = 0; level < 4; level++) {
    let p = initialLayout(0, 0, level); assert.ok(valid(p)); assert.ok(!solved(p));
    for (let move = 0; move < 8 && !solved(p); move++) { const h = findHint(p); assert.ok(h); p = moveGroup(p, h.id, h.dx, h.dy); }
    assert.ok(solved(p), `level ${level} remains solvable`);
  }
});

test('face order front/right/back/left/top/bottom turns each normal toward the viewer', () => {
  const normals = [[0, 0, 1], [1, 0, 0], [0, 0, -1], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
  normals.forEach((normal, face) => {
    const p = new THREE.Vector3(...normal).applyQuaternion(faceQuaternion(face));
    assert.ok(p.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-9);
  });
});

test('4×4 moves preserve groups, stay in bounds and never overlap', () => {
  let p = initialLayout(1, 0, 0), seed = 71;
  const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (let step = 0; step < 500; step++) {
    if (solved(p)) p = initialLayout(1, 0, 0);
    const id = Math.floor(random() * 16), ids = groupFor(p, id), dx = Math.floor(random() * 7) - 3, dy = Math.floor(random() * 7) - 3;
    const delta = clampDelta(p, ids, dx, dy), next = moveGroup(p, id, dx, dy);
    assert.ok(valid(next));
    for (const piece of ids) { const a = xy(p[piece], 4), b = xy(next[piece], 4); assert.ok(b.x - a.x === delta.x && b.y - a.y === delta.y); }
    p = next;
  }
});
