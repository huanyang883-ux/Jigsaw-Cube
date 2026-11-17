import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { continents, continentGrids, northAmericaScenes } from './continent-plan.mjs';
import { valid, groups, connectionCount, moveGroup, solved } from '../src/puzzle.js';
import { hintSolution, shapeKey } from './level-search.mjs';

const old = [...JSON.parse(await fs.readFile('src/first12-layouts.json', 'utf8')), ...JSON.parse(await fs.readFile('src/later-layouts.json', 'utf8'))];
const used = new Set(old.map(l => shapeKey(l.positions))), levels = [];
for (const [face, chapter] of continents.entries()) for (const [level, gridSize] of continentGrids[face].entries()) {
  const number = 79 + face * 16 + level;
  let chosen;
  for (let attempt = 0; !chosen && attempt < 2000; attempt++) {
    const seed = 20261117 + number * 100003 + attempt * 997;
    let randomState = seed >>> 0;
    const random = () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 2 ** 32; };
    const positions = Array.from({ length: gridSize ** 2 }, (_, id) => id);
    for (let i = positions.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [positions[i], positions[j]] = [positions[j], positions[i]]; }
    const fixed = positions.filter((p, id) => p === id).length;
    if (fixed > 1 || connectionCount(positions) || used.has(shapeKey(positions))) continue;
    const solution = hintSolution(positions), bounds = { 4: [7, 13], 5: [12, 22], 6: [18, 31], 7: [25, 42] }[gridSize];
    if (solution.length < bounds[0] || solution.length > bounds[1]) continue;
    let cursor = [...positions], groupMoves = 0;
    for (const move of solution) {
      if (groups(cursor).some(g => g.length > 1 && g.includes(move.id))) groupMoves++;
      cursor = moveGroup(cursor, move.id, move.dx, move.dy);
      assert.ok(valid(cursor));
    }
    if (groupMoves < 2) continue;
    assert.ok(solved(cursor));
    const imageDifficulty = face === 0 ? northAmericaScenes[level][1] : 'placeholder';
    chosen = {
      number, theme: 2, face, level, chapter: chapter.id, artId: `${chapter.id}-${String(level + 1).padStart(2, '0')}`,
      gridSize, layoutVersion: 6, difficulty: gridSize === 7 || face === 0 && gridSize === 6 ? 'challenge' : 'normal',
      imageDifficulty, imageNotes: face === 0 ? northAmericaScenes[level][0] : '白图占位，后续制作',
      placeholder: face !== 0, maxInitialLinks: 0, seed, positions, solution,
      audit: { initialCorrect: fixed, initialGroups: groups(positions).map(g => g.length), initialLinks: 0, solutionMoves: solution.length, exact: false, hintMoves: solution.length, groupMoves },
    };
  }
  if (!chosen) throw new Error(`No validated continent board for level ${number}.`);
  used.add(shapeKey(chosen.positions)); levels.push(chosen);
  console.log(`${number}: ${chapter.id}-${level + 1}, ${gridSize}x${gridSize}, ${chosen.solution.length} verified moves, zero joins`);
}
await fs.writeFile('src/continent-layouts.json', JSON.stringify(levels, null, 2) + '\n');
console.log('Saved 96 unique continent boards; existing 78 levels unchanged.');
