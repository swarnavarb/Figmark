/**
 * Smoke test for the shop coach: the tips, the best time to post, the weekly
 * plan, the offline answers and the AI brief, then `GET /api/me/coach`
 * against the fixture world.
 *
 * Run `npm run build:api && npm run build:fixtures` first.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';

process.env.FIGMARK_RATE_LIMITS = 'off';
await useFixtures();

const dist = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', dist);
const { loginRoute: login, signupRoute: rawSignup } = await import(new URL('auth-routes.js', fns));
const { verifiedSignup } = await import('./verified-signup.mjs');
const signup = verifiedSignup(rawSignup);
const { coachRoute } = await import(new URL('coach-routes.js', fns));
const coach = await import(new URL('shared/coach.js', dist));

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
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
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const item = (over = {}) => ({
  id: 'l1', title: 'Hot Toys Iron Man', priceMinor: 2_499_00, currency: 'INR', photo: null,
  views30: 0, saves: 0, sold30: 0, ageDays: 10, expiresAt: null, quantityAvailable: 5, fill: null, ...over,
});
/** A tidy shop with nothing wrong, to change one thing at a time. */
const healthy = (over = {}) => ({
  now: '2026-11-23T06:30:00.000Z', // Monday, noon in India.
  shop: { name: 'Toy Den', handle: 'toyden', photoUrl: '/p.jpg', followers: 40, pro: false,
    setup: { photo: true, cover: true, bio: true, payment: true } },
  listings: { onSale: 6, drafts: 0, soldOut: 0, expired: 0, endingSoon: [], lowStock: [], unseen: [],
    browsedNotBought: [], thin: [], noCommission: 0, noOffer: 6, importsNoLot: 0, best: null, lastListedAt: '2026-11-22T10:00:00.000Z' },
  orders: { toAnswer: 0, unpaid: 0, noLot: 0, inTransit: 0, delivered30: 0, cancelled30: 0 },
  money: { currency: 'INR', revenue30Minor: 100_000_00, revenuePrev30Minor: 90_000_00, orders30: 10 },
  activity: { posts7: 2, shares7: 3, lastPostAt: '2026-11-21T10:00:00.000Z' },
  timing: { hours: new Array(24).fill(0), days: new Array(7).fill(0), sample: 0 },
  ...over,
});
const ids = (signals) => coach.coachTips(signals).map((tip) => tip.id);

console.log('the coach\'s rules');

await check('money waiting on the shop comes first, then a missing way to be paid', () => {
  const tips = coach.coachTips(healthy({
    orders: { ...healthy().orders, toAnswer: 2 },
    shop: { ...healthy().shop, setup: { ...healthy().shop.setup, payment: false } },
  }));
  assert.deepEqual(tips.slice(0, 2).map((tip) => tip.id), ['answer', 'payment']);
  assert.equal(tips[0].tool, 'orders');
  assert.match(tips[0].title, /2 orders waiting/);
});

await check('a healthy shop gets no nagging, and a full health score', () => {
  const signals = healthy();
  assert.deepEqual(ids(signals).filter((id) => ['answer', 'payment', 'first', 'post', 'share', 'setup'].includes(id)), []);
  assert.equal(coach.shopHealth(signals), 100);
});

await check('an empty shelf is told to list, and a quiet week to post and share', () => {
  const empty = ids(healthy({ listings: { ...healthy().listings, onSale: 0 } }));
  assert.ok(empty.includes('first'));
  const quiet = ids(healthy({ activity: { posts7: 0, shares7: 0, lastPostAt: null } }));
  assert.ok(quiet.includes('post') && quiet.includes('share'));
});

