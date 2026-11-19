import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Browser-side integration check of the native bridge callbacks. This does
// not replace running the APK on an Android device / emulator.
const base = process.env.PUZZLE_TEST_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ executablePath: process.env.PUZZLE_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
await fs.mkdir('test-results', { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 720 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    const events = {};
    window.__nativeTest = { minimized: 0, hiddenBars: 0, emit: (name, data) => events[name]?.(data) };
    window.androidBridge = {};
    window.Capacitor = {
      PluginHeaders: [
        { name: 'App', methods: [
          { name: 'addListener', rtype: 'callback' },
          ...['removeListener', 'getState', 'minimizeApp'].map(name => ({ name, rtype: 'promise' })),
        ] },
        { name: 'SystemBars', methods: [{ name: 'hide', rtype: 'promise' }] },
      ],
      nativeCallback: (plugin, method, options, callback) => { events[options.eventName] = callback; return options.eventName; },
      nativePromise: async (plugin, method) => {
        if (method === 'getState') return { isActive: true };
        if (method === 'minimizeApp') window.__nativeTest.minimized++;
        if (method === 'hide') window.__nativeTest.hiddenBars++;
        return {};
      },
    };
    const AudioContext = window.AudioContext;
    window.AudioContext = class extends AudioContext { constructor(...args) { super(...args); window.__testAudio = this; } };
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const idle = () => page.waitForFunction(() => window.__game?.idle() && window.__nativeTest.hiddenBars > 0);
  const state = () => page.evaluate(() => window.__game.state());
  const back = () => page.evaluate(() => window.__nativeTest.emit('backButton', { canGoBack: false }));
  const active = isActive => page.evaluate(isActive => window.__nativeTest.emit('appStateChange', { isActive }), isActive);
  await page.goto(base); await idle();
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--game-safe-top', '48px');
    document.documentElement.style.setProperty('--game-safe-bottom', '28px');
  });
  await page.waitForFunction(() => document.querySelector('#game').getBoundingClientRect().height <= innerHeight - 76 + 1);
  const rect = await page.locator('#game').boundingBox();
  assert.ok(rect.y >= 47 && rect.y + rect.height <= 693, 'game fits between status/cutout and gesture areas');
  await page.screenshot({ path: 'test-results/android-safe-area.png' });
  await page.tap('#settings'); await page.tap('#sound');
  await page.waitForFunction(() => window.__testAudio?.state === 'running');
  await back(); await page.waitForSelector('#settings-menu', { state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__nativeTest.minimized), 0, 'back closes settings on the home screen');
  await page.tap('#enter'); await idle();
  await back(); await idle(); assert.equal((await state()).mode, 'home');
  await page.tap('#enter'); await idle();
  const center = await page.evaluate(() => window.__game.tileCenter(0));
  await page.touchscreen.tap(center.x, center.y); await idle();
  assert.equal((await state()).mode, 'puzzle');
  await page.tap('#picture-peek'); await page.waitForSelector('#close-picture');
  for (const { width, height, top, right, bottom, left } of [
    { width: 720, height: 360, top: 0, right: 12, bottom: 26, left: 64 },
    { width: 320, height: 568, top: 44, right: 0, bottom: 24, left: 0 },
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(insets => {
      for (const [edge, px] of Object.entries(insets)) document.documentElement.style.setProperty('--game-safe-' + edge, px + 'px');
    }, { top, right, bottom, left });
    await page.waitForFunction(scale => Math.abs(Number(document.documentElement.style.getPropertyValue('--stage-scale')) - scale) < .00001,
      Math.min((width - left - right) / 1080, (height - top - bottom) / 1920));
    for (const selector of ['#game', '#puzzle-board', '#settings', '#hint', '#picture-peek', '#overlay-content', '#close-picture']) {
      const box = await page.locator(selector).boundingBox();
      assert.ok(box.x >= left - 1 && box.x + box.width <= width - right + 1 &&
        box.y >= top - 1 && box.y + box.height <= height - bottom + 1, selector + ' fits the safe area');
    }
    const dialog = await page.locator('#overlay-content').boundingBox();
    assert.ok(Math.abs(2 * dialog.x + dialog.width - (width + left - right)) < 2 &&
      Math.abs(2 * dialog.y + dialog.height - (height + top - bottom)) < 2, 'preview centers inside asymmetric insets');
    if (width === 320) {
      const hint = await page.locator('#hint').boundingBox(), preview = await page.locator('#picture-peek').boundingBox();
      assert.ok(hint.width >= 47.9 && hint.height >= 47.9 && hint.x + hint.width < preview.x, 'small-phone touch targets stay large and separate');
    }
  }
  await back(); await page.waitForSelector('#overlay', { state: 'hidden' });
  assert.equal((await state()).mode, 'puzzle', 'back dismisses the preview before leaving gameplay');
  await page.tap('#hint'); await idle();
  const expected = (await state()).session.positions;
  await active(false);
  await page.waitForFunction(() => window.__testAudio.state === 'suspended');
  const pausedTime = (await state()).session.stats.activeMs;
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sweet-cube:progress:v2')));
  assert.deepEqual(saved.puzzles['0:0:0'].positions, expected, 'background transition flushes puzzle progress');
  await page.waitForTimeout(1100);
  await active(true);
  await page.waitForFunction(() => window.__testAudio.state === 'running');
  assert.ok((await state()).session.stats.activeMs - pausedTime < 400, 'background time is excluded');
  assert.ok(await page.evaluate(() => window.__nativeTest.hiddenBars >= 2));
  await back(); await idle(); assert.equal((await state()).mode, 'chapters');
  await back(); await idle(); assert.equal((await state()).mode, 'home');
  await back(); await page.waitForFunction(() => window.__nativeTest.minimized === 1);
  await page.reload(); await idle();
  assert.deepEqual((await state()).progress.puzzles['0:0:0'].positions, expected, 'progress survives a fresh WebView page');
  assert.deepEqual(errors, []);
  console.log('Android bridge browser checks passed: safe area, navigation, audio pause/resume, saving and background time.');
} finally { await browser.close(); }
