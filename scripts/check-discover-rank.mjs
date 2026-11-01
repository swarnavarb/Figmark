/**
 * Discover's ranking rules, checked on small made-up feeds.
 *
 * The functions under test are pure (see api/src/discover-rank.ts and the taste
 * half of api/src/feed-prefs.ts), so each rule is one handful of posts and one
 * assertion. Together they are also the replay harness for tuning: change a
 * number in DISCOVER_TUNING, run this, and see which promise it breaks.
 *
 * Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';

const rank = await import(new URL('../api/dist/api/src/discover-rank.js', import.meta.url));
const prefs = await import(new URL('../api/dist/api/src/feed-prefs.js', import.meta.url));
const { DISCOVER_TUNING: T } = rank;

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const NOW = Date.parse('2026-06-01T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
let serial = 0;
/** A post with just what ranking reads. */
const post = (over = {}) => ({
  id: `p${++serial}`, channelId: 'c1', channel: 'seller', kind: 'update', authorId: 'a1', authorName: 'A', body: 'hello',
  listingId: null, photoUrl: null, likeCount: 0, replyCount: 0, createdAt: hoursAgo(5), updatedAt: hoursAgo(5), ...over,
});
const reactions = (n, hoursBack) => Array.from({ length: n }, (_, i) => ({ userId: `u${i}`, kind: 'like', at: hoursAgo(hoursBack) }));
const poll = (...counts) => ({ options: counts.map((n, i) => ({ id: `o${i}`, label: `Option ${i}`, voterIds: Array.from({ length: n }, (_, k) => `v${i}-${k}`) })) });
const cand = (id, score, over = {}) => ({
  id, score, channel: `ch-${id}`, author: `au-${id}`, format: 'text', topics: [], explorer: false, ...over,
});

console.log('excitement');

check('people arriving now beat the same number who arrived days ago', () => {
  const burst = post({ reactions: reactions(10, 1), likeCount: 10 });
  const slow = post({ reactions: reactions(10, 40), likeCount: 10 });
  assert.ok(rank.velocity(burst, NOW) > rank.velocity(slow, NOW));
  assert.ok(rank.excitement(burst, NOW, 5) > rank.excitement(slow, NOW, 5));
});

check('a poll that is neck and neck beats a landslide with the same votes', () => {
  const close = post({ poll: poll(10, 10) });
  const lopsided = post({ poll: poll(19, 1) });
  assert.ok(rank.contestedness(close) > 0.9, String(rank.contestedness(close)));
  assert.ok(rank.contestedness(lopsided) < 0.2);
  assert.ok(rank.excitement(close, NOW, 5) > rank.excitement(lopsided, NOW, 5));
});

check('a split on too few votes means nothing', () => {
  assert.equal(rank.contestedness(post({ poll: poll(1, 1) })), 0);
  assert.equal(rank.contestedness(post()), 0);
});

check('a post nobody has touched still ranks, newest first', () => {
  const fresh = post({ createdAt: hoursAgo(1) });
  const old = post({ createdAt: hoursAgo(200) });
  assert.ok(rank.excitement(fresh, NOW, 0) > 0);
  assert.ok(rank.excitement(fresh, NOW, 0) > rank.excitement(old, NOW, 0));
});

check('formats tell a debate from a flex from plain words', () => {
  assert.equal(rank.formatOf(post({ debate: {}, poll: poll(1, 1) })), 'debate');
  assert.equal(rank.formatOf(post({ flex: { hotspots: [] } })), 'flex');
  assert.equal(rank.formatOf(post({ channel: 'forum' })), 'thread');
  assert.equal(rank.formatOf(post({ photoUrl: 'x' })), 'photo');
  assert.equal(rank.formatOf(post()), 'text');
});

console.log('\ngoing round again');

