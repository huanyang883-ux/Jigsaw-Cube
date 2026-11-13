// Offline only: the phone receives validated layouts, never this search workload.
import { groups, moveGroup, solved, xy, translation, findHint, connectionCount } from '../src/puzzle.js';

export const signature = (positions) => String.fromCharCode(...positions);
export function shapeKey(p) {
  const n = Math.sqrt(p.length), variants = [];
  for (let reflect = 0; reflect < 2; reflect++) for (let turn = 0; turn < 4; turn++) {
    const transform = (cell) => {
      let x = cell % n, y = Math.floor(cell / n); if (reflect) x = n - 1 - x;
      for (let i = 0; i < turn; i++) [x, y] = [n - 1 - y, x];
      return y * n + x;
    };
    const rotated = []; p.forEach((cell, id) => { rotated[transform(id)] = transform(cell); }); variants.push(rotated.join(','));
  }
  return variants.sort()[0];
}
export function moves(positions) {
  const n = Math.sqrt(positions.length), inverse = [];
  positions.forEach((cell, id) => { inverse[cell] = id; });
  const result = [], seen = new Set();
  for (const ids of groups(positions)) {
    const id = ids[0], start = xy(positions[id], n);
    const points = ids.map((piece) => xy(positions[piece], n));
    const left = -Math.min(...points.map((p) => p.x)), right = n - 1 - Math.max(...points.map((p) => p.x));
    const top = -Math.min(...points.map((p) => p.y)), bottom = n - 1 - Math.max(...points.map((p) => p.y));
    for (let dy = top; dy <= bottom; dy++) for (let dx = left; dx <= right; dx++) {
      if (!dx && !dy) continue;
      let state;
      if (ids.length === 1) {
        const other = inverse[(start.y + dy) * n + start.x + dx];
        state = [...positions]; [state[id], state[other]] = [state[other], state[id]];
      } else state = moveGroup(positions, id, dx, dy);
      const key = signature(state); if (seen.has(key)) continue; seen.add(key);
      result.push({ state, move: { id, dx, dy }, groupSize: ids.length });
    }
  }
  return result;
}

export function hintSolution(positions) {
  let state = [...positions]; const route = [];
  while (!solved(state) && route.length < positions.length) {
    const move = findHint(state); if (!move) throw new Error('No legal hint');
    const next = moveGroup(state, move.id, move.dx, move.dy);
    if (next.filter((p, id) => p === id).length <= state.filter((p, id) => p === id).length) throw new Error('Hint failed to make permanent progress');
    route.push(move); state = next;
  }
  if (!solved(state)) throw new Error('No complete solution');
  return route;
}

function finishInOne(state) {
  const wrong = state.filter((cell, id) => cell !== id).length;
  for (const ids of groups(state)) {
    if (wrong > ids.length * 2) continue;
    const id = ids[0], offset = translation(state, id);
    if (!offset.x && !offset.y) continue;
    const move = { id, dx: -offset.x, dy: -offset.y };
    if (solved(moveGroup(state, id, move.dx, move.dy))) return move;
  }
  return null;
}

// Exhaustively rule out short solutions. Budget exhaustion is explicitly unknown.
export function searchWithin(positions, depth, maxNodes = 500000) {
  let nodes = 0, exhausted = false;
  const visited = new Map();
  function visit(state, remaining) {
    if (++nodes > maxNodes) { exhausted = true; return null; }
    if (solved(state)) return [];
    if (!remaining) return null;
    const key = signature(state);
    if ((visited.get(key) ?? -1) >= remaining) return null;
    visited.set(key, remaining);
    const finish = finishInOne(state); if (finish) return [finish];
    if (remaining === 1) return null;
    const next = moves(state);
    next.sort((a, b) => score(b.state) - score(a.state));
    for (const option of next) {
      const tail = visit(option.state, remaining - 1);
      if (tail) return [option.move, ...tail];
      if (exhausted) break;
    }
    return null;
  }
  const solution = visit(positions, depth);
  return { solution, exhausted, nodes };
}

function score(state) { return state.filter((p, id) => p === id).length * 3 + connectionCount(state); }

export function improveSolution(positions, width = 28) {
  let best = hintSolution(positions), beam = [{ state: positions, route: [] }];
  const visited = new Set([signature(positions)]);
  for (let depth = 0; depth < best.length - 1 && beam.length; depth++) {
    const candidates = [];
    for (const entry of beam) for (const option of moves(entry.state)) {
      const key = signature(option.state); if (visited.has(key)) continue; visited.add(key);
      const route = [...entry.route, option.move];
      if (solved(option.state)) { if (route.length < best.length) best = route; continue; }
      candidates.push({ state: option.state, route, score: score(option.state) });
    }
    candidates.sort((a, b) => b.score - a.score);
    beam = candidates.slice(0, width);
    for (const entry of beam) {
      const tail = hintSolution(entry.state);
      if (entry.route.length + tail.length < best.length) best = [...entry.route, ...tail];
    }
  }
  return best;
}
