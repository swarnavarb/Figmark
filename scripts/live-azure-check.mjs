/**
 * Checks the S5-S12 hardening against the real Azure resources, not fakes.
 *
 * Needs a network that can reach Azure and the same credentials the API uses,
 * in the environment or api/local.settings.json (COSMOS_ENDPOINT, COSMOS_KEY,
 * COSMOS_DATABASE). Build the API first:
 *
 *   npm run build:api && node scripts/live-azure-check.mjs            # read-only
 *   npm run build:api && node scripts/live-azure-check.mjs --write    # + write tests
 *
 * 1. Containers: every container the schema declares exists in the database,
 *    `sessions` (which now holds the shared rate-limit counters) with TTL on.
 * 2. With --write: the repository's own checked writes, against real Cosmos
 *    etags. A scratch order and listing are created under a partition of
 *    their own (`livecheck-…`), exercised, and deleted again whatever happens;
 *    scratch counters expire by TTL within minutes.
 * 3. The deployed site: the security headers are actually being sent
 *    (SWA_HOSTNAME, default the production hostname).
 *
 * The app's init() is never called, so nothing is seeded or migrated.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const WRITE = process.argv.includes('--write');
const SWA_HOSTNAME = process.env.SWA_HOSTNAME ?? 'icy-stone-0498a9900.6.azurestaticapps.net';

async function loadSettings() {
  const values = { ...process.env };
  try {
    const raw = await readFile(new URL('../api/local.settings.json', import.meta.url), 'utf8');
    for (const [key, value] of Object.entries(JSON.parse(raw).Values ?? {})) {
      if (!values[key] && typeof value === 'string' && !value.startsWith('<')) values[key] = value;
    }
  } catch {
    // Environment only.
  }
  return values;
}

let failed = 0;
let passed = 0;
const check = async (name, fn) => {
  try {
    await fn();
    passed += 1;
    console.log(`  ok    ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL  ${name}\n        ${error?.message ?? error}`);
  }
};

const settings = await loadSettings();
const base = new URL('../api/dist/', import.meta.url);

/* ── Cosmos ────────────────────────────────────────────────────────────── */

