// Rebuild the original 4x4 amphibian experiment; keep the later 5x5 challenge.
import fs from 'node:fs/promises';
import { groups, connectionCount, moveGroup, solved } from '../src/puzzle.js';
import { hintSolution, improveSolution, searchWithin, shapeKey } from './level-search.mjs';
import { levelPlan } from './level-plan.mjs';

const first = JSON.parse(await fs.readFile('src/first12-layouts.json', 'utf8'));
const levels = JSON.parse(await fs.readFile('src/later-layouts.json', 'utf8'));
const baseline = JSON.parse(await fs.readFile('art-source/experiments/amphibians-chapter-v3/before/later-layouts.json', 'utf8'));
const used = new Set([...first, ...levels.filter(l => l.chapter !== 'amphibians')].map(l => shapeKey(l.positions)));
const checkpointFile = '.local/amphibians-layouts-v4.json';
await fs.mkdir('.local', { recursive: true });
let checkpoint = [];
try { checkpoint = JSON.parse(await fs.readFile(checkpointFile, 'utf8')); } catch { /* New experiment. */ }
function candidate(original, seed, attempt) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const p = attempt < 160 ? [...original] : original.map((_, i) => i);
  if (attempt < 160) {
    for (let i = 0; i < 1 + attempt % 4; i++) {
      const a = Math.floor(random() * p.length), b = Math.floor(random() * p.length);
      [p[a], p[b]] = [p[b], p[a]];
    }
  } else for (let i = p.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}
for (const old of baseline.filter(l => l.chapter === 'amphibians')) {
  if (levelPlan.find(l => l.number === old.number).gridSize !== old.gridSize) continue;
  let chosen = checkpoint.find(l => l.number === old.number);
  if (chosen) console.log(`Resume ${old.number}: ${chosen.audit.initialLinks} initial links, ${chosen.solution.length} moves.`);
  if (!chosen && connectionCount(old.positions) === 0) chosen = { ...old, layoutVersion: 4 };
  let evaluated = 0;
  for (let attempt = 0; !chosen && attempt < 12000; attempt++) {
    const seed = 20261116 + old.number * 100003 + attempt * 997;
    const reference = old.number === 42 ? checkpoint.find(l => l.number === 34)?.positions ?? old.positions : old.positions;
    const positions = candidate(reference, seed, attempt);
    if (connectionCount(positions) !== 0 || used.has(shapeKey(positions))) continue;
    const fixed = positions.filter((p, i) => p === i).length;
    if (fixed > 2) continue;
    const hints = hintSolution(positions), target = old.solution.length;
    if (hints.length < target || hints.length > target + 5) continue;
    const solution = improveSolution(positions, old.gridSize === 3 ? 20 : 32);
    if (++evaluated % 25 === 0) console.log(`Searching ${old.number}: ${evaluated} unjoined candidates, latest ${solution.length}/${target} moves.`);
    if (solution.length !== target) continue;
    const check = searchWithin(positions, old.audit.provenMinimum - 1, 2500000);
    if (check.solution || check.exhausted) continue;
    let cursor = positions, groupMoves = 0;
    for (const move of solution) {
      if (groups(cursor).find(g => g.includes(move.id)).length > 1) groupMoves++;
      cursor = moveGroup(cursor, move.id, move.dx, move.dy);
    }
    if (!solved(cursor) || groupMoves < 1) continue;
    chosen = { ...old, layoutVersion: 4, seed, positions, solution, audit: {
      initialCorrect: fixed, initialGroups: groups(positions).map(g => g.length), initialLinks: 0,
      provenMinimum: old.audit.provenMinimum, solutionMoves: target, exact: old.gridSize === 3,
      hintMoves: hints.length, groupMoves, checkedNodes: check.nodes,
    } };
    console.log(`Selected ${old.number}: ${old.gridSize}x${old.gridSize}, ${target} moves, zero initial joins, attempt ${attempt}.`);
  }
  if (!chosen) throw new Error(`No zero-join candidate for ${old.number}; original chapter has not been overwritten.`);
  used.add(shapeKey(chosen.positions));
  checkpoint = [...checkpoint.filter(l => l.number !== old.number), chosen];
  await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');
}
for (const entry of checkpoint) {
  const spec = levelPlan.find(l => l.number === entry.number);
  if (entry.gridSize !== spec.gridSize) continue;
  levels[levels.findIndex(l => l.number === entry.number)] = { ...entry, imageDifficulty: spec.imageDifficulty, imageNotes: spec.imageNotes, maxInitialLinks: 0 };
}
await fs.writeFile('src/later-layouts.json', JSON.stringify(levels, null, 2) + '\n');
console.log('Saved eight 4x4 amphibian layouts with zero starting joins; preserved the 5x5 challenge.');
