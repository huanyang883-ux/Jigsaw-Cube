import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { freshProgress, initialLayout, levelConfig, saveSlot } from '../src/progress.js';

const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const release = process.argv.includes('--release');
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const idle = p => p.waitForFunction(() => document.querySelector('#loading')?.hidden && document.querySelector('#settings')?.disabled === false && document.querySelector('#game')?.dataset.mode === 'home');
const stored = p => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
await fs.mkdir('test-results/amphibians-chapter-v3', { recursive: true });
try {
  const progress = freshProgress(); progress.completed[0].fill(true); progress.completed[1].fill(true, 0, 9);
  progress.sound = true; progress.props = { hint: 3, preview: 7 };
  for (const key of Object.keys(progress.guides)) progress.guides[key] = true;
  progress.puzzles['1:1:0'] = { positions: initialLayout(1, 1, 0), layoutVersion: levelConfig(1, 1, 0).layoutVersion, gridSize: 4 };
  progress.records['0:0:0'] = { moves: 2, hints: 0, previews: 1, activeMs: 2400, gridSize: 3, layoutVersion: 2, completedAt: 1000 };
  const searches = ['', '?trial=first12', '?trial=all78'];
  const entries = Object.fromEntries(searches.map(search => [saveSlot(search), JSON.stringify(progress)]));
  entries['another-app:settings'] = 'preserve';
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(entries => {
    if (sessionStorage.getItem('controls-seeded')) return;
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
    sessionStorage.setItem('controls-seeded', 'true');
  }, entries);
  const p = await context.newPage(), errors = [];
  p.on('pageerror', error => errors.push(error.message));
  for (const search of searches) {
    await p.goto(`${base}/${search}`); await idle(p);
    assert.ok(await p.locator('#sound').isHidden());
    await p.tap('#settings');
    assert.equal(await p.locator('#settings').getAttribute('aria-expanded'), 'true');
    await p.waitForTimeout(240);
    assert.equal(await p.locator('#settings-menu button:not([hidden])').count(), release ? 1 : 3);
    const gear = await p.locator('#settings').boundingBox(), menu = await p.locator('#settings-menu').boundingBox();
    assert.ok(gear.x < 50 && menu.y > gear.y + gear.height && menu.x >= 0 && menu.x + menu.width <= 390);
    if (release) {
      assert.equal(await p.locator('#reset-account, #complete-all').count(), 0);
      const before = await stored(p);
      await p.tap('#sound');
      assert.equal(JSON.parse((await stored(p))[saveSlot(search)]).sound, false);
      for (const key of Object.keys(before)) if (key !== saveSlot(search)) assert.equal((await stored(p))[key], before[key]);
      await p.screenshot({ path: 'test-results/amphibians-chapter-v3/home-release-settings.png' });
      continue;
    }
    await p.screenshot({ path: 'test-results/amphibians-chapter-v3/home-test-settings.png' });
    const before = await stored(p), key = saveSlot(search), previous = JSON.parse(before[key]);
    await p.tap('#complete-all'); await idle(p);
    let after = await stored(p), complete = JSON.parse(after[key]);
    assert.equal(complete.completed.flat().length, 174); assert.ok(complete.completed.flat().every(Boolean));
    assert.deepEqual(complete.puzzles, {}); assert.deepEqual(complete.records, previous.records);
    assert.deepEqual(complete.props, previous.props); assert.deepEqual(complete.guides, previous.guides); assert.equal(complete.sound, previous.sound);
    for (const name of Object.keys(before)) if (name !== key) assert.equal(after[name], before[name]);
    await p.reload(); await idle(p); assert.equal((await stored(p))[key], after[key]);
    await p.tap('#settings'); await p.tap('#complete-all'); await idle(p);
    assert.equal((await stored(p))[key], after[key], 'repeated completion is idempotent');
    await p.tap('#enter');
    await p.waitForFunction(() => document.querySelector('#game')?.dataset.mode === 'chapters' && !document.querySelector('#back').disabled);
    assert.equal(await p.locator('#chapter-pages button:not(:disabled)').count(), 6);
    await p.tap('#back'); await idle(p);
    await p.tap('#settings'); await p.tap('#reset-account'); await p.tap('#cancel-reset');
    assert.equal((await stored(p))[key], after[key]);
    await p.tap('#settings'); await p.tap('#reset-account'); await p.tap('#confirm-reset'); await idle(p);
    after = await stored(p); assert.deepEqual(JSON.parse(after[key]), freshProgress());
    for (const name of Object.keys(before)) if (name !== key) assert.equal(after[name], before[name]);
    console.log(`PASS: ${search || 'normal'} complete-all, preservation, reload, unlocked faces, cancel, reset and save isolation.`);
  }
  assert.deepEqual(errors, []);
  console.log(release ? 'PASS: release settings show only sound; both test controls are absent in every save mode.' : 'PASS: home test menu placement and actions in all three save modes.');
} finally { await browser.close(); }
