import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { freshProgress, freshStats, levelArt, levelConfig, SAVE_KEY } from '../src/progress.js';
import { moveGroup, xy } from '../src/puzzle.js';
import { assertPuzzlePreview } from './assert-puzzle-preview.mjs';
import { verifyJigsawFeedback } from './jigsaw-feedback-check.mjs';

const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({
  executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce',
});
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
const state = () => page.evaluate(() => window.__game.state());
const idle = () => page.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
const tap = selector => page.locator(selector).tap();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });

async function enterCube() {
  await tap('#enter');
  await idle();
  assert.equal((await state()).mode, 'chapters');
}

async function openLevel(level) {
  const point = await page.evaluate(i => window.__game.tileCenter(i), level);
  await page.touchscreen.tap(point.x, point.y);
  await page.waitForFunction(() => window.__game.state().mode === 'puzzle');
  await idle();
  assert.equal((await state()).session.level, level);
}

const touch = (type, touchPoints) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
async function drag(from, to, acrossTray = false) {
  await touch('touchStart', [from]);
  const turn = acrossTray ? { x: from.x - 48, y: from.y - 2 } : from;
  if (acrossTray) {
    for (let i = 1; i <= 4; i++) await touch('touchMove', [{ x: from.x - i * 12, y: from.y - .5 * i }]);
  }
  for (let i = 1; i <= 4; i++) {
    await touch('touchMove', [{ x: turn.x + (to.x - turn.x) * i / 4, y: turn.y + (to.y - turn.y) * i / 4 }]);
  }
  await touch('touchEnd', []);
}

async function continueWin(art) {
  await page.waitForFunction(() => document.querySelector('#continue')?.disabled === false);
  assert.equal((await state()).session.completed, true);
  await assertPuzzlePreview(page, art);
  await tap('#continue');
  await page.waitForFunction(() => window.__game.state().mode !== 'puzzle');
  await idle();
}

function waitForHandOn(selector) {
  return page.waitForFunction(target => {
    const hand = document.querySelector('#hand-guide');
    if (!hand || hand.hidden) return false;
    const stage = document.querySelector('#game').getBoundingClientRect();
    const x = stage.left + parseFloat(hand.style.left) * stage.width / 1080;
    const y = stage.top + parseFloat(hand.style.top) * stage.height / 1920;
    return Boolean(document.elementFromPoint(x, y)?.closest(target));
  }, selector, { timeout: 8500 });
}

async function verifyLockedSwitch() {
  const trigger = page.locator('#mode-switch'), lock = trigger.locator('.mode-lock');
  const alternate = page.locator('#mode-switch-alternate');
  assert.ok(await lock.isVisible(), '53 of 54 classic levels shows the locked switch');
  assert.ok(await trigger.locator('.mode-caret').isHidden());
  assert.equal((await trigger.innerText()).trim(), '');
  const button = await trigger.boundingBox(), badge = await lock.boundingBox();
  assert.ok(badge.x + badge.width / 2 > button.x + button.width / 2 &&
    badge.y + badge.height / 2 > button.y + button.height / 2, 'lock occupies the lower-right corner');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.touchscreen.tap(button.x + button.width / 2, button.y + button.height / 2);
  const motion = await trigger.evaluate(el => {
    const moves = target => target.getAnimations().some(animation => {
      const frames = animation.effect.getKeyframes();
      return new Set(frames.map(frame => frame.transform).filter(Boolean)).size > 1;
    });
    return { button: moves(el), lock: moves(el.querySelector('.mode-lock')) };
  });
  assert.deepEqual(motion, { button: true, lock: true }, 'tap shakes the switch and swings its lock');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.press('ArrowDown');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.ok(await alternate.isHidden());
  assert.equal((await state()).gameplay, 'A');
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

async function selectMode(mode, guided = false) {
  const trigger = page.locator('#mode-switch');
  const alternate = page.locator('#mode-switch-alternate');
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  assert.ok(await trigger.locator('.mode-caret').isVisible());
  assert.ok(await trigger.locator('.mode-lock').isHidden());
  if (guided) await waitForHandOn('#mode-switch');
  await trigger.tap();
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await alternate.getAttribute('data-mode'), mode);
  if (guided) await waitForHandOn('#mode-switch-alternate');
  await alternate.tap();
  await idle();
  assert.equal(await trigger.getAttribute('data-mode'), mode);
  assert.equal(await page.locator('.viewport').getAttribute('data-play-mode'), mode);
  await alternate.waitFor({ state: 'hidden' });
}

