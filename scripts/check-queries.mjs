/**
 * Static check of the SQL the Cosmos repository sends.
 *
 * Neither test double parses a query: the in-memory store filters in
 * JavaScript, and the Cosmos fake answers whatever the query asked for. So a
 * query can be syntactically invalid, pass every test, and fail only against a
 * real database — which is exactly what `c.from.handle` did. `FROM` is a
 * reserved word in Cosmos SQL, the parser rejected the statement, and the inbox
 * answered 400 on the deployed site while 115 checks stayed green.
 *
 * A parser is the right tool and there isn't one to hand, so this reads the
 * queries as text and enforces the two rules that can only be broken in
 * production:
 *
 *   1. A reserved word can only be reached through the bracket form.
 *   2. ORDER BY needs an indexed path, so it cannot name an excluded one.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../api/src/data/cosmos-repository.ts', import.meta.url), 'utf8');
const { CONTAINER_LIST } = await import(new URL('../api/dist/shared/containers.js', import.meta.url));

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/**
 * Cosmos SQL keywords that are also plausible property names.
 *
 * Not the full grammar — the ones a document model actually collides with. A
 * property called `from`, `order` or `value` is ordinary JSON and a syntax
 * error in a query.
 */
const RESERVED = new Set([
  'and', 'array', 'as', 'asc', 'between', 'by', 'case', 'cast', 'convert',
  'cross', 'desc', 'distinct', 'else', 'end', 'escape', 'exists', 'false',
  'for', 'from', 'group', 'having', 'in', 'inner', 'insert', 'into', 'is',
  'join', 'left', 'like', 'limit', 'not', 'null', 'offset', 'or', 'order',
  'outer', 'over', 'right', 'select', 'set', 'then', 'top', 'true', 'udf',
  'undefined', 'union', 'update', 'value', 'when', 'where', 'with',
]);

/** The SQL string literals in the repository, comments stripped. */
function queries() {
  const found = [];
  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    // Comments explain the queries and quote fragments of them; they are not
    // sent anywhere, so they must not be read as if they were.
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;
    for (const [, literal] of line.matchAll(/'([^']*)'/g)) {
      if (/\bSELECT\b|\bORDER BY\b/i.test(literal)) found.push(literal);
    }
  }
  return found;
}

const all = queries();

check('there are queries to check at all', () => {
  // A refactor that moves the SQL elsewhere must not turn this file into a
  // check that silently passes over nothing.
  assert.ok(all.length >= 10, `expected the repository's queries, found ${all.length}`);
});

check('no query reaches a reserved word through dot notation', () => {
  const offences = [];
  for (const query of all) {
    // `c.from` is the error; `c["from"]` is the fix, and does not match here
    // because the property follows a bracket rather than a dot.
    for (const [, alias, property] of query.matchAll(/\b([a-z])\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      if (RESERVED.has(property.toLowerCase())) {
        offences.push(`${alias}.${property} in: ${query.slice(0, 90)}`);
      }
    }
  }
  assert.deepEqual(offences, [], `use c["${'name'}"] for a reserved word:\n  ${offences.join('\n  ')}`);
});

check('nothing is ordered by a path excluded from the index', () => {
  // An excluded path carries no index, and ORDER BY over one is refused at
  // query time rather than merely being slow.
  const excluded = new Set();
  for (const definition of CONTAINER_LIST) {
    for (const path of definition.excludedPaths ?? []) {
      const property = path.replace(/^\//, '').replace(/\/(\?|\*)$/, '');
      if (property) excluded.add(property);
    }
  }

  const offences = [];
  for (const query of all) {
    const ordered = query.match(/ORDER BY\s+[a-z]\.([A-Za-z_][A-Za-z0-9_]*)/i);
    if (ordered && excluded.has(ordered[1])) offences.push(`${ordered[1]} in: ${query.slice(0, 90)}`);
  }
  assert.deepEqual(offences, [], `ordered by an unindexed path:\n  ${offences.join('\n  ')}`);
});

check('every parameter a query names is actually supplied', () => {
  // A missing parameter is another 400 that no test double would notice: both
  // of them ignore the parameter list entirely.
  const offences = [];
  for (const match of source.matchAll(/'([^']*(?:SELECT|ORDER BY)[^']*)'/gi)) {
    const query = match[1];
    const placeholders = [...query.matchAll(/@[A-Za-z0-9_]+/g)].map(([name]) => name);
    if (placeholders.length === 0) continue;

    // The names supplied in the window of source that follows the query. A
    // window rather than a bracket match, because a parameter's own value can
    // be an array and the first `]` is then not the end of the list.
    const window = source.slice(match.index, match.index + 600);
    const named = new Set([...window.matchAll(/name:\s*'(@[A-Za-z0-9_]+)'/g)].map(([, name]) => name));
    for (const placeholder of placeholders) {
      if (!named.has(placeholder)) offences.push(`${placeholder} in: ${query}`);
    }
  }
  assert.deepEqual(offences, [], `parameter named but never supplied:\n  ${offences.join('\n  ')}`);
});

console.log(`\n${passed} checks passed`);
