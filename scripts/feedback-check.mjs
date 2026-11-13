import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { freshProgress, SAVE_KEY } from '../src/progress.js';
import { findHint, moveGroup, groupFor, xy, linked } from '../src/puzzle.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const errors = [];
const idle = (p) => p.waitForFunction(() => window.__game?.idle());
const state = (p) => p.evaluate(() => window.__game.state());
await fs.mkdir('test-results', { recursive: true });
async function makePage(progress, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion });
  if (progress) await context.addInitScript(({ key, progress }) => localStorage.setItem(key, JSON.stringify(progress)), { key: SAVE_KEY, progress });
  const p = await context.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Context Lost')) errors.push(message.text()); });
  await p.goto(base); await idle(p); await p.tap('#enter'); await idle(p);
  const point = await p.evaluate(() => window.__game.tileCenter(0));
  await p.touchscreen.tap(point.x, point.y); await idle(p);
  return p;
}
async function drag(p, move) {
  const positions = (await state(p)).session.positions, n = Math.sqrt(positions.length), at = xy(positions[move.id], n);
  const from = await p.evaluate((id) => window.__game.pieceCenter(id), move.id);
  const to = await p.evaluate((cell) => window.__game.cellCenter(cell), (at.y + move.dy) * n + at.x + move.dx);
  const cdp = await p.context().newCDPSession(p);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach(); await idle(p);
}
async function capture(p) {
  await p.evaluate(() => {
    window.feedbackFrames = []; window.captureFeedback = true;
    const tick = () => {
      const state = window.__game.state(), overlay = document.querySelector('#overlay'), geometry = window.__game.puzzleGeometry();
      window.feedbackFrames.push({ time: performance.now(), complete: state.session?.completed, idle: window.__game.idle(), hidden: overlay.hidden,
        opacity: Number(getComputedStyle(overlay).opacity), disabled: document.querySelector('#continue')?.disabled,
        flash: geometry?.cards.map((card) => card.flash),
        cards: geometry?.cards.map(({ position, scale }) => ({ position, scale })), aspect: geometry?.aspect });
      if (window.captureFeedback) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
try {
  const p = await makePage();
  const before = (await state(p)).session.positions, move = findHint(before);
  const joined = moveGroup(before, move.id, move.dx, move.dy);
  const connected = groupFor(joined, move.id).sort((a, b) => a - b), n = Math.sqrt(joined.length);
  await capture(p); await drag(p, move);
  await p.waitForFunction(() => window.__game.puzzleGeometry().cards.some((card) => card.flash > .18));
  await p.screenshot({ path: 'test-results/merge-white-flash.png' });
  await p.waitForFunction(() => window.__game.puzzleGeometry().cards.every((card) => card.flash === 0));
  const mergeFrames = await p.evaluate(() => { window.captureFeedback = false; return window.feedbackFrames; });
  const flashes = mergeFrames.filter((f) => f.flash.some((alpha) => alpha > .001));
  assert.ok(flashes.length > 4, 'merge feedback is visible over multiple frames');
  for (const frame of flashes) {
    assert.deepEqual(frame.flash.flatMap((alpha, id) => alpha > .001 ? [id] : []), connected, 'only the newly connected group flashes');
    assert.ok(connected.every((id) => Math.abs(frame.flash[id] - frame.flash[connected[0]]) < .00001), 'the whole group flashes in sync');
    for (const [id, card] of frame.cards.entries()) {
      const expectedScale = connected.includes(id) ? 1 + .03 * frame.flash[id] / .24 : 1;
      assert.ok(Math.abs(card.scale[0] - expectedScale) < 1e-8 && Math.abs(card.scale[1] - expectedScale) < 1e-8, 'only the joined group scales in sync with the white flash');
      for (const step of [1, n]) {
        const next = id + step;
        if (next >= joined.length || step === 1 && id % n === n - 1 || !linked(joined, id, next)) continue;
        const other = frame.cards[next], axis = step === 1 ? 0 : 1;
        const expectedDistance = (step === 1 ? 1 : -1 / frame.aspect) * card.scale[axis];
        assert.ok(Math.abs(other.position[axis] - card.position[axis] - expectedDistance) < 1e-6, 'joined edges stay seamless throughout the pulse');
      }
    }
  }
  const pulse = flashes.map((frame) => frame.flash[connected[0]]), peak = Math.max(...pulse), peakIndex = pulse.indexOf(peak);
  assert.ok(peak > .2 && peak <= .24, 'subtle white overlay');
  const scalePeak = Math.max(...flashes.map((frame) => frame.cards[connected[0]].scale[0]));
  assert.ok(scalePeak > 1.025 && scalePeak <= 1.03, 'small, visible expansion capped at three percent');
  assert.ok(pulse.slice(1, peakIndex + 1).every((alpha, i) => alpha >= pulse[i] - .001));
  assert.ok(pulse.slice(peakIndex + 1).every((alpha, i) => alpha <= pulse[peakIndex + i] + .001), 'one rise and one fade');
  const flashMs = flashes.at(-1).time - flashes[0].time;
  assert.ok(flashMs > 480 && flashMs < 700, `shorter, synchronized light and scale pulse: ${flashMs} ms`);
  assert.equal(await p.evaluate(() => window.__game.celebration()), 0, 'ordinary merges never emit fireworks');
  assert.ok((await p.evaluate(() => window.__game.puzzleGeometry())).cards.every((card) => card.flash === 0 && card.scale.every((v) => v === 1)), 'the whole board returns to its original scale');
  assert.ok(await p.locator('#overlay').isHidden());
  await p.screenshot({ path: 'test-results/merge-after-flash.png' });

  await capture(p);
  for (let i = 0; i < 9 && !(await state(p)).session.completed; i++) await drag(p, findHint((await state(p)).session.positions));
  assert.ok((await state(p)).session.completed);
  assert.equal(await p.evaluate(() => window.__game.celebration()), 90, 'completion restores the original celebration particles');
  await p.waitForFunction(() => window.__game.puzzleGeometry().cards.some((card) => card.flash > .001));
  await p.waitForFunction(() => window.__game.puzzleGeometry().cards.every((card) => card.flash === 0));
  const poses = await p.evaluate(() => window.__game.puzzleGeometry().cards.map(({ position, rotation, scale }) => ({ position, rotation, scale })));
  await p.waitForTimeout(350);
  assert.ok(await p.locator('#overlay').isHidden(), 'finished picture remains visible before settlement');
  assert.deepEqual(await p.evaluate(() => window.__game.puzzleGeometry().cards.map(({ position, rotation, scale }) => ({ position, rotation, scale }))), poses, 'completed picture stays still after the merge pulse');
  await p.screenshot({ path: 'test-results/win-hold.png' });
  await p.waitForSelector('#continue');
  assert.ok(await p.locator('#continue').isDisabled(), 'settlement cannot be dismissed during its entrance');
  await p.waitForTimeout(250);
  const alpha = await p.locator('#overlay').evaluate((el) => Number(getComputedStyle(el).opacity));
  assert.ok(alpha > 0 && alpha < 1, 'settlement fades in rather than appearing instantly');
  await p.screenshot({ path: 'test-results/win-entering.png' });
  await p.waitForFunction(() => document.querySelector('#continue')?.disabled === false);
  const frames = await p.evaluate(() => { window.captureFeedback = false; return window.feedbackFrames; });
  const held = frames.find((f) => f.complete && f.idle && f.hidden);
  const opened = frames.find((f) => f.complete && !f.hidden);
  const ready = frames.find((f) => f.complete && !f.hidden && f.disabled === false) ?? { time: await p.evaluate(() => performance.now()) };
  assert.ok(opened.time - held.time >= 1950 && opened.time - held.time < 2350, `two-second hold: ${opened.time - held.time} ms`);
  assert.ok(ready.time - opened.time >= 950 && ready.time - opened.time < 1300, `one-second entrance: ${ready.time - opened.time} ms`);
  await fs.writeFile('test-results/feedback-timing.json', JSON.stringify({ holdMs: opened.time - held.time, entranceMs: ready.time - opened.time, flashMs, flashPeak: peak, scalePeak }, null, 2));
  await p.screenshot({ path: 'test-results/win-settled.png' });
  await p.tap('#continue'); await idle(p);
  assert.equal((await state(p)).mode, 'chapters');
  assert.equal((await state(p)).progress.completed[0][0], true);
  await p.context().close();

  const interrupted = await makePage();
  const firstMove = findHint((await state(interrupted)).session.positions);
  await drag(interrupted, firstMove);
  await interrupted.waitForFunction(() => window.__game.puzzleGeometry().cards.some((card) => card.scale[0] > 1.01));
  const savedPositions = (await state(interrupted)).session.positions;
  const from = await interrupted.evaluate((id) => window.__game.pieceCenter(id), firstMove.id);
  const cdp = await interrupted.context().newCDPSession(interrupted);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  assert.ok((await interrupted.evaluate(() => window.__game.puzzleGeometry())).cards.every((card) => card.flash === 0 && card.scale.every((v) => v === 1)), 'regrabbing immediately cancels the pulse without blocking input');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await cdp.detach(); await idle(interrupted);
  assert.deepEqual((await state(interrupted)).session.positions, savedPositions, 'interrupting the pulse preserves piece positions');
  const nextMove = findHint(savedPositions);
  await drag(interrupted, nextMove);
  assert.deepEqual((await state(interrupted)).session.positions, moveGroup(savedPositions, nextMove.id, nextMove.dx, nextMove.dy), 'the next drag still works after interrupting feedback');
  await interrupted.context().close();

  const almost = freshProgress(); almost.puzzles['0:0:0'] = { positions: [1, 0, 2, 3, 4, 5, 6, 7, 8], layoutVersion: 2 };
  const q = await makePage(almost, 'reduce');
  await drag(q, findHint((await state(q)).session.positions));
  assert.ok((await state(q)).session.completed);
  assert.equal(await q.evaluate(() => window.__game.celebration()), 0, 'reduced motion suppresses celebration particles');
  // Finish the raw CDP drag gesture before switching to a synthesized tap.
  await q.waitForTimeout(250);
  assert.ok((await q.evaluate(() => window.__game.puzzleGeometry())).cards.every((card) => card.scale.every((v) => v === 1)), 'reduced motion keeps the white flash without scaling');
  await q.tap('#back'); await q.waitForFunction(() => window.__game.state().mode === 'chapters'); await idle(q); await q.waitForTimeout(3300);
  assert.equal((await state(q)).mode, 'chapters'); assert.ok(await q.locator('#overlay').isHidden(), 'leaving cancels the pending settlement');
  assert.equal((await state(q)).progress.completed[0][0], true);
  assert.deepEqual(errors, []);
  console.log('PASS: synchronized 3% merge pulse and white flash, seamless joined edges, immediate regrab, reduced motion, completion-only fireworks, 2-second hold, 1-second settlement, persistence and timer cancellation.');
} finally { await browser.close(); }