async function verifySwitchReminder(mode) {
  await waitForHandOn('#mode-switch');
  await tap('#mode-switch');
  await waitForHandOn('#mode-switch-alternate');
  // Seeing both steps does not teach a switch. Ignore it and come home again.
  await enterCube();
  await tap('#back'); await idle();
  await waitForHandOn('#mode-switch');
  await page.reload(); await idle();
  await selectMode(mode, true);
}

function cellCenter(rect, cols, col, row) {
  const cell = rect.width / cols;
  return { x: rect.x + (col + .5) * cell, y: rect.y + (row + .5) * cell };
}

async function placeTrayPiece(cols, { loose = false, source } = {}) {
  const piece = source ?? page.locator('.jb-tray [data-piece]').nth(loose ? 2 : 0);
  const id = Number(await piece.getAttribute('data-piece'));
  const img = await piece.locator('svg').boundingBox();
  const board = await page.locator('.jb-plane').boundingBox();
  const col = id % cols, row = Math.floor(id / cols);
  const dx = loose ? (col === 0 ? 1 : -1) : 0;
  await drag({ x: img.x + img.width / 2, y: img.y + img.height / 2 }, cellCenter(board, cols, col + dx, row), loose);
  assert.equal(await page.locator(`.jb-tray [data-piece="${id}"]`).count(), 0, 'drag removes the selected piece from the tray');
  return { id, col, row, dx };
}

async function pinchBoard(original, dx = 0, dy = 0) {
  const x = original.x + original.width / 2, y = original.y + original.height / 2;
  const fingers = d => {
    const t = (d - 38) / 32, cx = x + t * dx, cy = y + t * dy;
    return [{ x: cx - d, y: cy, id: 0 }, { x: cx + d, y: cy, id: 1 }];
  };
  await touch('touchStart', fingers(38));
  for (const d of [44, 52, 60, 70]) await touch('touchMove', fingers(d));
  await touch('touchEnd', []);
  await page.waitForFunction(({ x, y, width }) => {
    const r = document.querySelector('.jb-plane').getBoundingClientRect();
    return Math.abs(r.width - width) < 1 && Math.abs(r.x + r.width / 2 - x) < 1 && Math.abs(r.y + r.height / 2 - y) < 1;
  }, { x: x + dx, y: y + dy, width: original.width * 70 / 38 });
}

async function verifyPreview() {
  const boardRect = () => page.locator('.jb-plane').evaluate(el => el.getBoundingClientRect().toJSON());
  const original = await boardRect();
  const x = original.x + original.width / 2, y = original.y + original.height / 2;
  await pinchBoard(original);
  const zoomed = await boardRect();
  await drag({ x, y }, { x: x + 35, y: y - 20 });
  await page.waitForFunction(r => {
    const p = document.querySelector('.jb-plane').getBoundingClientRect();
    return Math.abs(p.x - r.x - 35) < 1 && Math.abs(p.y - r.y + 20) < 1;
  }, zoomed);
  const panned = await boardRect();
  const preview = page.locator('#picture-peek');
  await preview.tap();
  assert.equal(await preview.getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('.jb-tray [data-piece]').first().isHidden());
  assert.ok(await page.locator('.jb-pieces').isHidden());
  assert.ok(await page.locator('.jb-lines').isHidden());
  await page.waitForFunction(w => {
    const image = document.querySelector('.jb-reference'), plane = document.querySelector('.jb-plane');
    return getComputedStyle(image).opacity === '1' && Math.abs(plane.getBoundingClientRect().width - w) < 1;
  }, original.width);
  const full = await boardRect();
  const view = await page.locator('.jb-window').boundingBox();
  assert.ok(Math.abs(full.width - original.width) < 1 && full.y >= view.y && full.y + full.height <= view.y + view.height + 1,
    'preview fits the whole original');
  await preview.tap();
  await page.waitForFunction(w => Math.abs(document.querySelector('.jb-plane').getBoundingClientRect().width - w) < 1, panned.width);
  const restored = await boardRect();
  for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(restored[key] - panned[key]) < 1);
}

