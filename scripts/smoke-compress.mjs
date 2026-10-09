/**
 * Photo compression: every stored photo is 70-90 KB, or the smaller of what was
 * sent and the recompressed picture.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../api/package.json', import.meta.url));
const { encode } = require('jpeg-js');
const { compressPhoto, PHOTO_MAX_BYTES, PHOTO_MIN_BYTES } = await import(
  new URL('../api/dist/api/src/storage/compress.js', import.meta.url)
);

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/** A detailed picture: smooth colour plus noise, which JPEG cannot squeeze hard. */
function photo(width, height, quality, noise = 40) {
  const data = Buffer.alloc(width * height * 4);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      data[i] = Math.min(255, (x * 255) / width + rnd() * noise);
      data[i + 1] = Math.min(255, (y * 255) / height + rnd() * noise);
      data[i + 2] = Math.min(255, 128 + rnd() * noise);
      data[i + 3] = 255;
    }
  }
  return new Uint8Array(encode({ data, width, height }, quality).data);
}

check('a big photo comes down into 70-90 KB', () => {
  const big = photo(1600, 1200, 95);
  assert.ok(big.byteLength > 400_000, `fixture should be large, was ${big.byteLength}`);
  const out = compressPhoto(big, 'image/jpeg');
  assert.equal(out.recompressed, true);
  assert.equal(out.contentType, 'image/jpeg');
  assert.ok(out.bytes.byteLength <= PHOTO_MAX_BYTES, `over the cap: ${out.bytes.byteLength}`);
  assert.ok(out.bytes.byteLength >= PHOTO_MIN_BYTES, `squeezed too far: ${out.bytes.byteLength}`);
  assert.equal(out.originalBytes, big.byteLength);
});

check('what is kept is never larger than what was sent', () => {
  for (const [w, h, q] of [[320, 240, 60], [800, 600, 50], [1000, 700, 90], [64, 64, 95]]) {
    const sent = photo(w, h, q, 10);
    const out = compressPhoto(sent, 'image/jpeg');
    assert.ok(out.bytes.byteLength <= sent.byteLength, `${w}x${h}q${q}: ${out.bytes.byteLength} > ${sent.byteLength}`);
  }
});

check('a photo already small and tight is kept as it was sent', () => {
  const tiny = photo(48, 48, 30, 0);
  const out = compressPhoto(tiny, 'image/jpeg');
  assert.equal(out.recompressed, false);
  assert.equal(out.bytes, tiny);
});

check('anything that is not a readable JPEG comes back untouched for the caller to size-check', () => {
  const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const kept = compressPhoto(png, 'image/png');
  assert.equal(kept.bytes, png);
  assert.equal(kept.recompressed, false);
  const broken = new Uint8Array([255, 216, 255, 0, 1, 2, 3]);
  const same = compressPhoto(broken, 'image/jpeg');
  assert.equal(same.bytes, broken);
});

console.log(`${passed} checks passed`);
