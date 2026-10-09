/**
 * Smoke test for what the bell says, and how much of it there is.
 *
 * Messages and channels, likes, follows and reviews each tell the right
 * people; a notice says whether it reached you or your store, by name, and
 * "your store" when the name will not fit; a run of the same thing folds into
 * one row; opening a conversation reads its notices; the list pages and
 * filters; and somebody's phone settings decide what reaches the lock screen.
 * Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

process.env.FIGMARK_RATE_LIMITS = 'off';
const require = createRequire(new URL('../api/package.json', import.meta.url));
const webpush = require('web-push');
const keys = webpush.generateVAPIDKeys();
process.env.WEB_PUSH_PUBLIC_KEY = keys.publicKey;
process.env.WEB_PUSH_PRIVATE_KEY = keys.privateKey;

const fns = new URL('../api/dist/api/src/functions/', import.meta.url);
const { signupRoute: signup, loginRoute: login } = await import(new URL('auth-routes.js', fns));
const { setUsernameRoute: setUsername, sendMessageRoute: send, threadRoute: thread, muteRoute: mute, reactToMessageRoute: reactToMessage } =
  await import(new URL('message-routes.js', fns));
const { notificationsRoute: list, notificationsReadRoute: markRead, notificationSettingsRoute: settings, notificationSettingsSaveRoute: saveSettings } =
  await import(new URL('notification-routes.js', fns));
const { pushSubscribeRoute: subscribe } = await import(new URL('push-routes.js', fns));
const { createPostRoute: createPost, reactRoute: react, addPostCommentRoute: comment, likeCommentRoute: likeComment } =
  await import(new URL('social-routes.js', fns));
const { toggleFollowRoute: follow } = await import(new URL('catalog-routes.js', fns));
const { writePageReviewRoute: writePageReview } = await import(new URL('profile-routes.js', fns));
const { notify } = await import(new URL('notify.js', fns));
const { setPushTransport } = await import(new URL('../push.js', fns));
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
const { actorName, toWhom, whose, andOthers, categoryOf, inQuietHours } =
  await import(new URL('../api/dist/shared/notifications.js', import.meta.url));
const repository = await getRepository();

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body, params = {}, query = {} } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});

let sent = [];
setPushTransport(async (endpoint, message) => {
  sent.push({ endpoint: endpoint.endpoint, message });
  return { delivered: true, gone: false };
});

let passed = 0;
async function check(name, fn) {
  sent = [];
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString('hex')}`,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
  };
}

async function person(name, phone, username) {
  const made = await signup(req({
    body: { displayName: name, email: `${name.toLowerCase().replace(/\W/g, '')}@bell.example`, phone, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  const auth = { authorization: `Bearer ${made.jsonBody.token}` };
  if (username) {
    const named = await setUsername(req({ headers: auth, body: { username } }), ctx);
    assert.equal(named.status, 200, JSON.stringify(named.jsonBody));
  }
  return { id: made.jsonBody.user.id, auth };
}

const bell = async (who, query = {}) => {
  const response = await list(req({ headers: who.auth, query }), ctx);
  assert.equal(response.status, 200, JSON.stringify(response.jsonBody));
  return response.jsonBody;
};

// The demo account: a person (@arjun, "Arjun Mehta") who also runs a shop
// (@arjun_collects, "Arjun Collects").
const signedIn = await login(req({ body: { identifier: 'demo@figmark.in', password: 'figmark123' } }), ctx);
assert.equal(signedIn.status, 200, JSON.stringify(signedIn.jsonBody));
const arjun = { id: signedIn.jsonBody.user.id, auth: { authorization: `Bearer ${signedIn.jsonBody.token}` } };
const sana = await person('Sana Tiwari', '+919000081001', 'sana_t');

await check('names that fit are said; long ones become "you" and "your store"', async () => {
  assert.equal(toWhom(null), 'you');
  assert.equal(toWhom('Arjun Collects'), 'Arjun Collects');
  assert.equal(toWhom('Kaiju Imports International Trading Co'), 'your store');
  assert.equal(whose(null), 'your');
  assert.equal(whose('Arjun Collects'), 'Arjun Collects’');
  assert.equal(whose('Hobby Haven'), 'Hobby Haven’s');
  assert.equal(whose('Kaiju Imports International Trading Co'), 'your store’s');
  assert.equal(actorName('Kaiju Imports International Trading Co', 'kaiju'), '@kaiju');
  assert.equal(andOthers(['Sana', 'Ravi', 'Meera']), 'Sana and 2 others');
  assert.equal(categoryOf('message'), 'messages');
  assert.equal(categoryOf('payment_received'), 'payments');
});

await check('a message to a store says it reached the store, by name, and opens that conversation', async () => {
  const response = await send(req({ headers: sana.auth, params: { handle: 'arjun_collects' }, body: { body: 'Is the Godzilla still there?' } }), ctx);
  assert.equal(response.status, 201, JSON.stringify(response.jsonBody));
  const row = (await bell(arjun)).notifications.find((entry) => entry.kind === 'message');
  assert.ok(row, 'told');
  assert.equal(row.title, 'Sana Tiwari messaged Arjun Collects');
  assert.equal(row.body, 'Is the Godzilla still there?');
  assert.equal(row.link, '/messages/sana_t?as=arjun_collects');
  assert.equal(row.category, 'messages');
  // Never to whoever wrote it.
  assert.ok(!(await bell(sana)).notifications.some((entry) => entry.kind === 'message'));
  assert.equal(sent.length, 0, 'nobody has a device yet');
});

await check('more messages fold into the same row while it is unread', async () => {
  await send(req({ headers: sana.auth, params: { handle: 'arjun_collects' }, body: { body: 'And the Mothra?' } }), ctx);
  await send(req({ headers: sana.auth, params: { handle: 'arjun_collects' }, body: { body: 'I can pay today.' } }), ctx);
  const rows = (await bell(arjun)).notifications.filter((entry) => entry.link === '/messages/sana_t?as=arjun_collects');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Sana Tiwari sent Arjun Collects 3 messages');
  assert.equal(rows[0].count, 3);
  assert.equal(rows[0].body, 'I can pay today.', 'the newest one');
});

await check('a message to the person says "you", and is a separate row', async () => {
  await send(req({ headers: sana.auth, params: { handle: 'arjun' }, body: { body: 'Hi, personally this time' } }), ctx);
  const rows = (await bell(arjun)).notifications.filter((entry) => entry.kind === 'message');
  const mine = rows.find((entry) => entry.link === '/messages/sana_t?as=arjun');
  assert.ok(mine);
  assert.equal(mine.title, 'Sana Tiwari messaged you');
  assert.equal(rows.length, 2);
});

await check('opening the conversation reads its notices, and only its own', async () => {
  const opened = await thread(req({ headers: arjun.auth, params: { handle: 'sana_t' }, query: { as: 'arjun_collects' } }), ctx);
  assert.equal(opened.status, 200, JSON.stringify(opened.jsonBody));
  const rows = (await bell(arjun)).notifications.filter((entry) => entry.kind === 'message');
  assert.equal(rows.find((entry) => entry.link.endsWith('as=arjun_collects')).read, true);
  assert.equal(rows.find((entry) => entry.link.endsWith('as=arjun')).read, false);
});

await check('the next message after reading reopens the same row, counting from one', async () => {
  await send(req({ headers: sana.auth, params: { handle: 'arjun_collects' }, body: { body: 'Still there?' } }), ctx);
  const rows = (await bell(arjun)).notifications.filter((entry) => entry.link === '/messages/sana_t?as=arjun_collects');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Sana Tiwari messaged Arjun Collects');
  assert.equal(rows[0].count, 1);
  assert.equal(rows[0].read, false);
});

await check('the conversation opens at the first unread message', async () => {
  const opened = await thread(req({ headers: arjun.auth, params: { handle: 'sana_t' }, query: { as: 'arjun_collects' } }), ctx);
  const first = opened.jsonBody.messages.find((message) => message.id === opened.jsonBody.firstUnreadId);
  assert.equal(first?.body, 'Still there?');
  assert.equal(opened.jsonBody.unread, 1);
  const again = await thread(req({ headers: arjun.auth, params: { handle: 'sana_t' }, query: { as: 'arjun_collects' } }), ctx);
  assert.equal(again.jsonBody.firstUnreadId, null, 'read once opened');
});

await check('a muted conversation stays quiet', async () => {
  const muted = await mute(req({ headers: arjun.auth, params: { handle: 'sana_t' }, body: { mute: true, as: 'arjun' } }), ctx);
  assert.equal(muted.status, 200);
  const before = (await bell(arjun)).notifications.find((entry) => entry.link.endsWith('as=arjun'));
  await send(req({ headers: sana.auth, params: { handle: 'arjun' }, body: { body: 'you there?' } }), ctx);
  const after = (await bell(arjun)).notifications.find((entry) => entry.link.endsWith('as=arjun'));
  assert.equal(after.count, before.count, 'not folded in either');
  await mute(req({ headers: arjun.auth, params: { handle: 'sana_t' }, body: { mute: false, as: 'arjun' } }), ctx);
});

await check('a store writing to a person says which store', async () => {
  await send(req({ headers: arjun.auth, params: { handle: 'sana_t' }, body: { body: 'Yes, it is yours.', as: 'arjun_collects' } }), ctx);
  const row = (await bell(sana)).notifications.find((entry) => entry.kind === 'message');
  assert.equal(row.title, 'Arjun Collects messaged you');
  assert.equal(row.link, '/messages/arjun_collects?as=sana_t');
});

await check('a store name too long for a title becomes "your store"', async () => {
  const owner = await repository.getUserById(arjun.id);
  const long = 'Arjun Collects Imports and Vintage Toys';
  await repository.updateUser({ ...owner, sellerProfile: { ...owner.sellerProfile, storefrontName: long } });
  await thread(req({ headers: arjun.auth, params: { handle: 'sana_t' }, query: { as: 'arjun_collects' } }), ctx);
  await send(req({ headers: sana.auth, params: { handle: 'arjun_collects' }, body: { body: 'One more thing' } }), ctx);
  const row = (await bell(arjun)).notifications.find((entry) => entry.link === '/messages/sana_t?as=arjun_collects');
  assert.equal(row.title, 'Sana Tiwari messaged your store');
  await repository.updateUser({ ...(await repository.getUserById(arjun.id)), sellerProfile: owner.sellerProfile });
});

await check('a reaction to a message is news to whoever sent it', async () => {
  const theirs = (await thread(req({ headers: sana.auth, params: { handle: 'arjun_collects' } }), ctx)).jsonBody.messages
    .find((message) => message.from.handle === 'arjun_collects');
  const reacted = await reactToMessage(req({ headers: sana.auth, params: { handle: 'arjun_collects' }, body: { messageId: theirs.id, kind: 'love' } }), ctx);
  assert.equal(reacted.status, 200, JSON.stringify(reacted.jsonBody));
  const row = (await bell(arjun)).notifications.find((entry) => entry.kind === 'message_reacted');
  assert.equal(row.title, 'Sana Tiwari reacted ❤️ to Arjun Collects’ message');
});

await check('following a store and following the person are told apart', async () => {
  assert.equal((await follow(req({ headers: sana.auth, params: { id: arjun.id } }), ctx)).status, 200);
  assert.equal((await follow(req({ headers: sana.auth, params: { id: `person:${arjun.id}` } }), ctx)).status, 200);
  const rows = (await bell(arjun)).notifications.filter((entry) => entry.kind === 'followed');
  assert.ok(rows.some((entry) => entry.title === 'Sana Tiwari followed Arjun Collects'), JSON.stringify(rows));
  assert.ok(rows.some((entry) => entry.title === 'Sana Tiwari followed you'), JSON.stringify(rows));
  assert.ok(rows.every((entry) => entry.link === '/sana_t'));
});

let storePost;
await check('likes on a store post say it was the store’s, and fold as more people react', async () => {
  const posted = await createPost(req({ headers: arjun.auth, body: { body: 'New crate landed today', storeId: arjun.id } }), ctx);
  assert.equal(posted.status, 201, JSON.stringify(posted.jsonBody));
  storePost = posted.jsonBody.post;
  const reacted = await react(req({ headers: sana.auth, params: { channel: storePost.channelId, id: storePost.id }, body: { kind: 'fire' } }), ctx);
  assert.equal(reacted.status, 200, JSON.stringify(reacted.jsonBody));
  let row = (await bell(arjun)).notifications.find((entry) => entry.kind === 'post_reacted');
  assert.equal(row.title, 'Sana Tiwari reacted 🔥 to Arjun Collects’ post');

  const ravi = await person('Ravi Kumar', '+919000081002', 'ravi_k');
  await follow(req({ headers: ravi.auth, params: { id: arjun.id } }), ctx);
  await react(req({ headers: ravi.auth, params: { channel: storePost.channelId, id: storePost.id }, body: { kind: 'love' } }), ctx);
  const rows = (await bell(arjun)).notifications.filter((entry) => entry.kind === 'post_reacted');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Ravi Kumar and Sana Tiwari reacted to Arjun Collects’ post');
});

await check('a comment, a reply to it, and a like on it each reach the right person', async () => {
  const said = await comment(req({ headers: sana.auth, params: { channel: storePost.channelId, id: storePost.id }, body: { body: 'How much for the lot?' } }), ctx);
  assert.equal(said.status, 201, JSON.stringify(said.jsonBody));
  let row = (await bell(arjun)).notifications.find((entry) => entry.kind === 'post_commented');
  assert.equal(row.title, 'Sana Tiwari commented on Arjun Collects’ post');

  // The shop answers in its own voice.
  const commentId = said.jsonBody.comment;
  const answered = await comment(req({
    headers: arjun.auth, query: { as: arjun.id },
    params: { channel: storePost.channelId, id: storePost.id }, body: { body: '₹4,000 for all', parentId: commentId },
  }), ctx);
  assert.equal(answered.status, 201, JSON.stringify(answered.jsonBody));
  row = (await bell(sana)).notifications.find((entry) => entry.kind === 'comment_replied');
  assert.equal(row.title, 'Arjun Collects replied to your comment');

  const liked = await likeComment(req({
    headers: arjun.auth, query: { as: arjun.id },
    params: { channel: storePost.channelId, id: storePost.id, comment: commentId },
  }), ctx);
  assert.equal(liked.status, 200, JSON.stringify(liked.jsonBody));
  row = (await bell(sana)).notifications.find((entry) => entry.kind === 'comment_liked');
  assert.equal(row.title, 'Arjun Collects liked your comment');
});

await check('a customer writing in a store’s channel tells the store; an announcement tells its followers', async () => {
  const wrote = await createPost(req({ headers: sana.auth, body: { body: 'When is the next drop?', channelId: arjun.id } }), ctx);
  assert.equal(wrote.status, 201, JSON.stringify(wrote.jsonBody));
  const row = (await bell(arjun)).notifications.find((entry) => entry.kind === 'channel_message');
  assert.equal(row.title, 'Sana Tiwari wrote in Arjun Collects’ channel');
  assert.equal(row.link, `/social/c/${arjun.id}`);

  const announced = await createPost(req({ headers: arjun.auth, body: { body: 'Drop on Friday, 8pm', channelId: arjun.id, announcement: true } }), ctx);
  assert.equal(announced.status, 201, JSON.stringify(announced.jsonBody));
  const told = (await bell(sana)).notifications.find((entry) => entry.kind === 'channel_announcement');
  assert.equal(told.title, 'Arjun Collects posted an announcement');
  assert.equal(told.body, 'Drop on Friday, 8pm');
  // Ordinary conversation from the shop is not broadcast.
  await createPost(req({ headers: arjun.auth, body: { body: 'Answering in the room', channelId: arjun.id } }), ctx);
  const again = (await bell(sana)).notifications.filter((entry) => entry.kind === 'channel_announcement');
  assert.equal(again.length, 1);
  assert.equal(again[0].count, 1);
});

await check('a page review says which page, with the stars', async () => {
  const wrote = await writePageReview(req({ headers: sana.auth, params: { id: arjun.id }, body: { rating: 4, body: 'Packed really well', side: 'store' } }), ctx);
  assert.ok([200, 201].includes(wrote.status), JSON.stringify(wrote.jsonBody));
  const row = (await bell(arjun)).notifications.find((entry) => entry.kind === 'review_received');
  assert.equal(row.title, 'Sana Tiwari reviewed Arjun Collects ★★★★☆');
  assert.equal(row.category, 'reviews');
  assert.equal(row.link, '/arjun_collects');
});

const pager = await person('Paige Turner', '+919000081003');

await check('the list pages back, with nothing twice and nothing skipped', async () => {
  for (let index = 0; index < 45; index += 1) {
    await notify(repository, [pager.id], {
      kind: index % 3 === 0 ? 'message' : 'order_placed',
      title: `Notice ${index}`, body: '', link: '/',
    });
    // Distinct times, as real ones are.
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  const seen = [];
  let page = await bell(pager);
  assert.equal(page.notifications.length, 20);
  assert.equal(page.unread, 45);
  assert.equal(page.unreadByCategory.messages, 15);
  seen.push(...page.notifications.map((row) => row.title));
  while (page.nextBefore) {
    page = await bell(pager, { before: page.nextBefore });
    seen.push(...page.notifications.map((row) => row.title));
  }
  assert.equal(seen.length, 45);
  assert.equal(new Set(seen).size, 45);
  assert.equal(seen[0], 'Notice 44', 'newest first');
  assert.equal(seen[44], 'Notice 0');
});

await check('one category at a time, paged the same way', async () => {
  const seen = [];
  let page = await bell(pager, { category: 'messages', limit: '6' });
  seen.push(...page.notifications);
  while (page.nextBefore) {
    page = await bell(pager, { category: 'messages', limit: '6', before: page.nextBefore });
    seen.push(...page.notifications);
  }
  assert.equal(seen.length, 15);
  assert.ok(seen.every((row) => row.category === 'messages'));
});

await check('"mark all read" can be one category', async () => {
  const done = await markRead(req({ headers: pager.auth, body: { category: 'messages' } }), ctx);
  assert.equal(done.status, 200);
  const page = await bell(pager);
  assert.equal(page.unread, 30);
  assert.equal(page.unreadByCategory.messages, undefined);
  const several = await markRead(req({ headers: pager.auth, body: { ids: page.notifications.slice(0, 2).map((row) => row.id) } }), ctx);
  assert.equal(several.status, 200);
  assert.equal((await bell(pager)).unread, 28);
});

await check('a category kept off the phone stays in the bell; quiet hours arrive silent', async () => {
  const device = browser();
  assert.equal((await subscribe(req({ headers: pager.auth, body: device }), ctx)).status, 200);
  const saved = await saveSettings(req({ headers: pager.auth, body: { pushOff: ['social', 'nonsense'] } }), ctx);
  assert.equal(saved.status, 400, 'only real categories');
  assert.equal((await saveSettings(req({ headers: pager.auth, body: { pushOff: ['social'] } }), ctx)).status, 200);

  sent = [];
  await notify(repository, [pager.id], { kind: 'post_reacted', title: 'Somebody reacted', body: '', link: '/' });
  assert.equal(sent.length, 0, 'not on the phone');
  assert.ok((await bell(pager)).notifications.some((row) => row.title === 'Somebody reacted'), 'still in the bell');
  await notify(repository, [pager.id], { kind: 'message', title: 'A message', body: '', link: '/' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.silent, undefined);

  // A time zone where it is the middle of the night right now.
  const night = Array.from({ length: 25 }, (_, index) => index - 12)
    .map((offset) => `Etc/GMT${offset >= 0 ? '+' : '-'}${Math.abs(offset)}`)
    .find((zone) => inQuietHours(new Date(), zone));
  assert.ok(night);
  const quiet = await saveSettings(req({ headers: pager.auth, body: { quietHours: true, timeZone: night } }), ctx);
  assert.equal(quiet.status, 200);
  assert.deepEqual(quiet.jsonBody.prefs, { pushOff: ['social'], quietHours: true, timeZone: night });
  assert.deepEqual((await settings(req({ headers: pager.auth }), ctx)).jsonBody.prefs, quiet.jsonBody.prefs);
  sent = [];
  await notify(repository, [pager.id], { kind: 'message', title: 'Late message', body: '', link: '/' });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].message.silent, true);
});

await check('a folded notice replaces its line on the lock screen', async () => {
  sent = [];
  const group = { key: 'msg:test', actor: 'Sana', title: ({ count }) => `Sana sent you ${count} messages` };
  await notify(repository, [pager.id], { kind: 'message', title: 'Sana messaged you', body: 'one', link: '/m', group });
  await notify(repository, [pager.id], { kind: 'message', title: 'Sana messaged you', body: 'two', link: '/m', group });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].message.title, 'Sana sent you 2 messages');
  assert.ok(sent[0].message.tag && sent[0].message.tag === sent[1].message.tag, 'same tag, so it replaces');
});

console.log(`\n${passed} notification checks passed`);
