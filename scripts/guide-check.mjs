import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { guideMove } from '../src/guide-state.js';
import { freshProgress, faceSize, markComplete, saveSlot } from '../src/progress.js';
import { moveGroup, xy } from '../src/puzzle.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
await fs.mkdir('test-results', { recursive: true });
const errors = [];
const idle = (p) => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
const state = (p) => p.evaluate(() => window.__game.state());
const shown = (p, kind) => p.waitForSelector(`#hand-guide[data-guide="${kind}"]:not([hidden])`);
async function makePage(progress) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (progress) await c.addInitScript(({ key, progress }) => {
    if (sessionStorage.getItem('guide-seeded')) return;
    localStorage.setItem(key, JSON.stringify(progress)); sessionStorage.setItem('guide-seeded', 'true');
  }, { key: saveSlot(new URL(base).search), progress });
  const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await idle(p);
  return { c, p, cdp: await c.newCDPSession(p) };
}
const handPoint = (p) => p.evaluate(() => {
  const stage = document.querySelector('#game').getBoundingClientRect(), hand = document.querySelector('#hand-guide');
  return { x: stage.left + parseFloat(hand.style.left) * stage.width / 1080, y: stage.top + parseFloat(hand.style.top) * stage.height / 1920 };
});
async function assertHandAt(p, point) {
  const hand = await handPoint(p);
  assert.ok(Math.hypot(point.x - hand.x, point.y - hand.y) < 1, 'hand points at the expected target');
}
async function drag({ cdp, p }, from, to) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(p);
  // Let Chromium finish the touch gesture before synthesizing the next tap.
  await p.waitForTimeout(250);
}
async function open(p, level = 0) {
  await p.waitForFunction(() => window.__game.state().mode === 'chapters');
  const point = await p.evaluate((i) => window.__game.tileCenter(i), level);
  await p.touchscreen.tap(point.x, point.y);
  await p.waitForFunction(() => window.__game.state().mode === 'puzzle');
}
async function puzzleDrag(ctx) {
  const before = (await state(ctx.p)).session.positions, h = guideMove(before), n = Math.sqrt(before.length), at = xy(before[h.id], n);
  const from = await ctx.p.evaluate((id) => window.__game.pieceCenter(id), h.id);
  const to = await ctx.p.evaluate((cell) => window.__game.cellCenter(cell), (at.y + h.dy) * n + at.x + h.dx);
  await drag(ctx, from, to);
  assert.deepEqual((await state(ctx.p)).session.positions, moveGroup(before, h.id, h.dx, h.dy));
}
try {
  const ctx = await makePage(), { p } = ctx;
  await p.waitForTimeout(2200); assert.ok(await p.locator('#hand-guide').isHidden());
  await shown(p, 'enterChapter'); await p.waitForTimeout(350);
  await p.screenshot({ path: 'test-results/guide-enter.png' });
  await shown(p, 'rotateCube'); await p.waitForTimeout(500);
  await p.screenshot({ path: 'test-results/guide-orbit.png' });
  assert.ok(Object.values((await state(p)).progress.guides).every((value) => value === false), 'showing a guide does not complete it');
  await p.tap('#settings'); await p.tap('#sound'); await p.tap('#settings');
  assert.ok(await p.locator('#hand-guide').isHidden());
  await p.waitForTimeout(1700); assert.ok(await p.locator('#hand-guide').isHidden(), 'any real input restarts the idle timer');
  await drag(ctx, { x: 180, y: 410 }, { x: 250, y: 450 });
  assert.ok((await state(p)).progress.guides.rotateCube);
  await shown(p, 'enterChapter');
  await p.tap('#enter'); await idle(p); assert.ok((await state(p)).progress.guides.enterChapter);
  await p.waitForTimeout(4000); assert.ok(await p.locator('#hand-guide').isHidden());
  await shown(p, 'enterLevel'); await p.waitForTimeout(350);
  const tile = await p.evaluate(() => window.__game.tileCenter(0));
  await assertHandAt(p, tile);
  assert.equal(await p.locator('#hand-guide').evaluate((e) => getComputedStyle(e).pointerEvents), 'none');
  await p.screenshot({ path: 'test-results/guide-level.png' });
  await open(p); await p.waitForFunction(() => !!window.__game.entrance());
  assert.ok(await p.locator('#hand-guide').isHidden(), 'no hand overlays the entrance');
  await idle(p); await shown(p, 'dragPuzzle'); await p.waitForTimeout(600);
  await p.screenshot({ path: 'test-results/guide-puzzle.png' });
  const before = (await state(p)).session.positions;
  await p.waitForTimeout(1800);
  assert.deepEqual((await state(p)).session.positions, before, 'hand animation never performs moves');
  assert.deepEqual((await state(p)).progress.props, { hint: 28, preview: 28 });
  const tap = await p.evaluate(() => window.__game.pieceCenter(0));
  await p.touchscreen.tap(tap.x, tap.y); await idle(p);
  assert.equal((await state(p)).progress.guides.dragPuzzle, false, 'a tap alone does not prove dragging');
  await puzzleDrag(ctx);
  assert.ok(Object.values((await state(p)).progress.guides).every(Boolean));
  assert.ok(await p.locator('#hand-guide').isHidden());
  await p.reload(); await idle(p); await p.waitForTimeout(5400);
  assert.ok(await p.locator('#hand-guide').isHidden(), 'learned home skills survive reload');
  await p.tap('#enter'); await idle(p); await shown(p, 'enterLevel');
  await assertHandAt(p, await p.evaluate(() => window.__game.tileCenter(0)));
  await p.keyboard.press('Shift');
  assert.ok(await p.locator('#hand-guide').isHidden(), 'input hides the current reminder');
  await p.waitForTimeout(4500); assert.ok(await p.locator('#hand-guide').isHidden(), 'input restarts the full 5s chapter delay');
  await shown(p, 'enterLevel');
  await open(p, 1); await idle(p); await p.waitForTimeout(800);
  assert.ok(await p.locator('#hand-guide').isHidden(), 'later levels do not repeat learned dragging');
  assert.equal((await p.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
  await p.tap('#settings'); await p.tap('#back'); await idle(p); await shown(p, 'enterLevel');
  await assertHandAt(p, await p.evaluate(() => window.__game.tileCenter(0)));
  await ctx.c.close();
  console.log('PASS: home timing, repeated 5s chapter reminders after input/reload/return, correct targets, no entrance overlap, real touch through hand, learned puzzle dismissal, no prop cost or visible words.');

  for (const theme of [0, 1, 2]) {
    const progress = freshProgress(), latestFace = 3;
    for (let prior = 0; prior < theme; prior++) progress.completed[prior].fill(true);
    progress.completed[theme].fill(true, 0, latestFace * faceSize(theme));
    for (const level of [0, 1, faceSize(theme) - 1]) markComplete(progress, theme, latestFace, level);
    for (const action of Object.keys(progress.guides)) progress.guides[action] = true;
    const chapter = await makePage(progress), p = chapter.p;
    await p.tap('#enter'); await idle(p);
    assert.equal((await state(p)).face, latestFace);
    await p.tap('#chapter-pages [data-face="0"]'); await idle(p);
    await p.waitForTimeout(4500); assert.ok(await p.locator('#hand-guide').isHidden());
    await shown(p, 'switchFace');
    const pageButton = p.locator(`#chapter-pages [data-face="${latestFace}"]`);
    const bounds = await pageButton.boundingBox();
    await assertHandAt(p, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    await p.waitForTimeout(350); await p.screenshot({ path: `test-results/guide-switch-face-${theme}.png` });
    // Choosing a different completed page must not permanently dismiss the guide.
    await p.tap('#chapter-pages [data-face="1"]'); await idle(p); await shown(p, 'switchFace');
    await assertHandAt(p, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
    await pageButton.tap(); await idle(p);
    assert.equal((await state(p)).face, latestFace);
    assert.ok(await p.locator('#hand-guide').isHidden());
    await p.waitForTimeout(4500); assert.ok(await p.locator('#hand-guide').isHidden());
    await shown(p, 'enterLevel');
    const point = await p.evaluate(() => window.__game.tileCenter(2));
    await assertHandAt(p, point);
    await p.touchscreen.tap(point.x, point.y);
    await p.waitForFunction(() => window.__game.state().mode === 'puzzle'); await idle(p);
    assert.equal((await state(p)).session.level, 2);
    await chapter.c.close();
  }
  console.log('PASS: 2x2/3x3/4x4 completed faces point directly at the latest page, then the first unfinished level, even with all skills learned.');

  const completed = freshProgress();
  for (const levels of completed.completed) levels.fill(true);
  for (const action of Object.keys(completed.guides)) completed.guides[action] = true;
  const done = await makePage(completed);
  for (const theme of [2, 1, 0]) {
    await done.p.tap(`#theme-pages [data-theme="${theme}"]`); await idle(done.p);
    await done.p.tap('#enter'); await idle(done.p);
    await done.p.tap('#chapter-pages [data-face="0"]'); await idle(done.p);
    await done.p.waitForTimeout(5500);
    assert.ok(await done.p.locator('#hand-guide').isHidden(), 'completed cubes do not prompt page switching or replay');
    await done.p.tap('#back'); await idle(done.p);
  }
  await done.c.close();
  console.log('PASS: completed cubes have no chapter reminders.');

  const early = await makePage();
  await drag(early, { x: 160, y: 415 }, { x: 250, y: 450 });
  await early.p.tap('#enter'); await idle(early.p); await open(early.p); await idle(early.p);
  await puzzleDrag(early);
  assert.ok(Object.values((await state(early.p)).progress.guides).every(Boolean), 'actions before reminders still mark every skill');
  await early.p.reload(); await idle(early.p); await early.p.waitForTimeout(5400);
  assert.ok(await early.p.locator('#hand-guide').isHidden()); await early.c.close();

  const locked = await makePage(); await locked.p.tap('#next'); await idle(locked.p);
  await locked.p.waitForTimeout(3300); assert.ok(await locked.p.locator('#hand-guide').isHidden(), 'locked themes never get an enter prompt');
  await shown(locked.p, 'rotateCube'); await locked.c.close();
  assert.deepEqual(errors, []);
  console.log('PASS: early actions suppress unseen guides, locked-theme handling, no browser errors.');
} finally { await browser.close(); }
