import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { freshProgress, initialLayout, levelConfig, saveSlot } from '../src/progress.js';

const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
await fs.mkdir('test-results', { recursive: true });
const errors = [];
const idle = (p) => p.waitForFunction(() => window.__game?.idle());
const state = (p) => p.evaluate(() => window.__game.state());
const color = (p) => p.locator('.scene-background').evaluate((el) => getComputedStyle(el).backgroundColor);
const stored = (p) => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])));
try {
  const seeded = freshProgress();
  seeded.completed[0].fill(true); seeded.completed[1][0] = true;
  seeded.sound = true; seeded.props = { hint: 3, preview: 7 };
  for (const key of Object.keys(seeded.guides)) seeded.guides[key] = true;
  seeded.puzzles['1:0:1'] = { positions: initialLayout(1, 0, 1), gridSize: 4, layoutVersion: levelConfig(1, 0, 1).layoutVersion };
  seeded.records['0:0:0'] = { moves: 2, hints: 1, previews: 1, activeMs: 1200, gridSize: 3, layoutVersion: 2, completedAt: 1000 };
  const searches = ['', '?trial=first12', '?trial=all78'];
  const entries = Object.fromEntries(searches.map((search) => [saveSlot(search), JSON.stringify(seeded)]));
  entries['another-app:settings'] = 'keep';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await context.addInitScript((entries) => {
    if (sessionStorage.getItem('home-check-seeded')) return;
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    sessionStorage.setItem('home-check-seeded', 'true');
  }, entries);
  const p = await context.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await idle(p);
  assert.equal(await p.locator('body').innerText(), '', 'home remains free of text');
  const cream = await color(p);
  const creamArrows = await p.evaluate(() => window.__game.arrowColors());
  await p.tap('#next'); await p.waitForTimeout(200);
  const intermediate = await color(p);
  const intermediateArrows = await p.evaluate(() => window.__game.arrowColors());
  await idle(p); await p.waitForTimeout(200);
  const sage = await color(p);
  const sageArrows = await p.evaluate(() => window.__game.arrowColors());
  assert.notDeepEqual(creamArrows, sageArrows);
  assert.notDeepEqual(intermediateArrows, creamArrows); assert.notDeepEqual(intermediateArrows, sageArrows, 'arrows interpolate rather than snap to the new palette');
  assert.equal(intermediateArrows[0], intermediateArrows[1], 'both arrows recolor together');
  assert.notEqual(cream, sage); assert.notEqual(intermediate, cream); assert.notEqual(intermediate, sage);
  await p.screenshot({ path: 'test-results/home-sage.png' });
  await p.tap('#next'); await idle(p); await p.waitForTimeout(200);
  const lilac = await color(p); assert.notEqual(lilac, cream); assert.notEqual(lilac, sage);
  await p.screenshot({ path: 'test-results/home-lilac.png' });
  await p.tap('[data-theme="0"]'); await idle(p); await p.waitForTimeout(200);
  assert.equal(await color(p), cream, 'theme tabs also update the background');

  for (const [width, height] of [[320, 568], [360, 800], [390, 844], [430, 932], [540, 960], [768, 1024], [1024, 768], [844, 390], [1920, 1080], [2560, 1080]]) {
    await p.setViewportSize({ width, height });
    await p.waitForTimeout(100);
    const layout = await p.evaluate(() => {
      const rect = (selector) => {
        const { left, top, right, bottom } = document.querySelector(selector).getBoundingClientRect();
        return { left, top, right, bottom };
      };
      return { width: innerWidth, height: innerHeight, background: rect('.scene-background'), stage: rect('#game'), sound: rect('#sound'), reset: rect('#reset-account'), emblem: rect('.top-emblem'), scrollWidth: document.documentElement.scrollWidth };
    });
    const { background, stage, sound, reset, emblem } = layout;
    assert.ok(background.left < 0 && background.top < 0 && background.right > layout.width && background.bottom > layout.height, `background covers ${width}×${height}`);
    assert.ok(stage.left >= -1 && stage.top >= -1 && stage.right <= layout.width + 1 && stage.bottom <= layout.height + 1, `game fits ${width}×${height}`);
    assert.ok(reset.left > sound.right && reset.right < emblem.left, 'reset sits beside sound without overlap');
    assert.equal(layout.scrollWidth, layout.width);
    if (width === 390 || width === 768 || width === 1920) await p.screenshot({ path: `test-results/home-${width}x${height}.png` });
  }

  await p.setViewportSize({ width: 390, height: 844 });
  await p.tap('#previous'); await idle(p); await p.waitForTimeout(200);
  assert.equal(await color(p), lilac, 'left arrow wraps and recolors');
  const beforeCancel = (await state(p)).progress;
  await p.tap('#reset-account');
  assert.equal(await p.locator('#cancel-reset').evaluate((el) => el === document.activeElement), true);
  assert.equal(await p.locator('.reset-actions').innerText(), '', 'confirmation buttons use symbols');
  assert.doesNotMatch(await p.locator('.reset-card').innerText(), /[\u3400-\u9fff]/, 'confirmation text is English');
  assert.deepEqual(await p.locator('#overlay').boundingBox(), { x: 0, y: 0, width: 390, height: 844 }, 'modal backdrop also fills the viewport');
  await p.keyboard.press('Tab'); assert.ok(await p.locator('#confirm-reset').evaluate((el) => el === document.activeElement));
  await p.keyboard.press('Tab'); assert.ok(await p.locator('#cancel-reset').evaluate((el) => el === document.activeElement));
  await p.keyboard.press('Shift+Tab'); assert.ok(await p.locator('#confirm-reset').evaluate((el) => el === document.activeElement));
  await p.keyboard.press('ArrowRight'); assert.equal((await state(p)).theme, 2);
  await p.screenshot({ path: 'test-results/home-reset-confirm.png' });
  await p.keyboard.press('Escape'); assert.ok(await p.locator('#overlay').isHidden());
  assert.deepEqual((await state(p)).progress, beforeCancel);
  await p.tap('#reset-account'); await p.tap('#cancel-reset');
  assert.deepEqual((await state(p)).progress, beforeCancel, 'cancel preserves progress');

  for (const search of searches) {
    if (search) { await p.goto(`${base}/${search}`); await idle(p); }
    const before = await stored(p), key = saveSlot(search);
    await p.tap('#reset-account'); await p.tap('#confirm-reset'); await idle(p);
    const reset = await state(p), after = await stored(p);
    assert.deepEqual(reset.progress, freshProgress(), 'reset clears completions, inventory usage, guides, records and sound');
    assert.equal(reset.theme, 0); assert.equal(reset.face, 0); assert.equal(reset.mode, 'home');
    assert.deepEqual(JSON.parse(after[key]), freshProgress());
    for (const name of Object.keys(before)) if (name !== key) assert.equal(after[name], before[name], `preserves ${name}`);
    assert.deepEqual(await p.evaluate(() => window.__game.revealed()), []);
    await p.tap('#next'); await idle(p); assert.deepEqual(await p.evaluate(() => window.__game.revealed()), []);
    await p.tap('#enter'); assert.equal((await state(p)).mode, 'home', 'animals are locked again');
    await p.reload(); await idle(p);
    assert.deepEqual((await state(p)).progress, freshProgress(), 'pagehide and reload cannot restore the old account');
  }
  await p.tap('#enter'); await idle(p);
  assert.ok(await p.locator('#reset-account').isHidden(), 'reset only appears on home');
  assert.equal(await p.locator('#chapter-pages button:disabled').count(), 5);
  await p.tap('#back'); await idle(p);
  await p.emulateMedia({ reducedMotion: 'reduce' });
  assert.ok(await p.locator('.scene-background').evaluate((el) => parseFloat(getComputedStyle(el).transitionDuration) < .01));
  assert.deepEqual(errors, []);
  console.log('PASS: full background coverage at 10 viewport sizes, interpolated theme colors, icon-only buttons, English confirmation, cancel/focus handling, account reset and isolated persistence across all 3 save slots.');
} finally { await browser.close(); }
