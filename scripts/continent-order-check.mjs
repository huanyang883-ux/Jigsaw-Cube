import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import original from '../src/continent-layouts.json' with { type: 'json' };
import { freshProgress, restoreProgress, saveSlot, levelArt, LEVEL_CONFIGS } from '../src/progress.js';
import { continentOrder } from '../src/continent-order.js';
import { moveGroup, connectionCount } from '../src/puzzle.js';

const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const output = 'test-results/continent-order';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const errors = [], key = saveSlot('?trial=continents');
try {
  // Verify real legacy sessions on the small, hard and placeholder boards.
  for (const source of [original[1], original[6], original[24], original[43], original[50]]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const old = freshProgress(); delete old.continentOrderVersion;
    old.completed[0].fill(true); old.completed[1].fill(true);
    old.completed[2].fill(true, 0, source.face * 16);
    const recorded = original[source.face * 16 + (source.level + 1) % 16];
    old.completed[2][source.face * 16 + recorded.level] = true;
    old.records[`2:${source.face}:${recorded.level}`] = { moves: 19, hints: 1, previews: 0, activeMs: 45000, gridSize: recorded.gridSize, layoutVersion: 6, completedAt: 1000 };
    const move = source.solution[0];
    const positions = moveGroup(source.positions, move.id, move.dx, move.dy);
    old.puzzles[`2:${source.face}:${source.level}`] = { positions, gridSize: source.gridSize, layoutVersion: 6, stats: { moves: 1, hints: 0, previews: 0, activeMs: 500 } };
    await context.addInitScript(({ key, old }) => {
      if (sessionStorage.getItem('rhythm-seeded')) return;
      localStorage.setItem(key, JSON.stringify(old)); sessionStorage.setItem('rhythm-seeded', 'true');
    }, { key, old });
    const p = await context.newPage(); p.on('pageerror', e => errors.push(e.message));
    const state = () => p.evaluate(() => window.__game.state());
    const idle = () => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
    const level = continentOrder[source.face].indexOf(source.level);
    const config = LEVEL_CONFIGS.find(l => l.theme === 2 && l.face === source.face && l.level === level);
    async function open() {
      await p.tap('#enter'); await idle();
      const point = await p.evaluate(level => window.__game.tileCenter(level), level);
      await p.touchscreen.tap(point.x, point.y);
      await p.waitForFunction(() => window.__game.state().mode === 'puzzle'); await idle();
    }
    await p.goto(`${base}/?trial=continents`); await idle();
    const migrated = (await state()).progress;
    assert.deepEqual(migrated, restoreProgress(old));
    assert.equal((await state()).face, source.face);
    await open();
    let current = await state();
    assert.equal(current.session.level, level); assert.equal(current.session.art, levelArt(2, source.face, level));
    assert.deepEqual(current.session.positions, positions);
    assert.equal((await p.evaluate(() => window.__game.puzzleGeometry())).cards.length, source.gridSize ** 2);
    await p.tap('#picture-peek'); await p.waitForFunction(() => document.querySelector('.overlay-card img')?.complete);
    assert.equal(await p.locator('.overlay-card img').getAttribute('src'), levelArt(2, source.face, level));
    await p.tap('#close-picture'); await idle();
    await p.tap('#hint'); await p.waitForFunction(() => window.__game.state().session.stats.moves === 2); await idle();
    const resumed = (await state()).session;
    await p.reload(); await idle(); await open();
    current = await state();
    assert.deepEqual(current.session.positions, resumed.positions);
    assert.deepEqual(current.session.stats.moves, resumed.stats.moves);
    assert.equal(current.session.art, resumed.art);
    assert.deepEqual(current.progress.records, migrated.records);
    assert.equal(connectionCount(config.positions), 0);
    await p.screenshot({ path: `${output}/level-${config.number}.png` });
    console.log(`PASS: old ${source.artId} -> level ${config.number}, ${source.gridSize}x${source.gridSize}, same image/board/record, hint and reload.`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: legacy 4x4, 6x6 and 7x7 saves migrate and resume with normal animations.');
} finally { await browser.close(); }
