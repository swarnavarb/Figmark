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
const { photoSearchRoute, photoSalesRoute, forgetCatalogue } = await import(new URL('functions/catalog-routes.js', dist));
const { healthRoute } = await import(new URL('functions/health.js', dist));
const { getRepository } = await import(new URL('data/index.js', dist));
const { getPhotoStore } = await import(new URL('storage/index.js', dist));

let passed = 0;
const check = async (name, fn) => {
  forgetCatalogue();
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
  // Bytes that are not the picture they claim to be are refused before anything reads them.
  const junk = `data:image/jpeg;base64,${Buffer.from('not a jpeg').toString('base64')}`;
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: junk } }), ctx)).status, 400);
  // A JPEG that will not decode, with nobody to describe it, cannot be searched with.
  const broken = `data:image/jpeg;base64,${Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.from('not a jpeg')]).toString('base64')}`;
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: broken } }), ctx)).status, 422);
});

await check('a photo on Figmark finds where it is, and was, for sale, and who sold it', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const all = await repository.listListings({});
  const template = all[0];
  const otherShop = all.find((listing) => listing.sellerId !== template.sellerId);
  assert.ok(otherShop, 'the seed has two shops');
  const shot = await store.upload(picture(800, 600, (x, y) => (x > 0.5 ? [240, 200, 20] : [20, 120, 60]), 88), 'image/jpeg');
  const now = new Date().toISOString();
  const make = (id, changes) => ({
    ...template, id, title: `Haul item ${id}`, createdAt: now, updatedAt: now, privateFor: null, expiresAt: null,
    unlisted: false, soldCount: 0, status: 'active',
    photos: [{ blobName: shot.blobName, url: shot.url, imageHash: null, isPrimary: true }],
    ...changes,
  });
  await repository.createListing(make('lst_sales_live', {}));
  await repository.createListing(make('lst_sales_gone', { sellerId: otherShop.sellerId, status: 'sold_out', soldCount: 3 }));
  await repository.createListing(make('lst_sales_draft', { status: 'draft' }));
  await repository.createListing(make('lst_sales_private', { privateFor: 'usr_someone' }));

  const response = await photoSalesRoute(req({ body: { url: shot.url } }), ctx);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const body = response.jsonBody;
  assert.equal(body.vision, false);
  // Without vision there is one group: the listings that use the picture.
  assert.equal(body.items.length, 1);
  assert.equal(body.items[0].label, null);
  const ids = body.items[0].listings.map((listing) => listing.id);
  // What can be bought now comes before what was.
  assert.deepEqual(ids.filter((id) => id.startsWith('lst_sales_')), ['lst_sales_live', 'lst_sales_gone']);
  assert.equal(body.items[0].listings.find((listing) => listing.id === 'lst_sales_live').onSale, true);
  assert.equal(body.items[0].listings.find((listing) => listing.id === 'lst_sales_gone').onSale, false);
  // Drafts and private deals were never for sale to the public.
  assert.ok(!ids.includes('lst_sales_draft') && !ids.includes('lst_sales_private'));
  assert.equal(body.items[0].listings[0].costSheet, undefined);
  const sold = body.sellers.find((entry) => entry.seller.id === otherShop.sellerId);
  assert.ok(sold, 'the shop that sold it is listed');
  assert.equal(sold.unitsSold, 3);
  // A shop whose matching item has not sold has not sold it.
  assert.ok(!body.sellers.some((entry) => entry.seller.id === template.sellerId));
});

await check('the words with a photo find items by title, and shops by keyword, then by kind', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const all = await repository.listListings({});
  const template = all[0];
  // A shop with no listing like this picture, so nothing else names it first.
  const nikeShop = 'usr_gadgetgrid';
  // A picture no listing uses: everything found here comes from the words.
  const shot = await store.upload(picture(640, 480, (x, y) => [Math.round(x * 255), 90, Math.round(y * 255)], 88), 'image/jpeg');
  const now = new Date().toISOString();
  const make = (id, sellerId, title, category) => repository.createListing({
    ...template, id, sellerId, title, category, tags: [], createdAt: now, updatedAt: now, privateFor: null,
    expiresAt: null, unlisted: false, soldCount: 0, status: 'active', photos: [],
  });
  await make('lst_words_zorblax', template.sellerId, 'Zorblax resin figure — limited', 'Scale figures');
  // Nike is on enough titles that one shared word is not a match by itself.
  for (const [at, model] of ['Air Max 95', 'Dunk Low Panda', 'Air Force 1', 'Blazer Mid', 'Cortez'].entries()) {
    await make(`lst_words_nike_${at}`, nikeShop, `Nike ${model} — UK 9`, 'Sneakers');
  }

  const response = await photoSalesRoute(req({ body: { url: shot.url, about: 'My Zorblax arrived! Now hunting Nike shoes for the shelf.' } }), ctx);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const body = response.jsonBody;
  const zorblax = body.items.find((item) => item.label === 'Zorblax');
  assert.ok(zorblax, `a rare title word is a match: ${JSON.stringify(body.items.map((item) => item.label))}`);
  assert.deepEqual(zorblax.listings.map((listing) => listing.id), ['lst_words_zorblax']);
  assert.ok(!body.items.some((item) => item.listings.some((listing) => listing.id.startsWith('lst_words_nike'))),
    'a common word alone does not make an item a match');
  // Likely shops: the brand first, then the kind of thing.
  assert.equal(body.likely[0].because, 'Nike');
  assert.equal(body.likely[0].kind, 'keyword');
  assert.equal(body.likely[0].seller.id, nikeShop);
  assert.ok(body.likely[0].listings >= 5);
  const kinds = body.likely.map((entry) => entry.kind);
  assert.ok(kinds.lastIndexOf('keyword') < kinds.indexOf('category'), `keywords come before categories: ${kinds}`);
  assert.ok(body.likely.some((entry) => entry.because === 'Sneakers'), 'shoes are read as Sneakers');
  // A shop is named once, and not when it already has a matching listing.
  const ids = body.likely.map((entry) => entry.seller.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(!ids.includes(template.sellerId), 'the shop already listing the Zorblax is not repeated as likely');
});

