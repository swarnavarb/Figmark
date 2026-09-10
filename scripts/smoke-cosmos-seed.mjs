/**
 * Smoke test for what a Cosmos-backed deployment does with an empty database.
 *
 * This is the failure it exists to prevent: COSMOS_ENDPOINT is set in the
 * portal, the API connects successfully, and every sign-in - including the demo
 * account, with the password printed on the sign-in page - is answered with
 * "Username or password is incorrect", because the database resolves every
 * identifier to nobody. Retyping a correct password never fixes it.
 *
 * Cosmos is stood in for by Maps with the shape the repository actually calls:
 * point reads, upserts, and the one count query. That is enough to prove the
 * seeding path writes rows sign-in can resolve, which is the part that was
 * wrong - the SDK's own behaviour is not what is under test.
 */
import assert from 'node:assert/strict';

const base = new URL('../api/dist/', import.meta.url);
const { CosmosRepository } = await import(new URL('api/src/data/cosmos-repository.js', base));
const { MockAuthProvider } = await import(new URL('api/src/auth/mock-provider.js', base));
const { AuthError } = await import(new URL('api/src/auth/errors.js', base));
const { DEMO_EMAIL, DEMO_PASSWORD, seedUsers } = await import(new URL('api/src/data/seed.js', base));
const { CONTAINER_LIST } = await import(new URL('shared/containers.js', base));

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/**
 * How much work the repository actually did.
 *
 * Counted because init runs on every cold start and every request landing on a
 * cold worker waits behind it: a correct init that costs two hundred round
 * trips is a page that never loads.
 */
const calls = { reads: 0, writes: 0, queries: 0 };
const resetCalls = () => Object.assign(calls, { reads: 0, writes: 0, queries: 0 });

/** A container backed by a Map, answering only what the repository asks of it. */
function fakeContainer(store) {
  return {
    items: {
      async upsert(doc) {
        calls.writes += 1;
        store.set(doc.id, doc);
        return { resource: doc };
      },
      async create(doc) {
        calls.writes += 1;
        if (store.has(doc.id)) throw { code: 409 };
        store.set(doc.id, doc);
        return { resource: doc };
      },
      query(spec) {
        return {
          async fetchAll() {
            calls.queries += 1;
            const query = typeof spec === 'string' ? spec : spec.query;
            if (query.startsWith('SELECT VALUE COUNT(1)')) {
              const withPassword = [...store.values()].filter((doc) => doc.passwordHash != null);
              return { resources: [withPassword.length] };
            }
            // Projections have to project. A double that answers every query
            // with whole documents cannot tell a cheap init from an expensive
            // one, which is the difference this file now cares about.
            if (/^SELECT VALUE c\.id\b/i.test(query)) {
              return { resources: [...store.keys()] };
            }
            return { resources: [...store.values()] };
          },
        };
      },
    },
    item(id) {
      return {
        async read() {
          calls.reads += 1;
          const resource = store.get(id);
          if (!resource) throw { code: 404 };
          return { resource };
        },
      };
    },
  };
}

/** A repository wired to fake containers, with control over whether it connects. */
function repositoryOn(containers, { reachable = true } = {}) {
  const repository = new CosmosRepository({
    endpoint: 'https://example.invalid',
    key: 'stub-key',
    database: 'figmark',
  });
  // The real client is never used: it would need an actual endpoint. Dispose it
  // so its keep-alive agent does not hold the process open, and stand in for the
  // one call init() makes through it.
  repository.client.dispose?.();
  // init() takes its database handle from the client, so the stub has to carry
  // everything init() then asks of it: the reachability probe and the container
  // listing behind ensureContainers().
  const database = {
    read: async () => {
      if (!reachable) throw new Error('no route to host');
      return {};
    },
    containers: {
      readAll: () => ({
        async fetchAll() {
          return { resources: [...containers.keys()].map((id) => ({ id })) };
        },
      }),
      async createIfNotExists(body) {
        containers.set(body.id, new Map());
        return { statusCode: 201 };
      },
    },
  };
  repository.client = { database: () => database };
  // Every container access goes through container(), which this shadows.
  // Unlike the old fake, an unprovisioned container is *not* conjured up on
  // first touch: Cosmos answers a missing container with a 404, and a fake
  // more forgiving than the real thing is how a missing container reached
  // production in the first place.
  repository.container = (name) => {
    const store = containers.get(name);
    if (!store) throw { code: 404, message: `Container ${name} does not exist.` };
    return fakeContainer(store);
  };
  return repository;
}

