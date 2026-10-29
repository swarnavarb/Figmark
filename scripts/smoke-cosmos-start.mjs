/**
 * Smoke test for what the Cosmos repository does when it starts.
 *
 * A database starts empty and stays empty: the API writes no accounts, no
 * listings, nothing, until somebody signs up. What start-up does do is bring
 * an existing database up to date - containers created and given their
 * policies - without making the first request wait for it.
 *
 * Cosmos is stood in for by Maps with the shape the repository actually calls:
 * point reads, upserts, projections and the one count query. A populated
 * database is built from test-fixtures/, written the way the repository
 * writes rows.
 */
import assert from 'node:assert/strict';
import { fixtures } from './fixtures.mjs';

const base = new URL('../api/dist/', import.meta.url);
const { CosmosRepository } = await import(new URL('api/src/data/cosmos-repository.js', base));
const { MockAuthProvider } = await import(new URL('api/src/auth/mock-provider.js', base));
const { AuthError } = await import(new URL('api/src/auth/errors.js', base));
const { identifiersOf } = await import(new URL('api/src/data/memory-repository.js', base));
const { CONTAINER_LIST } = await import(new URL('shared/containers.js', base));
const { handleKey } = await import(new URL('shared/handles.js', base));
const { popularity } = await import(new URL('shared/catalog.js', base));
const { DEMO_EMAIL, DEMO_PASSWORD, fixtureSet } = fixtures;

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
            const params = Object.fromEntries((spec.parameters ?? []).map((entry) => [entry.name, entry.value]));
            // A range of ids, as the logs kept in site content are read.
            if (/WHERE c\.id >= @from AND c\.id < @to$/.test(query)) {
              return { resources: [...store.values()].filter((doc) => doc.id >= params['@from'] && doc.id < params['@to']) };
            }
            // `SELECT c.id, c.<key> AS pk[, c.<field> AS ref] FROM c`
            const projected = query.match(/^SELECT c\.id, c\.(\w+) AS pk(?:, c\.(\w+) AS ref)? FROM c$/);
            if (projected) {
              const [, pk, ref] = projected;
              return {
                resources: [...store.values()].map((doc) => ({ id: doc.id, pk: doc[pk], ...(ref ? { ref: doc[ref] } : {}) })),
              };
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
        async delete() {
          calls.writes += 1;
          if (!store.delete(id)) throw { code: 404 };
          return {};
        },
        // Top-level paths only, which is all the repository patches.
        async patch(operations) {
          calls.writes += 1;
          const resource = store.get(id);
          if (!resource) throw { code: 404 };
          for (const { op, path, value } of operations) {
            const key = path.slice(1);
            if (op === 'set') resource[key] = value;
            else if (op === 'incr') resource[key] = (resource[key] ?? 0) + value;
            else throw new Error(`the fake does not patch with ${op}`);
          }
          return { resource };
        },
      };
    },
  };
}

/** Each fake container's definition, as the policy pass would find it. */
const policies = new Map();

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
        policies.set(body.id, body);
        return { statusCode: 201 };
      },
    },
    // Container metadata, as the policy pass reads and replaces it.
    container: (id) => ({
      async read() {
        calls.reads += 1;
        return { resource: policies.get(id) ?? { id, partitionKey: { paths: ['/id'] }, indexingPolicy: {} } };
      },
      async replace(body) {
        calls.writes += 1;
        policies.set(id, body);
        return { resource: body };
      },
    }),
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


/**
 * A database somebody has been using: the fixtures, written as the repository
 * writes rows - reservations beside each account, listings with their stored
 * popularity, likes and follows under the composite id toggling reads back.
 */
function populated() {
  const containers = provisioned();
  const set = fixtureSet();
  const put = (name, doc) => containers.get(name).set(doc.id, doc);
  for (const user of set.users) {
    put('users', structuredClone(user));
    for (const identifier of identifiersOf(user)) put('identifiers', { id: identifier, userId: user.id });
    if (user.username) put('identifiers', { id: handleKey(user.username), userId: user.id, isStore: false });
    if (user.sellerProfile?.username) {
      put('identifiers', { id: handleKey(user.sellerProfile.username), userId: user.id, isStore: true });
    }
  }
  for (const [name, items] of [
    ['lots', [...set.routedLots, ...set.lots]], ['orders', set.orders], ['powerSales', set.powerSales],
    ['comments', set.comments], ['forums', set.forums], ['posts', set.posts], ['reviews', set.reviews],
    ['disputes', set.disputes], ['wants', set.wants], ['wantOffers', set.wantOffers], ['pledges', set.pledges],
  ]) {
    for (const item of items) put(name, structuredClone(item));
  }
  for (const listing of set.listings) put('listings', { ...structuredClone(listing), popularity: popularity(listing) });
  for (const like of set.likes) put('likes', { ...like, id: `${like.userId}__${like.listingId}` });
  for (const follow of set.follows) put('follows', { ...follow, id: `${follow.followerId}__${follow.sellerId}` });
  return containers;
}

console.log('an empty Cosmos database');

await check('stays empty: nothing is written into it', async () => {
  const containers = provisioned();
  const repository = repositoryOn(containers);
  await repository.init();
  await repository.settled();
  assert.equal(repository.status().connected, true);
  assert.equal(repository.status().signInAccounts, 0);
  for (const name of CONTAINER_LIST.map((definition) => definition.name).filter((name) => name !== 'siteContent')) {
    assert.equal(containers.get(name).size, 0, `${name} should be empty`);
  }
  assert.deepEqual(repository.listDemoAccounts(), [], 'there is no published password to offer');
});

