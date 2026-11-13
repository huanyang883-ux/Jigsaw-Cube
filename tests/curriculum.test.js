import test from 'node:test';
import assert from 'node:assert/strict';
import layouts from '../src/first12-layouts.json' with { type: 'json' };
import { freshProgress, freshStats, restoreProgress, puzzleSize, levelConfig, initialLayout, legacyInitialLayout, levelArt, saveSlot } from '../src/progress.js';
import { moves, searchWithin } from '../scripts/level-search.mjs';
import { moveGroup, solved, valid, findHint } from '../src/puzzle.js';

test('the accepted first twelve preserve their themes, sizes and layouts', () => {
  const seen = new Set();
  for (let i = 0; i < 12; i++) {
    const face = Math.floor(i / 4), level = i % 4, config = levelConfig(0, face, level), p = initialLayout(0, face, level);
    assert.equal(config.chapter, ['cake', 'candy', 'jelly'][face]);
    assert.deepEqual(config, layouts[i]);
    assert.ok(levelArt(0, face, level).includes(`/assets/${config.artId}.webp`));
    assert.equal(puzzleSize(0, face, level), i < 8 ? 3 : 4);
    assert.equal(p.length, config.gridSize ** 2); assert.ok(valid(p)); assert.ok(!solved(p));
    seen.add(p.join(',')); p[0] = -1; assert.ok(valid(initialLayout(0, face, level)), 'callers cannot mutate the fixed catalog');
  }
  assert.equal(seen.size, 12);
});

test('every accepted route obeys gameplay rules, offline successors match gameplay, and short-solution filters are real', () => {
  for (const level of layouts) {
    for (const option of moves(level.positions)) assert.deepEqual(option.state, moveGroup(level.positions, option.move.id, option.move.dx, option.move.dy));
    let state = [...level.positions];
    for (const move of level.solution) state = moveGroup(state, move.id, move.dx, move.dy);
    assert.ok(solved(state), `level ${level.number} has a full legal solution`);
    assert.equal(level.solution.length, level.audit.solutionMoves);
    const depth = level.gridSize === 3 ? level.audit.provenMinimum - 1 : 3;
    const check = searchWithin(level.positions, depth);
    assert.equal(check.exhausted, false); assert.equal(check.solution, null, `level ${level.number} has no shortcut of ${depth} moves`);
  }
});

test('hints make permanent progress on curated and player-modified boards, without loops', () => {
  for (const level of layouts) {
    for (const start of [level.positions, ...moves(level.positions).slice(0, 5).map((m) => m.state)]) {
      let state = [...start], count = 0;
      while (!solved(state) && count++ < start.length) {
        const before = state.filter((p, id) => p === id).length, hint = findHint(state); assert.ok(hint);
        state = moveGroup(state, hint.id, hint.dx, hint.dy);
        assert.ok(state.filter((p, id) => p === id).length > before);
      }
      assert.ok(solved(state));
    }
  }
});

test('old 3×3 jelly sessions and new 4×4 sessions both survive reload, with props and learning flags intact', () => {
  const old = freshProgress(); old.completed[0].fill(true, 0, 8);
  old.props = { hint: 7, preview: 11 }; old.guides.dragPuzzle = true;
  const positions = legacyInitialLayout(0, 2, 0);
  old.puzzles['0:2:0'] = { positions };
  const migrated = restoreProgress(old);
  assert.deepEqual(migrated.puzzles['0:2:0'], { positions, gridSize: 3, layoutVersion: 1, stats: freshStats() });
  assert.deepEqual(migrated.completed, old.completed); assert.deepEqual(migrated.props, old.props); assert.equal(migrated.guides.dragPuzzle, true);
  const modern = freshProgress(); modern.completed[0].fill(true, 0, 8);
  modern.puzzles['0:2:0'] = { positions: initialLayout(0, 2, 0), gridSize: 4, layoutVersion: 2, stats: { moves: 3, hints: 1, previews: 1, activeMs: 9000 } };
  assert.deepEqual(restoreProgress(modern).puzzles, modern.puzzles);
  modern.puzzles['0:2:0'].layoutVersion = 999; assert.deepEqual(restoreProgress(modern).puzzles, {});
  modern.puzzles['0:2:0'] = null; assert.deepEqual(restoreProgress(modern).puzzles, {});
});

test('trial save is isolated and local playtest measurements survive restore', () => {
  assert.equal(saveSlot(), 'sweet-cube:progress:v2');
  assert.equal(saveSlot('?trial=first12'), 'sweet-cube:trial:first12:v1');
  assert.equal(saveSlot('?trial=unknown'), saveSlot());
  const p = freshProgress(); p.completed[0][0] = true;
  p.records['0:0:0'] = { moves: 4, hints: 1, previews: 0, activeMs: 12000, layoutVersion: 2, gridSize: 3, completedAt: 12345 };
  assert.deepEqual(restoreProgress(p).records, p.records);
});
