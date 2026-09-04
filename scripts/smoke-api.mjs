/**
 * Smoke test for the HTTP contract.
 *
 * Calls the compiled route handlers directly with stand-in request/context
 * objects, so the status codes, response bodies and cookies can be checked
 * without an Azure Functions host. Run `npm run build:api` first.
 */
import assert from 'node:assert/strict';

const base = new URL('../api/dist/api/src/functions/', import.meta.url);
const { healthRoute: health } = await import(new URL('health.js', base));
const { loginRoute: login, logoutRoute: logout, meRoute: me } = await import(new URL('auth-routes.js', base));
const { listLotsRoute: listLots, lotManifestRoute: lotManifest } = await import(new URL('lot-routes.js', base));

/** Stand-ins for the runtime types; handlers use only these members. */
const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };

const req = ({ headers = {}, body, query = {}, params = {} } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params,
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

console.log('GET /api/health');

const healthResponse = await health(req(), ctx);

await check('reports the resolved backends', () => {
  assert.equal(healthResponse.status, 200);
  const body = healthResponse.jsonBody;
  assert.equal(body.service, 'figmark-api');
  // Nothing is configured in this environment, so it must say so rather than
  // claiming health.
  assert.equal(body.status, 'degraded');
  assert.equal(body.data.backend, 'memory');
  assert.equal(body.storage.backend, 'memory');
  assert.equal(body.auth.mode, 'mock');
  assert.equal(body.auth.demoAccounts.length, 5);
  // Hints describe the account, not a role.
  assert.ok(body.auth.demoAccounts.every((a) => typeof a.label === 'string'));
});

console.log('\nGET /api/lots');

await check('serves the catalog anonymously', async () => {
  const response = await listLots(req(), ctx);
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.lots.length, 2);
});

await check('filters the catalog by seller', async () => {
  const response = await listLots(req({ query: { sellerId: 'usr_kaiju' } }), ctx);
  assert.equal(response.jsonBody.lots.length, 2);
  const empty = await listLots(req({ query: { sellerId: 'nobody' } }), ctx);
  assert.equal(empty.jsonBody.lots.length, 0);
});

console.log('\nauth routes');

await check('GET /api/auth/me returns null when signed out', async () => {
  const response = await me(req(), ctx);
  assert.equal(response.status, 200);
  assert.equal(response.jsonBody.user, null);
  assert.equal(response.jsonBody.authMode, 'mock');
});

await check('POST /api/auth/login rejects a bad password with 401', async () => {
  const response = await login(req({ body: { username: 'kaiju', password: 'nope' } }), ctx);
  assert.equal(response.status, 401);
  assert.equal(response.jsonBody.error, 'invalid_credentials');
});

await check('POST /api/auth/login rejects a non-JSON body with 400', async () => {
  const response = await login(req(), ctx);
  assert.equal(response.status, 400);
  assert.equal(response.jsonBody.error, 'invalid_body');
});

const sellerLogin = await login(req({ body: { username: 'kaiju', password: 'figmark-dev' } }), ctx);

await check('POST /api/auth/login sets an HttpOnly session cookie', () => {
  assert.equal(sellerLogin.status, 200);
  assert.equal(sellerLogin.jsonBody.user.capabilities.canSell, true);
  const [cookie] = sellerLogin.cookies;
  assert.equal(cookie.name, 'figmark_session');
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.secure, true);
  assert.equal(cookie.sameSite, 'Lax');
  assert.equal(cookie.path, '/');
  assert.ok(cookie.maxAge > 0);
});

const sellerAuth = { authorization: `Bearer ${sellerLogin.jsonBody.token}` };

await check('GET /api/auth/me resolves the signed-in user', async () => {
  const response = await me(req({ headers: sellerAuth }), ctx);
  assert.equal(response.jsonBody.user.username, 'kaiju');
});

console.log('\nGET /api/lots/{sellerId}/{lotId}/manifest');

await check('refuses anonymous access with 401', async () => {
  const response = await lotManifest(
    req({ params: { sellerId: 'usr_kaiju', lotId: 'lot_gz_sep' } }),
    ctx,
  );
  assert.equal(response.status, 401);
});

await check("refuses another account reading someone else's manifest", async () => {
  // meera holds `sell` like everyone, so this proves ownership is checked
  // separately from capability - the exact gap a role check would have missed.
  const other = await login(req({ body: { username: 'meera', password: 'figmark-dev' } }), ctx);
  assert.equal(other.jsonBody.user.capabilities.canSell, true);
  const response = await lotManifest(
    req({
      headers: { authorization: `Bearer ${other.jsonBody.token}` },
      params: { sellerId: 'usr_kaiju', lotId: 'lot_gz_sep' },
    }),
    ctx,
  );
  assert.equal(response.status, 403);
  assert.equal(response.jsonBody.error, 'forbidden');
});

await check('admin reads across owners', async () => {
  const admin = await login(req({ body: { username: 'admin', password: 'figmark-dev' } }), ctx);
  const response = await lotManifest(
    req({
      headers: { authorization: `Bearer ${admin.jsonBody.token}` },
      params: { sellerId: 'usr_kaiju', lotId: 'lot_gz_sep' },
    }),
    ctx,
  );
  assert.equal(response.status, 200);
});

await check('lots carry a forwarder, from the directory or entered by hand', async () => {
  const { lots } = (await listLots(req(), ctx)).jsonBody;
  const fromDirectory = lots.find((l) => l.forwarder?.forwarderUserId !== null);
  const offPlatform = lots.find((l) => l.forwarder?.forwarderUserId === null);
  assert.ok(fromDirectory, 'expected a lot using a directory forwarder');
  assert.ok(offPlatform, 'expected a lot using an off-platform forwarder');
  assert.equal(offPlatform.forwarder.trackingReference, 'SSC-2026-08-4471');
});

await check("refuses a seller reading another seller's lot with 403", async () => {
  const response = await lotManifest(
    req({ headers: sellerAuth, params: { sellerId: 'usr_someone_else', lotId: 'lot_gz_sep' } }),
    ctx,
  );
  assert.equal(response.status, 403);
});

await check('returns the manifest with totals for the owning seller', async () => {
  const response = await lotManifest(
    req({ headers: sellerAuth, params: { sellerId: 'usr_kaiju', lotId: 'lot_gz_sep' } }),
    ctx,
  );
  assert.equal(response.status, 200);
  const { lot, orders, totals } = response.jsonBody;
  assert.equal(lot.id, 'lot_gz_sep');
  assert.equal(orders.length, 2);
  assert.equal(totals.lines, 2);
  assert.equal(totals.units, 3);
  assert.equal(totals.weightGrams, 4200);
  assert.equal(totals.valueMinor, 435000);
});

await check('404s an unknown lot', async () => {
  const response = await lotManifest(
    req({ headers: sellerAuth, params: { sellerId: 'usr_kaiju', lotId: 'lot_nope' } }),
    ctx,
  );
  assert.equal(response.status, 404);
});

await check('POST /api/auth/logout clears the cookie and ends the session', async () => {
  const response = await logout(req({ headers: sellerAuth }), ctx);
  assert.equal(response.status, 200);
  assert.equal(response.cookies[0].maxAge, 0);
  const after = await me(req({ headers: sellerAuth }), ctx);
  assert.equal(after.jsonBody.user, null);
});

console.log(`\n${passed} checks passed`);
