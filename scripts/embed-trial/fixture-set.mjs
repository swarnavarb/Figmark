import { readFileSync } from 'node:fs';
import sharp from 'sharp';

/**
 * The labelled set the trial runs on by default, built from the real sale
 * photos in test-fixtures/scan/. Every box below was drawn by hand on those
 * photos and checked by cropping, so every query has a known answer.
 *
 * Which listings are "the same item" is decided here, not by any method
 * under test. Kinds of query, hardest last:
 *
 * - the same photo, smaller and recompressed - what fingerprints are for;
 * - the same photo, mirrored;
 * - the same item in a different photo - real: four official shots of one
 *   INART T-800, one listed, three searched with;
 * - the same item, re-shot - simulated from each listed crop: turned, moved,
 *   relit, on another backdrop, an edge cut off, recompressed;
 * - one item, find the lot it is listed in;
 * - several items in one photo - three listed things side by side, each to be
 *   found from its own box, with the boxes Figmark finds itself and with the
 *   exact ones.
 *
 * Look-alikes that are NOT the same item sit in the catalogue on purpose:
 * t800a and t800b are two different T-800 releases, and the shelf has two
 * different Wolverines, so a method that only sees "Terminator in a box" or
 * "yellow and blue figure" is caught out.
 */

const scan = (name) => readFileSync(new URL(`../../test-fixtures/scan/${name}`, import.meta.url));

/** [left, top, width, height] as fractions of marvel-shelf.jpg. */
export const SHELF = {
  'goblin': [0.105, 0.195, 0.075, 0.165],
  'luke-cage': [0.19, 0.195, 0.065, 0.18],
  'wolverine-top': [0.262, 0.22, 0.085, 0.165],
  'white-robot': [0.328, 0.09, 0.13, 0.255],
  'abomination': [0.025, 0.355, 0.11, 0.21],
  'hulk': [0.185, 0.34, 0.13, 0.21],
  'captain-britain': [0.03, 0.56, 0.09, 0.19],
  'mr-sinister': [0.085, 0.63, 0.095, 0.245],
  'batman-armour': [0.165, 0.55, 0.08, 0.22],
  'wolverine-bottom': [0.262, 0.595, 0.075, 0.175],
  'blue-armour': [0.375, 0.555, 0.125, 0.24],
  'thing': [0.755, 0.1, 0.105, 0.165],
  'carnage': [0.775, 0.415, 0.125, 0.19],
  'loki': [0.895, 0.625, 0.085, 0.24],
  'werewolf': [0.78, 0.655, 0.12, 0.265],
  'captain-marvel': [0.212, 0.71, 0.075, 0.2],
};
/** Shelf figures that also have a listing of their own; the rest are only in the lot. */
const SHELF_LISTED = ['luke-cage', 'wolverine-top', 'white-robot', 'hulk', 'captain-britain', 'mr-sinister', 'wolverine-bottom', 'blue-armour', 'carnage', 'loki'];

/** [left, top, width, height] as fractions of boxed-figures.jpg. */
export const BOXED = {
  'handmade': [0, 0.14, 0.375, 0.26],
  'john-wick': [0.38, 0.175, 0.29, 0.235],
  'winter-soldier': [0.675, 0.19, 0.32, 0.25],
  'ghost-rider': [0.03, 0.40, 0.6, 0.26],
  'spider-man': [0.65, 0.43, 0.24, 0.22],
  'batman-arkham': [0.07, 0.66, 0.43, 0.26],
  'ryu': [0.5, 0.67, 0.37, 0.255],
};

const COLLAGE = [0, 1, 2, 3].map((i) => [i * 0.25, 0, 0.25, 1]);
const WOLVERINES = [[0.089, 0.057, 0.15, 0.378], [0.533, 0.086, 0.15, 0.378], [0.133, 0.528, 0.15, 0.378], [0.578, 0.542, 0.15, 0.378]];

const jpeg = (image, quality = 88) => image.jpeg({ quality }).toBuffer();

export async function crop(buf, [x, y, w, h]) {
  const { width, height } = await sharp(buf).metadata();
  const left = Math.max(0, Math.round(x * width));
  const top = Math.max(0, Math.round(y * height));
  return jpeg(sharp(buf).extract({
    left, top,
    width: Math.max(8, Math.min(width - left, Math.round(w * width))),
    height: Math.max(8, Math.min(height - top, Math.round(h * height))),
  }));
}

/** A box grown by `by` of its size on every side, kept inside the photo. */
function loosen([x, y, w, h], by) {
  const left = Math.max(0, x - w * by); const top = Math.max(0, y - h * by);
  return [left, top, Math.min(1 - left, w * (1 + 2 * by)), Math.min(1 - top, h * (1 + 2 * by))];
}

/** Under half the size and saved roughly - a repost - but never a thumbnail under 240 px tall or across. */
async function smaller(buf) {
  const { width, height } = await sharp(buf).metadata();
  const scale = Math.min(1, Math.max(0.45, 240 / Math.max(width, height)));
  return jpeg(sharp(buf).resize({ width: Math.round(width * scale) }), 45);
}
const mirrored = (buf) => jpeg(sharp(buf).flop(), 70);

