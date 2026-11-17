import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { findHint, moveGroup, solved, xy } from '../src/puzzle.js';
import { freshProgress, SAVE_KEY } from '../src/progress.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
await fs.mkdir('test-results', { recursive: true });
const errors = [];
const watch = (p) => { p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Context Lost')) errors.push(m.text()); }); };
const idle = (p) => p.waitForFunction(() => window.__game?.idle());
const state = (p) => p.evaluate(() => window.__game.state());
const noText = async (p) => assert.equal((await p.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
async function openLevel(p, level) {
  const at = await p.evaluate((i) => window.__game.tileCenter(i), level);
  await p.mouse.click(at.x, at.y); await idle(p);
  assert.equal((await state(p)).mode, 'puzzle');
}
async function drag(p, hint) {
  const s = await state(p), size = Math.sqrt(s.session.positions.length), home = xy(s.session.positions[hint.id], size);
  const from = await p.evaluate((i) => window.__game.pieceCenter(i), hint.id);
  const to = await p.evaluate((i) => window.__game.cellCenter(i), (home.y + hint.dy) * size + home.x + hint.dx);
  await p.mouse.move(from.x, from.y); await p.mouse.down(); await p.mouse.move(to.x, to.y, { steps: 10 }); await p.mouse.up(); await idle(p);
}
async function finish(p) {
  let s = await state(p);
  for (let i = 0; i < 10 && !s.session.completed; i++) { const h = findHint(s.session.positions); assert.ok(h); await drag(p, h); s = await state(p); }
  assert.ok(s.session.completed); await p.waitForSelector('#continue'); await noText(p);
  await p.click('#continue'); await idle(p);
}
try {
  const context = await browser.newContext({ viewport: { width: 540, height: 960 } });
  const p = await context.newPage(); watch(p); await p.goto(base); await idle(p); await noText(p);
  assert.deepEqual(await p.locator('#game').evaluate((e) => [e.clientWidth, e.clientHeight]), [1080, 1920]);
  const pose = await p.evaluate(() => window.__game.cubePose()); await p.waitForTimeout(250);
  assert.notDeepEqual((await p.evaluate(() => window.__game.cubePose())).quaternion, pose.quaternion);
  await p.screenshot({ path: 'test-results/cube-home.png' });
  await p.click('#next'); await idle(p); assert.equal((await state(p)).theme, 1);
  await p.click('#enter'); await idle(p); assert.equal((await state(p)).mode, 'home');
  await p.click('#next'); await idle(p); assert.equal((await state(p)).theme, 2);
  assert.equal(await p.locator('#face-progress').isVisible(), true);
  await p.click('#enter'); await idle(p); assert.equal((await state(p)).mode, 'home');
  await p.click('#next'); await idle(p); assert.equal((await state(p)).theme, 3);
  assert.equal(await p.locator('#face-progress').isVisible(), false);
  assert.equal(await p.locator('#theme-status').count(), 0);
  await p.screenshot({ path: 'test-results/cube-coming-soon.png' });
  await p.click('#enter'); assert.equal((await state(p)).mode, 'home');
  await p.click('#next'); await idle(p); assert.equal((await state(p)).theme, 0);
  const beforeEnter = await p.evaluate(() => window.__game.cubePose());
  await p.click('#enter'); await idle(p);
  assert.equal((await state(p)).mode, 'chapters'); assert.equal((await state(p)).face, 0);
  assert.equal(await p.locator('#chapter-pages button:disabled').count(), 5);
  assert.equal(await p.locator('#previous').isDisabled(), true);
  await p.screenshot({ path: 'test-results/cube-chapter.png' });
  await p.click('#back'); await idle(p);
  const returned = await p.evaluate(() => window.__game.cubePose());
  assert.equal(returned.scale, 460);
  assert.ok(returned.quaternion.every((v, i) => Math.abs(v - beforeEnter.quaternion[i]) < .025), 'home orientation is restored');
  await p.click('#enter'); await idle(p); await openLevel(p, 0); await noText(p);
  await p.screenshot({ path: 'test-results/cube-puzzle.png' });
  await p.click('#picture-peek'); await p.waitForSelector('#close-picture'); await noText(p); await p.click('#close-picture');
  let before = (await state(p)).session.positions, h = findHint(before);
  await p.click('#hint'); await idle(p); assert.deepEqual((await state(p)).session.positions, moveGroup(before, h.id, h.dx, h.dy));
  assert.deepEqual((await state(p)).progress.props, { hint: 27, preview: 27 });
  const partial = (await state(p)).session.positions;
  await p.click('#settings'); await p.click('#back'); await idle(p); await p.reload(); await idle(p);
  await p.click('#enter'); await idle(p); await openLevel(p, 0);
  assert.deepEqual((await state(p)).session.positions, partial);
  await finish(p); assert.equal((await state(p)).face, 0);
  assert.equal((await p.evaluate(() => window.__game.revealed())).length, 1);
  await p.screenshot({ path: 'test-results/cube-partial.png' });
  for (let level = 1; level < 4; level++) { await openLevel(p, level); assert.ok((await state(p)).session.art.includes(`cake-0${level + 1}`)); await finish(p); }
  assert.equal((await state(p)).face, 1, 'finishing four levels opens next face');
  assert.equal((await state(p)).progress.completed[0].slice(0, 4).every(Boolean), true);
  await p.click('#previous'); await idle(p); assert.equal((await state(p)).face, 0);
  await p.screenshot({ path: 'test-results/cube-face-complete.png' });
  await p.click('#previous'); await idle(p); assert.equal((await state(p)).face, 1, 'only unlocked faces wrap');
  await p.click('#back'); await idle(p); await p.reload(); await idle(p); await p.click('#enter'); await idle(p);
  assert.equal((await state(p)).face, 1, 'current progress face is centered on entry');
  console.log('PASS: home carousel, lock gates, restore pose, four real puzzles, drag, hint, inventory, save, per-tile reveal and face unlock.');

  // A fixture skips already-verified repetitions, then plays the final level for real.
  const almost = freshProgress(); almost.completed[0].fill(true); almost.completed[0][23] = false;
  const lateContext = await browser.newContext({ viewport: { width: 540, height: 960 } });
  await lateContext.addInitScript(({ key, progress }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(progress)); }, { key: SAVE_KEY, progress: almost });
  const late = await lateContext.newPage(); watch(late); await late.goto(base); await idle(late); await late.click('#enter'); await idle(late);
  assert.equal((await state(late)).face, 5);
  for (let face = 4; face >= 0; face--) { await late.click('#previous'); await idle(late); assert.equal((await state(late)).face, face); }
  await late.click('#previous'); await idle(late); assert.equal((await state(late)).face, 5);
  await late.evaluate(() => { window.showcases = []; document.querySelector('#cube-host').addEventListener('cube-showcase-end', e => window.showcases.push(e.detail.kind)); });
  await openLevel(late, 3); await finish(late);
  assert.equal((await state(late)).mode, 'home'); assert.equal((await state(late)).theme, 1);
  assert.deepEqual(await late.evaluate(() => window.showcases), ['theme']);
  await late.screenshot({ path: 'test-results/cube-three-unlocked.png' });
  await late.click('#enter'); await idle(late); assert.equal(await late.locator('.tile-focus').count(), 9);
  await openLevel(late, 0); assert.equal((await state(late)).session.positions.length, 16);
  const four = (await state(late)).session.positions, suggestion = findHint(four); assert.ok(suggestion);
  await drag(late, suggestion); assert.equal(new Set((await state(late)).session.positions).size, 16);
  await late.click('#settings'); await late.click('#back'); await idle(late);
  console.log('PASS: all six face directions, final-level showcase, unlock next cube, 3×3 chapter grid and 4×4 puzzle.');

  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mobile = await mobileContext.newPage(); watch(mobile); await mobile.goto(base); await idle(mobile);
  const cdp = await mobileContext.newCDPSession(mobile);
  async function touchDrag(from, to) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 9; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 9, y: from.y + (to.y - from.y) * i / 9 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(mobile);
  }
  const initialPose = await mobile.evaluate(() => window.__game.cubePose());
  await touchDrag({ x: 300, y: 400 }, { x: 90, y: 450 }); assert.equal((await state(mobile)).theme, 0);
  const turnedPose = await mobile.evaluate(() => window.__game.cubePose());
  assert.ok(turnedPose.quaternion.some((v, i) => Math.abs(v - initialPose.quaternion[i]) > .1), 'drag rotates instead of paging');
  await mobile.waitForTimeout(300);
  assert.notDeepEqual((await mobile.evaluate(() => window.__game.cubePose())).quaternion, turnedPose.quaternion, 'idle rotation resumes after drag');
  await mobile.tap('#next'); await idle(mobile); assert.equal((await state(mobile)).theme, 1);
  await mobile.tap('#previous'); await idle(mobile); assert.equal((await state(mobile)).theme, 0);
  await mobile.screenshot({ path: 'test-results/cube-mobile.png' });
  await mobile.locator('#enter').tap(); await idle(mobile);
  const chapterPose = await mobile.evaluate(() => window.__game.cubePose());
  await touchDrag({ x: 300, y: 400 }, { x: 90, y: 400 });
  assert.equal((await state(mobile)).mode, 'chapters'); assert.equal((await state(mobile)).face, 0);
  assert.deepEqual(await mobile.evaluate(() => window.__game.cubePose()), chapterPose, 'chapter drags neither rotate nor page');
  const tile = await mobile.evaluate(() => window.__game.tileCenter(0)); await mobile.touchscreen.tap(tile.x, tile.y); await idle(mobile);
  const m = (await state(mobile)).session.positions, mh = findHint(m), coord = xy(m[mh.id]);
  const from = await mobile.evaluate((i) => window.__game.pieceCenter(i), mh.id);
  const to = await mobile.evaluate((i) => window.__game.cellCenter(i), (coord.y + mh.dy) * 3 + coord.x + mh.dx);
  await touchDrag(from, to); assert.deepEqual((await state(mobile)).session.positions, moveGroup(m, mh.id, mh.dx, mh.dy));
  await mobile.setViewportSize({ width: 320, height: 568 });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), true);
  const bounds = await mobile.locator('#game').boundingBox(); assert.ok(Math.abs(bounds.width / bounds.height - 9 / 16) < .0001);
  await noText(mobile); await mobile.screenshot({ path: 'test-results/cube-mobile-puzzle.png' });
  assert.deepEqual(errors, [], 'no browser errors');
  console.log('PASS: mobile touch orbit and puzzle drag, idle rotation resumes, arrow-only chapter navigation, portrait aspect ratio, no visible text or browser errors.');
} finally { await browser.close(); }
