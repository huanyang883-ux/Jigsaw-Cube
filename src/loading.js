// The controller lives in the first HTML response, independently of module loading.
export const loading = window.puzzleLoading;
const minimumSwitchMs = 500;

// Let the cover paint before the synchronous scene/texture updates.
export async function withLoadingTransition(changeScene) {
  const screen = document.querySelector('#loading');
  const ticket = loading.begin();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  async function fade(opacity, duration) {
    if (document.hidden) return;
    const animation = screen.animate({ opacity: reduced ? [1, 1] : opacity }, { duration: reduced ? 1 : duration, easing: 'ease-in-out' });
    const finishInBackground = () => { if (document.hidden) animation.finish(); };
    document.addEventListener('visibilitychange', finishInBackground);
    try { await animation.finished; }
    finally { document.removeEventListener('visibilitychange', finishInBackground); }
  }
  // Reserve the final stretch for when the new scene is ready.
  function advance(from, to) {
    const start = performance.now(), duration = (to - from) * minimumSwitchMs;
    return new Promise(resolve => {
      function step() {
        if (!ticket.active) { resolve(); return; }
        const elapsed = performance.now() - start;
        ticket.progress(from + (to - from) * Math.min(1, elapsed / duration));
        if (elapsed >= duration) resolve();
        else setTimeout(step, Math.min(32, duration - elapsed));
      }
      step();
    });
  }

  async function prepareScene() {
    await fade([0, 1], 140);
    if (ticket.active) await changeScene();
  }

  screen.classList.add('switch-loading');
  try {
    await Promise.all([advance(0, .85), prepareScene()]);
    if (!ticket.active) return;
    await advance(.85, 1);
    if (!ticket.active) return;
    await fade([1, 0], 180);
    ticket.finish();
  } finally {
    screen.classList.remove('switch-loading');
  }
}
