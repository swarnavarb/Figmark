// The scanning model (shared/photo-scan.ts) against real sale photos: each
// in test-fixtures/scan/ with the places the phone found in it, and what it
// is - one item, copies of one, or different items. A change to the rules
// that reads one of them wrong fails here. Every photo the scan gets wrong
// in use belongs in cases.json, with what it should have read.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const dist = new URL('../api/dist/', import.meta.url);
const scan = await import(new URL('shared/photo-scan.js', dist));
const { maybeSameThing } = await import(new URL('api/src/photo-things.js', dist));
const { decodeJpeg } = await import(new URL('api/src/storage/compress.js', dist));

const folder = new URL('../test-fixtures/scan/', import.meta.url);
const cases = JSON.parse(readFileSync(new URL('cases.json', folder), 'utf8'));
let passed = 0;
for (const entry of cases) {
  const raw = decodeJpeg(new Uint8Array(readFileSync(new URL(entry.photo, folder))));
  const prints = new Map();
  const read = scan.scanPhoto({
    boxes: entry.boxes,
    focus: scan.focusOf(raw.data, raw.width, raw.height, entry.boxes),
    sameKind: (a, b) => maybeSameThing(raw, a, b, prints),
  });
  const verdict = scan.photoVerdict(read.analysis, scan.titleHint(''));
  assert.equal(verdict.kind, entry.expect, `${entry.photo} (${entry.what}): read as ${JSON.stringify(verdict)} ${JSON.stringify(read.analysis)}`);
  console.log(`  ok  ${entry.what}: ${verdict.kind}${verdict.kind === 'one' ? '' : ` (${verdict.count})`}`);
  passed += 1;
}
console.log(`\n${passed} scan checks passed (${scan.SCAN_MODEL})`);
