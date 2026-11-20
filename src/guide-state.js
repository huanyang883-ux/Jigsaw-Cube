import { groups, clampDelta, moveGroup, connectionCount, solved } from './puzzle.js';

export const GUIDE_ACTIONS = Object.freeze(['rotateCube', 'enterChapter', 'enterLevel', 'dragPuzzle']);
export const freshGuides = () => Object.fromEntries(GUIDE_ACTIONS.map((key) => [key, false]));
export function learnGuide(progress, action) {
  if (!GUIDE_ACTIONS.includes(action) || progress.guides[action]) return false;
  progress.guides[action] = true;
  return true;
}

export function chooseGuide({ mode, idleMs, learned, canEnter, hasLevel, canSwitchFace, canDrag, emptyEdgeTray }) {
  if (mode === 'home') {
    if (idleMs >= 5000 && !learned.rotateCube) return 'rotateCube';
    if (idleMs >= 3000 && canEnter && !learned.enterChapter) return 'enterChapter';
  }
  // Level selection stays helpful after the player has learned the controls.
  if (mode === 'chapters' && idleMs >= 5000) {
    if (hasLevel) return 'enterLevel';
    if (canSwitchFace) return 'switchFace';
  }
  if (mode === 'puzzle' && idleMs >= 5000 && emptyEdgeTray) return 'clearEdgeFilter';
  if (mode === 'puzzle' && idleMs >= 400 && canDrag && !learned.dragPuzzle) return 'dragPuzzle';
  return null;
}

// A short legal gesture, preferably making a connection. This only describes a
// path for the hand: it neither changes the board nor invokes a hint prop.
export function guideMove(positions) {
  if (solved(positions)) return null;
  let best = null, bestScore = -Infinity;
  for (const ids of groups(positions)) for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
    const d = clampDelta(positions, ids, dx, dy);
    if (d.x !== dx || d.y !== dy) continue;
    const id = ids[0], next = moveGroup(positions, id, dx, dy);
    const score = connectionCount(next) * 100 + next.filter((cell, i) => cell === i).length * 2 - ids.length;
    if (score > bestScore) { bestScore = score; best = { id, dx, dy }; }
  }
  return best;
}
