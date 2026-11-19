/**
 * Photo search: the fingerprint tells the same picture from a different one,
 * and the route finds a listed item from a resized copy of its photo.
 *
 * Runs without ANTHROPIC_API_KEY, so it covers the picture-only path; what
 * Claude reads in a photo is checked through `describedScore` with a fixed
 * description instead of a live call.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';
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
await useFixtures();
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
  await make('lst_words_zorblax', template.sellerId, 'Zorblax resin figure — limited', 'Figures');
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

await check('a different photo of the same thing, with a caption that names nothing, is found as that thing', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const all = await repository.listListings({});
  const template = all[0];
  // The same blue-and-black figure: standing alone on white for the listing,
  // smaller and off to one side on grey for the post. No shape in common as
  // whole frames; cut from their backdrops, the same figure.
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
  const matched = body.items.flatMap((item) => item.listings.map((listing) => listing.id));
  assert.ok(matched.includes('lst_probable_figure'), `the same figure in another photo is a match: ${matched}`);
  assert.ok(!matched.includes('lst_probable_red'), 'something else is not');
  const probable = body.probable.map((listing) => listing.id);
  assert.ok(!probable.includes('lst_probable_figure'), 'a match is not repeated as a guess');
  // Other colours are not probable: at most it is one of the poster's own, on that alone.
  const redGuess = body.probable.find((entry) => entry.id === 'lst_probable_red');
  assert.ok(!redGuess || redGuess.chance < 0.2, `other colours are not probable: ${redGuess?.chance}`);
  // What had to be worked out from the listing's photo is kept on the listing.
  const stored = await repository.getListing('lst_probable_figure');
  assert.match(stored.photos[0].imageHash ?? '', /^v2:[0-9a-f]{16}:[0-9a-f]{64}:[0-9a-f]{28}(:[0-9a-f]{16}){3}:[0-9a-f]{12}:[0-9a-f]{16}$/);
  assert.ok(Array.isArray(stored.photos[0].regions), 'and so are its items');

  // The poster's own listing is a fair guess even when the colours say little.
  forgetCatalogue();
  const unlike = await store.upload(picture(640, 480, (x, y) => (Math.floor((x + y) * 6) % 2 ? [40, 170, 60] : [230, 210, 40]), 80), 'image/jpeg');
  const own = (await photoSalesRoute(req({ body: { url: unlike.url, about: 'How is this?', by: template.sellerId } }), ctx)).jsonBody;
  assert.ok(own.probable.some((listing) => listing.sellerId === template.sellerId), 'the poster lists it, so it may be this');
  assert.ok(own.probable.filter((listing) => listing.chance < 0.2).length <= 3, 'only a few on that alone');
  const stranger = (await photoSalesRoute(req({ body: { url: unlike.url, about: 'How is this?' } }), ctx)).jsonBody;
  assert.ok(!stranger.probable.some((listing) => listing.id === 'lst_probable_figure'), 'from anyone else, it is not');

  // Its shop is named once: with the certain matches when it has one, else as one with similar listings.
  const named = [...body.items.flatMap((item) => item.listings.map((listing) => listing.sellerId)), ...body.likely.map((entry) => entry.seller.id)];
  assert.ok(named.includes(template.sellerId), 'the shop behind a probable match is named');
});

await check('several photos are answered in one request, in order, and an answer is kept', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const listed = (await repository.listListings({})).find((listing) => listing.id === 'lst_sales_live');
  assert.ok(listed, 'the listing from the check above');
  // Its fingerprint was stored on it by the first look, so no instance reads its photo again.
  assert.match(listed.photos[0].imageHash ?? '', /^v2:[0-9a-f]{16}:[0-9a-f]{64}:[0-9a-f]{28}(:[0-9a-f]{16}){3}:[0-9a-f]{12}:[0-9a-f]{16}$/);
  forgetCatalogue();
  const other = await store.upload(picture(640, 480, (x, y) => (Math.floor((x + y) * 6) % 2 ? [40, 170, 60] : [230, 210, 40]), 80), 'image/jpeg');
  const response = await photoSalesRoute(req({ body: { photos: [
    { url: listed.photos[0].url },
    { url: 'https://example.com/haul.jpg' },
    { url: other.url, about: 'My Zorblax arrived!' },
  ] } }), ctx);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  const { answers } = response.jsonBody;
  assert.equal(answers.length, 3);
  assert.ok(answers[0].items[0].listings.some((listing) => listing.id === 'lst_sales_live'), 'the first is the listed photo');
  assert.deepEqual(answers[1].items, [], 'somebody else\'s photo says nothing');
  assert.ok(answers[2].items.some((item) => item.listings.some((listing) => /Zorblax/.test(listing.title))), 'the third by its words');
  // The same photo again, from the same catalogue, is the same answer.
  const again = (await photoSalesRoute(req({ body: { url: listed.photos[0].url } }), ctx)).jsonBody;
  assert.deepEqual(again.items, answers[0].items);
  assert.equal((await photoSalesRoute(req({ body: { photos: [] } }), ctx)).status, 400);
  assert.equal((await photoSalesRoute(req({ body: { photos: Array(11).fill({ url: other.url }) } }), ctx)).status, 400);
});

await check('photos from anywhere else are not looked at', async () => {
  const outside = await photoSalesRoute(req({ body: { url: 'https://example.com/haul.jpg' } }), ctx);
  assert.equal(outside.status, 200);
  assert.deepEqual(outside.jsonBody.items, []);
  const missing = await photoSalesRoute(req({ body: { url: '/api/photos/nothing-here.jpg' } }), ctx);
  assert.deepEqual(missing.jsonBody.items, []);
  assert.equal((await photoSalesRoute(req({ body: {} }), ctx)).status, 400);
});

/**
 * A photo as a camera takes it: sensor noise and light falling one way or
 * another, seeded so a run is the same every time. Flat synthetic colour is
 * the one thing no real photo is.
 */
