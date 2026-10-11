/**
 * Guards the username namespace against the app's own pages.
 *
 * Every person and shop lives at `/<username>`, and the router matches its own
 * pages first - so a username equal to a top-level route is a profile nobody
 * can open. The reserved list in shared/handles.ts used to be kept by hand and
 * fell behind the router (wallet, cart, quests and a dozen more). This reads
 * the router and the static web app's routes back and fails if any first path
 * segment is not in `APP_ROUTE_SEGMENTS`.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [router, swa, handles] = await Promise.all([
  read('../app/src/main.tsx'),
  read('../app/public/staticwebapp.config.json'),
  read('../shared/handles.ts'),
]);

const segments = new Set();
for (const [, path] of router.matchAll(/<Route\s+path="([^"]+)"/g)) segments.add(path.split('/')[1]);
for (const { route } of JSON.parse(swa).routes ?? []) segments.add(route.split('/')[1]);
for (const value of [...segments]) {
  // The root, the catch-all and the profile route itself are not names.
  if (!value || value === '*' || value.startsWith(':') || value.includes('*')) segments.delete(value);
}

const listed = handles.match(/APP_ROUTE_SEGMENTS[^=]*=\s*\[([\s\S]*?)\];/)?.[1];
assert.ok(listed, 'could not find APP_ROUTE_SEGMENTS in shared/handles.ts');
const reserved = new Set([...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]));

const missing = [...segments].filter((segment) => !reserved.has(segment)).sort();
assert.equal(
  missing.length,
  0,
  `top-level routes a username could shadow - add them to APP_ROUTE_SEGMENTS in shared/handles.ts: ${missing.join(', ')}`,
);
console.log(`handles: ${segments.size} top-level routes, all reserved`);

// Look-alikes of the platform and its staff are refused; ordinary names are not.
const { checkUsername, handleShapeProblem } = await import(new URL('../api/dist/shared/handles.js', import.meta.url));
for (const name of ['wallet', 'cart', 'escrow', 'figmark_support', 'f1gmark', 'fig.mark', 'official', '0fficial', 'support.team', 'help']) {
  assert.equal(checkUsername(name), 'reserved', `${name} should be reserved`);
}
for (const name of ['priya.s', 'badminton', 'supportive_mum', 'team_rocket', 'modern_home', 'l1ly']) {
  assert.equal(checkUsername(name), null, `${name} should be allowed`);
}
// Somebody who already holds a newly reserved word keeps a page that opens.
assert.equal(handleShapeProblem('official'), null);
console.log('handles: look-alikes refused, ordinary names allowed');
