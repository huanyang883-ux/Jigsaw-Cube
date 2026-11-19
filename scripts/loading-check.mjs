import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import sharp from 'sharp';
import { freshProgress, SAVE_KEY } from '../src/progress.js';

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
  let releaseScript, releaseArt, requestedArt = false;
  const scriptGate = new Promise((resolve) => { releaseScript = resolve; }), artGate = new Promise((resolve) => { releaseArt = resolve; });
  await p.route('**/assets/main-*.js', async (route) => { await scriptGate; await route.continue(); });
  await p.route('**/assets/cake-01.webp?*', async (route) => { requestedArt = true; await artGate; await route.continue(); });
  await p.goto(base, { waitUntil: 'commit' });
  await p.waitForSelector('#loading'); await p.waitForTimeout(600);
  assert.equal((await p.locator('body').innerText()).trim(), '');
  assert.equal(await p.locator('#game').count(), 0, 'loading art is present before the main game script arrives');
  await p.screenshot({ path: 'test-results/loading-before-scripts.png' });
  releaseScript(); await idle(p);
  assert.equal(requestedArt, false, 'startup does not wait for the first level image');
  await enter(p);
  await p.waitForSelector('#loading:not([hidden])');
  assert.equal(requestedArt, true);
  await p.screenshot({ path: 'test-results/loading-assets.png' });
  releaseArt(); await idle(p); assert.ok(await p.locator('#loading').isHidden()); await slow.close();

  const context = await browser.newContext(settings), q = await context.newPage(), failures = [];
  q.on('pageerror', (e) => failures.push(e.message));
  await q.goto(base); await idle(q);
  const levelImages = () => q.evaluate(() => performance.getEntriesByType('resource').filter((entry) => /-\d{2}\.webp/.test(entry.name)).map((entry) => entry.name));
  assert.deepEqual(await levelImages(), []);
  await enter(q); await idle(q);
  assert.deepEqual((await levelImages()).map((url) => new URL(url).pathname), ['/assets/cake-01.webp']);
  await q.tap('#picture-peek');
  assert.ok(await q.locator('.overlay-card img').evaluate((image) => image.complete && image.naturalWidth > 0));
  await q.tap('#close-picture');
  assert.equal(await q.locator('#overlay-content img').count(), 0);
  assert.equal(await q.locator('#level-thumb').count(), 0);
  assert.equal((await levelImages()).length, 1, 'preview uses the same decoded image and no neighboring levels load');
  await q.tap('#settings'); await q.tap('#back'); await idle(q);
  await q.route('**/assets/cake-04.webp?*', (route) => route.abort('failed'));
  const box = await q.locator('[data-level="3"]').boundingBox();
  await q.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await q.waitForSelector('#retry-load:not([hidden])');
  assert.ok(await q.locator('#hand-guide').isHidden());
  assert.equal((await q.locator('#loading').innerText()).trim(), '');
  await q.screenshot({ path: 'test-results/loading-retry.png' });
  assert.deepEqual(await q.evaluate((key) => JSON.parse(localStorage.getItem(key)).props, SAVE_KEY), { hint: 28, preview: 27 });
  await q.unroute('**/assets/cake-04.webp?*'); await q.tap('#retry-load'); await idle(q);
  await enter(q, 3); await idle(q);
  assert.ok(await q.locator('#retry-load').isHidden());
  assert.equal((await q.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
  assert.deepEqual(failures, []);
  await context.close();
  console.log('PASS: loading screen before startup, level art only on entry, decoded image reused in preview, scoped failure and retry.');

  const progress = freshProgress();
  progress.completed[0].fill(true); progress.completed[1].fill(true);
  const carousel = await browser.newContext(settings), switcher = await carousel.newPage(), faces = [];
  await carousel.addInitScript(({ key, progress }) => localStorage.setItem(key, JSON.stringify(progress)), { key: SAVE_KEY, progress });
  let releaseFront, releaseStale, releaseNeighbor, holdStale = true;
  const frontGate = new Promise((resolve) => { releaseFront = resolve; });
  const staleGate = new Promise((resolve) => { releaseStale = resolve; });
  const neighborGate = new Promise((resolve) => { releaseNeighbor = resolve; });
  switcher.on('request', (request) => {
    const face = new URL(request.url()).pathname;
    if (face.endsWith('-face.webp') || face === '/assets/white.svg') faces.push(face);
  });
  await switcher.route('**/*-face.webp?*', async (route) => {
    const face = new URL(route.request().url()).pathname;
    if (face === '/assets/africa-face.webp') await frontGate;
    if (face === '/assets/asia-face.webp' && holdStale) {
      holdStale = false;
      await staleGate; await route.continue().catch(() => {});
      return;
    }
    if (face === '/assets/cream-face.webp') await neighborGate;
    if (face === '/assets/land-face.webp') await route.fulfill({ status: 200, contentType: 'image/webp', body: 'bad image' });
    else await route.continue();
  });
  const paths = (...names) => names.map((name) => `/assets/${name}-face.webp`);
  const startupFronts = paths('north-america', 'south-america', 'africa');
  const startupFace = switcher.waitForRequest('**/africa-face.webp?*');
  const staleFace = switcher.waitForRequest('**/asia-face.webp?*');
  await switcher.goto(base); await startupFace;
  assert.equal(await switcher.locator('#loading').isVisible(), true, 'the loading screen waits for the last visible face');
  assert.deepEqual(new Set(faces), new Set(startupFronts), 'only the current three visible faces load before the home screen');
  releaseFront(); await idle(switcher); await staleFace;
  assert.deepEqual(faces.slice(3), paths('ancient', 'amphibians', 'ocean', 'oceania', 'asia'),
    'all three neighbor fronts then the current hidden faces, without any gesture');

  const abandoned = switcher.waitForEvent('requestfailed', (request) => request.url().includes('/asia-face.webp'));
  const newNeighbor = switcher.waitForRequest('**/cream-face.webp?*');
  await switcher.tap('#previous'); await idle(switcher);
  assert.equal(await switcher.locator('.viewport').getAttribute('data-theme'), '1');
  await abandoned; releaseStale(); await newNeighbor;
  assert.deepEqual(faces.slice(8), paths('cream'), '4x4 and 3x3 fronts are retained, while the new 2x2 neighbor gets priority');
  const animalBack = switcher.waitForRequest('**/birds-face.webp?*');
  releaseNeighbor(); await animalBack;
  assert.deepEqual(faces.slice(8), paths('cream', 'candy', 'cake', 'land', 'insects', 'birds'));
  assert.ok(await switcher.locator('#loading').isHidden(), 'an optional face failure does not block navigation');
  const reloadedBack = switcher.waitForRequest('**/oceania-face.webp?*');
  await switcher.tap('#next'); await idle(switcher); await reloadedBack;
  for (const front of startupFronts) assert.equal(faces.filter((url) => url === front).length, 1);
  assert.equal(faces.filter((url) => url === '/assets/oceania-face.webp').length, 2, 'the previous back texture was released');
  const rebuiltAnimalBack = switcher.waitForRequest('**/insects-face.webp?*');
  await switcher.tap('#previous'); await idle(switcher); await rebuiltAnimalBack;
  for (const front of paths('ancient', 'amphibians', 'ocean')) assert.equal(faces.filter((url) => url === front).length, 1);
  assert.equal(faces.filter((url) => url === '/assets/cream-face.webp').length, 2, 'a cube outside the neighborhood releases even its front');
  assert.equal(faces.filter((url) => url === '/assets/insects-face.webp').length, 2, 'returning also rebuilds the 3x3 back textures');
  await carousel.close();
  console.log('PASS: loading waits for all three visible faces, then warms neighbor fronts and hidden faces; switching cancels and releases stale art without waiting.');

  const jumps = await browser.newContext({ ...settings, reducedMotion: 'reduce' });
  await jumps.addInitScript(({ key, progress }) => localStorage.setItem(key, JSON.stringify(progress)), { key: SAVE_KEY, progress });
  const page = await jumps.newPage();
  let releaseDessert;
  const dessertGate = new Promise(resolve => { releaseDessert = resolve; });
  await page.route('**/cream-face.webp?*', async route => { await dessertGate; await route.continue(); });
  await page.goto(base); await idle(page);
  const firstDessert = page.waitForRequest('**/cream-face.webp?*');
  await page.tap('#theme-pages [data-theme="0"]');
  await firstDessert; await idle(page);
  assert.equal(await page.locator('.viewport').getAttribute('data-theme'), '0', '4x4 jumps directly to 2x2 with the full cover still blocked');
  const stage = await page.locator('#game').boundingBox();
  const clip = { x: stage.x + stage.width * .28, y: stage.y + stage.height * .38, width: stage.width * .44, height: stage.height * .20 };
  const capture = async () => sharp(await page.screenshot({ clip })).resize(64, 64).removeAlpha().raw().toBuffer();
  const preview = await capture();
  const hiddenDessert = page.waitForRequest(/\/(jelly|icecream|chocolate)-face\.webp/);
  releaseDessert(); await hiddenDessert;
  const full = await capture();
  const difference = preview.reduce((sum, value, i) => sum + Math.abs(value - full[i]), 0) / full.length;
  assert.ok(difference < 7, `cold covers and their full-resolution replacements must show the same picture (mean RGB difference ${difference.toFixed(2)})`);
  await page.evaluate(() => {
    for (const i of [2, 3, 0, 1]) document.querySelector(`#theme-pages [data-theme="${i}"]`).click();
  });
  await idle(page);
  assert.equal(await page.locator('.viewport').getAttribute('data-theme'), '1', 'rapid icon taps settle on the last requested order');
  assert.equal(await page.locator('.theme-page[aria-pressed=true]').getAttribute('data-theme'), '1');
  await jumps.close();
  console.log(`PASS: cold nonadjacent jump paints matching covers before the download (mean RGB difference ${difference.toFixed(2)}), last rapid tap wins.`);
} finally { await browser.close(); }
