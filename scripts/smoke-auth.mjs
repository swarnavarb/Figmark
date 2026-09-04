/**
 * Smoke test for the auth seam and the in-memory repository.
 *
 * Runs against the compiled API (`npm run build:api` first). It covers the
 * behaviours the rest of the app will depend on: sign-in, role checks,
 * revocation, and that credentials never leave the API.
 */
import assert from 'node:assert/strict';

const base = new URL('../api/dist/', import.meta.url);
const { MemoryRepository } = await import(new URL('api/src/data/memory-repository.js', base));
const { MockAuthProvider } = await import(new URL('api/src/auth/mock-provider.js', base));
const { AuthError } = await import(new URL('api/src/auth/errors.js', base));
const { DEMO_PASSWORD } = await import(new URL('api/src/data/seed.js', base));

/** Minimal stand-in for the runtime's HttpRequest: handlers only read headers. */
const requestWith = (headers = {}) => ({ headers: new Headers(headers) });

const repository = new MemoryRepository();
await repository.init();
const auth = new MockAuthProvider(repository, 'test-secret', 3600);

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const expectAuthError = async (name, code, fn) => {
  await check(name, async () => {
    try {
      await fn();
      assert.fail(`expected ${code}, but the call succeeded`);
    } catch (err) {
      assert.ok(err instanceof AuthError, `expected AuthError, got ${err}`);
      assert.equal(err.code, code);
    }
  });
};

console.log('auth seam');

const session = await auth.login({ username: 'kaiju', password: DEMO_PASSWORD });

await check('signs in a seeded seller with a role and a token', () => {
  assert.equal(session.user.role, 'seller');
  assert.ok(session.token.includes('.'));
  assert.ok(Date.parse(session.expiresAt) > Date.now());
});

await check('login response carries no credential material', () => {
  assert.ok(!('passwordHash' in session.user), 'passwordHash must never cross the wire');
  assert.equal(JSON.stringify(session).includes(DEMO_PASSWORD), false);
});

await check('username lookup is case-insensitive', async () => {
  const upper = await auth.login({ username: 'KAIJU', password: DEMO_PASSWORD });
  assert.equal(upper.user.id, session.user.id);
});

await expectAuthError('rejects a wrong password', 'invalid_credentials', () =>
  auth.login({ username: 'kaiju', password: 'wrong' }),
);

await expectAuthError('rejects an unknown user', 'invalid_credentials', () =>
  auth.login({ username: 'nobody', password: DEMO_PASSWORD }),
);

const bearer = requestWith({ authorization: `Bearer ${session.token}` });

await check('resolves the current user from a bearer token', async () => {
  const user = await auth.getCurrentUser(bearer);
  assert.equal(user.username, 'kaiju');
});

await check('resolves the current user from the session cookie', async () => {
  const user = await auth.getCurrentUser(
    requestWith({ cookie: `other=x; figmark_session=${session.token}` }),
  );
  assert.equal(user.username, 'kaiju');
});

await check('returns null for an anonymous request', async () => {
  assert.equal(await auth.getCurrentUser(requestWith()), null);
});

await check('rejects a tampered token', async () => {
  const [payload] = session.token.split('.');
  assert.equal(await auth.getCurrentUser(requestWith({ authorization: `Bearer ${payload}.bad` })), null);
});

await check('accepts a matching role', async () => {
  const user = await auth.requireRole(bearer, ['seller', 'admin']);
  assert.equal(user.role, 'seller');
});

await expectAuthError('refuses a non-matching role', 'forbidden', () =>
  auth.requireRole(bearer, ['admin']),
);

await expectAuthError('refuses an anonymous request', 'unauthenticated', () =>
  auth.requireAuth(requestWith()),
);

await check('logout revokes the token', async () => {
  await auth.logout(bearer);
  assert.equal(await auth.getCurrentUser(bearer), null);
});

console.log('\ndata layer');

await check('lists lots newest first', async () => {
  const lots = await repository.listLots();
  assert.equal(lots.length, 2);
  assert.equal(lots[0].id, 'lot_gz_sep');
});

await check('scopes a lot read to its seller partition', async () => {
  assert.ok(await repository.getLot('usr_seller_kaiju', 'lot_gz_sep'));
  assert.equal(await repository.getLot('usr_buyer_ravi', 'lot_gz_sep'), null);
});

await check('builds a lot manifest', async () => {
  const orders = await repository.listOrdersForLot('lot_gz_sep');
  assert.equal(orders.length, 2);
  assert.equal(orders.reduce((sum, o) => sum + o.quantity, 0), 3);
});

console.log(`\n${passed} checks passed`);
