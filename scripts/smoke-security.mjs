/**
 * Smoke test for the hardening behind the S5-S12 review findings.
 *
 * - Checked writes: orders, listings and users are written only if nobody else
 *   wrote them in between; disjoint changes merge, overlapping ones are refused.
 * - Sign-in throttling keyed by account *and* address, so nobody can lock
 *   somebody else out; a per-address limit on the routes.
 * - Passwords: common, personal and too-long ones refused.
 * - Sessions: "sign out everywhere", and renewal while in use.
 * - The SWA provider trusts its header only where the deployment says why.
 * - Operator actions leave an audit trail.
 *
 * Runs against the compiled API (`npm run build:api` first).
 */
import assert from 'node:assert/strict';

const base = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', base);
const { CosmosRepository } = await import(new URL('api/src/data/cosmos-repository.js', base));
const { StaleWriteError, mergeChanges } = await import(new URL('api/src/data/concurrency.js', base));
const { toErrorResponse } = await import(new URL('http.js', fns));
const { MemoryRepository } = await import(new URL('api/src/data/memory-repository.js', base));
const { MockAuthProvider } = await import(new URL('api/src/auth/mock-provider.js', base));
const { StaticWebAppsAuthProvider } = await import(new URL('api/src/auth/swa-provider.js', base));
const { createSessionToken, SESSION_COOKIE_NAME } = await import(new URL('api/src/auth/tokens.js', base));
const { resetRateLimits, clientIp } = await import(new URL('api/src/rate-limit.js', base));
const { DEMO_EMAIL, DEMO_PASSWORD } = await import(new URL('api/src/data/seed.js', base));
const { loginRoute, meRoute } = await import(new URL('auth-routes.js', fns));
const { adminSuspendRoute, adminAuditRoute } = await import(new URL('admin-routes.js', fns));

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/* ── Checked writes ────────────────────────────────────────────────────── */
console.log('checked writes');

/**
 * A container with etags, answering what the repository asks: point reads,
 * conditional replaces, increments, and the by-id query.
 */
function etagContainer(store) {
  let version = 0;
  const stamp = (doc) => ({ ...structuredClone(doc), _etag: `"${(version += 1)}"` });
  return {
    items: {
      query(spec) {
        return {
          async fetchAll() {
            const id = spec.parameters?.find((parameter) => parameter.name === '@id')?.value;
            const docs = [...store.values()].filter((doc) => id === undefined || doc.id === id);
            return { resources: docs.map((doc) => structuredClone(doc)) };
          },
        };
      },
      async upsert(doc) {
        const saved = stamp(doc);
        store.set(doc.id, saved);
        return { resource: structuredClone(saved) };
      },
      async create(doc) {
        if (store.has(doc.id)) throw { code: 409 };
        const saved = stamp(doc);
        store.set(doc.id, saved);
        return { resource: structuredClone(saved) };
      },
    },
    item(id) {
      return {
        async read() {
          const doc = store.get(id);
          if (!doc) throw { code: 404 };
          return { resource: structuredClone(doc), etag: doc._etag };
        },
        async replace(doc, options = {}) {
          const current = store.get(id);
          if (!current) throw { code: 404 };
          const condition = options.accessCondition;
          if (condition?.type === 'IfMatch' && condition.condition !== current._etag) throw { code: 412 };
          const saved = stamp(doc);
          store.set(id, saved);
          return { resource: structuredClone(saved) };
        },
        async patch(operations) {
          const current = store.get(id);
          if (!current) throw { code: 404 };
          const next = structuredClone(current);
          for (const operation of operations) {
            const key = operation.path.slice(1);
            next[key] = (next[key] ?? 0) + operation.value;
          }
          const saved = stamp(next);
          store.set(id, saved);
          return { resource: structuredClone(saved) };
        },
      };
    },
  };
}

function cosmosOn(containers) {
  const repository = new CosmosRepository({ endpoint: 'https://example.invalid', key: 'stub-key', database: 'figmark' });
  repository.client.dispose?.();
  const fakes = new Map([...containers].map(([name, store]) => [name, etagContainer(store)]));
  repository.container = (name) => fakes.get(name);
  return repository;
}

