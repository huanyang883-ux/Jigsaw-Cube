import assert from 'node:assert/strict';
import { chromium, devices, webkit } from 'playwright';
import { SAVE_KEY } from '../src/progress.js';

const useWebKit = process.env.PUZZLE_ENGINE === 'webkit';
const browser = useWebKit ? await webkit.launch() : await chromium.launch({
  executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
});
try {
  const { defaultBrowserType, ...phone } = devices['iPhone 13'];
  const page = await browser.newPage(phone);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('crash', () => errors.push('Page crashed'));
  let documents = 0;
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) documents++; });
  const idle = () => page.waitForFunction(() => document.querySelector('#loading')?.hidden && !document.querySelector('#game')?.classList.contains('is-busy'));
  await page.goto(process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173'); await idle();
  await page.tap('#settings'); await page.tap('#complete-all'); await idle();
  await page.evaluate(() => {
    window.cubeBufferWrites = 0;
    new MutationObserver(records => {
      window.cubeBufferWrites += records.filter(r => r.target instanceof HTMLCanvasElement).length;
    }).observe(document.querySelector('#cube-host'), { subtree: true, attributes: true, attributeFilter: ['width', 'height'] });
  });
  const portrait = phone.viewport, landscape = { width: portrait.height, height: portrait.width };
  for (let i = 0; i < 24; i++) {
    if (i % 3 === 0) await page.locator(`#theme-pages [data-theme="${[0, 3, 1, 2][Math.floor(i / 3) % 4]}"]`).click();
    await page.setViewportSize(i % 2 ? portrait : landscape);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await idle();
  const stats = await page.evaluate(key => ({
    bufferWrites: window.cubeBufferWrites, canvases: document.querySelectorAll('#cube-host canvas').length,
    selected: document.querySelector('.theme-page[aria-pressed="true"]')?.dataset.theme,
    completed: JSON.parse(localStorage.getItem(key)).completed.flat().filter(Boolean).length,
  }), SAVE_KEY);
  console.log(useWebKit ? 'WebKit' : 'Chromium', stats);
  assert.equal(documents, 1);
  assert.equal(stats.bufferWrites, 0);
  assert.equal(stats.canvases, 1);
  assert.equal(stats.selected, '2');
  assert.equal(stats.completed, 174);
  await page.tap('#enter'); await idle();
  assert.equal(await page.locator('#game').getAttribute('data-mode'), 'chapters');
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
