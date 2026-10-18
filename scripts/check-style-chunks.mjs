/**
 * Chunk stylesheet checks.
 *
 * A rule in app/src/styles/<Chunk>.css only exists once that chunk has loaded.
 * That is right while every class it needs is written by code inside the
 * chunk, and silently wrong the day a component in it is used somewhere else:
 * the spinner's rules sat in the LotPeople chunk's sheet, the notification bell
 * started using the spinner, and on every page but a lot's people list the
 * bell's spinner would have been unstyled. Nothing fails and nothing warns -
 * the class is still defined, just not loaded yet.
 *
 * So: build the app, see which chunk every source file lands in, and require
 * each rule in a chunk's sheet to be about classes only that chunk writes. A
 * rule that fails belongs back in styles.css.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const APP = `${ROOT}/app`;
const fromApp = createRequire(`${APP}/package.json`);
const { build } = await import(fromApp.resolve('vite'));
const ts = fromApp('typescript');
const postcss = fromApp('postcss');

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

// ---- which chunk each source file lands in ---------------------------------
// The real production build, kept in memory: the chunk graph is the thing
// under test, so it has to be the one Vite would ship.
const chunks = [];
await build({
  root: APP,
  configFile: `${APP}/vite.config.ts`,
  logLevel: 'error',
  build: { write: false },
  plugins: [{
    name: 'chunk-map',
    generateBundle(_, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk') chunks.push({ fileName: item.fileName, modules: Object.keys(item.modules) });
      }
    },
  }],
});
const chunkOf = new Map();
for (const c of chunks) {
  for (const m of c.modules) {
    const file = m.split('?')[0];
    if (file.startsWith(ROOT) && !file.includes('node_modules')) chunkOf.set(file, c.fileName);
  }
}

// ---- which files can write each class --------------------------------------
function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') continue;
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.(tsx?|js|html)$/.test(name)) out.push(path);
  }
  return out;
}
const files = [...sourceFiles(`${APP}/src`), ...sourceFiles(`${ROOT}/shared`), ...sourceFiles(`${APP}/public/boot`), `${APP}/index.html`, `${APP}/admin.html`];

/**
 * The text of a file that can become a class: for code, its string and
 * template literals, each kept whole. Identifiers and comments are not class
 * names however they are spelled. HTML is taken as it is.
 */
function classText(file) {
  const text = readFileSync(file, 'utf8');
  if (!/\.(tsx?|js)$/.test(file) || file.includes('/public/')) return text;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const literals = [];
  (function visit(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      literals.push(node.getText(sf));
      if (ts.isTemplateExpression(node)) node.templateSpans.forEach((span) => visit(span.expression));
      return;
    }
    ts.forEachChild(node, visit);
  })(sf);
  return literals.join('\n');
}
const texts = new Map(files.map((file) => [file, classText(file)]));

// Classes built at runtime: `badge--${tone}` writes every class starting
// `badge--`, `${size}-wide` every class ending `-wide`.
const prefixes = new Map();
const suffixes = new Map();
for (const [file, text] of texts) {
  const pre = new Set();
  const suf = new Set();
  for (const [, p] of text.matchAll(/([A-Za-z][\w-]*[-_])\$\{/g)) pre.add(p);
  for (const [, p] of text.matchAll(/([A-Za-z][\w-]*[-_])['"`]\s*\+/g)) pre.add(p);
  for (const [, s] of text.matchAll(/\}([-_][\w-]+)/g)) suf.add(s);
  for (const [, s] of text.matchAll(/\+\s*['"`]([-_][\w-]+)/g)) suf.add(s);
  prefixes.set(file, pre);
  suffixes.set(file, suf);
}

// Classes React Router's NavLink adds itself: written by no file of ours, so
// never provably one chunk's.
const LIBRARY_CLASSES = new Set(['active', 'pending', 'transitioning']);
const usersCache = new Map();
function usersOf(cls) {
  if (LIBRARY_CLASSES.has(cls)) return new Set(['react-router']);
  if (usersCache.has(cls)) return usersCache.get(cls);
  const whole = new RegExp(`(?<![\\w-])${cls.replace(/-/g, '\\-')}(?![\\w-])`);
  const users = new Set();
  for (const [file, text] of texts) {
    if (whole.test(text)
      || [...prefixes.get(file)].some((p) => cls.startsWith(p) && cls.length > p.length)
      || [...suffixes.get(file)].some((s) => cls.endsWith(s) && cls.length > s.length)) users.add(file);
  }
  usersCache.set(cls, users);
  return users;
}

// ---- selectors ----------------------------------------------------------------
/** Split on `sep` outside parentheses and brackets. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth += 1;
    else if (ch === ')' || ch === ']') depth -= 1;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}
/**
 * The classes a selector requires. What sits inside `:not()`, `:is()` and the
 * like, and inside attribute selectors, is dropped: it narrows a match, it
 * cannot make one.
 */
function classesIn(selector) {
  let flat = '';
  let depth = 0;
  for (const ch of selector) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    else if (depth === 0) flat += ch;
  }
  return [...flat.replace(/\[[^\]]*\]/g, '').matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]);
}

// ---- the checks ---------------------------------------------------------------
const STYLES = `${APP}/src/styles`;
const sheets = readdirSync(STYLES).filter((name) => name.endsWith('.css')).sort();
const sheetChunk = new Map();
for (const c of chunks) for (const m of c.modules) if (m.startsWith(`${STYLES}/`) && m.endsWith('.css')) sheetChunk.set(resolve(m), c.fileName);

check('every chunk stylesheet ships in a chunk', () => {
  assert.ok(chunks.length > 10, `expected the app's chunks, the build produced ${chunks.length}`);
  const missing = sheets.filter((name) => !sheetChunk.has(`${STYLES}/${name}`));
  assert.deepEqual(missing, [], `not in any chunk: ${missing.join(', ')}`);
});

check('every chunk stylesheet rule styles only its own chunk', () => {
  // A rule passes when, in each of its selectors, some class it requires is
  // written only by files in the sheet's own chunk: wherever else the element
  // turns up, the rule cannot have matched it.
  const stranded = [];
  let rules = 0;
  for (const name of sheets) {
    const home = sheetChunk.get(`${STYLES}/${name}`);
    postcss.parse(readFileSync(`${STYLES}/${name}`, 'utf8')).walkRules((rule) => {
      for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return;
      rules += 1;
      const own = splitTop(rule.selector, ',').every((sel) => classesIn(sel).some((cls) => {
        const users = usersOf(cls);
        return users.size > 0 && [...users].every((file) => chunkOf.get(file) === home);
      }));
      if (own) return;
      const elsewhere = [...new Set(splitTop(rule.selector, ',').flatMap(classesIn))]
        .flatMap((cls) => [...usersOf(cls)].filter((file) => chunkOf.get(file) !== home).map((file) => `.${cls} in ${file.replace(`${ROOT}/`, '')}`));
      stranded.push(`styles/${name}: ${rule.selector.replace(/\s+/g, ' ')}${elsewhere.length ? ` (also used by ${elsewhere.slice(0, 3).join(', ')})` : ' (no file writes its classes)'}`);
    });
  }
  assert.ok(rules > 1000, `expected the chunk sheets' rules, found ${rules}`);
  assert.deepEqual(stranded, [], `move these rules back into styles.css, or keep their classes in the one chunk:\n  ${stranded.join('\n  ')}`);
});

console.log(`\n${passed} checks passed`);
