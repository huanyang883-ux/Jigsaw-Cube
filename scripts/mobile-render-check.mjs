import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
const portrait = { width: 390, height: 844 }, landscape = { width: 844, height: 390 };
const idle = (page) => page.waitForFunction(() => window.__game?.idle());
const frames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

try {
  const page = await browser.newPage({ viewport: portrait, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173');
  await idle(page);
  await page.evaluate(async () => {
    const { PuzzleRenderer } = await import('/src/renderer.js');
    const { CubeScene } = await import('/src/cube-scene.js');
    const init = PuzzleRenderer.prototype.init, setActive = CubeScene.prototype.setActive;
    PuzzleRenderer.prototype.init = function (...args) { window.boardRenderer = this; return init.apply(this, args); };
    CubeScene.prototype.setActive = function (...args) { window.menuRenderer = this; return setActive.apply(this, args); };
  });
  await page.tap('#enter'); await idle(page);
  const level = await page.evaluate(() => window.__game.tileCenter(0));
  await page.touchscreen.tap(level.x, level.y); await idle(page);
  assert.equal(await page.evaluate(() => window.__game.state().mode), 'puzzle');
  const initialPositions = await page.evaluate(() => window.__game.state().session.positions);
  await page.evaluate(() => {
    const board = window.boardRenderer;
    window.renderCounts = { board: 0, effects: 0, buffer: 0 };
    for (const [target, method, count] of [[board.three, 'render', 'board'], [board.pixi, 'render', 'effects'], [board.three, 'setDrawingBufferSize', 'buffer']]) {
      const original = target[method];
      target[method] = function (...args) { window.renderCounts[count]++; return original.apply(this, args); };
    }
  });
  await frames(page);
  assert.deepEqual(await page.evaluate(() => window.renderCounts), { board: 0, effects: 0, buffer: 0 });
  assert.equal(await page.evaluate(() => window.menuRenderer.frame), null, 'hidden cube schedules no frames');
  assert.equal(await page.evaluate(() => window.boardRenderer.frame), null, 'idle puzzle schedules no frames');

  for (const viewport of [landscape, portrait, landscape, portrait]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height, viewport);
    await frames(page);
    await page.evaluate(() => { for (let count = 0; count < 10; count++) window.dispatchEvent(new Event('resize')); });
    await frames(page);
  }
  assert.deepEqual(await page.evaluate(() => window.renderCounts), { board: 0, effects: 0, buffer: 0 });
  assert.deepEqual(await page.evaluate(() => window.__game.state().session.positions), initialPositions);
  assert.equal(await page.evaluate(() => window.puzzleLoading.failed), false);

  await page.evaluate(() => {
    const board = window.boardRenderer, canvas = board.three.domElement;
    window.contextExtension = board.three.getContext().getExtension('WEBGL_lose_context');
    canvas.addEventListener('webglcontextlost', () => { window.contextLost = true; }, { once: true });
    canvas.addEventListener('webglcontextrestored', () => { window.contextRestored = true; }, { once: true });
    window.contextExtension.loseContext();
  });
  await page.waitForFunction(() => window.contextLost);
  await page.evaluate(() => window.contextExtension.restoreContext());
  await page.waitForFunction(() => window.contextRestored);
  await frames(page);
  assert.deepEqual(await page.evaluate(() => window.renderCounts), { board: 1, effects: 0, buffer: 0 });

  await page.evaluate(() => {
    window.levelTexture = window.boardRenderer.baseTexture;
    window.levelTexture.addEventListener('dispose', () => { window.levelTextureDisposed = true; });
  });
  await page.tap('#settings'); await page.tap('#back'); await idle(page);
  assert.equal(await page.evaluate(() => window.__game.state().mode), 'chapters');
  assert.ok(await page.evaluate(() => window.levelTextureDisposed && window.levelTexture.image === null));
  assert.notEqual(await page.evaluate(() => window.menuRenderer.frame), null, 'returning to the cube resumes drawing');

  const tilt = await page.evaluate(async () => {
    const host = document.createElement('div');
    Object.assign(host.style, { width: '270px', height: '405px', position: 'absolute' });
    document.body.append(host);
    const board = new window.boardRenderer.constructor(host, Array.from({ length: 81 }, (_, id) => id), {});
    const art = document.createElement('canvas'); art.width = 2; art.height = 3;
    await board.init(art.toDataURL());
    board.startDrag(40, { x: 0, y: 0 }, null);
    const results = [];
    for (const [dx, dy] of [[2, 2], [2, -2], [-2, 2], [-2, -2]]) {
      board.dragDelta(dx, dy);
      board.scene.updateMatrixWorld(true);
      const lowest = Math.min(...board.cards.flatMap(({ mesh }) => [-.5, .5].flatMap((x) => [-.5, .5].map((y) =>
        mesh.localToWorld(mesh.position.clone().set(x, y * board.cellHeight, -.031)).z))));
      results.push({ clearance: lowest - board.cards[0].shadow.position.z, delta: board.drag.delta, tilt: board.cards[40].mesh.quaternion.w });
    }
    board.destroy(); host.remove();
    return results;
  });
  assert.ok(tilt.every(({ clearance, delta, tilt }) => clearance > 0 && delta.x === 0 && delta.y === 0 && tilt < 1));
  await page.tap('#back'); await idle(page);
  await page.tap('#theme-pages [data-theme="3"]'); await idle(page); await frames(page);
  assert.equal(await page.evaluate(() => window.menuRenderer.renderer.info.render.calls), 3 * 25 + 3,
    '5x5 home submits three faces of stickers, one instanced shell and two arrows');
  await page.evaluate(() => {
    const cube = window.menuRenderer;
    document.querySelector('#theme-pages [data-theme="0"]').click();
    window.cubeExtension = cube.renderer.getContext().getExtension('WEBGL_lose_context');
    window.cubeExtension.loseContext();
  });
  await page.waitForFunction(() => window.menuRenderer.contextLost && window.menuRenderer.frame === null);
  await page.setViewportSize(landscape);
  await page.evaluate(() => window.cubeExtension.restoreContext());
  await idle(page); await frames(page);
  assert.ok(await page.evaluate(() => !window.menuRenderer.contextLost && window.menuRenderer.frame != null && window.__game.state().theme === 0));
  assert.deepEqual(errors, []);
  console.log('PASS: phone rotation reuses the puzzle buffer and preserves progress, WebGL restores, and blocked groups stay above their shadows.');
} finally {
  await browser.close();
}
