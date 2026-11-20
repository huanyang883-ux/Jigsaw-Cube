import { levelConfig } from './progress.js';

// These four pictures already have saved cuts from the original prototype.
const originalSeeds = new Map([['cake-01', 9071], ['cake-02', 2683], ['cake-03', 5351], ['cake-04', 7669]]);
const previousCakeColumns = new Map([[2683, 6], [7669, 8]]);

// A 2:3 photo has 2n by 3n square cells before the interlocking cuts.
export function jigsawGrid(classicSize) {
  if (!Number.isInteger(classicSize) || classicSize < 3 || classicSize > 7) return null;
  return { cols: 2 * (classicSize - 1), rows: 3 * (classicSize - 1) };
}

export function jigsawConfig(theme, face, level) {
  if (![theme, face, level].every(Number.isInteger)) return null;
  const classic = levelConfig(theme, face, level);
  if (!classic) return null;
  const grid = jigsawGrid(classic.gridSize);
  return grid && { ...grid, seed: originalSeeds.get(classic.artId) ?? classic.seed };
}

// An ongoing game and its completion record keep the cuts the player used.
export function savedJigsawConfig(config, cols, rows) {
  if (cols === config.cols && rows === config.rows) return config;
  if (cols === previousCakeColumns.get(config.seed) && rows === 1.5 * cols) return { ...config, cols, rows };
  return null;
}

const round = value => Math.round(value * 10000) / 10000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const SNAP_RADIUS = 0.34;

