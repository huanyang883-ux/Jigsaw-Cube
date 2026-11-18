import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LEVEL_CONFIGS, freshProgress, saveSlot, levelArt } from '../src/progress.js';
import { moveGroup, connectionCount, xy } from '../src/puzzle.js';

const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const output = 'test-results/continents';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const p = await context.newPage(), cdp = await context.newCDPSession(p), errors = [], report = [];
const state = () => p.evaluate(() => window.__game.state());
const idle = () => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
const trial = saveSlot('?trial=continents'), normal = saveSlot();
p.on('pageerror', e => errors.push(e.message));
p.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
async function tap(selector) {
  const box = await p.locator(selector).boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
  await p.waitForTimeout(60); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
async function open(l) {
  const point = await p.evaluate(level => window.__game.tileCenter(level), l.level ?? 8);
  await p.touchscreen.tap(point.x, point.y);
  await p.waitForFunction(() => window.__game.state().mode === 'puzzle'); await idle();
}
async function drag(move) {
  const before = (await state()).session.positions, n = Math.sqrt(before.length), start = xy(before[move.id], n);
  const from = await p.evaluate(id => window.__game.pieceCenter(id), move.id);
  const to = await p.evaluate(cell => window.__game.cellCenter(cell), (start.y + move.dy) * n + start.x + move.dx);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle();
  assert.deepEqual((await state()).session.positions, moveGroup(before, move.id, move.dx, move.dy));
}
async function finish() {
  await p.waitForFunction(() => document.querySelector('#continue')?.disabled === false);
  assert.equal((await state()).session.completed, true);
  const ratio = await p.locator('.win-card img').evaluate(img => img.clientWidth / img.clientHeight);
  assert.ok(Math.abs(ratio - 2 / 3) < .003);
  await tap('#continue'); await p.waitForFunction(() => window.__game.state().mode !== 'puzzle'); await idle();
}

async function play(l, { small = false, resume = false, hint = false } = {}) {
  await p.setViewportSize(small ? { width: 320, height: 568 } : { width: 390, height: 844 });
  await p.waitForTimeout(150); await open(l);
  const initial = await state(); assert.deepEqual(initial.session.positions, l.positions);
  assert.equal(initial.face, l.face); assert.equal(initial.session.level, l.level);
  assert.equal(initial.session.art, levelArt(2, l.face, l.level));
  assert.equal(connectionCount(initial.session.positions), 0);
  const geometry = await p.evaluate(() => window.__game.puzzleGeometry());
  assert.equal(geometry.cards.length, l.gridSize ** 2); assert.equal(geometry.aspect, 2 / 3);
  assert.equal(await p.locator('.puzzle-progress').getAttribute('aria-valuenow'), '0');
  const frame = await p.locator('.puzzle-frame').boundingBox(), viewport = p.viewportSize();
  assert.ok(frame.x >= 0 && frame.y >= 0 && frame.x + frame.width <= viewport.width + .5 && frame.y + frame.height <= viewport.height + .5);
  if ([0, 6, 10, 15].includes(l.level)) await p.screenshot({ path: `${output}/${l.artId}-start.png` });
  if (!l.placeholder || hint) {
    assert.equal(await p.locator('#picture-peek').isEnabled(), true, 'preview fixture has enough props');
    await tap('#picture-peek'); await p.locator('#close-picture').waitFor({ state: 'visible' });
    await p.waitForFunction(() => document.querySelector('.overlay-card img')?.complete);
    const image = await p.locator('.overlay-card img').evaluate(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight }));
    assert.deepEqual(image, { src: levelArt(2, l.face, l.level), width: 960, height: 1440 });
    await tap('#close-picture'); await idle();
  }
  for (const [i, move] of l.solution.entries()) {
    if (hint && i === 0) {
      await tap('#hint'); await p.waitForFunction(() => window.__game.state().session.stats.moves === 1); await idle();
      assert.deepEqual((await state()).session.positions, moveGroup(l.positions, move.id, move.dx, move.dy));
      assert.equal((await state()).session.stats.hints, 1);
    } else await drag(move);
    if (resume && i === 2) {
      const saved = (await state()).session;
      await p.reload(); await idle(); await tap('#enter'); await idle(); await open(l);
      assert.deepEqual((await state()).session.positions, saved.positions);
      assert.deepEqual((await state()).session.stats.moves, saved.stats.moves);
      assert.equal((await state()).session.layoutVersion, 6);
    }
  }
  await p.waitForFunction(() => document.querySelector('#continue')?.disabled === false);
  const record = (await state()).progress.records[`2:${l.face}:${l.level}`];
  assert.equal(record.gridSize, l.gridSize); assert.equal(record.moves, l.solution.length); assert.equal(record.layoutVersion, 6);
  await finish(); report.push({ number: l.number, image: l.artId, gridSize: l.gridSize, moves: record.moves, placeholder: l.placeholder });
  console.log(`PASS ${l.number}: ${l.artId}, ${l.gridSize}x${l.gridSize}, ${record.moves} touch moves.`);
}

