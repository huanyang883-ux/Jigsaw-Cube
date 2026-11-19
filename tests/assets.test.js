import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { THEMES, faceSize, levelArt, ANIMAL_CHAPTERS } from '../src/progress.js';
import manifest from '../src/art-manifest.json' with { type: 'json' };

test('all chapter and level images and source versions are present', async () => {
  const images = new Set();
  for (let theme = 0; theme < 3; theme++) for (let face = 0; face < 6; face++) {
    images.add(THEMES[theme].faceArt[face]);
    for (let level = 0; level < faceSize(theme); level++) images.add(levelArt(theme, face, level));
  }
  assert.equal(images.size, 192);
  assert.equal(Object.keys(manifest).length, images.size);
  for (const url of images) {
    const parsed = new URL(url, 'http://local'); assert.match(parsed.searchParams.get('v'), /^[0-9a-f]{12}$/);
    const file = path.resolve('public', `.${parsed.pathname}`), data = await fs.readFile(file);
    assert.equal(data.toString('ascii', 0, 4), 'RIFF'); assert.equal(data.toString('ascii', 8, 12), 'WEBP');
    const id = path.basename(file, '.webp'), asset = manifest[id];
    const metadata = await sharp(data).metadata();
    assert.equal(metadata.width, asset.width); assert.equal(metadata.height, asset.height);
    assert.ok(asset, id); assert.ok(asset.bytes < asset.sourceBytes * .5, `${id} should be meaningfully compressed`);
    if (id.endsWith('-face')) {
      assert.equal(asset.width, asset.height, `${id} cover must be square`);
      assert.ok(asset.width <= 832, `${id} cover must stay within the startup texture budget`);
    }
    else { assert.equal(asset.width, 960, `${id} level width`); assert.equal(asset.height, 1440, `${id} level height`); }
  }
  const publicFiles = await fs.readdir('public/assets');
  assert.equal(publicFiles.filter((f) => f.endsWith('.png')).length, 0, 'original PNGs stay out of the H5 package');
  assert.deepEqual(ANIMAL_CHAPTERS.map((c) => c.name), ['海洋生物', '两栖生物', '陆地生物', '昆虫', '鸟类', '古生物']);
});

test('each resident cube preview matches its full cover in theme and face order', async () => {
  const atlas = await fs.readFile('src/cube-previews.webp');
  const { width, height } = await sharp(atlas).metadata();
  const size = width / 6, themes = THEMES.filter(t => !t.comingSoon);
  assert.equal(height, size * themes.length);
  for (const [row, theme] of themes.entries()) for (const [face, url] of theme.faceArt.entries()) {
    const preview = await sharp(atlas).extract({ left: face * size, top: row * size, width: size, height: size })
      .resize(16, 16).removeAlpha().raw().toBuffer();
    const file = path.join('public', new URL(url, 'http://local').pathname);
    const faceAtPreviewSize = await sharp(file).resize(size, size).png().toBuffer();
    const cover = await sharp(faceAtPreviewSize).resize(16, 16).removeAlpha().raw().toBuffer();
    const difference = preview.reduce((sum, value, i) => sum + Math.abs(value - cover[i]), 0) / cover.length;
    assert.ok(difference < 5, `${theme.order}x${theme.order} face ${face} must match its cover`);
  }
});
