/**
 * Sharing out of the app: opens, sends, invites, a shop's growth quests and
 * the link previews WhatsApp and the rest read.
 *
 * Calls the compiled handlers directly, the way smoke-api does, against the
 * in-memory store. Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The app's index.html, as the preview route reads it - from disk, the way the dev server serves it.
const shellDir = mkdtempSync(join(tmpdir(), 'figmark-og-'));
process.env.FIGMARK_SHELL_FILE = join(shellDir, 'index.html');
writeFileSync(process.env.FIGMARK_SHELL_FILE, '<!doctype html><html><head><meta charset="UTF-8" /><title>Figmark</title><meta property="og:title" content="old" /></head><body><div id="root"></div><script type="module" src="/assets/main.js"></script></body></html>');

const fns = new URL('../api/dist/api/src/functions/', import.meta.url);
const shared = new URL('../api/dist/shared/', import.meta.url);
const { loginRoute: login, signupRoute: signup } = await import(new URL('auth-routes.js', fns));
const {
  createListingRoute: createListing, affiliateLinkRoute: affiliateLink, openShortLinkRoute: openShortLink,
  createOrderRoute: createOrder, editListingRoute: editListing,
} = await import(new URL('catalog-routes.js', fns));
const {
  logShareRoute: logShare, myInviteRoute: myInvite, openInviteRoute: openInvite,
  growthRoute: growth, growthClaimRoute: claimGrowth, spotlightRoute: spotlight,
} = await import(new URL('share-routes.js', fns));
const { ogRoute: og, ogCardRoute: ogCard, injectMeta } = await import(new URL('og-routes.js', fns));
const { questMeRoute: questMe, questClaimRoute: questClaim } = await import(new URL('quest-routes.js', fns));
const { questView, emptyQuestState } = await import(new URL('quest.js', shared));
const { growthView, claimGrowth: claimRule } = await import(new URL('store-growth.js', shared));
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const BROWSER = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128 Mobile Safari/537.36';
const req = ({ headers = {}, body, query = {}, params = {} } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});
const cookiesOf = (response) => [...(response.headers?.entries?.() ?? [])]
  .filter(([name]) => name.toLowerCase() === 'set-cookie').map(([, value]) => value);
const cookieHeader = (lines) => lines.map((line) => line.split(';')[0]).join('; ');

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

let seq = 0;
const newPerson = async (name, headers = {}) => {
  seq += 1;
  const made = await signup(req({
    headers,
    body: { displayName: name, email: `share${seq}@figmark.example`, phone: `+91900006${String(1000 + seq).slice(-4)}`, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, headers: { authorization: `Bearer ${made.jsonBody.token}` } };
};

const session = await login(req({ body: { identifier: 'demo@figmark.in', password: 'figmark123' } }), ctx);
const shop = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };
const repository = await getRepository();

/* ── The quest rules ───────────────────────────────────────────────────── */
console.log('quest rules');

const facts = (over = {}) => ({
  orders: [], reviewsWritten: [], ratingsReceived: [], pageRatings: [], likes: [], follows: [], posts: [], wants: [],
  pledges: 0, disputesLost: 0, collection: [], hasBio: false, hasTags: false, shares: 0, referredSales: 0,
  shareOpens: [], sharesSent: [], invites: [], invitedSellers: 0, ...over,
});

await check('sharing is a quest every day, opens every week and a friend every month', async () => {
  const view = questView('u1', facts(), emptyQuestState());
  const ids = view.tasks.map((task) => task.id);
  assert.ok(ids.includes('daily-share1'));
  assert.ok(ids.includes('weekly-opens2'));
  assert.ok(ids.includes('monthly-invite1'));
});

await check('making a link earns nothing; somebody opening it does', async () => {
  const linksOnly = questView('u1', facts({ shares: 12 }), emptyQuestState());
  assert.equal(linksOnly.tasks.find((task) => task.id === 'ms-shares-1').progress, 0, 'a link nobody opened is not a share');
  assert.equal(linksOnly.xp, 0);
  const now = new Date().toISOString();
  const opened = questView('u1', facts({ shareOpens: [{ createdAt: now }, { createdAt: now }] }), emptyQuestState());
  assert.equal(opened.tasks.find((task) => task.id === 'weekly-opens2').claimable, true);
  assert.ok(opened.breakdown.some((line) => line.label === 'People who opened your links' && line.xp > 0));
});

await check('a seller you brought in is worth five friends', async () => {
  const view = questView('u1', facts({ invitedSellers: 1 }), emptyQuestState());
  assert.equal(view.breakdown.find((line) => line.label === 'Shops you brought in').xp, 100);
  assert.equal(view.tasks.find((task) => task.id.startsWith('ms-scouts-')).claimable, true);
});

