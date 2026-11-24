#!/usr/bin/env node
/**
 * Side-by-side trial: Figmark's photo fingerprints (api/src/image-hash.ts, the
 * scoring in api/src/photo-search.ts) against open image-embedding models, on
 * photos whose right answer is known.
 *
 *   npm run build:api                       # once, from the repo root
 *   cd scripts/embed-trial && npm install   # once: the model runtime, kept out of api/
 *   node trial.mjs                          # the labelled fixture set
 *   node trial.mjs --folders ~/my-photos    # and your own: one sub-folder per item
 *
 * Nothing here touches the database, the photo store or the live search. The
 * fingerprint side calls the same exported functions the search route does;
 * only the per-listing comparison loop (compareAll in photo-search.ts, not
 * exported) is repeated here, line for line.
 *
 * Methods compared, each ranking every listing for every query:
 * - Fingerprints: today's search, picture only (vision off, as on preview).
 *   A listing it does not consider alike is not shown at all, so it only
 *   counts as found when shown.
 * - CLIP / DINOv2 / SigLIP: one vector for the photo and one for each item
 *   Figmark's own detector finds in it; a listing scores its closest pair.
 * - Hybrid: fingerprints decide "same photo" (they are close to certain
 *   there), the model ranks everything else.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, extname, basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';

const { values: args } = parseArgs({
  options: {
    models: { type: 'string', default: 'clip,dinov2,siglip' },
    dtype: { type: 'string', default: 'q8' },
    folders: { type: 'string' },
    'no-fixtures': { type: 'boolean', default: false },
    gentle: { type: 'boolean', default: false },
    out: { type: 'string', default: 'trial-report.md' },
    save: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (args.help) {
  console.log(`node trial.mjs [--models clip,dinov2,siglip] [--dtype q8|fp32] [--folders DIR] [--no-fixtures] [--out FILE] [--save DIR]

  --folders DIR   your own photos: DIR/<item>/<photo>.jpg|png|webp, one sub-folder per item.
                  Every photo of an item with two or more is searched with, against the rest.
  --gentle        simulated re-shoots only turn, move and re-frame the item: no relighting, no recolouring, no cut edge.
  --save DIR      write every listing and query picture there, to look at what was compared.`);
  process.exit(0);
}

const dist = new URL('../../api/dist/api/src/', import.meta.url);
if (!existsSync(new URL('image-hash.js', dist))) {
  console.error('The API is not built. From the repo root: npm run build:api');
  process.exit(1);
}
const hash = await import(new URL('image-hash.js', dist));
const search = await import(new URL('photo-search.js', dist));
const { decodeJpeg } = await import(new URL('storage/compress.js', dist));
const { pipeline, AutoProcessor, SiglipVisionModel, RawImage, env } = await import('@huggingface/transformers');
env.cacheDir = join(process.env.HOME ?? '.', '.cache', 'figmark-embed-trial');

/* ------------------------------------------------------------------ models */

const MODELS = {
  clip: { label: 'CLIP', id: 'Xenova/clip-vit-base-patch32' },
  dinov2: { label: 'DINOv2', id: 'Xenova/dinov2-small' },
  siglip: { label: 'SigLIP', id: 'Xenova/siglip-base-patch16-224' },
};

function normalise(values) {
  const v = Float32Array.from(values);
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i += 1) v[i] /= n;
  return v;
}
const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i += 1) s += a[i] * b[i]; return s; };

async function loadModel(name) {
  const spec = MODELS[name];
  if (!spec) throw new Error(`Unknown model "${name}": one of ${Object.keys(MODELS).join(', ')}`);
  if (name === 'siglip') {
    const processor = await AutoProcessor.from_pretrained(spec.id);
    const model = await SiglipVisionModel.from_pretrained(spec.id, { dtype: args.dtype });
    return async (image) => normalise((await model(await processor(image))).pooler_output.data);
  }
  const extract = await pipeline('image-feature-extraction', spec.id, { dtype: args.dtype });
  if (name === 'dinov2') {
    // The class token: the first of 257, each 384 wide.
    return async (image) => { const out = await extract(image); return normalise(out.data.slice(0, out.dims[2])); };
  }
  return async (image) => normalise((await extract(image)).data);
}

async function rawImage(jpg) {
  const { data, info } = await sharp(jpg).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new RawImage(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, 3);
}