await check('items that need a hand are named, each with the tool for it', () => {
  const tips = coach.coachTips(healthy({
    listings: {
      ...healthy().listings,
      browsedNotBought: [item({ id: 'b', views30: 40 })],
      unseen: [item({ id: 'u' })],
      endingSoon: [item({ id: 'e', expiresAt: '2026-11-24T00:00:00.000Z' })],
      lowStock: [item({ id: 's', quantityAvailable: 1 })],
      thin: [item({ id: 't' })],
    },
  }));
  const byId = Object.fromEntries(tips.map((tip) => [tip.id, tip]));
  assert.equal(byId['browsed:b'].tool, 'offers');
  assert.equal(byId['unseen:u'].tool, 'share_item');
  assert.equal(byId['ending:e'].tool, 'share_item');
  assert.equal(byId['low:s'].tool, 'edit_item');
  assert.equal(byId['thin:t'].item.id, 't');
  assert.ok(byId['ending:e'].priority > byId['unseen:u'].priority, 'a closing item is more urgent than a buried one');
});

await check('an import on sale with no shipment is flagged, unless orders already are', () => {
  const listings = { ...healthy().listings, importsNoLot: 2 };
  assert.ok(ids(healthy({ listings })).includes('importsnolot'));
  const both = ids(healthy({ listings, orders: { ...healthy().orders, noLot: 1 } }));
  assert.ok(both.includes('nolot') && !both.includes('importsnolot'), 'one tip, the more urgent one');
  assert.ok(coach.shopHealth(healthy({ listings })) < 100);
});

await check('a slump points a free shop at offers and a Pro shop at a live drop', () => {
  const money = { currency: 'INR', revenue30Minor: 10_000_00, revenuePrev30Minor: 50_000_00, orders30: 2 };
  const free = coach.coachTips(healthy({ money })).find((tip) => tip.id === 'slump');
  assert.equal(free.tool, 'offers');
  assert.match(free.title, /down 80%/);
  const pro = coach.coachTips(healthy({ money, shop: { ...healthy().shop, pro: true } })).find((tip) => tip.id === 'slump');
  assert.equal(pro.tool, 'live_drop');
});

await check('no order book or money in view: no tips about them, and no crash', () => {
  const tips = coach.coachTips(healthy({ orders: null, money: null }));
  assert.ok(!tips.some((tip) => ['answer', 'nolot', 'slump', 'repeat', 'cancels'].includes(tip.id)));
});

console.log('when to post');

await check('few orders: the usual Indian evening, and it says so', () => {
  const best = coach.bestTime({ hours: new Array(24).fill(0), days: new Array(7).fill(0), sample: 3 });
  assert.equal(best.fromShop, false);
  assert.equal(best.peakHour, 20);
  assert.equal(best.postHour, 19);
  assert.equal(best.window, '8-10 pm');
});

await check('enough orders: the shop\'s own rush, read in Indian time, an hour before it', () => {
  // Ten orders at 15:30 UTC on Fridays is 9 pm in India.
  const times = Array.from({ length: 10 }, (_, n) => `2026-11-${String(6 + (n % 3) * 7).padStart(2, '0')}T15:30:00.000Z`);
  const timing = coach.orderTiming(times);
  assert.equal(timing.sample, 10);
  assert.equal(timing.hours[21], 10);
  assert.equal(timing.days[5], 10, 'Friday');
  const best = coach.bestTime(timing);
  assert.equal(best.fromShop, true);
  assert.equal(best.dayName, 'Friday');
  assert.equal(best.postHour, (best.peakHour + 23) % 24);
  assert.ok(best.peakHour === 20 || best.peakHour === 21, `two hours around 9 pm, got ${best.peakHour}`);
});

await check('a rush in the small hours is posted for at 10 pm, never at midnight', () => {
  // 20:00 UTC is 1:30 am in India.
  const best = coach.bestTime(coach.orderTiming(Array.from({ length: 9 }, () => '2026-11-07T20:00:00.000Z')));
  assert.equal(best.fromShop, true);
  assert.ok(best.peakHour <= 1, `got ${best.peakHour}`);
  assert.equal(best.postHour, 22);
  assert.match(best.advice, /late at night/);
});

await check('the week starts today, puts the drop on the busiest day and the teaser the day before', () => {
  const signals = healthy();
  const best = coach.bestTime({ hours: new Array(24).fill(0), days: new Array(7).fill(0), sample: 0 });
  const week = coach.weekPlan(signals, best);
  assert.equal(week.length, 7);
  assert.equal(week[0].isToday, true);
  assert.equal(week[0].dayName, 'Monday');
  assert.equal(week.find((day) => day.day === 0).title, 'Drop day');
  assert.equal(week.find((day) => day.day === 6).title, 'Tease tomorrow');
  assert.ok(week.every((day) => coach.isCoachTool(day.tool)));
});

