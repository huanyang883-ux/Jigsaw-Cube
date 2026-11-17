// Remove prejoined pieces in the remaining animal chapters while retaining grids and route lengths.
import fs from 'node:fs/promises';
import { groups, connectionCount, moveGroup, solved } from '../src/puzzle.js';
import { hintSolution, improveSolution, searchWithin, shapeKey } from './level-search.mjs';
import { levelPlan } from './level-plan.mjs';

const first = JSON.parse(await fs.readFile('src/first12-layouts.json', 'utf8'));
const levels = JSON.parse(await fs.readFile('src/later-layouts.json', 'utf8'));
const baseline = JSON.parse(await fs.readFile('art-source/experiments/remaining-animals-v2/before/later-layouts.json', 'utf8'));
const chapters = ['ocean', 'land', 'ancient'];
const rebuilt = baseline.filter(l => chapters.includes(l.chapter) && connectionCount(l.positions) > 0);
const rebuiltNumbers = new Set(rebuilt.map(l => l.number));
const used = new Set([...first, ...levels.filter(l => !rebuiltNumbers.has(l.number))].map(l => shapeKey(l.positions)));
const checkpointFile = '.local/remaining-animals-layouts-v4.json';
await fs.mkdir('.local', { recursive: true });
let checkpoint = [];
try { checkpoint = JSON.parse(await fs.readFile(checkpointFile, 'utf8')); } catch { /* First run. */ }

function candidate(reference, seed, attempt) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const p = [...reference];
  for (let i = 0; i < 1 + attempt % 4; i++) {
    const a = Math.floor(random() * p.length), b = Math.floor(random() * p.length);
    [p[a], p[b]] = [p[b], p[a]];
  }
  return p;
}

for (const old of rebuilt) {
  const target = old.solution.length;
  let chosen = checkpoint.find(l => l.number === old.number && l.gridSize === old.gridSize && l.solution.length === target && connectionCount(l.positions) === 0 && !used.has(shapeKey(l.positions)));
  const references = [old, ...baseline.filter(l => l.gridSize === old.gridSize && connectionCount(l.positions) === 0 && l.solution.length <= target).sort((a, b) => Math.abs(a.solution.length - target) - Math.abs(b.solution.length - target))].map(l => l.positions);
  let evaluated = 0;
  for (let attempt = 0; !chosen && attempt < 20000; attempt++) {
    const seed = 20261116 + old.number * 100003 + attempt * 997;
    const positions = candidate(references[attempt % references.length], seed, Math.floor(attempt / references.length));
    if (connectionCount(positions) !== 0 || used.has(shapeKey(positions))) continue;
    const fixed = positions.filter((p, i) => p === i).length;
    if (fixed > 2) continue;
    const hints = hintSolution(positions);
    if (hints.length < target || hints.length > target + 5) continue;
    const solution = improveSolution(positions, 32);
    if (++evaluated % 25 === 0) console.log(`Searching ${old.number}: ${evaluated} candidates, ${solution.length}/${target} moves.`);
    if (solution.length !== target) continue;
    let cursor = positions, groupMoves = 0;
    for (const move of solution) {
      if (groups(cursor).find(g => g.includes(move.id)).length > 1) groupMoves++;
      cursor = moveGroup(cursor, move.id, move.dx, move.dy);
    }
    if (!solved(cursor) || groupMoves < (old.difficulty === 'challenge' ? 2 : 1)) continue;
    const check = searchWithin(positions, old.audit.provenMinimum - 1, 2500000);
    if (check.solution || check.exhausted) continue;
    chosen = { ...old, layoutVersion: 4, maxInitialLinks: 0, seed, positions, solution, audit: {
      initialCorrect: fixed, initialGroups: groups(positions).map(g => g.length), initialLinks: 0,
      provenMinimum: old.audit.provenMinimum, solutionMoves: target, exact: false,
      hintMoves: hints.length, groupMoves, checkedNodes: check.nodes,
    } };
  }
  if (!chosen) throw new Error(`No zero-join board for ${old.number}; game layouts have not been overwritten.`);
  used.add(shapeKey(chosen.positions));
  checkpoint = [...checkpoint.filter(l => l.number !== old.number), chosen];
  await fs.writeFile(checkpointFile, JSON.stringify(checkpoint, null, 2) + '\n');
  console.log(`Selected ${old.number}: zero starting joins, ${target} verified moves.`);
}
for (const old of baseline.filter(l => chapters.includes(l.chapter))) {
  const spec = levelPlan.find(l => l.number === old.number);
  const entry = checkpoint.find(l => l.number === old.number) ?? old;
  levels[levels.findIndex(l => l.number === old.number)] = {
    ...entry, layoutVersion: spec.layoutVersion, maxInitialLinks: 0,
    imageDifficulty: spec.imageDifficulty, imageNotes: spec.imageNotes,
  };
}
await fs.writeFile('src/later-layouts.json', JSON.stringify(levels, null, 2) + '\n');
console.log('Saved 27 animal levels with zero starting joins; rebuilt only the 20 previously joined boards.');
