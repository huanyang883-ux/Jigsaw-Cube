import { loading } from './loading.js';
import { HAND_ART, loadImageAsset } from './preload.js';

async function boot() {
  if (loading.failed) return;
  const ticket = loading.begin();
  let moduleReady = 0, assetsReady = 0;
  const report = () => ticket.progress(moduleReady * .2 + assetsReady * .25);
  try {
    const assets = [...new Set([HAND_ART, loading.retryImage].filter(Boolean))];
    const fractions = assets.map(() => 0);
    const [game] = await Promise.all([
      import('./main.js').then((module) => { moduleReady = 1; report(); return module; }),
      Promise.all(assets.map((url, index) => loadImageAsset(url, (fraction) => {
        fractions[index] = fraction; assetsReady = fractions.reduce((sum, part) => sum + part, 0) / assets.length; report();
      }))),
    ]);
    if (!ticket.active) return;
    await game.startGame((fraction) => ticket.progress(.45 + fraction * .5));
    ticket.progress(1); ticket.finish();
  } catch (error) { console.error(error); ticket.fail(error); }
}
boot();
