import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LEVEL_CONFIGS, freshProgress, saveSlot, artUrl } from '../src/progress.js';
import { connectionCount, moveGroup, findHint, xy } from '../src/puzzle.js';

const output = 'test-results/five-by-five';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const idle = p => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
const state = p => p.evaluate(() => window.__game.state());
const errors = [], report = [];
async function open(p, entry) {
  await p.tap('#enter'); await idle(p);
  assert.equal((await state(p)).face, entry.face);
  const tile = await p.evaluate(level => window.__game.tileCenter(level), entry.level);
  await p.touchscreen.tap(tile.x, tile.y); await idle(p);
}
async function tap(p, cdp, selector) {
  const box = await p.locator(selector).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await p.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function drag(p, cdp, move) {
  const before = (await state(p)).session.positions, start = xy(before[move.id], 5);
  const from = await p.evaluate(id => window.__game.pieceCenter(id), move.id);
  const to = await p.evaluate(cell => window.__game.cellCenter(cell), (start.y + move.dy) * 5 + start.x + move.dx);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(p);
  assert.deepEqual((await state(p)).session.positions, moveGroup(before, move.id, move.dx, move.dy));
}
try {
  const entries = LEVEL_CONFIGS.filter(l => l.gridSize === 5);
  assert.deepEqual(entries.map(l => l.number), [29, 38, 47, 56, 65, 74]);
  for (const entry of entries) {
    const context = await browser.newContext({
      viewport: entry.number === 74 ? { width: 320, height: 568 } : { width: 390, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      reducedMotion: entry.number === 65 ? 'no-preference' : 'reduce',
    });
    const progress = freshProgress(); progress.completed[0].fill(true); progress.completed[1].fill(true, 0, entry.face * 9 + entry.level);
    await context.addInitScript(({ key, progress }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(progress)); }, { key: saveSlot(), progress });
    const p = await context.newPage(), cdp = await context.newCDPSession(p);
    p.on('pageerror', error => errors.push(error.message));
    p.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await p.goto(base); await idle(p); await open(p, entry);
    let current = await state(p);
    assert.deepEqual(current.session.positions, entry.positions);
    assert.equal(current.session.layoutVersion, 5);
    assert.equal(connectionCount(current.session.positions), 0);
    assert.equal(await p.locator('.puzzle-progress').getAttribute('aria-valuenow'), '0');
    const geometry = await p.evaluate(() => window.__game.puzzleGeometry());
    assert.equal(geometry.cards.length, 25); assert.equal(geometry.aspect, 2 / 3);
    for (let id = 0; id < 25; id++) {
      const point = await p.evaluate(id => window.__game.pieceCenter(id), id), viewport = p.viewportSize();
      assert.ok(point.x > 0 && point.x < viewport.width && point.y > 0 && point.y < viewport.height);
    }
    await p.screenshot({ path: `${output}/level-${entry.number}-start.png` });
    await p.tap('#picture-peek');
    await p.waitForFunction(() => document.querySelector('.overlay-card img')?.complete);
    const preview = await p.locator('.overlay-card img').evaluate(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight, ratio: img.clientWidth / img.clientHeight }));
    assert.equal(preview.src, artUrl(entry.artId)); assert.equal(preview.width, 960); assert.equal(preview.height, 1440);
    assert.ok(Math.abs(preview.ratio - 2 / 3) < .003);
    await p.tap('#close-picture'); await idle(p);
    for (const [index, move] of entry.solution.entries()) {
      await drag(p, cdp, move);
      if (entry.number === 38 && index === 2) {
        const saved = (await state(p)).session;
        await p.reload(); await idle(p); await open(p, entry);
        current = await state(p);
        assert.deepEqual(current.session.positions, saved.positions);
        assert.equal(current.session.stats.moves, 3); assert.equal(current.session.stats.previews, 1);
        assert.equal(current.session.layoutVersion, 5);
        assert.equal(current.progress.props.preview, 27);
      }
    }
    await p.waitForFunction(() => document.querySelector('#continue')?.disabled === false);
    current = await state(p);
    assert.equal(current.session.completed, true);
    const record = current.progress.records[`1:${entry.face}:4`];
    assert.equal(record.moves, entry.solution.length); assert.equal(record.gridSize, 5); assert.equal(record.layoutVersion, 5);
    assert.equal(record.previews, 1); assert.equal(record.hints, 0);
    assert.equal(await p.locator('.win-card img').getAttribute('src'), artUrl(entry.artId));
    await p.screenshot({ path: `${output}/level-${entry.number}-complete.png` });
    await tap(p, cdp, '#continue');
    await p.waitForFunction(() => window.__game.state().mode === 'chapters'); await idle(p);
    if (entry.number === 56) {
      const tile = await p.evaluate(() => window.__game.tileCenter(4));
      await p.touchscreen.tap(tile.x, tile.y); await idle(p);
      const hint = findHint(entry.positions);
      await p.tap('#hint');
      await p.waitForFunction(() => window.__game.state().progress.props.hint === 27); await idle(p);
      assert.deepEqual((await state(p)).session.positions, moveGroup(entry.positions, hint.id, hint.dx, hint.dy));
      assert.equal((await state(p)).session.stats.hints, 1);
    }
    report.push({ number: entry.number, gridSize: 5, initialLinks: 0, touchMoves: record.moves, preview: 'passed', resume: entry.number === 38 ? 'passed' : undefined, hint: entry.number === 56 ? 'passed' : undefined });
    console.log(`PASS: level ${entry.number}, 25 separate tiles, ${record.moves} touch moves, full preview and completion.`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ report, errors }, null, 2) + '\n');
} catch (error) {
  for (const context of browser.contexts()) for (const page of context.pages()) await page.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  throw error;
} finally { await browser.close(); }