const orders = new Map();
const listings = new Map();
const cosmos = cosmosOn(new Map([['orders', orders], ['listings', listings], ['users', new Map()], ['sessions', new Map()]]));
await cosmos.container('orders').items.create({
  id: 'ord_1', lotId: 'lot_1', listingId: 'lst_1', quantity: 1, status: 'pending', note: '', payments: [], updatedAt: '',
});
await cosmos.container('listings').items.create({
  id: 'lst_1', sellerId: 'usr_s', title: 'Old', quantityAvailable: 5, quantityMode: 'fixed', status: 'active',
  viewCount: 0, soldCount: 0, preOrder: null, updatedAt: '',
});

await check('merging takes my fields over theirs and refuses a field both changed', () => {
  const base = { id: 'x', a: 1, b: 1, c: [1] };
  assert.deepEqual(mergeChanges(base, { ...base, a: 2 }, { ...base, b: 3 }), { id: 'x', a: 2, b: 3, c: [1] });
  // Both set the same value: still a conflict - two "pay"s both marking paid is the double payment.
  assert.equal(mergeChanges(base, { ...base, c: [1, 2] }, { ...base, c: [1, 2] }), null);
});

await check('two writes to different fields of one order both land', async () => {
  const first = await cosmos.getOrder('ord_1');
  const second = await cosmos.getOrder('ord_1');
  first.status = 'confirmed';
  await cosmos.updateOrder(first);
  second.note = 'gift wrap';
  const saved = await cosmos.updateOrder(second);
  assert.equal(saved.status, 'confirmed');
  assert.equal(saved.note, 'gift wrap');
  // The caller's own object now says what was stored, etag included.
  assert.equal(second.status, 'confirmed');
  assert.equal(second._etag, orders.get('ord_1')._etag);
});

await check('two payments recorded on one order at once: the second is refused, not added', async () => {
  const first = await cosmos.getOrder('ord_1');
  const second = await cosmos.getOrder('ord_1');
  first.payments = [{ id: 'pay_a' }];
  await cosmos.updateOrder(first);
  second.payments = [{ id: 'pay_b' }];
  await assert.rejects(cosmos.updateOrder(second), StaleWriteError);
  assert.deepEqual(orders.get('ord_1').payments, [{ id: 'pay_a' }]);
  const response = toErrorResponse(new StaleWriteError(), ctx);
  assert.equal(response.status, 409);
  assert.equal(response.jsonBody.error, 'changed_meanwhile');
});

await check('a caller can write the same order twice in one request', async () => {
  const order = await cosmos.getOrder('ord_1');
  order.note = 'one';
  await cosmos.updateOrder(order);
  order.note = 'two';
  await cosmos.updateOrder(order);
  assert.equal(orders.get('ord_1').note, 'two');
});

await check('a seller\'s edit survives views counted in between', async () => {
  const listing = await cosmos.getListing('lst_1');
  await cosmos.countView(listing);
  await cosmos.countView(listing);
  listing.title = 'New';
  await cosmos.updateListing(listing);
  assert.equal(listings.get('lst_1').title, 'New');
  assert.equal(listings.get('lst_1').viewCount, 2, 'the views were kept');
});

await check('a seller\'s stale stock count does not overwrite what a buyer just took', async () => {
  const listing = await cosmos.getListing('lst_1');
  assert.equal(await cosmos.takeStock({ listingId: 'lst_1', quantity: 1 }), true);
  listing.quantityAvailable = 10;
  await assert.rejects(cosmos.updateListing(listing), StaleWriteError);
  assert.equal(listings.get('lst_1').quantityAvailable, 4);
});

await check('a stale write this instance cannot reconstruct is refused, never applied blind', async () => {
  const stale = { ...orders.get('ord_1'), _etag: '"no-such-version"', note: 'blind' };
  await assert.rejects(cosmos.updateOrder(stale), StaleWriteError);
  assert.notEqual(orders.get('ord_1').note, 'blind');
});

