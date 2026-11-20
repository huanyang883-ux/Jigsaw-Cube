import test from 'node:test';
import assert from 'node:assert/strict';
import { createJigsaw, isJigsawSave, jigsawConfig, jigsawGrid } from '../src/jigsaw.js';
import { jigsawUnlocked, resetSelectedMode, restoreAccount, serializeAccount } from '../src/gameplay-progress.js';
import { THEMES, completeAllLevels, currentFace, currentTheme, faceSize, freshProgress, freshStats, initialLayout, isComplete, levelArt, levelConfig, markComplete,
  nextPlayableLevel, restoreProgress, themeUnlocked, unlockedFaces } from '../src/progress.js';

const cake = level => jigsawConfig(0, 0, level);
const newGame = () => createJigsaw(cake(0));

// Extract each side including its starting point, in common board coordinates.
function sides(piece) {
  let start = [piece.col, piece.row];
  return Array.from(piece.path.matchAll(/([CL])([^CLZ]+)/g), ([, , coords]) => {
    const numbers = coords.trim().split(/\s+/).map(Number);
    const points = [start];
    for (let i = 0; i < numbers.length; i += 2) {
      points.push([piece.col + numbers[i], piece.row + numbers[i + 1]].map(n => Number(n.toFixed(4))));
    }
    start = points.at(-1);
    return points;
  });
}

test('every classic grid size maps to the corresponding portrait jigsaw grid', () => {
  assert.deepEqual([3, 4, 5, 6, 7].map(jigsawGrid), [
    { cols: 4, rows: 6 }, { cols: 6, rows: 9 }, { cols: 8, rows: 12 },
    { cols: 10, rows: 15 }, { cols: 12, rows: 18 },
  ]);
  assert.equal(jigsawGrid(8), null);
});

test('all released jigsaws follow the ordered classic photo, size and per-picture seed', () => {
  const originalSeeds = [9071, 2683, 5351, 7669];
  const seeds = new Set(), sizes = [];
  for (const [theme, cube] of THEMES.entries()) {
    if (cube.comingSoon) {
      assert.equal(jigsawConfig(theme, 0, 0), null);
      continue;
    }
    let count = 0;
    for (let face = 0; face < cube.chapters.length; face++) {
      for (let level = 0; level < faceSize(theme); level++) {
        const classic = levelConfig(theme, face, level), config = jigsawConfig(theme, face, level);
        assert.equal(levelArt(theme, face, level).split('?')[0], '/assets/' + classic.artId + '.webp');
        const seed = theme === 0 && face === 0 ? originalSeeds[level] : classic.seed;
        assert.deepEqual(config, { ...jigsawGrid(classic.gridSize), seed });
        assert.ok(!seeds.has(seed));
        seeds.add(seed);
        count++;
      }
    }
    sizes.push(count);
  }
  assert.deepEqual(sizes, [24, 54, 96]);
});

test('the cake levels have square-based grids and every internal cubic seam is shared exactly', () => {
  assert.equal(jigsawConfig(0, 6, 0), null);
  assert.equal(cake(4), null);
  for (let level = 0; level < 4; level++) {
    const game = createJigsaw(cake(level));
    assert.equal(3 * game.cols, 2 * game.rows);
    assert.deepEqual({ cols: game.cols, rows: game.rows }, jigsawGrid(levelConfig(0, 0, level).gridSize));
    assert.deepEqual([...game.trayOrder].sort((a, b) => a - b), game.pieces.map(p => p.id));
    assert.notDeepEqual(game.trayOrder, game.pieces.map(p => p.id));
    const outlines = game.pieces.map(sides);
    for (const p of game.pieces) {
      const [top, right, bottom, left] = outlines[p.id];
      if (p.col === 0) assert.equal(left.length, 2);
      if (p.row === 0) assert.equal(top.length, 2);
      if (p.col === game.cols - 1) assert.equal(right.length, 2);
      else {
        assert.ok(right.length > 4);
        assert.deepEqual(right, outlines[p.id + 1][3].slice().reverse());
      }
      if (p.row === game.rows - 1) assert.equal(bottom.length, 2);
      else {
        assert.ok(bottom.length > 4);
        assert.deepEqual(bottom, outlines[p.id + game.cols][0].slice().reverse());
      }
    }
  }
});