try {
  const progress = freshProgress(); progress.completed[0].fill(true); progress.completed[1].fill(true, 0, 53);
  await context.addInitScript(({ trial, normal, progress }) => {
    const pending = sessionStorage.getItem('puzzle:test:continents:seed');
    if (pending) { localStorage.setItem(trial, pending); sessionStorage.removeItem('puzzle:test:continents:seed'); }
    if (!localStorage.getItem(trial)) localStorage.setItem(trial, JSON.stringify(progress));
    if (!localStorage.getItem(normal)) localStorage.setItem(normal, '{"keep":"normal-save"}');
  }, { trial, normal, progress });
  await p.goto(`${base}/?trial=continents`); await idle();
  assert.equal((await state()).theme, 1); await tap('#enter'); await idle();
  const lastAnimal = LEVEL_CONFIGS.find(l => l.number === 78); await open(lastAnimal);
  for (const move of lastAnimal.solution) await drag(move); await finish();
  assert.equal((await state()).theme, 2); assert.equal((await state()).mode, 'home');
  assert.equal(await p.locator('#theme-pages button').count(), 4);
  assert.equal(await p.locator('#theme-medallion circle').count(), 1);
  await p.screenshot({ path: `${output}/fourth-home.png` });
  await tap('#enter'); await idle(); assert.equal(await p.locator('#chapter-targets button').count(), 16);
  const chaptersWithArt = [
    { smallLevels: [6, 15], unlocks: 'south-america' },
    { smallLevels: [3, 11, 15], unlocks: 'europe' },
    { smallLevels: [2, 10, 15], unlocks: 'asia' },
  ];
  for (const [face, { smallLevels, unlocks }] of chaptersWithArt.entries()) {
    if (face > 0) {
      // Replenish the test fixture's inventory to preview every image.
      const chapterProgress = (await state()).progress;
      chapterProgress.props.preview = freshProgress().props.preview;
      await p.evaluate(value => sessionStorage.setItem('puzzle:test:continents:seed', JSON.stringify(value)), chapterProgress);
      await p.reload(); await idle(); await tap('#enter'); await idle();
    }
    for (const l of LEVEL_CONFIGS.filter(l => l.theme === 2 && l.face === face)) {
      await play(l, { small: smallLevels.includes(l.level), resume: l.level === 10, hint: l.level === 15 });
    }
    assert.equal((await state()).face, face + 1, `all sixteen levels unlock ${unlocks}`);
    await p.screenshot({ path: `${output}/${unlocks}-unlocked.png` });
  }
  for (let face = chaptersWithArt.length; face < 6; face++) {
    const seeded = freshProgress(); seeded.completed[0].fill(true); seeded.completed[1].fill(true); seeded.completed[2].fill(true, 0, face * 16);
    // Apply on the next document, after the old page's pagehide save has run.
    await p.evaluate(value => sessionStorage.setItem('puzzle:test:continents:seed', JSON.stringify(value)), seeded);
    await p.reload(); await idle(); await tap('#enter'); await idle();
    const l = LEVEL_CONFIGS.filter(l => l.theme === 2 && l.face === face && l.gridSize === 7).at(-1);
    const firstPlaceholder = face === chaptersWithArt.length;
    await play(l, { small: firstPlaceholder, resume: firstPlaceholder, hint: firstPlaceholder });
  }
  await tap('#back'); await idle(); await tap('#settings'); await tap('#complete-all'); await idle();
  assert.equal((await state()).progress.completed.flat().filter(Boolean).length, 174);
  assert.equal((await p.evaluate(() => window.__game.revealed())).length, 96);
  await p.screenshot({ path: `${output}/fourth-completed.png` });
  await tap('#theme-pages [data-theme="3"]'); await idle();
  assert.match(await p.locator('#theme-pages [data-theme="3"]').getAttribute('aria-label'), /敬请期待/);
  assert.equal(await p.locator('#face-progress').isVisible(), false);
  await p.waitForFunction(() => getComputedStyle(document.querySelector('#theme-medallion')).color === 'rgb(144, 119, 171)');
  await tap('#enter'); await idle(); assert.equal((await state()).mode, 'home');
  await p.screenshot({ path: `${output}/fifth-coming-soon.png` });
  assert.equal(await p.evaluate(key => localStorage.getItem(key), normal), '{"keep":"normal-save"}');
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ levels: report, errors }, null, 2) + '\n');
  console.log('PASS: North America 16/16, South America 16/16, Europe 16/16, three 7x7 placeholder chapters, preview, hints, resume, progression, covers, fifth cube and save isolation.');
} catch (error) {
  await p.screenshot({ path: `${output}/failure.png` }).catch(() => {});
  console.error(JSON.stringify({ state: await state().catch(() => null), errors })); throw error;
} finally { await browser.close(); }