check('what did best over its whole life outranks what did less, however old', () => {
  const week = 7 * 86_400_000;
  const loved = post({ createdAt: new Date(NOW - week).toISOString() });
  const meh = post({ createdAt: hoursAgo(1) });
  // Raw heat discounts the old post for its age; evergreen takes that off again.
  const heatOf = (p, engagement) => engagement / Math.pow((NOW - Date.parse(p.createdAt)) / 86_400_000 + 1, 0.6);
  assert.ok(heatOf(loved, 20) < 20, 'aged');
  assert.ok(Math.abs(rank.evergreen(loved, NOW, heatOf(loved, 20)) - 20) < 1e-9, 'age taken off: it is as popular as ever');
  assert.ok(rank.evergreen(loved, NOW, heatOf(loved, 20)) > rank.evergreen(meh, NOW, heatOf(meh, 5)));
});

check('each lap reorders within a post\'s popularity, the same way for the same visit', () => {
  const same = (lap) => rank.shuffleBy('visit', lap, 'pst_1');
  assert.equal(same(1), same(1));
  assert.notEqual(same(1), same(2));
  assert.notEqual(rank.shuffleBy('visit', 1, 'pst_1'), rank.shuffleBy('other', 1, 'pst_1'));
  for (let i = 0; i < 500; i += 1) {
    const by = rank.shuffleBy('v', 1 + (i % 5), `p${i}`);
    assert.ok(by >= 1 - T.replay.shuffle / 2 && by <= 1 + T.replay.shuffle / 2, String(by));
  }
});

check('a lap in a new order still starts with the popular and ends with the quiet', () => {
  const pool = Array.from({ length: 40 }, (_, i) => cand(`p${i}`, (40 - i) * rank.shuffleBy('v', 1, `p${i}`)));
  const order = rank.rankStream(pool, 40, 'v:1').map((entry) => Number(entry.id.slice(1)));
  const top = order.slice(0, 10).reduce((sum, n) => sum + n, 0) / 10;
  const bottom = order.slice(-10).reduce((sum, n) => sum + n, 0) / 10;
  assert.ok(top < 20 && bottom > 20, `${top} / ${bottom}`);
});

console.log('\nthe rising audience');

check('a new post starts at the seed share and stays there until it has been seen enough', () => {
  assert.equal(rank.risingSeedPercent(post({ views: 0 })), T.rising.seed);
  assert.equal(rank.risingSeedPercent(post({ views: T.rising.minViews - 1 })), T.rising.seed);
});

check('a post that lands is shown to more people, one scrolled past to nobody', () => {
  const views = 200;
  const lands = post({ views, reactions: reactions(40, 1), likeCount: 40 });
  const meh = post({ views, reactions: reactions(10, 1), likeCount: 10 });
  const dud = post({ views, reactions: [], comments: [], likeCount: 0 });
  assert.equal(rank.risingSeedPercent(lands), T.rising.max, 'capped at the most');
  assert.equal(rank.risingSeedPercent(meh), T.rising.seed, 'on target keeps the seed');
  assert.equal(rank.risingSeedPercent(dud), 0, 'ignored stops being offered');
  assert.ok(rank.risingSeedPercent(lands) > rank.risingSeedPercent(meh));
});

console.log('\ntaste');

const noTaste = { topics: {}, kinds: {}, channels: {}, at: new Date(NOW).toISOString() };
const noneEngaged = { channels: new Set(), topics: new Map(), formats: new Map() };
const lifter = (taste = noTaste, engaged = noneEngaged, screen = prefs.NO_SCREEN) => rank.tasteLiftFor(taste, engaged, screen);

check('a reader with no history sees every post at face value', () => {
  const lift = lifter();
  assert.equal(lift(post(), ['resin']), 1);
  assert.equal(lift(post(), []), 1);
});

check('a liked topic lifts a post; a disliked one lowers it', () => {
  const liked = lifter({ ...noTaste, topics: { resin: 4, sneakers: -4 } });
  assert.ok(liked(post(), ['resin']) > 1.5, String(liked(post(), ['resin'])));
  assert.ok(liked(post(), ['sneakers']) < 0.8, String(liked(post(), ['sneakers'])));
});

check('a topic taken part in counts like one lingered on', () => {
  const taken = { ...noneEngaged, topics: new Map([['resin', 3]]) };
  assert.ok(lifter(noTaste, taken)(post(), ['resin']) > 1.4);
});