function camera(width, height, paint, { seed = 1, light = [6, -4], quality = 85 } = {}) {
  let state = seed;
  const noise = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648 - 0.5; };
  return picture(width, height, (x, y) => {
    const shift = noise() * 10 + light[0] * x + light[1] * y;
    return paint(x, y).map((value) => Math.max(0, Math.min(255, Math.round(value + shift))));
  }, quality);
}
const cream = [235, 230, 220];
/** A red boot with a yellow band, toe to the right (or left), at (cx, cy), `size` across. */
const boot = (cx, cy, size, { flip = false, ground = cream } = {}) => (x, y) => {
  let u = (x - cx) / size; const v = (y - cy) / size;
  if (flip) u = -u;
  const leg = u > -0.3 && u < 0.1 && v > -0.6 && v < 0.3;
  const foot = u > -0.3 && u < 0.6 && v >= 0.3 && v < 0.55;
  if (leg && v > -0.2 && v < -0.05) return [250, 220, 40];
  return leg || foot ? [200, 40, 50] : ground;
};
const shape = (inside, colour, ground = cream) => (x, y) => (inside(x, y) ? colour : ground);
const roundel = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < r * r;
const block = (cx, cy, r) => (x, y) => Math.abs(x - cx) < r && Math.abs(y - cy) < r;
const { decode } = require('jpeg-js');
const pixels = (bytes) => decode(Buffer.from(bytes), { useTArray: true, formatAsRGBA: true });
const { detectItems, printsOfPixels } = await import(new URL('image-hash.js', dist));

await check('the same thing in another photo - closer, off to one side, on another backdrop, facing the other way - is the same item', async () => {
  const listed = fingerprint(camera(400, 300, boot(0.5, 0.5, 0.4)), 'image/jpeg');
  const others = [
    camera(400, 300, boot(0.3, 0.45, 0.25), { seed: 2, light: [-8, 3] }),
    camera(400, 300, boot(0.65, 0.5, 0.3, { ground: [180, 200, 230] }), { seed: 3, light: [2, 9] }),
    camera(400, 300, boot(0.5, 0.5, 0.4, { flip: true }), { seed: 4, light: [-5, -5] }),
    camera(400, 300, boot(0.35, 0.5, 0.3, { flip: true, ground: [180, 200, 230] }), { seed: 5, light: [9, 0] }),
  ];
  for (const [at, bytes] of others.entries()) {
    const alike = likeness(listed, fingerprint(bytes, 'image/jpeg'));
    assert.equal(alike.sameItem, true, `photo ${at} is the same boot: ${JSON.stringify(alike)}`);
    assert.ok(alike.score >= 0.78, `photo ${at} looks alike: ${alike.score}`);
  }
  // The same colours in another shape, and another colour in the same place, are not.
  const unlike = [
    camera(400, 300, shape(roundel(0.5, 0.5, 0.25), [200, 40, 50]), { seed: 6 }),
    camera(400, 300, shape(block(0.5, 0.5, 0.25), [200, 40, 50]), { seed: 7 }),
    camera(400, 300, shape(roundel(0.5, 0.5, 0.25), [30, 60, 200]), { seed: 8 }),
  ];
  for (const [at, bytes] of unlike.entries()) {
    const alike = likeness(listed, fingerprint(bytes, 'image/jpeg'));
    assert.equal(alike.sameItem, false, `shape ${at} is not the boot: ${JSON.stringify(alike)}`);
    assert.equal(alike.samePhoto, false);
    assert.ok(alike.score < 0.78, `shape ${at} does not look alike: ${alike.score}`);
  }
  // A flipped repost of a photo is still that photo.
  const mirrored = likeness(listed, fingerprint(camera(400, 300, boot(0.5, 0.5, 0.4, { flip: true }), { light: [-6, -4] }), 'image/jpeg'));
  assert.equal(mirrored.samePhoto, true, JSON.stringify(mirrored));
});

