import test from 'node:test';
import assert from 'node:assert/strict';
import { pieceBounds, photoLayout } from '../src/piece-geometry.js';
import { INITIAL_POSITIONS, moveGroup } from '../src/puzzle.js';

test('correctly joined image edges meet continuously for square and portrait photos', () => {
  for (const n of [3, 4, 5, 6, 7]) for (const aspect of [1, .75, 2 / 3, 1.5]) {
    const solved = Array.from({ length: n * n }, (_, i) => i);
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
      const id = row * n + col, a = pieceBounds(solved, id, aspect);
      if (col < n - 1) {
        const b = pieceBounds(solved, id + 1, aspect);
        assert.ok(a.right >= 1 + b.left, 'joined horizontal geometry has no opening');
        const sampleA = a.u0 + (.5 - a.left) / (a.right - a.left) * (a.u1 - a.u0);
        const sampleB = b.u0 + (-.5 - b.left) / (b.right - b.left) * (b.u1 - b.u0);
        assert.ok(Math.abs(sampleA - sampleB) < 1e-12, 'both sides sample the identical original-image boundary');
      }
      if (row < n - 1) {
        const b = pieceBounds(solved, id + n, aspect);
        assert.ok(a.bottom <= b.top - 1 / aspect, 'joined vertical geometry has no opening');
        const sampleA = a.v0 + (-.5 / aspect - a.bottom) / (a.top - a.bottom) * (a.v1 - a.v0);
        const sampleB = b.v0 + (.5 / aspect - b.bottom) / (b.top - b.bottom) * (b.v1 - b.v0);
        assert.ok(Math.abs(sampleA - sampleB) < 1e-12, 'vertical UVs are continuous');
      }
    }
  }
});

test('only correct connections close their gaps, including after a merge or restoring positions', () => {
  const before = pieceBounds(INITIAL_POSITIONS, 1, .75);
  assert.ok(!Object.values(before.joins).some(Boolean));
  assert.ok(before.left > -.5 && before.right < .5);
  const joined = moveGroup(INITIAL_POSITIONS, 1, 0, -1);
  const after = pieceBounds(joined, 1, .75);
  assert.ok(after.joins.left && after.joins.right && after.joins.bottom);
  assert.ok(after.left <= -.5 && after.right >= .5);
  assert.deepEqual(pieceBounds(INITIAL_POSITIONS, 1, .75), before);
});

test('portrait layout preserves image proportions inside the 1080×1920 game', () => {
  for (const aspect of [.5, 2 / 3, .75, 1, 1.5, 2]) {
    const box = photoLayout(aspect);
    assert.ok(Math.abs((box.width - 36) / (box.height - 36) - aspect) < 1e-12);
    assert.ok(box.left >= 18 && box.left + box.width <= 1062);
    assert.ok(box.top >= 260 && box.top + box.height <= 1844);
    const oldWidth = Math.min(936, 1240 * aspect);
    assert.ok(box.width - 36 > oldWidth, 'all supported photo shapes gain usable card space');
  }
});
