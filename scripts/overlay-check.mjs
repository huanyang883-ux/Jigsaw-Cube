// Regression: touch releases must still activate overlay buttons when a browser
// drops the compatibility click after captured canvas dragging.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { freshProgress, saveSlot } from '../src/progress.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_PRODUCTION_URL || 'http://127.0.0.1:4173';
try {
  const progress = freshProgress(); progress.puzzles['0:0:0'] = { positions: [1, 0, 2, 3, 4, 5, 6, 7, 8], layoutVersion: 2 };
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(({ key, progress }) => {
    localStorage.setItem(key, JSON.stringify(progress));
    document.addEventListener('click', (e) => {
      if (e.isTrusted && e.target.closest('#continue')) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  }, { key: saveSlot('?trial=all78'), progress });
  const p = await context.newPage(), cdp = await context.newCDPSession(p), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  const idle = () => p.waitForFunction(() => document.querySelector('#loading').hidden && !document.querySelector('#game').classList.contains('is-busy'));
  await p.goto(`${base}/?trial=all78`); await idle();
  await p.tap('#enter'); await p.waitForFunction(() => document.querySelector('#game').dataset.mode === 'chapters'); await idle();
  const tile = await p.locator('[data-level="0"]').boundingBox();
  await p.touchscreen.tap(tile.x + tile.width / 2, tile.y + tile.height / 2);
  await p.waitForFunction(() => document.querySelector('#game').dataset.mode === 'puzzle'); await idle();
  await p.tap('#picture-peek'); await p.waitForSelector('#close-picture');
  const close = await p.locator('#close-picture').boundingBox(), from = { x: close.x + close.width / 2, y: close.y + close.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x - 90, y: from.y + 90 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.ok(await p.locator('#overlay').isVisible(), 'dragging off a button does not activate it');
  await p.locator('#close-picture').focus(); await p.keyboard.press('Enter'); await p.waitForFunction(() => document.querySelector('#overlay').hidden);
  await p.tap('#hint'); await p.waitForSelector('#continue');
  await p.tap('#continue'); await p.waitForFunction(() => document.querySelector('#game').dataset.mode === 'chapters'); await idle();
  const saved = await p.evaluate((key) => JSON.parse(localStorage.getItem(key)), saveSlot('?trial=all78'));
  assert.equal(saved.completed[0][0], true); assert.deepEqual(saved.props, { hint: 27, preview: 27 });
  assert.equal(saved.records['0:0:0'].moves, 1); assert.deepEqual(errors, []);
  console.log('PASS: touch return without native click, drag-off cancellation, keyboard close and single prop/completion commits.');
} finally { await browser.close(); }
