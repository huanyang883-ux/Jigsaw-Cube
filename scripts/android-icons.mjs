import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const resources = path.join(root, 'resources/android');
const res = path.join(root, 'android/app/src/main/res');
const background = '#fbf1e3';
const source = await sharp(path.join(resources, 'icon-foreground.png')).trim().png().toBuffer();
async function icon(size, fraction, transparent = false) {
  const cube = await sharp(source).resize(Math.round(size * fraction), Math.round(size * fraction), { fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: transparent ? '#00000000' : background } })
    .composite([{ input: cube, gravity: 'centre' }]).png().toBuffer();
}
await fs.writeFile(path.join(resources, 'icon.png'), await icon(1024, .78));
for (const [density, factor] of [['mdpi', 1], ['hdpi', 1.5], ['xhdpi', 2], ['xxhdpi', 3], ['xxxhdpi', 4]]) {
  const dir = path.join(res, `mipmap-${density}`);
  await fs.mkdir(dir, { recursive: true });
  const legacy = await icon(48 * factor, .78);
  await fs.writeFile(path.join(dir, 'ic_launcher.png'), legacy);
  await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), legacy);
  // Adaptive icons use a 108dp layer, of which the launcher exposes about
  // 72dp. Keep the complete cube inside the circular/squircle safe area.
  await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), await icon(108 * factor, .48, true));
}
console.log('Android launcher icons generated from resources/android/icon-foreground.png');