async function cropJpeg(jpg, [x, y, w, h]) {
  const { width, height } = await sharp(jpg).metadata();
  const left = Math.min(width - 8, Math.max(0, Math.round(x * width)));
  const top = Math.min(height - 8, Math.max(0, Math.round(y * height)));
  return sharp(jpg).extract({
    left, top,
    width: Math.max(8, Math.min(width - left, Math.round(w * width))),
    height: Math.max(8, Math.min(height - top, Math.round(h * height))),
  }).jpeg({ quality: 90 }).toBuffer();
}

/* ------------------------------------------------------------ fingerprints */

/** Any picture as the JPEG an upload becomes: at most 1600 across, as the app sends it. */
async function asUpload(buf) {
  return sharp(buf).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).removeAlpha().jpeg({ quality: 85 }).toBuffer();
}

/** What an upload stores (rememberFingerprint): the photo's fingerprint and each item's, items found by Figmark's detector. */
function listingPrints(raw) {
  const prints = hash.printsOfPixels(raw);
  return prints ? { whole: prints.hash, hashes: [prints.hash, ...prints.regions.map((r) => r.imageHash)], boxes: prints.regions.map((r) => r.box) } : { whole: null, hashes: [], boxes: [] };
}

/** What a whole-photo search compares (searchWholePhoto, vision off): the photo, each item, and the photo tilted each way. */
function wholeQueryPrints(raw) {
  const prints = hash.printsOfPixels(raw);
  if (!prints) return { hashes: [], boxes: [] };
  return { hashes: [prints.hash, ...prints.regions.map((r) => r.imageHash), ...hash.tiltedFingerprints(raw)], boxes: prints.regions.map((r) => r.box) };
}

/** What a search for one item picked in a photo compares (searchOneItem). */
function itemQueryPrints(raw, box) {
  const crop = hash.cropPixels(raw, box);
  return [hash.regionFingerprint(raw, box), hash.printsOfPixels(crop)?.hash ?? null, ...hash.isolatedFingerprints(raw, box)].filter(Boolean);
}

const readCache = new Map();
const readPrint = (h) => { if (!readCache.has(h)) readCache.set(h, hash.readFingerprint(h)); return readCache.get(h); };

/** compareAll() from photo-search.ts, for one listing: how its photos compare with the query's fingerprints. */
function fingerprintLook(queryHashes, photos) {
  const mine = queryHashes.map(readPrint).filter(Boolean);
  let entry = null;
  for (const left of mine) {
    for (const photo of photos) {
      for (const [at, their] of photo.fp.hashes.entries()) {
        const right = readPrint(their);
        if (!right) continue;
        const alike = hash.likenessOf(left, right);
        entry ??= { same: false, sameItem: false, wholeItem: false, variant: false, shape: 0, visual: 0, look: 0 };
        entry.same ||= alike.samePhoto && alike.sameItem;
        entry.sameItem ||= alike.sameItem;
        entry.wholeItem ||= (alike.sameItem || alike.samePhoto) && at === 0;
        entry.variant ||= alike.variant;
        entry.shape = Math.max(entry.shape ?? 0, alike.shape);
        entry.visual = Math.max(entry.visual, alike.score);
        entry.look = Math.max(entry.look, alike.look ?? 0);
      }
    }
  }
  return entry;
}

/** The fingerprint score the search ranks by; 0 when the search would not show the listing at all. */
function fingerprintScore(look) {
  if (!look || !(look.visual > 0 || look.look > 0 || look.variant)) return { score: 0, shown: false, same: false, tie: 0 };
  const shown = search.onlyAlike(new Map([['x', look]])).has('x');
  return { score: shown ? search.pictureScore(look) : 0, shown, same: Boolean(look.same), tie: Math.max(look.visual, look.look) };
}

/* ----------------------------------------------------------------- the set */

const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.tif', '.tiff', '.gif']);

/** Your photos: DIR/<item>/<photo>. Items with one photo are only in the catalogue, as distractors. */
function folderSet(dir) {
  const listings = []; const queries = [];
  for (const item of readdirSync(dir).sort()) {
    const folder = join(dir, item);
    if (!statSync(folder).isDirectory()) continue;
    const files = readdirSync(folder).filter((f) => IMAGE.has(extname(f).toLowerCase())).sort();
    if (files.length === 0) continue;
    const id = `yours:${item}`;
    const photos = files.map((f) => ({ key: `${id}/${f}`, buf: readFileSync(join(folder, f)) }));
    listings.push({ id, title: item, photos });
    if (photos.length > 1) {
      for (const p of photos) queries.push({ id: `${item}/${basename(p.key)}`, kind: 'Your photos: same item, another photo', buf: p.buf, expect: [id], exclude: p.key });
    }
  }
  return { listings, queries };
}

