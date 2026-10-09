/**
 * Photo search: the fingerprint tells the same picture from a different one,
 * and the route finds a listed item from a resized copy of its photo.
 *
 * Runs without ANTHROPIC_API_KEY, so it covers the picture-only path; what
 * Claude reads in a photo is checked through `describedScore` with a fixed
 * description instead of a live call.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

delete process.env.ANTHROPIC_API_KEY;
process.env.FIGMARK_RATE_LIMITS = 'off';

const require = createRequire(new URL('../api/package.json', import.meta.url));
const { encode } = require('jpeg-js');
const dist = new URL('../api/dist/api/src/', import.meta.url);
const { fingerprint, likeness } = await import(new URL('image-hash.js', dist));
const { describedScore } = await import(new URL('photo-search.js', dist));
const { photoSearchRoute } = await import(new URL('functions/catalog-routes.js', dist));
const { healthRoute } = await import(new URL('functions/health.js', dist));
const { getRepository } = await import(new URL('data/index.js', dist));
const { getPhotoStore } = await import(new URL('storage/index.js', dist));

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/** A picture drawn by `paint(x, y)` -> [r, g, b], as a JPEG. */
function picture(width, height, paint, quality = 85) {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x / width, y / height);
      const i = (y * width + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return new Uint8Array(encode({ data, width, height }, quality).data);
}

// A red disc on a pale ground, and a blue stripe pattern: nothing alike.
const disc = (x, y) => ((x - 0.45) ** 2 + (y - 0.5) ** 2 < 0.08 ? [210, 40, 50] : [235, 230, 220]);
const stripes = (x, y) => (Math.floor((x + y) * 8) % 2 ? [30, 60, 200] : [10, 20, 40]);

const req = ({ headers = {}, body } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(),
  params: {},
  json: async () => body,
});
const ctx = { log() {}, error() {}, warn() {} };
const dataUrl = (bytes) => `data:image/jpeg;base64,${Buffer.from(bytes).toString('base64')}`;

await check('the same photo, resized and recompressed, is the same photo', async () => {
  const a = fingerprint(picture(640, 480, disc, 90), 'image/jpeg');
  const b = fingerprint(picture(320, 240, disc, 45), 'image/jpeg');
  assert.ok(a && b);
  const alike = likeness(a, b);
  assert.equal(alike.samePhoto, true);
  assert.ok(alike.score > 0.9, `score ${alike.score}`);
});

await check('a different photo is not', async () => {
  const a = fingerprint(picture(400, 300, disc), 'image/jpeg');
  const b = fingerprint(picture(400, 300, stripes), 'image/jpeg');
  const alike = likeness(a, b);
  assert.equal(alike.samePhoto, false);
  assert.ok(alike.score < 0.78, `score ${alike.score}`);
});

await check('only JPEG is fingerprinted, and junk is not', async () => {
  assert.equal(fingerprint(new Uint8Array([1, 2, 3]), 'image/jpeg'), null);
  assert.equal(fingerprint(picture(50, 50, disc), 'image/png'), null);
  assert.equal(likeness('v1:zz:nope', 'v1:zz:nope'), null);
});

await check('words read from a photo score on title, tags and category', async () => {
  const listing = {
    title: 'RX-78-2 Gundam Master Grade', description: 'Ver 3.0 kit', category: 'Model kits', tags: ['bandai'],
  };
  const hit = describedScore(listing, { query: 'gundam model kit', keywords: ['gundam', 'bandai'], category: 'Model kits' });
  const miss = describedScore(listing, { query: 'pikachu plush', keywords: ['pikachu', 'plush'], category: 'Model kits' });
  assert.ok(hit > 0);
  // The category alone never makes a result.
  assert.equal(miss, 0);
});

await check('a resized copy of a listed photo finds the item first', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const [template] = await repository.listListings({});
  assert.ok(template, 'the seed has listings');
  const stored = await store.upload(picture(800, 600, disc, 88), 'image/jpeg');
  const decoy = await store.upload(picture(800, 600, stripes, 88), 'image/jpeg');
  const now = new Date().toISOString();
  const make = (id, title, photo) => ({
    ...template, id, title, createdAt: now, updatedAt: now, privateFor: null, expiresAt: null,
    photos: [{ blobName: photo.blobName, url: photo.url, imageHash: null, isPrimary: true }],
  });
  await repository.createListing(make('lst_photo_target', 'Red disc figure', stored));
  await repository.createListing(make('lst_photo_decoy', 'Blue stripes figure', decoy));

  const before = (await store.list()).length;
  const response = await photoSearchRoute(req({ body: { dataUrl: dataUrl(picture(300, 225, disc, 50)) } }), ctx);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const body = response.jsonBody;
  assert.equal(body.vision, false);
  // One list: the match first, then items related to it - the decoy shares
  // its category, so it comes after as related rather than as a match.
  const ids = body.listings.map((listing) => listing.id);
  assert.equal(ids[0], 'lst_photo_target');
  assert.ok(ids.indexOf('lst_photo_decoy') > 0, 'the related item follows the match');
  assert.equal(new Set(ids).size, ids.length, 'nothing listed twice');
  // Nothing says which is which: no match labels, no description sections.
  assert.equal(body.listings[0].photoMatch, undefined);
  assert.equal(body.described, undefined);
  // What the shop paid stays the shop's here as on every other public route.
  assert.equal(body.listings[0].costSheet, undefined);
  // The photo searched with is never stored.
  assert.equal((await store.list()).length, before, 'the search photo was not saved to the photo store');
});

await check('the route refuses what is not a photo', async () => {
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: 'hello' } }), ctx)).status, 400);
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: 'data:text/plain;base64,aGk=' } }), ctx)).status, 400);
  // A JPEG that will not decode, with nobody to describe it, cannot be searched with.
  const junk = `data:image/jpeg;base64,${Buffer.from('not a jpeg').toString('base64')}`;
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: junk } }), ctx)).status, 422);
});

await check('health says photo search is matching by picture only', async () => {
  const body = (await healthRoute(req(), ctx)).jsonBody;
  assert.equal(body.photoSearch.vision, false);
  assert.match(body.photoSearch.detail, /ANTHROPIC_API_KEY/);
});

console.log(`\n${passed} photo search checks passed`);