async function verifyResume(cols) {
  const { id, col, row, dx } = await placeTrayPiece(cols, { loose: true });
  assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), '0');
  const snapshot = (await state()).session.board;
  assert.deepEqual(snapshot.groups, [{ ids: [id], dx, dy: 0 }]);
  await page.reload();
  await idle();
  assert.equal(await page.locator('#mode-switch').getAttribute('data-mode'), 'B');
  await enterCube();
  await openLevel(0);
  assert.deepEqual((await state()).session.board, snapshot);
  const rect = await page.locator('.jb-plane').boundingBox();
  const grip = cellCenter(rect, cols, col + dx, row);
  await page.screenshot({ path: 'test-results/jigsaw/table-rest.png' });
  await touch('touchStart', [grip]);
  const held = page.locator(`.jb-float.jb-held [data-flight-piece="${id}"]`);
  await held.waitFor({ state: 'visible' });
  const center = await held.evaluate(stamp => {
    const p = new DOMPoint(.5, .5).matrixTransform(stamp.getScreenCTM());
    return { x: p.x, y: p.y };
  });
  assert.ok(Math.hypot(grip.x - center.x, grip.y - center.y) < 1, 'a stationary press lifts the loose piece at its exact grip point');
  await page.screenshot({ path: 'test-results/jigsaw/table-held.png' });
  await touch('touchCancel', []);
  assert.equal(await page.locator('.jb-held, .jb-lifted, .jb-float [data-flight-piece]').count(), 0, 'cancelling a pickup clears its shadow and reveals the loose piece');
  assert.deepEqual((await state()).session.board, snapshot);
  await drag(grip, cellCenter(rect, cols, col, row));
  assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), '1');
}

async function verifyLargeBoardGesture(cols) {
  const last = page.locator('.jb-tray [data-piece]').last();
  await last.scrollIntoViewIfNeeded();
  await page.waitForFunction(() => document.querySelector('[data-tool="next"]').disabled);
  const { id, col, row, dx } = await placeTrayPiece(cols, { loose: true, source: last });
  const loose = (await state()).session.board;
  assert.ok(loose.groups.some(group => group.ids.includes(id) && Math.abs(group.dx - dx) < .01),
    'the last tray piece is loose one cell from home');

  const plane = page.locator('.jb-plane'), original = await plane.boundingBox();
  const home = cellCenter(original, cols, col, row);
  // Pan toward this piece while zooming so both its current cell and home stay visible.
  await pinchBoard(original, .7 * (original.x + original.width / 2 - home.x), .7 * (original.y + original.height / 2 - home.y));
  assert.deepEqual((await state()).session.board, loose);
  const enlarged = await plane.boundingBox();
  await drag(cellCenter(enlarged, cols, col + dx, row), cellCenter(enlarged, cols, col, row));
  assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), '2');
  assert.ok((await state()).session.board.groups.some(group => group.ids.includes(id) && group.dx === 0 && group.dy === 0),
    'the enlarged piece can be picked up at its new screen position and locked at home');
}