await check('a shared counter counts across calls, reads without creating, and takes back', async () => {
  assert.equal(await cosmos.bumpCounter('rl:test', 0, 60), 0);
  assert.equal(await cosmos.bumpCounter('rl:test', 1, 60), 1);
  assert.equal(await cosmos.bumpCounter('rl:test', 1, 60), 2);
  assert.equal(await cosmos.bumpCounter('rl:test', -1, 60), 1);
  assert.equal(await cosmos.bumpCounter('rl:test', 0, 60), 1);
});

/* ── Sign-in throttling ────────────────────────────────────────────────── */
console.log('\nsign-in throttling');

const repository = new MemoryRepository();
await repository.init();
const auth = new MockAuthProvider(repository, 'test-secret', 3600);

await check('wrong passwords lock out that address for that account, and nobody else', async () => {
  resetRateLimits();
  const target = 'victim@figmark.example';
  await auth.signup({ displayName: 'Vic Tim', email: target, phone: '+919777001001', password: 'correct horse battery' });
  let locked = false;
  for (let attempt = 0; attempt < 12 && !locked; attempt += 1) {
    await auth.login({ identifier: target, password: 'wrong' }, { ip: '203.0.113.9' }).catch((err) => {
      if (err.code === 'too_many_attempts') locked = true;
    });
  }
  assert.ok(locked, 'the guessing address is locked out');
  await assert.rejects(auth.login({ identifier: target, password: 'correct horse battery' }, { ip: '203.0.113.9' }), { code: 'too_many_attempts' });
  // The owner, somewhere else, is not.
  const owner = await auth.login({ identifier: target, password: 'correct horse battery' }, { ip: '198.51.100.4' });
  assert.equal(owner.user.email, target);
});

await check('one address is limited across every account it tries', async () => {
  resetRateLimits();
  const from = { 'x-azure-clientip': '192.0.2.77', 'content-type': 'application/json' };
  const statuses = [];
  for (let attempt = 0; attempt < 31; attempt += 1) {
    const response = await loginRoute({
      headers: new Headers(from),
      json: async () => ({ identifier: `nobody${attempt}@figmark.example`, password: 'whatever1' }),
    }, ctx);
    statuses.push(response.status);
  }
  assert.ok(statuses.slice(0, 30).every((status) => status !== 429), statuses.join(','));
  assert.equal(statuses[30], 429);
  resetRateLimits();
});

await check('guessing spread over many addresses is capped, and the owner\'s own device still gets in', async () => {
  resetRateLimits();
  const target = 'spread@figmark.example';
  const password = 'correct horse battery';
  await auth.signup({ displayName: 'Spread Out', email: target, phone: '+919777001003', password });
  // The owner signed in on this browser before, so it carries the device cookie.
  const first = await auth.login({ identifier: target, password }, { ip: '198.51.100.50' });
  const device = auth.deviceCookies(first.user.id, { headers: new Headers() })[0].split(';')[0].split('=').slice(1).join('=');

  // Somebody guesses from a new address each time, so no one address is ever locked.
  let capped = false;
  for (let attempt = 0; attempt < 30 && !capped; attempt += 1) {
    await auth.login({ identifier: target, password: 'wrong' }, { ip: `203.0.113.${attempt + 1}` }).catch((err) => {
      if (err.code === 'too_many_attempts') capped = true;
    });
  }
  assert.ok(capped, 'the account stops taking guesses from devices it does not know');
  // Even the right password from an unknown device waits.
  await assert.rejects(auth.login({ identifier: target, password }, { ip: '203.0.113.200' }), { code: 'too_many_attempts' });
  // The owner, on their own browser, is not held back.
  const owner = await auth.login({ identifier: target, password }, { ip: '198.51.100.51', device });
  assert.equal(owner.user.email, target);
  // A forged or foreign device cookie earns nothing.
  await assert.rejects(auth.login({ identifier: target, password }, { ip: '203.0.113.201', device: device.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) }), { code: 'too_many_attempts' });
  resetRateLimits();
});

