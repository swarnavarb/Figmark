/**
 * Spread the word: a shop pays store credit for new buyers people bring from
 * outside Figmark, for a set time.
 *
 * Posting one (on its own, or before / during / after a live drop), taking
 * part, a new account made through somebody's link counting for them, and the
 * payout when the timer runs out - capped per person, a bonus for the most,
 * and nothing for an account that never verified a phone.
 *
 * Calls the compiled handlers directly against the in-memory store, the way
 * smoke-share does. Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';
import { useFixtures } from './fixtures.mjs';

const fns = new URL('../api/dist/api/src/functions/', import.meta.url);
const { loginRoute: login, signupRoute: rawSignup } = await import(new URL('auth-routes.js', fns));
const { verifiedSignup } = await import('./verified-signup.mjs');
const signup = verifiedSignup(rawSignup);
const { myInviteRoute: myInvite, openInviteRoute: openInvite } = await import(new URL('share-routes.js', fns));
const {
  createPostRoute: createPost, joinSpreadRoute: joinSpread, shopSpreadRoute: shopSpread, readPostRoute: readPost,
} = await import(new URL('social-routes.js', fns));
await useFixtures();
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
const { settleDueGames } = await import(new URL('../api/dist/api/src/play.js', import.meta.url));

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
const newPerson = async (name, headers = {}, verified = true) => {
  seq += 1;
  const made = await (verified ? signup : rawSignup)(req({
    headers,
    body: { acceptTerms: true, displayName: name, email: `spread${seq}@figmark.example`, phone: `+91900007${String(1000 + seq).slice(-4)}`, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, headers: { authorization: `Bearer ${made.jsonBody.token}` } };
};

const session = await login(req({ body: { identifier: 'demo@figmark.in', password: 'figmark123' } }), ctx);
const shop = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };
const repository = await getRepository();
const owner = await repository.getUserById(shop.id);
const handle = owner.sellerProfile.username;

const drive = (referral, body = 'Bring a friend - credit for every new buyer') =>
  createPost(req({ headers: shop.headers, body: { body, storeId: shop.id, referral } }), ctx);

console.log('spread the word');

let post;
await check('a shop starts one: credit per new buyer, a cap, a bonus and a timer', async () => {
  const made = await drive({ rewardMinor: 10000, maxPerPerson: 2, topPrizeMinor: 5000, timing: 'now', hours: 24, target: { kind: 'shop' } });
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  post = made.jsonBody.post;
  const stored = await repository.getPost(post.channelId, post.id);
  assert.equal(stored.referral.rewardMinor, 10000);
  assert.equal(stored.hostShopId, shop.id, 'followers hear it started, like any game');
  const hours = (Date.parse(stored.referral.endsAt) - Date.parse(stored.referral.startsAt)) / 3_600_000;
  assert.ok(Math.abs(hours - 24) < 0.01);
});

await check('a person cannot run one, and nonsense amounts are refused', async () => {
  const person = await newPerson('Not A Shop');
  const asPerson = await createPost(req({ headers: person.headers, body: { body: 'Bring friends', referral: { rewardMinor: 100, maxPerPerson: 1, timing: 'now', hours: 24, target: { kind: 'shop' } } } }), ctx);
  assert.equal(asPerson.status, 403);
  assert.equal((await drive({ rewardMinor: 0, maxPerPerson: 1, timing: 'now', hours: 24, target: { kind: 'shop' } })).status, 400);
  assert.equal((await drive({ rewardMinor: 100, maxPerPerson: 999, timing: 'now', hours: 24, target: { kind: 'shop' } })).status, 400);
  assert.equal((await drive({ rewardMinor: 100, maxPerPerson: 1, timing: 'before', target: { kind: 'shop' } })).status, 400,
    'before and during belong to a drop');
});

await check('tied to a live drop: before ends as the first item goes out, during runs to the last window', async () => {
  const at = Date.now();
  const sale = await repository.savePowerSale({
    id: 'pws_spreadtest', sellerId: shop.id, name: 'Saturday drop', status: 'scheduled',
    openingBody: 'We start soon', openingAt: new Date(at + 2 * 3_600_000).toISOString(), leadMinutes: 0, everyMinutes: 10, windowMinutes: 30,
    closingBody: '', items: [{ id: 'i1', title: 'One', description: '', category: 'figures', condition: 'MISB', priceMinor: 100000, listPriceMinor: 120000, quantity: 1 }],
    openedAt: null, closedAt: null, createdAt: new Date(at).toISOString(), updatedAt: new Date(at).toISOString(),
  });
  const before = await drive({ rewardMinor: 5000, maxPerPerson: 3, timing: 'before', target: { kind: 'drop', saleId: sale.id } });
  assert.equal(before.status, 201, JSON.stringify(before.jsonBody));
  const b = (await repository.getPost(before.jsonBody.post.channelId, before.jsonBody.post.id)).referral;
  assert.equal(b.endsAt, sale.openingAt);
  assert.deepEqual(b.target, { kind: 'drop', saleId: sale.id, name: 'Saturday drop' });
  const during = await drive({ rewardMinor: 5000, maxPerPerson: 3, timing: 'during', target: { kind: 'drop', saleId: sale.id } });
  assert.equal(during.status, 201, JSON.stringify(during.jsonBody));
  const d = (await repository.getPost(during.jsonBody.post.channelId, during.jsonBody.post.id)).referral;
  assert.equal(d.startsAt, sale.openingAt);
  assert.equal(Date.parse(d.endsAt), Date.parse(sale.openingAt) + 30 * 60_000);
  const after = await drive({ rewardMinor: 5000, maxPerPerson: 3, timing: 'after', hours: 24, target: { kind: 'drop', saleId: sale.id } });
  assert.equal(after.status, 201, JSON.stringify(after.jsonBody));
  const a = (await repository.getPost(after.jsonBody.post.channelId, after.jsonBody.post.id)).referral;
  assert.equal(a.startsAt, d.endsAt, 'after starts when the drop ends');
  // Tidy: these three would otherwise be the shop's running drive below.
  for (const made of [before, during, after]) await repository.deletePost(made.jsonBody.post.channelId, made.jsonBody.post.id);
});

let sharer;
let code;
await check('somebody takes part and gets their link; the shop cannot win its own credit', async () => {
  sharer = await newPerson('Sharer Sana');
  const joined = await joinSpread(req({ headers: sharer.headers, params: { channel: post.channelId, id: post.id } }), ctx);
  assert.equal(joined.status, 200, JSON.stringify(joined.jsonBody));
  assert.equal(joined.jsonBody.card.social.referral.mine.in, true);
  assert.equal(joined.jsonBody.card.post.referral, null, 'who joined through whom is never sent whole');
  const own = await joinSpread(req({ headers: shop.headers, params: { channel: post.channelId, id: post.id } }), ctx);
  assert.equal(own.status, 403);
  code = (await myInvite(req({ headers: sharer.headers }), ctx)).jsonBody.code;
  const running = (await shopSpread(req({ params: { id: shop.id } }), ctx)).jsonBody.drive;
  assert.equal(running.postId, post.id, 'the shop page knows it is running one');
});

const viaLink = async (name, verified = true) => {
  const opened = await openInvite(req({
    headers: { 'user-agent': BROWSER }, params: { code }, query: { t: 'shop', id: handle, d: `${post.channelId}/${post.id}` },
  }), ctx);
  assert.equal(opened.status, 200);
  const cookies = cookiesOf(opened);
  assert.ok(cookies[0]?.includes(encodeURIComponent(`/${post.id}`)), 'the invite cookie carries the drive');
  return newPerson(name, { cookie: cookieHeader(cookies) }, verified);
};

await check('a brand-new account through the link counts for the sharer', async () => {
  const friend = await viaLink('Friend One');
  const stored = (await repository.getPost(post.channelId, post.id)).referral;
  assert.deepEqual(stored.joins.map((join) => [join.userId, join.sharerId]), [[friend.id, sharer.id]]);
  assert.deepEqual((await repository.getUserById(friend.id)).invitedBy.drive, { channelId: post.channelId, postId: post.id });
  const card = (await readPost(req({ headers: sharer.headers, params: { channel: post.channelId, id: post.id } }), ctx)).jsonBody;
  const view = (card.card ?? card).social.referral;
  assert.equal(view.mine.joins, 1);
  assert.equal(view.leaders[0].joins, 1);
});

await check('when the timer runs out: paid per verified person up to the cap, plus the bonus', async () => {
  await viaLink('Friend Two');
  await viaLink('Friend Three');
  await viaLink('Quiet Quinn', false);
  // A second sharer who brings one person.
  const other = await newPerson('Other Omar');
  const otherCode = (await myInvite(req({ headers: other.headers }), ctx)).jsonBody.code;
  const opened = await openInvite(req({ headers: { 'user-agent': BROWSER }, params: { code: otherCode }, query: { d: `${post.channelId}/${post.id}` } }), ctx);
  await newPerson('Omar Friend', { cookie: cookieHeader(cookiesOf(opened)) });
  assert.equal((await repository.getPost(post.channelId, post.id)).referral.joins.length, 5);

  await repository.mutatePost(post.channelId, post.id, (current) => ({
    ...current, referral: { ...current.referral, endsAt: new Date(Date.now() - 1000).toISOString() },
  }));
  assert.ok(await settleDueGames(repository) >= 1);
  const settled = (await repository.getPost(post.channelId, post.id)).referral;
  assert.ok(settled.settledAt);
  const sana = settled.payouts.find((row) => row.userId === sharer.id);
  assert.equal(sana.joins, 2, 'three verified, capped at two');
  assert.equal(sana.top, true);
  assert.equal(sana.amountMinor, 2 * 10000 + 5000);
  const omar = settled.payouts.find((row) => row.userId === other.id);
  assert.equal(omar.amountMinor, 10000);
  const credit = (await repository.getUserById(sharer.id)).storeCredits.find((entry) => entry.id === `ref_${post.id}_${sharer.id}`);
  assert.equal(credit.amountMinor, 25000);
  assert.equal(credit.storeId, shop.id);
  // Settling again pays nobody twice.
  await settleDueGames(repository);
  assert.equal((await repository.getUserById(sharer.id)).storeCredits.filter((entry) => entry.id.startsWith('ref_')).length, 1);
  assert.equal((await shopSpread(req({ params: { id: shop.id } }), ctx)).jsonBody.drive, null);
});

await check('an ended drive takes nobody new', async () => {
  const late = await newPerson('Late Larry');
  const joined = await joinSpread(req({ headers: late.headers, params: { channel: post.channelId, id: post.id } }), ctx);
  assert.equal(joined.status, 409);
});

console.log(`\n${passed} spread checks passed`);
