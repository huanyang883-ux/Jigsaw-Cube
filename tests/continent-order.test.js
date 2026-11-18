import test from 'node:test';
import assert from 'node:assert/strict';
import original from '../src/continent-layouts.json' with { type: 'json' };
import { continentOrder, CONTINENT_ORDER_VERSION } from '../src/continent-order.js';
import { continentGrids } from '../scripts/continent-plan.mjs';
import { LEVEL_CONFIGS, freshProgress, restoreProgress, levelConfig, levelArt } from '../src/progress.js';
import { moveGroup } from '../src/puzzle.js';

test('chapter rhythm spreads easier boards and separates peaks without changing any content', () => {
  for (const [face, order] of continentOrder.entries()) {
    assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
    const levels = LEVEL_CONFIGS.filter(l => l.theme === 2 && l.face === face);
    const grids = levels.map(l => l.gridSize), min = Math.min(...grids), max = Math.max(...grids);
    assert.deepEqual(grids, continentGrids[face]);
    assert.ok(grids.slice(0, 8).includes(min) && grids.slice(8).includes(min), 'relief in both halves');
    assert.ok(grids.at(-1) < max, 'a lighter chapter finish');
    const peaks = grids.flatMap((n, i) => n === max ? [i] : []);
    assert.ok(peaks.some(i => i < 8) && peaks.some(i => i >= 8));
    for (let i = 1; i < peaks.length; i++) {
      assert.ok(peaks[i] - peaks[i - 1] >= 2, 'no adjacent hardest boards');
      assert.ok(peaks[i] - peaks[i - 1] <= Math.ceil(16 / peaks.length) + 1, 'peaks distributed across chapter');
    }
    for (const [level, contentLevel] of order.entries()) {
      const source = original[face * 16 + contentLevel];
      assert.deepEqual(levels[level], { ...source, number: 79 + face * 16 + level, level });
      assert.ok(levelArt(2, face, level).includes(face <= 1 ? source.artId : 'continent-placeholder'));
    }
  }
});

test('every older continent save follows its picture and board to the new slot exactly once', () => {
  for (const source of original) {
    const { face, level } = source, old = freshProgress();
    delete old.continentOrderVersion;
    old.completed[0].fill(true); old.completed[1].fill(true);
    old.completed[2].fill(true, 0, (face + 1) * 16);
    old.completed[2][face * 16 + level] = false;
    old.sound = true; old.props = { hint: 8, preview: 9 };
    const recordLevel = (level + 1) % 16, recorded = original[face * 16 + recordLevel];
    const oldKey = `2:${face}:${level}`, oldRecordKey = `2:${face}:${recordLevel}`;
    const move = source.solution[0];
    old.puzzles[oldKey] = { positions: moveGroup(source.positions, move.id, move.dx, move.dy), gridSize: source.gridSize, layoutVersion: 6, stats: { moves: 1, hints: 0, previews: 1, activeMs: 1200 } };
    old.records[oldRecordKey] = { moves: 25, hints: 2, previews: 1, activeMs: 40000, gridSize: recorded.gridSize, layoutVersion: 6, completedAt: 1000 };
    const before = structuredClone(old), restored = restoreProgress(old);
    const newLevel = continentOrder[face].indexOf(level), newRecordLevel = continentOrder[face].indexOf(recordLevel);
    assert.equal(restored.continentOrderVersion, CONTINENT_ORDER_VERSION);
    assert.equal(levelConfig(2, face, newLevel).artId, source.artId);
    assert.equal(restored.completed[2][face * 16 + newLevel], false);
    assert.equal(restored.completed[2][face * 16 + newRecordLevel], true);
    assert.deepEqual(restored.puzzles[`2:${face}:${newLevel}`], old.puzzles[oldKey]);
    assert.deepEqual(restored.records[`2:${face}:${newRecordLevel}`], old.records[oldRecordKey]);
    assert.deepEqual(restored.completed.slice(0, 2), old.completed.slice(0, 2));
    assert.deepEqual(restored.props, old.props); assert.equal(restored.sound, true);
    assert.deepEqual(restoreProgress(JSON.parse(JSON.stringify(restored))), restored);
    assert.deepEqual(old, before, 'migration does not mutate the source save');
  }
});
