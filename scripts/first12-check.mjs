import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import layouts from '../src/first12-layouts.json' with { type: 'json' };
import { freshProgress, legacyInitialLayout, saveSlot } from '../src/progress.js';
import { moveGroup, findHint, solved, xy, connectionCount } from '../src/puzzle.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const settings = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const normalKey = saveSlot(), trialKey = saveSlot('?trial=first12'), errors = [];
const state = (p) => p.evaluate(() => window.__game.state());
const idle = (p) => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
async function open(p, level) {
  const point = await p.evaluate((level) => window.__game.tileCenter(level), level);
  await p.touchscreen.tap(point.x, point.y);
  await p.waitForFunction(() => window.__game.state().mode === 'puzzle');
}
async function drag(p, cdp, move) {
  const before = (await state(p)).session.positions, n = Math.sqrt(before.length), start = xy(before[move.id], n);
  const from = await p.evaluate((id) => window.__game.pieceCenter(id), move.id);
  const to = await p.evaluate((cell) => window.__game.cellCenter(cell), (start.y + move.dy) * n + start.x + move.dx);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(p);
  assert.deepEqual((await state(p)).session.positions, moveGroup(before, move.id, move.dx, move.dy));
  await p.waitForTimeout(100);
}
await fs.mkdir('test-results', { recursive: true });
try {
  const normal = freshProgress(); normal.completed[0].fill(true, 0, 12); normal.props.hint = 9;
  const context = await browser.newContext(settings);
  await context.addInitScript(({ key, normal }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(normal)); }, { key: normalKey, normal });
  const p = await context.newPage(), cdp = await context.newCDPSession(p);
  p.on('pageerror', (error) => errors.push(error.message));
  await p.goto(`${base}/?trial=first12`); await idle(p);
  assert.ok((await state(p)).progress.completed[0].every((done) => !done));
  await p.tap('#enter'); await idle(p);
  for (const entry of layouts) {
    const level = (entry.number - 1) % 4;
    await p.emulateMedia({ reducedMotion: [1, 9].includes(entry.number) ? 'no-preference' : 'reduce' });
    await open(p, level);
    if (entry.number === 9) {
      await p.waitForFunction(() => window.__game.entrance()?.cards.length === 16);
      await p.screenshot({ path: 'test-results/first12-jelly-backs.png' });
    }
    await idle(p);
    let snapshot = await state(p);
    assert.equal(snapshot.face, Math.floor((entry.number - 1) / 4));
    assert.ok(snapshot.session.art.includes(`/${entry.artId}.webp`));
    assert.deepEqual(snapshot.session.positions, entry.positions); assert.equal(snapshot.session.layoutVersion, 2);
    assert.equal((await p.evaluate(() => window.__game.puzzleGeometry())).cards.length, entry.gridSize ** 2);
    const fill = await p.locator('.puzzle-progress').getAttribute('aria-valuenow');
    assert.equal(Number(fill), Math.round(connectionCount(entry.positions) / (2 * entry.gridSize * (entry.gridSize - 1)) * 100));
    if ([1, 7, 9, 11].includes(entry.number)) await p.screenshot({ path: `test-results/first12-level-${entry.number}.png` });
    if ([3, 10].includes(entry.number)) { await p.tap('#picture-peek'); await p.waitForSelector('#close-picture'); await p.tap('#close-picture'); }
    for (let i = 0; i < entry.solution.length; i++) {
      await drag(p, cdp, entry.solution[i]);
      if (entry.number === 6 && i === 0) {
        const saved = (await state(p)).session;
        await p.reload(); await idle(p); await p.tap('#enter'); await idle(p); await open(p, level); await idle(p);
        snapshot = await state(p); assert.deepEqual(snapshot.session.positions, saved.positions); assert.equal(snapshot.session.stats.moves, 1);
      }
    }
    await p.waitForSelector('#continue'); snapshot = await state(p);
    assert.ok(snapshot.session.completed);
    const record = snapshot.progress.records[`0:${snapshot.face}:${level}`];
    assert.equal(record.moves, entry.solution.length); assert.equal(record.gridSize, entry.gridSize); assert.ok(record.activeMs > 0);
    assert.equal((await p.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
    await p.tap('#continue'); await idle(p);
    console.log(`PASS: level ${entry.number}, ${entry.chapter}, ${entry.gridSize}x${entry.gridSize}, ${entry.solution.length} legal touch moves, local metrics and unlock.`);
  }
  const final = await state(p);
  assert.equal(final.face, 3); assert.ok(final.progress.completed[0].slice(0, 12).every(Boolean));
  assert.deepEqual(final.progress.props, { hint: 28, preview: 26 });
  assert.deepEqual(await p.evaluate((key) => JSON.parse(localStorage.getItem(key)), normalKey), normal);
  assert.ok(await p.evaluate((key) => !!localStorage.getItem(key), trialKey)); await context.close();

  const legacy = freshProgress(); legacy.completed[0].fill(true, 0, 8); legacy.props = { hint: 7, preview: 11 };
  legacy.puzzles['0:2:0'] = { positions: legacyInitialLayout(0, 2, 0) };
  const old = await browser.newContext({ ...settings, reducedMotion: 'reduce' });
  await old.addInitScript(({ key, legacy }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(legacy)); }, { key: normalKey, legacy });
  const q = await old.newPage(), touch = await old.newCDPSession(q); q.on('pageerror', (error) => errors.push(error.message));
  await q.goto(base); await idle(q); await q.tap('#enter'); await idle(q); await open(q, 0); await idle(q);
  assert.deepEqual((await state(q)).session.positions, legacy.puzzles['0:2:0'].positions);
  assert.equal((await state(q)).session.layoutVersion, 1);
  await q.reload(); await idle(q); await q.tap('#enter'); await idle(q); await open(q, 0); await idle(q);
  assert.equal((await state(q)).session.positions.length, 9);
  for (let i = 0; i < 9 && !solved((await state(q)).session.positions); i++) await drag(q, touch, findHint((await state(q)).session.positions));
  await q.waitForSelector('#continue'); await q.tap('#continue'); await idle(q); await open(q, 0); await idle(q);
  assert.equal((await state(q)).session.positions.length, 16, 'replaying a finished legacy level uses the new 4x4 layout');
  const before = (await state(q)).session.positions, hint = findHint(before);
  await q.tap('#hint'); await idle(q);
  assert.deepEqual((await state(q)).session.positions, moveGroup(before, hint.id, hint.dx, hint.dy));
  assert.deepEqual((await state(q)).progress.props, { hint: 6, preview: 11 });
  assert.equal((await state(q)).session.stats.hints, 1); await old.close();
  assert.deepEqual(errors, []);
  console.log('PASS: isolated trial preserves original saves; old 3x3 resumes intact; replay upgrades to 4x4; hint, props, metrics and all 12 chapters/levels work without visible words or browser errors.');
} finally { await browser.close(); }
