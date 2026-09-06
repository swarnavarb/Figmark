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

console.log(`  ok  ${registrations.length} routes registered, no duplicate templates`);
for (const entry of registrations.sort((a, b) => a.route.localeCompare(b.route))) {
  console.log(`      ${entry.methods.join('/').padEnd(5)} /api/${entry.route}`);
}
