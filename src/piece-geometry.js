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
  const placed = xy(positions[id], n);
  const present = (x, y) => {
    if (x < 0 || x >= n || y < 0 || y >= n) return false;
    const p = xy(positions[y * n + x], n);
    return p.x - x === placed.x - home.x && p.y - y === placed.y - home.y;
  };
  // Three occupied quadrants share ONE concave arc, including the tile
  // diagonally opposite the missing quadrant (which has no exposed edge).
  const corners = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => {
    const vx = home.x + (sx + 1) / 2, vy = home.y + (1 - sy) / 2;
    const missing = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([qx, qy]) => !present(vx + (qx - 1) / 2, vy - (qy + 1) / 2));
    return missing.length === 1 ? missing[0] : null;
  });
  const diagonals = [
    (joins.left || joins.bottom) && present(home.x - 1, home.y + 1),
    (joins.right || joins.bottom) && present(home.x + 1, home.y + 1),
    (joins.left || joins.top) && present(home.x - 1, home.y - 1),
    (joins.right || joins.top) && present(home.x + 1, home.y - 1),
  ];
  return {
    left, right, top, bottom, joins, corners, diagonals, height,
    u0: (home.x + .5 + left) / n, u1: (home.x + .5 + right) / n,
    v0: 1 - (home.y + .5 - bottom / height) / n,
    v1: 1 - (home.y + .5 - top / height) / n,
  };
}

export function photoLayout(aspect) {
  const ratio = Math.max(.35, Math.min(3, aspect));
  // The compact top toolbar leaves this entire region available for cards.
  const maxWidth = 1008, maxHeight = 1548, frame = 36, top = 260, bottom = 1844;
  const width = Math.min(maxWidth, maxHeight * ratio), height = width / ratio;
  return { width: width + frame, height: height + frame, left: (1080 - width - frame) / 2, top: top + (bottom - top - height - frame) / 2 };
}
