import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { freshProgress, SAVE_KEY } from '../src/progress.js';
import { findHint, moveGroup } from '../src/puzzle.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
await fs.mkdir('test-results', { recursive: true });
const errors = [];
const idle = (p) => p.waitForFunction(() => window.__game?.idle());
const state = (p) => p.evaluate(() => window.__game.state());
async function page(progress, reducedMotion = 'no-preference') {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion });
  if (progress) await c.addInitScript(({ key, progress }) => { if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(progress)); }, { key: SAVE_KEY, progress });
  const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await idle(p);
  return { c, p };
}
async function open(p, level = 0, wait = true) {
  const at = await p.evaluate((i) => window.__game.tileCenter(i), level);
  await p.touchscreen.tap(at.x, at.y);
  if (wait) await idle(p);
}
async function enter(p) { await p.tap('#enter'); await idle(p); }
async function counts(p, expected) {
  assert.deepEqual((await state(p)).progress.props, expected);
  assert.equal(await p.locator('#hint-count').innerText(), String(expected.hint));
  assert.equal(await p.locator('#preview-count').innerText(), String(expected.preview));
}

try {
  // Upgrade an actual old v2 save while preserving an unlocked portrait chapter.
  const old = freshProgress(); delete old.props; old.completed[0].fill(true, 0, 4);
  const { c, p } = await page(old); await enter(p); await open(p, 0, false);
  await p.waitForFunction(() => !!window.__game.entrance());
  await p.evaluate(() => {
    window.entranceFrames = [];
    const capture = () => {
      const animation = window.__game.entrance(), geometry = window.__game.puzzleGeometry();
      window.entranceFrames.push({ elapsed: animation?.elapsed ?? 3500, busy: window.__game.state().busy, poses: geometry.cards.map((c) => ({ position: c.position, rotation: c.rotation })) });
      if (animation) requestAnimationFrame(capture);
    };
    capture();
  });
  await counts(p, { hint: 28, preview: 28 });
  assert.ok(await p.locator('#hint').isDisabled()); assert.ok(await p.locator('#picture-peek').isDisabled());
  await p.screenshot({ path: 'test-results/entrance-backs.png' });
  const before = (await state(p)).session.positions;
  await p.evaluate(() => { document.querySelector('#hint').click(); document.querySelector('#picture-peek').click(); });
  await p.locator('#puzzle-board').focus(); await p.keyboard.press('Space'); await p.keyboard.press('ArrowRight'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => window.__game.entrance()?.elapsed >= 1250);
  await p.screenshot({ path: 'test-results/entrance-quake.png' });
  await p.waitForFunction(() => window.__game.entrance()?.elapsed >= 2350);
  await p.screenshot({ path: 'test-results/entrance-flips.png' });
  await idle(p);
  await p.screenshot({ path: 'test-results/entrance-ready.png' });
  const frames = await p.evaluate(() => window.entranceFrames);
  assert.ok(frames.some((f) => f.elapsed < 400), 'capture includes the stationary backs');
  for (const f of frames.filter((f) => f.elapsed < 490)) assert.ok(f.poses.every((c) => Math.abs(Math.abs(c.rotation[1]) - Math.PI) < 1e-6 && c.position[2] === 0));
  const quake = frames.filter((f) => f.elapsed > 1100 && f.elapsed < 1490);
  assert.ok(quake.length && quake.some((f) => f.poses.some((c) => Math.abs(c.rotation[0]) > .02)), 'individual backs visibly tremble before any reveal');
  assert.ok(quake.every((f) => f.poses.every((c) => Math.cos(c.rotation[1]) < -.99)));
  assert.ok(frames.some((f) => f.elapsed > 1800 && f.elapsed < 3200 && f.poses.some((c) => Math.cos(c.rotation[1]) > .9) && f.poses.some((c) => Math.cos(c.rotation[1]) < -.9)), 'random reveal shows faces and backs together');
  assert.ok(frames.filter((f) => f.elapsed < 3490).every((f) => f.busy));
  assert.ok((await p.evaluate(() => window.__game.puzzleGeometry())).cards.every((c) => c.rotation.every((v) => v === 0) && c.position[2] === 0));
  assert.deepEqual((await state(p)).session.positions, before, 'entrance input cannot move pieces');
  await counts(p, { hint: 28, preview: 28 });
  assert.equal(await p.locator('#undo, #restart, #level-thumb').count(), 0);
  assert.equal(await p.locator('.puzzle-tools button').count(), 2);
  assert.equal(await p.locator('.puzzle-tools img').count(), 0);
  const hintBox = await p.locator('#hint').boundingBox(), previewBox = await p.locator('#picture-peek').boundingBox();
  assert.equal(hintBox.y, previewBox.y);
  // Fast repeated requests must spend just once, even before the DOM is repainted.
  await p.evaluate(() => { for (let i = 0; i < 5; i++) document.querySelector('#picture-peek').click(); });
  await p.waitForSelector('#close-picture'); await counts(p, { hint: 28, preview: 27 });
  await p.tap('#close-picture');
  const h = findHint(before);
  await p.evaluate(() => { for (let i = 0; i < 5; i++) document.querySelector('#hint').click(); });
  await idle(p); await counts(p, { hint: 27, preview: 27 });
  assert.deepEqual((await state(p)).session.positions, moveGroup(before, h.id, h.dx, h.dy));
  await p.reload(); await idle(p); await enter(p); await open(p);
  await counts(p, { hint: 27, preview: 27 });
  await p.tap('#settings'); await p.tap('#back'); await idle(p); await open(p, 1); await counts(p, { hint: 27, preview: 27 });
  await c.close();
  console.log('PASS: 0.5s backs, 1s quake, 2s scattered reveal; input lock; old-save migration; rapid-click protection; shared, persistent inventory.');

  const scarce = freshProgress(); scarce.completed[0].fill(true); scarce.props = { hint: 1, preview: 1 };
  const second = await page(scarce); const q = second.p;
  assert.equal((await q.evaluate(()=>window.__game.state())).theme, 1);
  await enter(q); await open(q, 0, false);
  await q.waitForFunction(() => window.__game.entrance()?.cards.length === 16);
  await q.waitForFunction(() => window.__game.entrance()?.elapsed >= 2350);
  await q.screenshot({ path: 'test-results/entrance-animal-flips.png' }); await idle(q);
  await q.tap('#picture-peek'); await q.waitForSelector('#close-picture'); await q.tap('#close-picture');
  await q.tap('#hint'); await idle(q); await counts(q, { hint: 0, preview: 0 });
  assert.ok(await q.locator('#picture-peek').isDisabled()); assert.ok(await q.locator('#hint').isDisabled());
  const exhausted = (await state(q)).session.positions;
  await q.evaluate(() => { for (const selector of ['#hint', '#picture-peek']) document.querySelector(selector).dispatchEvent(new Event('click')); });
  await counts(q, { hint: 0, preview: 0 }); assert.deepEqual((await state(q)).session.positions, exhausted);
  assert.ok(await q.locator('#overlay').isHidden());
  await q.reload(); await idle(q); await enter(q); await open(q);
  await counts(q, { hint: 0, preview: 0 });
  await q.screenshot({ path: 'test-results/props-empty.png' }); await second.c.close();

  const reduced = await page(null, 'reduce'); await enter(reduced.p);
  const started = Date.now(); await open(reduced.p); assert.ok(Date.now() - started < 1500, 'reduced motion avoids shaking and the long entrance');
  await counts(reduced.p, { hint: 28, preview: 28 }); await reduced.c.close();
  assert.deepEqual(errors, []);
  console.log('PASS: 16-piece entrance, last-item consumption, exhausted props stay disabled after reload, reduced motion, no browser errors.');
} finally { await browser.close(); }
