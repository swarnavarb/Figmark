/**
 * Validates `staticwebapp.config.json` against the shape Azure accepts.
 *
 * Azure rejects a config that fails its schema and then serves the site as if
 * the file were not there — no build failure, no deploy failure, just routing
 * that silently reverts to defaults. That is how a single `"comment"` key
 * inside a route object took the whole operations console offline while the
 * deploy went green.
 *
 * The key sets below come from the published schema at
 * https://www.schemastore.org/staticwebapp.config.json, where every object has
 * `additionalProperties: false`. They are copied rather than fetched because a
 * check that needs the network is a check that fails on a bad day.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const path = new URL('../app/public/staticwebapp.config.json', import.meta.url);
const raw = await readFile(path, 'utf8');

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

const TOP_LEVEL = new Set([
  '$schema', 'auth', 'forwardingGateway', 'globalHeaders', 'mimeTypes',
  'navigationFallback', 'networking', 'platform', 'responseOverrides', 'routes', 'trailingSlash',
]);
const ROUTE = new Set(['allowedRoles', 'headers', 'methods', 'redirect', 'rewrite', 'route', 'statusCode']);
const NAVIGATION_FALLBACK = new Set(['rewrite', 'exclude']);

let config;

check('is valid JSON', () => {
  config = JSON.parse(raw);
});

check('uses only keys Azure recognises at the top level', () => {
  const unknown = Object.keys(config).filter((key) => !TOP_LEVEL.has(key));
  assert.deepEqual(unknown, [], `unknown top-level key(s): ${unknown.join(', ')}`);
});

check('every route uses only keys Azure recognises', () => {
  // The one that bit: JSON has no comments, and a route object is not a place
  // to invent one. Explanations belong in the docs beside it.
  const offences = [];
  for (const route of config.routes ?? []) {
    assert.ok(route.route, 'every route needs a `route`');
    for (const key of Object.keys(route)) {
      if (!ROUTE.has(key)) offences.push(`${route.route}: ${key}`);
    }
  }
  assert.deepEqual(offences, [], `unknown route key(s): ${offences.join(', ')}`);
});

check('the navigation fallback uses only keys Azure recognises', () => {
  const fallback = config.navigationFallback;
  if (!fallback) return;
  const unknown = Object.keys(fallback).filter((key) => !NAVIGATION_FALLBACK.has(key));
  assert.deepEqual(unknown, [], `unknown navigationFallback key(s): ${unknown.join(', ')}`);
});

check('the API is matched before anything that would rewrite it', () => {
  // Routes are evaluated in order and the first match wins, so a broad rewrite
  // placed above `/api/*` would swallow every request the app makes.
  const routes = config.routes ?? [];
  const api = routes.findIndex((route) => route.route === '/api/*');
  assert.notEqual(api, -1, 'the API needs an explicit route');
  const rewriteAbove = routes.slice(0, api).filter((route) => route.rewrite);
  assert.deepEqual(rewriteAbove, [], 'nothing may rewrite ahead of /api/*');
});

check('both bundles are reachable: one served, one fallen back to', () => {
  // The marketplace falls through to index.html; the console is a bundle of its
  // own and has to be excluded from that fallback and routed to its own file.
  const fallback = config.navigationFallback ?? {};
  assert.equal(fallback.rewrite, '/index.html');
  assert.ok(
    (fallback.exclude ?? []).some((pattern) => pattern.startsWith('/admin')),
    'the console must be excluded from the marketplace fallback',
  );
  assert.ok(
    (config.routes ?? []).some((route) => route.route.startsWith('/admin') && route.rewrite === '/admin.html'),
    'the console must be routed to its own bundle',
  );
});

check('shared links answer with their preview, not the bare app', () => {
  // WhatsApp and the rest read a link's preview from the HTML it first
  // answers with and never run the app. Lose one of these rewrites and that
  // kind of link goes back to unfolding into the word "Figmark", with every
  // check still green - the app itself still opens it fine.
  const routes = config.routes ?? [];
  const api = routes.findIndex((route) => route.route === '/api/*');
  for (const prefix of ['/r/*', '/i/*', '/s/*']) {
    const index = routes.findIndex((route) => route.route === prefix);
    assert.notEqual(index, -1, `${prefix} needs a route`);
    assert.equal(routes[index].rewrite, '/api/og', `${prefix} must be answered by /api/og`);
    assert.ok(index > api, `${prefix} must come after /api/*`);
  }
});

check('the service worker is always fetched fresh', () => {
  // Browsers look for a new service worker on every visit, but a cached
  // sw.js would keep the old one running for as long as the cache says -
  // and a broken notification handler with it.
  const route = (config.routes ?? []).find((entry) => entry.route === '/sw.js');
  assert.ok(route, '/sw.js needs a route');
  assert.equal(route.headers?.['Cache-Control'], 'no-cache');
});

check('every page is sent with the security headers', () => {
  const headers = config.globalHeaders ?? {};
  for (const name of ['Content-Security-Policy', 'Strict-Transport-Security', 'Permissions-Policy', 'X-Content-Type-Options', 'X-Frame-Options']) {
    assert.ok(headers[name], `globalHeaders needs ${name}`);
  }
  const csp = Object.fromEntries(headers['Content-Security-Policy'].split(';').map((part) => {
    const [directive, ...values] = part.trim().split(/\s+/);
    return [directive, values];
  }));
  // The point of the policy: a script that got into the page by way of
  // somebody's listing or message does not run.
  assert.deepEqual(csp['script-src'], ["'self'"], 'scripts come from this site only, none inline');
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.match(headers['Strict-Transport-Security'], /max-age=\d{7,}/);
  // Scanning an Aadhaar QR needs the camera; nothing needs the microphone or location.
  assert.match(headers['Permissions-Policy'], /camera=\(self\)/);
  assert.match(headers['Permissions-Policy'], /geolocation=\(\)/);
});

check('neither page carries an inline script the policy would block', () => {
  for (const page of ['index.html', 'admin.html']) {
    const html = readFileSync(new URL(`../app/${page}`, import.meta.url), 'utf8');
    const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
      .filter(([, attributes, body]) => !/\bsrc=/.test(attributes) && body.trim());
    assert.deepEqual(inline.map(([tag]) => tag.slice(0, 60)), [], `${page} has an inline script; move it to app/public/boot/`);
  }
});

console.log(`\n${passed} checks passed`);