/** A database provisioned with every container the schema declares. */
function provisioned(names = CONTAINER_LIST.map((definition) => definition.name)) {
  return new Map(names.map((name) => [name, new Map()]));
}

console.log('an empty Cosmos database');

const containers = provisioned();
const repository = repositoryOn(containers);
await repository.init();

await check('is seeded on init rather than served empty', () => {
  assert.equal(repository.status().connected, true);
  assert.equal(repository.status().signInAccounts, repository.listDemoAccounts().length);
  assert.match(repository.status().detail, /Seeded \d+ fixture records/);
});

await check('carries identifier reservations, which sign-in resolves through', async () => {
  const reservations = containers.get('identifiers');
  assert.ok(reservations.size >= 2, 'expected at least the demo email and phone');
  assert.equal(reservations.get(DEMO_EMAIL).userId, 'usr_demo');
  const user = await repository.getUserByIdentifier(DEMO_EMAIL);
  assert.equal(user.id, 'usr_demo');
});

await check('signs the demo account in, which is the whole point', async () => {
  const auth = new MockAuthProvider(repository, 'test-secret', 3600);
  const session = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.equal(session.user.displayName, 'Arjun Mehta');
});

await check('advertises the demo hint it just seeded, so the password is findable', () => {
  const [account] = repository.listDemoAccounts();
  assert.equal(account.identifier, DEMO_EMAIL);
  assert.equal(account.label.split('\u00b7').pop().trim(), DEMO_PASSWORD);
});

await check('holds the catalog too, so the feed is not empty either', () => {
  assert.ok(containers.get('listings').size >= 2);
  assert.ok(containers.get('lots').size >= 1);
});

await check('addresses likes and follows by the id that toggling reads back', () => {
  for (const id of containers.get('likes').keys()) assert.match(id, /^usr_[a-z]+__lst_/);
  for (const id of containers.get('follows').keys()) assert.match(id, /^usr_[a-z]+__usr_/);
});

console.log('\na database left half-seeded');

/**
 * What the old provisioning script actually produced: it wrote each user row
 * before its reservations, and threw on the first user (reading a `username`
 * field the capabilities model had removed). The result is one account with a
 * password hash and no reservation behind it - so the database is not empty,
 * every sign-in for it is answered "incorrect", and nothing about the page
 * says why.
 */
const halfSeeded = provisioned();
halfSeeded.set('users', new Map([['usr_demo', seedUsers().find((u) => u.id === 'usr_demo')]]));
const repaired = repositoryOn(halfSeeded);

await check('starts out unable to sign that account in', async () => {
  // Before init: the row is there, the reservation is not.
  assert.equal(halfSeeded.get('users').size, 1);
  assert.equal(halfSeeded.get('identifiers').size, 0);
});

await repaired.init();
await repaired.settled();

await check('is not mistaken for an empty database', () => {
  assert.equal(repaired.status().signInAccounts, repaired.listDemoAccounts().length);
  assert.match(repaired.status().detail, /half-written seed/);
});

await check('restores the reservation, so the demo account signs in again', async () => {
  assert.equal(halfSeeded.get('identifiers').get(DEMO_EMAIL).userId, 'usr_demo');
  const auth = new MockAuthProvider(repaired, 'test-secret', 3600);
  const session = await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
  assert.equal(session.user.displayName, 'Arjun Mehta');
});

await check('completes the catalog the half-written seed never reached', () => {
  assert.ok(halfSeeded.get('listings').size >= 2);
  assert.ok(halfSeeded.get('lots').size >= 1);
});

console.log('\na database that already holds accounts');

await check('is left exactly as it is', async () => {
  const existing = new Map([
    ['users', new Map([['usr_real', { id: 'usr_real', email: 'someone@example.com', passwordHash: 'x:y' }]])],
    ['identifiers', new Map([['someone@example.com', { id: 'someone@example.com', userId: 'usr_real' }]])],
  ]);
  const untouched = repositoryOn(existing);
  await untouched.init();
  await untouched.settled();
  assert.equal(existing.get('users').size, 1, 'seeding must not touch a populated database');
  assert.equal(untouched.status().signInAccounts, 1);
  // The container exists - init() creates whatever the schema declares - but
  // nothing was written into it, which is the promise that matters.
  assert.equal(existing.get('listings').size, 0, 'nothing else should have been written');
  assert.deepEqual(untouched.listDemoAccounts(), [], 'never advertise a password against real accounts');
});

