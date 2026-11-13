import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntroPlan, introPose, INTRO_DURATION } from '../src/intro.js';

function random(seed) { return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; }; }

test('3×3 and 4×4 entrances shuffle every piece, vary the intervals and finish within 3.5 seconds', () => {
  for (const count of [9, 16]) {
    const plan = createIntroPlan(count, random(27)), other = createIntroPlan(count, random(74));
    const starts = plan.map((c) => c.start), sorted = [...starts].sort((a, b) => a - b);
    assert.equal(new Set(starts).size, count);
    assert.notDeepEqual(starts, sorted);
    assert.notDeepEqual(plan, other);
    assert.equal(sorted[0], 0);
    assert.ok(new Set(sorted.slice(1).map((v, i) => Math.round(v - sorted[i]))).size > 3);
    assert.equal(Math.max(...plan.map((c) => 1500 + c.start + c.duration)), INTRO_DURATION);
    assert.ok(plan.every((c) => c.duration >= 440 && c.duration <= 550));
  }
});

test('backs hold completely still for 0.5s, quake increases without large displacement, then every tile settles', () => {
  const plan = createIntroPlan(16, random(9));
  let weakEnergy = 0, strongEnergy = 0;
  for (const card of plan) {
    for (const ms of [0, 100, 499, 500]) {
      const p = introPose(ms, card);
      assert.equal(Math.abs(p.ry), Math.PI);
      for (const key of ['x', 'y', 'z', 'rx', 'rz']) assert.ok(Math.abs(p[key]) === 0);
    }
    for (let ms = 501; ms < 3500; ms += 7) {
      const p = introPose(ms, card);
      assert.ok(Math.abs(p.x) <= .018 && Math.abs(p.y) <= .014 && p.z < .153);
      const energy = p.x ** 2 + p.y ** 2;
      if (ms < 750) weakEnergy += energy;
      if (ms >= 1250 && ms < 1500) strongEnergy += energy;
      if (ms < 1500) assert.equal(Math.abs(p.ry), Math.PI);
    }
    for (const ms of [3500, 5000]) assert.deepEqual(introPose(ms, card), { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  }
  assert.ok(strongEnergy > weakEnergy * 10, 'the late quake visibly exceeds the gentle start');
});
