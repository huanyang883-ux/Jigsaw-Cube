import assert from 'node:assert/strict';

export async function assertPuzzlePreview(page, artUrl) {
  const preview = page.locator('.overlay-card img');
  // The preview reuses the decoded board texture, whose src can be a blob URL.
  const result = await preview.evaluate(async (image, url) => {
    const expected = new Image();
    expected.src = url;
    await Promise.all([image.decode(), expected.decode()]);
    const canvas = document.createElement('canvas');
    canvas.width = 48;
    canvas.height = 72;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const pixels = source => {
      ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
      return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    };
    const actualPixels = pixels(image), expectedPixels = pixels(expected);
    return { width: image.naturalWidth, height: image.naturalHeight, matches: actualPixels.every((value, i) => value === expectedPixels[i]) };
  }, artUrl);
  assert.deepEqual(result, { width: 960, height: 1440, matches: true }, artUrl);
}
