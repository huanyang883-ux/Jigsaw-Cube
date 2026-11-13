import { loading } from './loading.js';
import { HAND_ART, preloadAssets } from './preload.js';
import { SAVE_KEY, restoreProgress, currentFace, levelArt, nextPlayableLevel, THEMES } from './progress.js';

async function boot() {
  if (loading.failed) return;
  const ticket = loading.begin();
  let moduleReady = 0, assetsReady = 0;
  const report = () => ticket.progress(moduleReady * .2 + assetsReady * .65);
  try {
    let raw; try { raw = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { /* First launch. */ }
    const progress = restoreProgress(raw), face = currentFace(progress, 0);
    const level = nextPlayableLevel(progress, 0, face) ?? 0;
    const assets = [HAND_ART, levelArt(0, face, level), ...loading.retryAssets];
    for (let f = 0; f < 6; f++) if (progress.completed[0].slice(f * 4, f * 4 + 4).some(Boolean)) assets.push(THEMES[0].faceArt[f]);
    const [game] = await Promise.all([
      import('./main.js').then((module) => { moduleReady = 1; report(); return module; }),
      preloadAssets(assets, (fraction) => { assetsReady = fraction; report(); }),
    ]);
    if (!ticket.active) return;
    ticket.progress(.9);
    await game.startGame();
    ticket.progress(1); ticket.finish();
  } catch (error) { console.error(error); ticket.fail(error); }
}
boot();
