import fs from 'node:fs/promises';
import first12 from '../src/first12-layouts.json' with { type: 'json' };
import { groups, connectionCount, moveGroup, solved } from '../src/puzzle.js';
import { hintSolution, improveSolution, searchWithin, shapeKey } from './level-search.mjs';
import { levelPlan } from './level-plan.mjs';

function candidate(n, seed, gentle) {
  let state = seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 2 ** 32; };
  const p = Array.from({ length: n * n }, (_, i) => i);
  for (let i = p.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  // Relief boards retain recognizable local pairs. Recheck all groups afterwards.
  if (gentle && n === 4) for (let k = 0; k < 3; k++) {
    const a = Math.floor(random() * p.length), horizontal = random() < .5;
    const b = a + (horizontal ? 1 : n), target = p[a] + (horizontal ? 1 : n);
    if (b >= p.length || target >= p.length || (horizontal && (a % n === n - 1 || p[a] % n === n - 1))) continue;
    const occupant = p.indexOf(target); [p[b], p[occupant]] = [p[occupant], p[b]];
  }
  return p;
}
const used = new Set(first12.map((l) => shapeKey(l.positions))), levels = [];
await fs.mkdir('.local', { recursive: true });
// Checkpoint only complete, validated entries; resume is deterministic and preserves work.
let checkpoint = [];
try { checkpoint = JSON.parse(await fs.readFile('.local/level-generation.json', 'utf8')); } catch { /* First run. */ }
for (const spec of levelPlan) {
  const resumed = checkpoint.find((entry) => entry.number === spec.number && entry.plan === JSON.stringify(spec));
  if (resumed) { levels.push(resumed.value); used.add(shapeKey(resumed.value.positions)); console.log(`Resumed ${spec.number}`); continue; }
  const { target, ...config } = spec, gentle = ['easy', 'relief'].includes(spec.difficulty), hard = spec.difficulty === 'challenge';
  let chosen;
  for (let attempt = 0; attempt < 3000 && !chosen; attempt++) {
    const seed = 261113 + spec.number * 100003 + attempt * 997, positions = candidate(spec.gridSize, seed, gentle && spec.maxInitialLinks !== 0);
    const sizes = groups(positions).map((g) => g.length), links = connectionCount(positions), fixed = positions.filter((p, id) => p === id).length;
    if (Math.max(...sizes) > (gentle ? 4 : 2) || fixed > (gentle ? 3 : hard ? 1 : 2)) continue;
    if (spec.maxInitialLinks !== undefined && links > spec.maxInitialLinks) continue;
    if (gentle && spec.gridSize === 4 && spec.maxInitialLinks === undefined && links < 3 || hard && links > 1 || used.has(shapeKey(positions))) continue;
    const hints = hintSolution(positions);
    if (hints.length < target || hints.length > (spec.maxInitialLinks === 0 ? target + 5 : gentle ? target + 2 : hard ? 12 : 10)) continue;
    const solution = improveSolution(positions, spec.gridSize === 3 ? 20 : 32);
    if (solution.length !== target) continue;
    let cursor = positions, groupMoves = 0;
    for (const move of solution) {
      if (groups(cursor).find((g) => g.includes(move.id)).length > 1) groupMoves++;
      cursor = moveGroup(cursor, move.id, move.dx, move.dy);
    }
    if (!solved(cursor) || groupMoves < (hard ? 2 : 1)) continue;
    const checkedDepth = spec.gridSize === 3 ? target - 1 : spec.gridSize === 5 ? 3 : hard ? 4 : 3;
    const check = searchWithin(positions, checkedDepth, 2500000);
    if (check.solution || check.exhausted) continue;
    chosen = { ...config, seed, positions, solution, audit: {
      initialCorrect: fixed, initialGroups: sizes, initialLinks: links, provenMinimum: checkedDepth + 1,
      solutionMoves: solution.length, exact: spec.gridSize === 3, hintMoves: hints.length, groupMoves, checkedNodes: check.nodes,
    } };
    used.add(shapeKey(positions));
    console.log(`Level ${spec.number}: ${spec.artId}, ${spec.gridSize}x${spec.gridSize} ${spec.difficulty}, ${checkedDepth + 1}..${solution.length} moves, ${links} links, ${hints.length} hints, attempt ${attempt}`);
  }
  if (!chosen) throw new Error(`No validated layout for ${spec.number}`);
  levels.push(chosen); checkpoint.push({ number: spec.number, plan: JSON.stringify(spec), value: chosen });
  await fs.writeFile('.local/level-generation.json', JSON.stringify(checkpoint));
}
await fs.writeFile('src/later-layouts.json', JSON.stringify(levels, null, 2) + '\n');
console.log('Wrote 66 new layouts; the accepted first twelve are unchanged.');