try {
  await mkdir('test-results/jigsaw', { recursive: true });
  const classic = freshProgress();
  classic.completed[0].fill(true);
  classic.completed[1].fill(true, 0, 53);
  classic.props = { preview: 5, hint: 3 };
  for (const key of Object.keys(classic.guides)) classic.guides[key] = true;
  const last = levelConfig(1, 5, 8);
  const positions = last.solution.slice(0, -1).reduce((p, m) => moveGroup(p, m.id, m.dx, m.dy), last.positions);
  classic.puzzles['1:5:8'] = { positions, gridSize: last.gridSize, layoutVersion: last.layoutVersion, stats: freshStats() };
  await context.addInitScript(({ key, classic }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(classic));
  }, { key: SAVE_KEY, classic });
  await page.goto(base);
  await idle();
  await verifyLockedSwitch();
  await enterCube();
  await openLevel(8);
  const toolbarLayout = () => page.locator('#settings, .puzzle-progress, .puzzle-tools button').evaluateAll(nodes =>
    nodes.map(node => node.getBoundingClientRect().toJSON()));
  const classicToolbar = await toolbarLayout();
  assert.deepEqual((await state()).session.positions, positions);
  const move = last.solution.at(-1), cell = xy(positions[move.id], last.gridSize);
  const from = await page.evaluate(id => window.__game.pieceCenter(id), move.id);
  const to = await page.evaluate(n => window.__game.cellCenter(n), (cell.y + move.dy) * last.gridSize + cell.x + move.dx);
  await drag(from, to);
  await continueWin(levelArt(1, 5, 8));
  const before = (await state()).progress;
  assert.ok(before.completed[1].every(Boolean));
  await verifySwitchReminder('B');
  assert.equal((await state()).theme, 0);
  assert.equal((await state()).progress.completed.flat().filter(Boolean).length, 0);
  const gearStyle = () => page.locator('#settings').evaluate(el => {
    const { backgroundColor, borderColor, borderRadius, color, boxShadow } = getComputedStyle(el);
    return { backgroundColor, borderColor, borderRadius, color, boxShadow };
  });
  const homeGear = await gearStyle();
  await page.screenshot({ path: 'test-results/jigsaw/home.png' });
  await waitForHandOn('#enter');
  await page.locator('#hand-guide[data-guide="rotateCube"]').waitFor();
  await drag({ x: 160, y: 415 }, { x: 250, y: 450 });
  assert.equal((await state()).progress.guides.rotateCube, true);
  await waitForHandOn('#enter');
  await enterCube();
  await page.locator('#hand-guide[data-guide="enterLevel"]').waitFor();

  for (let level = 0; level < 4; level++) {
    const size = levelConfig(0, 0, level).gridSize;
    const cols = 2 * (size - 1), rows = 3 * (size - 1);
    await openLevel(level);
    const { session } = await state();
    assert.equal(session.art, levelArt(0, 0, level));
    assert.equal(await page.locator('.jb-surface').getAttribute('viewBox'), `0 0 ${cols} ${rows}`);
    assert.equal(await page.locator('.jb-tray [data-piece]').count(), cols * rows);
    const board = await page.locator('.jb-plane').boundingBox();
    assert.ok(Math.abs(board.width / cols - board.height / rows) < .1, 'uncut cells are square');
    let placed = 0;
    if (level === 0) {
      assert.deepEqual((await page.locator('#game').innerText()).trim().split(/\s+/), ['28', '28']);
      assert.deepEqual(await gearStyle(), homeGear);
      assert.deepEqual(await toolbarLayout(), classicToolbar, 'B shares the exact classic toolbar layout');
      await page.screenshot({ path: 'test-results/jigsaw/board.png' });
      await tap('[data-tool="edge"]');
      assert.equal(await page.locator('.jb-tray [data-piece]').count(), 2 * (cols + rows) - 4);
      await tap('[data-tool="edge"]');
      await waitForHandOn('.jb-tray [data-piece]');
      assert.equal(await page.locator('#hand-guide').getAttribute('data-guide'), 'dragPuzzle');
      await page.locator('.jb-tray [data-piece]').first().tap();
      assert.equal((await state()).progress.guides.dragPuzzle, false, 'tapping a fragment does not teach dragging');
      await verifyResume(cols);
      assert.equal((await state()).progress.guides.dragPuzzle, true, 'a real drag is remembered after reload');
      await tap('#hint');
      assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), '2');
      assert.equal(await page.locator('#hint-count').textContent(), '27');
      await verifyPreview();
      assert.equal(await page.locator('#preview-count').textContent(), '27', 'closing a preview is free');
      await tap('#settings');
      assert.equal((await page.locator('#settings-menu').innerText()).trim(), '');
      await tap('#back'); await idle(); await openLevel(0);
      assert.deepEqual((await state()).progress.props, { hint: 27, preview: 27 });
      placed = 2;
    }
    for (; placed < cols * rows; placed++) {
      if (level === 0 && placed === cols * rows - 1) await tap('#hint');
      else await placeTrayPiece(cols);
      assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), String(placed + 1));
    }
    await continueWin(session.art);
    const result = await state(), key = `0:0:${level}`, record = result.progress.records[key];
    assert.equal(result.mode, 'chapters');
    assert.equal(result.face, level === 3 ? 1 : 0);
    assert.equal(result.progress.puzzles[key], undefined);
    assert.equal(record.columns, cols);
    assert.equal(record.rows, rows);
    assert.equal(record.moves, cols * rows + (level === 0 ? 1 : 0));
    assert.equal(record.previews, level === 0 ? 1 : 0);
    assert.equal(record.hints, level === 0 ? 2 : 0);
    assert.equal(await page.locator('#chapter-progress').getAttribute('aria-valuenow'), String(level === 3 ? 0 : level + 1));
    assert.deepEqual(await page.evaluate(() => window.__game.revealed().map(t => t.level).sort()), Array.from({ length: level + 1 }, (_, i) => i));
    if (level === 0) {
      await tap('#back'); await idle();
      await waitForHandOn('#mode-switch');
      await enterCube();
    }
    console.log(`PASS B${level + 1}: ${cols} × ${rows} real touch placements, win image and cube reveal`);
  }
  assert.ok(await page.locator('#chapter-pages [data-face="1"]').isEnabled());
  assert.ok(await page.locator('#next').isEnabled());
  await openLevel(0);
  assert.equal((await state()).session.art, levelArt(0, 1, 0), 'the newly unlocked face opens its own art');
  await tap('#settings'); await tap('#back'); await idle();
  await tap('#chapter-pages [data-face="0"]'); await idle();
  await waitForHandOn('#chapter-pages [data-face="1"]');
  await openLevel(0);
  assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), '0', 'completed puzzles replay from the full tray');
  assert.equal(await page.locator('.jb-tray [data-piece]').count(), 24);
  await tap('#settings');
  await tap('#back');
  await idle();
  await tap('#back');
  await idle();
  await verifySwitchReminder('A');
  assert.deepEqual((await state()).progress, before, 'B activity preserves classic progress, inventory and records');
  await page.reload();
  await idle();
  assert.equal(await page.locator('#mode-switch').getAttribute('data-mode'), 'A');
  assert.deepEqual((await state()).progress, before);
  await page.waitForTimeout(4200);
  assert.ok(await page.locator('#hand-guide').isHidden(), 'A no longer prompts entry to B');
  const lastSave = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), SAVE_KEY);
  lastSave.jigsaw.selected = 'B';
  lastSave.jigsaw.props = { hint: 1, preview: 1 };
  const inventoryContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await inventoryContext.addInitScript(({ key, save }) => localStorage.setItem(key, JSON.stringify(save)), { key: SAVE_KEY, save: lastSave });
  const lastItems = await inventoryContext.newPage();
  await lastItems.goto(base);
  await lastItems.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
  await lastItems.tap('#enter');
  await lastItems.waitForFunction(() => window.__game.idle());
  const firstTile = await lastItems.evaluate(() => window.__game.tileCenter(0));
  await lastItems.touchscreen.tap(firstTile.x, firstTile.y);
  await lastItems.locator('.jb-tray').waitFor();
  await lastItems.tap('#picture-peek');
  assert.equal(await lastItems.locator('#preview-count').textContent(), '0');
  assert.ok(await lastItems.locator('#picture-peek').isEnabled(), 'the last preview can be closed');
  assert.ok(await lastItems.locator('#hint').isDisabled());
  await lastItems.keyboard.press('Escape');
  assert.ok(await lastItems.locator('#picture-peek').isDisabled(), 'no preview stock after closing');
  await lastItems.tap('#hint');
  assert.ok(await lastItems.locator('#hint').isDisabled());
  assert.deepEqual(await lastItems.evaluate(key => JSON.parse(localStorage.getItem(key)).jigsaw.props, SAVE_KEY), { hint: 0, preview: 0 });
  await inventoryContext.close();
  await selectMode('B');
  await page.waitForTimeout(4200);
  assert.ok(await page.locator('#hand-guide').isHidden(), 'B remembers the return switch on subsequent visits');
  await tap('#settings'); await tap('#complete-all'); await idle();
  const completed = (await state()).progress.completed;
  assert.deepEqual(completed.map(levels => levels.filter(Boolean).length), [24, 54, 96]);
  // The first face already exercises 3x3. Open actual levels for the remaining
  // four classic sizes, including reordered photos from the last continent.
  for (const [theme, face, level, cols, rows] of [
    [0, 5, 3, 6, 9], [1, 5, 4, 8, 12], [2, 5, 15, 10, 15], [2, 5, 14, 12, 18],
  ]) {
    await tap(`#theme-pages [data-theme="${theme}"]`); await idle();
    await enterCube(); await tap(`#chapter-pages [data-face="${face}"]`); await idle();
    await openLevel(level);
    assert.equal((await state()).session.art, levelArt(theme, face, level));
    assert.equal(await page.locator('.jb-surface').getAttribute('viewBox'), `0 0 ${cols} ${rows}`);
    assert.equal(await page.locator('.jb-tray [data-piece]').count(), cols * rows);
    await tap('#hint');
    assert.equal(await page.locator('.puzzle-progress').getAttribute('aria-valuenow'), '1');
    if (cols === 12) await verifyLargeBoardGesture(cols);
    await tap('#settings'); await tap('#back'); await idle();
    await tap('#back'); await idle();
  }
  console.log('PASS all 174 B levels unlocked, all five grid sizes and matching photos across the three cubes.');
  assert.deepEqual(errors, []);
  console.log('PASS classic third-cube unlock, mode persistence, loose-piece resumption, full first face, replay and isolated saves.');
  await verifyJigsawFeedback(browser, base);
} finally {
  await browser.close();
}
