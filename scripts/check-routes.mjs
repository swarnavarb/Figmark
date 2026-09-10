/**
 * Guards against duplicate Azure Functions route templates.
 *
 * The Functions host treats two functions sharing a route template as a
 * conflict, even when their HTTP methods differ. The local dev server keeps its
 * own route table and so never noticed - which is exactly how a conflicting
 * `lots` registration reached a deployment and broke it while every local check
 * stayed green. This reads the registrations back from the compiled API and
 * fails if any template appears twice.
 */
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const dir = new URL('../api/dist/api/src/functions/', import.meta.url);
const files = (await readdir(dir)).filter((name) => name.endsWith('.js'));

const registrations = [];
for (const file of files) {
  const source = await readFile(new URL(file, dir), 'utf8');
  // Registrations are emitted as app.http('name', { ... route: 'x' ... }).
  const blocks = source.matchAll(/app\.http\(\s*'([^']+)'\s*,\s*(\{[\s\S]*?\})\s*\)/g);
  for (const [, name, body] of blocks) {
    const route = body.match(/route:\s*'([^']+)'/)?.[1];
    const methods = [...body.matchAll(/'(GET|POST|PUT|PATCH|DELETE)'/g)].map((m) => m[1]);
    if (route) registrations.push({ name, route, methods, file });
  }
}

assert.ok(registrations.length > 0, 'found no route registrations to check');

const byRoute = new Map();
for (const entry of registrations) {
  byRoute.set(entry.route, [...(byRoute.get(entry.route) ?? []), entry]);
}

const conflicts = [...byRoute.entries()].filter(([, entries]) => entries.length > 1);
for (const [route, entries] of conflicts) {
  console.error(
    `  CONFLICT  route '${route}' registered by: ${entries.map((e) => `${e.name} (${e.file})`).join(', ')}`,
  );
}

assert.equal(
  conflicts.length,
  0,
  `${conflicts.length} duplicate route template(s); the Functions host rejects these`,
);

// The host keys functions by name, not by the file they came from, so two
// modules that both register a 'users' are one registration between them - and
// the one that loses is simply absent, answering 404 while every local check
// passes.
const byName = new Map();
for (const entry of registrations) {
  byName.set(entry.name, [...(byName.get(entry.name) ?? []), entry]);
}
const repeated = [...byName.entries()].filter(([, entries]) => entries.length > 1);
for (const [name, entries] of repeated) {
  console.error(`  CONFLICT  function name '${name}' registered by: ${entries.map((e) => e.file).join(', ')}`);
}
assert.equal(repeated.length, 0, `${repeated.length} duplicate function name(s)`);

// A route template is matched by its shape, not by what the parameters are
// called: 'orders/{id}' and 'orders/{orderId}' are the same template to the
// host and conflict, which the exact-string check above cannot see.
const byShape = new Map();
for (const entry of registrations) {
  const shape = entry.route.replace(/\{[^}]*\}/g, '{}');
  byShape.set(shape, [...(byShape.get(shape) ?? []), entry]);
}
const shaped = [...byShape.entries()].filter(([, entries]) => entries.length > 1);
for (const [shape, entries] of shaped) {
  console.error(
    `  CONFLICT  template '${shape}' shared by: ${entries.map((e) => `${e.route} (${e.name})`).join(', ')}`,
  );
}
assert.equal(shaped.length, 0, `${shaped.length} route template(s) differing only in parameter name`);

// The Functions host serves its own management API from /admin, and refuses a
// function route that collides with it - regardless of the /api prefix the
// route ends up behind. It refuses quietly: the deploy succeeds, the rest of
// the app works, and only those routes answer 404. That is exactly what took
// the operations console down, and nothing local could see it, because the dev
// server has no reserved names.
const RESERVED_PREFIXES = ['admin', 'runtime'];
const reserved = registrations.filter((entry) =>
  RESERVED_PREFIXES.includes(entry.route.split('/')[0].toLowerCase()),
);
for (const entry of reserved) {
  console.error(
    `  RESERVED  '${entry.route}' (${entry.name}, ${entry.file}) starts with a segment the host keeps for itself`,
  );
}
assert.equal(reserved.length, 0, `${reserved.length} route(s) under a reserved prefix; the host will not serve these`);

// Every registration must be reachable, and it is only reachable if the entry
// point imports the module it lives in. The v4 model registers as a side
// effect of import, so a module nobody imports is a set of routes that answer
// 404 on the deployed host and work perfectly in every local check, because
// the dev server keeps a route table of its own.
const entryPoint = await readFile(new URL('../api/dist/api/src/index.js', import.meta.url), 'utf8');
const unimported = [...new Set(registrations.map((entry) => entry.file))].filter(
  (file) => !entryPoint.includes(`functions/${file}`),
);
for (const file of unimported) {
  console.error(`  UNREACHABLE  ${file} registers routes but index.js never imports it`);
}
assert.equal(unimported.length, 0, `${unimported.length} route module(s) missing from the entry point`);

console.log(
  `  ok  ${registrations.length} routes registered: templates, names and shapes unique, every module imported`,
);
for (const entry of registrations.sort((a, b) => a.route.localeCompare(b.route))) {
  console.log(`      ${entry.methods.join('/').padEnd(5)} /api/${entry.route}`);
}