const sets = [];
if (!args['no-fixtures']) {
  const { fixtureSet } = await import('./fixture-set.mjs');
  sets.push(await fixtureSet({ gentle: args.gentle }));
}
if (args.folders) sets.push(folderSet(resolve(args.folders)));
const listings = sets.flatMap((s) => s.listings);
const queries = sets.flatMap((s) => s.queries);
if (queries.length === 0) { console.error('Nothing to search with.'); process.exit(1); }

/* ------------------------------------------------------------- preparing */

const modelNames = args.models.split(',').map((s) => s.trim()).filter(Boolean);
const timing = { fingerprintMs: [], embedMs: Object.fromEntries(modelNames.map((m) => [m, []])) };

async function preparePhoto(photo) {
  photo.jpg = await asUpload(photo.buf);
  photo.raw = decodeJpeg(new Uint8Array(photo.jpg));
  const t = performance.now();
  photo.fp = listingPrints(photo.raw);
  timing.fingerprintMs.push(performance.now() - t);
  photo.vec = {};
}

async function prepareQuery(query) {
  query.jpg = await asUpload(query.buf);
  query.raw = decodeJpeg(new Uint8Array(query.jpg));
  const t = performance.now();
  query.fp = wholeQueryPrints(query.raw);
  timing.fingerprintMs.push(performance.now() - t);
  query.vec = {};
  if (query.items) {
    // The boxes Figmark finds itself (backdrop split; no Claude, no phone detector), and the true ones.
    query.found = hash.detectItems(query.raw);
    for (const item of query.items) {
      const iou = (a, b) => { const w = Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]); const h = Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]); const i = w > 0 && h > 0 ? w * h : 0; return i / (a[2] * a[3] + b[2] * b[3] - i); };
      const best = query.found.map((box) => ({ box, iou: iou(box, item.box) })).sort((a, b) => b.iou - a.iou)[0];
      // A shopper taps the box over the item; one that covers little of it, or mostly other things, is not it.
      item.foundBox = best && best.iou >= 0.3 ? best.box : null;
      item.modes = { exact: { box: item.box }, found: { box: item.foundBox } };
      for (const mode of Object.values(item.modes)) {
        if (!mode.box) continue;
        mode.fp = itemQueryPrints(query.raw, mode.box);
        mode.jpg = await cropJpeg(query.jpg, mode.box);
        mode.vec = {};
      }
    }
  }
}

console.log(`Preparing ${listings.reduce((s, l) => s + l.photos.length, 0)} listing photos in ${listings.length} listings, and ${queries.length} queries…`);
for (const listing of listings) for (const photo of listing.photos) await preparePhoto(photo);
for (const query of queries) await prepareQuery(query);

async function embedAll(name, embed) {
  const run = async (jpg) => { const t = performance.now(); const v = await embed(await rawImage(jpg)); timing.embedMs[name].push(performance.now() - t); return v; };
  for (const listing of listings) {
    for (const photo of listing.photos) {
      photo.vec[name] = [await run(photo.jpg)];
      for (const box of photo.fp.boxes) photo.vec[name].push(await run(await cropJpeg(photo.jpg, box)));
    }
  }
  for (const query of queries) {
    query.vec[name] = [await run(query.jpg)];
    for (const box of query.fp.boxes) query.vec[name].push(await run(await cropJpeg(query.jpg, box)));
    for (const item of query.items ?? []) {
      for (const mode of Object.values(item.modes)) if (mode.jpg) mode.vec[name] = [await run(mode.jpg)];
    }
  }
}

for (const name of modelNames) {
  console.log(`Loading ${MODELS[name]?.label ?? name} (${args.dtype})…`);
  const embed = await loadModel(name);
  console.log(`Embedding with ${MODELS[name].label}…`);
  await embedAll(name, embed);
}

/* --------------------------------------------------------------- ranking */

const methods = [
  { key: 'fp', label: 'Fingerprints (today)' },
  ...modelNames.map((m) => ({ key: m, label: MODELS[m].label })),
  ...modelNames.map((m) => ({ key: `hybrid-${m}`, label: `Hybrid + ${MODELS[m].label}`, hybrid: m })),
];

