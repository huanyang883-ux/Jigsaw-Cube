import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { THEMES } from '../src/progress.js';

const root = path.resolve(import.meta.dirname, '..');
const sources = path.join(root, 'art-source/images');
const output = path.join(root, 'public/assets');
await fs.mkdir(output, { recursive: true });
const manifestPath = path.join(root, 'src/art-manifest.json');
const faceExport = { size: 832, quality: 88 };
const levelExport = { width: 960, height: 1440, quality: 83 };
const files = (await fs.readdir(sources)).filter(f => f.endsWith('.png')).sort();
// Validate the complete source set before overwriting any runtime asset.
for (const file of files) {
  const meta = await sharp(path.join(sources, file)).metadata();
  const rotated = meta.orientation >= 5 && meta.orientation <= 8;
  const width = rotated ? meta.height : meta.width, height = rotated ? meta.width : meta.height;
  if (file.endsWith('-face.png')) {
    if (width !== height) throw new Error(`${file}: cube-face artwork must remain square (1:1).`);
  } else if (width * 3 !== height * 2 || width < levelExport.width || height < levelExport.height) {
    throw new Error(`${file}: level artwork must be 2:3 portrait and at least 960x1440; received ${width}x${height}. Generate or edit the source image before exporting.`);
  }
}
let previous = {};
try { previous = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { /* First conversion. */ }
const manifest = {};
for (const file of files) {
  const id = path.basename(file, '.png'), input = await fs.readFile(path.join(sources, file));
  const cover = id.endsWith('-face');
  // Include the face export recipe in its version, so both this cache and
  // browser caches refresh when resolution/quality changes without new art.
  const digest = createHash('sha256').update(input);
  if (cover) digest.update(`face:webp:${faceExport.size}x${faceExport.size}:q${faceExport.quality}:smartSubsample:v2`);
  const hash = digest.digest('hex');
  const target = path.join(output, `${id}.webp`);
  const cached = previous[id];
  const cachedSizeValid = cover
    ? cached?.width === cached?.height && cached?.width <= faceExport.size
    : cached?.width === levelExport.width && cached?.height === levelExport.height;
  if (cached?.hash === hash && cachedSizeValid && await fs.stat(target).catch(() => null)) {
    const { width, height, bytes, sourceBytes } = cached;
    manifest[id] = { width, height, bytes, sourceBytes, hash }; continue;
  }
  const pipeline = sharp(input).rotate().toColourspace('srgb');
  const result = await pipeline.resize({ width: cover ? faceExport.size : levelExport.width, height: cover ? faceExport.size : levelExport.height, fit: 'inside', withoutEnlargement: true }).webp({ quality: cover ? faceExport.quality : levelExport.quality, effort: 6, smartSubsample: true }).toFile(target);
  manifest[id] = { width: result.width, height: result.height, bytes: result.size, sourceBytes: input.length, hash };
  console.log(`${id}: ${Math.round(input.length / 1024)} KB -> ${Math.round(result.size / 1024)} KB (${result.width}x${result.height})`);
}
// One small resident texture covers jumps to any cube, even after its full covers are evicted.
const previewSize = 160;
const themes = THEMES.filter(theme => !theme.comingSoon);
const cells = await Promise.all(themes.flatMap(({ chapters }, row) => chapters.map(async ({ id }, face) => ({
  input: await sharp(path.join(output, `${id}-face.webp`)).resize(previewSize, previewSize).png().toBuffer(),
  left: face * previewSize, top: row * previewSize,
}))));
await sharp({ create: { width: previewSize * 6, height: previewSize * themes.length, channels: 3, background: '#fff' } })
  .composite(cells).webp({ quality: 70, effort: 6 }).toFile(path.join(root, 'src/cube-previews.webp'));
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
const values = Object.values(manifest), original = values.reduce((s, a) => s + a.sourceBytes, 0), optimized = values.reduce((s, a) => s + a.bytes, 0);
const report = { count: values.length, originalBytes: original, optimizedBytes: optimized, reductionPercent: Math.round((1 - optimized / original) * 1000) / 10 };
await fs.writeFile(path.join(root, 'art-source/optimization-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
