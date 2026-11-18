import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_CONFIGS, THEMES, CONTINENT_CHAPTERS, freshProgress, restoreProgress, completeAllLevels, currentTheme, currentFace, themeUnlocked, levelArt, levelConfig, markComplete, saveSlot } from '../src/progress.js';
import { THEME_ART } from '../src/theme-art.js';
import { valid, solved, moveGroup, groups, groupFor, clampDelta, xy, connectionCount } from '../src/puzzle.js';
import { hintSolution, shapeKey } from '../scripts/level-search.mjs';
import { assignTiles } from '../src/tile-assignment.js';

const continents = LEVEL_CONFIGS.filter(l => l.theme === 2);
test('large-board displacement minimizes travel and remains bounded with 24 blockers', () => {
  const cost = (from, to, n) => from.reduce((sum, p, i) => sum + (p % n - to[i] % n) ** 2 + (Math.floor(p / n) - Math.floor(to[i] / n)) ** 2, 0);
  function permutations(xs) { return xs.length ? xs.flatMap((x, i) => permutations(xs.filter((_, j) => i !== j)).map(tail => [x, ...tail])) : [[]]; }
  for (const [from, holes] of [[[0, 6, 14, 24], [2, 8, 20, 35]], [[1, 3, 7, 9, 15, 22], [4, 6, 8, 19, 25, 28]]]) {
    const result = assignTiles(from, from.map((_, i) => i), holes, 6);
    assert.deepEqual(new Set(result), new Set(holes));
    assert.equal(cost(from, result, 6), Math.min(...permutations(holes).map(p => cost(from, p, 6))));
  }
  const from = Array.from({length: 24}, (_, i) => i), holes = from.map(i => 48 - i);
  const start = performance.now(), result = assignTiles(from, from, holes, 7);
  assert.deepEqual(new Set(result), new Set(holes)); assert.ok(performance.now() - start < 1000);
});

test('6x6 and 7x7 arbitrary drags preserve rigid groups, pieces and solvability', () => {
  let seed = 44117;
  const random = () => { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  for (const size of [6, 7]) {
    let positions = [...continents.find(l => l.gridSize === size).positions];
    for (let step = 0; step < 200; step++) {
      if (solved(positions)) positions = [...continents.find(l => l.gridSize === size).positions];
      const id = Math.floor(random() * positions.length), dx = Math.floor(random() * size * 2) - size, dy = Math.floor(random() * size * 2) - size;
      const ids = groupFor(positions, id), delta = clampDelta(positions, ids, dx, dy), original = [...positions];
      const next = moveGroup(positions, id, dx, dy); assert.ok(valid(next)); assert.deepEqual(positions, original);
      for (const piece of ids) { const a = xy(positions[piece], size), b = xy(next[piece], size); assert.ok(b.x - a.x === delta.x); assert.ok(b.y - a.y === delta.y); }
      positions = next;
    }
    assert.ok(hintSolution(positions).length <= size ** 2);
  }
});
test('all 96 new boards are unique, start without joins, and have complete legal solutions', () => {
  const shapes = new Set(LEVEL_CONFIGS.filter(l => l.theme !== 2).map(l => shapeKey(l.positions)));
  for (const l of continents) {
    assert.ok(valid(l.positions)); assert.equal(connectionCount(l.positions), 0);
    assert.equal(groups(l.positions).length, l.gridSize ** 2);
    assert.ok(!shapes.has(shapeKey(l.positions))); shapes.add(shapeKey(l.positions));
    let p = [...l.positions], groupMoves = 0;
    for (const move of l.solution) {
      if (groupFor(p, move.id).length > 1) groupMoves++;
      const next = moveGroup(p, move.id, move.dx, move.dy);
      assert.ok(valid(next)); assert.notDeepEqual(next, p); p = next;
    }
    assert.ok(solved(p), `level ${l.number}`);
    assert.equal(l.audit.solutionMoves, l.solution.length); assert.equal(l.audit.groupMoves, groupMoves);
    assert.ok(groupMoves >= 2); assert.deepEqual(JSON.parse(JSON.stringify(hintSolution(l.positions))), l.solution);
  }
});

test('older saves unlock fourth cube and retain two-digit continent sessions and records', () => {
  const old = freshProgress(); old.completed = [Array(24).fill(true), Array(54).fill(true)];
  old.props = { hint: 4, preview: 8 };
  const p = restoreProgress(old); assert.equal(currentTheme(p), 2); assert.equal(currentFace(p, 2), 0);
  assert.deepEqual(p.completed.slice(0, 2), old.completed); assert.deepEqual(p.props, old.props);
  assert.ok(p.completed[2].every(x => !x));
  for (const l of continents.filter(l => l.level >= 9)) {
    const trial = structuredClone(p); trial.completed[2].fill(true, 0, l.face * 16);
    const key = `2:${l.face}:${l.level}`;
    trial.puzzles[key] = { positions: l.positions, gridSize: l.gridSize, layoutVersion: 6, stats: { moves: 3, hints: 0, previews: 1, activeMs: 1500 } };
    assert.deepEqual(restoreProgress(trial).puzzles[key], trial.puzzles[key]);
    markComplete(trial, 2, l.face, l.level);
    trial.records[key] = { moves: 3, hints: 0, previews: 1, activeMs: 1500, gridSize: l.gridSize, layoutVersion: 6, completedAt: 123 };
    assert.deepEqual(restoreProgress(trial).records[key], trial.records[key]);
  }
  completeAllLevels(p); assert.equal(currentTheme(p), 2); assert.equal(currentFace(p, 2), 5);
  assert.equal(themeUnlocked(p, 3), false); assert.equal(markComplete(p, 3, 0, 0), null);
  assert.notEqual(saveSlot('?trial=continents'), saveSlot());
});
test('fourth cube has six ordered continents and the exact requested grid distribution', () => {
  assert.equal(LEVEL_CONFIGS.length, 174);
  assert.deepEqual(CONTINENT_CHAPTERS.map(c => c.name), ['北美洲', '南美洲', '欧洲', '亚洲', '非洲', '大洋洲']);
  const counts = [{4:2,5:10,6:4},{5:4,6:10,7:2},{5:2,6:8,7:6},...Array(3).fill({6:10,7:6})];
  for (let face = 0; face < 6; face++) {
    const levels = continents.filter(l => l.face === face);
    assert.equal(levels.length, 16);
    assert.deepEqual(levels.reduce((out, l) => { out[l.gridSize] = (out[l.gridSize] ?? 0) + 1; return out; }, {}), counts[face]);
    for (const [i, l] of levels.entries()) {
      assert.equal(l.number, 79 + face * 16 + i); assert.equal(l.level, i);
      assert.equal(l.chapter, CONTINENT_CHAPTERS[face].id);
      assert.equal(levelConfig(2, face, i), l);
      assert.ok(levelArt(2, face, i).includes(face <= 2 ? l.artId : 'continent-placeholder'));
      assert.equal(l.placeholder, face > 2);
    }
  }
  assert.equal(THEMES[2].icon, 'globe'); assert.equal(THEMES[3].order, 5);
  assert.equal(THEMES[3].comingSoon, true); assert.equal(THEME_ART[3].icon, 'cube');
  assert.equal(THEME_ART[3].body, '#cfc1e3');
});