/** Every listing scored against one search (its fingerprints and vectors), best first, per method. */
function rankAll(fpHashes, vecs, exclude) {
  const rows = [];
  for (const listing of listings) {
    const photos = listing.photos.filter((p) => p.key !== exclude);
    if (photos.length === 0) continue;
    const fp = fingerprintScore(fingerprintLook(fpHashes, photos));
    const emb = {};
    for (const m of modelNames) {
      // Photo against photo, and either photo against the items found in the other - never
      // one item crop against another, where two scraps of backdrop can look alike.
      let best = -1;
      for (const [qi, q] of (vecs[m] ?? []).entries()) {
        for (const p of photos) for (const [vi, v] of p.vec[m].entries()) if (qi === 0 || vi === 0) best = Math.max(best, cosine(q, v));
      }
      emb[m] = best;
    }
    rows.push({ id: listing.id, fp, emb });
  }
  const ranked = {};
  for (const method of methods) {
    const key = (r) => (method.key === 'fp' ? [r.fp.score, r.fp.tie]
      : method.hybrid ? [r.fp.same ? 1 : 0, r.emb[method.hybrid]]
        : [r.emb[method.key], 0]);
    ranked[method.key] = [...rows].sort((a, b) => { const [a1, a2] = key(a); const [b1, b2] = key(b); return b1 - a1 || b2 - a2; })
      .map((r) => ({ id: r.id, shown: method.key === 'fp' ? r.fp.shown : true, score: method.key === 'fp' ? r.fp.score : r.emb[method.hybrid ?? method.key] }));
  }
  return ranked;
}

/** Where the first right answer came, and what came first; a fingerprint result not shown is not found. */
function outcome(list, expect) {
  const at = list.findIndex((r) => expect.includes(r.id));
  const right = at >= 0 && list[at].shown ? at + 1 : Infinity;
  const wrongBest = list.find((r) => !expect.includes(r.id));
  return { rank: right, top: list[0]?.shown ? list[0].id : null, rightScore: at >= 0 ? list[at].score : null, wrongScore: wrongBest?.score ?? null };
}

const results = []; // { kind, id, expect, by: { method: outcome } }
for (const query of queries) {
  if (query.items) {
    for (const item of query.items) {
      for (const [mode, label] of [['found', 'Several items: boxes Figmark found'], ['exact', 'Several items: exact boxes']]) {
        const m = item.modes[mode];
        const by = {};
        if (!m.box) for (const method of methods) by[method.key] = { rank: Infinity, top: null, missedBox: true };
        else {
          const ranked = rankAll(m.fp, m.vec, null);
          for (const method of methods) by[method.key] = outcome(ranked[method.key], item.expect);
        }
        results.push({ kind: label, id: `${query.id} → ${item.label}`, expect: item.expect, by, missedBox: !m.box });
      }
    }
  } else {
    const ranked = rankAll(query.fp.hashes, query.vec, query.exclude);
    const by = {};
    for (const method of methods) by[method.key] = outcome(ranked[method.key], query.expect);
    results.push({ kind: query.kind, id: query.id, expect: query.expect, by });
  }
}

/* ---------------------------------------------------------------- report */

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const kinds = [...new Set(results.map((r) => r.kind))];
const stat = (rows, key) => {
  const n = rows.length;
  const hit1 = rows.filter((r) => r.by[key].rank === 1).length;
  const hit5 = rows.filter((r) => r.by[key].rank <= 5).length;
  const mrr = rows.reduce((s, r) => s + (Number.isFinite(r.by[key].rank) ? 1 / r.by[key].rank : 0), 0) / (n || 1);
  return { n, hit1, hit5, mrr };
};

const lines = [];
const out = (s = '') => lines.push(s);
out('# Photo search trial: fingerprints vs embeddings');
out();
out(`${listings.length} listings (${listings.reduce((s, l) => s + l.photos.length, 0)} photos), ${results.length} searches. Models run on CPU, ${args.dtype}.`);
out('A fingerprint result only counts when today\'s search would show it as a match. "Hybrid" = fingerprints decide "same photo", the model ranks the rest.');
out();
for (const [title, pick] of [['Right answer first (Hit@1)', 'hit1'], ['Right answer in the top 5 (Hit@5)', 'hit5']]) {
  out(`## ${title}`);
  out();
  out(`| Kind of search | n | ${methods.map((m) => m.label).join(' | ')} |`);
  out(`|---|---:|${methods.map(() => '---:').join('|')}|`);
  for (const kind of [...kinds, 'All']) {
    const rows = kind === 'All' ? results : results.filter((r) => r.kind === kind);
    const cells = methods.map((m) => { const s = stat(rows, m.key); return pct(s[pick], s.n); });
    out(`| ${kind === 'All' ? '**All**' : kind} | ${rows.length} | ${cells.join(' | ')} |`);
  }
  out();
}

