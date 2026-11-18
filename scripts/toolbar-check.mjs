import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { findHint, xy, moveGroup } from '../src/puzzle.js';
import { SAVE_KEY, freshProgress, faceSize } from '../src/progress.js';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const idle = (p) => p.waitForFunction(() => window.__game?.idle());
const state = (p) => p.evaluate(() => window.__game.state());
await fs.mkdir('test-results', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await context.newPage(), errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(base); await idle(p);
  const original = await p.locator('#settings').boundingBox();
  const homePlay = await p.locator('#enter').boundingBox();
  await p.tap('#enter'); await idle(p);
  assert.equal(await p.locator('#chapter-progress').getAttribute('aria-valuenow'), '0');
  assert.equal(await p.locator('#chapter-progress').getAttribute('aria-valuemax'), '4');
  assert.ok(await p.locator('#face-progress').isHidden());
  assert.deepEqual(await p.locator('#settings').boundingBox(), original, 'chapter settings match the home position');
  const chapterBack = await p.locator('#back').boundingBox();
  assert.ok(chapterBack.width < homePlay.width && chapterBack.width > homePlay.width * .8);
  assert.ok(Math.abs(chapterBack.x + chapterBack.width / 2 - 195) < 1 && Math.abs(chapterBack.y - homePlay.y) < 5);
  await p.tap('#settings'); await p.tap('#sound');
  assert.equal((await state(p)).progress.sound, true);
  const faceBefore = (await state(p)).face;
  await p.keyboard.press('ArrowRight'); assert.equal((await state(p)).face, faceBefore);
  await p.keyboard.press('Escape');
  await p.waitForSelector('#settings-menu', { state:'hidden' });
  await p.screenshot({ path:'test-results/chapter-controls.png' });
  const point = await p.evaluate(() => window.__game.tileCenter(0));
  await p.touchscreen.tap(point.x, point.y); await idle(p);
  assert.equal(await p.locator('#level-progress').count(), 0, 'level dots are removed');
  assert.ok(await p.locator('#sound').isHidden() && await p.locator('#back').isHidden(), 'return and sound live in the collapsed settings');
  const tool = await p.locator('#hint').boundingBox();
  assert.ok(Math.abs(tool.width - original.width) < .1 && Math.abs(tool.height - original.height) < .1);
  assert.deepEqual(await p.locator('#settings').boundingBox(), original, 'all three screens share the settings position');
  assert.ok(tool.x > 195 && Math.abs(tool.y - original.y) < .1, 'tools are aligned at the upper right');
  for (const [width, height] of [[320,568], [390,844], [430,932], [768,1024], [844,390], [1920,1080]]) {
    await p.setViewportSize({ width, height }); await p.waitForTimeout(100);
    const layout = await p.evaluate(() => {
      const box = (selector) => { const r = document.querySelector(selector).getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; };
      return { hint:box('#hint'), preview:box('#picture-peek'), progress:box('.puzzle-progress'), settings:box('#settings'), board:box('.puzzle-frame'), scroll:document.documentElement.scrollWidth };
    });
    assert.ok(layout.settings.right < layout.progress.x && layout.progress.right < layout.hint.x && layout.hint.right < layout.preview.x, 'settings, progress and right-side tools never overlap');
    assert.ok(layout.board.y > layout.settings.bottom && layout.board.x >= 0 && layout.board.right <= width + 1 && layout.board.bottom < height, `larger cards remain inside the usable viewport: ${JSON.stringify({ width, height, ...layout })}`);
    assert.equal(layout.scroll, width);
  }
  await p.setViewportSize({ width:390, height:844 }); await p.waitForTimeout(100);
  await p.screenshot({ path:'test-results/puzzle-toolbar.png' });
  await p.tap('#settings'); await p.waitForTimeout(240);
  assert.equal(await p.locator('#settings').getAttribute('aria-expanded'), 'true');
  assert.equal(await p.locator('#settings-menu button:not([hidden])').count(), 2);
  const before = await state(p), menu = await p.locator('#settings-menu').boundingBox(), gear = await p.locator('#settings').boundingBox();
  assert.ok(menu.y > gear.y + gear.height && menu.x >= 0 && menu.x + menu.width <= 390, 'dropdown opens below the gear and stays on screen');
  await p.screenshot({ path:'test-results/puzzle-settings-open.png' });
  await p.tap('#sound');
  assert.equal((await state(p)).progress.sound, !before.progress.sound);
  assert.equal(await p.evaluate(key => JSON.parse(localStorage.getItem(key)).sound, SAVE_KEY), !before.progress.sound);
  assert.equal(await p.locator('#settings').getAttribute('aria-expanded'), 'true', 'sound toggle keeps settings open');
  await p.touchscreen.tap(195, 810); await p.waitForSelector('#settings-menu', { state:'hidden' });
  assert.equal(await p.locator('#settings').getAttribute('aria-expanded'), 'false', 'blank-area tap closes the dropdown');

  const positions = (await state(p)).session.positions, hint = findHint(positions), n = Math.sqrt(positions.length), at = xy(positions[hint.id], n);
  const from = await p.evaluate(id => window.__game.pieceCenter(id), hint.id);
  const to = await p.evaluate(cell => window.__game.cellCenter(cell), (at.y + hint.dy) * n + at.x + hint.dx);
  const cdp = await context.newCDPSession(p);
  async function drag() {
    await cdp.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[from] });
    for (let i=1;i<=8;i++) await cdp.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:from.x+(to.x-from.x)*i/8, y:from.y+(to.y-from.y)*i/8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[] }); await idle(p);
  }
  await p.tap('#settings'); await drag();
  assert.deepEqual((await state(p)).session.positions, positions, 'dismissing over the board cannot move a card');
  await p.waitForTimeout(250); await drag();
  assert.deepEqual((await state(p)).session.positions, moveGroup(positions, hint.id, hint.dx, hint.dy), 'the next drag works with the enlarged board');
  await p.waitForTimeout(250); await p.tap('#settings');
  await p.keyboard.press('Escape'); await p.waitForSelector('#settings-menu', { state:'hidden' });
  assert.equal(await p.evaluate(() => document.activeElement.id), 'settings');
  await p.keyboard.press('Enter'); assert.equal(await p.locator('#settings').getAttribute('aria-expanded'), 'true');
  await p.keyboard.press('Escape');
  await p.tap('#picture-peek'); await p.waitForSelector('#close-picture'); await p.tap('#close-picture');
  assert.equal((await state(p)).progress.props.preview, before.progress.props.preview - 1);
  const saved = (await state(p)).session.positions;
  await p.tap('#settings'); await p.tap('#back'); await idle(p);
  assert.equal((await state(p)).mode, 'chapters');
  assert.deepEqual((await state(p)).progress.puzzles['0:0:0'].positions, saved);
  await p.waitForSelector('#sound', { state:'hidden' });
  assert.ok(await p.locator('#sound').isHidden() && await p.locator('#back').isVisible());
  assert.ok(await p.locator('#settings').isVisible() && await p.locator('#hint').isHidden());
  await p.tap('#back'); await idle(p); assert.equal((await state(p)).mode, 'home');
  assert.equal((await p.locator('body').innerText()).trim(), '');
  for (const theme of [0, 1, 2]) {
    const chapterContext = await browser.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true });
    const progress = freshProgress(), total = faceSize(theme);
    for (let i = 0; i < theme; i++) progress.completed[i].fill(true);
    progress.completed[theme].fill(true, 0, total);
    progress.completed[theme][total] = true; progress.completed[theme][total * 2 - 1] = true;
    await chapterContext.addInitScript(({key,progress}) => localStorage.setItem(key, JSON.stringify(progress)), {key:SAVE_KEY,progress});
    const q = await chapterContext.newPage(); q.on('pageerror', e => errors.push(e.message));
    await q.goto(base); await idle(q); await q.tap('#enter'); await idle(q);
    assert.equal((await state(q)).face, 1);
    assert.equal(await q.locator('#chapter-progress').getAttribute('aria-valuenow'), '2');
    assert.equal(await q.locator('#chapter-progress').getAttribute('aria-valuemax'), String(total));
    assert.equal(await q.locator('#chapter-progress .chapter-dot').count(), total);
    assert.equal(await q.locator('#chapter-progress .done').count(), 2);
    assert.equal((await q.locator('#chapter-progress').innerText()).trim(), '');
    assert.deepEqual(await q.locator('#chapter-progress .chapter-dot').evaluateAll(dots => dots.flatMap((dot, i) => dot.classList.contains('done') ? [i] : [])), [0, total - 1]);
    for (const [width,height] of [[320,568],[390,844],[768,1024],[844,390]]) {
      await q.setViewportSize({width,height}); await q.waitForTimeout(80);
      const layout = await q.evaluate(() => Object.fromEntries(['#chapter-targets','#chapter-progress','#back','#chapter-pages'].map(selector => {
        const {x,y,width,height,bottom,right}=document.querySelector(selector).getBoundingClientRect();
        return [selector,{x,y,width,height,bottom,right}];
      })));
      const rows = Object.values(layout);
      for (const rect of rows) assert.ok(rect.x >= 0 && rect.right <= width + 1 && rect.y >= 0 && rect.bottom < height);
      for (let i=1;i<rows.length;i++) assert.ok(rows[i-1].bottom < rows[i].y, 'chapter grid, progress, return and face tabs have separate space');
    }
    await q.setViewportSize({width:390,height:844});
    await q.tap('#settings'); await q.keyboard.press('ArrowRight');
    assert.equal((await state(q)).face, 1, 'open settings block face switching');
    await q.keyboard.press('Escape'); await q.waitForSelector('#settings-menu',{state:'hidden'});
    await q.screenshot({path:`test-results/chapter-progress-${total}.png`});
    await q.tap('#previous'); await idle(q);
    assert.equal((await state(q)).face, 0);
    assert.equal(await q.locator('#chapter-progress').getAttribute('aria-valuenow'), String(total));
    assert.equal(await q.locator('#chapter-progress .done').count(), total);
    await q.tap('#next'); await idle(q);
    assert.equal(await q.locator('#chapter-progress').getAttribute('aria-valuenow'), '2');
    await q.tap('#back'); await idle(q); assert.equal((await state(q)).mode,'home');
    await chapterContext.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: compact icon toolbar at six viewport sizes, enlarged cards, dropdown placement, sound persistence, blank-area dismissal, no accidental drag, keyboard close, preview and saved return.');
} finally { await browser.close(); }
