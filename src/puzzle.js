// Pure puzzle rules. Positions are board cells indexed left-to-right, top-to-bottom.
// Correct neighbours share a translation from their home positions, exactly as
// runPuzzle / refreshLinks in the supplied playable reference.
export const SIZE = 3;
export const COUNT = SIZE * SIZE;
export const INITIAL_POSITIONS = [0, 4, 2, 6, 1, 8, 3, 7, 5];
export const boardSize = (positions) => Math.sqrt(positions.length);
export const xy = (cell, size = SIZE) => ({ x: cell % size, y: Math.floor(cell / size) });
export const cellAt = (x, y, size = SIZE) => y * size + x;

export function valid(positions) {
  if (!Array.isArray(positions)) return false;
  const size = boardSize(positions);
  return [3, 4, 5].includes(size) && new Set(positions).size === positions.length &&
    positions.every((p) => Number.isInteger(p) && p >= 0 && p < positions.length);
}

export function translation(positions, id) {
  const size = boardSize(positions), home = xy(id, size), pos = xy(positions[id], size);
  return { x: pos.x - home.x, y: pos.y - home.y };
}

export function linked(positions, a, b) {
  const size = boardSize(positions), ah = xy(a, size), bh = xy(b, size);
  if (Math.abs(ah.x - bh.x) + Math.abs(ah.y - bh.y) !== 1) return false;
  const at = translation(positions, a), bt = translation(positions, b);
  return at.x === bt.x && at.y === bt.y;
}

export function groups(positions, subset = [...positions.keys()]) {
  const unseen = new Set(subset), result = [];
  while (unseen.size) {
    const first = unseen.values().next().value, group = [first];
    unseen.delete(first);
    for (let i = 0; i < group.length; i++) {
      for (const id of unseen) {
        if (linked(positions, group[i], id)) { group.push(id); unseen.delete(id); }
      }
    }
    result.push(group);
  }
  return result;
}

export const groupFor = (positions, id) => groups(positions).find((g) => g.includes(id));
export const solved = (positions) => positions.every((cell, id) => cell === id);
export function connectionCount(positions) {
  let result = 0;
  for (let a = 0; a < positions.length; a++) for (let b = a + 1; b < positions.length; b++) {
    if (linked(positions, a, b)) result++;
  }
  return result;
}

export function clampDelta(positions, ids, dx, dy) {
  const size = boardSize(positions), points = ids.map((id) => xy(positions[id], size));
  return {
    x: Math.max(-Math.min(...points.map((p) => p.x)), Math.min(size - 1 - Math.max(...points.map((p) => p.x)), dx)),
    y: Math.max(-Math.min(...points.map((p) => p.y)), Math.min(size - 1 - Math.max(...points.map((p) => p.y)), dy)),
  };
}

// Keep the dragged group intact. Only obstructed pieces move out of its way.
// A small exact-cover search preserves obstructed subgroups when the holes fit;
// otherwise split them, matching the reference's blocker-unit displacement.
export function moveGroup(positions, id, dx, dy) {
  if (!valid(positions) || !Number.isInteger(id) || id < 0 || id >= positions.length || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Invalid puzzle state');
  const size = boardSize(positions);
  const ids = groupFor(positions, id);
  const delta = clampDelta(positions, ids, Math.round(dx), Math.round(dy));
  if (!delta.x && !delta.y) return [...positions];
  const selected = new Set(ids), next = [...positions];
  const target = new Set(ids.map((piece) => {
    const p = xy(positions[piece], size);
    next[piece] = cellAt(p.x + delta.x, p.y + delta.y, size);
    return next[piece];
  }));
  const blockers = positions.map((_, i) => i).filter((i) => !selected.has(i) && target.has(positions[i]));
  const holes = ids.map((i) => positions[i]).filter((cell) => !target.has(cell));
  const units = groups(positions, blockers).sort((a, b) => b.length - a.length);

  function pack(index, remaining) {
    if (index === units.length) return true;
    const unit = units[index], anchor = xy(positions[unit[0]], size);
    const choices = [...remaining].sort((a, b) => {
      const pa = xy(a, size), pb = xy(b, size);
      return Math.abs(pa.x - anchor.x) + Math.abs(pa.y - anchor.y) - Math.abs(pb.x - anchor.x) - Math.abs(pb.y - anchor.y);
    });
    for (const hole of choices) {
      const h = xy(hole, size), tx = h.x - anchor.x, ty = h.y - anchor.y;
      const cells = unit.map((piece) => {
        const p = xy(positions[piece], size), x = p.x + tx, y = p.y + ty;
        return x < 0 || x >= size || y < 0 || y >= size ? -1 : cellAt(x, y, size);
      });
      if (!cells.every((cell) => remaining.has(cell))) continue;
      unit.forEach((piece, i) => { next[piece] = cells[i]; });
      if (pack(index + 1, new Set([...remaining].filter((cell) => !cells.includes(cell))))) return true;
    }
    return false;
  }

  if (!pack(0, new Set(holes))) {
    // Bitmask assignment is bounded O(k * 2^k), avoiding factorial searches on 4×4 boards.
    const memo = new Map();
    function assign(index, mask) {
      if (index === blockers.length) return { cost: 0, cells: [] };
      if (memo.has(mask)) return memo.get(mask);
      const p = xy(positions[blockers[index]], size);
      let best = { cost: Infinity, cells: [] };
      for (let i = 0; i < holes.length; i++) {
        if (mask & (1 << i)) continue;
        const h = xy(holes[i], size), tail = assign(index + 1, mask | (1 << i));
        const cost = tail.cost + (p.x - h.x) ** 2 + (p.y - h.y) ** 2;
        if (cost < best.cost) best = { cost, cells: [holes[i], ...tail.cells] };
      }
      memo.set(mask, best); return best;
    }
    const best = assign(0, 0).cells;
    blockers.forEach((piece, i) => { next[piece] = best[i]; });
  }
  if (!valid(next)) throw new Error('Placement produced an overlap');
  return next;
}

// Breadth-first hints use legal group moves: hints never teleport or split the
// selected group. A bounded search is affordable for the first 3×3 level.
export function findHint(positions) {
  if (solved(positions)) return null;
  const size = boardSize(positions);
  const key = (state) => state.join(',');
  const visited = new Set([key(positions)]);
  const queue = [{ state: positions, first: null }];
  let best = null, bestScore = -Infinity;
  for (let head = 0; head < queue.length && head < (size === 3 ? 16000 : 160); head++) {
    const entry = queue[head];
    for (const group of groups(entry.state)) {
      const id = group[0];
      for (let dy = 1 - size; dy < size; dy++) for (let dx = 1 - size; dx < size; dx++) {
        if (!dx && !dy) continue;
        const d = clampDelta(entry.state, group, dx, dy);
        if (d.x !== dx || d.y !== dy) continue;
        const state = moveGroup(entry.state, id, dx, dy), signature = key(state);
        if (visited.has(signature)) continue;
        visited.add(signature);
        const first = entry.first ?? { id, dx, dy };
        if (solved(state)) return first;
        const score = connectionCount(state) * 4 + state.filter((p, i) => p === i).length;
        if (score > bestScore) { bestScore = score; best = first; }
        queue.push({ state, first });
      }
    }
  }
  return best;
}