await check('a real account missing its reservation is restored, and nothing else', async () => {
  // The repair is not a licence to write fixtures into someone's database: only
  // the gap is filled, because the fixture account is not among the rows.
  const orphaned = new Map([
    ['users', new Map([['usr_real', { id: 'usr_real', email: 'Someone@Example.com', passwordHash: 'x:y' }]])],
  ]);
  const fixed = repositoryOn(orphaned);
  await fixed.init();
  await fixed.settled();
  assert.equal(orphaned.get('identifiers').get('someone@example.com').userId, 'usr_real');
  assert.equal(orphaned.get('listings').size, 0, 'no fixtures in a database of real accounts');
  assert.deepEqual(fixed.listDemoAccounts(), []);
  assert.match(fixed.status().detail, /Restored 1 missing identifier reservation/);
});

console.log('\na database seeded by an older release');

await check('gains the fixtures a later release added, and keeps what it had', async () => {
  // The failure this exists to prevent: the seed only ran on an empty
  // database, so a deployment seeded once and then updated kept day-one data
  // forever. Three releases of escrows, reviews and disputes were in the code
  // and absent from the site, and nothing said so.
  const containers = provisioned();
  const repository = repositoryOn(containers);
  await repository.init();
  await repository.settled();

  // Stand in for an older seed: drop the fixtures a later release introduced,
  // and put real use onto one of the rows that stayed.
  const users = containers.get('users');
  const orders = containers.get('orders');
  users.delete('usr_escrow_meera');
  orders.delete('ord_1005');
  const touched = orders.get('ord_1001');
  touched.itemName = 'Renamed by somebody using the site';
  orders.set('ord_1001', touched);

  const updated = repositoryOn(containers);
  await updated.init();
  await updated.settled();

  assert.ok(users.has('usr_escrow_meera'), 'the new account arrives');
  assert.ok(orders.has('ord_1005'), 'and the new order with it');
  assert.match(updated.status().detail, /Added \d+ fixture record/);

  // A row already there is left exactly as it is: by then it may carry real
  // use, and somebody's order state is not ours to reset.
  assert.equal(orders.get('ord_1001').itemName, 'Renamed by somebody using the site');

  // And the new account is reachable, not merely present.
  assert.ok(containers.get('identifiers').has('meera@figmark.in'));
  assert.equal((await updated.getUserByIdentifier('meera@figmark.in')).id, 'usr_escrow_meera');
});

await check('starting against an up-to-date database is cheap', async () => {
  // The regression this exists to catch. Checking each fixture with its own
  // round trip is correct and unusable: two hundred sequential calls on every
  // cold start is a request that never comes back, and the page behind it sits
  // on "Loading…" forever. The healthy case is a handful of projections and no
  // writes at all.
  const containers = provisioned();
  const seeded = repositoryOn(containers);
  await seeded.init();
  await seeded.settled();

  resetCalls();
  const restarted = repositoryOn(containers);
  await restarted.init();
  await restarted.settled();

  assert.equal(calls.writes, 0, `nothing to write, but wrote ${calls.writes} times`);
  assert.ok(calls.queries < 25, `init should cost a few queries, not ${calls.queries}`);
  assert.ok(calls.reads < 10, `init should not read row by row: ${calls.reads} point reads`);
});

await check('a populated database serves before the fixture pass has run', async () => {
  // What actually kept the operations console on "Loading…". Making init cheap
  // was not enough, because cheap still meant a full pass over every container
  // in front of the first request on every cold worker - and a serverless host
  // makes cold workers whenever it feels like it.
  //
  // So the cost is measured where it is paid: what init does before it returns.
  // A database that already holds accounts is already serving, and checking its
  // fixtures is maintenance. Maintenance runs behind the request, not in front
  // of it.
  const containers = provisioned();
  const warm = repositoryOn(containers);
  await warm.init();
  await warm.settled();

  resetCalls();
  const restarted = repositoryOn(containers);
  await restarted.init();

  const onTheRequestPath = calls.reads + calls.writes + calls.queries;
  assert.ok(
    onTheRequestPath <= 4,
    `init should connect and hand back, not sweep the database: ${onTheRequestPath} calls`,
  );

  // And it still happens - moved off the path, not dropped.
  await restarted.settled();
  assert.ok(calls.queries > onTheRequestPath, 'the fixture pass should still have run');
});

