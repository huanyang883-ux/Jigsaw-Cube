// The portrait stage is 1080 units wide in either orientation. On a phone,
// rotate the CSS layout without reallocating the canvas for every viewport size.
export function stageResolution(displayScale) {
  const dpr = Math.min(devicePixelRatio, 2);
  const shortEdge = Math.min(screen.width, screen.height);
  if (shortEdge > 0 && matchMedia('(pointer: coarse)').matches) {
    return Math.min(720, shortEdge * dpr) / 1080;
  }
  return Math.max(1 / 1080, displayScale * dpr);
}
