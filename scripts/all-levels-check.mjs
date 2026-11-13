import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { LEVEL_CONFIGS, freshProgress, legacyInitialLayout, saveSlot } from '../src/progress.js';
import { moveGroup, findHint, solved, xy, connectionCount } from '../src/puzzle.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const settings = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };
const normalKey = saveSlot(), trialKey = saveSlot('?trial=all78'), previousKey = saveSlot('?trial=first12'), errors = [];
const state = (p) => p.evaluate(() => window.__game.state());
const idle = (p) => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
const watch = (p) => {
  p.on('pageerror', (error) => errors.push(error.message));
  p.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Context Lost')) errors.push(message.text()); });
};
async function open(p, level) {
  assert.equal((await state(p)).mode, 'chapters', `chapter screen before selecting tile ${level}`);
  const point = await p.evaluate((i) => window.__game.tileCenter(i), level);
  await p.touchscreen.tap(point.x, point.y);
  await p.waitForFunction(() => window.__game.state().mode === 'puzzle'); await idle(p);
}
async function continueLevel(p) {
  await p.waitForFunction(() => document.querySelector('.win-card img')?.complete);
  const box = await p.locator('#continue').boundingBox(), cdp = await p.context().newCDPSession(p);
  // Use a held finger contact, just as in the raw CDP drags, rather than mixing
  // those drags with a zero-duration Playwright tap in the mobile input stream.
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await p.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  await p.waitForFunction(() => window.__game.state().mode !== 'puzzle'); await idle(p);
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
  const previous = structuredClone(normal); previous.props.preview = 8;
  const context = await browser.newContext(settings);
  await context.addInitScript(({ normalKey, previousKey, normal, previous }) => {
    if (!localStorage.getItem(normalKey)) localStorage.setItem(normalKey, JSON.stringify(normal));
    if (!localStorage.getItem(previousKey)) localStorage.setItem(previousKey, JSON.stringify(previous));
    window.tapTrace = [];
    for (const type of ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'click']) document.addEventListener(type, (e) => {
      if (document.querySelector('#overlay')?.hidden !== false) return;
      const img = document.querySelector('.win-card img');
      window.tapTrace.push({ type, target: e.target.id || e.target.className, photoReady: img?.complete, time: performance.now() });
      window.tapTrace = window.tapTrace.slice(-15);
    }, true);
  }, { normalKey, previousKey, normal, previous });
  const p = await context.newPage(), cdp = await context.newCDPSession(p); watch(p);
  await p.goto(`${base}/?trial=all78`); await idle(p);
  assert.ok((await state(p)).progress.completed.flat().every((done) => !done));
  await p.tap('#enter'); await idle(p);
  for (const [index, entry] of LEVEL_CONFIGS.entries()) {
    const theme = index < 24 ? 0 : 1, local = index < 24 ? index : index - 24, count = theme === 0 ? 4 : 9;
    const face = Math.floor(local / count), level = local % count;
    if (entry.number === 25) {
      assert.equal((await state(p)).mode, 'home'); assert.equal((await state(p)).theme, 1);
      await p.tap('#enter'); await idle(p);
    }
    await p.emulateMedia({ reducedMotion: [25, 29].includes(entry.number) ? 'no-preference' : 'reduce' });
    await open(p, level);
    let snapshot = await state(p);
    assert.equal(snapshot.theme, theme); assert.equal(snapshot.face, face);
    assert.ok(snapshot.session.art.includes(`/${entry.artId}.webp`), `expected ${entry.number}: ${entry.artId}, opened ${snapshot.session.level}: ${snapshot.session.art}`);
    assert.deepEqual(snapshot.session.positions, entry.positions); assert.equal(snapshot.session.layoutVersion, entry.layoutVersion);
    assert.equal((await p.evaluate(() => window.__game.puzzleGeometry())).cards.length, entry.gridSize ** 2);
    assert.equal(Number(await p.locator('.puzzle-progress').getAttribute('aria-valuenow')), Math.round(connectionCount(entry.positions) / (2 * entry.gridSize * (entry.gridSize - 1)) * 100));
    if ([13, 15, 20, 25, 28, 29, 34, 38, 54, 61, 65, 76, 78].includes(entry.number)) await p.screenshot({ path: `test-results/all78-level-${entry.number}.png` });
    if ([13, 29].includes(entry.number)) { await p.tap('#picture-peek'); await p.waitForSelector('#close-picture'); await p.tap('#close-picture'); }
    for (let i = 0; i < entry.solution.length; i++) {
      await drag(p, cdp, entry.solution[i]);
      if ([13, 29].includes(entry.number) && i === 0) {
        const saved = (await state(p)).session;
        await p.reload(); await idle(p);
        if (theme === 1) { await p.tap('#next'); await idle(p); }
        await p.tap('#enter'); await idle(p); await open(p, level);
        snapshot = await state(p); assert.deepEqual(snapshot.session.positions, saved.positions); assert.equal(snapshot.session.stats.moves, 1);
        assert.equal(snapshot.session.stats.previews, 1);
      }
    }
    await p.waitForSelector('#continue'); snapshot = await state(p);
    assert.ok(snapshot.session.completed);
    const record = snapshot.progress.records[`${theme}:${face}:${level}`];
    assert.equal(record.moves, entry.solution.length); assert.equal(record.gridSize, entry.gridSize); assert.ok(record.activeMs > 0);
    assert.equal(record.layoutVersion, entry.layoutVersion);
    assert.equal((await p.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
    await continueLevel(p);
    assert.equal((await state(p)).progress.completed[theme].slice(0, local + 1).every(Boolean), true);
    console.log(`PASS: ${entry.number}/78 ${entry.artId}, ${entry.gridSize}x${entry.gridSize}, ${entry.difficulty}, ${entry.solution.length} real touch moves.`);
  }
  const final = await state(p);
  assert.equal(final.face, 5); assert.ok(final.progress.completed.flat().every(Boolean));
  assert.equal(Object.keys(final.progress.records).length, 78);
  assert.deepEqual(final.progress.props, { hint: 28, preview: 26 });
  assert.deepEqual(await p.evaluate((key) => JSON.parse(localStorage.getItem(key)), normalKey), normal);
  assert.deepEqual(await p.evaluate((key) => JSON.parse(localStorage.getItem(key)), previousKey), previous);
  await p.reload(); await idle(p);
  assert.ok((await state(p)).progress.completed.flat().every(Boolean));
  assert.equal(Object.keys((await state(p)).progress.records).length, 78);
  await p.tap('#next'); await idle(p); await p.tap('#next'); await idle(p); await p.tap('#enter'); await idle(p);
  assert.equal((await state(p)).mode, 'home', 'future cube stays locked after all 78');
  assert.ok(await p.evaluate((key) => !!localStorage.getItem(key), trialKey)); await context.close();

  for (const [theme, face, level, expectedSize] of [[0, 3, 0, 16], [1, 0, 4, 9]]) {
    const legacy = freshProgress(); if (theme === 1) legacy.completed[0].fill(true);
    legacy.completed[theme].fill(true, 0, face * (theme === 0 ? 4 : 9)); legacy.props = { hint: 7, preview: 11 };
    const key = `${theme}:${face}:${level}`;
    legacy.puzzles[key] = { positions: legacyInitialLayout(theme, face, level) };
    const old = await browser.newContext(settings);
    await old.addInitScript(({ key, legacy }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(legacy)); }, { key: normalKey, legacy });
    const q = await old.newPage(), touch = await old.newCDPSession(q); watch(q);
    await q.goto(base); await idle(q); if (theme === 1) { await q.tap('#next'); await idle(q); }
    await q.tap('#enter'); await idle(q); await open(q, level);
    assert.deepEqual((await state(q)).session.positions, legacy.puzzles[key].positions);
    assert.equal((await state(q)).session.layoutVersion, 1);
    const before = (await state(q)).session.positions, hint = findHint(before);
    await q.tap('#hint'); await q.waitForFunction(() => window.__game.state().progress.props.hint === 6); await idle(q);
    assert.deepEqual((await state(q)).session.positions, moveGroup(before, hint.id, hint.dx, hint.dy));
    const saved = (await state(q)).session;
    await q.reload(); await idle(q); if (theme === 1) { await q.tap('#next'); await idle(q); }
    await q.tap('#enter'); await idle(q); await open(q, level);
    assert.deepEqual((await state(q)).session.positions, saved.positions);
    for (let i = 0; i < before.length && !solved((await state(q)).session.positions); i++) await drag(q, touch, findHint((await state(q)).session.positions));
    await q.waitForSelector('#continue'); await continueLevel(q); await open(q, level);
    assert.equal((await state(q)).session.positions.length, expectedSize);
    assert.equal((await state(q)).session.layoutVersion, 3);
    assert.equal((await state(q)).session.stats.moves, 0);
    assert.deepEqual((await state(q)).progress.props, { hint: 6, preview: 11 }); await old.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: all 78 levels, chapter/theme unlocks, mobile input, 3x3/4x4 photos, reload, isolated saves, legacy resume/replay, metrics, props and no visible words or browser errors.');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) {
    try { await page.screenshot({ path: 'test-results/all78-failure.png' }); console.error(JSON.stringify({ state: await state(page), taps: await page.evaluate(() => window.tapTrace) })); } catch { /* Page may have closed. */ }
  }
  throw error;
} finally { await browser.close(); }
