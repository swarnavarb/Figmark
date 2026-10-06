/**
 * Smoke test for where people use Figmark: each copy of the site reporting
 * itself, and the operators' totals built from those reports. Run
 * `npm run build:api` first.
 */
import assert from 'node:assert/strict';

process.env.FIGMARK_RATE_LIMITS = 'off';
const fns = new URL('../api/dist/api/src/functions/', import.meta.url);
const { signupRoute: signup, loginRoute: login, meRoute: me } = await import(new URL('auth-routes.js', fns));
const { deviceReportRoute: report, deviceFiguresRoute: figuresRoute } = await import(new URL('device-routes.js', fns));
const { deviceFigures, percent } = await import(new URL('../api/dist/shared/devices.js', import.meta.url));
const { DEMO_EMAIL, DEMO_PASSWORD } = await import(new URL('../api/dist/api/src/data/seed.js', import.meta.url));
const { getRepository } = await import(new URL('../api/dist/api/src/data/index.js', import.meta.url));
const repository = await getRepository();

const ctx = { error: () => {}, log: () => {}, warn: () => {}, info: () => {} };
const req = ({ headers = {}, body } = {}) => ({
  headers: new Headers(headers),
  query: new URLSearchParams(),
  params: {},
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  },
});

let passed = 0;
async function check(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

async function person(name, phone) {
  const made = await signup(req({
    body: { displayName: name, email: `${name.toLowerCase()}@devices.example`, phone, password: 'longenough1' },
  }), ctx);
  assert.equal(made.status, 201, JSON.stringify(made.jsonBody));
  return { id: made.jsonBody.user.id, auth: { authorization: `Bearer ${made.jsonBody.token}` } };
}

const meera = await person('Meera', '+919000072001');
const kabir = await person('Kabir', '+919000072002');
const admin = await login(req({ body: { identifier: DEMO_EMAIL, password: DEMO_PASSWORD } }), ctx);
const adminAuth = { authorization: `Bearer ${admin.jsonBody.token}` };

const device = (over = {}) => ({
  id: 'dev_safari_0001', platform: 'ios', browser: 'safari', installed: false, push: 'needs-install', ...over,
});
const devicesOf = async (id) => (await repository.getUserById(id)).clientDevices ?? [];

await check('a copy of the site reports itself', async () => {
  const sent = await report(req({ headers: meera.auth, body: device() }), ctx);
  assert.equal(sent.status, 200);
  const [row] = await devicesOf(meera.id);
  assert.equal(row.platform, 'ios');
  assert.equal(row.installedAt, null, 'Safari in a tab is not installed');
});

await check('only a real report is kept', async () => {
  for (const body of [
    device({ id: 'x' }), device({ platform: 'nokia' }), device({ browser: '<script>' }),
    device({ installed: 'yes' }), device({ push: 'maybe' }),
  ]) {
    assert.equal((await report(req({ headers: meera.auth, body }), ctx)).status, 400, JSON.stringify(body));
  }
  assert.equal((await report(req({ body: device() }), ctx)).status, 401);
});

await check('the home-screen copy counts as installed, and stays installed', async () => {
  await report(req({ headers: meera.auth, body: device({ id: 'dev_homescr_001', installed: true, push: 'on' }) }), ctx);
  const home = (await devicesOf(meera.id)).find((row) => row.id === 'dev_homescr_001');
  assert.ok(home.installedAt);
  const first = home.installedAt;
  await report(req({ headers: meera.auth, body: device({ id: 'dev_homescr_001', installed: true, push: 'off' }) }), ctx);
  const again = (await devicesOf(meera.id)).find((row) => row.id === 'dev_homescr_001');
  assert.equal(again.installedAt, first, 'the first time is the one that counts');
  assert.equal(again.push, 'off', 'but the current notification state is what it says now');
});

await check('reporting the same thing again does not write', async () => {
  const before = (await repository.getUserById(meera.id)).updatedAt;
  await new Promise((resolve) => setTimeout(resolve, 5));
  await report(req({ headers: meera.auth, body: device({ id: 'dev_homescr_001', installed: true, push: 'off' }) }), ctx);
  assert.equal((await repository.getUserById(meera.id)).updatedAt, before);
});

await check('the list of copies never leaves the server', async () => {
  const mine = await me(req({ headers: meera.auth }), ctx);
  assert.ok(!JSON.stringify(mine.jsonBody).includes('dev_homescr_001'));
});

await check('the totals are by person, per kind of device', async () => {
  await report(req({ headers: kabir.auth, body: device({ id: 'dev_android_001', platform: 'android', browser: 'chrome', push: 'needs-install' }) }), ctx);
  await report(req({ headers: kabir.auth, body: device({ id: 'dev_windows_001', platform: 'windows', browser: 'edge', push: 'on' }) }), ctx);

  const response = await figuresRoute(req({ headers: adminAuth }), ctx);
  assert.equal(response.status, 200);
  const figures = response.jsonBody;
  const ios = figures.platforms.find((row) => row.group === 'ios');
  assert.equal(ios.people, 1, 'Safari and the home screen on one iPhone are one iPhone user');
  assert.equal(ios.installed, 1);
  const android = figures.platforms.find((row) => row.group === 'android');
  assert.equal(android.people, 1);
  assert.equal(android.installed, 0);
  const desktop = figures.platforms.find((row) => row.group === 'desktop');
  assert.equal(desktop.pushOn, 1);
  assert.ok(figures.browsers.some((row) => row.group === 'ios' && row.browser === 'safari' && row.people === 1));
  assert.ok(!figures.browsers.some((row) => row.group === 'ios' && row.people > 1), 'the home-screen copy is not a browser');
});

await check('only an operator sees the totals', async () => {
  assert.equal((await figuresRoute(req({ headers: meera.auth }), ctx)).status, 403);
  assert.equal((await figuresRoute(req(), ctx)).status, 401);
});

await check('the arithmetic', async () => {
  const now = Date.parse('2026-10-06T00:00:00Z');
  const seen = (days) => new Date(now - days * 86_400_000).toISOString();
  const row = (over) => ({ id: 'd', platform: 'ios', browser: 'safari', installed: false, installedAt: null, push: 'off', firstSeen: seen(30), lastSeen: seen(1), ...over });
  const figures = deviceFigures([
    { clientDevices: [row({ installedAt: seen(2) })] },
    { clientDevices: [row({})] },
    { clientDevices: [row({ lastSeen: seen(20) })] },
    { clientDevices: [] },
    {},
  ], now);
  assert.equal(figures.people, 3, 'accounts that never reported are not people here');
  assert.equal(figures.installed, 1);
  assert.equal(figures.active7d, 2);
  assert.equal(percent(1, 3), '33%');
  assert.equal(percent(0, 0), '-');
});

console.log(`${passed} checks passed`);