/* ── Opens ─────────────────────────────────────────────────────────────── */
console.log('\nopens');

const listing = (await createListing(req({
  headers: shop.headers,
  body: { title: 'Shared Figure', priceMinor: 30_000, quantityAvailable: 5, affiliateMinor: 3_000, category: 'Figures', tags: ['figure'] },
}), ctx)).jsonBody.listing;
const sharer = await newPerson('Sharer Sam');
const { code: refCode } = (await affiliateLink(req({ headers: sharer.headers, params: { id: listing.id }, body: {} }), ctx)).jsonBody;

await check('a friend opening a shared link counts once, however often they tap it', async () => {
  const first = await openShortLink(req({ headers: { 'user-agent': BROWSER }, params: { code: refCode } }), ctx);
  assert.equal(first.status, 200);
  const visitor = cookiesOf(first).find((line) => line.startsWith('fm_vid='));
  assert.ok(visitor, 'a guest gets a visitor cookie so a second tap is recognised');
  await openShortLink(req({ headers: { 'user-agent': BROWSER, cookie: cookieHeader(cookiesOf(first)) }, params: { code: refCode } }), ctx);
  assert.equal((await repository.getUserById(sharer.id)).shareOpens.length, 1);
});

await check('preview bots and the sharer themselves are not opens', async () => {
  await openShortLink(req({ headers: { 'user-agent': 'WhatsApp/2.23.20.0 A' }, params: { code: refCode } }), ctx);
  await openShortLink(req({ headers: { 'user-agent': 'facebookexternalhit/1.1' }, params: { code: refCode } }), ctx);
  await openShortLink(req({ headers: { ...sharer.headers, 'user-agent': BROWSER }, params: { code: refCode } }), ctx);
  assert.equal((await repository.getUserById(sharer.id)).shareOpens.length, 1);
});

await check('the shop hears of a visit through anybody\'s link to its items', async () => {
  const owner = await repository.getUserById(shop.id);
  assert.equal(owner.sellerProfile.growth.opens.length, 1);
});

await check('a signed-in friend is one visitor across browsers', async () => {
  const friend = await newPerson('Friend Fran');
  await openShortLink(req({ headers: { ...friend.headers, 'user-agent': BROWSER }, params: { code: refCode } }), ctx);
  await openShortLink(req({ headers: { ...friend.headers, 'user-agent': 'Mozilla/5.0 (iPhone)' }, params: { code: refCode } }), ctx);
  assert.equal((await repository.getUserById(sharer.id)).shareOpens.length, 2);
});

/* ── Sends ─────────────────────────────────────────────────────────────── */
console.log('\nsends');

await check('a send pays the daily quest, and only a known kind and channel is accepted', async () => {
  const bad = await logShare(req({ headers: sharer.headers, body: { kind: 'spam', via: 'whatsapp' } }), ctx);
  assert.equal(bad.status, 400);
  const ok = await logShare(req({ headers: sharer.headers, body: { kind: 'booked', via: 'whatsapp', target: listing.id } }), ctx);
  assert.equal(ok.status, 200);
  const view = (await questMe(req({ headers: sharer.headers }), ctx)).jsonBody.view;
  const daily = view.tasks.find((task) => task.id === 'daily-share1');
  assert.equal(daily.claimable, true);
  const claimed = await questClaim(req({ headers: sharer.headers, body: { taskId: 'daily-share1' } }), ctx);
  assert.equal(claimed.status, 200);
  assert.ok(claimed.jsonBody.gained > 0);
});

await check('a send for a shop counts for its growth only when the sender helps run it', async () => {
  await logShare(req({ headers: sharer.headers, body: { kind: 'shop', via: 'native', storeId: shop.id } }), ctx);
  assert.equal((await repository.getUserById(shop.id)).sellerProfile.growth.shares?.length ?? 0, 0);
  await logShare(req({ headers: shop.headers, body: { kind: 'shop', via: 'native', storeId: shop.id } }), ctx);
  assert.equal((await repository.getUserById(shop.id)).sellerProfile.growth.shares.length, 1);
});

/* ── Invites ───────────────────────────────────────────────────────────── */
console.log('\ninvites');