await check('creates the schema, so the first sign-up has somewhere to go', async () => {
  const nothing = new Map();
  const repository = repositoryOn(nothing);
  await repository.init();
  for (const definition of CONTAINER_LIST) assert.ok(nothing.has(definition.name), `${definition.name} should exist`);
  assert.deepEqual(repository.status().missingContainers, []);
});

await check('says nobody has an account yet, rather than "wrong password"', async () => {
  const repository = repositoryOn(provisioned());
  await repository.init();
  const auth = new MockAuthProvider(repository, 'test-secret', 3600);
  try {
    await auth.login({ identifier: DEMO_EMAIL, password: DEMO_PASSWORD });
    assert.fail('expected the sign-in to be refused');
  } catch (err) {
    assert.ok(err instanceof AuthError);
    assert.equal(err.code, 'sign_in_unavailable');
    assert.match(err.message, /sign up/i);
  }
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
  assert.equal(existing.get('users').size, 1, 'start-up must not write accounts');
  assert.equal(untouched.status().signInAccounts, 1);
  // The container exists - init() creates whatever the schema declares - but
  // nothing was written into it, which is the promise that matters.
  assert.equal(existing.get('listings').size, 0, 'nothing else should have been written');
  assert.deepEqual(untouched.listDemoAccounts(), [], 'never advertise a password against real accounts');
});

await check('starting against an up-to-date database is cheap', async () => {
  // The regression this exists to catch. Checking each row with its own round
  // trip is correct and unusable: two hundred sequential calls on every cold
  // start is a request that never comes back, and the page behind it sits on
  // "Loading…" forever. The healthy case is a handful of reads and no writes
  // at all.
  const containers = populated();
  const warm = repositoryOn(containers);
  await warm.init();
  await warm.settled();

  resetCalls();
  const restarted = repositoryOn(containers);
  await restarted.init();
  await restarted.settled();

  assert.equal(calls.writes, 0, `nothing to write, but wrote ${calls.writes} times`);
  assert.ok(calls.queries < 25, `init should cost a few queries, not ${calls.queries}`);
  assert.ok(calls.reads < 10, `init should not read row by row: ${calls.reads} point reads`);
});

await check('a populated database serves before its background passes have run', async () => {
  // What actually kept the operations console on "Loading…". Making init cheap
  // was not enough, because cheap still meant a full pass over every container
  // in front of the first request on every cold worker - and a serverless host
  // makes cold workers whenever it feels like it.
  //
  // So the cost is measured where it is paid: what init does before it returns.
  // A database that already holds accounts is already serving, and bringing it
  // up to date is maintenance. Maintenance runs behind the request, not in
  // front of it.
  const containers = populated();
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
  await restarted.settled();
});

console.log('\na database from before a container policy');

await check('existing containers take the policy the schema declares, once', async () => {
  const containers = populated();
  const warm = repositoryOn(containers);
  await warm.init();
  await warm.settled();

  // A container created before its TTL and exclusions were declared.
  containers.get('siteContent').delete('migration:container-policies');
  policies.set('notifications', { id: 'notifications', partitionKey: { paths: ['/userId'] }, indexingPolicy: {} });

  const restarted = repositoryOn(containers);
  await restarted.init();
  await restarted.settled();

  const notificationsPolicy = policies.get('notifications');
  assert.equal(notificationsPolicy.defaultTtl, 90 * 86_400, 'notifications now expire');
  assert.ok(notificationsPolicy.indexingPolicy.excludedPaths.some((entry) => entry.path === '/body/?'));
  assert.deepEqual(notificationsPolicy.partitionKey, { paths: ['/userId'] }, 'the partition key is kept');
  assert.match(restarted.status().detail, /Applied indexing and expiry policy to: .*notifications/);

  // Once, and never again.
  resetCalls();
  const again = repositoryOn(containers);
  await again.init();
  await again.settled();
  assert.equal(calls.writes, 0, `nothing left to do, but wrote ${calls.writes} times`);
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

/* A worker that started while the database was away ----------------------- */

const { openOnce } = await import(new URL('api/src/data/index.js', base));

await check('a store that came up unreachable is opened again after the wait, not kept for good', async () => {
  let clock = 0;
  let opens = 0;
  let reachable = false;
  const open = async () => {
    opens += 1;
    const connected = reachable;
    return { status: () => ({ connected }) };
  };
  const get = openOnce(open, 30_000, () => clock);

  const [first, again] = await Promise.all([get(), get()]);
  assert.equal(opens, 1, 'concurrent calls share one attempt');
  assert.equal(first, again);
  assert.equal(first.status().connected, false);

  reachable = true;
  clock = 29_999;
  assert.equal(await get(), first, 'the failure is kept until the wait is over');
  assert.equal(opens, 1);

  clock = 30_000;
  const healed = await get();
  assert.equal(opens, 2);
  assert.equal(healed.status().connected, true);

  clock = 10_000_000;
  assert.equal(await get(), healed, 'a connected store is kept');
  assert.equal(opens, 2);
});

await check('an open that throws is retried after the wait too', async () => {
  let clock = 0;
  let opens = 0;
  const get = openOnce(async () => {
    opens += 1;
    if (opens === 1) throw new Error('no route to host');
    return { status: () => ({ connected: true }) };
  }, 30_000, () => clock);

  await assert.rejects(get(), /no route to host/);
  await assert.rejects(get(), /no route to host/);
  assert.equal(opens, 1);
  clock = 30_000;
  assert.equal((await get()).status().connected, true);
  assert.equal(opens, 2);
});

console.log(`\n${passed} checks passed`);
