/**
 * Stylesheet checks.
 *
 * One stylesheet, one meaning per class name. The analytics panel took `.seg`
 * for a bar showing a leg of a journey; the segmented control had owned `.seg`
 * since the first week. Nothing failed, nothing warned, and every toggle in the
 * app - the sell form's, the power sale's, the Items tab's - quietly became a
 * two-row grid, because the later rule wins and both were one class deep.
 *
 * A stylesheet has no modules and no imports to make a collision loud, so the
 * check has to be here.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync(new URL('../app/src/styles.css', import.meta.url), 'utf8');

let passed = 0;
const check = (name, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};

/**
 * Every rule in the sheet, as selector plus declarations.
 *
 * Comments go first so a brace or a colon inside prose cannot open a rule, and
 * at-rule headers (`@media …{`) are dropped while their contents stay - the
 * rules inside a media query are rules like any other.
 */
function rules(source) {
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const found = [];
  const stack = [];
  let start = 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '{') {
      stack.push(text.slice(start, index).trim());
      start = index + 1;
    } else if (character === '}') {
      const selector = stack.pop() ?? '';
      const body = text.slice(start, index);
      // A block whose body still holds a brace is an at-rule wrapper; its inner
      // rules were already collected on their own way past this loop.
      if (selector && !selector.startsWith('@') && !body.includes('{')) {
        // Inside a media query or not. A breakpoint restating a property is a
        // deliberate override; two rules at the top level are two claims.
        found.push({ selector, body, conditional: stack.some((open) => open.startsWith('@')) });
      }
      start = index + 1;
    }
  }
  return found;
}

/** The `display` a rule declares, or null. */
function displayOf(body) {
  const match = /(?:^|;)\s*display\s*:\s*([^;}!]+)/.exec(body);
  return match ? match[1].trim() : null;
}

/**
 * The class names a selector targets at its own level.
 *
 * Only selectors that are a bare class - `.seg`, or `.seg, .coh` - count. A
 * descendant or state selector (`.seg button`, `.tile--tap:hover`) is narrowing
 * something already defined, which is the normal way to build on a class rather
 * than a second claim on the name.
 */
function bareClasses(selector) {
  return selector
    .split(',')
    .map((part) => part.trim())
    .filter((part) => /^\.[a-zA-Z0-9_-]+$/.test(part))
    .map((part) => part.slice(1));
}

const parsed = rules(css);

check('the stylesheet parses into rules', () => {
  assert.ok(parsed.length > 400, `expected the whole sheet, parsed ${parsed.length} rules`);
  const seg = parsed.filter((rule) => bareClasses(rule.selector).includes('seg'));
  assert.ok(seg.length > 0, 'the segmented control should be in there');
});

check('one class name means one thing', () => {
  // Two rules setting `display` on the same bare class are two different
  // components wearing one name: whichever is written later silently restyles
  // the other everywhere it is used.
  const claims = new Map();
  for (const rule of parsed) {
    if (rule.conditional) continue;
    const display = displayOf(rule.body);
    if (!display) continue;
    for (const name of bareClasses(rule.selector)) {
      const seen = claims.get(name);
      if (seen && seen.display !== display) {
        assert.fail(
          `.${name} is declared display:${seen.display} by "${seen.selector}" and ` +
            `display:${display} by "${rule.selector}" - two components sharing one class name.`,
        );
      }
      if (!seen) claims.set(name, { display, selector: rule.selector });
    }
  }
  assert.ok(claims.size > 80, `expected most of the sheet to be laid out, saw ${claims.size}`);
});

check('a class the app writes is a class the sheet defines', () => {
  // The other half of the same problem: a className with no rule behind it is
  // an element that renders unstyled, and nothing anywhere says so.
  const defined = new Set();
  for (const rule of parsed) {
    for (const name of rule.selector.match(/\.[a-zA-Z0-9_-]+/g) ?? []) defined.add(name.slice(1));
  }

  const sources = readdirSync(new URL('../app/src/', import.meta.url), { recursive: true })
    .filter((name) => typeof name === 'string' && name.endsWith('.tsx'));

  const missing = new Set();
  for (const name of sources) {
    const code = readFileSync(new URL(`../app/src/${name}`, import.meta.url), 'utf8');
    // Only plain, complete literals: `className="card card--pad"`. Anything
    // interpolated is built at runtime and is not this check's business.
    for (const [, value] of code.matchAll(/className="([a-z0-9_ -]+)"/g)) {
      for (const written of value.split(/\s+/).filter(Boolean)) {
        if (!defined.has(written)) missing.add(`${written} (${name})`);
      }
    }
  }

  assert.deepEqual([...missing], [], 'class names with no rule behind them');
});

console.log(`\n${passed} checks passed`);