test('loose groups join only through neighbors and keep their shape while dragged and restored', () => {
  const game = newGame();
  game.drop(0, 1, 2);
  game.drop(5, 2.08, 3.04);
  assert.deepEqual(game.groupIds(0), [0], 'diagonal neighbors stay loose');
  const result = game.drop(1, 2.02, 2.01);
  assert.equal(result.joined, true);
  assert.deepEqual(game.groupIds(1), [0, 1]);
  assert.deepEqual([game.pieces[1].x, game.pieces[1].y], [2, 2]);
  assert.equal(game.returnToTray(0), false);
  assert.ok(game.returnToTray(5));
  game.drop(0, 100, 100);
  assert.deepEqual([game.pieces[1].x, game.pieces[1].y], [3, 5]);
  const saved = JSON.parse(JSON.stringify(game.serialize()));
  assert.ok(isJigsawSave(cake(0), saved));
  const resumed = createJigsaw(cake(0), saved);
  assert.deepEqual(resumed.serialize(), saved);
  assert.deepEqual(resumed.trayOrder, game.trayOrder);
  assert.deepEqual(resumed.groupIds(1), [0, 1]);
  assert.equal(resumed.pieces[5].x, null);
  assert.equal(resumed.drop(1, 1.08, 0.2).placed, 2);
  assert.equal(resumed.placedCount, 2);
  assert.equal(resumed.drop(0, 2, 2).changed, false);
});

test('a placed neighbor can anchor the final assembly and a full save restores the victory state', () => {
  for (let level = 0; level < 4; level++) {
    const game = createJigsaw(cake(level));
    for (const id of game.trayOrder) {
      const p = game.pieces[id];
      assert.equal(game.solved, false);
      assert.equal(game.drop(id, p.col + 0.1, p.row - 0.1).placed, 1);
      assert.equal(game.returnToTray(id), false);
    }
    assert.equal(game.solved, true);
    assert.equal(game.groupIds(0).length, game.cols * game.rows);
    assert.equal(createJigsaw(cake(level), game.serialize()).solved, true);
  }
});

test('each hint places exactly one piece, even when only a loose assembly remains', () => {
  const game = newGame();
  const loose = [0, 1, 4];
  for (const id of loose) {
    const p = game.pieces[id];
    game.drop(id, p.col + 1, p.row + 2);
  }
  assert.deepEqual(game.groupIds(0), loose);
  for (let count = 1; count <= game.pieces.length; count++) {
    const hint = game.placeHint();
    assert.equal(hint.changed, true);
    assert.equal(hint.placed, 1);
    assert.equal(game.placedCount, count);
    if (count <= game.pieces.length - loose.length) {
      assert.ok(!loose.includes(hint.id), 'prefer the tray to disturbing existing assemblies');
    } else if (count === game.pieces.length - loose.length + 1) {
      assert.notEqual(hint.id, 0, 'leave the rest connected');
      assert.deepEqual(game.groupIds(0), loose.filter(id => id !== hint.id));
      assert.deepEqual([game.pieces[0].x, game.pieces[0].y], [1, 2]);
    }
    assert.ok(isJigsawSave(cake(0), game.serialize()));
  }
  assert.equal(game.solved, true);
  assert.equal(game.placeHint().changed, false);
});

test('snapshots reject disconnected groups, duplicate pieces, invalid positions and foreign cuts', () => {
  const game = newGame();
  game.drop(0, 1.4, 2.3);
  const saved = game.serialize();
  assert.equal(isJigsawSave(cake(2), saved), false);
  for (const groups of [
    [{ ids: [0, 5], dx: 0, dy: 0 }], [{ ids: [0], dx: 0, dy: 0 }, { ids: [0], dx: 0, dy: 0 }],
    [{ ids: [0], dx: -1, dy: 0 }], [{ ids: [24], dx: 0, dy: 0 }], [{ ids: [0], dx: NaN, dy: 0 }],
  ]) {
    const corrupt = { ...saved, groups };
    assert.equal(isJigsawSave(cake(0), corrupt), false);
    assert.deepEqual(createJigsaw(cake(0), corrupt).serialize().groups, []);
  }
});

