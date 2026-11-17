import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { assertPortraitArt } from './art-check-utils.mjs';
import { chromium } from 'playwright';
import { LEVEL_CONFIGS, artUrl } from '../src/progress.js';
import { moveGroup, xy, groups, connectionCount } from '../src/puzzle.js';
const baseline = 'art-source/experiments/remaining-animals-v2/before';
const chapters = ['ocean', 'land', 'ancient'];
const changed = await assertPortraitArt(chapters);
const oldLayouts = [...JSON.parse(await fs.readFile(baseline + '/first12-layouts.json', 'utf8')), ...JSON.parse(await fs.readFile(baseline + '/later-layouts.json', 'utf8'))];
const rebuilt = [];
for (const previous of oldLayouts) {
  const current = LEVEL_CONFIGS[previous.number - 1];
  if (!chapters.includes(previous.chapter)) { assert.deepEqual(current, previous); continue; }
  for (const field of ['gridSize', 'artId', 'difficulty']) assert.deepEqual(current[field], previous[field]);
  assert.equal(current.solution.length, previous.solution.length);
  assert.equal(current.audit.provenMinimum, previous.audit.provenMinimum);
  assert.equal(connectionCount(current.positions), 0);
  assert.ok(groups(current.positions).every(group => group.length === 1));
  assert.equal(current.layoutVersion, current.gridSize === 5 ? 5 : 4);
  assert.equal(current.maxInitialLinks, 0);
  if (connectionCount(previous.positions) === 0) {
    assert.deepEqual(current.positions, previous.positions);
    assert.deepEqual(current.solution, previous.solution);
    assert.deepEqual(current.audit, previous.audit);
  } else {
    assert.notDeepEqual(current.positions, previous.positions);
    rebuilt.push(current.number);
  }
  if (current.gridSize === 5) assert.deepEqual(current, previous);
}
assert.deepEqual(rebuilt, [25, 26, 27, 30, 31, 32, 33, 43, 44, 46, 48, 49, 50, 51, 70, 71, 73, 75, 77, 78]);
assert.equal(LEVEL_CONFIGS.filter(l => l.theme === 1 && connectionCount(l.positions) === 0 && groups(l.positions).every(g => g.length === 1)).length, 54);
console.log('PASS: 27 images are 2:3; square covers retained; grids and route lengths preserved; all 54 animal levels start with separate pieces.');
const selected = process.argv.find(arg => arg.startsWith('--level='));
const selectedLevel = selected ? Number(selected.slice(8)) : null;
assert.ok(selectedLevel === null || LEVEL_CONFIGS.some(l => chapters.includes(l.chapter) && l.number === selectedLevel), 'select an ocean, land or ancient level');
const output = selectedLevel ? `test-results/remaining-level${selectedLevel}-v2` : 'test-results/remaining-animals-v2';
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const idle = p => p.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
const state = p => p.evaluate(() => window.__game.state());
const report = [], errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const p = await context.newPage(), cdp = await context.newCDPSession(p);
  p.on('pageerror', error => errors.push(error.message));
  p.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await p.goto(base); await idle(p);
  await p.tap('#settings'); await p.tap('#complete-all'); await idle(p);
  assert.ok((await state(p)).progress.completed.flat().every(Boolean));
  assert.deepEqual((await state(p)).progress.records, {}, 'completion shortcut does not invent play records');
  await p.tap('#enter'); await idle(p);
  for (const entry of LEVEL_CONFIGS.filter(l => chapters.includes(l.chapter) && (selectedLevel === null || l.number === selectedLevel))) {
    while ((await state(p)).face !== entry.face) { await p.tap('#next'); await idle(p); }
    const tile = await p.evaluate(level => window.__game.tileCenter(level), entry.level);
    await p.touchscreen.tap(tile.x, tile.y); await idle(p);
    let current = await state(p);
    assert.equal(current.session.art, artUrl(entry.artId));
    assert.deepEqual(current.session.positions, entry.positions);
    assert.equal(connectionCount(current.session.positions), entry.audit.initialLinks);
    assert.equal(current.session.positions.length, entry.gridSize ** 2);
    assert.equal(current.session.layoutVersion, entry.layoutVersion);
    assert.equal(Number(await p.locator('.puzzle-progress').getAttribute('aria-valuenow')), Math.round(entry.audit.initialLinks / (2 * entry.gridSize * (entry.gridSize - 1)) * 100));
    const geometry = await p.evaluate(() => window.__game.puzzleGeometry());
    assert.ok(Math.abs(geometry.aspect - 2 / 3) < .0001);
    await p.screenshot({ path: `${output}/level-${entry.number}-puzzle.png` });
    await p.tap('#picture-peek');
    await p.waitForFunction(() => { const img = document.querySelector('.overlay-card img'); return img?.complete && img.naturalWidth > 0; });
    const preview = await p.locator('.overlay-card img').evaluate(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight, ratio: img.clientWidth / img.clientHeight }));
    assert.equal(preview.src, artUrl(entry.artId)); assert.equal(preview.width, 960); assert.equal(preview.height, 1440);
    assert.ok(Math.abs(preview.ratio - 2 / 3) < .003);
    await p.tap('#close-picture'); await idle(p);
    for (const move of entry.solution) {
      const before = (await state(p)).session.positions, start = xy(before[move.id], entry.gridSize);
      const from = await p.evaluate(id => window.__game.pieceCenter(id), move.id);
      const to = await p.evaluate(cell => window.__game.cellCenter(cell), (start.y + move.dy) * entry.gridSize + start.x + move.dx);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 8, y: from.y + (to.y - from.y) * i / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await idle(p);
      assert.deepEqual((await state(p)).session.positions, moveGroup(before, move.id, move.dx, move.dy));
    }
    await p.waitForFunction(() => document.querySelector('#continue')?.disabled === false);
    current = await state(p); assert.equal(current.session.completed, true);
    assert.equal(current.progress.records[`${entry.theme}:${entry.face}:${entry.level}`].moves, entry.solution.length);
    await p.waitForFunction(() => document.querySelector('.win-card img')?.complete);
    assert.equal(await p.locator('.win-card img').getAttribute('src'), artUrl(entry.artId));
    await p.screenshot({ path: `${output}/level-${entry.number}-complete.png` });
    report.push({ level: entry.number, art: entry.artId, grid: entry.gridSize, initialLinks: entry.audit.initialLinks, solutionMoves: entry.solution.length, preview: 'passed', completion: 'passed' });
    console.log(`PASS: level ${entry.number}, ${entry.gridSize}x${entry.gridSize}, ${entry.audit.initialLinks} starting joins, ${entry.solution.length} touch moves, preview and completion.`);
    const button = await p.locator('#continue').boundingBox();
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }] });
    await p.waitForTimeout(60);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await p.waitForFunction(() => window.__game.state().mode === 'chapters'); await idle(p);
    assert.equal((await state(p)).face, entry.face, 'replays stay on the selected chapter');
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(`${output}/report.json`, JSON.stringify({ changed, rebuilt, animalLevelsWithZeroInitialLinks: 54, report, errors }, null, 2) + '\n');
} finally { await browser.close(); }
