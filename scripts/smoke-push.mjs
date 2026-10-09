/**
 * Smoke test for lock-screen notifications (Web Push).
 *
 * The push services themselves are swapped for a recorder, so this checks
 * what is sent, to whom and when - every event that reaches the bell, held
 * ones only once they can no longer be undone, never to whoever caused it,
 * and never to a device somebody else signed in on afterwards. Run
 * `npm run build:api` first.
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
const { signupRoute: signup, meRoute: me } = await import(new URL('auth-routes.js', fns));
const { pushKeyRoute: pushKey, pushSubscribeRoute: subscribe, pushUnsubscribeRoute: unsubscribe, pushTestRoute: pushTest } =
  await import(new URL('push-routes.js', fns));
const { notify } = await import(new URL('notify.js', fns));
const { withdrawNotices } = await import(new URL('undo.js', fns));
const { setPushTransport, sendHeldPushes } = await import(new URL('../push.js', fns));
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
const repository = await getRepository();

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(),
  params: {},
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});

/** Every push "sent", and which endpoints the fake service calls gone. */
let sent = [];
const gone = new Set();
setPushTransport(async (endpoint, message) => {
  if (gone.has(endpoint.endpoint)) return { delivered: false, gone: true };
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

/** A browser's subscription, with real-shaped keys. */
function browser(host = 'fcm.googleapis.com') {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://${host}/fcm/send/${randomBytes(12).toString('hex')}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

async function person(name, phone) {
  const made = await signup(req({
    body: { displayName: name, email: `${name.toLowerCase()}@push.example`, phone, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, auth: { authorization: `Bearer ${made.jsonBody.token}` } };
}

const asha = await person('Asha', '+919000071001');
const ravi = await person('Ravi', '+919000071002');
const phone = browser();
const laptop = browser('updates.push.services.mozilla.com');

const draft = { kind: 'want_answered', title: 'Your want was answered', body: 'Twenty HGs on the next run.', link: '/?view=wanted' };

await check('the site hands out the public key', async () => {
  const response = await pushKey(req(), ctx);
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.publicKey, keys.publicKey);
});

await check('only a real push service is accepted as a device', async () => {
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example/x', 'https://169.254.169.254/x', 'nope']) {
    const refused = await subscribe(req({ headers: asha.auth, body: { ...phone, endpoint } }), ctx);
    assert.equal(refused.status, 400, endpoint);
  }
  const noKeys = await subscribe(req({ headers: asha.auth, body: { endpoint: phone.endpoint } }), ctx);
  assert.equal(noKeys.status, 400);
  const anonymous = await subscribe(req({ body: phone }), ctx);
  assert.equal(anonymous.status, 401);
});

await check('turning it on keeps the device on the account', async () => {
  const on = await subscribe(req({ headers: asha.auth, body: phone }), ctx);
  assert.equal(on.status, 200);
  const again = await subscribe(req({ headers: asha.auth, body: phone }), ctx);
  assert.equal(again.jsonBody.devices, 1, 'the same device twice is one device');
  const both = await subscribe(req({ headers: asha.auth, body: laptop }), ctx);
  assert.equal(both.jsonBody.devices, 2);
});

await check('the devices never leave the server', async () => {
  const mine = await me(req({ headers: asha.auth }), ctx);
  assert.equal(mine.status, 200);
  assert.ok(!JSON.stringify(mine.jsonBody).includes(phone.endpoint), 'an endpoint is enough to message somebody');
});

await check('a notice goes to every device of the person it is for', async () => {
  await notify(repository, [asha.id], draft);
  assert.deepEqual(sent.map((entry) => entry.endpoint).sort(), [phone.endpoint, laptop.endpoint].sort());
  const { message } = sent[0];
  assert.equal(message.title, draft.title);
  assert.equal(message.body, draft.body);
  assert.equal(message.link, draft.link, 'tapping it has to go somewhere');
  assert.equal(message.unread, 1, 'the badge counts what is unread');
  const [row] = await repository.listNotifications(asha.id, 1);
  assert.equal(message.id, row.id);
  assert.ok(row.pushedAt, 'marked sent, so the clock never sends it again');
});

await check('nobody is pushed about their own action', async () => {
  await notify(repository, [asha.id, ravi.id], draft, { except: asha.id });
  assert.equal(sent.length, 0, 'Asha caused it, and Ravi has no devices');
});

await check('a held notice waits for its hold to end', async () => {
  const until = new Date(Date.now() + 60_000).toISOString();
  await notify(repository, [asha.id], draft, { notBefore: until, undoId: 'und_pushheld01' });
  assert.equal(sent.length, 0, 'the step can still be undone');
  assert.equal(await sendHeldPushes(repository), 0, 'not before its time');

  assert.equal(await sendHeldPushes(repository, Date.now() + 61_000), 1);
  assert.equal(sent.length, 2, 'both devices, once the hold is over');
  assert.equal(await sendHeldPushes(repository, Date.now() + 62_000), 0, 'and only once');
});

await check('a held notice that was taken back is never pushed', async () => {
  const until = new Date(Date.now() + 60_000).toISOString();
  await notify(repository, [asha.id], draft, { notBefore: until, undoId: 'und_pushheld02' });
  await withdrawNotices(repository, [asha.id], 'und_pushheld02');
  assert.equal(await sendHeldPushes(repository, Date.now() + 61_000), 0);
  assert.equal(sent.length, 0, 'it was undone; the phone never hears of it');
});

await check('a held notice from long ago is not sent late', async () => {
  const stale = new Date(Date.now() - 60 * 60_000).toISOString();
  await repository.saveNotification({
    id: 'ntf_pushstale1', userId: asha.id, kind: 'lot_moved', title: 'Old', body: 'Old', link: '/',
    readAt: null, notBefore: stale, createdAt: stale, updatedAt: stale,
  });
  assert.equal(await sendHeldPushes(repository), 0);
  assert.equal(sent.length, 0, 'news about old news');
});

await check('a device the push service calls gone is forgotten', async () => {
  gone.add(laptop.endpoint);
  await notify(repository, [asha.id], draft);
  assert.deepEqual(sent.map((entry) => entry.endpoint), [phone.endpoint]);
  const user = await repository.getUserById(asha.id);
  assert.deepEqual(user.pushEndpoints.map((entry) => entry.endpoint), [phone.endpoint]);
  gone.clear();
});

await check('a browser belongs to whoever signed in on it last', async () => {
  const taken = await subscribe(req({ headers: ravi.auth, body: phone }), ctx);
  assert.equal(taken.status, 200);
  await notify(repository, [asha.id], draft);
  assert.equal(sent.length, 0, "Asha's news must not land on Ravi's screen");
  await notify(repository, [ravi.id], draft);
  assert.deepEqual(sent.map((entry) => entry.endpoint), [phone.endpoint]);
});

await check('turning it off stops it', async () => {
  const off = await unsubscribe(req({ headers: ravi.auth, body: { endpoint: phone.endpoint } }), ctx);
  assert.equal(off.status, 200);
  await notify(repository, [ravi.id], draft);
  assert.equal(sent.length, 0);
});

await check('a test notification reaches only my own devices', async () => {
  await subscribe(req({ headers: ravi.auth, body: laptop }), ctx);
  const tested = await pushTest(req({ headers: ravi.auth }), ctx);
  assert.equal(tested.status, 200);
  assert.equal(tested.jsonBody.sent, 1);
  assert.deepEqual(sent.map((entry) => entry.endpoint), [laptop.endpoint]);
  assert.equal(sent[0].message.title, 'Notifications are on');
  const bell = await repository.listNotifications(ravi.id, 40);
  assert.ok(!bell.some((row) => row.title === 'Notifications are on'), 'nothing happened, so nothing in the bell');
});

await check('the real sender accepts what it is given', async () => {
  // No network: this builds the encrypted request without sending it, which
  // is where a bad topic, key or option would be refused.
  const details = webpush.generateRequestDetails(phone, JSON.stringify({ id: 'ntf_abc123def456', title: 't', body: 'b', link: '/', unread: 1 }), {
    vapidDetails: { subject: 'mailto:support@figmark.in', publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: 86400, urgency: 'high', topic: 'ntf_abc123def456', timeout: 5000,
  });
  assert.equal(details.headers.Topic, 'ntf_abc123def456');
  assert.equal(details.headers['Content-Encoding'], 'aes128gcm');
  assert.match(details.headers.Authorization, /^vapid t=/);
});

await check('without keys the site never offers it', async () => {
  setPushTransport(null);
  delete process.env.WEB_PUSH_PUBLIC_KEY;
  delete process.env.WEB_PUSH_PRIVATE_KEY;
  assert.equal((await pushKey(req(), ctx)).jsonBody.publicKey, null);
  assert.equal((await subscribe(req({ headers: asha.auth, body: browser() }), ctx)).status, 409);
  await notify(repository, [ravi.id], draft);
  const [row] = await repository.listNotifications(ravi.id, 1);
  assert.equal(row.title, draft.title, 'the bell works exactly as before');
});

console.log(`${passed} checks passed`);
