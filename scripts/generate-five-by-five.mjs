// Replace only the six animal 3x3 boards; preserve every other level and image.
import fs from 'node:fs/promises';
import { groups, connectionCount, moveGroup, solved } from '../src/puzzle.js';
import { hintSolution, improveSolution, searchWithin, shapeKey } from './level-search.mjs';
import { levelPlan } from './level-plan.mjs';

const first = JSON.parse(await fs.readFile('src/first12-layouts.json', 'utf8'));
const levels = JSON.parse(await fs.readFile('src/later-layouts.json', 'utf8'));
const specs = levelPlan.filter(l => l.gridSize === 5);
const replaced = new Set(specs.map(l => l.number));
const used = new Set([...first, ...levels.filter(l => !replaced.has(l.number))].map(l => shapeKey(l.positions)));
const checkpointFile = '.local/five-by-five-layouts-v5.json';
await fs.mkdir('.local', { recursive: true });
let checkpoint = [];
try { checkpoint = JSON.parse(await fs.readFile(checkpointFile, 'utf8')); } catch { /* First run. */ }

function candidate(seed) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const positions = Array.from({ length: 25 }, (_, i) => i);
  for (let i = 24; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  return positions;
}

for (const spec of specs) {
  let chosen = checkpoint.find(l => l.number === spec.number && l.plan === JSON.stringify(spec))?.value;
  for (let attempt = 0; !chosen && attempt < 3000; attempt++) {
    const seed = 20261116 + spec.number * 100003 + attempt * 997, positions = candidate(seed);
    const fixed = positions.filter((p, id) => p === id).length;
    if (connectionCount(positions) || fixed > 1 || used.has(shapeKey(positions))) continue;
    const hints = hintSolution(positions);
    if (hints.length < spec.target || hints.length > spec.target + 5) continue;
    const solution = improveSolution(positions, 32);
    console.log(`Searching ${spec.number}: attempt ${attempt}, route ${solution.length}/${spec.target}.`);
    if (solution.length !== spec.target) continue;
    let cursor = positions, groupMoves = 0;
    for (const move of solution) {
      if (groups(cursor).find(g => g.includes(move.id)).length > 1) groupMoves++;
      cursor = moveGroup(cursor, move.id, move.dx, move.dy);
    }
    if (!solved(cursor) || groupMoves < 2) continue;
    const check = searchWithin(positions, 3, 500000);
    if (check.solution || check.exhausted) continue;
    const { target, ...config } = spec;
    chosen = { ...config, seed, positions, solution, audit: {
      initialCorrect: fixed, initialGroups: groups(positions).map(g => g.length), initialLinks: 0,
      provenMinimum: 4, solutionMoves: solution.length, exact: false, hintMoves: hints.length,
      groupMoves, checkedNodes: check.nodes,
    } };
  }
  if (!chosen) throw new Error(`No validated 5x5 layout for ${spec.number}; game data has not been overwritten.`);
  used.add(shapeKey(chosen.positions));
  checkpoint = [...checkpoint.filter(l => l.number !== spec.number), { number: spec.number, plan: JSON.stringify(spec), value: chosen }];
  await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');
  levels[levels.findIndex(l => l.number === spec.number)] = chosen;
  console.log(`Selected ${spec.number}: 25 separate tiles, ${chosen.solution.length} verified moves.`);
}
await fs.writeFile('src/later-layouts.json', JSON.stringify(levels, null, 2) + '\n');
console.log('Saved six 5x5 challenges. All other boards and all images are unchanged.');
