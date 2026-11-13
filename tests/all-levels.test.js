import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVEL_CONFIGS, THEMES, levelConfig, initialLayout, levelArt, legacyInitialLayout, freshProgress, freshStats, restoreProgress, saveSlot, markComplete } from '../src/progress.js';
import first12 from '../src/first12-layouts.json' with { type: 'json' };
import { levelPlan } from '../scripts/level-plan.mjs';
import { shapeKey, moves, searchWithin, hintSolution } from '../scripts/level-search.mjs';
import { valid, solved, moveGroup, groups, connectionCount } from '../src/puzzle.js';

test('78 unique boards preserve every photo and theme, cap grids at 4, and freeze the accepted first 12', () => {
  assert.equal(LEVEL_CONFIGS.length, 78);
  assert.deepEqual(LEVEL_CONFIGS.slice(0, 12), first12);
  const shapes = new Set(), photos = new Set();
  for (const [index, config] of LEVEL_CONFIGS.entries()) {
    const theme = index < 24 ? 0 : 1, local = index < 24 ? index : index - 24, count = theme === 0 ? 4 : 9;
    const face = Math.floor(local / count), level = local % count;
    assert.equal(config.number, index + 1);
    assert.equal(config.chapter, THEMES[theme].chapters[face].id);
    assert.equal(config.artId, `${config.chapter}-${String(level + 1).padStart(2, '0')}`);
    assert.equal(levelConfig(theme, face, level), config);
    assert.ok(levelArt(theme, face, level).includes(`/${config.artId}.webp?`));
    assert.ok([3, 4].includes(config.gridSize)); assert.equal(config.positions.length, config.gridSize ** 2);
    assert.ok(valid(config.positions)); assert.ok(!solved(config.positions));
    const copy = initialLayout(theme, face, level); copy[0] = -1; assert.ok(valid(config.positions));
    shapes.add(shapeKey(config.positions)); photos.add(config.artId);
  }
  assert.equal(shapes.size, 78, 'rotating or reflecting a reused board does not count as a new level');
  assert.equal(photos.size, 78);
});

test('new chapters have bounded peaks, relief finishes and smaller-grid breathers within their own theme', () => {
  for (const theme of [0, 1]) for (let face = theme === 0 ? 3 : 0; face < 6; face++) {
    const chapter = LEVEL_CONFIGS.filter((l) => l.theme === theme && l.face === face);
    assert.equal(chapter.length, theme === 0 ? 4 : 9);
    assert.equal(chapter.at(-1).difficulty, 'relief');
    assert.notEqual(chapter[0].difficulty, 'challenge');
    assert.equal(chapter.filter((l) => l.difficulty === 'challenge').length, theme === 0 ? 1 : 2);
    if (theme === 1) assert.equal(chapter.filter((l) => l.gridSize === 3).length, 1);
    for (let i = 1; i < chapter.length; i++) if (chapter[i].difficulty === 'challenge') assert.notEqual(chapter[i - 1].difficulty, 'challenge');
  }
  for (const spec of levelPlan) {
    const config = LEVEL_CONFIGS[spec.number - 1];
    for (const field of ['theme', 'face', 'level', 'gridSize', 'difficulty', 'imageDifficulty']) assert.equal(config[field], spec[field]);
    assert.equal(config.solution.length, spec.target);
    assert.ok(config.audit.solutionMoves <= 8, 'later chapters do not continually raise the layout ceiling');
    if (config.imageDifficulty === 'hard') assert.ok(config.solution.length <= 7, 'complex photos get lighter layouts');
    if (['easy', 'relief'].includes(config.difficulty) && config.gridSize === 4) {
      assert.ok(config.audit.initialLinks >= 3); assert.ok(config.audit.hintMoves <= config.solution.length + 2);
    }
  }
});

test('all 66 new routes and audit values follow the real group-move rules and exclude short shortcuts', () => {
  for (const config of LEVEL_CONFIGS.slice(12)) {
    let cursor = [...config.positions], groupMoves = 0;
    assert.equal(connectionCount(cursor), config.audit.initialLinks);
    assert.deepEqual(groups(cursor).map((g) => g.length), config.audit.initialGroups);
    for (const option of moves(cursor)) assert.deepEqual(option.state, moveGroup(cursor, option.move.id, option.move.dx, option.move.dy));
    for (const move of config.solution) {
      if (groups(cursor).find((g) => g.includes(move.id)).length > 1) groupMoves++;
      const next = moveGroup(cursor, move.id, move.dx, move.dy);
      assert.ok(valid(next)); assert.notDeepEqual(next, cursor); cursor = next;
    }
    assert.ok(solved(cursor), `level ${config.number}`); assert.equal(groupMoves, config.audit.groupMoves);
    const depth = config.gridSize === 3 ? config.solution.length - 1 : 3;
    const check = searchWithin(config.positions, depth);
    assert.equal(check.exhausted, false); assert.equal(check.solution, null, `no ${depth}-move shortcut at ${config.number}`);
    assert.equal(hintSolution(config.positions).length, config.audit.hintMoves);
    for (const option of moves(config.positions).slice(0, 3)) assert.ok(hintSolution(option.state).length <= config.positions.length);
  }
});

test('old dessert 3x3 and animal 4x4 sessions survive; fresh replays use the new sizes and versions', () => {
  for (const [theme, face, level] of [[0, 3, 0], [1, 0, 4]]) {
    const p = freshProgress();
    if (theme === 1) p.completed[0].fill(true);
    p.completed[theme].fill(true, 0, face * (theme === 0 ? 4 : 9));
    p.props = { hint: 9, preview: 11 }; p.guides.dragPuzzle = true;
    const key = `${theme}:${face}:${level}`, positions = legacyInitialLayout(theme, face, level);
    p.puzzles[key] = { positions };
    let restored = restoreProgress(p);
    assert.deepEqual(restored.puzzles[key], { positions, layoutVersion: 1, gridSize: theme + 3, stats: freshStats() });
    assert.deepEqual(restored.props, p.props); assert.deepEqual(restored.completed, p.completed);
    const modern = levelConfig(theme, face, level);
    assert.notEqual(modern.gridSize, theme + 3);
    markComplete(restored, theme, face, level); assert.equal(restored.puzzles[key], undefined);
    assert.equal(initialLayout(theme, face, level).length, modern.gridSize ** 2);
    p.puzzles[key] = { positions: modern.positions, layoutVersion: 3, gridSize: modern.gridSize, stats: { moves: 2, hints: 1, previews: 1, activeMs: 12000 } };
    assert.deepEqual(restoreProgress(p).puzzles[key], p.puzzles[key]);
    p.puzzles[key].layoutVersion = 2; assert.equal(restoreProgress(p).puzzles[key], undefined, 'version 2 only existed for the first twelve');
  }
});

test('full trial, earlier trial and normal saves have separate persistent slots', () => {
  assert.equal(saveSlot('?trial=all78'), 'sweet-cube:trial:all78:v1');
  assert.equal(new Set([saveSlot(), saveSlot('?trial=first12'), saveSlot('?trial=all78')]).size, 3);
  const p = freshProgress(); p.completed[0].fill(true); p.completed[1].fill(true);
  const config = levelConfig(1, 5, 8);
  p.records['1:5:8'] = { ...freshStats(), moves: 7, gridSize: config.gridSize, layoutVersion: 3, completedAt: 123 };
  const restored = restoreProgress(p);
  assert.deepEqual(restored.records, p.records); assert.deepEqual(restored.completed, p.completed); assert.deepEqual(restored.props, p.props);
});
