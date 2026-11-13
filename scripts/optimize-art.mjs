import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const sources = path.join(root, 'art-source/images');
const output = path.join(root, 'public/assets');
await fs.mkdir(output, { recursive: true });
const manifestPath = path.join(root, 'src/art-manifest.json');
let previous = {};
try { previous = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { /* First conversion. */ }
const manifest = {};
for (const file of (await fs.readdir(sources)).filter((f) => f.endsWith('.png')).sort()) {
  const id = path.basename(file, '.png'), input = await fs.readFile(path.join(sources, file));
  const hash = createHash('sha256').update(input).digest('hex');
  const target = path.join(output, `${id}.webp`);
  const cached = previous[id];
  if (cached?.hash === hash && await fs.stat(target).catch(() => null)) {
    const { width, height, bytes, sourceBytes } = cached;
    manifest[id] = { width, height, bytes, sourceBytes, hash }; continue;
  }
  const cover = id.endsWith('-face');
  const pipeline = sharp(input).rotate().toColourspace('srgb');
  const result = await pipeline.resize({ width: cover ? 768 : 1080, height: cover ? 768 : 1440, fit: 'inside', withoutEnlargement: true }).webp({ quality: 83, effort: 6, smartSubsample: true }).toFile(target);
  manifest[id] = { width: result.width, height: result.height, bytes: result.size, sourceBytes: input.length, hash };
  console.log(`${id}: ${Math.round(input.length / 1024)} KB -> ${Math.round(result.size / 1024)} KB (${result.width}x${result.height})`);
}
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const values = Object.values(manifest), original = values.reduce((s, a) => s + a.sourceBytes, 0), optimized = values.reduce((s, a) => s + a.bytes, 0);
const report = { count: values.length, originalBytes: original, optimizedBytes: optimized, reductionPercent: Math.round((1 - optimized / original) * 1000) / 10 };
await fs.writeFile(path.join(root, 'art-source/optimization-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