function randomFrom(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

// A canonical edge runs left to right (horizontal) or top to bottom (vertical).
// Adjacent pieces traverse the very same cubic control points in opposite directions.
function makeSeam(random) {
  const c = 0.42 + 0.16 * random();
  const direction = random() < 0.5 ? -1 : 1;
  const depth = direction * (0.18 + 0.055 * random());
  const w = 0.105 + 0.025 * random();
  return [
    [0, 0],
    [c * 0.45, 0], [c - w * 0.22, -0.17 * depth], [c - w * 0.46, 0.23 * depth],
    [c - w * 0.52, 0.37 * depth], [c - w, 0.44 * depth], [c - w, 0.65 * depth],
    [c - w, 1.12 * depth], [c + w, 1.12 * depth], [c + w, 0.65 * depth],
    [c + w, 0.44 * depth], [c + w * 0.52, 0.37 * depth], [c + w * 0.46, 0.23 * depth],
    [c + w * 0.22, -0.17 * depth], [c + (1 - c) * 0.55, 0], [1, 0],
  ];
}

function sidePath(seam, vertical, offset, reverse) {
  const points = seam ?? [[0, 0], [1, 0]];
  const ordered = reverse ? points.slice().reverse() : points;
  const coords = ordered.slice(1).map(([along, across]) =>
    (vertical ? [offset + across, along] : [along, offset + across]).map(round).join(' '));
  return (seam ? 'C' : 'L') + coords.join(' ');
}

function cutPieces({ cols, rows, seed }) {
  const random = randomFrom(seed);
  const seams = length => Array.from({ length }, () => makeSeam(random));
  const vertical = seams(rows * (cols - 1)), horizontal = seams((rows - 1) * cols);
  return Array.from({ length: cols * rows }, (_, id) => {
    const col = id % cols, row = Math.floor(id / cols);
    const top = row > 0 ? horizontal[id - cols] : null;
    const right = col < cols - 1 ? vertical[row * (cols - 1) + col] : null;
    const bottom = row < rows - 1 ? horizontal[id] : null;
    const left = col > 0 ? vertical[row * (cols - 1) + col - 1] : null;
    const path = 'M0 0' + sidePath(top, false, 0, false) + sidePath(right, true, 1, false)
      + sidePath(bottom, false, 1, true) + sidePath(left, true, 0, true) + 'Z';
    return { id, col, row, path, edge: !(top && right && bottom && left), x: null, y: null, group: id, locked: false };
  });
}

function shuffledIds(pieces, seed) {
  const order = pieces.map(p => p.id);
  const random = randomFrom(seed ^ 0xdc7a391e);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function neighbors(id, cols, rows) {
  const ids = [];
  if (id % cols > 0) ids.push(id - 1);
  if (id % cols < cols - 1) ids.push(id + 1);
  if (id >= cols) ids.push(id - cols);
  if (id < (rows - 1) * cols) ids.push(id + cols);
  return ids;
}

function connected(ids, cols, rows) {
  const unseen = new Set(ids);
  const queue = [ids[0]];
  unseen.delete(ids[0]);
  for (let i = 0; i < queue.length; i++) {
    for (const neighbor of neighbors(queue[i], cols, rows)) {
      if (unseen.delete(neighbor)) queue.push(neighbor);
    }
  }
  return unseen.size === 0;
}

export function isJigsawSave(config, saved) {
  if (!config || !saved || saved.version !== 1 || saved.seed !== config.seed ||
    saved.cols !== config.cols || saved.rows !== config.rows || !Array.isArray(saved.groups)) return false;
  const { cols, rows } = config, count = cols * rows;
  if (saved.groups.length > count) return false;
  const seen = new Set();
  for (const group of saved.groups) {
    if (!group || !Array.isArray(group.ids) || !group.ids.length || group.ids.length > count ||
      !Number.isFinite(group.dx) || !Number.isFinite(group.dy) ||
      round(group.dx) !== group.dx || round(group.dy) !== group.dy) return false;
    for (const id of group.ids) {
      if (!Number.isInteger(id) || id < 0 || id >= count || seen.has(id)) return false;
      const x = id % cols + group.dx, y = Math.floor(id / cols) + group.dy;
      if (x < 0 || x > cols - 1 || y < 0 || y > rows - 1) return false;
      seen.add(id);
    }
    if (!connected(group.ids, cols, rows)) return false;
  }
  return true;
}

class Jigsaw {
  constructor(config, saved) {
    Object.assign(this, config);
    this.pieces = cutPieces(config);
    this.trayOrder = shuffledIds(this.pieces, this.seed);
    if (isJigsawSave(config, saved)) {
      for (const { ids, dx, dy } of saved.groups) this.positionGroup(ids, dx, dy);
    }
  }

  groupIds(id) {
    const group = this.pieces[id]?.group;
    return this.pieces.filter(p => p.group === group).map(p => p.id);
  }

  get placedCount() { return this.pieces.reduce((count, p) => count + Number(p.locked), 0); }
  get solved() { return this.placedCount === this.pieces.length; }

  positionGroup(ids, dx, dy) {
    const group = Math.min(...ids);
    for (const id of ids) {
      const p = this.pieces[id];
      Object.assign(p, { group, x: round(p.col + dx), y: round(p.row + dy), locked: dx === 0 && dy === 0 });
    }
  }

  returnToTray(id) {
    const p = this.pieces[id];
    if (!p || p.locked || p.x === null || this.groupIds(id).length !== 1) return false;
    p.x = p.y = null;
    return true;
  }

  placeHint() {
    let id = this.trayOrder.find(i => this.pieces[i].x === null);
    if (id === undefined) {
      const loose = this.serialize().groups.filter(group => group.dx !== 0 || group.dy !== 0);
      const group = loose.find(group => group.ids.length === 1) ?? loose[0];
      if (!group) return { id: null, changed: false, placed: 0, joined: false };
      [id] = group.ids;
      if (group.ids.length > 1) {
        // Take a piece that leaves the rest of the assembly connected and in place.
        const others = i => group.ids.filter(member => member !== i);
        id = group.ids.find(i => connected(others(i), this.cols, this.rows));
        this.positionGroup(others(id), group.dx, group.dy);
        this.pieces[id].group = id;
      }
    }
    const p = this.pieces[id];
    return { id, ...this.drop(id, p.col, p.row) };
  }

  drop(id, x, y) {
    const p = this.pieces[id], unchanged = { changed: false, placed: 0, joined: false };
    if (!p || p.locked || !Number.isFinite(x) || !Number.isFinite(y)) return unchanged;
    const ids = this.groupIds(id), moving = ids.map(i => this.pieces[i]);
    const xs = moving.map(piece => piece.col), ys = moving.map(piece => piece.row);
    const minX = -Math.min(...xs), maxX = this.cols - 1 - Math.max(...xs);
    const minY = -Math.min(...ys), maxY = this.rows - 1 - Math.max(...ys);
    let dx = round(clamp(x - p.col, minX, maxX)), dy = round(clamp(y - p.row, minY, maxY));
    const adjacent = new Map();
    for (const piece of moving) {
      for (const n of neighbors(piece.id, this.cols, this.rows)) {
        const other = this.pieces[n];
        if (other.x !== null && other.group !== p.group) adjacent.set(other.group, other);
      }
    }
    // Anchor at home when available. Otherwise use the nearest true neighbor.
    if (Math.hypot(dx, dy) <= SNAP_RADIUS) {
      dx = dy = 0;
    } else {
      let best = SNAP_RADIUS;
      let target = null;
      for (const other of adjacent.values()) {
        const ox = round(other.x - other.col), oy = round(other.y - other.row);
        if (ox < minX || ox > maxX || oy < minY || oy > maxY) continue;
        const distance = Math.hypot(ox - dx, oy - dy);
        if (distance <= best) { best = distance; target = { dx: ox, dy: oy }; }
      }
      if (target) ({ dx, dy } = target);
    }
    const oldX = p.x, oldY = p.y, merged = [...ids];
    for (const other of adjacent.values()) {
      if (round(other.x - other.col) === dx && round(other.y - other.row) === dy) {
        merged.push(...this.groupIds(other.id));
      }
    }
    const joined = merged.length > ids.length;
    this.positionGroup(merged, dx, dy);
    return { changed: joined || p.x !== oldX || p.y !== oldY, placed: p.locked ? ids.length : 0, joined };
  }

  serialize() {
    const groups = [];
    for (const p of this.pieces) {
      if (p.x !== null && p.id === p.group) {
        groups.push({ ids: this.groupIds(p.id), dx: round(p.x - p.col), dy: round(p.y - p.row) });
      }
    }
    return { version: 1, cols: this.cols, rows: this.rows, seed: this.seed, groups };
  }
}

export function createJigsaw(config, saved) {
  const previous = saved?.groups?.length && savedJigsawConfig(config, saved.cols, saved.rows);
  return new Jigsaw(previous && previous !== config && isJigsawSave(previous, saved) ? previous : config, saved);
}
