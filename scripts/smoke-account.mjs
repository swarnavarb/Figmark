/**
 * Smoke test for the account's own data and the browser's errors: the export
 * holds what the account made and nothing the server keeps for itself; a
 * client error is logged and cut short; sign-up asks Turnstile when it is set
 * up. Turnstile is configured here and Cloudflare's answer is stood in for.
 */
import assert from 'node:assert/strict';

process.env.FIGMARK_RATE_LIMITS = 'off';
process.env.TURNSTILE_SITE_KEY = 'test-site-key';
process.env.TURNSTILE_SECRET_KEY = 'test-secret-key';

const realFetch = globalThis.fetch;
let turnstileSays = true;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith('https://challenges.cloudflare.com/')) {
    const sent = JSON.parse(init.body);
    assert.equal(sent.secret, 'test-secret-key');
    return new Response(JSON.stringify({ success: turnstileSays && sent.response === 'good-token' }));
  }
  return realFetch(url, init);
};

const fns = new URL('../api/dist/api/src/functions/', import.meta.url);
const { signupRoute: signup, loginRoute: login } = await import(new URL('auth-routes.js', fns));
const { exportMineRoute: exportMine, clientErrorRoute: clientError } = await import(new URL('account-routes.js', fns));
const { healthRoute: health } = await import(new URL('health.js', fns));

const logged = [];
const ctx = { error: () => {}, log: () => {}, warn: (line) => logged.push(line), info: () => {} };
const req = ({ headers = {}, body } = {}) => ({
  method: body === undefined ? 'GET' : 'POST',
  headers: new Headers(headers),
  query: new URLSearchParams(),
  params: {},
  json: async () => body,
});

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const person = { displayName: 'Exporter', email: 'export@figmark.example', phone: '+919811100077', password: 'a-fine-passphrase-8', acceptTerms: true };

await check('sign-up asks Turnstile when it is set up, and says so on /api/health', async () => {
  assert.equal((await health(req(), ctx)).jsonBody.auth.captchaSiteKey, 'test-site-key');
  assert.equal((await signup(req({ body: person }), ctx)).jsonBody.error, 'captcha_failed');
  assert.equal((await signup(req({ body: { ...person, captchaToken: 'bad-token' } }), ctx)).status, 400);
  assert.equal((await signup(req({ body: { ...person, captchaToken: 'good-token' } }), ctx)).status, 201);
});

await check('the export holds the account and its records, and nothing only the server keeps', async () => {
  const session = await login(req({ body: { identifier: person.email, password: person.password } }), ctx);
  const as = { authorization: `Bearer ${session.jsonBody.token}` };
  const response = await exportMine(req({ headers: as }), ctx);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-disposition'), /attachment; filename="figmark-/);
  const body = response.jsonBody;
  assert.equal(body.account.email, person.email);
  for (const key of ['listings', 'purchases', 'sales', 'posts', 'messages', 'disputes']) assert.ok(Array.isArray(body[key]), key);
  const text = JSON.stringify(body);
  for (const secret of ['passwordHash', '"mfa"', '"challenges"']) assert.ok(!text.includes(secret), `no ${secret}`);
  assert.equal((await exportMine(req(), ctx)).status, 401, 'signed out: nothing');
});

await check('a browser error is logged, cut short, and needs a message', async () => {
  const sent = await clientError(req({ body: { message: 'x'.repeat(5000), stack: 'at foo', url: '/order/ord_1?token=secret' } }), ctx);
  assert.equal(sent.status, 202);
  const line = logged.at(-1);
  assert.match(line, /^Client error: /);
  const report = JSON.parse(line.slice('Client error: '.length));
  assert.equal(report.message.length, 500);
  assert.equal(report.url, '/order/ord_1', 'the query string is dropped');
  assert.equal((await clientError(req({ body: {} }), ctx)).status, 400);
});

console.log(`\n${passed} account checks passed`);