await check('a camera held at a slant still finds the thing; another colour of it is only a look-alike', async () => {
  const { tiltedFingerprints } = await import(new URL('image-hash.js', dist));
  const listed = fingerprint(camera(400, 300, boot(0.5, 0.5, 0.4)), 'image/jpeg');
  /** The boot, turned by `degrees` about the middle of the frame. */
  const tilted = (degrees) => {
    const turn = (degrees * Math.PI) / 180;
    const level = boot(0.5, 0.5, 0.4);
    return (x, y) => {
      const dx = (x - 0.5) * (4 / 3); const dy = y - 0.5;
      return level(0.5 + (Math.cos(turn) * dx - Math.sin(turn) * dy) * 0.75, 0.5 + Math.sin(turn) * dx + Math.cos(turn) * dy);
    };
  };
  const searchedWith = (paint, seed) => {
    const bytes = camera(400, 300, paint, { seed, light: [-3, 7] });
    return [fingerprint(bytes, 'image/jpeg'), ...tiltedFingerprints(pixels(bytes))];
  };
  const best = (hashes) => hashes.map((hash) => likeness(listed, hash))
    .reduce((a, b) => ({ sameItem: a.sameItem || b.sameItem, score: Math.max(a.score, b.score) }));
  for (const [at, degrees] of [12, -18, 22].entries()) {
    const found = best(searchedWith(tilted(degrees), 20 + at));
    assert.equal(found.sameItem, true, `tilted ${degrees} degrees: ${JSON.stringify(found)}`);
  }
  assert.equal(best(searchedWith(shape(block(0.5, 0.5, 0.25), [200, 40, 50]), 30)).sameItem, false, 'tilting a block does not make it the boot');
  // The boot in blue: the same picture, recoloured, but not the red one.
  const blue = likeness(listed, fingerprint(camera(400, 300, (x, y) => {
    const colour = boot(0.5, 0.5, 0.4)(x, y);
    return colour[0] === 200 ? [30, 60, 200] : colour;
  }), 'image/jpeg'));
  assert.equal(blue.sameItem, false, JSON.stringify(blue));
});

/** A shelf: a red disc, a blue block and a boot, apart on a pale ground. */
const shelf = (x, y) => {
  if (roundel(0.2, 0.5, 0.12)(x, y)) return [200, 40, 50];
  if (block(0.5, 0.5, 0.1)(x, y)) return [30, 60, 200];
  return boot(0.8, 0.5, 0.25, { ground: [245, 245, 245] })(x, y);
};

await check('a photo of several things is told apart into each, and each gets a fingerprint of its own', async () => {
  const raw = pixels(camera(800, 400, shelf));
  const items = detectItems(raw);
  assert.equal(items.length, 3, JSON.stringify(items));
  const centres = items.map(([x, , w]) => x + w / 2).sort();
  assert.ok(centres[0] < 0.3 && centres[1] > 0.4 && centres[1] < 0.6 && centres[2] > 0.7, JSON.stringify(centres));
  const prints = printsOfPixels(raw);
  assert.equal(prints.regions.length, 3);
  assert.notEqual(prints.regions[0].imageHash, prints.hash);
  // The boot on the shelf is the boot alone; the other two are not.
  const lone = fingerprint(camera(400, 300, boot(0.5, 0.5, 0.4, { ground: [245, 245, 245] }), { seed: 9 }), 'image/jpeg');
  const same = prints.regions.filter((region) => likeness(lone, region.imageHash).sameItem);
  assert.equal(same.length, 1, 'one item on the shelf is the boot');
  assert.ok(same[0].box[0] > 0.6, 'and it is the one on the right');
  // One thing alone is not split.
  assert.deepEqual(detectItems(pixels(camera(400, 300, boot(0.5, 0.5, 0.4)))), []);
});

