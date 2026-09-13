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

/**
 * One statement, however many source literals it was written across.
 *
 * A long query is assembled by concatenating literals, and reading each of
 * those literals as a statement of its own means the parameters named in the
 * middle of one are never checked against anything. That is not hypothetical:
 * the catalog query names six, and five of them sat in fragments this check
 * used to skip.
 *
 * So a statement is the maximal run of literals joined by nothing but `+`,
 * whitespace, and plain identifiers - a clause picked out of a lookup, like the
 * ORDER BY that varies with the sort, is still part of the statement around it.
 * Those clauses are literals in their own right and are checked as statements
 * of their own, which is what keeps them honest about indexed paths.
 */
/**
 * Every string in the file, and the code with its comments taken out.
 *
 * Walked rather than matched with a regex. Comments are prose and carry
 * apostrophes; template literals carry them too ("the packer's view"). Either
 * way an apostrophe is an unmatched quote, and a scanner that pairs it with the
 * next real string shifts every string after it by one - which turned this
 * check into confident noise about statements nobody had written.
 *
 * Comment characters are blanked rather than deleted so every offset still
 * lines up with the file a person would open.
 */
function scan(text) {
  const pieces = [];
  let code = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const stop = text.indexOf('\n', i);
      const end = stop === -1 ? text.length : stop;
      code += ' '.repeat(end - i);
      i = end;
    } else if (two === '/*') {
      const stop = text.indexOf('*/', i + 2);
      const end = stop === -1 ? text.length : stop + 2;
      code += text.slice(i, end).replace(/[^\n]/g, ' ');
      i = end;
    } else if (text[i] === "'" || text[i] === '"' || text[i] === '`') {
      const quote = text[i];
      let j = i + 1;
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, text.length);
      pieces.push({ text: text.slice(i + 1, end - 1), start: i, end, quote });
      code += text.slice(i, end);
      i = end;
    } else {
      code += text[i];
      i += 1;
    }
  }
  return { code, pieces };
}

const { code, pieces: allStrings } = scan(source);

/** The string literals a query can be written in. A backtick cannot be static. */
const strings = allStrings.filter((piece) => piece.quote !== '`');

function statements() {
  const found = [];
  const pieces = strings;

  for (let i = 0; i < pieces.length; i += 1) {
    // A statement opens at SELECT, or at a bare clause like the ORDER BY that
    // varies with the sort - that clause is sent to the database like any other
    // SQL and has to be read like any other SQL.
    if (!/\bSELECT\b|\bORDER BY\b/i.test(pieces[i].text)) continue;
    let joined = pieces[i].text;
    let last = i;
    // Keep absorbing the next literal while only `+`, whitespace and bare
    // identifiers separate them. A quote in between means a different string,
    // and therefore a different statement.
    const glue = /^[\s+()]*(?:[A-Za-z_$][\w$]*(?:\.[\w$]+|\[[^\]'"`]*\])*[\s+?!()]*)*$/;
    while (
      last + 1 < pieces.length &&
      glue.test(code.slice(pieces[last].end, pieces[last + 1].start))
    ) {
      last += 1;
      joined += pieces[last].text;
    }
    found.push({ query: joined, end: pieces[last].end });
    i = last;
  }
  return found;
}

/**
 * The `parameters: [...]` that belongs to the statement ending at `from`.
 *
 * Bracket-counted rather than taken as a fixed slice of source: a parameter's
 * own value can be an array, so the first `]` is not the end of the list, and a
 * character window is a number that has to be raised every time a comment is
 * added. That is not hypothetical either - it was raised once already, and the
 * next parameter past the edge would simply have stopped being checked.
 */
function parameterList(text, from) {
  const marker = text.indexOf('parameters:', from);
  // Nothing between the statement and the list but whitespace, punctuation and
  // comments; anything else means this list belongs to a different query.
  if (marker === -1 || /['"`]|\bquery:/.test(text.slice(from, marker))) return '';

  const open = text.indexOf('[', marker);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '[') depth += 1;
    else if (text[i] === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  return text.slice(open);
}

check('a concatenated query is read as one statement', () => {
  // The guard on the guard: if the joining above ever stops working, the check
  // below silently goes back to inspecting fragments. The catalog query is the
  // long one - six parameters across seven literals - so it is the one that
  // would quietly stop being checked.
  const catalog = statements().find((entry) => entry.query.includes('c.status = "active"'));
  assert.ok(catalog, 'the catalog query was not found');
  for (const name of ['@seller', '@cat', '@cats', '@cond', '@price', '@kind']) {
    assert.ok(
      catalog.query.includes(name),
      `the catalog query was not joined end to end - ${name} is missing from ${catalog.query.slice(0, 100)}`,
    );
  }
});

check('every sort clause orders by a path the index carries', () => {
  // The ORDER BY varies with the sort, so each clause is its own literal. They
  // are statements to this checker like any other - this asserts they are
  // actually being seen, because an unindexed one is a 400 at query time and
  // nothing before then would say so.
  const clauses = statements().filter((entry) => /^\s*ORDER BY/.test(entry.query));
  assert.ok(clauses.length >= 3, `expected the sort clauses, found ${clauses.length}`);
  for (const { query } of clauses) {
    assert.match(query, /LIMIT @limit$/, `a sort clause must carry its own limit: ${query}`);
  }
});

check('every parameter a query names is actually supplied', () => {
  // A missing parameter is another 400 that no test double would notice: both
  // of them ignore the parameter list entirely.
  const offences = [];
  for (const { query, end } of statements()) {
    // Only whole statements: a clause kept in a lookup takes its parameters
    // from whichever statement pastes it in, which is checked there.
    if (!/\bSELECT\b/i.test(query)) continue;
    const placeholders = [...query.matchAll(/@[A-Za-z0-9_]+/g)].map(([name]) => name);
    if (placeholders.length === 0) continue;

    const window = parameterList(code, end);
    const named = new Set([...window.matchAll(/name:\s*'(@[A-Za-z0-9_]+)'/g)].map(([, name]) => name));
    for (const placeholder of new Set(placeholders)) {
      if (!named.has(placeholder)) offences.push(`${placeholder} in: ${query.slice(0, 90)}`);
    }
  }
  assert.deepEqual(offences, [], `parameter named but never supplied:\n  ${offences.join('\n  ')}`);
});

check('no query is assembled from a template literal', () => {
  // A query built by interpolation cannot be read before it is sent, which is
  // the whole premise of this file. The repository builds every statement from
  // fixed literals and supplies the values as parameters; a backtick around SQL
  // would be the first exception, so it is refused rather than argued about.
  const offences = allStrings
    .filter((piece) => piece.quote === '`' && /\bSELECT\b|\bORDER BY\b/i.test(piece.text))
    .map((piece) => piece.text.slice(0, 90));
  assert.deepEqual(offences, [], `SQL in a template literal:\n  ${offences.join('\n  ')}`);
});

console.log(`\n${passed} checks passed`);
