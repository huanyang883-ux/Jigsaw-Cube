import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { freshGuides, learnGuide, chooseGuide, guideMove } from '../src/guide-state.js';
import { freshProgress, restoreProgress, nextPlayableLevel, initialLayout, legacyInitialLayout, markComplete } from '../src/progress.js';
import { moveGroup, valid, groupFor, clampDelta } from '../src/puzzle.js';

test('home reminders use 3s / 5s independently and never point at a locked entry', () => {
  const state = { mode: 'home', learned: freshGuides(), canEnter: true };
  assert.equal(chooseGuide({ ...state, idleMs: 2999 }), null);
  assert.equal(chooseGuide({ ...state, idleMs: 3000 }), 'enterChapter');
  assert.equal(chooseGuide({ ...state, idleMs: 4999 }), 'enterChapter');
  assert.equal(chooseGuide({ ...state, idleMs: 5000 }), 'rotateCube');
  assert.equal(chooseGuide({ ...state, idleMs: 3000, canEnter: false }), null);
  state.learned.rotateCube = true;
  assert.equal(chooseGuide({ ...state, idleMs: 8000 }), 'enterChapter');
  state.learned.enterChapter = true;
  assert.equal(chooseGuide({ ...state, idleMs: 8000 }), null);
});

test('completed actions suppress their reminder permanently even without ever showing it', () => {
  const p = freshProgress();
  for (const action of Object.keys(p.guides)) { assert.ok(learnGuide(p, action)); assert.equal(learnGuide(p, action), false); }
  assert.equal(learnGuide(p, 'unknown'), false);
  const saved = restoreProgress(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(saved.guides, { rotateCube: true, enterChapter: true, enterLevel: true, dragPuzzle: true });
  for (const mode of ['home', 'chapters', 'puzzle']) assert.equal(chooseGuide({ mode, idleMs: 60000, learned: saved.guides, canEnter: true, hasLevel: true, canDrag: true }), null);
  assert.deepEqual(freshProgress().guides, freshGuides());
});

test('chapter target is the first unfinished level on an unlocked face; finished faces have no target', () => {
  const p = freshProgress();
  assert.equal(nextPlayableLevel(p, 0, 0), 0);
  markComplete(p, 0, 0, 0); markComplete(p, 0, 0, 2);
  assert.equal(nextPlayableLevel(p, 0, 0), 1);
  assert.equal(nextPlayableLevel(p, 0, 1), null);
  markComplete(p, 0, 0, 1); markComplete(p, 0, 0, 3);
  assert.equal(nextPlayableLevel(p, 0, 0), null);
  assert.equal(nextPlayableLevel(p, 0, 1), 0);
  assert.equal(nextPlayableLevel(p, 1, 0), null);
  const state = { mode: 'chapters', learned: freshGuides(), hasLevel: true };
  assert.equal(chooseGuide({ ...state, idleMs: 4999 }), null);
  assert.equal(chooseGuide({ ...state, idleMs: 5000 }), 'enterLevel');
  assert.equal(chooseGuide({ ...state, idleMs: 5000, hasLevel: false }), null);
});

test('old saves infer only demonstrated skills; automatic hint moves in new saves do not prove manual dragging', () => {
  const p = freshProgress(); delete p.guides;
  assert.deepEqual(restoreProgress(p).guides, freshGuides());
  p.puzzles['0:0:0'] = { positions: legacyInitialLayout(0, 0, 0) };
  assert.deepEqual(restoreProgress(p).guides, { rotateCube: false, enterChapter: true, enterLevel: true, dragPuzzle: false });
  const h = guideMove(p.puzzles['0:0:0'].positions);
  p.puzzles['0:0:0'].positions = moveGroup(p.puzzles['0:0:0'].positions, h.id, h.dx, h.dy);
  assert.equal(restoreProgress(p).guides.dragPuzzle, true);
  p.guides = freshGuides();
  assert.equal(restoreProgress(p).guides.dragPuzzle, false);
});

test('hand drag paths are legal for both puzzle sizes and never mutate a board or inventory', () => {
  for (const theme of [0, 1]) for (let face = 0; face < 6; face++) for (let level = 0; level < 4; level++) {
    const p = initialLayout(theme, face, level), copy = [...p], move = guideMove(p);
    assert.ok(move); assert.deepEqual(p, copy);
    assert.deepEqual(clampDelta(p, groupFor(p, move.id), move.dx, move.dy), { x: move.dx, y: move.dy });
    const next = moveGroup(p, move.id, move.dx, move.dy); assert.ok(valid(next)); assert.notDeepEqual(next, p);
  }
  assert.equal(guideMove(Array.from({ length: 9 }, (_, i) => i)), null);
});

test('the runtime glove is a small alpha-transparent WebP', async () => {
  const image = sharp('public/assets/ui/guide-hand.webp'), info = await image.metadata(), stats = await image.stats();
  assert.equal(info.format, 'webp'); assert.ok(info.hasAlpha); assert.equal(info.width, 384);
  assert.equal(stats.channels[3].min, 0); assert.equal(stats.channels[3].max, 255);
});
