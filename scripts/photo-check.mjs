import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { freshProgress, SAVE_KEY, legacyInitialLayout } from '../src/progress.js';
import { findHint, moveGroup, xy, groups, linked, clampDelta } from '../src/puzzle.js';
import * as THREE from 'three';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const errors = [];
const idle = (p) => p.waitForFunction(() => window.__game?.idle());
const state = (p) => p.evaluate(() => window.__game.state());
function assertSeamless(positions, geo) {
  const n = Math.sqrt(positions.length);
  for (let id = 0; id < positions.length; id++) for (const direction of [1, n]) {
    const next = id + direction;
    if (next >= positions.length || direction === 1 && id % n === n - 1 || !linked(positions, id, next)) continue;
    const a = geo.cards[id], b = geo.cards[next];
    if (direction === 1) assert.ok(a.position[0] + a.vertices[3] >= b.position[0] + b.vertices[0] - 1e-6, 'joined horizontal edges meet');
    else assert.ok(a.position[1] + a.vertices[7] <= b.position[1] + b.vertices[1] + 1e-6, 'joined vertical edges meet');
    assert.ok(a.rotation.every((v) => Math.abs(v) < 1e-10), 'individual pieces do not rotate apart during a group drag');
  }
}
function assertRigidJoins(positions, geo) {
  const n = Math.sqrt(positions.length), height = 1 / geo.aspect;
  const point = (card, p) => new THREE.Vector3(...p).applyEuler(new THREE.Euler(...card.rotation)).add(new THREE.Vector3(...card.position));
  for (let id = 0; id < positions.length; id++) for (const step of [1, n]) {
    const next = id + step;
    if (next >= positions.length || step === 1 && id % n === n - 1 || !linked(positions, id, next)) continue;
    const a = point(geo.cards[id], step === 1 ? [.5, 0, .031] : [0, -height / 2, .031]);
    const b = point(geo.cards[next], step === 1 ? [-.5, 0, .031] : [0, height / 2, .031]);
    assert.ok(a.distanceTo(b) < 1e-6, 'connected pieces remain one rigid picture while tilting and springing back');
  }
}
async function open(p, level = 0) { const point = await p.evaluate((i) => window.__game.tileCenter(i), level); await p.touchscreen.tap(point.x, point.y); await idle(p); }
async function makePage(progress) {
  const c = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (progress) await c.addInitScript(({ key, p }) => localStorage.setItem(key, JSON.stringify(p)), { key: SAVE_KEY, p: progress });
  const p = await c.newPage(); p.on('pageerror', (e) => errors.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Context Lost')) errors.push(m.text()); });
  return { c, p };
}
try {
  const fresh = await makePage(); const images = [];
  fresh.p.on('request', (r) => { if (r.resourceType() === 'image') images.push(r.url()); });
  await fresh.p.goto(base); await idle(fresh.p);
  assert.ok(images.every((url) => url.includes('/assets/ui/guide-hand.webp')), 'fresh home only mounts the guide image; photo preloads use fetch');
  await fresh.c.close();

  const progress = freshProgress(); progress.completed[0].fill(true, 0, 4);
  // Keep a known edge-blocked group fixture independent of curriculum tuning.
  progress.puzzles['0:1:2'] = { positions: legacyInitialLayout(0, 1, 2) };
  const { c, p } = await makePage(progress); await p.goto(base); await idle(p);
  await p.tap('#enter'); await idle(p); await open(p, 2);
  const geo = await p.evaluate(() => window.__game.puzzleGeometry());
  assert.ok(Math.abs(geo.aspect - .75) < .002);
  assert.ok(Math.abs(geo.width / geo.height - geo.aspect) < .003, 'board keeps the source photo ratio');
  const frame = await p.locator('.puzzle-frame').boundingBox(), preview = await p.locator('#picture-peek').boundingBox();
  assert.ok(frame.y + frame.height < preview.y, 'preview sits below the larger board');
  assert.ok(frame.width > 350, 'portrait board uses the newly available space');
  await p.screenshot({ path: 'test-results/portrait-dessert.png' });
  const initial = (await state(p)).session.positions, hint = findHint(initial), at = xy(initial[hint.id]);
  const from = await p.evaluate((id) => window.__game.pieceCenter(id), hint.id);
  const to = await p.evaluate((cell) => window.__game.cellCenter(cell), (at.y + hint.dy) * 3 + at.x + hint.dx);
  const cdp = await c.newCDPSession(p);
  async function touchMove(from, to, release = true) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
    if (release) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(p); }
  }
  await touchMove(from, to);
  const joined = (await state(p)).session.positions;
  assert.deepEqual(joined, moveGroup(initial, hint.id, hint.dx, hint.dy));
  assertSeamless(joined, await p.evaluate(() => window.__game.puzzleGeometry()));
  await p.screenshot({ path: 'test-results/portrait-joined.png' });
  const movable = groups(joined).filter((g) => g.length > 1).flatMap((g) => [[.2, 0], [-.2, 0], [0, .2], [0, -.2]].map(([dx, dy]) => ({ ids: g, d: clampDelta(joined, g, dx, dy) }))).find(({ d }) => Math.abs(d.x) + Math.abs(d.y) > .1);
  if (movable) {
    const start = await p.evaluate((id) => window.__game.pieceCenter(id), movable.ids[0]);
    const rect = await p.locator('#puzzle-board').boundingBox(), unitX = rect.width / 3.18, unitY = rect.height / 3.18;
    await touchMove(start, { x: start.x + movable.d.x * unitX, y: start.y + movable.d.y * unitY }, false);
    assertSeamless(joined, await p.evaluate(() => window.__game.puzzleGeometry()));
    await p.screenshot({ path: 'test-results/portrait-group-drag.png' });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(p);
  }
  const blocked = groups(joined).filter((g) => g.length > 1).flatMap((ids) => [[-.7, 0], [.7, 0], [0, -.7], [0, .7]].map(([dx, dy]) => ({ ids, dx, dy, d: clampDelta(joined, ids, dx, dy) }))).find(({ d }) => d.x === 0 && d.y === 0);
  assert.ok(blocked, 'fixture includes a group blocked by a board edge');
  const start = await p.evaluate((id) => window.__game.pieceCenter(id), blocked.ids[0]);
  const rect = await p.locator('#puzzle-board').boundingBox();
  await touchMove(start, { x: start.x + blocked.dx * rect.width / 3.18, y: start.y + blocked.dy * rect.height / 3.18 }, false);
  const tilted = await p.evaluate(() => window.__game.puzzleGeometry());
  assert.ok(blocked.ids.every((id) => tilted.cards[id].rotation.some((v) => Math.abs(v) > .02)), 'blocked group visibly tilts in the drag direction');
  assertRigidJoins(joined, tilted);
  await p.screenshot({ path: 'test-results/portrait-blocked.png' });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.waitForTimeout(70); assertRigidJoins(joined, await p.evaluate(() => window.__game.puzzleGeometry()));
  await idle(p); assert.deepEqual((await state(p)).session.positions, joined);
  assert.ok((await p.evaluate(() => window.__game.puzzleGeometry())).cards.every((c) => c.rotation.every((v) => v === 0)));
  await p.tap('#picture-peek'); await p.waitForSelector('#close-picture');
  await p.waitForFunction(() => { const img = document.querySelector('.overlay-card img'); return img?.complete && img.naturalWidth > 0; });
  const ratio = await p.locator('.overlay-card img').evaluate((img) => ({ source: img.naturalWidth / img.naturalHeight, display: img.clientWidth / img.clientHeight }));
  assert.ok(Math.abs(ratio.source - ratio.display) < .002, 'full-photo preview is not cropped or stretched');
  await p.tap('#close-picture'); await p.setViewportSize({ width: 320, height: 568 });
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal((await p.locator('body').innerText()).replace(/[\d\s]/g, ''), ''); await c.close();

  const animals = freshProgress(); animals.completed[0].fill(true);
  const second = await makePage(animals); await second.p.goto(base); await idle(second.p);
  await second.p.tap('#next'); await idle(second.p); await second.p.tap('#enter'); await idle(second.p); await open(second.p);
  assert.equal((await state(second.p)).session.positions.length, 16);
  assert.ok((await state(second.p)).session.art.includes('ocean-01.webp'));
  await second.p.screenshot({ path: 'test-results/portrait-wildlife.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: lazy photo loading, larger portrait dimensions, touch drag, gap-free joined groups, blocked drag tilt and rigid spring-back, uncropped preview, mobile resize, animal 4×4 puzzle.');
} finally { await browser.close(); }