await check('an empty database is filled before it serves anybody', async () => {
  // The one case that must still block: there is nothing to serve. A database
  // with no accounts answers every correct password with "that is wrong", so
  // handing it back early would trade a slow console for a broken sign-in.
  const empty = provisioned();
  const fresh = repositoryOn(empty);
  await fresh.init();

  assert.ok(empty.get('users').size > 0, 'an empty database must be filled by init itself');
  assert.equal(fresh.status().signInAccounts, fresh.listDemoAccounts().length);
});

await check('an account written before handles existed is given one', async () => {
  // The gap that made every mention of somebody render as plain text on the
  // deployed site: a row from before handles carries no username, nothing
  // backfills one, and an account with no address cannot be linked to from
  // anywhere. The fixture top-up correctly refuses to touch existing rows, so
  // it was never going to close this.
  const containers = provisioned();
  const seeded = repositoryOn(containers);
  await seeded.init();
  await seeded.settled();

  // Strip the handles off two rows, the way an older seed left them.
  const users = containers.get('users');
  const kaiju = users.get('usr_kaiju');
  delete kaiju.username;
  delete kaiju.sellerProfile.username;
  users.set('usr_kaiju', kaiju);

  const restarted = repositoryOn(containers);
  await restarted.init();
  await restarted.settled();

  const fixed = containers.get('users').get('usr_kaiju');
  assert.ok(fixed.username, 'the person has an address again');
  assert.ok(fixed.sellerProfile.username, 'and so does their shop');
  // Reachable, not merely present: the handle resolves.
  assert.equal((await restarted.getByHandle(fixed.username)).user.id, 'usr_kaiju');
  assert.equal((await restarted.getByHandle(fixed.sellerProfile.username)).isStore, true);
  assert.match(restarted.status().detail, /Gave \d+ handle/);
});

await check('a handle somebody already chose is left alone', async () => {
  // Only an absent handle is filled. A name they picked is not ours to change.
  const containers = provisioned();
  const seeded = repositoryOn(containers);
  await seeded.init();
  await seeded.settled();

  const before = containers.get('users').get('usr_kaiju').sellerProfile.username;

  const restarted = repositoryOn(containers);
  await restarted.init();
  await restarted.settled();

  assert.equal(containers.get('users').get('usr_kaiju').sellerProfile.username, before);
  assert.doesNotMatch(restarted.status().detail, /Gave \d+ handle/);
});