if (!settings.COSMOS_ENDPOINT) {
  console.log('cosmos: COSMOS_ENDPOINT not set - skipped');
} else {
  const { CosmosRepository } = await import(new URL('api/src/data/cosmos-repository.js', base));
  const { StaleWriteError } = await import(new URL('api/src/data/concurrency.js', base));
  const { CONTAINER_LIST } = await import(new URL('shared/containers.js', base));
  const databaseName = settings.COSMOS_DATABASE ?? 'figmark';
  const repository = new CosmosRepository({ endpoint: settings.COSMOS_ENDPOINT, key: settings.COSMOS_KEY ?? null, database: databaseName });
  // What init() would do first, without the seeding and repairs that follow it.
  repository.database = repository.client.database(databaseName);

  console.log(`cosmos: ${settings.COSMOS_ENDPOINT} / ${databaseName}`);

  await check('every container the schema declares exists', async () => {
    const { resources } = await repository.database.containers.readAll().fetchAll();
    const present = new Set(resources.map((container) => container.id));
    const missing = CONTAINER_LIST.map((definition) => definition.name).filter((name) => !present.has(name));
    console.log(`        present (${present.size}): ${[...present].sort().join(', ')}`);
    assert.deepEqual(missing, [], `missing: ${missing.join(', ')} - run "npm run azure:provision"`);
  });

  await check('sessions expires its rows (TTL on), so counters clean themselves up', async () => {
    const { resource } = await repository.database.container('sessions').read();
    assert.notEqual(resource.defaultTtl, undefined, 'defaultTtl is not set on sessions');
  });

  await check('each container has the partition key the code queries by', async () => {
    const wrong = [];
    for (const definition of CONTAINER_LIST) {
      try {
        const { resource } = await repository.database.container(definition.name).read();
        const path = resource.partitionKey?.paths?.[0];
        if (path !== definition.partitionKeyPath) wrong.push(`${definition.name}: ${path} (want ${definition.partitionKeyPath})`);
      } catch (error) {
        if (error?.code !== 404) throw error;
      }
    }
    assert.deepEqual(wrong, []);
  });

  if (!WRITE) {
    console.log('  skip  write tests (pass --write to run them against scratch documents)');
  } else {
    const tag = `livecheck-${randomUUID().slice(0, 8)}`;
    const orderId = `ord_${tag}`;
    const listingId = `lst_${tag}`;
    const sellerId = `usr_${tag}`;
    const now = new Date().toISOString();
    try {
      await repository.database.container('orders').items.create({
        id: orderId, lotId: tag, listingId, sellerId, buyerId: sellerId, quantity: 1,
        status: 'pending', note: '', payments: [], placedAt: null, createdAt: now, updatedAt: now,
      });
      await repository.database.container('listings').items.create({
        id: listingId, sellerId, title: 'Live check', quantityAvailable: 5, quantityMode: 'fixed', status: 'draft',
        viewCount: 0, soldCount: 0, preOrder: null, createdAt: now, updatedAt: now,
      });

      await check('two writes to different fields of one order both land', async () => {
        const first = await repository.getOrder(orderId);
        const second = await repository.getOrder(orderId);
        assert.ok(first._etag, 'Cosmos returned no _etag');
        first.status = 'confirmed';
        await repository.updateOrder(first);
        second.note = 'gift wrap';
        const saved = await repository.updateOrder(second);
        assert.equal(saved.status, 'confirmed');
        assert.equal(saved.note, 'gift wrap');
      });

      await check('two payments at once: the second is refused with a real 412, not added', async () => {
        const first = await repository.getOrder(orderId);
        const second = await repository.getOrder(orderId);
        first.payments = [{ id: 'pay_a' }];
        await repository.updateOrder(first);
        second.payments = [{ id: 'pay_b' }];
        await assert.rejects(repository.updateOrder(second), StaleWriteError);
        assert.deepEqual((await repository.getOrder(orderId)).payments, [{ id: 'pay_a' }]);
      });

      await check('a caller can write the same order twice', async () => {
        const order = await repository.getOrder(orderId);
        order.note = 'one';
        await repository.updateOrder(order);
        order.note = 'two';
        await repository.updateOrder(order);
        assert.equal((await repository.getOrder(orderId)).note, 'two');
      });

      await check('a listing edit survives views counted in between (patch incr)', async () => {
        const listing = await repository.getListing(listingId);
        await repository.countView(listing);
        await repository.countView(listing);
        listing.title = 'Live check, edited';
        await repository.updateListing(listing);
        const stored = await repository.getListing(listingId);
        assert.equal(stored.title, 'Live check, edited');
        assert.equal(stored.viewCount, 2);
      });

      await check('a stale stock count does not overwrite stock just taken', async () => {
        const listing = await repository.getListing(listingId);
        assert.equal(await repository.takeStock({ listingId, quantity: 1 }), true);
        listing.quantityAvailable = 10;
        await assert.rejects(repository.updateListing(listing), StaleWriteError);
        assert.equal((await repository.getListing(listingId)).quantityAvailable, 4);
      });

      await check('shared counters count, read and take back (sessions container)', async () => {
        const id = `rl:${tag}`;
        assert.equal(await repository.bumpCounter(id, 0, 120), 0);
        assert.equal(await repository.bumpCounter(id, 1, 120), 1);
        assert.equal(await repository.bumpCounter(id, 1, 120), 2);
        assert.equal(await repository.bumpCounter(id, -1, 120), 1);
      });

      await check('two instances racing on one counter both count', async () => {
        const id = `rl:${tag}:race`;
        const totals = await Promise.all(Array.from({ length: 10 }, () => repository.bumpCounter(id, 1, 120)));
        assert.equal(Math.max(...totals), 10);
        assert.equal(await repository.bumpCounter(id, 0, 120), 10);
      });
    } finally {
      await repository.database.container('orders').item(orderId, tag).delete().catch(() => undefined);
      await repository.database.container('listings').item(listingId, sellerId).delete().catch(() => undefined);
      console.log(`        scratch documents ${tag} removed`);
    }
  }
  repository.client.dispose?.();
}

/* ── Deployed site ─────────────────────────────────────────────────────── */

console.log(`\nsite: https://${SWA_HOSTNAME}`);
const config = JSON.parse(await readFile(new URL('../app/public/staticwebapp.config.json', import.meta.url), 'utf8'));
try {
  const response = await fetch(`https://${SWA_HOSTNAME}/`, { signal: AbortSignal.timeout(15_000) });
  for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'Permissions-Policy']) {
    await check(`sends ${name} as configured`, () => {
      assert.equal(response.headers.get(name), config.globalHeaders[name], 'not deployed yet, or the config was rejected');
    });
  }
  const health = await fetch(`https://${SWA_HOSTNAME}/api/health`, { signal: AbortSignal.timeout(15_000) }).then((r) => r.json());
  await check('the deployed API reports no missing containers', () => {
    assert.equal(health.data?.backend, 'cosmos', `the deployed API is on ${health.data?.backend}`);
    assert.equal(health.data?.connected, true, health.data?.detail);
    assert.deepEqual(health.data?.missingContainers ?? [], []);
  });
} catch (error) {
  failed += 1;
  console.log(`  FAIL  site unreachable: ${error?.message ?? error}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