console.log('answers');

const plan = coach.coachPlan(healthy({ orders: { ...healthy().orders, toAnswer: 1 } }));

await check('a how-to question gets the matching guide and its buttons', () => {
  const answer = coach.answerOffline('How do I list an item?', plan);
  assert.match(answer.text, /Listing an item/);
  assert.ok(answer.tools.includes('list'));
  const ship = coach.answerOffline('how does tracking work for my shipment', plan);
  assert.ok(ship.tools.includes('lots'));
  const refund = coach.answerOffline('A buyer wants a refund', plan);
  assert.ok(refund.tools.includes('refunds'));
});

await check('"what now" gets this shop\'s own top tips; "when" gets its best time', () => {
  const now = coach.answerOffline('What should I do today?', plan);
  assert.match(now.text, /1 order waiting/);
  assert.ok(now.tools.includes('orders'));
  const when = coach.answerOffline('When should I post?', plan);
  assert.match(when.text, /8-10 pm/);
});

await check('anything else gets the menu, never an empty answer', () => {
  const answer = coach.answerOffline('blorp', plan);
  assert.ok(answer.text.length > 20);
  assert.ok(answer.follow.length > 0);
});

await check('the AI brief carries the shop\'s counts and the tool tags; tags become buttons', () => {
  const brief = coach.coachBrief(healthy(), plan);
  assert.match(brief, /Toy Den/);
  assert.match(brief, /\[\[tool:offers\]\]/);
  assert.match(brief, /share_shop = Share shop/);
  const parsed = coach.parseToolTags('Run a weekend offer.\n[[tool:offers]] [[tool:post]] [[tool:nonsense]] [[tool:offers]]');
  assert.equal(parsed.text, 'Run a weekend offer.');
  assert.deepEqual(parsed.tools, ['offers', 'post']);
});

console.log('GET /api/me/coach');

const session = await login(req({ body: { identifier: fixtures.DEMO_EMAIL, password: fixtures.DEMO_PASSWORD } }), ctx);
const shop = { id: session.jsonBody.user.id, headers: { authorization: `Bearer ${session.jsonBody.token}` } };

await check('the shop reads its own coach: signals and a plan built from them', async () => {
  const out = await coachRoute(req({ headers: shop.headers }), ctx);
  assert.equal(out.status, 200, JSON.stringify(out.jsonBody));
  const { signals, plan: built } = out.jsonBody;
  assert.ok(signals.listings.onSale >= 0);
  assert.equal(signals.timing.hours.length, 24);
  assert.equal(signals.timing.days.length, 7);
  assert.ok(signals.orders, 'the owner sees the order book');
  assert.ok(signals.money, 'and the money');
  assert.equal(built.week.length, 7);
  assert.ok(built.health >= 0 && built.health <= 100);
  assert.ok(built.tips.every((tip) => coach.isCoachTool(tip.tool) && tip.title && tip.why));
  // The route's plan is exactly the shared rules over its own signals.
  assert.deepEqual(built.tips.map((tip) => tip.id), coach.coachPlan(signals).tips.map((tip) => tip.id));
});

await check('somebody who does not help run the shop is refused; signed out is refused', async () => {
  const made = await signup(req({
    body: { acceptTerms: true, displayName: 'Coach Stranger', email: 'coach.stranger@figmark.example', phone: '+919000075555', password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const stranger = { authorization: `Bearer ${made.jsonBody.token}` };
  const peek = await coachRoute(req({ headers: stranger, query: { store: shop.id } }), ctx);
  assert.equal(peek.status, 403);
  const own = await coachRoute(req({ headers: stranger }), ctx);
  assert.equal(own.status, 404, 'no shop of their own to coach');
  const anon = await coachRoute(req(), ctx);
  assert.equal(anon.status, 401);
});

console.log(`\n${passed} coach checks passed`);