await check('two shops of the same name do not both get the same address', async () => {
  const containers = provisioned();
  const seeded = repositoryOn(containers);
  await seeded.init();
  await seeded.settled();

  const users = containers.get('users');
  // Two handle-less rows that would both want the same one.
  for (const id of ['usr_twin_a', 'usr_twin_b']) {
    users.set(id, {
      id, email: `${id}@example.com`, phone: null, displayName: 'Same Name Shop',
      passwordHash: null, isAdmin: false, suspended: false,
      verification: {}, buyerTrust: {}, sellerTrust: {},
      sellerProfile: { storefrontName: 'Same Name Shop', bio: '', tier: 'unverified' },
      forwarderProfile: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
  }

  const restarted = repositoryOn(containers);
  await restarted.init();
  await restarted.settled();

  const a = users.get('usr_twin_a');
  const b = users.get('usr_twin_b');
  assert.ok(a.username && b.username, 'both are addressable');
  assert.notEqual(a.username, b.username, 'and not at the same address');
  assert.notEqual(a.sellerProfile.username, b.sellerProfile.username);
});

await check('a database of real accounts is never topped up with fixtures', async () => {
  // `usr_demo` is a fixture id. Without it this is somebody's real database,
  // and writing our demo accounts into it would be indefensible.
  const real = provisioned();
  real.set('users', new Map([['usr_real', { id: 'usr_real', email: 'someone@example.com', passwordHash: 'x:y' }]]));
  real.set('identifiers', new Map([['someone@example.com', { id: 'someone@example.com', userId: 'usr_real' }]]));

  const repository = repositoryOn(real);
  await repository.init();

  assert.equal(real.get('users').size, 1, 'nothing was added');
  assert.equal(real.get('listings').size, 0);
  assert.equal(/Added \d+ fixture record/.test(repository.status().detail), false);
});

console.log('\na database provisioned before a container existed');

await check('creates what the schema declares and the database lacks', async () => {
  // Exactly the shape of the bug: `messages` was added to the schema long after
  // this database was provisioned, so every request against the inbox answered
  // 500 until somebody re-ran a script by hand.
  const old = provisioned(CONTAINER_LIST.map((d) => d.name).filter((name) => name !== 'messages'));
  const repository = repositoryOn(old);
  await repository.init();

  assert.ok(old.has('messages'), 'the missing container should have been created');
  assert.match(repository.status().detail, /Created missing container\(s\): messages/);

  // And it works, rather than merely existing.
  const sent = await repository.sendMessage({
    id: 'msg_1', threadId: 'a|b',
    from: { handle: 'a', userId: 'usr_a', isStore: false, displayName: 'A' },
    to: { handle: 'b', userId: 'usr_b', isStore: false, displayName: 'B' },
    body: 'Anyone there?', readAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  });
  assert.equal(sent.id, 'msg_1');
  assert.equal((await repository.listMessagesForHandles(['a'])).length, 1);
});

await check('says nothing about containers when none were missing', async () => {
  const complete = repositoryOn(provisioned());
  await complete.init();
  assert.equal(/Created missing container/.test(complete.status().detail), false);
  assert.deepEqual(complete.status().missingContainers, []);
});

await check('a container it may not create is named, not swallowed', async () => {
  // What a data-plane managed identity actually gets: the listing works, the
  // create is refused. Two rounds were spent guessing at this from the outside
  // because every symptom was an anonymous 500, so the status has to say it.
  const denied = provisioned(CONTAINER_LIST.map((d) => d.name).filter((name) => name !== 'messages'));
  const repository = repositoryOn(denied);
  const database = repository.client.database();
  database.containers.createIfNotExists = async () => {
    throw Object.assign(new Error('Forbidden'), { code: 403 });
  };
  await repository.init();

  assert.deepEqual(repository.status().missingContainers, ['messages']);
  assert.match(repository.status().detail, /Missing container\(s\): messages/);
  assert.match(repository.status().detail, /azure:provision/);
  // Still connected: one broken feature is not a broken deployment.
  assert.equal(repository.status().connected, true);
});

console.log('\na database that cannot be reached');

const unreachable = repositoryOn(new Map(), { reachable: false });
await unreachable.init();

await check('reports itself disconnected instead of empty', () => {
  assert.equal(unreachable.status().connected, false);
  assert.equal(unreachable.status().signInAccounts, null);
  assert.match(unreachable.status().detail, /Could not reach Cosmos DB/);
});

await check('refuses sign-in with the reason, not "wrong password"', async () => {
  const auth = new MockAuthProvider(unreachable, 'test-secret', 3600);
  try {
    await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.fail('expected the sign-in to be refused');
  } catch (err) {
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, 'sign_in_unavailable');
    assert.match(err.message, /not reachable/);
  }
});

console.log('\nopting out');

await check('COSMOS_AUTOSEED=off leaves an empty database empty', async () => {
  process.env.COSMOS_AUTOSEED = 'off';
  try {
    const empty = new Map();
    const optedOut = repositoryOn(empty);
    await optedOut.init();
    assert.equal(optedOut.status().signInAccounts, 0);
    assert.equal(empty.get('listings').size, 0);
  } finally {
    delete process.env.COSMOS_AUTOSEED;
  }
});

await check('opting out declines the fixtures, not the schema', async () => {
  // Containers are what the code needs to run at all, and creating an empty one
  // writes nothing. Withholding them would leave the same opaque 500 behind,
  // with the operator no better informed.
  process.env.COSMOS_AUTOSEED = 'off';
  try {
    const empty = new Map();
    const optedOut = repositoryOn(empty);
    await optedOut.init();
    for (const definition of CONTAINER_LIST) {
      assert.ok(empty.has(definition.name), `${definition.name} should exist`);
      assert.equal(empty.get(definition.name).size, 0, `${definition.name} should be empty`);
    }
  } finally {
    delete process.env.COSMOS_AUTOSEED;
  }
});

console.log(`\n${passed} checks passed`);
