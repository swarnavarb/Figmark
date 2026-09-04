/**
 * Smoke test for the auth seam and the in-memory repository.
 *
 * Runs against the compiled API (`npm run build:api` first). Covers the
 * behaviours the rest of the app depends on: sign-in, capabilities, ownership,
 * revocation, and that credentials never leave the API.
 */
import assert from 'node:assert/strict';

const base = new URL('../api/dist/', import.meta.url);
const { MemoryRepository } = await import(new URL('api/src/data/memory-repository.js', base));
const { MockAuthProvider } = await import(new URL('api/src/auth/mock-provider.js', base));
const { AuthError } = await import(new URL('api/src/auth/errors.js', base));
const { DEMO_EMAIL, DEMO_PHONE, DEMO_PASSWORD } = await import(new URL('api/src/data/seed.js', base));

/** Minimal stand-in for HttpRequest: handlers only read headers. */
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

console.log('sign-in');

const session = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });

await check('signs in the demo account by email', () => {
  assert.equal(session.user.displayName, 'Arjun Mehta');
  assert.ok(session.token.includes('.'));
  assert.ok(Date.parse(session.expiresAt) > Date.now());
});

await check('signs in by phone, resolving the same account', async () => {
  const byPhone = await auth.login({ identifier: DEMO_PHONE, password: DEMO_PASSWORD });
  assert.equal(byPhone.user.id, session.user.id);
});

await check('identifier matching ignores case and phone punctuation', async () => {
  for (const variant of [DEMO_EMAIL.toUpperCase(), ' +91 98123 45678 ']) {
    const result = await auth.login({ identifier: variant, password: DEMO_PASSWORD });
    assert.equal(result.user.id, session.user.id, `failed for ${variant}`);
  }
});

await check('exactly one account can sign in', async () => {
  const accounts = repository.listDemoAccounts();
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].identifier, DEMO_EMAIL);
});

await check('catalog sellers and forwarders cannot be signed into', async () => {
  // They exist as data so the marketplace has content, but hold no credential.
  for (const id of ['usr_kaiju', 'usr_fwd_lotus']) {
    const user = await repository.getUserById(id);
    assert.ok(user, `${id} should exist`);
    assert.equal(user.passwordHash, null, `${id} must not be signable-into`);
  }
});

await check('login response carries no credential material', () => {
  assert.ok(!('passwordHash' in session.user));
  assert.equal(JSON.stringify(session).includes(DEMO_PASSWORD), false);
});

await expectAuthError('rejects a wrong password', 'invalid_credentials', () =>
  auth.login({ identifier: DEMO_EMAIL, password: 'wrong' }),
);
await expectAuthError('rejects an unknown identifier', 'invalid_credentials', () =>
  auth.login({ identifier: 'nobody@nowhere.example', password: DEMO_PASSWORD }),
);

console.log('\ncapabilities');

await check('the demo account can both buy and sell', () => {
  assert.deepEqual(session.user.capabilities, {
    canBuy: true, canSell: true, canForward: false, isAdmin: false,
  });
});

await check('buyer and seller trust are separate numbers', () => {
  assert.notEqual(session.user.buyerTrust.score, session.user.sellerTrust.score);
  assert.ok(!('trust' in session.user), 'the single combined trust score is gone');
});

await check('forwarding is gated on a forwarder profile', async () => {
  const forwarder = await repository.getUserById('usr_fwd_lotus');
  assert.ok(forwarder.forwarderProfile);
  assert.equal(forwarder.forwarderProfile.routes.length, 2);
  assert.equal(session.user.forwarderProfile, null);
});

const bearer = requestWith({ authorization: `Bearer ${session.token}` });

await check('resolves the current user from a bearer token', async () => {
  assert.equal((await auth.getCurrentUser(bearer)).id, 'usr_demo');
});

await check('resolves the current user from the session cookie', async () => {
  const user = await auth.getCurrentUser(requestWith({ cookie: `x=1; figmark_session=${session.token}` }));
  assert.equal(user.id, 'usr_demo');
});

await check('returns null for an anonymous request', async () => {
  assert.equal(await auth.getCurrentUser(requestWith()), null);
});

await check('rejects a tampered token', async () => {
  const [payload] = session.token.split('.');
  assert.equal(await auth.getCurrentUser(requestWith({ authorization: `Bearer ${payload}.bad` })), null);
});

await check('accepts a held capability', async () => {
  assert.equal((await auth.requireCapability(bearer, ['sell'])).id, 'usr_demo');
});

await expectAuthError('refuses a capability not held', 'forbidden', () =>
  auth.requireCapability(bearer, ['admin']),
);
await expectAuthError('refuses an anonymous request', 'unauthenticated', () =>
  auth.requireAuth(requestWith()),
);

console.log('\nsign-up');

await check('creates an account and reserves both identifiers', async () => {
  const created = await auth.signup({
    displayName: 'Priya N.', email: 'priya@figmark.example', phone: '+919777000111', password: 'longenough1',
  });
  assert.equal(created.user.sellerProfile, null);
  assert.equal(created.user.capabilities.canSell, true);
  // Both identifiers must now resolve to the new account.
  for (const id of ['priya@figmark.example', '+919777000111']) {
    assert.equal((await repository.getUserByIdentifier(id)).id, created.user.id);
  }
});

await expectAuthError('refuses a duplicate identifier', 'identifier_taken', () =>
  auth.signup({ displayName: 'Clone', email: DEMO_EMAIL, phone: '+919777000222', password: 'longenough1' }),
);
await expectAuthError('refuses a short password', 'invalid_signup', () =>
  auth.signup({ displayName: 'X', email: 'x@figmark.example', phone: '+919777000333', password: 'short' }),
);

console.log('\ndata layer');

await check('search matches title, tags and description', async () => {
  assert.equal((await repository.listListings({ search: 'sneaker' })).length, 2);
  assert.equal((await repository.listListings({ search: 'deadstock' })).length, 1);
  assert.equal((await repository.listListings({ search: 'nothingmatchesthis' })).length, 0);
});

await check('the demo account owns listings and purchases', async () => {
  assert.ok((await repository.listListings({ sellerId: 'usr_demo' })).length >= 2);
  assert.equal((await repository.listOrdersForBuyer('usr_demo')).length, 3);
});

await check('bump is rate-limited after the first use', async () => {
  assert.equal(await repository.bumpListing('usr_demo', 'lst_my_statue'), true);
  assert.equal(await repository.bumpListing('usr_demo', 'lst_my_statue'), false);
});

await check('lot manifests stay scoped to their seller partition', async () => {
  assert.ok(await repository.getLot('usr_kaiju', 'lot_gz_sep'));
  assert.equal(await repository.getLot('usr_demo', 'lot_gz_sep'), null);
});

await check('logout revokes the token', async () => {
  await auth.logout(bearer);
  assert.equal(await auth.getCurrentUser(bearer), null);
});

console.log(`\n${passed} checks passed`);