await check('a different photo of the same thing, with a caption that names nothing, is a probable match', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const all = await repository.listListings({});
  const template = all[0];
  // The same blue-and-black figure: standing alone on white for the listing,
  // smaller and off to one side on grey for the post. No shape in common.
  const figure = (cx, cy, scale) => (x, y) => {
    const dx = (x - cx) / scale; const dy = (y - cy) / scale;
    if (Math.abs(dx) < 0.06 && dy > -0.4 && dy < -0.3) return [235, 190, 150];
    if (Math.abs(dx) < 0.12 && dy >= -0.3 && dy < 0) return [30, 60, 200];
    if (Math.abs(dx) < 0.1 && dy >= 0 && dy < 0.4) return [15, 15, 18];
    return null;
  };
  const listed = await store.upload(picture(600, 800, (x, y) => figure(0.5, 0.5, 1)(x, y) ?? [250, 250, 250], 88), 'image/jpeg');
  const posted = await store.upload(picture(800, 600, (x, y) => figure(0.3, 0.55, 0.8)(x, y) ?? [150 + Math.round(x * 90), 150 + Math.round(y * 60), 140], 70), 'image/jpeg');
  const red = await store.upload(picture(600, 600, disc, 88), 'image/jpeg');
  const now = new Date().toISOString();
  const make = (id, photo) => repository.createListing({
    ...template, id, title: `Gizmo ${id}`, tags: [], createdAt: now, updatedAt: now, privateFor: null, expiresAt: null,
    unlisted: false, soldCount: 0, status: 'active',
    photos: [{ blobName: photo.blobName, url: photo.url, imageHash: null, isPrimary: true }],
  });
  await make('lst_probable_figure', listed);
  await make('lst_probable_red', red);

  const response = await photoSalesRoute(req({ body: { url: posted.url, about: 'How is this?', by: template.sellerId } }), ctx);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const body = response.jsonBody;
  assert.ok(!body.items.some((item) => item.listings.some((listing) => listing.id === 'lst_probable_figure')),
    'not the same picture, so not a certain match');
  const probable = body.probable.map((listing) => listing.id);
  assert.equal(probable[0], 'lst_probable_figure', `likeliest first: ${probable}`);
  assert.ok(!probable.includes('lst_probable_red'), 'other colours are not probable');
  assert.ok(body.probable[0].chance > 0.2 && body.probable[0].chance < 1);
  // Its shop is named once: with the certain matches when it has one, else as one with similar listings.
  const named = [...body.items.flatMap((item) => item.listings.map((listing) => listing.sellerId)), ...body.likely.map((entry) => entry.seller.id)];
  assert.ok(named.includes(template.sellerId), 'the shop behind a probable match is named');
});

await check('photos from anywhere else are not looked at', async () => {
  const outside = await photoSalesRoute(req({ body: { url: 'https://example.com/haul.jpg' } }), ctx);
  assert.equal(outside.status, 200);
  assert.deepEqual(outside.jsonBody.items, []);
  const missing = await photoSalesRoute(req({ body: { url: '/api/photos/nothing-here.jpg' } }), ctx);
  assert.deepEqual(missing.jsonBody.items, []);
  assert.equal((await photoSalesRoute(req({ body: {} }), ctx)).status, 400);
});

await check('health says photo search is matching by picture only', async () => {
  const body = (await healthRoute(req(), ctx)).jsonBody;
  assert.equal(body.photoSearch.vision, false);
  assert.match(body.photoSearch.detail, /ANTHROPIC_API_KEY/);
});

console.log(`\n${passed} photo search checks passed`);
