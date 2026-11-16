import test from 'node:test';
import assert from 'node:assert/strict';
import { androidVersion } from '../scripts/android-version.mjs';

test('Android versions remain ordered across patch, minor and major rollovers', () => {
  assert.deepEqual(androidVersion(' 2.0.1 '), { versionName: '2.0.1', versionCode: 2000001 });
  const versions = ['0.0.1', '1.2.3', '1.2.999', '1.3.0', '1.999.999', '2.0.0', '2100.0.0'];
  const codes = versions.map(version => androidVersion(version).versionCode);
  assert.deepEqual(codes, [...codes].sort((a, b) => a - b));
  assert.equal(new Set(codes).size, codes.length);
});

test('invalid versions cannot overflow Android limits or introduce shell arguments', () => {
  for (const value of ['0.0.0', '2.0', 'v2.0.0', '02.0.0', '-1.0.0', '1.1000.0', '1.0.1000', '2100.0.1', '999999999999999.0.0', '1.0.0 & echo x', '1.0.0\n2.0.0', '1.0.0-beta']) {
    assert.throws(() => androidVersion(value), Error, value);
  }
});
