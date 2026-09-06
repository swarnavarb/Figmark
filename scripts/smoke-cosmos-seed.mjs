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
const { DEMO_EMAIL, DEMO_PASSWORD } = await import(new URL('api/src/data/seed.js', base));

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/** A container backed by a Map, answering only what the repository asks of it. */
function fakeContainer(store) {
  return {
    items: {
      async upsert(doc) {
        store.set(doc.id, doc);
        return { resource: doc };
      },
      async create(doc) {
        if (store.has(doc.id)) throw { code: 409 };
        store.set(doc.id, doc);
        return { resource: doc };
      },
      query(spec) {
        return {
          async fetchAll() {
            const query = typeof spec === 'string' ? spec : spec.query;
            if (query.startsWith('SELECT VALUE COUNT(1)')) {
              const withPassword = [...store.values()].filter((doc) => doc.passwordHash != null);
              return { resources: [withPassword.length] };
            }
            return { resources: [...store.values()] };
          },
        };
      },
    },
    item(id) {
      return {
        async read() {
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
  repository.client = {
    database: () => ({
      read: async () => {
        if (!reachable) throw new Error('no route to host');
        return {};
      },
    }),
  };
  // Every container access goes through container(), which this shadows.
  repository.container = (name) => {
    if (!containers.has(name)) containers.set(name, new Map());
    return fakeContainer(containers.get(name));
  };
  return repository;
}

console.log('an empty Cosmos database');

const containers = new Map();
const repository = repositoryOn(containers);
await repository.init();

await check('is seeded on init rather than served empty', () => {
  assert.equal(repository.status().connected, true);
  assert.equal(repository.status().signInAccounts, 1);
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

console.log('\na database that already holds accounts');

await check('is left exactly as it is', async () => {
  const existing = new Map([['users', new Map([['usr_real', { id: 'usr_real', passwordHash: 'x:y' }]])]]);
  const untouched = repositoryOn(existing);
  await untouched.init();
  assert.equal(existing.get('users').size, 1, 'seeding must not touch a populated database');
  assert.equal(untouched.status().signInAccounts, 1);
  assert.equal(existing.has('listings'), false, 'nothing else should have been written');
  assert.deepEqual(untouched.listDemoAccounts(), [], 'never advertise a password against real accounts');
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
    assert.equal(empty.has('listings'), false);
  } finally {
    delete process.env.COSMOS_AUTOSEED;
  }
});

console.log(`\n${passed} checks passed`);
