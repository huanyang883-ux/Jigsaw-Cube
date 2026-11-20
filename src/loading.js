// The controller lives in the first HTML response, independently of module loading.
export const loading = window.puzzleLoading;

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
  await fade([0, 1], 140);
  if (!ticket.active) return;
  ticket.progress(.35);
  changeScene();
  ticket.progress(1);
  await fade([1, 0], 180);
  ticket.finish();
}
