/**
 * Smoke test for the two-factor rule on staff: with STAFF_MFA=on, an operator
 * cannot act until two-factor sign-in is on, and then can. Its own process,
 * because configuration is read once at import.
 */
import assert from 'node:assert/strict';
import { fixtures, useFixtures } from './fixtures.mjs';

process.env.STAFF_MFA = 'on';
process.env.FIGMARK_RATE_LIMITS = 'off';

const base = new URL('../api/dist/', import.meta.url);
const fns = new URL('api/src/functions/', base);
const { loginRoute: login, mfaSetupRoute: setup, mfaEnableRoute: enable } = await import(new URL('auth-routes.js', fns));
const { adminUsersRoute: adminUsers } = await import(new URL('admin-routes.js', fns));
const { codeAt, stepAt } = await import(new URL('api/src/auth/totp.js', base));
await useFixtures();

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body, query = {} } = {}) => ({
  method: body === undefined ? 'GET' : 'POST',
  headers: new Headers(headers),
  query: new URLSearchParams(query),
  params: {},
  json: async () => body,
});

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

await check('an operator without two-factor is told to turn it on, and can act once it is', async () => {
  const session = await login(req({ body: { identifier: 'demo@figmark.in', password: 'figmark123' } }), ctx);
  assert.equal(session.status, 200);
  assert.equal(session.jsonBody.user.mfaRequired, true);
  const as = { authorization: `Bearer ${session.jsonBody.token}` };
  const refused = await adminUsers(req({ headers: as }), ctx);
  assert.equal(refused.status, 403);
  assert.equal(refused.jsonBody.error, 'mfa_required_for_staff');

  const started = await setup(req({ headers: as, body: { password: 'figmark123' } }), ctx);
  assert.equal(started.status, 200);
  const on = await enable(req({ headers: as, body: { code: codeAt(started.jsonBody.secret, stepAt(Date.now())) } }), ctx);
  assert.equal(on.status, 200);
  assert.equal((await adminUsers(req({ headers: as }), ctx)).status, 200);
});

console.log(`\n${passed} staff two-factor checks passed`);
