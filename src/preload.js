export const HAND_ART = '/assets/ui/guide-hand.webp?v=069c618d42ca';
const assets = new Map();
let warmQueue = [], warmTimer, warming = false;

const absoluteURL = (url) => new URL(url, location.href).href;
export function isPreloaded(url) { return assets.get(absoluteURL(url))?.done === true; }

async function verifyImage(blob) {
  if (typeof createImageBitmap === 'function') { const bitmap = await createImageBitmap(blob); bitmap.close(); return; }
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => { const image = new Image(); image.onload = resolve; image.onerror = reject; image.src = url; });
  } finally { URL.revokeObjectURL(url); }
}

function fetchAsset(url, listener, background) {
  url = absoluteURL(url); window.puzzleLoading.track(url);
  let task = assets.get(url);
  if (!task) {
    task = { done: false, fraction: 0, listeners: new Set(), abort: new AbortController() };
    assets.set(url, task);
    task.promise = (async () => {
      let timeout;
      const arm = () => { clearTimeout(timeout); timeout = setTimeout(() => task.abort.abort(), 45000); };
      try {
        arm();
        const response = await fetch(url, { cache: 'force-cache', priority: background ? 'low' : 'high', signal: task.abort.signal });
        if (!response.ok) throw new Error(`Asset load failed (${response.status})`);
        const total = Number(response.headers.get('Content-Length'));
        const report = (fraction) => { task.fraction = fraction; for (const callback of task.listeners) callback(fraction); };
        let blob;
        if (response.body && total > 0 && !response.headers.get('Content-Encoding')) {
          const reader = response.body.getReader(), chunks = []; let received = 0;
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            chunks.push(value); received += value.length; arm(); report(Math.min(.94, received / total * .94));
          }
          blob = new Blob(chunks, { type: response.headers.get('Content-Type') || 'image/webp' });
        } else blob = await response.blob();
        await verifyImage(blob);
        task.done = true; report(1);
      } finally { clearTimeout(timeout); }
    })().catch((cause) => {
      if (assets.get(url) === task) assets.delete(url);
      const error = new Error('Asset could not be downloaded or decoded', { cause }); error.resourceUrl = url;
      if (task.reset) error.code = 'RESOURCE_RESET';
      throw error;
    });
  }
  if (listener) { task.listeners.add(listener); listener(task.fraction); }
  return task.promise.finally(() => { if (listener) task.listeners.delete(listener); });
}

export async function preloadAssets(urls, onProgress = () => {}) {
  const unique = [...new Set(urls.filter(Boolean))];
  if (!unique.length) { onProgress(1); return; }
  const fractions = unique.map(() => 0);
  await Promise.all(unique.map((url, i) => fetchAsset(url, (fraction) => {
    fractions[i] = fraction; onProgress(fractions.reduce((sum, part) => sum + part, 0) / unique.length);
  }, false)));
}

async function warmNext() {
  warmTimer = null;
  if (warming || document.hidden) return;
  const url = warmQueue.shift(); if (!url) return;
  warming = true;
  try { await fetchAsset(url, null, true); } catch { /* Foreground loading can retry. */ }
  warming = false;
  if (warmQueue.length) warmTimer = setTimeout(warmNext, 250);
}

// Keep the background window small and sequential, especially on mobile data.
export function warmAssets(urls) {
  warmQueue = [...new Set(urls)].filter((url) => !isPreloaded(url));
  clearTimeout(warmTimer);
  warmTimer = setTimeout(warmNext, 900);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && warmQueue.length && !warmTimer) warmTimer = setTimeout(warmNext, 250); });

window.addEventListener('sweet-cube:clear-assets', () => {
  clearTimeout(warmTimer); warmTimer = null; warmQueue = [];
  for (const task of assets.values()) { task.reset = true; task.abort.abort(); }
  assets.clear();
});
