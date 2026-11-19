import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import { SAVE_KEY, freshProgress, freshStats, initialLayout, levelArt } from '../src/progress.js';
import { guideMove } from '../src/guide-state.js';
import { moveGroup } from '../src/puzzle.js';

const upstream = new URL(process.env.PUZZLE_PRODUCTION_URL || 'http://127.0.0.1:4173');
const recoveryKey = 'sweet-cube:load-recovery:v1';
const target = levelArt(0, 1, 0), requests = [];
let responseMode = 'corrupt';
// A real HTTP server retains browser caching. Playwright routing would disable it.
const proxy = http.createServer((request, response) => {
  if (request.url === target) {
    requests.push({ cache: request.headers['cache-control'], mode: responseMode });
    if (responseMode === 'corrupt') {
      response.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable' });
      response.end('broken-image-data'); return;
    }
    if (responseMode === 'offline') { response.writeHead(503).end(); return; }
  }
  const next = http.request(new URL(request.url, upstream), { headers: { ...request.headers, host: upstream.host } }, (source) => {
    response.writeHead(source.statusCode, source.headers); source.pipe(response);
  });
  next.on('error', () => response.destroy()); request.pipe(next);
});
await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${proxy.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const settings = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const idle = (p) => p.waitForFunction(() => document.querySelector('#game') && !document.querySelector('#game').classList.contains('is-busy') && document.querySelector('#loading').hidden);
const failed = (p, attempts) => p.waitForFunction(({ key, attempts }) => !document.querySelector('#retry-load').hidden && JSON.parse(sessionStorage.getItem(key))?.attempts === attempts, { key: recoveryKey, attempts });
try {
  const progress = freshProgress(); progress.completed[0].fill(true, 0, 4);
  progress.props = { hint: 7, preview: 11 }; progress.sound = true;
  for (const action of Object.keys(progress.guides)) progress.guides[action] = true;
  const positions = initialLayout(0, 1, 0), move = guideMove(positions);
  progress.puzzles['0:1:0'] = { positions: moveGroup(positions, move.id, move.dx, move.dy), gridSize: 3, layoutVersion: 2, stats: freshStats() };
  const context = await browser.newContext(settings), p = await context.newPage(), errors = [];
  p.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(({ key, progress }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(progress));
    localStorage.setItem('unrelated-app', 'keep');
  }, { key: SAVE_KEY, progress });
  await p.goto(base); await idle(p);
  assert.equal(requests.length, 0, 'corrupt level art does not block startup');
  await p.tap('#enter'); await idle(p);
  const first = await p.locator('[data-level="0"]').boundingBox();
  await p.touchscreen.tap(first.x + first.width / 2, first.y + first.height / 2);
  await failed(p, 1);
  assert.equal(await p.locator('#retry-load').getAttribute('data-recovery'), 'reload');
  assert.equal(requests.length, 1);
  await p.evaluate(async () => {
    await (await caches.open('sweet-cube:assets:old')).put('/cached-game-art', new Response('old'));
    await (await caches.open('another-app-assets')).put('/other', new Response('keep'));
    sessionStorage.setItem('unrelated-session', 'keep');
  });
  await p.tap('#retry-load'); await failed(p, 2);
  assert.equal(requests.length, 1, 'ordinary retry encounters the same corrupt HTTP cache entry');
  assert.equal(await p.locator('#retry-load').getAttribute('data-recovery'), 'refresh-assets');
  await p.evaluate(() => window.puzzleLoading.track('/assets/retired-bundle-12345678.js'));
  responseMode = 'offline';
  await p.tap('#retry-load'); await failed(p, 3);
  assert.ok(requests.some((request) => request.cache?.includes('no-cache')), 'repair bypasses HTTP cache');
  assert.deepEqual(await p.evaluate(() => caches.keys()), ['another-app-assets'], 'only game asset caches are removed');
  assert.deepEqual(await p.evaluate((key) => JSON.parse(localStorage.getItem(key)), SAVE_KEY), progress, 'failed repair preserves progress, positions, props and guides');
  assert.equal((await p.locator('#loading').innerText()).trim(), '');
  await p.screenshot({ path: 'test-results/loading-repair-retry.png' });
  responseMode = 'healthy';
  await p.tap('#retry-load'); await idle(p);
  const restored = await p.evaluate(({ key, recoveryKey }) => ({
    progress: JSON.parse(localStorage.getItem(key)), recovery: sessionStorage.getItem(recoveryKey),
    other: localStorage.getItem('unrelated-app'), session: sessionStorage.getItem('unrelated-session'),
  }), { key: SAVE_KEY, recoveryKey });
  assert.deepEqual(restored, { progress, recovery: null, other: 'keep', session: 'keep' });
  assert.ok(requests.some((request) => request.mode === 'healthy' && request.cache?.includes('no-cache')));
  await p.tap('#enter'); await idle(p);
  const box = await p.locator('[data-level="0"]').boundingBox(); await p.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); await idle(p);
  assert.equal(await p.locator('#hint-count').innerText(), '7'); assert.equal(await p.locator('#preview-count').innerText(), '11');
  assert.equal((await p.locator('body').innerText()).replace(/[\d\s]/g, ''), '');
  assert.deepEqual(errors, []); await context.close();
  console.log('PASS: corrupt HTTP cache → ordinary retry → scoped cache repair; failed repair can retry; retired bundles do not trap recovery; fresh image opens; exact save, props, guides and unrelated storage survive.');

  const scripts = await browser.newContext(settings), q = await scripts.newPage();
  // LAN HTTP and restricted browser storage may not expose Cache Storage.
  await scripts.addInitScript(() => Object.defineProperty(window, 'caches', { value: undefined, configurable: true }));
  await q.route('**/assets/index-*.js', (route) => route.abort('failed'));
  await q.goto(upstream.href); await failed(q, 1);
  assert.equal(await q.locator('#game').count(), 0, 'retry is available even if the entry module never executes');
  await q.tap('#retry-load'); await failed(q, 2);
  await q.unroute('**/assets/index-*.js'); await q.tap('#retry-load'); await idle(q);
  assert.equal((await q.locator('body').innerText()).trim(), ''); await scripts.close();
  console.log('PASS: missing entry module recovers before game code runs; repair works without Cache Storage.');

  const stalled = await browser.newContext(settings), r = await stalled.newPage();
  await r.clock.install();
  await r.route('**/assets/index-*.js', () => {});
  await r.goto(upstream.href, { waitUntil: 'commit' }); await r.waitForSelector('#loading');
  await r.clock.fastForward(46000); await failed(r, 1);
  assert.equal(await r.locator('#game').count(), 0);
  assert.equal((await r.locator('body').innerText()).trim(), ''); await stalled.close();
  console.log('PASS: a silent stalled download exposes an icon-only retry instead of loading forever.');
} finally {
  await browser.close(); proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve));
}
