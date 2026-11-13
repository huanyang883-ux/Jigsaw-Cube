import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { SAVE_KEY } from '../src/progress.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_PRODUCTION_URL || 'http://127.0.0.1:4173';
await fs.mkdir('test-results', { recursive: true });
const idle = (p) => p.waitForFunction(() => document.querySelector('#game') && !document.querySelector('#game').classList.contains('is-busy') && document.querySelector('#loading').hidden);
async function enter(p, level = 0) {
  await p.tap('#enter'); await idle(p);
  const box = await p.locator(`[data-level="${level}"]`).boundingBox();
  await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}
const settings = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
try {
  const slow = await browser.newContext(settings), p = await slow.newPage();
  let releaseScript, releaseArt;
  const scriptGate = new Promise((resolve) => { releaseScript = resolve; }), artGate = new Promise((resolve) => { releaseArt = resolve; });
  await p.route('**/assets/main-*.js', async (route) => { await scriptGate; await route.continue(); });
  await p.route('**/assets/cake-01.webp?*', async (route) => { await artGate; await route.continue(); });
  await p.goto(base, { waitUntil: 'commit' });
  await p.waitForSelector('#loading'); await p.waitForTimeout(600);
  assert.equal((await p.locator('body').innerText()).trim(), '');
  assert.equal(await p.locator('#game').count(), 0, 'loading art is present before the main game script arrives');
  await p.screenshot({ path: 'test-results/loading-before-scripts.png' });
  releaseScript(); await p.waitForSelector('#game', { state: 'attached' });
  assert.ok(await p.locator('#loading').isVisible());
  await p.waitForTimeout(200); await p.screenshot({ path: 'test-results/loading-assets.png' });
  releaseArt(); await idle(p); assert.ok(await p.locator('#loading').isHidden()); await slow.close();

  // No routing here: real HTTP-cache behavior is part of the assertion.
  const context = await browser.newContext(settings), q = await context.newPage(), failures = [];
  q.on('pageerror', (e) => failures.push(e.message));
  await q.goto(base); await idle(q); await enter(q); await idle(q);
  const timing = await q.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('/cake-01.webp')).map((e) => ({ type: e.initiatorType, transferred: e.transferSize })));
  assert.ok(timing.some((t) => t.type === 'fetch'), 'the first playable image is fetched during loading');
  assert.ok(timing.some((t) => t.type === 'img' && t.transferred === 0), 'Three.js reuses the preloaded photo from HTTP cache');
  assert.equal(await q.locator('#level-thumb').count(), 0);
  const fetched = await q.evaluate(() => performance.getEntriesByType('resource').filter((e) => e.name.includes('.webp')).map((e) => e.name));
  assert.ok(fetched.length < 16, 'startup and first play do not download the whole 90-image catalog');
  assert.ok(fetched.every((url) => url.includes('/cake-') || url.includes('/ui/guide-hand.webp')), 'only the current chapter is warmed');
  await q.tap('#back'); await idle(q);
  await q.route('**/assets/cake-04.webp?*', (route) => route.abort('failed'));
  const box = await q.locator('[data-level="3"]').boundingBox();
  await q.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await q.waitForSelector('#retry-load:not([hidden])');
  assert.ok(await q.locator('#hand-guide').isHidden());
  assert.equal((await q.locator('#loading').innerText()).trim(), '');
  await q.screenshot({ path: 'test-results/loading-retry.png' });
  assert.deepEqual(await q.evaluate((key) => JSON.parse(localStorage.getItem(key)).props, SAVE_KEY), { hint: 28, preview: 28 });
  await q.unroute('**/assets/cake-04.webp?*'); await q.tap('#retry-load'); await idle(q);
  await enter(q, 3); await idle(q);
  assert.ok(await q.locator('#retry-load').isHidden());
  assert.equal((await q.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
  assert.deepEqual(failures, []);
  await context.close();
  console.log('PASS: pre-script loading screen, real asset progress, warm first-level cache hit, bounded chapter prefetch, icon-only failure/retry, no prop consumption or visible words.');
} finally { await browser.close(); }
