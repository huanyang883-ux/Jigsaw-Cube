export const HAND_ART = '/assets/ui/guide-hand.webp?v=069c618d42ca';
const activeLoads = new Set();

export async function loadImageAsset(url, onProgress = () => {}, { signal, background = false } = {}) {
  url = new URL(url, location.href).href;
  if (!background) window.puzzleLoading.track(url);
  const abort = new AbortController();
  const cancel = () => abort.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  activeLoads.add(abort);
  let timeout, objectURL;
  const arm = () => { clearTimeout(timeout); timeout = setTimeout(cancel, 45000); };
  try {
    arm();
    const response = await fetch(url, { cache: 'force-cache', priority: background ? 'low' : 'high', signal: abort.signal });
    if (!response.ok) throw new Error(`Asset load failed (${response.status})`);
    const total = Number(response.headers.get('Content-Length'));
    let blob;
    if (response.body && total > 0 && !response.headers.get('Content-Encoding')) {
      const reader = response.body.getReader(), chunks = []; let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.length; arm();
        onProgress(Math.min(.94, received / total * .94));
      }
      blob = new Blob(chunks, { type: response.headers.get('Content-Type') });
    } else blob = await response.blob();
    objectURL = URL.createObjectURL(blob);
    const image = new Image(); image.src = objectURL;
    await image.decode();
    if (abort.signal.aborted) throw abort.signal.reason;
    onProgress(1);
    return image;
  } catch (cause) {
    const error = new Error('Asset could not be downloaded or decoded', { cause }); error.resourceUrl = url;
    if (abort.signal.reason === 'RESOURCE_RESET') error.code = 'RESOURCE_RESET';
    throw error;
  } finally {
    clearTimeout(timeout);
    if (objectURL) URL.revokeObjectURL(objectURL);
    signal?.removeEventListener('abort', cancel);
    activeLoads.delete(abort);
  }
}

if (typeof window !== 'undefined') window.addEventListener('sweet-cube:clear-assets', () => {
  for (const abort of activeLoads) abort.abort('RESOURCE_RESET');
});