await check('a photo search names each item, and the shopper can search with one, or the whole photo', async () => {
  const repository = await getRepository();
  const store = await getPhotoStore();
  const [template] = await repository.listListings({});
  const now = new Date().toISOString();
  const make = async (id, title, bytes) => {
    const photo = await store.upload(bytes, 'image/jpeg');
    await repository.createListing({
      ...template, id, title, tags: [], category: 'Figures', createdAt: now, updatedAt: now, privateFor: null, expiresAt: null,
      unlisted: false, status: 'active', photos: [{ blobName: photo.blobName, url: photo.url, imageHash: null, isPrimary: true }],
    });
  };
  // Each listed on its own, photographed differently from the shelf.
  await make('lst_item_boot', 'Qwopple boot', camera(500, 400, boot(0.45, 0.5, 0.45, { flip: true, ground: [200, 215, 235] }), { seed: 11 }));
  await make('lst_item_disc', 'Qwopple disc', camera(500, 400, shape(roundel(0.55, 0.45, 0.3), [200, 40, 50], [225, 225, 210]), { seed: 12 }));
  // And a bundle whose one photo shows the boot among other things.
  await make('lst_item_bundle', 'Qwopple bundle', camera(900, 400, (x, y) => {
    if (block(0.15, 0.5, 0.1)(x, y)) return [40, 160, 70];
    return boot(0.75, 0.5, 0.3, { ground: [240, 240, 236] })(x, y);
  }, { seed: 13 }));

  const shot = dataUrl(camera(800, 400, shelf, { seed: 14, light: [-4, 6] }));
  const whole = await photoSearchRoute(req({ body: { dataUrl: shot } }), ctx);
  assert.equal(whole.status, 200, JSON.stringify(whole.jsonBody));
  const { items, region, listings } = whole.jsonBody;
  assert.equal(region, null, 'the whole photo was searched');
  assert.equal(items.length, 3, JSON.stringify(items.map((item) => item.box)));
  const bootItem = items.find((item) => item.box[0] > 0.6);
  assert.ok(bootItem, 'the boot is one of the items');
  const peek = bootItem.preview.map((entry) => entry.id);
  assert.ok(peek.includes('lst_item_boot'), `the boot's own listing is in its peek: ${peek}`);
  assert.ok(peek.includes('lst_item_bundle'), `so is the bundle showing it among others: ${peek}`);
  assert.ok(bootItem.matches >= 2);
  // The whole photo finds what is in it, item by item.
  const ids = listings.map((listing) => listing.id);
  for (const id of ['lst_item_boot', 'lst_item_disc', 'lst_item_bundle']) assert.ok(ids.includes(id), `${id} found from the whole photo`);

  // Tapping the boot searches with it alone: the boot first, and the disc is no match.
  const one = await photoSearchRoute(req({ body: { dataUrl: shot, region: bootItem.box } }), ctx);
  assert.equal(one.status, 200, JSON.stringify(one.jsonBody));
  assert.deepEqual(one.jsonBody.region, bootItem.box);
  assert.deepEqual(one.jsonBody.items, [], 'one item is not split again');
  const firstTwo = one.jsonBody.listings.slice(0, 2).map((listing) => listing.id).sort();
  assert.deepEqual(firstTwo, ['lst_item_boot', 'lst_item_bundle']);
  const discAt = one.jsonBody.listings.findIndex((listing) => listing.id === 'lst_item_disc');
  assert.ok(discAt === -1 || discAt > 1, 'the disc is no match for the boot');

  // A box the shopper draws round the disc searches with that.
  const drawn = await photoSearchRoute(req({ body: { dataUrl: shot, region: [0.05, 0.2, 0.3, 0.6] } }), ctx);
  assert.equal(drawn.jsonBody.listings[0].id, 'lst_item_disc');

  // A box that is not one is refused.
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: shot, region: [0.1, 0.1] } }), ctx)).status, 400);
  assert.equal((await photoSearchRoute(req({ body: { dataUrl: shot, region: [0.5, 0.5, 0, 0] } }), ctx)).status, 400);

  // The listings learned their items' fingerprints, so nobody works them out again.
  const bundle = await repository.getListing('lst_item_bundle');
  assert.equal(bundle.photos[0].regions.length, 2, 'the bundle photo carries a fingerprint for each thing in it');
});

await check('health says photo search is matching by picture only', async () => {
  const body = (await healthRoute(req(), ctx)).jsonBody;
  assert.equal(body.photoSearch.vision, false);
  assert.match(body.photoSearch.detail, /ANTHROPIC_API_KEY/);
});

console.log(`\n${passed} photo search checks passed`);