out('## Mean reciprocal rank (1 = always first)');
out();
out(`| Kind of search | ${methods.map((m) => m.label).join(' | ')} |`);
out(`|---|${methods.map(() => '---:').join('|')}|`);
for (const kind of [...kinds, 'All']) {
  const rows = kind === 'All' ? results : results.filter((r) => r.kind === kind);
  out(`| ${kind === 'All' ? '**All**' : kind} | ${methods.map((m) => stat(rows, m.key).mrr.toFixed(2)).join(' | ')} |`);
}
out();

out('## Can a model tell "no match" from a match?');
out();
out('Embeddings always return a nearest listing, so live search needs a cut-off. Similarity of the right listing vs the best wrong one (single-item searches):');
out();
out('| Model | right: 10th pct | right: median | best wrong: median | best wrong: 90th pct | a clean cut-off exists? |');
out('|---|---:|---:|---:|---:|---|');
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))] : NaN; };
for (const m of modelNames) {
  const rows = results.filter((r) => !r.kind.startsWith('Several') && r.by[m].rightScore !== null);
  const right = rows.map((r) => r.by[m].rightScore); const wrong = rows.map((r) => r.by[m].wrongScore).filter((x) => x !== null);
  const lo = q(right, 0.1); const hi = q(wrong, 0.9);
  out(`| ${MODELS[m].label} | ${lo.toFixed(3)} | ${q(right, 0.5).toFixed(3)} | ${q(wrong, 0.5).toFixed(3)} | ${hi.toFixed(3)} | ${lo > hi ? `yes, about ${((lo + hi) / 2).toFixed(2)}` : 'no: they overlap'} |`);
}
out();

const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
out('## Cost per picture (this machine, CPU)');
out();
out(`| Method | ms per picture or item crop |`);
out('|---|---:|');
out(`| Fingerprints | ${avg(timing.fingerprintMs).toFixed(0)} (whole photo + its items) |`);
for (const m of modelNames) out(`| ${MODELS[m].label} | ${avg(timing.embedMs[m]).toFixed(0)} per vector |`);
out();

const multi = results.filter((r) => r.kind === 'Several items: boxes Figmark found');
if (multi.length) {
  out(`Figmark's own detector put a usable box (IoU ≥ 0.3) over ${multi.filter((r) => !r.missedBox).length} of ${multi.length} items in the several-item photos; a missed box is a miss for every method.`);
  out();
}

out('## Every search');
out();
const mark = (o) => (o.missedBox ? 'no box' : o.rank === 1 ? '✅ 1' : Number.isFinite(o.rank) ? `${o.rank}` : '❌');
out(`| Kind | Search | Right answer | ${methods.map((m) => m.label).join(' | ')} | First wrong result (fingerprints / ${modelNames.map((m) => MODELS[m].label).join(' / ')}) |`);
out(`|---|---|---|${methods.map(() => '---').join('|')}|---|`);
for (const r of results) {
  const wrongTops = ['fp', ...modelNames].map((k) => (r.by[k].rank === 1 ? '·' : r.by[k].top ?? 'nothing shown')).join(' / ');
  out(`| ${r.kind} | ${r.id} | ${r.expect.join(' or ')} | ${methods.map((m) => mark(r.by[m.key])).join(' | ')} | ${wrongTops} |`);
}
out();

writeFileSync(args.out, `${lines.join('\n')}\n`);
console.log(`\n${lines.slice(0, lines.indexOf('## Every search')).join('\n')}`);
console.log(`Full report, with every search: ${resolve(args.out)}`);

if (args.save) {
  const dir = resolve(args.save);
  mkdirSync(join(dir, 'listings'), { recursive: true }); mkdirSync(join(dir, 'queries'), { recursive: true });
  const safe = (s) => s.replace(/[^a-z0-9._-]+/gi, '_');
  for (const l of listings) for (const [i, p] of l.photos.entries()) writeFileSync(join(dir, 'listings', `${safe(l.id)}-${i + 1}.jpg`), p.jpg);
  for (const query of queries) writeFileSync(join(dir, 'queries', `${safe(query.id)}.jpg`), query.jpg);
  console.log(`Pictures written to ${dir}`);
}