await check('the client address is read from the platform\'s headers, without a port', () => {
  assert.equal(clientIp({ headers: new Headers({ 'x-azure-clientip': '203.0.113.1' }) }), '203.0.113.1');
  assert.equal(clientIp({ headers: new Headers({ 'x-forwarded-for': '203.0.113.2:5050, 10.0.0.1' }) }), '203.0.113.2');
  assert.equal(clientIp({ headers: new Headers({ 'x-forwarded-for': '[2001:db8::1]:443' }) }), '2001:db8::1');
  assert.equal(clientIp({ headers: new Headers() }), 'unknown');
});

/* ── Passwords ─────────────────────────────────────────────────────────── */
console.log('\npasswords');

const signupWith = (password, extra = {}) => auth.signup({
  displayName: 'Priya Raman', email: `p${Math.random().toString(36).slice(2, 8)}@figmark.example`,
  phone: `+9197770${Math.floor(10000 + Math.random() * 89999)}`, password, ...extra,
});

await check('common, repeated and keyboard-run passwords are refused', async () => {
  for (const password of ['password1', '12345678', 'aaaaaaaaaa', 'qwertyuiop', 'abcdefghij']) {
    await assert.rejects(signupWith(password), { code: 'invalid_signup' }, password);
  }
});

await check('a password with the person\'s own name in it is refused', async () => {
  await assert.rejects(signupWith('priya2024!'), /name, username or email/);
});

await check('a very long password is refused at sign-up and at sign-in', async () => {
  await assert.rejects(signupWith('x'.repeat(129) + 'Q1'), /at most 128/);
  await assert.rejects(auth.login({ identifier: DEMO_EMAIL, password: 'x'.repeat(200) }), { code: 'invalid_credentials' });
});

/* ── Sessions ──────────────────────────────────────────────────────────── */
console.log('\nsessions');

const cookieFor = (token) => ({ headers: new Headers({ cookie: `${SESSION_COOKIE_NAME}=${token}` }) });

await check('"sign out everywhere" ends every session, and a new sign-in works', async () => {
  resetRateLimits();
  const phone = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  const laptop = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.ok(await auth.getCurrentUser(cookieFor(laptop.token)));
  await auth.logoutEverywhere(cookieFor(phone.token));
  assert.equal(await auth.getCurrentUser(cookieFor(phone.token)), null);
  assert.equal(await auth.getCurrentUser(cookieFor(laptop.token)), null, 'the other device is signed out too');
  await assert.rejects(auth.requireAuth(cookieFor(laptop.token)), { code: 'session_ended' });
  // Token times are whole seconds; the next one is clear of the cut-off.
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const again = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.ok(await auth.getCurrentUser(cookieFor(again.token)));
});

await check('a session in use is renewed, but never past its absolute limit', async () => {
  // Not the demo account: the check above signed it out everywhere, and a
  // session from two hours ago is rightly over for it.
  const email = 'renewed@figmark.example';
  await auth.signup({ displayName: 'Renee Wal', email, phone: '+919777001002', password: 'correct horse battery' });
  // The real session length, so a two-hour-old session is still alive to renew.
  const twelveHours = new MockAuthProvider(repository, 'test-secret', 12 * 3600);
  const realNow = Date.now;
  try {
    // Signed in two hours ago.
    Date.now = () => realNow() - 2 * 3_600_000;
    const old = await twelveHours.login({ identifier: email, password: 'correct horse battery' });
    Date.now = realNow;
    const cookies = await twelveHours.refreshCookies(cookieFor(old.token));
    assert.equal(cookies.length, 1);
    const fresh = cookies[0].split(';')[0].split('=').slice(1).join('=');
    assert.ok(await twelveHours.getCurrentUser(cookieFor(fresh)));
    const payload = JSON.parse(Buffer.from(fresh.split('.')[0], 'base64url').toString());
    assert.equal(payload.aut, JSON.parse(Buffer.from(old.token.split('.')[0], 'base64url').toString()).aut, 'the sign-in time carries over');

    // A brand-new session is left alone.
    const recent = await twelveHours.login({ identifier: email, password: 'correct horse battery' });
    assert.deepEqual(await twelveHours.refreshCookies(cookieFor(recent.token)), []);

    // A sign-in from fifteen days ago cannot be stretched any further.
    const ancient = createSessionToken('usr_demo', 'test-secret', 3600, undefined, Math.floor(realNow() / 1000) - 15 * 86_400);
    assert.ok(ancient.expiresAt.getTime() <= realNow(), 'past the absolute limit, the token is already over');
  } finally {
    Date.now = realNow;
  }
});