await check('an invite opened signed out files the new account under whoever sent it', async () => {
  const mine = (await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody;
  assert.match(mine.path, /^\/i\/[A-Za-z0-9]{6}$/);
  assert.equal((await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody.code, mine.code, 'the same code every time');

  const opened = await openInvite(req({ headers: { 'user-agent': BROWSER }, params: { code: mine.code }, query: { as: 'seller' } }), ctx);
  assert.equal(opened.status, 200);
  assert.equal(opened.jsonBody.inviter.name, 'Sharer Sam');
  assert.equal(opened.jsonBody.asSeller, true);
  const cookies = cookiesOf(opened);
  assert.ok(cookies.some((line) => line.startsWith('fm_inv=')));

  const joined = await newPerson('Invited Ivy', { cookie: cookieHeader(cookies) });
  const account = await repository.getUserById(joined.id);
  assert.equal(account.invitedBy.userId, sharer.id);
  assert.equal(account.invitedBy.asSeller, true);
  const after = (await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody;
  assert.equal(after.joined, 1);
  assert.equal(after.recent[0].name, 'Invited Ivy');
});

await check('an existing member signing in on a friend\'s invite is not counted as brought in', async () => {
  const { code } = (await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody;
  const cookies = cookiesOf(await openInvite(req({ headers: { 'user-agent': BROWSER }, params: { code } }), ctx));
  const back = await login(req({ headers: { cookie: cookieHeader(cookies) }, body: { identifier: 'demo@figmark.in', password: 'figmark123' } }), ctx);
  assert.equal(back.status, 200);
  assert.equal((await repository.getUserById(shop.id)).invitedBy ?? null, null);
});

await check('an invite that was never issued leads nowhere', async () => {
  assert.equal((await openInvite(req({ params: { code: 'zzzzzz' } }), ctx)).status, 404);
});

/* ── A shop's growth quests ────────────────────────────────────────────── */
console.log('\ngrowth quests');

await check('growth quests count only what the server saw, and pay once per period', async () => {
  const now = new Date().toISOString();
  const facts = { shares: [{ at: now }, { at: now }], opens: [], posts: [], affiliateItems: 0, affiliateSales: [], bestFill: 0 };
  const view = growthView(facts, undefined);
  assert.equal(view.tasks.find((task) => task.id === 'weekly-share2').claimable, true);
  assert.equal(view.tasks.find((task) => task.id === 'weekly-visits5').claimable, false);
  const first = claimRule(facts, undefined, 'weekly-share2');
  assert.equal(first.state.spotlights, 1);
  assert.ok('refusal' in claimRule(facts, first.state, 'weekly-share2'), 'twice in one week is refused');
  assert.ok('refusal' in claimRule(facts, undefined, 'weekly-visits5'), 'unfinished is refused');
});

await check('only the people running a shop see its growth quests', async () => {
  assert.equal((await growth(req({ headers: sharer.headers, params: { ownerId: shop.id } }), ctx)).status, 403);
  const mine = await growth(req({ headers: shop.headers, params: { ownerId: shop.id } }), ctx);
  assert.equal(mine.status, 200);
  assert.ok(mine.jsonBody.view.tasks.some((task) => task.id === 'weekly-affiliate3'));
});

await check('a finished quest pays a Spotlight, and a Spotlight puts an item back on top', async () => {
  // A second send this week finishes "Share your shop twice".
  await logShare(req({ headers: shop.headers, body: { kind: 'item', via: 'whatsapp', target: listing.id, storeId: shop.id } }), ctx);
  const none = await spotlight(req({ headers: shop.headers, params: { id: listing.id }, body: {} }), ctx);
  assert.equal(none.status, 409, 'no Spotlights yet');

  const claimed = await claimGrowth(req({ headers: shop.headers, params: { ownerId: shop.id }, body: { taskId: 'weekly-share2' } }), ctx);
  assert.equal(claimed.status, 200, JSON.stringify(claimed.jsonBody));
  assert.equal(claimed.jsonBody.view.spotlights, 1);
  const again = await claimGrowth(req({ headers: shop.headers, params: { ownerId: shop.id }, body: { taskId: 'weekly-share2' } }), ctx);
  assert.equal(again.status, 409);

  const stranger = await spotlight(req({ headers: sharer.headers, params: { id: listing.id }, body: {} }), ctx);
  assert.equal(stranger.status, 403);
  const lit = await spotlight(req({ headers: shop.headers, params: { id: listing.id }, body: {} }), ctx);
  assert.equal(lit.status, 200);
  assert.equal(lit.jsonBody.spotlights, 0);
  assert.equal((await repository.getListing(listing.id)).bumpedAt, lit.jsonBody.bumpedAt);
});

/* ── Link previews ─────────────────────────────────────────────────────── */
console.log('\nlink previews');

const shell = '<!doctype html><html><head><meta charset="UTF-8" /><title>Figmark</title><meta name="description" content="old" /><meta property="og:title" content="old" /></head><body><div id="root"></div></body></html>';
const preview = async (path) => {
  const response = await og(req({ headers: { 'x-ms-original-url': `https://figmark.example${path}` } }), ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers['Content-Type'], /text\/html/);
  return response.body;
};
const tag = (html, property) => html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`))?.[1]?.replace(/&amp;/g, '&') ?? null;
const cardAt = async (image) => {
  const url = new URL(image);
  const [, , , , kind, name] = url.pathname.split('/');
  const response = await ogCard(req({ query: Object.fromEntries(url.searchParams), params: { kind, name } }), ctx);
  assert.equal(response.status, 200, `card for ${image}`);
  assert.equal(response.headers['Content-Type'], 'image/jpeg');
  assert.ok(response.body[0] === 0xff && response.body[1] === 0xd8, 'a real JPEG');
  assert.ok(response.body.byteLength < 300_000, `small enough for a chat preview: ${response.body.byteLength}`);
  return response.body;
};

await check('the app\'s own page gets the link\'s tags in place of its defaults', async () => {
  const html = injectMeta(shell, { title: 'A & "B"', description: 'd', image: 'https://x/y.jpg', large: true, fallback: '/' }, 'https://x/r/abc');
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
  assert.ok(html.includes('<title>A &amp; &quot;B&quot;</title>'), 'escaped');
  assert.ok(!html.includes('content="old"'), 'the defaults are gone');
  assert.ok(html.includes('<div id="root"></div>'), 'and the app still boots');
});

await check('an affiliate link unfolds into the item, its price and who shared it - inside the app itself', async () => {
  const html = await preview(`/r/${refCode}?m=booked`);
  assert.equal(tag(html, 'og:title'), 'Sharer booked a spot: Shared Figure');
  assert.match(tag(html, 'og:description'), /₹300/);
  assert.match(tag(html, 'og:image'), /^https:\/\/figmark\.example\//, 'an absolute image');
  assert.ok(html.includes('<script type="module" src="/assets/main.js">'), 'a person gets the app, at the same address');
  assert.ok(!html.includes('content="old"'));
});

await check('without the app shell, a person is still sent on to the item', async () => {
  const saved = process.env.FIGMARK_SHELL_FILE;
  process.env.FIGMARK_SHELL_FILE = join(shellDir, 'missing.html');
  try {
    const html = await preview(`/r/${refCode}`);
    assert.ok(html.includes(`url=/listing/${listing.id}`));
    assert.equal(tag(html, 'og:title'), 'Shared Figure · ₹300');
  } finally {
    process.env.FIGMARK_SHELL_FILE = saved;
  }
});

await check('an invite and a seller invite unfold into their own cards', async () => {
  const { code } = (await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody;
  assert.equal(tag(await preview(`/i/${code}`), 'og:title'), 'Sharer Sam invited you to Figmark');
  const seller = await preview(`/i/${code}?as=seller`);
  assert.equal(tag(seller, 'og:title'), 'Sharer Sam invited you to sell on Figmark');
  assert.match(tag(seller, 'og:image'), new RegExp(`^https://figmark\\.example/api/og/card/i/${code}\\.jpg\\?v=\\w+&as=seller$`));
  await cardAt(tag(seller, 'og:image'));
  await cardAt(tag(await preview(`/i/${code}`), 'og:image'));
});

await check('a moment link names it, and an unknown link still gets the brand card', async () => {
  const { code } = (await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody;
  assert.equal(tag(await preview(`/s/l/${listing.id}?m=delivered&i=${code}`), 'og:title'), 'Sharer\'s Shared Figure just arrived');
  assert.equal(tag(await preview(`/s/l/${listing.id}?m=delivered`), 'og:title'), 'Shared Figure · ₹300', 'nobody to name, so the item speaks');
  assert.equal(tag(await preview('/s/l/nope'), 'og:image'), 'https://figmark.example/og/figmark.jpg');
});

/* ── A discount through a link ─────────────────────────────────────────── */
console.log('\nlink discount');

const deal = (await createListing(req({
  headers: shop.headers,
  body: { title: 'Deal Figure', priceMinor: 30_000, quantityAvailable: 5, affiliateMinor: 3_000, affiliateOffMinor: 5_000, category: 'Figures', tags: ['figure'] },
}), ctx)).jsonBody.listing;
const { code: dealCode } = (await affiliateLink(req({ headers: sharer.headers, params: { id: deal.id }, body: {} }), ctx)).jsonBody;

await check('a shop can give buyers money off through a link, never more than leaves it a rupee', async () => {
  assert.deepEqual(deal.affiliate, { amountMinor: 3_000, buyerOffMinor: 5_000 });
  const greedy = (await createListing(req({
    headers: shop.headers,
    body: { title: 'Greedy', priceMinor: 30_000, quantityAvailable: 1, affiliateMinor: 3_000, affiliateOffMinor: 29_000, category: 'Figures', tags: [] },
  }), ctx)).jsonBody.listing;
  assert.equal(greedy.affiliate.buyerOffMinor, 30_000 - 3_000 - 100);
  const plain = (await createListing(req({
    headers: shop.headers,
    body: { title: 'No commission', priceMinor: 30_000, quantityAvailable: 1, affiliateMinor: null, affiliateOffMinor: 5_000, category: 'Figures', tags: [] },
  }), ctx)).jsonBody.listing;
  assert.equal(plain.affiliate ?? null, null, 'no commission, no link, no link discount');
  const edited = (await editListing(req({ headers: shop.headers, params: { id: greedy.id }, body: { affiliateOffMinor: null } }), ctx)).jsonBody.listing;
  assert.deepEqual(edited.affiliate, { amountMinor: 3_000 }, 'turning the discount off keeps the commission');
});

await check('the link preview leads with the discount', async () => {
  const html = await preview(`/r/${dealCode}`);
  assert.equal(tag(html, 'og:title'), 'Get ₹50 off · Deal Figure · ₹300');
  assert.match(tag(html, 'og:description'), /₹50 off with Sharer's link: ₹250 instead of ₹300/);
  assert.match(tag(html, 'og:description'), /Level \d+/, 'the shop and its level');
  assert.equal(tag(await preview(`/s/l/${deal.id}`), 'og:title'), 'Deal Figure · ₹300', 'a plain link takes nothing off');
});


await check('an item with no photo gets its own drawn picture, not the Figmark banner', async () => {
  const plain = tag(await preview(`/s/l/${deal.id}`), 'og:image');
  assert.match(plain, new RegExp(`^https://figmark\\.example/api/og/card/l/${deal.id}\\.jpg\\?v=`));
  const viaLink = tag(await preview(`/r/${dealCode}`), 'og:image');
  assert.match(viaLink, new RegExp(`&r=${dealCode}$`), 'the link\'s picture carries its discount');
  assert.notEqual(Buffer.compare(await cardAt(plain), await cardAt(viaLink)), 0, 'and draws it');
  const forged = await ogCard(req({ query: { r: 'nope1234' }, params: { kind: 'l', name: `${deal.id}.jpg` } }), ctx);
  assert.equal(forged.status, 200, 'a made-up code just draws the plain card');
  assert.equal((await ogCard(req({ params: { kind: 'l', name: 'nope.jpg' } }), ctx)).status, 404);
});

await check('a shop and a person without a photo get drawn pictures too', async () => {
  const owner = await repository.getUserById(shop.id);
  const shopImage = tag(await preview(`/s/p/${owner.sellerProfile.username}`), 'og:image');
  assert.match(shopImage, /\/api\/og\/card\/p\//);
  await cardAt(shopImage);
  const person = await repository.getUserById(sharer.id);
  if (person.username) await cardAt(tag(await preview(`/s/p/${person.username}`), 'og:image'));
});

await check('a buyer through the link pays less; anybody else pays the price', async () => {
  const friend = await newPerson('Deal Friend');
  await openShortLink(req({ headers: { ...friend.headers, 'user-agent': BROWSER }, params: { code: dealCode } }), ctx);
  const viaLink = await createOrder(req({ headers: friend.headers, body: { listingId: deal.id } }), ctx);
  assert.equal(viaLink.status, 201, JSON.stringify(viaLink.jsonBody));
  assert.equal(viaLink.jsonBody.order.unitPriceMinor, 25_000);
  assert.equal(viaLink.jsonBody.order.affiliate.buyerOffMinor, 5_000);
  assert.equal(viaLink.jsonBody.order.affiliate.amountMinor, 3_000, 'the sharer still earns the full commission');
  const again = await createOrder(req({ headers: friend.headers, body: { listingId: deal.id, quantity: 2 } }), ctx);
  assert.equal(again.jsonBody.order.unitPriceMinor, 25_000, 'going back to the checkout does not take it off twice');
  const stranger = await newPerson('No Link');
  const full = await createOrder(req({ headers: stranger.headers, body: { listingId: deal.id } }), ctx);
  assert.equal(full.jsonBody.order.unitPriceMinor, 30_000);
});

console.log(`\n${passed} checks passed`);
