import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { freshProgress, freshStats, initialLayout, levelConfig, restoreProgress, saveSlot } from '../src/progress.js';
import { restoreAccount } from '../src/gameplay-progress.js';
import { createJigsaw, jigsawConfig } from '../src/jigsaw.js';

const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const release = process.argv.includes('--release');
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const idle = p => p.waitForFunction(() => document.querySelector('#loading')?.hidden && document.querySelector('#settings')?.disabled === false && document.querySelector('#game')?.dataset.mode === 'home');
const stored = p => p.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
async function switchTo(p, mode) {
  await p.tap('#mode-switch');
  await p.tap(`#mode-switch-alternate[data-mode="${mode}"]`);
  await idle(p);
  assert.equal(await p.locator('.viewport').getAttribute('data-play-mode'), mode);
}

async function pressTrophy(p) {
  await p.tap('#settings'); await p.tap('#complete-all'); await idle(p);
}

async function resetMode(p, confirm = true) {
  const mode = await p.locator('.viewport').getAttribute('data-play-mode');
  await p.tap('#settings'); await p.tap('#reset-account');
  assert.equal(await p.locator('.reset-card h2').innerText(), `Reset mode ${mode}?`);
  await p.tap(confirm ? '#confirm-reset' : '#cancel-reset'); await idle(p);
}

async function verifyResetOrder() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  try {
    const classic = freshProgress(), stats = { ...freshStats(), moves: 5 };
    classic.completed[0].fill(true); classic.completed[1].fill(true);
    classic.props.hint = 11;
    classic.sound = true; classic.guides.enterChapter = true;
    const board = createJigsaw(jigsawConfig(0, 0, 1));
    board.drop(1, 1, 0);
    const slot = saveSlot('?trial=jigsaw');
    classic.jigsaw = { version: 1, selected: 'A', completed: { '0:0:0': true },
      records: { '0:0:0': { ...stats, columns: 4, rows: 6, completedAt: 333 } },
      puzzles: { '0:0:1': { board: board.serialize(), stats } }, props: { hint: 21, preview: 8 } };
    await context.addInitScript(([slot, save]) => {
      if (!localStorage.getItem(slot)) localStorage.setItem(slot, JSON.stringify(save));
    }, [slot, classic]);
    const page = await context.newPage();
    const snapshot = async () => restoreAccount(JSON.parse((await stored(page))[slot]));
    await page.goto(`${base}/?trial=jigsaw`); await idle(page);
    const originalB = (await snapshot()).B;
    assert.equal(originalB.records['0:0:0'].moves, 5);
    assert.ok(originalB.puzzles['0:0:1']);
    assert.ok(originalB.sound && originalB.guides.enterChapter, 'old shared settings migrate into B');
    await pressTrophy(page);
    assert.deepEqual((await snapshot()).B, originalB, 'A trophy preserves B');
    await resetMode(page);
    await page.reload(); await idle(page);
    assert.deepEqual((await snapshot()).B, originalB, 'resetting A preserves B records, unfinished boards and inventory');
    await switchTo(page, 'B');
    const freshA = (await snapshot()).A;
    assert.deepEqual(freshA, freshProgress());
    await pressTrophy(page);
    const afterTrophy = await snapshot();
    assert.deepEqual(afterTrophy.A, freshA, 'B trophy preserves A');
    assert.deepEqual(afterTrophy.B.completed.map(cube => cube.filter(Boolean).length), [24, 54, 96]);
    assert.deepEqual(afterTrophy.B.props, originalB.props);
    assert.deepEqual(afterTrophy.B.records, originalB.records);
    assert.deepEqual(afterTrophy.B.puzzles, {});
    await switchTo(page, 'A');
    await pressTrophy(page);
    await page.tap('#settings'); await page.tap('#sound'); await page.tap('#settings');
    await page.tap('#enter'); await page.tap('#back'); await idle(page);
    const fullA = (await snapshot()).A;
    assert.ok(fullA.sound && fullA.guides.enterChapter);
    await switchTo(page, 'B');
    const beforeCancel = (await stored(page))[slot];
    await resetMode(page, false);
    assert.equal((await stored(page))[slot], beforeCancel, 'cancel leaves both modes untouched');
    await resetMode(page);
    await page.reload(); await idle(page);
    const afterResetB = await snapshot();
    assert.deepEqual(afterResetB.A, fullA, 'B reset preserves all A progress');
    assert.deepEqual(afterResetB.B.completed, freshProgress().completed);
    assert.deepEqual(afterResetB.B.props, freshProgress().props);
    assert.equal(afterResetB.B.sound, false);
    assert.deepEqual(afterResetB.B.guides, freshProgress().guides);
    assert.deepEqual(afterResetB.B.puzzles, {}); assert.deepEqual(afterResetB.B.records, {});
    assert.ok(await page.locator('#mode-switch').isVisible());
    if (await page.locator('#mode-switch').getAttribute('data-mode') === 'B') await switchTo(page, 'A');
    await resetMode(page);
    await page.reload(); await idle(page);
    assert.ok(await page.locator('#mode-switch').isHidden(), 'B reset followed by A reset restores the original gate');
    assert.deepEqual((await snapshot()).A, freshProgress());
    console.log('PASS independent A/B trophies, resets, cancellation, saved unlock and ordered re-lock.');
  } finally {
    await context.close();
  }
}
await fs.mkdir('test-results/amphibians-chapter-v3', { recursive: true });
try {
  const progress = freshProgress(); progress.completed[0].fill(true); progress.completed[1].fill(true, 0, 9);
  if (release) progress.completed[1].fill(true);
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
      await p.tap('#settings'); await switchTo(p, 'B'); await p.tap('#settings');
      assert.equal(await p.locator('#settings-menu button:not([hidden])').count(), 1);
      assert.equal(await p.locator('#reset-account, #complete-all').count(), 0);
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
    after = await stored(p); assert.deepEqual(restoreProgress(JSON.parse(after[key])), freshProgress());
    await p.reload(); await idle(p);
    assert.ok(await p.locator('#mode-switch').isVisible(), 'A reset preserves the unlock even before the first visit to B');
    for (const name of Object.keys(before)) if (name !== key) assert.equal(after[name], before[name]);
    console.log(`PASS: ${search || 'normal'} complete-all, preservation, reload, unlocked faces, cancel, reset and save isolation.`);
  }
  if (!release) await verifyResetOrder();
  assert.deepEqual(errors, []);
  console.log(release ? 'PASS: release settings show only sound; both test controls are absent in every save mode.' : 'PASS: home test menu placement and actions in all three save modes.');
} finally { await browser.close(); }