/** A small seeded random source, so every run builds the same set. */
function random(seed) {
  let a = [...seed].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BACKDROPS = [
  { r: 214, g: 190, b: 150 }, // cardboard
  { r: 228, g: 228, b: 224 }, // white desk
  { r: 70, g: 72, b: 78 }, // grey fabric
  { r: 160, g: 120, b: 85 }, // wood
];

/**
 * The item as if someone else had photographed it: turned 6-14 degrees, at
 * another size, off centre on another backdrop, one edge cut off, relit and
 * recoloured a little, and saved as a phone would. Not a new angle - no
 * simulation gives one - but everything about the picture except the item
 * itself has changed.
 */
export async function reshoot(buf, seed, { tight = false, gentle = false } = {}) {
  const rnd = random(seed);
  const bg = BACKDROPS[Math.floor(rnd() * BACKDROPS.length)];
  const angle = (6 + rnd() * 8) * (rnd() < 0.5 ? -1 : 1);
  const edge = Math.round(340 + rnd() * 160);
  const turned = await sharp(buf).resize({ width: edge, height: edge, fit: 'inside' }).rotate(angle, { background: bg }).toBuffer();
  const { width, height } = await sharp(turned).metadata();
  const room = tight ? [0.02, 0.05] : [0.15, 0.35];
  const padX = Math.round(width * (room[0] + rnd() * room[1])); const padY = Math.round(height * (room[0] + rnd() * room[1]));
  const left = Math.round(padX * rnd() * 2); const top = Math.round(padY * rnd() * 2);
  const framed = await sharp(turned).extend({ left, right: padX * 2 - left, top, bottom: padY * 2 - top, background: bg }).toBuffer();
  const meta = await sharp(framed).metadata();
  // One side cut off, as when the item runs out of the frame.
  const cut = 0.06 + rnd() * 0.06; const side = Math.floor(rnd() * 4);
  const keep = {
    left: side === 0 ? Math.round(meta.width * cut) : 0,
    top: side === 1 ? Math.round(meta.height * cut) : 0,
    width: Math.round(meta.width * (side === 0 || side === 2 ? 1 - cut : 1)),
    height: Math.round(meta.height * (side === 1 || side === 3 ? 1 - cut : 1)),
  };
  const light = { brightness: 0.82 + rnd() * 0.3, saturation: 0.85 + rnd() * 0.35, hue: Math.round(rnd() * 20 - 10) };
  const gamma = 1 + rnd() * 0.4; const quality = Math.round(55 + rnd() * 15);
  // Gentle: turned, resized and moved onto another backdrop only - same light, same colours, nothing cut off.
  if (gentle) return jpeg(sharp(framed), quality);
  return jpeg(sharp(framed).extract(keep).modulate(light).gamma(gamma), quality);
}

/** Several pictures side by side on one backdrop, and where each landed. */
async function sideBySide(bufs, seed) {
  const rnd = random(seed);
  const bg = BACKDROPS[Math.floor(rnd() * BACKDROPS.length)];
  const tall = 420; const gap = 70; const margin = 50;
  const pieces = await Promise.all(bufs.map(async (buf) => {
    const turned = await sharp(buf).resize({ height: tall }).rotate((rnd() * 10 - 5), { background: bg }).toBuffer();
    const { width, height } = await sharp(turned).metadata();
    return { input: turned, width, height };
  }));
  const width = margin * 2 + pieces.reduce((s, p) => s + p.width, 0) + gap * (pieces.length - 1);
  const height = margin * 2 + Math.max(...pieces.map((p) => p.height));
  let x = margin; const boxes = [];
  const layers = pieces.map((p) => {
    const top = margin + Math.round((height - margin * 2 - p.height) / 2);
    boxes.push([x / width, top / height, p.width / width, p.height / height]);
    const layer = { input: p.input, left: x, top };
    x += p.width + gap;
    return layer;
  });
  const buf = await jpeg(sharp({ create: { width, height, channels: 3, background: bg } }).composite(layers).modulate({ brightness: 0.95 + rnd() * 0.1 }), 70);
  return { buf, boxes };
}

/**
 * The catalogue and the queries. A listing is { id, title, photos: [{ key, buf }] };
 * a query is { id, kind, buf, expect: [listing ids, any of which is right] }, or,
 * for several items in one photo, { id, kind, buf, items: [{ label, box, expect }] }.
 */
export async function fixtureSet({ gentle = false } = {}) {
  const listings = []; const queries = [];
  const photo = (id, buf) => ({ key: id, buf });
  const list = (id, title, buf) => listings.push({ id, title, photos: [photo(id, buf)] });

  const shelf = scan('marvel-shelf.jpg'); const boxed = scan('boxed-figures.jpg');
  const collage = scan('terminator-collage.jpg'); const wolverines = scan('wolverine-copies.jpg');

  list('t800a', 'T-800 figure in window box (ammo belt release)', scan('t800a.jpg'));
  list('t800b', 'T-800 figure in window box (grey trousers release)', scan('t800b.jpg'));
  list('clark-kent', 'Clark Kent / Superman Elite Edition, boxed', scan('clark-kent.jpg'));
  list('cyclops', 'Cyclops loose figure, jacket', scan('cyclops-in-hand.jpg'));
  list('inart-t800', 'INART T-800 1/6 (official photo 2 of 4)', await crop(collage, COLLAGE[1]));
  list('wolverine-loose', 'Wolverine loose figure (photo 1 of 4)', await crop(wolverines, WOLVERINES[0]));
  const crops = {};
  for (const [name, box] of Object.entries(BOXED)) {
    crops[`boxed-${name}`] = await crop(boxed, box);
    list(`boxed-${name}`, `Boxed: ${name}`, crops[`boxed-${name}`]);
  }
  list('boxed-lot', 'Lot: seven boxed figures', boxed);
  for (const name of SHELF_LISTED) {
    crops[`shelf-${name}`] = await crop(shelf, SHELF[name]);
    list(`shelf-${name}`, `Loose: ${name}`, crops[`shelf-${name}`]);
  }
  list('shelf-lot', 'Lot: shelf of 55 loose figures', shelf);

  // Where else each listing's item can rightly be found: a single listed figure is in its lot too.
  const alsoIn = (id) => (id.startsWith('shelf-') && id !== 'shelf-lot' ? ['shelf-lot'] : id.startsWith('boxed-') && id !== 'boxed-lot' ? ['boxed-lot'] : []);

  for (const listing of listings) {
    queries.push({ id: `${listing.id}~small`, kind: 'Same photo, smaller + recompressed', buf: await smaller(listing.photos[0].buf), expect: [listing.id] });
  }
  queries.push({ id: 'wolverine-copy-2', kind: 'Same photo, mirrored', buf: await crop(wolverines, WOLVERINES[1]), expect: ['wolverine-loose'] });
  queries.push({ id: 'wolverine-copy-4', kind: 'Same photo, mirrored', buf: await crop(wolverines, WOLVERINES[3]), expect: ['wolverine-loose'] });
  for (const id of ['t800b', 'clark-kent', 'boxed-ryu', 'shelf-loki']) {
    const listing = listings.find((l) => l.id === id);
    queries.push({ id: `${id}~mirror`, kind: 'Same photo, mirrored', buf: await mirrored(listing.photos[0].buf), expect: [id, ...alsoIn(id)] });
  }
  for (const panel of [0, 2, 3]) {
    queries.push({ id: `inart-photo-${panel + 1}`, kind: 'Same item, different photo (real)', buf: await crop(collage, COLLAGE[panel]), expect: ['inart-t800'] });
  }
  for (const listing of listings.filter((l) => !l.id.endsWith('-lot'))) {
    queries.push({ id: `${listing.id}~reshot`, kind: gentle ? 'Same item, re-shot gently (simulated)' : 'Same item, re-shot (simulated)', buf: await reshoot(listing.photos[0].buf, listing.id, { gentle }), expect: [listing.id, ...alsoIn(listing.id)] });
  }
  for (const name of Object.keys(SHELF).filter((n) => !SHELF_LISTED.includes(n))) {
    const piece = await crop(shelf, loosen(SHELF[name], 0.08));
    queries.push({ id: `${name}~cut-from-lot`, kind: 'One item, find its lot', buf: await jpeg(sharp(piece), 60), expect: ['shelf-lot'] });
    queries.push({ id: `${name}~reshot-from-lot`, kind: 'One item, find its lot', buf: await reshoot(piece, name), expect: ['shelf-lot'] });
  }
  for (const name of ['john-wick', 'ryu']) {
    const piece = await crop(boxed, loosen(BOXED[name], 0.05));
    queries.push({ id: `${name}~reshot-from-lot`, kind: 'One item, find its lot', buf: await reshoot(piece, `lot-${name}`), expect: ['boxed-lot', `boxed-${name}`] });
  }

  const groups = [
    ['boxed-john-wick', 'shelf-hulk', 'clark-kent'],
    ['t800b', 'cyclops', 'shelf-loki'],
    ['shelf-captain-britain', 'shelf-mr-sinister', 'boxed-ryu'],
    ['wolverine-loose', 'shelf-carnage', 'boxed-winter-soldier'],
  ];
  for (const [i, ids] of groups.entries()) {
    const sources = await Promise.all(ids.map((id) => reshoot(listings.find((l) => l.id === id).photos[0].buf, `group-${i}-${id}`, { tight: true })));
    const { buf, boxes } = await sideBySide(sources, `group-${i}`);
    queries.push({
      id: `three-items-${i + 1}`, kind: 'Several items in one photo', buf,
      items: ids.map((id, at) => ({ label: id, box: boxes[at], expect: [id, ...alsoIn(id)] })),
    });
  }
  return { listings, queries };
}
