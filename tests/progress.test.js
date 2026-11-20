import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { freshProgress, faceSize, puzzleSize, faceComplete, themeUnlocked, unlockedFaces, currentTheme, currentFace, markComplete, restoreProgress, initialLayout, levelArt, useProp, completeAllLevels, levelConfig } from '../src/progress.js';
import { valid, solved, findHint, moveGroup, groupFor, clampDelta, xy } from '../src/puzzle.js';
import { faceQuaternion, homeQuaternion } from '../src/cube-scene.js';

test('orders define chapter and puzzle sizes; only first theme and face start unlocked', () => {
  assert.equal(faceSize(0), 4); assert.equal(faceSize(1), 9);
  assert.equal(puzzleSize(0), 3); assert.equal(puzzleSize(1), 4);
  const p = freshProgress(); assert.equal(unlockedFaces(p, 0), 1); assert.equal(unlockedFaces(p, 1), 0); assert.equal(themeUnlocked(p, 2), false);
  assert.equal(markComplete(p, 0, 1, 0), null); assert.equal(markComplete(p, 1, 0, 0), null);
});

test('complete-all unlocks every playable level, clears resumptions and preserves real records and preferences', () => {
  const p = freshProgress(); p.sound = true; p.props = { hint: 3, preview: 7 }; p.guides.rotateCube = true;
  p.records['0:0:0'] = { moves: 2, hints: 0, previews: 1, activeMs: 2400, gridSize: 3, layoutVersion: 2, completedAt: 1000 };
  p.puzzles['0:0:1'] = { positions: initialLayout(0, 0, 1) };
  const before = structuredClone(p);
  completeAllLevels(p);
  assert.equal(p.completed.flat().length, 174); assert.ok(p.completed.flat().every(Boolean));
  assert.deepEqual(p.puzzles, {}); assert.deepEqual(p.records, before.records);
  assert.deepEqual(p.props, before.props); assert.deepEqual(p.guides, before.guides); assert.equal(p.sound, true);
  assert.equal(themeUnlocked(p, 2), true);
  assert.equal(themeUnlocked(p, 3), false, 'the fifth cube stays unavailable');
  const once = structuredClone(p); completeAllLevels(p); assert.deepEqual(p, once);
  assert.deepEqual(restoreProgress(p).records, before.records);
  assert.deepEqual(restoreProgress(p).guides, before.guides, 'a trophy does not teach gestures after reload');
});

test('all animal version-3 sessions and records survive version-4 no-join layouts', () => {
  for (const face of [0, 1, 2, 3, 4, 5]) {
    const p = freshProgress(); p.completed[0].fill(true); p.completed[1].fill(true, 0, face * 9);
    const config = levelConfig(1, face, 0), key = `1:${face}:0`;
    p.puzzles[key] = { positions: config.positions, gridSize: 4, layoutVersion: 3, stats: { moves: 2, hints: 0, previews: 1, activeMs: 2000 } };
    assert.deepEqual(restoreProgress(p).puzzles[key], p.puzzles[key]);
    p.completed[1][face * 9] = true; p.records[key] = { ...p.puzzles[key].stats, gridSize: 4, layoutVersion: 3, completedAt: 1000 };
    const restored = restoreProgress(p);
    assert.deepEqual(restored.records[key], p.records[key]);
    assert.equal(restored.puzzles[key], undefined);
  }
});

test('startup follows unlocked progress, including all-complete saves without selecting the future cube', () => {
  const p = freshProgress();
  assert.equal(currentTheme(p), 0); assert.equal(currentFace(p, currentTheme(p)), 0);
  p.completed[0].fill(true, 0, 12);
  assert.equal(currentTheme(p), 0); assert.equal(currentFace(p, currentTheme(p)), 3);
  p.completed[0].fill(true);
  assert.equal(currentTheme(p), 1); assert.equal(currentFace(p, currentTheme(p)), 0);
  p.completed[1].fill(true, 0, 27);
  assert.equal(currentTheme(p), 1); assert.equal(currentFace(p, currentTheme(p)), 3);
  p.completed[1].fill(true);
  assert.equal(currentTheme(p), 2); assert.equal(currentFace(p, currentTheme(p)), 0);
  p.completed[2].fill(true);
  assert.equal(currentTheme(p), 2); assert.equal(currentFace(p, currentTheme(p)), 5);
  assert.equal(currentTheme(restoreProgress({ ...p, completed: [Array(24).fill(false), p.completed[1]] })), 0, 'invalid future progress cannot choose a locked cube');
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
  assert.equal(themeUnlocked(p, 2), true);
  assert.equal(themeUnlocked(p, 3), false);
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
    const homeNormal = new THREE.Vector3(...normal).applyQuaternion(homeQuaternion(face));
    const reference = new THREE.Vector3(0, 0, 1).applyQuaternion(homeQuaternion(0));
    assert.ok(homeNormal.distanceTo(reference) < 1e-9, 'home presents the current face with the same three-dimensional tilt');
  });
});

test('4×4 and 5×5 moves preserve groups, stay in bounds and never overlap', () => {
  for (const level of [0, 4]) {
    let p = initialLayout(1, 0, level), seed = 71;
    const n = Math.sqrt(p.length);
    const random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 2 ** 32; };
    for (let step = 0; step < 500; step++) {
      if (solved(p)) p = initialLayout(1, 0, level);
      const id = Math.floor(random() * p.length), ids = groupFor(p, id), dx = Math.floor(random() * (2 * n - 1)) - n + 1, dy = Math.floor(random() * (2 * n - 1)) - n + 1;
      const delta = clampDelta(p, ids, dx, dy), next = moveGroup(p, id, dx, dy);
      assert.ok(valid(next));
      for (const piece of ids) { const a = xy(p[piece], n), b = xy(next[piece], n); assert.ok(b.x - a.x === delta.x && b.y - a.y === delta.y); }
      p = next;
    }
  }
});

test('5x5 upgrades preserve previous 3x3 sessions and records without accepting a mismatched grid', () => {
  for (let face = 0; face < 6; face++) {
    const key = `1:${face}:4`, config = levelConfig(1, face, 4);
    for (const version of [3, ...([1, 3].includes(face) ? [4] : [])]) {
      const p = freshProgress(); p.completed[0].fill(true); p.completed[1].fill(true, 0, face * 9);
      p.props = { hint: 7, preview: 9 };
      const old = { positions: [1, 0, 8, 5, 6, 2, 4, 7, 3], gridSize: 3, layoutVersion: version, stats: { moves: 2, hints: 1, previews: 1, activeMs: 2100 } };
      p.puzzles[key] = old;
      assert.deepEqual(restoreProgress(p).puzzles[key], old);
      assert.deepEqual(restoreProgress(p).props, p.props);
      p.puzzles[key] = { ...old, positions: config.positions };
      assert.equal(restoreProgress(p).puzzles[key], undefined, 'old layout versions cannot contain 25 tiles');
      p.puzzles[key] = { ...old, layoutVersion: 5 };
      assert.equal(restoreProgress(p).puzzles[key], undefined, 'new layout version cannot contain nine tiles');
      p.puzzles[key] = { ...old, layoutVersion: 5, gridSize: 5, positions: config.positions };
      assert.deepEqual(restoreProgress(p).puzzles[key], p.puzzles[key]);
      p.completed[1][face * 9 + 4] = true;
      p.records[key] = { ...old.stats, gridSize: 3, layoutVersion: version, completedAt: 123 };
      assert.deepEqual(restoreProgress(p).records[key], p.records[key]);
      assert.equal(initialLayout(1, face, 4).length, 25);
    }
  }
});
