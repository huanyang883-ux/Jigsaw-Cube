import fs from 'node:fs/promises';
import { groups, connectionCount, moveGroup } from '../src/puzzle.js';
import { hintSolution, improveSolution, searchWithin } from './level-search.mjs';

const specs = [
  ['cake', 3, 'intro', 2, 'medium', 'Layered strawberry cake; clear plate and fruit anchors.'],
  ['cake', 3, 'intro', 3, 'medium', 'Cupcakes and flowers; establish local matching before moving groups.'],
  ['cake', 3, 'normal', 4, 'easy', 'Peach mousse silhouette and contrasting plate support a harder layout.'],
  ['cake', 3, 'challenge', 5, 'easy', 'Chocolate roll spiral and green tablecloth supply strong visual anchors.'],
  ['candy', 3, 'normal', 4, 'medium', 'Lollipop bouquet; repeated circles balanced by jug and window.'],
  ['candy', 3, 'normal', 5, 'medium', 'Candy jar, ribbon and scoop create identifiable regions.'],
  ['candy', 3, 'challenge', 5, 'hard', 'Repeated rainbow ribbons and gummies pair with the chapter challenge.'],
  ['candy', 3, 'relief', 4, 'medium', 'Glass cloche and pastel marshmallows; a shorter layout ends the chapter.'],
  ['jelly', 4, 'intro', 6, 'easy', 'Red strawberry jelly is easy to locate when introducing 16 pieces.'],
  ['jelly', 4, 'normal', 7, 'medium', 'Three parfait glasses and the character give distinct local landmarks.'],
  ['jelly', 4, 'challenge', 8, 'easy', 'Blue-purple dome provides visual clues while the layout carries difficulty.'],
  ['jelly', 4, 'relief', 6, 'medium', 'Citrus ring and fruit; a shorter route before revealing the full face.'],
];
function shuffle(size, seed) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const p = Array.from({ length: size * size }, (_, i) => i);
  for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  return p;
}
function shapeKey(p) {
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

const levels = [], used = new Set();
for (let index = 0; index < specs.length; index++) {
  const [chapter, gridSize, difficulty, target, imageDifficulty, imageNotes] = specs[index];
  let chosen;
  for (let attempt = 0; attempt < 800 && !chosen; attempt++) {
    const seed = 20261113 + index * 100003 + attempt * 997, positions = shuffle(gridSize, seed);
    const fixed = positions.filter((p, id) => p === id).length, sizes = groups(positions).map((g) => g.length);
    if (fixed > (index < 2 ? 3 : 1) || Math.max(...sizes) > (index < 2 ? 3 : 2) || used.has(shapeKey(positions))) continue;
    const hints = hintSolution(positions);
    if (hints.length < target || (index < 2 && hints.length > target + 1)) continue;
    const solution = improveSolution(positions, gridSize === 3 ? 20 : 36);
    if (solution.length !== target) continue;
    const checkedDepth = gridSize === 3 ? target - 1 : 4;
    const check = searchWithin(positions, checkedDepth, gridSize === 3 ? 1000000 : 2500000);
    if (check.solution || check.exhausted) continue;
    let cursor = positions, groupMoves = 0, peakGroup = Math.max(...sizes);
    for (const move of solution) {
      if (groups(cursor).find((g) => g.includes(move.id)).length > 1) groupMoves++;
      cursor = moveGroup(cursor, move.id, move.dx, move.dy);
      peakGroup = Math.max(peakGroup, ...groups(cursor).map((g) => g.length));
    }
    chosen = {
      number: index + 1, chapter, artId: `${chapter}-${String(index % 4 + 1).padStart(2, '0')}`,
      gridSize, difficulty, layoutVersion: 2, seed, imageDifficulty, imageNotes, positions, solution,
      audit: { initialCorrect: fixed, initialGroups: sizes, initialLinks: connectionCount(positions),
        provenMinimum: checkedDepth + 1, solutionMoves: solution.length, exact: gridSize === 3,
        hintMoves: hints.length, groupMoves, peakGroup, checkedNodes: check.nodes },
    };
    used.add(shapeKey(positions));
    console.log(`Level ${index + 1}: ${chapter} ${gridSize}x${gridSize}, ${difficulty}, ${checkedDepth + 1}..${solution.length} moves, ${hints.length} hints, seed ${seed}`);
  }
  if (!chosen) throw new Error(`Could not produce validated level ${index + 1}`);
  levels.push(chosen);
}
await fs.writeFile('src/first12-layouts.json', JSON.stringify(levels, null, 2) + '\n');
console.log('Wrote 12 fixed, independently validated layouts.');
