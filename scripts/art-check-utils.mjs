import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { LEVEL_CONFIGS } from '../src/progress.js';
import manifest from '../src/art-manifest.json' with { type: 'json' };

// Current image contract shared by chapter browser checks. Historical photo
// experiments remain archived; subsequent 2:3 edits supersede their byte hashes.
export async function assertPortraitArt(chapters) {
  const baseline = JSON.parse(await fs.readFile('art-source/experiments/all-levels-2x3-v1/before/asset-hashes.json', 'utf8'));
  const changed = [];
  for (const chapter of chapters) {
    const ids = [`${chapter}-face`, ...LEVEL_CONFIGS.filter(l => l.chapter === chapter).map(l => l.artId)];
    for (const id of ids) {
      const file = `${id}.webp`, data = await fs.readFile(`public/assets/${file}`);
      const meta = await sharp(data).metadata(), digest = createHash('sha256').update(data).digest('hex');
      assert.equal(meta.width, manifest[id].width); assert.equal(meta.height, manifest[id].height);
      if (id.endsWith('-face')) {
        assert.equal(meta.width, meta.height);
        assert.equal(digest, baseline[file], `${id}: retain the approved square cube texture`);
      } else {
        assert.equal(meta.width, 960, `${id}: 2:3 level width`);
        assert.equal(meta.height, 1440, `${id}: 2:3 level height`);
        if (digest !== baseline[file]) changed.push(file);
      }
    }
  }
  return changed.sort();
}
