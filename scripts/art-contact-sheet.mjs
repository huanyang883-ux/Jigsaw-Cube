import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
const root = path.resolve(import.meta.dirname, '..');
const sets = [ ['desserts', ['cake', 'candy', 'jelly', 'icecream', 'chocolate', 'cream'], 4], ...['ocean', 'amphibians', 'land', 'insects', 'birds', 'ancient'].map((id) => [id, [id], 9]) ];
await fs.mkdir(path.join(root, 'test-results/art'), { recursive: true });
sets.push(['continents', ['north-america', 'south-america', 'europe', 'asia', 'africa', 'oceania'], 0], ['north-america', ['north-america'], 16]);
for (const [name, chapters, count] of sets) {
  const ids = chapters.flatMap((id) => [`${id}-face`, ...Array.from({ length: count }, (_, i) => `${id}-${String(i + 1).padStart(2, '0')}`)]);
  const cells = [];
  for (let i = 0; i < ids.length; i++) {
    const file = path.join(root, 'public/assets', `${ids[i]}.webp`);
    if (!await fs.stat(file).catch(() => null)) continue;
    const image = await sharp(file).resize(208, 264, { fit: 'contain', background: '#f6f4ec' }).toBuffer();
    const label = Buffer.from(`<svg width="220" height="24"><text x="110" y="17" text-anchor="middle" fill="#4d514c" font-family="Arial" font-size="13">${ids[i]}</text></svg>`);
    cells.push({ input: image, left: i % 5 * 220 + 6, top: Math.floor(i / 5) * 300 + 6 }, { input: label, left: i % 5 * 220, top: Math.floor(i / 5) * 300 + 274 });
  }
  await sharp({ create: { width: 1100, height: Math.ceil(ids.length / 5) * 300, channels: 3, background: '#f6f4ec' } }).composite(cells).png().toFile(path.join(root, 'test-results/art', `${name}.png`));
}
console.log('Contact sheets: test-results/art/');
