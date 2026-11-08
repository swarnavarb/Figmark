/**
 * Load the demo world from test-fixtures/ into a development Cosmos database.
 *
 * The local server shows the fixtures from memory (`npm run serve --
 * --fixtures`); a deployed development site has only its database. This
 * writes the same shops, buyers, listings (in demand, ending soon, pre-orders,
 * drops, lots), orders and their payments, reviews, disputes, posts and wants
 * there, through the API's own repository so each record lands in the shape
 * the API reads.
 *
 *   npm run build:api && npm run build:fixtures
 *   COSMOS_ENDPOINT=https://cosmos-figmark-dev... COSMOS_KEY=... node scripts/seed-demo.mjs
 *
 * Development only: it refuses an endpoint that does not name a development
 * account. Safe to run twice - anything already there is left alone. Every
 * record it writes carries `seed: "figmark-demo"`, and the ids it wrote are
 * listed in seed-demo-manifest.json beside where it was run, so the demo can
 * be found and cleared again. The demo accounts sign in with the fixtures'
 * published password: never point this at a database real people use.
 */
import { writeFileSync } from 'node:fs';

const endpoint = process.env.COSMOS_ENDPOINT ?? '';
if (!/dev/i.test(endpoint) || /prod/i.test(endpoint)) {
  console.error(`Refusing: ${endpoint || 'no COSMOS_ENDPOINT'} is not a development database.`);
  process.exit(1);
}

const { fixtureRepository } = await import('./fixtures.mjs');
const api = new URL('../api/dist/api/src/', import.meta.url);
const { getRepository } = await import(new URL('data/index.js', api));

const repository = await getRepository();
const status = repository.status();
if (repository.backend !== 'cosmos' || !status.connected) {
  console.error(`Not connected to Cosmos DB (${status.detail}).`);
  process.exit(1);
}

// The fixtures as the local server sees them, sample routes included.
const memory = await fixtureRepository();
await memory.init();
const all = (name) => [...memory[name].values()];

const SEED = 'figmark-demo';
const manifest = [];
const tally = {};
const mark = (record) => ({ ...record, seed: SEED });

async function put(kind, id, write) {
  tally[kind] ??= { written: 0, kept: 0, failed: 0 };
  try {
    await write();
    tally[kind].written += 1;
    manifest.push({ kind, id });
  } catch (error) {
    const code = error?.code ?? error?.statusCode;
    if (code === 409 || /already/i.test(String(error?.message))) tally[kind].kept += 1;
    else {
      tally[kind].failed += 1;
      console.error(`  ${kind} ${id}: ${error?.message ?? error}`);
    }
  }
}

console.log(`Seeding ${endpoint}`);

for (const user of all('users')) {
  await put('users', user.id, async () => {
    if (await repository.getUserById(user.id)) throw Object.assign(new Error('already'), { code: 409 });
    await repository.createUser(mark(user));
    // Through updateUser as well, so the parts that live off the row are split out.
    await repository.updateUser(mark(user));
    if (user.username) await repository.reserveHandle(user.username, user.id, false);
    if (user.sellerProfile?.username) await repository.reserveHandle(user.sellerProfile.username, user.id, true);
  });
}
for (const route of all('routes')) await put('routes', route.id, () => repository.saveRoute(mark(route)));
for (const lot of all('lots')) await put('lots', lot.id, () => repository.createLot(mark(lot)));
for (const listing of all('listings')) await put('listings', listing.id, () => repository.createListing(mark(listing)));
for (const order of all('orders')) await put('orders', order.id, () => repository.createOrder(mark(order)));
for (const sale of all('powerSales')) await put('powerSales', sale.id, () => repository.savePowerSale(mark(sale)));
for (const forum of all('forums')) await put('forums', forum.id, () => repository.createForum(mark(forum)));
for (const post of all('posts')) await put('posts', post.id, () => repository.createPost(mark(post)));
for (const comment of all('comments')) await put('comments', comment.id, () => repository.addComment(mark(comment)));
for (const review of all('reviews')) await put('reviews', review.id, () => repository.createReview(mark(review)));
for (const dispute of all('disputes')) await put('disputes', dispute.id, () => repository.createDispute(mark(dispute)));
for (const want of all('wants')) await put('wants', want.id, () => repository.saveWant(mark(want)));
for (const offer of all('wantOffers')) await put('wantOffers', offer.id, () => repository.saveWantOffer(mark(offer)));
for (const pledge of all('pledges')) await put('pledges', pledge.id, () => repository.savePledge(mark(pledge)));

// Saves and follows toggle, so only the ones not already on are flipped.
const liked = new Map();
for (const like of all('likes')) {
  await put('likes', `${like.userId}:${like.listingId}`, async () => {
    if (!liked.has(like.userId)) liked.set(like.userId, new Set(await repository.listLikedListingIds(like.userId)));
    if (liked.get(like.userId).has(like.listingId)) throw Object.assign(new Error('already'), { code: 409 });
    await repository.toggleLike(like.userId, like.listingId);
  });
}
const followed = new Map();
for (const follow of all('follows')) {
  await put('follows', `${follow.followerId}:${follow.sellerId}`, async () => {
    if (!followed.has(follow.followerId)) followed.set(follow.followerId, new Set(await repository.listFollowedSellerIds(follow.followerId)));
    if (followed.get(follow.followerId).has(follow.sellerId)) throw Object.assign(new Error('already'), { code: 409 });
    await repository.toggleFollow(follow.followerId, follow.sellerId);
  });
}

writeFileSync('seed-demo-manifest.json', `${JSON.stringify({ seed: SEED, endpoint, at: new Date().toISOString(), written: manifest }, null, 2)}\n`);
console.table(tally);
const failed = Object.values(tally).reduce((sum, row) => sum + row.failed, 0);
process.exit(failed ? 1 : 0);