function unlockedClassic() {
  const raw = freshProgress();
  raw.completed[0].fill(true);
  raw.completed[1].fill(true);
  return raw;
}

test('interrupted legacy cuts and their completed records survive, then replays use the mapped grid', () => {
  for (const [level, cols, rows] of [[1, 6, 9], [3, 8, 12]]) {
    const key = `0:0:${level}`, config = cake(level), raw = unlockedClassic();
    const old = createJigsaw({ ...config, cols, rows });
    old.drop(cols - 1, cols - 1, 0);
    raw.jigsaw = { version: 1, selected: 'B', completed: { [key]: true },
      puzzles: { [key]: { board: old.serialize(), stats: freshStats() } },
      records: { [key]: { ...freshStats(), columns: cols, rows, completedAt: 701 } } };
    const account = restoreAccount(raw);
    const resumed = createJigsaw(config, account.B.puzzles[key].board);
    assert.deepEqual(resumed.serialize(), old.serialize());
    assert.deepEqual(account.B.records[key], raw.jigsaw.records[key]);
    markComplete(account.B, 0, 0, level);
    const replay = createJigsaw(config, account.B.puzzles[key]?.board);
    assert.deepEqual([replay.cols, replay.rows], [4, 6]);
    assert.equal(createJigsaw(config, { ...old.serialize(), groups: [] }).pieces.length, 24);
  }
});

test('classic saves retain their v2 format and all 54 third-cube levels gate a persisted B selection', () => {
  const raw = unlockedClassic();
  const last = raw.completed[1].length - 1;
  assert.equal(last, 53);
  raw.completed[1][last] = false;
  raw.jigsaw = { version: 1, selected: 'B', completed: { '0:0:0': true } };
  const locked = restoreAccount(raw);
  assert.equal(jigsawUnlocked(locked), false);
  assert.equal(locked.selected, 'A');
  assert.equal(isComplete(locked.B, 0, 0, 0), false);
  assert.deepEqual(serializeAccount(locked), restoreProgress(raw));
  raw.completed[1][last] = true;
  delete raw.jigsaw;
  const unlocked = restoreAccount(raw);
  assert.equal(jigsawUnlocked(unlocked), true);
  assert.equal(unlocked.selected, 'A');
  assert.deepEqual(restoreProgress(serializeAccount(unlocked)), restoreProgress(raw));
});

test('classic and jigsaw completions, records and interrupted games round-trip independently', () => {
  const raw = unlockedClassic();
  const key = '0:0:0';
  raw.records[key] = { ...freshStats(), moves: 3, gridSize: 3, layoutVersion: 2, completedAt: 1000 };
  raw.puzzles['2:0:0'] = { positions: initialLayout(2, 0, 0), layoutVersion: levelConfig(2, 0, 0).layoutVersion, stats: freshStats() };
  const account = restoreAccount(raw);
  const classic = structuredClone(account.A);
  assert.deepEqual(account.B.props, { hint: 28, preview: 28 });
  account.B.props.hint = 0;
  account.B.props.preview = 17;
  assert.ok(classic.puzzles['2:0:0'], 'fixture includes an active classic session');
  assert.equal(isComplete(account.B, 0, 0, 0), false);
  const game = newGame();
  game.drop(2, 2, 0);
  const stats = { ...freshStats(), moves: 9, previews: 2, activeMs: 1234 };
  account.B.puzzles[key] = { board: game.serialize(), stats };
  account.selected = 'B';
  const reload = account => restoreAccount(JSON.parse(JSON.stringify(serializeAccount(account))));
  const resumed = reload(account);
  assert.deepEqual(resumed.B.props, { hint: 0, preview: 17 });
  assert.equal(resumed.selected, 'B');
  assert.deepEqual(resumed.B.puzzles[key], account.B.puzzles[key]);
  assert.equal(createJigsaw(cake(0), resumed.B.puzzles[key].board).placedCount, 1);
  markComplete(resumed.B, 0, 0, 0);
  resumed.B.records[key] = { ...stats, columns: 4, rows: 6, completedAt: 2000 };
  resumed.selected = 'A';
  const done = reload(resumed);
  assert.equal(done.selected, 'A');
  assert.equal(isComplete(done.B, 0, 0, 0), true);
  assert.deepEqual(done.B.puzzles, {});
  assert.deepEqual(done.B.records[key], resumed.B.records[key]);
  assert.deepEqual(done.A, classic);
  assert.deepEqual(restoreProgress(serializeAccount(done)), classic, 'an older classic build can read the shared save');
});

