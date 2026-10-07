/**
 * Draws the home-screen icons in app/public/icons: the brand mark from the
 * header (the hero gradient, see --grad-hero in styles.css) with an F in the
 * card font. Run after `npm --prefix api ci` whenever the mark changes; the
 * PNGs are committed, so a build never needs this.
 *
 * - icon-*.png        rounded, for browsers and the install prompt
 * - maskable-512.png  full bleed, for Android to cut into its own shape
 * - apple-touch-icon  full bleed: iOS rounds the corners itself
 * - badge-72.png      white on transparent: Android's status-bar glyph
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../api/package.json', import.meta.url));
const { initWasm, Resvg } = require('@resvg/resvg-wasm');
await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
const font = new Uint8Array(readFileSync(new URL('../api/assets/fonts/BricolageGrotesque-Bold.ttf', import.meta.url)));

const gradient = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#7C3AED"/><stop offset="0.52" stop-color="#EC4899"/><stop offset="1" stop-color="#FF5A5F"/>
</linearGradient>`;

/** The mark on a 512 canvas. `radius` 0 is full bleed; `scale` shrinks the F into a safe zone. */
function mark({ radius, scale }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${gradient}</defs>
  <rect width="512" height="512" rx="${radius}" fill="url(#g)"/>
  <text x="256" y="${256 + 118 * scale}" font-family="Bricolage Grotesque" font-weight="700"
    font-size="${340 * scale}" fill="#FFFFFF" text-anchor="middle">F</text>
</svg>`;
}

const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <text x="256" y="374" font-family="Bricolage Grotesque" font-weight="700" font-size="400"
    fill="#FFFFFF" text-anchor="middle">F</text>
</svg>`;

function png(svg, size) {
  const resvg = new Resvg(svg, {
    font: { fontBuffers: [font], defaultFontFamily: 'Bricolage Grotesque' },
    fitTo: { mode: 'width', value: size },
  });
  const image = resvg.render();
  try {
    return image.asPng();
  } finally {
    image.free();
    resvg.free();
  }
}

const out = (name) => new URL(`../app/public/icons/${name}`, import.meta.url);
const rounded = mark({ radius: 112, scale: 1 });
const bleed = mark({ radius: 0, scale: 0.8 });
writeFileSync(out('icon-192.png'), png(rounded, 192));
writeFileSync(out('icon-512.png'), png(rounded, 512));
writeFileSync(out('maskable-512.png'), png(bleed, 512));
writeFileSync(out('apple-touch-icon.png'), png(mark({ radius: 0, scale: 1 }), 180));
writeFileSync(out('badge-72.png'), png(badge, 72));
console.log('wrote app/public/icons');
