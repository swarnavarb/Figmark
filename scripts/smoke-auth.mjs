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

await check('every advertised demo account actually signs in', async () => {
  // The hint on the sign-in page is only worth showing if it works: assert the
  // behaviour rather than the count, so adding a demo account cannot silently
  // advertise a login nobody can use.
  const accounts = repository.listDemoAccounts();
  assert.ok(accounts.length >= 1, 'at least one sign-in must be offered');
  assert.ok(
    accounts.some((account) => account.identifier === DEMO_EMAIL),
    'the demo account must be among them',
  );
  for (const account of accounts) {
    // The label carries the password after the last separator, which is what
    // the page's "fill credentials" button reads.
    const password = account.label.split('·').pop().trim();
    const result = await auth.login({ identifier: account.identifier, password });
    assert.ok(result.user.id, `${account.identifier} should sign in`);
  }
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
  const { canBuy, canSell, canForward } = session.user.capabilities;
  assert.deepEqual({ canBuy, canSell, canForward }, { canBuy: true, canSell: true, canForward: false });
});

await check('operating the marketplace comes from configuration, never from a row', async () => {
  // The right to delete accounts and hold other people's money must not be
  // something an account can acquire by signing up. On this throwaway store the
  // demo account is an operator by default — its password is published in this
  // repository, so admin over data that resets on restart grants nothing — but
  // a new account is not, and no write path can make it one.
  const made = await auth.signup({
    displayName: 'Ordinary Person', email: 'ordinary@figmark.example',
    phone: '+919000045451', password: 'longenough1',
  });
  assert.equal(made.user.capabilities.isAdmin, false);

  const stored = await repository.getUserById(made.user.id);
  assert.equal(stored.isAdmin, false, 'nothing writes the role onto the row either');
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

// `forward` rather than `admin`: on this throwaway store the demo account is a
// configured operator, so admin is no longer an example of something it lacks.
await expectAuthError('refuses a capability not held', 'forbidden', () =>
  auth.requireCapability(bearer, ['forward']),
);
// Each of these reaches the user as "logged out" and needs a different fix, so
// the refusal has to say which one it is rather than a blanket "unauthenticated".
await expectAuthError('a request with no session says none was sent', 'no_session', () =>
  auth.requireAuth(requestWith()),
);

await expectAuthError('a token it cannot verify says so', 'session_unverified', () =>
  auth.requireAuth(requestWith({ authorization: 'Bearer bm90LWEtdG9rZW4.bm90LWEtc2ln' })),
);

/**
 * Cookies are keyed by name, domain and path, so a browser can hold two of the
 * same name and send both. Reading only the first let a dead cookie shadow a
 * live one for good: signing in wrote a fresh cookie that was never the one
 * read, so no amount of signing in fixed it.
 */
await check('a live cookie is found behind a dead one', async () => {
  const stale = 'bm90LWEtdG9rZW4.bm90LWEtc2ln';
  const both = requestWith({
    cookie: `figmark_session=${stale}; figmark_session=${session.token}`,
  });
  const who = await auth.getCurrentUser(both);
  assert.equal(who?.id, 'usr_demo');
  assert.equal((await auth.requireAuth(both)).id, 'usr_demo');
});

await check('a refusal clears the cookie it just rejected', async () => {
  try {
    await auth.requireAuth(requestWith({ cookie: 'figmark_session=bm90LWEtdG9rZW4.bm90LWEtc2ln' }));
    assert.fail('expected the request to be refused');
  } catch (err) {
    assert.equal(err.code, 'session_unverified');
    // Without this the browser resends the dead cookie forever and signing in
    // again changes nothing.
    assert.equal(err.cookies.length, 1);
    assert.match(err.cookies[0], /^figmark_session=;/);
    assert.match(err.cookies[0], /Max-Age=0/);
  }
});

await check('an expired session is named as expired, not as unverifiable', async () => {
  const brief = new MockAuthProvider(repository, 'test-secret', -1);
  const dead = await brief.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  try {
    await auth.requireAuth(requestWith({ cookie: `figmark_session=${dead.token}` }));
    assert.fail('expected the request to be refused');
  } catch (err) {
    assert.equal(err.code, 'session_expired');
  }
});

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

console.log('\nsecurity');

await check('with a durable store, a deleted account ends the session honestly', async () => {
  // Only meaningful once the store is authoritative: there, a missing account
  // really is deleted, and the token must not resurrect it. (On the per-worker
  // memory store the opposite is required - see the cross-worker check above.)
  const created = await auth.signup({
    displayName: 'Ghost', email: 'ghost@figmark.example', phone: '+919777000444', password: 'longenough1',
  });

  const durable = new MemoryRepository();
  await durable.init();
  Object.defineProperty(durable, 'backend', { value: 'cosmos' });
  const other = new MockAuthProvider(durable, 'test-secret', 3600);
  const carried = requestWith({ authorization: `Bearer ${created.token}` });

  assert.equal(await other.getCurrentUser(carried), null, 'no snapshot fallback with a real store');
  try {
    await other.requireAuth(carried);
    assert.fail('expected requireAuth to throw');
  } catch (err) {
    assert.equal(err.code, 'account_unavailable', 'must not look like a plain logout');
  }
});

await check('a token signed by another instance is rejected, not silently trusted', async () => {
  // The shape of a multi-worker host: two providers, different keys.
  const other = new MockAuthProvider(repository, 'a-different-instance-key', 3600);
  const carried = requestWith({ authorization: `Bearer ${session.token}` });
  assert.equal(await other.getCurrentUser(carried), null);
});

await check('a signed-up account still works on a worker that never saw it', async () => {
  // The reported bug exactly: sign up lands on one worker, the next click is
  // served by another whose in-memory store has never heard of the account.
  const created = await auth.signup({
    displayName: 'Cross Worker', email: 'cross@figmark.example', phone: '+919777000888', password: 'longenough1',
  });

  const otherWorker = new MemoryRepository();
  await otherWorker.init();
  const workerB = new MockAuthProvider(otherWorker, 'test-secret', 3600);
  const carried = requestWith({ authorization: `Bearer ${created.token}` });

  assert.equal(await otherWorker.getUserById(created.user.id), null, 'worker B has no such account');

  const resolved = await workerB.getCurrentUser(carried);
  assert.ok(resolved, 'the session must survive the worker that never saw the sign-up');
  assert.equal(resolved.displayName, 'Cross Worker');
  assert.equal(resolved.capabilities.canSell, true);

  // And the capability-gated routes that were logging the user out now pass.
  const permitted = await workerB.requireCapability(carried, ['sell']);
  assert.equal(permitted.id, created.user.id);
});

await check('the snapshot is a fallback, never an override', async () => {
  // A real store stays authoritative: it is consulted first, and a suspended
  // account is refused even though the token still carries a valid snapshot.
  const seeded = await repository.getUserById('usr_demo');
  const session2 = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  seeded.suspended = true;
  const blocked = await auth.getCurrentUser(requestWith({ authorization: `Bearer ${session2.token}` }));
  assert.equal(blocked, null, 'a suspended account must not be revived by its token');
  seeded.suspended = false;
});

await check('a tampered snapshot is rejected with the signature', async () => {
  const created = await auth.signup({
    displayName: 'Honest', email: 'honest@figmark.example', phone: '+919777000999', password: 'longenough1',
  });
  // Forge an admin snapshot into the payload and re-encode without resigning.
  const [payload, signature] = created.token.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.usr.capabilities.isAdmin = true;
  const forged = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature}`;
  assert.equal(await auth.getCurrentUser(requestWith({ authorization: `Bearer ${forged}` })), null);
});

await check('sign-up warns when the store will not keep the account', async () => {
  const created = await auth.signup({
    displayName: 'Warned', email: 'warned@figmark.example', phone: '+919777000555', password: 'longenough1',
  });
  assert.match(created.warning ?? '', /memory/i);
});

await check('repeated wrong passwords are rate-limited', async () => {
  const target = 'ratelimit@figmark.example';
  await auth.signup({ displayName: 'RL', email: target, phone: '+919777000666', password: 'longenough1' });
  let limited = false;
  for (let i = 0; i < 12; i += 1) {
    try {
      await auth.login({ identifier: target, password: 'wrong' });
    } catch (err) {
      if (err.code === 'too_many_attempts') { limited = true; break; }
    }
  }
  assert.ok(limited, 'expected a lockout after repeated failures');
});

await check('a correct password clears the failed-attempt record', async () => {
  const target = 'clears@figmark.example';
  await auth.signup({ displayName: 'CL', email: target, phone: '+919777000777', password: 'longenough1' });
  for (let i = 0; i < 3; i += 1) {
    await auth.login({ identifier: target, password: 'wrong' }).catch(() => {});
  }
  // A legitimate user who mistyped a few times must still get in.
  const ok = await auth.login({ identifier: target, password: 'longenough1' });
  assert.equal(ok.user.email, target);
});

console.log('\ndata layer');

await check('search matches title, tags and description', async () => {
  assert.equal((await repository.listListings({ search: 'sneaker' })).length, 2);
  assert.equal((await repository.listListings({ search: 'deadstock' })).length, 1);
  assert.equal((await repository.listListings({ search: 'nothingmatchesthis' })).length, 0);
});

await check('the demo account owns listings and purchases', async () => {
  assert.ok((await repository.listListings({ sellerId: 'usr_demo' })).length >= 2);
  // Behaviour, not a seed count: every order this returns is theirs, and there
  // is at least one. Asserting the number instead breaks whenever a fixture is
  // added, which says nothing about whether the query is right.
  const purchases = await repository.listOrdersForBuyer('usr_demo');
  assert.ok(purchases.length >= 3);
  assert.equal(purchases.every((order) => order.buyerId === 'usr_demo'), true);
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

await expectAuthError('a revoked session is named as signed out', 'session_ended', () =>
  auth.requireAuth(bearer),
);

console.log('\nan unserviceable store');

/**
 * A store that holds no accounts, or cannot be reached, resolves every
 * identifier to nobody - which reaches the user as "your password is wrong" for
 * a password that is right. These assert it says what is actually wrong, since
 * no amount of retyping fixes an empty database.
 */
const stubStore = (status) => ({
  backend: 'cosmos',
  status: () => status,
  getUserById: async () => null,
  getUserByIdentifier: async () => null,
  isSessionRevoked: async () => false,
});

await expectAuthError(
  'an empty database says so rather than blaming the password',
  'sign_in_unavailable',
  () =>
    new MockAuthProvider(
      stubStore({ connected: true, database: 'figmark', detail: 'connected', signInAccounts: 0 }),
      'test-secret',
      3600,
    ).login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD }),
);

await expectAuthError(
  'an unreachable database says so rather than blaming the password',
  'sign_in_unavailable',
  () =>
    new MockAuthProvider(
      stubStore({ connected: false, database: 'figmark', detail: 'no route to host', signInAccounts: null }),
      'test-secret',
      3600,
    ).login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD }),
);

await check('the reason names the store, so the fix is visible', async () => {
  try {
    await new MockAuthProvider(
      stubStore({ connected: true, database: 'figmark', detail: 'connected', signInAccounts: 0 }),
      'test-secret',
      3600,
    ).login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.fail('expected the sign-in to be refused');
  } catch (err) {
    assert.match(err.message, /no accounts/i);
    assert.match(err.message, /azure:provision/);
    assert.equal(err.status, 503);
  }
});

await expectAuthError(
  'a populated store still blames the credentials, not the backend',
  'invalid_credentials',
  () =>
    new MockAuthProvider(
      stubStore({ connected: true, database: 'figmark', detail: 'connected', signInAccounts: 4 }),
      'test-secret',
      3600,
    ).login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD }),
);

await check('a freshly seeded store counts exactly the accounts it advertises', async () => {
  // Counted on a store of its own: the sign-up tests above added accounts to
  // the shared one. Catalog sellers and forwarders carry no password hash, so
  // the seed contributes exactly the accounts the sign-in page offers — the
  // number the health check reports is what a visitor could actually use.
  const fresh = new MemoryRepository();
  await fresh.init();
  assert.equal(fresh.status().signInAccounts, fresh.listDemoAccounts().length);
  assert.equal(fresh.status().connected, true);
});

console.log(`\n${passed} checks passed`);