test('finishing a face opens the next B face, and the trophy unlocks all three playable cubes', () => {
  const account = restoreAccount(unlockedClassic());
  account.selected = 'B';
  for (let level = 0; level < 4; level++) markComplete(account.B, 0, 0, level);
  const next = restoreAccount(serializeAccount(account));
  assert.equal(currentTheme(next.B), 0);
  assert.equal(currentFace(next.B, 0), 1);
  assert.equal(unlockedFaces(next.B, 0), 2);
  assert.equal(nextPlayableLevel(next.B, 0, 1), 0);
  assert.equal(themeUnlocked(next.B, 1), false);
  next.B.puzzles['0:1:0'] = { board: createJigsaw(jigsawConfig(0, 1, 0)).serialize(), stats: freshStats() };
  completeAllLevels(next.B);
  const restored = restoreAccount(serializeAccount(next));
  assert.deepEqual(restored.B.completed.map(flags => flags.filter(Boolean).length), [24, 54, 96]);
  assert.deepEqual([0, 1, 2, 3].map(theme => unlockedFaces(restored.B, theme)), [6, 6, 6, 0]);
  assert.deepEqual(restored.B.puzzles, {});
  assert.deepEqual(restored.A, account.A);
});

test('A reset latches the unlocked switch before the first B visit; only B reset followed by A reset locks it again', () => {
  const account = restoreAccount();
  completeAllLevels(account.A);
  resetSelectedMode(account);
  assert.deepEqual(account.A, freshProgress());
  const reload = a => restoreAccount(JSON.parse(JSON.stringify(serializeAccount(a))));
  const afterA = reload(account);
  assert.ok(jigsawUnlocked(afterA));
  afterA.selected = 'B';
  completeAllLevels(afterA.B);
  resetSelectedMode(afterA);
  const afterB = reload(afterA);
  assert.deepEqual(afterB.B, freshProgress());
  assert.equal(afterB.selected, 'B');
  assert.ok(jigsawUnlocked(afterB), 'the reverse order keeps the switch available');
  afterB.selected = 'A';
  resetSelectedMode(afterB);
  const locked = reload(afterB);
  assert.equal(locked.selected, 'A');
  assert.equal(jigsawUnlocked(locked), false);
  completeAllLevels(locked.A);
  assert.ok(jigsawUnlocked(reload(locked)), 'the same classic milestone unlocks both modes again');
});

test('resetting A after resetting and playing B again preserves the new B data behind the gate', () => {
  const account = restoreAccount(unlockedClassic());
  account.selected = 'B';
  resetSelectedMode(account);
  const board = newGame();
  board.placeHint();
  account.B.puzzles['0:0:0'] = { board: board.serialize(), stats: freshStats() };
  account.B.props.hint--;
  account.B.sound = true;
  const played = structuredClone(account.B);
  account.selected = 'A';
  resetSelectedMode(account);
  const reloaded = restoreAccount(serializeAccount(account));
  assert.equal(jigsawUnlocked(reloaded), false);
  assert.deepEqual(reloaded.B, played);
  completeAllLevels(reloaded.A);
  assert.deepEqual(restoreAccount(serializeAccount(reloaded)).B, played);
});

test('restoring an already assembled board never leaves an unplayable saved session', () => {
  const game = newGame();
  for (const p of game.pieces) game.drop(p.id, p.col, p.row);
  const key = '0:0:0';
  const raw = unlockedClassic();
  raw.jigsaw = { version: 1, selected: 'B', completed: {}, puzzles: {
    [key]: { board: game.serialize(), stats: { ...freshStats(), moves: 24 } },
  } };
  const restored = restoreAccount(raw);
  assert.equal(restored.B.puzzles[key], undefined);
  assert.equal(isComplete(restored.B, 0, 0, 0), false);
  assert.deepEqual(restored.B.records, {});
});