check('a format and a channel they dwell on lift a post too, a little', () => {
  const fond = lifter({ ...noTaste, kinds: { text: 4 }, channels: { shopA: 4 } });
  const both = fond(post({ channelId: 'shopA' }), []);
  const kindOnly = fond(post({ channelId: 'shopB' }), []);
  const neither = fond(post({ channelId: 'shopB', photoUrl: 'x' }), []);
  assert.ok(both > kindOnly && kindOnly > neither, [both, kindOnly, neither].join(' > '));
});

check('no taste, however strong, takes a post beyond its floor and ceiling', () => {
  const loves = lifter({ topics: { a: 8, b: 8, c: 8 }, kinds: { text: 8 }, channels: { c1: 8 }, at: noTaste.at });
  const hates = lifter({ topics: { a: -8, b: -8, c: -8 }, kinds: { text: -8 }, channels: { c1: -8 }, at: noTaste.at });
  assert.ok(loves(post(), ['a', 'b', 'c']) <= T.taste.ceiling);
  assert.ok(hates(post(), ['a', 'b', 'c']) >= T.taste.floor * 0.5 - 1e-9, 'floor, less a topic marked "less like this" at most');
  assert.ok(hates(post(), ['a', 'b', 'c']) >= T.taste.floor);
});

check('a topic marked "less like this" lowers a post whatever else is liked', () => {
  const screen = prefs.screenOf({ feedPrefs: { lessTopics: ['resin'] } });
  const liked = { ...noTaste, topics: { resin: 4 } };
  const plain = lifter(liked)(post(), ['resin']);
  const lowered = lifter(liked, noneEngaged, screen)(post(), ['resin']);
  assert.ok(Math.abs(lowered - plain * prefs.LESS_TOPIC_LIFT) < 1e-9);
});

console.log('\nvariety and the stream');

check('one busy channel cannot fill a run, however well it scores', () => {
  const busy = Array.from({ length: 10 }, (_, i) => cand(`busy${i}`, 10 - i * 0.1, { channel: 'busy', author: 'busy' }));
  const others = Array.from({ length: 10 }, (_, i) => cand(`o${i}`, 4 - i * 0.1));
  const order = rank.rankStream([...busy, ...others], 12, 'seed').map((entry) => entry.id);
  const channels = order.slice(0, 8).map((id) => (id.startsWith('busy') ? 'busy' : id));
  const longest = channels.reduce((best, c, i) => (i > 0 && channels[i - 1] === c ? Math.max(best, 2) : best), 1);
  assert.ok(channels.filter((c) => c === 'busy').length <= 5, channels.join(','));
  assert.ok(longest <= 2 && new Set(channels).size >= 4, channels.join(','));
});

check('a run of the same format is broken up', () => {
  const debates = Array.from({ length: 6 }, (_, i) => cand(`d${i}`, 9 - i * 0.05, { format: 'debate' }));
  const flexes = Array.from({ length: 6 }, (_, i) => cand(`f${i}`, 8.5 - i * 0.05, { format: 'flex' }));
  const order = rank.rankStream([...debates, ...flexes], 6, 'seed').map((entry) => entry.id[0]);
  assert.ok(order.includes('d') && order.includes('f'), order.join(''));
});

check('every few places go to something unfamiliar, and the same visit draws the same ones', () => {
  const known = Array.from({ length: 20 }, (_, i) => cand(`k${i}`, 20 - i));
  const fresh = Array.from({ length: 10 }, (_, i) => cand(`x${i}`, 1 + i * 0.01, { explorer: true }));
  const once = rank.rankStream([...known, ...fresh], 20, 'visit-1');
  const again = rank.rankStream([...fresh, ...known], 20, 'visit-1');
  assert.deepEqual(once, again, 'same seed, same stream, whatever order they arrive in');
  const places = once.map((entry, i) => (entry.explore ? i + 1 : 0)).filter(Boolean);
  assert.deepEqual(places, [5, 10, 15, 20]);
  assert.ok(once.filter((entry) => entry.explore).every((entry) => entry.id.startsWith('x')));
  const other = rank.rankStream([...known, ...fresh], 20, 'visit-2');
  assert.notDeepEqual(once.map((entry) => entry.id), other.map((entry) => entry.id), 'another visit draws different ones');
});