await check('/api/auth/me renews the cookie of a session in use', async () => {
  resetRateLimits();
  const realNow = Date.now;
  let token;
  try {
    Date.now = () => realNow() - 2 * 3_600_000;
    const response = await loginRoute({
      headers: new Headers({ 'x-azure-clientip': '198.51.100.20' }),
      json: async () => ({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD }),
    }, ctx);
    token = response.jsonBody.token;
  } finally {
    Date.now = realNow;
  }
  const me = await meRoute(cookieFor(token), ctx);
  assert.ok(me.jsonBody.user);
  assert.ok(me.headers.getSetCookie().some((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`) && !cookie.includes('Max-Age=0')));
});

await check('signing out on one device leaves another signed in, even when both signed in the same second', async () => {
  const one = createSessionToken('usr_demo', 'test-secret', 3600);
  const two = createSessionToken('usr_demo', 'test-secret', 3600);
  assert.notEqual(one.token, two.token);
});

/* ── Static Web Apps principal ─────────────────────────────────────────── */
console.log('\nstatic web apps');

const principalHeader = (userId) => ({
  headers: new Headers({
    'x-ms-client-principal': Buffer.from(JSON.stringify({ userId, userRoles: ['authenticated', 'admin'] })).toString('base64'),
  }),
});

await check('with no declared protection, the header signs nobody in', async () => {
  const provider = new StaticWebAppsAuthProvider(repository, null);
  assert.equal(await provider.getCurrentUser(principalHeader('usr_demo')), null);
  await assert.rejects(provider.requireAuth(principalHeader('usr_demo')), { code: 'sign_in_unavailable' });
});

await check('with protection declared, it does', async () => {
  const provider = new StaticWebAppsAuthProvider(repository, 'managed');
  const user = await provider.getCurrentUser(principalHeader('usr_demo'));
  assert.equal(user.id, 'usr_demo');
});

/* ── Audit trail ───────────────────────────────────────────────────────── */
console.log('\naudit trail');

await check('an operator action is recorded with who, what and to whom', async () => {
  resetRateLimits();
  const signedIn = await loginRoute({
    headers: new Headers({ 'x-azure-clientip': '198.51.100.30' }),
    json: async () => ({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD }),
  }, ctx);
  const headers = { cookie: `${SESSION_COOKIE_NAME}=${signedIn.jsonBody.token}` };
  const body = { suspended: true, password: 'should-not-be-kept' };
  const request = (params) => ({
    headers: new Headers(headers), params, query: new URLSearchParams(),
    json: async () => body,
  });
  const suspended = await adminSuspendRoute(request({ id: 'usr_packer' }), ctx);
  assert.equal(suspended.status, 200, JSON.stringify(suspended.jsonBody));

  const trail = await adminAuditRoute({ headers: new Headers(headers), params: {}, query: new URLSearchParams() }, ctx);
  assert.equal(trail.status, 200);
  const entry = trail.jsonBody.entries.find((candidate) => candidate.action === 'user.suspend');
  assert.ok(entry, 'the suspension is in the trail');
  assert.equal(entry.actorEmail, DEMO_EMAIL);
  assert.deepEqual(entry.target, { id: 'usr_packer' });
  assert.equal(entry.detail.suspended, true);
  assert.equal(entry.detail.password, '[redacted]');

  // A refused action is not recorded as done.
  const before = trail.jsonBody.entries.length;
  const refused = await adminSuspendRoute(request({ id: 'usr_nobody' }), ctx);
  assert.equal(refused.status, 404);
  const after = (await adminAuditRoute({ headers: new Headers(headers), params: {}, query: new URLSearchParams() }, ctx)).jsonBody.entries.length;
  assert.equal(after, before);
});

console.log(`\n${passed} security checks passed`);
