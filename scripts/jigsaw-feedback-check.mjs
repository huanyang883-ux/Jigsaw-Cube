import assert from 'node:assert/strict';
import { freshProgress, levelArt, saveSlot } from '../src/progress.js';
import { createJigsaw, jigsawConfig } from '../src/jigsaw.js';
import { assertPuzzlePreview } from './assert-puzzle-preview.mjs';

// Use normal motion here. The full-level touch tests use reduced motion.
export async function verifyJigsawFeedback(browser, base) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  try {
    const key = '0:0:0', lastId = 5;
    const classic = freshProgress();
    classic.completed[0].fill(true);
    classic.completed[1].fill(true);
    const model = createJigsaw(jigsawConfig(0, 0, 0));
    for (const piece of model.pieces) if (piece.id !== lastId) model.drop(piece.id, piece.col, piece.row);
    classic.jigsaw = { version: 1, selected: 'B', puzzles: { [key]: { board: model.serialize() } } };
    const url = new URL(base);
    url.searchParams.set('trial', 'jigsaw');
    await context.addInitScript(([slot, save]) => localStorage.setItem(slot, JSON.stringify(save)), [saveSlot(url.search), classic]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const idle = () => page.waitForFunction(() => window.__game?.idle() && document.querySelector('#loading').hidden);
    await page.goto(url.href);
    await idle();
    await page.tap('#enter');
    await idle();
    const tile = await page.evaluate(() => window.__game.tileCenter(0));
    await page.touchscreen.tap(tile.x, tile.y);
    await page.waitForSelector('.jb-tray [data-piece]');
    await idle();

    const edge = page.locator('[data-tool="edge"]');
    await edge.tap();
    assert.equal(await page.locator('.jb-tray [data-piece]').count(), 0);
    // A new interaction with the table must restart the five-second timer.
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      document.addEventListener('pointerup', () => { window.lastTableTap = performance.now(); }, { capture: true, once: true });
    });
    await page.locator('.jb-window').tap();
    const guide = page.locator('#hand-guide[data-guide="clearEdgeFilter"]');
    await guide.waitFor({ state: 'visible', timeout: 8500 });
    const quiet = await page.evaluate(() => performance.now() - window.lastTableTap);
    assert.ok(quiet >= 4900, 'edge guide waits five seconds after the most recent interaction');
    const guideMiss = await page.evaluate(() => {
      const game = document.querySelector('#game').getBoundingClientRect();
      const target = document.querySelector('.jb-filter').getBoundingClientRect();
      const hand = document.querySelector('#hand-guide');
      return Math.hypot(game.x + parseFloat(hand.style.left) * game.width / 1080 - target.x - target.width / 2,
        game.y + parseFloat(hand.style.top) * game.height / 1920 - target.y - target.height / 2);
    });
    assert.ok(guideMiss < 2, 'hand points at the edge filter');
    await edge.tap();
    assert.ok(await guide.isHidden());
    const last = page.locator('.jb-tray [data-piece="' + lastId + '"] svg');
    const from = await last.boundingBox();
    const plane = await page.locator('.jb-plane').boundingBox();
    const cell = plane.width / model.cols;
    // Leave a quarter-cell gap between the release point and the correct position.
    const target = { x: plane.x + (lastId % model.cols + .75) * cell, y: plane.y + (Math.floor(lastId / model.cols) + .5) * cell };
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [target] });
    await page.waitForSelector('.jb-float use', { state: 'attached' });
    await page.evaluate(id => {
      const result = window.dropFeedback = { x: [], maxParticles: 0, retained: false, staticDestination: false };
      const moving = document.querySelector('.jb-float');
      document.addEventListener('pointerup', () => {
        const sample = () => {
          const now = performance.now(), particles = window.__game.celebration();
          if (!result.burst) {
            if (moving.matches('.jb-landing')) {
              result.retained ||= !!moving.querySelector('[data-flight-piece="' + id + '"]');
              const destination = document.querySelector('.jb-pieces > use[href$="-' + id + '"]');
              result.staticDestination ||= !destination;
              result.x.push(moving.getBoundingClientRect().x);
            }
            if (particles > 0) result.burst = now;
          }
          result.maxParticles = Math.max(result.maxParticles, particles);
          if (document.querySelector('.win-card')) result.overlay = now;
          else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      }, { once: true, capture: true });
    }, lastId);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => window.dropFeedback.maxParticles > 0, undefined, { timeout: 5000 });
    const confetti = page.locator('.jb-plane > canvas.win-confetti');
    assert.ok(await confetti.isVisible());
    await page.waitForTimeout(500);
    const painted = await confetti.evaluate(canvas => {
      const probe = document.createElement('canvas');
      probe.width = 80;
      probe.height = 120;
      const ctx = probe.getContext('2d');
      ctx.drawImage(canvas, 0, 0, probe.width, probe.height);
      return ctx.getImageData(0, 0, probe.width, probe.height).data.some((v, i) => i % 4 === 3 && v > 0);
    });
    assert.ok(painted, 'the common confetti canvas paints visible particles over the photo');
    await page.waitForFunction(() => !!window.dropFeedback.overlay);
    const feedback = await page.evaluate(() => window.dropFeedback);
    const positions = new Set(feedback.x.map(x => Math.round(x * 10) / 10));
    assert.ok(feedback.retained && feedback.staticDestination, 'the final piece uses the existing drag layer without rebuilding the finished board');
    assert.ok(positions.size >= 3 && Math.max(...positions) - Math.min(...positions) > 3, 'released piece traverses multiple visible positions before the burst');
    assert.equal(feedback.maxParticles, 90);
    assert.ok(feedback.overlay - feedback.burst >= 1850 && feedback.overlay - feedback.burst < 2800, 'normal win overlay follows two seconds of confetti');
    await assertPuzzlePreview(page, levelArt(0, 0, 0));
    await page.tap('#continue');
    await idle();
    assert.equal(await page.evaluate(() => window.__game.state().mode), 'chapters');
    assert.equal(await page.locator('#chapter-progress .done').count(), 1);
    assert.deepEqual(errors, []);
    console.log('PASS five-second edge-filter guide, multi-frame drop, 90 rendered confetti particles and timed chapter return.');
  } finally {
    await context.close();
  }
}