check('with nobody unfamiliar to offer, the explore places go to the best remaining', () => {
  const only = Array.from({ length: 12 }, (_, i) => cand(`k${i}`, 12 - i));
  const order = rank.rankStream(only, 10, 's');
  assert.equal(order.length, 10);
  assert.ok(order.every((entry) => !entry.explore));
});

check('reading on from places already given continues the same stream, with nothing moved or repeated', () => {
  const pool = [
    ...Array.from({ length: 30 }, (_, i) => cand(`k${i}`, 30 - i, { channel: `ch${i % 4}`, topics: [`t${i % 3}`] })),
    ...Array.from({ length: 10 }, (_, i) => cand(`x${i}`, 2 + i * 0.1, { explorer: true })),
  ];
  const whole = rank.rankStream(pool, 24, 'v');
  const first = rank.rankStream(pool, 12, 'v');
  assert.deepEqual(first, whole.slice(0, 12), 'a shorter stream is the front of a longer one');
  const byId = new Map(pool.map((c) => [c.id, c]));
  const rest = rank.rankStream(pool, 12, 'v', first.map((entry) => byId.get(entry.id)));
  assert.deepEqual([...first, ...rest], whole, 'resuming equals never having stopped');
});

check('only the first places are ranked, and never one twice', () => {
  const pool = Array.from({ length: 50 }, (_, i) => cand(`c${i}`, 50 - i));
  const order = rank.rankStream(pool, 30, 's').map((entry) => entry.id);
  assert.equal(new Set(order).size, 30);
});

console.log('\npages that agree with each other');

check('a cursor survives the round trip, and bad ones are refused', () => {
  const cursor = { at: NOW - 60_000, offset: 48, seed: 'usr_1:123:abcd1234', lap: 0 };
  assert.deepEqual(rank.decodeCursor(rank.encodeCursor(cursor), NOW), cursor);
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, lap: 3 }), NOW).lap, 3, 'which time round it is');
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, lap: 10 ** 6 }), NOW).lap, T.replay.maxLaps, 'clamped');
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, lap: -4 }), NOW).lap, 0, 'clamped');
  const legacy = Buffer.from(JSON.stringify([cursor.at, 12, 'seed'])).toString('base64url');
  assert.equal(rank.decodeCursor(legacy, NOW).lap, 0, 'a cursor from before laps is still read');
  assert.equal(rank.decodeCursor(null, NOW), null);
  assert.equal(rank.decodeCursor('', NOW), null);
  assert.equal(rank.decodeCursor('not a cursor', NOW), null);
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, at: NOW + 60_000 }), NOW), null, 'from the future');
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, at: NOW - T.cursorMaxAgeMs - 1 }), NOW), null, 'too old: a fresh visit');
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, seed: 'x'.repeat(100) }), NOW), null, 'oversized');
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, offset: -5 }), NOW).offset, 0, 'clamped');
  assert.equal(rank.decodeCursor(rank.encodeCursor({ ...cursor, offset: 10 ** 9 }), NOW).offset, T.replay.window, 'clamped');
  assert.equal(rank.decodeCursor('x'.repeat(500), NOW), null);
});

check('a visit remembers its order for a while, then lets go', () => {
  rank.resetDiscoverCaches();
  const order = [{ id: 'a', explore: false }, { id: 'b', explore: true }];
  assert.equal(rank.readSnapshot('k', NOW), null);
  rank.writeSnapshot('k', order, NOW);
  assert.deepEqual(rank.readSnapshot('k', NOW + 1000), order);
  assert.equal(rank.readSnapshot('k', NOW + T.snapshot.ttlMs + 1), null);
  for (let i = 0; i < T.snapshot.max + 20; i += 1) rank.writeSnapshot(`k${i}`, order, NOW);
  assert.equal(rank.readSnapshot('k0', NOW), null, 'the oldest are dropped');
  assert.ok(rank.readSnapshot(`k${T.snapshot.max + 19}`, NOW));
});

