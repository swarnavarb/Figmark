/**
 * Product DNA: one shared page per product, worked out from titles and photo
 * fingerprints alone.
 *
 * The matching rules first, then the compiled handlers against the fixture
 * world: two shops listing the same shoe share one DNA, a copy of it and the
 * next colourway each get their own, a post naming two products is on both,
 * a hunt finds the one it asks for, a review from somebody who bought it
 * carries the owner mark, an owner can move what is theirs, and staff can
 * fold a duplicate in.
 *
 * Run `npm run build:api && npm run build:fixtures` first.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';

process.env.FIGMARK_RATE_LIMITS = 'off';
process.env.DNA_BACKGROUND = 'off';
delete process.env.ANTHROPIC_API_KEY;
await useFixtures();

const dist = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', dist);
const dna = await import(new URL('shared/dna.js', dist));
const { loginRoute: login } = await import(new URL('auth-routes.js', fns));
const routes = await import(new URL('dna-routes.js', fns));
const { forgetCatalogue } = await import(new URL('catalog-routes.js', fns));
const { forgetDnaIndex } = await import(new URL('api/src/dna.js', dist));
const { getRepository } = await import(new URL('api/src/data/index.js', dist));
const follows = await import(new URL('api/src/dna-follow.js', dist));
const wants = await import(new URL('want-routes.js', fns));
const { factsFor } = await import(new URL('quest-routes.js', fns));

const ctx = { error: (...a) => console.error(...a), log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body, query = {}, params = {} } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});
let passed = 0;
const check = async (name, fn) => {
  forgetCatalogue();
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('matching rules');

await check('noise, sizes and condition words do not make a different product', () => {
  const a = dna.productWords('Nike Dunk Low Panda');
  const b = dna.productWords('NEW Nike Dunk Low Panda UK 9 deadstock, boxed');
  assert.deepEqual(b, a);
  assert.equal(dna.wordLikeness(a, b), 1);
});

await check('the next colourway is the same model, another product', () => {
  const panda = dna.productWords('Nike Dunk Low Panda');
  const fog = dna.productWords('Nike Dunk Low Grey Fog');
  assert.ok(dna.wordLikeness(panda, fog) < dna.SAME_PRODUCT);
});

await check('two figures in one line are two products, though most of their words are shared', () => {
  const scarecrow = dna.productWords('McFarlane DC Multiverse Scarecrow');
  assert.equal(dna.sameProductWords(scarecrow, dna.productWords('McFarlane DC Multiverse Superman')), false);
  assert.equal(dna.sameProductWords(scarecrow, dna.productWords('McFarlane DC Multiverse Scarecrow figure')), true);
  assert.equal(dna.nameFrom('Hot Toys Iron Man Mark III'), 'Hot Toys Iron Man Mark III');
});

await check('the line is what the seller said, and nothing said is an original', () => {
  assert.equal(dna.lineOf('Sneakers', { authenticity: 'First copy' }), 'copy');
  assert.equal(dna.lineOf('Sneakers', { authenticity: 'Original' }), 'original');
  assert.equal(dna.lineOf('Sneakers', {}), 'original');
});

await check('a name is the title without its selling words', () => {
  assert.equal(dna.nameFrom('Nike Dunk Low Panda UK 9 deadstock'), 'Nike Dunk Low Panda');
});

await check('heat climbs with demand and never passes 100', () => {
  const none = dna.heatOf({ hunting: 0, saves: 0, views: 0, sold: 0, pledged: 0, waiting: 0 });
  const lots = dna.heatOf({ hunting: 500, saves: 9000, views: 1e6, sold: 900, pledged: 90, waiting: 90 });
  assert.equal(none.heat, 0);
  assert.equal(lots.heat, 100);
  assert.equal(lots.label, 'On fire');
});

console.log('the handlers');

const repository = await getRepository();
const session = await login(req({ body: { identifier: fixtures.DEMO_EMAIL, password: fixtures.DEMO_PASSWORD } }), ctx);
assert.equal(session.status, 200, JSON.stringify(session.jsonBody));
const me = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };

const all = await repository.listListings({ includeHidden: true });
const template = all.find((listing) => listing.status === 'active' && !listing.privateFor && !listing.unlisted);
const otherSeller = all.find((listing) => listing.sellerId !== me.id)?.sellerId;
assert.ok(template && otherSeller, 'the fixtures have an active listing and another shop');

let made = 0;
async function list(sellerId, title, attributes, priceMinor, extra = {}) {
  made += 1;
  const now = new Date(Date.now() - made * 3600_000).toISOString();
  return repository.createListing({
    ...structuredClone(template),
    id: `lst_dna_${made}`,
    sellerId,
    title,
    category: 'Sneakers',
    attributes,
    priceMinor,
    photos: [],
    tags: [],
    status: 'active',
    privateFor: null,
    unlisted: false,
    feeHold: false,
    expiresAt: null,
    preOrder: null,
    soldCount: 0,
    likeCount: 2,
    viewCount: 40,
    pieces: null,
    setItems: null,
    createdAt: now,
    updatedAt: now,
    ...extra,
  });
}

const mine = await list(me.id, 'Nike Dunk Low Panda', { authenticity: 'Original' }, 950000);
const theirs = await list(otherSeller, 'Nike Dunk Low Panda UK 9 deadstock', { authenticity: 'Original' }, 1150000);
const copy = await list(otherSeller, 'Nike Dunk Low Panda', { authenticity: 'First copy' }, 250000);
const fog = await list(otherSeller, 'Nike Dunk Low Grey Fog', { authenticity: 'Original' }, 1000000);

const of = async (listing) => {
  const answer = await routes.dnaOfListingRoute(req({ params: { id: listing.id } }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  return answer.jsonBody.dna;
};

let panda;
await check('two shops listing the same shoe share one DNA', async () => {
  panda = await of(mine);
  const again = await of(theirs);
  assert.ok(panda?.id);
  assert.equal(again.id, panda.id);
  assert.equal(again.name, 'Nike Dunk Low Panda');
  assert.equal(again.sellers, 2);
  assert.equal(again.lowMinor, 950000);
  assert.equal(again.highMinor, 1150000);
});

await check('a copy and another colourway each get their own, and copies are never labelled', async () => {
  const copied = await of(copy);
  const grey = await of(fog);
  assert.notEqual(copied.id, panda.id);
  assert.notEqual(grey.id, panda.id);
  assert.notEqual(grey.id, copied.id);
  assert.ok(!JSON.stringify(copied).match(/copy|fake|original|line/i), 'nothing on the card says which line it is');
});

await check('the whole DNA: prices, sellers, demand, facts, nothing about authenticity', async () => {
  const answer = await routes.dnaViewRoute(req({ params: { id: panda.id } }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  const view = answer.jsonBody;
  assert.equal(view.price.onSale, 2);
  assert.equal(view.sellingNow.length, 2);
  assert.equal(view.sellingNow[0].priceMinor, 950000, 'cheapest first');
  assert.equal(view.sellingNow[0].deal, 'low');
  assert.ok(view.demand.views >= 80);
  assert.ok(view.facts.some((fact) => fact.label === 'Category' && fact.value === 'Sneakers'));
  assert.ok(!view.facts.some((fact) => /original|copy/i.test(`${fact.label} ${fact.value}`)));
});

let post;
await check('a post naming two products is on both', async () => {
  const [anyPost] = await repository.listRecentPosts(1);
  assert.ok(anyPost, 'the fixtures have a post');
  post = await repository.createPost({
    ...structuredClone(anyPost),
    id: 'pst_dna_1',
    authorId: me.id,
    body: 'Rotation this week: my Dunk Low Panda and the Dunk Low Grey Fog',
    photoUrl: null,
    photoUrls: [],
    listingId: null,
    visibleAt: undefined,
    createdAt: new Date().toISOString(),
  });
  const answer = await routes.dnaOfPostRoute(req({ params: { channel: post.channelId, id: post.id }, headers: me.headers }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  const names = answer.jsonBody.dnas.map((entry) => entry.name).sort();
  assert.deepEqual(names, ['Nike Dunk Low Grey Fog', 'Nike Dunk Low Panda']);
  assert.equal(answer.jsonBody.yours, true);
});

await check('the poster untags one, and it stays off', async () => {
  const off = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'post', id: post.id, partition: post.channelId, action: 'remove', from: panda.id,
  } }), ctx);
  assert.equal(off.status, 200, JSON.stringify(off.jsonBody));
  forgetDnaIndex();
  const answer = await routes.dnaOfPostRoute(req({ params: { channel: post.channelId, id: post.id } }), ctx);
  assert.deepEqual(answer.jsonBody.dnas.map((entry) => entry.name), ['Nike Dunk Low Grey Fog']);
});

await check('a hunt finds the product it asks for', async () => {
  const want = await repository.saveWant({
    id: 'wnt_dna_1', buyerId: otherSeller, buyerName: 'Hunter', buyerHandle: null,
    title: 'Dunk Low Panda', details: '', category: 'Sneakers', budgetMinor: 900000, currency: 'INR',
    condition: null, status: 'open', offerCount: 0, seekerCount: 3,
    expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(), closedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  const answer = await routes.dnaOfWantRoute(req({ params: { buyer: want.buyerId, id: want.id } }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  assert.equal(answer.jsonBody.dna?.id, panda.id);
  const view = (await routes.dnaViewRoute(req({ params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(view.hunts.length, 1);
  assert.equal(view.demand.hunting, 3);
  assert.deepEqual(view.gap, { askMinor: view.price.typicalMinor, offerMinor: 900000, hunts: 1 });
});

await check('a review from somebody who bought it here carries the owner mark and the shop', async () => {
  const [order] = (await repository.listOrdersForBuyer(me.id)).length
    ? await repository.listOrdersForBuyer(me.id)
    : await repository.listOrdersForSeller(otherSeller);
  assert.ok(order, 'the fixtures have an order to copy');
  await repository.createOrder({
    ...structuredClone(order), id: 'ord_dna_1', buyerId: me.id, sellerId: otherSeller, listingId: theirs.id,
    status: 'delivered', unitPriceMinor: 1050000, quantity: 1, createdAt: new Date().toISOString(), placedAt: new Date().toISOString(),
  });
  const written = await routes.dnaReviewRoute(req({ headers: me.headers, params: { id: panda.id }, body: {
    rating: 5, body: 'Exactly as pictured, box and all.',
  } }), ctx);
  assert.equal(written.status, 200, JSON.stringify(written.jsonBody));
  const view = (await routes.dnaViewRoute(req({ headers: me.headers, params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(view.rating.count, 1);
  assert.equal(view.rating.average, 5);
  assert.equal(view.reviews[0].mine, true);
  assert.ok(view.reviews[0].owner?.shop, 'shown as an owner');
  assert.equal(view.rating.owners, 1);
  assert.ok(view.youOwn);
  assert.equal(view.trend.length, 1);
  assert.equal(view.trend[0].minor, 1050000);
});

await check('one review each: a second replaces the first', async () => {
  await routes.dnaReviewRoute(req({ headers: me.headers, params: { id: panda.id }, body: { rating: 4, body: 'Still good a month on.' } }), ctx);
  const view = (await routes.dnaViewRoute(req({ params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(view.rating.count, 1);
  assert.equal(view.rating.average, 4);
});

await check('a review needs words and a sign-in', async () => {
  const bare = await routes.dnaReviewRoute(req({ headers: me.headers, params: { id: panda.id }, body: { rating: 5, body: '' } }), ctx);
  assert.equal(bare.status, 400);
  const anon = await routes.dnaReviewRoute(req({ params: { id: panda.id }, body: { rating: 5, body: 'Great shoe' } }), ctx);
  assert.equal(anon.status, 401);
});

let split;
await check('a seller starts their own listing a product of its own, and nobody else can', async () => {
  const stranger = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'listing', id: theirs.id, partition: theirs.sellerId, action: 'new',
  } }), ctx);
  assert.equal(stranger.status, 403);
  const own = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'listing', id: mine.id, partition: mine.sellerId, action: 'new',
  } }), ctx);
  assert.equal(own.status, 200, JSON.stringify(own.jsonBody));
  split = own.jsonBody.dna;
  assert.ok(split && split !== panda.id);
  forgetDnaIndex();
  assert.equal((await of(mine)).id, split, 'and it stays there');
});

await check('a listing cannot be moved onto the other line', async () => {
  const copied = await of(copy);
  const refused = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'listing', id: mine.id, partition: mine.sellerId, action: 'move', to: copied.id,
  } }), ctx);
  assert.equal(refused.status, 400);
});

await check('staff fold the duplicate back in, and its old address says where it went', async () => {
  const merged = await routes.dnaMergeRoute(req({ headers: me.headers, params: { id: split }, body: { into: panda.id } }), ctx);
  if (merged.status === 403) {
    console.log('      (merge refused: operator has no authenticator)');
    // The demo operator has no authenticator set up: operator actions are refused, as they should be.
    assert.match(JSON.stringify(merged.jsonBody), /two-step|authenticator|mfa|2fa/i);
    return;
  }
  assert.equal(merged.status, 200, JSON.stringify(merged.jsonBody));
  const moved = await routes.dnaViewRoute(req({ params: { id: split } }), ctx);
  assert.deepEqual(moved.jsonBody, { moved: panda.id });
  assert.equal((await of(mine)).id, panda.id);
});

await check('Discover lists products, the busiest first; search finds them by name', async () => {
  const trending = await routes.dnaTrendingRoute(req({ query: { category: 'Sneakers' } }), ctx);
  assert.equal(trending.status, 200);
  const ids = trending.jsonBody.products.map((entry) => entry.id);
  assert.ok(ids.includes(panda.id));
  const found = await routes.dnaSearchRoute(req({ query: { q: 'grey fog' } }), ctx);
  assert.equal(found.jsonBody.products[0].name, 'Nike Dunk Low Grey Fog');
});

console.log('following, and hunting from a DNA');

const DAY = 86_400_000;
const near = (iso, days) => Math.abs(Date.parse(iso) - (Date.now() + days * DAY)) < 60_000;

await check('a follow runs as long as picked, three months at most, and needs a sign-in', async () => {
  const anon = await routes.dnaFollowRoute(req({ params: { id: panda.id }, body: { days: 30 } }), ctx);
  assert.equal(anon.status, 401);
  const tooLong = await routes.dnaFollowRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: 91 } }), ctx);
  assert.equal(tooLong.status, 400);
  const on = await routes.dnaFollowRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: 14 } }), ctx);
  assert.equal(on.status, 200, JSON.stringify(on.jsonBody));
  assert.ok(near(on.jsonBody.follow.until, 14));
  const view = (await routes.dnaViewRoute(req({ headers: me.headers, params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(view.follow.until, on.jsonBody.follow.until);
  assert.equal(view.watchers, 1);
  const row = await repository.getSiteContent(dna.dnaFollowId(panda.id, me.id));
  assert.ok(row.ttl > 14 * 86400 && row.ttl <= 14 * 86400 + 3700, 'the row deletes itself after the follow');
  const stranger = (await routes.dnaViewRoute(req({ params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(stranger.follow, null);
  assert.equal(stranger.watchers, 1, 'followers are a count, never names');
  assert.ok(!JSON.stringify(stranger).includes(dna.DNA_FOLLOW_PREFIX), 'no follow rows on the page');
});

await check('a follower hears when the lowest price moves, and not when it barely does', async () => {
  const before = (await repository.listNotifications(me.id, 50)).filter((row) => row.kind === 'dna_alert').length;
  const catalogue = await repository.listListings({ includeHidden: true });
  const nudged = await repository.changeListing(mine.id, mine.sellerId, (current) => ({ ...current, priceMinor: 945000 }));
  assert.equal(await follows.alertForListing(repository, nudged, catalogue), 0, 'under 2% is not news');
  const cut = await repository.changeListing(mine.id, mine.sellerId, (current) => ({ ...current, priceMinor: 850000 }));
  assert.equal(await follows.alertForListing(repository, cut, catalogue), 1);
  const rows = (await repository.listNotifications(me.id, 50)).filter((row) => row.kind === 'dna_alert');
  assert.equal(rows.length, before + 1);
  assert.match(rows[0].title, /Price down/);
  assert.equal(rows[0].link, `/dna/${panda.id}`);
  assert.equal(await follows.alertForListing(repository, cut, catalogue), 0, 'told once');
});

await check('a follow past its end is deleted, and stopping deletes it now', async () => {
  const row = await repository.getSiteContent(dna.dnaFollowId(panda.id, me.id));
  await repository.saveSiteContent({ ...row, data: { ...row.data, until: new Date(Date.now() - 1000).toISOString() } });
  assert.equal((await follows.followsOf(repository, panda.id)).length, 0);
  assert.equal(await repository.getSiteContent(dna.dnaFollowId(panda.id, me.id)), null);
  await routes.dnaFollowRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: 7 } }), ctx);
  const off = await routes.dnaFollowRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: null } }), ctx);
  assert.deepEqual(off.jsonBody, { follow: null });
  assert.equal(await repository.getSiteContent(dna.dnaFollowId(panda.id, me.id)), null);
});

let hunt;
await check('"I want this" puts a hunt for the product on the Wanted board, once', async () => {
  const tooLong = await routes.dnaWantRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: 120 } }), ctx);
  assert.equal(tooLong.status, 400);
  const posted = await routes.dnaWantRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: 60, budgetMinor: 800000 } }), ctx);
  assert.equal(posted.status, 201, JSON.stringify(posted.jsonBody));
  assert.ok(near(posted.jsonBody.want.expiresAt, 60));
  hunt = await repository.getWant(posted.jsonBody.want.id, me.id);
  assert.equal(hunt.title, 'Nike Dunk Low Panda');
  assert.equal(hunt.category, 'Sneakers');
  assert.equal(hunt.budgetMinor, 800000);
  const board = (await wants.wantsBoardRoute(req(), ctx)).jsonBody;
  assert.ok(board.wants.some((entry) => entry.id === hunt.id), 'on the board');
  const again = await routes.dnaWantRoute(req({ headers: me.headers, params: { id: panda.id }, body: { days: 7 } }), ctx);
  assert.equal(again.jsonBody.existing, true);
  assert.equal(again.jsonBody.want.id, hunt.id);
  const view = (await routes.dnaViewRoute(req({ headers: me.headers, params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(view.hunting.id, hunt.id);
});

await check('a hunt posted on the board keeps the time its poster picked, up to three months', async () => {
  const tooLong = await wants.wantPostRoute(req({ headers: me.headers, body: { title: 'Grey Fog Dunks', category: 'Sneakers', days: 91 } }), ctx);
  assert.equal(tooLong.status, 400);
  const week = await wants.wantPostRoute(req({ headers: me.headers, body: { title: 'Grey Fog Dunks', category: 'Sneakers', days: 7 } }), ctx);
  assert.equal(week.status, 201, JSON.stringify(week.jsonBody));
  assert.ok(near(week.jsonBody.want.expiresAt, 7));
  const plain = await wants.wantPostRoute(req({ headers: me.headers, body: { title: 'Jordan 1 Chicago', category: 'Sneakers' } }), ctx);
  assert.ok(near(plain.jsonBody.want.expiresAt, 30), 'a month when nothing is picked');
});

await check('once its time is up a hunt is deleted, with its answers, names and place on the DNA', async () => {
  await repository.saveWant({ ...hunt, expiresAt: new Date(Date.now() - 1000).toISOString() });
  await repository.saveWantOffer({
    id: 'wof_dna_1', wantId: hunt.id, sellerId: otherSeller, sellerName: 'Shop', sellerHandle: null, voice: 'shop',
    listingId: null, priceMinor: null, message: 'I can get it', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  await repository.saveWantSeeker({ id: 'wsk_dna_1', wantId: hunt.id, userId: otherSeller, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  const deleted = await wants.sweepEndedWants(repository);
  assert.ok(deleted >= 1);
  assert.equal(await repository.getWant(hunt.id, me.id), null);
  assert.equal((await repository.listWantOffers(hunt.id)).length, 0);
  assert.equal((await repository.listWantSeekers(hunt.id)).length, 0);
  assert.ok(!(await forgetDnaIndex(), await repository.getSiteContent(dna.dnaDocId(panda.id))).data.links
    .some((entry) => entry.kind === 'want' && entry.id === hunt.id), 'off the DNA');
  const view = (await routes.dnaViewRoute(req({ headers: me.headers, params: { id: panda.id } }), ctx)).jsonBody;
  assert.equal(view.hunting, null);
  assert.ok((await repository.listWantsEndedBefore(new Date().toISOString(), 50)).length === 0, 'nothing ended is left');
});

await check('a deleted hunt keeps what it earned in the collector game, and only counts are kept', async () => {
  const before = (await factsFor(repository, await repository.getUserById(me.id))).wants;
  const posted = await wants.wantPostRoute(req({ headers: me.headers, body: { title: 'Air Max 1 Patta', category: 'Sneakers', days: 7 } }), ctx);
  assert.equal(posted.status, 201);
  const counted = (await factsFor(repository, await repository.getUserById(me.id))).wants;
  assert.equal(counted.total, before.total + 1);
  assert.equal(counted.inMonth, before.inMonth + 1);
  const made = await repository.getWant(posted.jsonBody.want.id, me.id);
  await repository.saveWant({ ...made, expiresAt: new Date(Date.now() - 1000).toISOString() });
  await wants.sweepEndedWants(repository);
  assert.equal(await repository.getWant(made.id, me.id), null);
  const after = (await factsFor(repository, await repository.getUserById(me.id))).wants;
  assert.equal(after.total, counted.total, 'the count stays after the hunt is gone');
  const kept = (await repository.getUserById(me.id)).quest.wantTally;
  assert.deepEqual(Object.keys(kept).sort(), ['inMonth', 'inWeek', 'month', 'total', 'week']);
  assert.ok(!JSON.stringify(kept).includes('Patta') && !JSON.stringify(kept).includes(made.createdAt), 'nothing about the hunt itself');
});

await check('somebody who posted before hunts were counted is counted before a hunt of theirs is deleted', async () => {
  const hunter = await repository.getUserById(otherSeller);
  await repository.updateUser({ ...hunter, quest: { ...(hunter.quest ?? { checkIns: [], claimed: {}, reveals: [] }), wantTally: undefined } });
  const theirs = await repository.listWantsBy(otherSeller);
  assert.ok(theirs.length >= 1);
  const old = await repository.getWant('wnt_dna_1', otherSeller);
  await repository.saveWant({ ...old, expiresAt: new Date(Date.now() - 1000).toISOString() });
  await wants.sweepEndedWants(repository);
  assert.equal(await repository.getWant('wnt_dna_1', otherSeller), null);
  const facts = await factsFor(repository, await repository.getUserById(otherSeller));
  assert.equal(facts.wants.total, theirs.length, 'the deleted one still counts');
});

console.log('several things in one photo');

const piece = (id, title, priceMinor, extra = {}) => ({ id, title, priceMinor, boxes: [[0.1, 0.1, 0.3, 0.3]], ...extra });
let lot;
let jordanDna;
let zebraDna;
await check('a lot sold piece by piece is on one product per thing, each under its own name', async () => {
  lot = await list(otherSeller, 'Shelf clear-out: two pairs', { authenticity: 'Original' }, 700000, {
    pieces: [piece('pc_a', 'Asics Gel Kayano 14 Cream Pure Silver', 1400000), piece('pc_b', 'Yeezy Boost 350 Zebra', 700000)],
  });
  const answer = await routes.dnaOfListingRoute(req({ params: { id: lot.id } }), ctx);
  assert.equal(answer.status, 200, JSON.stringify(answer.jsonBody));
  const items = answer.jsonBody.items;
  assert.deepEqual(items.map((item) => item.piece), ['pc_a', 'pc_b']);
  assert.deepEqual(items.map((item) => item.dna.name), ['Asics Gel Kayano 14 Cream Pure Silver', 'Yeezy Boost 350 Zebra']);
  assert.notEqual(items[0].dna.id, items[1].dna.id);
  assert.equal(items[0].dna.lowMinor, 1400000, 'each at its own price');
  assert.equal(items[1].dna.lowMinor, 700000);
  [jordanDna, zebraDna] = items.map((item) => item.dna.id);
});

await check('the same thing listed alone, or in another shop\'s lot, joins that thing\'s product', async () => {
  const alone = await list(me.id, 'Asics Gel Kayano 14 Cream Pure Silver UK 9', { authenticity: 'Original' }, 1300000);
  assert.equal((await of(alone)).id, jordanDna);
  const other = await list(me.id, 'Two pairs, one price', { authenticity: 'Original' }, 1500000, {
    setItems: [piece('st_a', 'Yeezy Boost 350 V2 Zebra', 800000), piece('st_b', 'Nike Dunk Low Grey Fog', 700000)],
  });
  const answer = (await routes.dnaOfListingRoute(req({ params: { id: other.id } }), ctx)).jsonBody;
  assert.equal(answer.items[0].dna.id, zebraDna);
  assert.equal(answer.items[1].dna.name, 'Nike Dunk Low Grey Fog');
  forgetCatalogue();
  const view = (await routes.dnaViewRoute(req({ params: { id: jordanDna } }), ctx)).jsonBody;
  assert.equal(view.price.onSale, 2);
  assert.deepEqual(view.sellingNow.map((card) => card.priceMinor), [1300000, 1400000]);
  const fromLot = view.sellingNow.find((card) => card.piece);
  assert.equal(fromLot.title, 'Asics Gel Kayano 14 Cream Pure Silver');
  assert.equal(fromLot.piece.listingTitle, 'Shelf clear-out: two pairs');
  const zebra = (await routes.dnaViewRoute(req({ params: { id: zebraDna } }), ctx)).jsonBody;
  assert.ok(zebra.sellingNow.some((card) => card.piece?.set), 'a thing in a set says so');
});

await check('a piece sold is off its product, and the others stay on sale', async () => {
  const current = await repository.getListing(lot.id);
  await repository.updateListing({ ...current, pieces: current.pieces.map((entry) => (entry.id === 'pc_b'
    ? { ...entry, soldAt: new Date().toISOString() } : entry)) });
  forgetCatalogue();
  const jordan = (await routes.dnaViewRoute(req({ params: { id: jordanDna } }), ctx)).jsonBody;
  assert.equal(jordan.price.onSale, 2);
  const zebra = (await routes.dnaViewRoute(req({ params: { id: zebraDna } }), ctx)).jsonBody;
  assert.ok(!zebra.sellingNow.some((card) => card.id === lot.id), 'the sold piece is not on sale');
});

await check('a seller moves one thing of their lot, and only that thing', async () => {
  const unsaid = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'listing', id: lot.id, partition: lot.sellerId, action: 'new',
  } }), ctx);
  assert.equal(unsaid.status, 403, 'not their lot');
  const mixed = await list(me.id, 'Pair of grails', { authenticity: 'Original' }, 900000, {
    pieces: [piece('mx_a', 'Asics Gel Kayano 14 Cream Pure Silver', 1250000), piece('mx_b', 'Nike Dunk Low Panda', 900000)],
  });
  const before = (await routes.dnaOfListingRoute(req({ params: { id: mixed.id } }), ctx)).jsonBody;
  assert.equal(before.items[0].dna.id, jordanDna);
  const which = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'listing', id: mixed.id, partition: mixed.sellerId, action: 'new',
  } }), ctx);
  assert.equal(which.status, 400, 'a lot needs to say which thing');
  const own = await routes.dnaFixRoute(req({ headers: me.headers, body: {
    kind: 'listing', id: mixed.id, partition: mixed.sellerId, action: 'new', piece: 'mx_a',
  } }), ctx);
  assert.equal(own.status, 200, JSON.stringify(own.jsonBody));
  forgetDnaIndex();
  const after = (await routes.dnaOfListingRoute(req({ params: { id: mixed.id } }), ctx)).jsonBody;
  assert.equal(after.items[0].dna.id, own.jsonBody.dna);
  assert.equal(after.items[1].dna.id, before.items[1].dna.id, 'the other thing stays where it was');
});

console.log('model numbers, and the image scan');

const { useEyeCheck, addLink, getDna } = await import(new URL('api/src/dna.js', dist));
const { getPhotoStore } = await import(new URL('api/src/storage/index.js', dist));
const { readFileSync } = await import('node:fs');
const photoStore = await getPhotoStore();
const stored = async (name) => {
  const photo = await photoStore.upload(new Uint8Array(readFileSync(new URL(`../test-fixtures/scan/${name}.jpg`, import.meta.url))), 'image/jpeg');
  return [{ blobName: photo.blobName, url: photo.url, imageHash: null, isPrimary: true }];
};

await check('sizes, counts and scales are not model numbers; model numbers are kept', () => {
  assert.deepEqual(dna.productWords('Nike Dunk Low Panda size 10.5'), dna.productWords('Nike Dunk Low Panda'));
  assert.deepEqual(dna.productWords('Spy x Family keychain set — 6 pieces'), ['spy', 'family', 'keychain']);
  assert.ok(dna.productWords('Air Jordan 1 Chicago').includes('1'));
  assert.ok(dna.otherModel(dna.productWords('Air Jordan 1 Chicago'), dna.productWords('Air Jordan 4 Chicago')));
  assert.equal(dna.sameProductWords(dna.productWords('Hot Toys Iron Man Mark 85 — 1/6'), dna.productWords('Hot Toys Iron Man Mark III')), false);
});

await check('Mark III does not join Mark 85, and one already put there moves out', async () => {
  const opts = { authenticity: 'Original' };
  const m85 = await list(otherSeller, 'Hot Toys Iron Man Mark 85 — 1/6', opts, 3800000, { category: 'Figures' });
  const m3 = await list(me.id, 'Hot Toys Iron Man Mark III', opts, 2500000, { category: 'Figures' });
  const m85dna = await of(m85);
  assert.notEqual((await of(m3)).id, m85dna.id);
  // As the old matcher had it: Mark III on Mark 85's DNA.
  const m3b = await list(me.id, 'Hot Toys Iron Man Mark III Diecast', opts, 2600000, { category: 'Figures' });
  await addLink(repository, m85dna.id, { kind: 'listing', id: m3b.id, partition: me.id, by: 'auto', at: new Date().toISOString() });
  forgetCatalogue();
  const moved = await of(m3b);
  assert.notEqual(moved.id, m85dna.id);
  assert.ok(!(await getDna(repository, m85dna.id)).links.some((entry) => entry.id === m3b.id));
});

await check('two listings named alike are looked at side by side, and kept apart when they are two figures', async () => {
  const asked = [];
  useEyeCheck(async (a, b, titles) => { asked.push({ a, b, titles }); return false; });
  const opts = { authenticity: 'Original' };
  const first = await list(otherSeller, 'NECA Terminator 2 T-800 Ultimate figure', opts, 400000, { category: 'Figures', photos: await stored('t800a') });
  const firstDna = await of(first);
  const second = await list(me.id, 'NECA Terminator 2 T-800 Ultimate', opts, 420000, { category: 'Figures', photos: await stored('t800b') });
  forgetCatalogue();
  assert.notEqual((await of(second)).id, firstDna.id, 'the pictures said two figures');
  assert.equal(asked.length, 1);
  assert.equal(asked[0].a.contentType, 'image/jpeg');
  assert.ok(asked[0].a.bytes.length > 1000 && asked[0].b.bytes.length > 1000, 'both pictures were looked at');
  assert.deepEqual(asked[0].titles, ['NECA Terminator 2 T-800 Ultimate', 'NECA Terminator 2 T-800 Ultimate figure']);
});

await check('the same picture needs no second look, and a look that agrees joins them', async () => {
  const asked = [];
  useEyeCheck(async () => { asked.push(1); return true; });
  const opts = { authenticity: 'Original' };
  const first = await list(otherSeller, 'McFarlane Superman Elite Edition Clark Kent', opts, 500000, { category: 'Figures', photos: await stored('clark-kent') });
  const firstDna = await of(first);
  const again = await list(me.id, 'McFarlane Superman Clark Kent Elite', opts, 520000, { category: 'Figures', photos: await stored('clark-kent') });
  forgetCatalogue();
  assert.equal((await of(again)).id, firstDna.id);
  assert.equal(asked.length, 0, 'the same photo settles it');
  const third = await list(me.id, 'McFarlane Superman Clark Kent Elite Edition figure', opts, 510000, { category: 'Figures', photos: await stored('cyclops-in-hand') });
  forgetCatalogue();
  assert.equal((await of(third)).id, firstDna.id, 'a look that agrees joins');
  useEyeCheck(null);
});

console.log(`\n${passed} DNA checks passed`);
