/**
 * Static check of the container definitions the database is built from.
 *
 * Neither test double reads an indexing policy: the in-memory store has no
 * indexes and the Cosmos fake accepts whatever it is handed. So a policy can be
 * syntactically invalid, pass every test, and fail only against a real
 * database - which is exactly what `/items/*​/description/?` did. Cosmos
 * refused the path, the container was never created, and every request that
 * read it answered 500 while 261 checks stayed green.
 *
 * A grammar is the right tool and there isn't one to hand, so this reads the
 * paths as text and enforces the rules that can only be broken in production.
 */
import assert from 'node:assert/strict';

const { CONTAINER_LIST, CONTAINERS, containerBody, SHARED_THROUGHPUT_RU } = await import(
  new URL('../api/dist/shared/containers.js', import.meta.url)
);

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/** Every indexing path any container declares, with where it came from. */
function paths() {
  const found = [];
  for (const definition of CONTAINER_LIST) {
    for (const path of definition.excludedPaths ?? []) {
      found.push({ container: definition.name, kind: 'excludedPaths', path });
    }
    for (const composite of definition.compositeIndexes ?? []) {
      for (const entry of composite) {
        found.push({ container: definition.name, kind: 'compositeIndexes', path: entry.path });
      }
    }
    for (const unique of definition.uniqueKeyPaths ?? []) {
      for (const path of unique) {
        found.push({ container: definition.name, kind: 'uniqueKeyPaths', path });
      }
    }
    found.push({ container: definition.name, kind: 'partitionKeyPath', path: definition.partitionKeyPath });
  }
  return found;
}

check('there are containers to check at all', () => {
  // A refactor that moves the definitions elsewhere must not turn this file
  // into a check that silently passes over nothing.
  assert.ok(CONTAINER_LIST.length >= 15, `expected the container definitions, found ${CONTAINER_LIST.length}`);
});

check('every indexing path starts at the root', () => {
  const offences = paths()
    .filter((entry) => !entry.path.startsWith('/'))
    .map((entry) => `${entry.container}.${entry.kind}: ${entry.path}`);
  assert.deepEqual(offences, [], `a path must begin with "/":\n  ${offences.join('\n  ')}`);
});

check('a wildcard only ever ends a path', () => {
  // `/photos/*` is "everything under photos". `/items/*/description/?` is a
  // syntax error: Cosmos has no mid-path wildcard, and an array's elements are
  // addressed with `[]` instead. The container is refused outright, so the
  // symptom is a missing container rather than a bad index.
  const offences = [];
  for (const entry of paths()) {
    const segments = entry.path.split('/');
    const wildcard = segments.indexOf('*');
    if (wildcard !== -1 && wildcard !== segments.length - 1) {
      offences.push(
        `${entry.container}.${entry.kind}: ${entry.path}` +
          ' — use [] for an array, and keep * at the end',
      );
    }
  }
  assert.deepEqual(offences, [], `a wildcard must terminate the path:\n  ${offences.join('\n  ')}`);
});

check('every path segment is one Cosmos accepts', () => {
  // Property names, `[]` for an array, and the two terminators. Anything else
  // is a typo that will only be caught by the service.
  const offences = [];
  for (const entry of paths()) {
    for (const segment of entry.path.split('/').slice(1)) {
      const ok = segment === '*' || segment === '?' || segment === '[]' || /^[A-Za-z0-9_$-]+$/.test(segment)
        || /^"[^"]+"$/.test(segment);
      if (!ok) offences.push(`${entry.container}.${entry.kind}: ${entry.path} (segment "${segment}")`);
    }
  }
  assert.deepEqual(offences, [], `not a valid path segment:\n  ${offences.join('\n  ')}`);
});

check('a composite index or unique key names one value, not a subtree', () => {
  // Both index a value, so both have to end at one. A composite index over
  // `/status/*` is meaningless and Cosmos says so at creation time.
  const offences = paths()
    .filter((entry) => entry.kind === 'compositeIndexes' || entry.kind === 'uniqueKeyPaths')
    .filter((entry) => entry.path.endsWith('/*'))
    .map((entry) => `${entry.container}.${entry.kind}: ${entry.path}`);
  assert.deepEqual(offences, [], `a subtree cannot be indexed as a value:\n  ${offences.join('\n  ')}`);
});

check('a partition key is a single top-level property', () => {
  // Nested partition keys exist in Cosmos but this schema does not use them,
  // and the repository builds every partition key value as one field.
  const offences = CONTAINER_LIST.filter(
    (definition) => !/^\/[A-Za-z0-9_$-]+$/.test(definition.partitionKeyPath),
  ).map((definition) => `${definition.name}: ${definition.partitionKeyPath}`);
  assert.deepEqual(offences, [], `not a single top-level property:\n  ${offences.join('\n  ')}`);
});

check('the shared-throughput container ceiling is not exceeded', () => {
  // A shared-throughput database allows 25 containers. The 26th is refused,
  // and the refusal arrives at deploy time on a database nobody can fix
  // without moving every container to dedicated throughput.
  assert.ok(
    CONTAINER_LIST.length <= 25,
    `${CONTAINER_LIST.length} containers, and a shared-throughput database allows 25`,
  );
  assert.equal(SHARED_THROUGHPUT_RU, 1000, 'the free tier grants 1000 RU/s');
});

check('every container is defined once and named after its key', () => {
  const offences = Object.entries(CONTAINERS)
    .filter(([key, definition]) => key !== definition.name)
    .map(([key, definition]) => `${key} is defined as "${definition.name}"`);
  assert.deepEqual(offences, [], `the key and the name must match:\n  ${offences.join('\n  ')}`);
});

check('the body sent to Cosmos carries what the definition declared', () => {
  // The definitions are data; `containerBody` is what the database actually
  // receives. A field dropped in translation is a policy nobody applied.
  for (const definition of CONTAINER_LIST) {
    const body = containerBody(definition);
    assert.equal(body.id, definition.name);
    assert.deepEqual(body.partitionKey.paths, [definition.partitionKeyPath]);

    const excluded = body.indexingPolicy.excludedPaths.map((entry) => entry.path);
    for (const path of definition.excludedPaths ?? []) {
      assert.ok(excluded.includes(path), `${definition.name} lost ${path} on the way to Cosmos`);
    }
    if (definition.uniqueKeyPaths) {
      assert.equal(body.uniqueKeyPolicy.uniqueKeys.length, definition.uniqueKeyPaths.length);
    }
  }
});

console.log(`\n${passed} checks passed`);