check('the engagement index is reused until something on a post changes', () => {
  rank.resetDiscoverCaches();
  const a = post({ reactions: reactions(2, 1), likeCount: 2 });
  const b = post({ body: 'about #resin' });
  const actors = (p) => new Set((p.reactions ?? []).map((r) => r.userId));
  const topics = (p) => (p.body.includes('#resin') ? ['resin'] : []);
  const first = rank.indexOf([a, b], actors, topics);
  assert.equal(rank.indexOf([a, b], actors, topics), first, 'same posts, same index');
  assert.deepEqual([...first.byActor.get('u0')], [a.id]);
  assert.deepEqual(first.topics.get(b.id), ['resin']);
  const moved = { ...a, reactions: reactions(3, 1), likeCount: 3 };
  const second = rank.indexOf([moved, b], actors, topics);
  assert.notEqual(second, first, 'a new reaction makes a new index');
  assert.ok(second.byActor.has('u2'));
});

console.log('\nsaying why');

check('the strongest honest reason is the one given', () => {
  const none = { endsInMs: null, live: false, followedActed: 0, forumJoined: false, affinity: false, contested: 0, velocity: 0, rising: false, explore: false, replay: false };
  assert.equal(rank.whyOf(none), null, 'nothing honest to say, nothing said');
  assert.equal(rank.whyOf({ ...none, endsInMs: 3 * 3_600_000 }).label, 'Closes in 3h');
  assert.equal(rank.whyOf({ ...none, endsInMs: 20 * 60_000 }).label, 'Closes in 20m');
  assert.equal(rank.whyOf({ ...none, endsInMs: 3 * 86_400_000 }), null, 'days away is not news');
  assert.equal(rank.whyOf({ ...none, endsInMs: Infinity, live: true }).kind, 'live');
  assert.equal(rank.whyOf({ ...none, followedActed: 1 }).label, '1 person you follow joined in');
  assert.equal(rank.whyOf({ ...none, followedActed: 3 }).label, '3 people you follow joined in');
  assert.equal(rank.whyOf({ ...none, forumJoined: true, affinity: true }).kind, 'forum');
  assert.equal(rank.whyOf({ ...none, topic: 'resin kit' }), null, 'a liked topic is never given as the reason');
  assert.equal(rank.whyOf({ ...none, affinity: true, contested: 0.9 }).kind, 'affinity');
  assert.equal(rank.whyOf({ ...none, replay: true, contested: 0.9 }).label, 'Popular earlier', 'older posts shown again say so');
  assert.equal(rank.whyOf({ ...none, replay: true, endsInMs: 3_600_000 }).kind, 'ending', 'unless something stronger is true');
  assert.equal(rank.whyOf({ ...none, contested: 0.9, velocity: 5 }).kind, 'contested');
  assert.equal(rank.whyOf({ ...none, velocity: 2, rising: true }).kind, 'taking-off');
  assert.equal(rank.whyOf({ ...none, rising: true, explore: true }).kind, 'explore');
  assert.equal(rank.whyOf({ ...none, rising: true }).kind, 'new');
});

console.log('\nwhat a reader tells the feed');

check('"not interested" bites hardest when it is new and fades as newer ones are said', () => {
  const ids = Array.from({ length: 80 }, (_, i) => `author${i}`);
  const screen = prefs.screenOf({ feedPrefs: { lessFrom: ids } });
  const lift = (id) => prefs.lessFromLift(screen, post({ authorId: id, channel: 'forum' }));
  assert.equal(lift('author0'), prefs.LESS_FROM_LIFT, 'the latest is at full strength');
  assert.ok(lift('author10') > lift('author0') && lift('author30') > lift('author10'));
  assert.equal(lift('author60'), 1, 'forgiven');
  assert.equal(lift('author79'), 1);
  assert.equal(lift('stranger'), 1);
  const shop = post({ authorId: 'person', channelId: 'shop', channel: 'seller' });
  assert.equal(prefs.lessFromLift(prefs.screenOf({ feedPrefs: { lessFrom: ['shop'] } }), shop), prefs.LESS_FROM_LIFT, 'a shop, by its channel');
});

