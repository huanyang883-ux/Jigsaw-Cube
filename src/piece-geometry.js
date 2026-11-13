import { boardSize, xy, linked } from './puzzle.js';

// Geometry and UVs use the same crop. Joined edges meet at their original image
// coordinates; unjoined edges retain a narrow gap without stretching the art.
export function pieceBounds(positions, id, aspect = 1) {
  const n = boardSize(positions), home = xy(id, n), height = 1 / aspect;
  const joins = {
    left: home.x > 0 && linked(positions, id, id - 1),
    right: home.x < n - 1 && linked(positions, id, id + 1),
    top: home.y > 0 && linked(positions, id, id - n),
    bottom: home.y < n - 1 && linked(positions, id, id + n),
  };
  // A subpixel overlap prevents antialiasing cracks between separate meshes.
  const gap = .011, overlap = .0004;
  const left = -.5 + (joins.left ? -overlap : gap);
  const right = .5 - (joins.right ? -overlap : gap);
  const top = (.5 - (joins.top ? -overlap : gap)) * height;
  const bottom = (-.5 + (joins.bottom ? -overlap : gap)) * height;
  return {
    left, right, top, bottom, joins,
    u0: (home.x + .5 + left) / n, u1: (home.x + .5 + right) / n,
    v0: 1 - (home.y + .5 - bottom / height) / n,
    v1: 1 - (home.y + .5 - top / height) / n,
  };
}

export function photoLayout(aspect) {
  const ratio = Math.max(.35, Math.min(3, aspect));
  const maxWidth = 936, maxHeight = 1240;
  const width = Math.min(maxWidth, maxHeight * ratio), height = width / ratio;
  return { width: width + 50, height: height + 50, left: (1080 - width - 50) / 2, top: 1553 - height - 50 };
}