check('"less like this" lowers a topic without touching the author', () => {
  const screen = prefs.screenOf({ feedPrefs: { lessTopics: ['resin kit'] } });
  assert.equal(prefs.lessTopicLift(screen, ['resin kit', 'figures']), prefs.LESS_TOPIC_LIFT);
  assert.equal(prefs.lessTopicLift(screen, ['figures']), 1);
  assert.equal(prefs.lessFromLift(screen, post()), 1);
});

check('taste fades by half every three weeks when nothing feeds it', () => {
  const taste = { topics: { resin: 4 }, kinds: { debate: 2 }, channels: { shop: 6 }, at: new Date(NOW).toISOString() };
  const later = prefs.tasteAt(taste, NOW + 21 * 86_400_000);
  assert.ok(Math.abs(later.topics.resin - 2) < 1e-9);
  assert.ok(Math.abs(later.channels.shop - 3) < 1e-9);
  const long = prefs.tasteAt(taste, NOW + 400 * 86_400_000);
  assert.deepEqual(long.topics, {}, 'faded to nothing, and dropped');
  assert.deepEqual(prefs.tasteAt(undefined, NOW).topics, {});
});

check('what holds attention is learned, shared among topics, and what is put away is unlearned', () => {
  let taste = prefs.learnTaste(undefined, [{ channelId: 'shop', kind: 'flex', topics: ['resin'], weight: 1 }], NOW);
  assert.equal(taste.topics.resin, 1);
  assert.equal(taste.channels.shop, 1);
  assert.equal(taste.kinds.flex, 0.6);
  taste = prefs.learnTaste(taste, [{ channelId: 'shop', kind: 'flex', topics: ['resin'], weight: 1 }], NOW);
  assert.equal(taste.topics.resin, 2, 'feeding it again adds');
  taste = prefs.learnTaste(taste, [{ channelId: 'shop', kind: 'flex', topics: ['resin'], weight: -2 }], NOW);
  assert.equal(taste.topics.resin, 0, 'putting one away takes it back');
  const crowded = prefs.learnTaste(undefined, [{ channelId: 'c', kind: 'text', topics: ['a', 'b', 'c', 'd'], weight: 1 }], NOW);
  assert.equal(crowded.topics.a, 0.5, 'four topics share one post');
});

check('taste stays small however long it is fed, keeping the strongest', () => {
  const many = Array.from({ length: 200 }, (_, i) => ({ channelId: `c${i}`, kind: `k${i % 30}`, topics: [`t${i}`], weight: 1 + (i % 7) }));
  const taste = prefs.learnTaste(undefined, many, NOW);
  assert.ok(Object.keys(taste.topics).length <= 60 && Object.keys(taste.channels).length <= 60 && Object.keys(taste.kinds).length <= 12);
  assert.ok(Object.values(taste.topics).every((w) => Math.abs(w) <= 8), 'no one thing can run away');
  assert.equal(taste.topics.t0, undefined, 'the weakest are the ones dropped');
  assert.equal(taste.topics.t6, 7, 'the strongest are kept');
  assert.ok(Object.values(taste.topics).every((w) => w >= 5), 'and nothing weak crowds them out');
});

check('a glance says nothing, lingering a little, opening the most', () => {
  assert.equal(prefs.attentionWeight(800, false), 0);
  assert.equal(prefs.attentionWeight(1500, false), 0);
  assert.ok(prefs.attentionWeight(8000, false) > 0);
  assert.ok(prefs.attentionWeight(60_000, false) <= 0.6, 'capped');
  assert.ok(prefs.attentionWeight(0, true) >= 1);
  assert.ok(prefs.attentionWeight(8000, true) > prefs.attentionWeight(8000, false));
});

console.log(`\n${passed} checks passed`);
