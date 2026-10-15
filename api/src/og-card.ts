/**
 * Link previews for things that have no photo of their own.
 *
 * A chat app shows a shared link as its og:image, and an item without a photo
 * used to fall back to the Figmark banner - the same picture for every item.
 * This paints the same square picture the app shares (shared/shareCard.ts):
 * the item's tile, its price, any discount the link brings, how full the
 * pre-order is, and the shop with its level.
 *
 * Rasterised with resvg's WebAssembly build and encoded as JPEG in plain
 * JavaScript: nothing native, so the Functions host needs no binaries. Fonts
 * are bundled because the renderer cannot see the system's.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import { encode } from 'jpeg-js';
import { CARD_FONT, WIDE_CARD, layoutCard, layoutWideCard, opsToSvg, type CardSpec } from '../../shared/shareCard.js';

/* ── Rendering ───────────────────────────────────────────────────────────── */

let ready: Promise<Uint8Array[]> | null = null;

function assetsDir(): string {
  const candidates = [
    resolve(__dirname, '../../../assets'), // api/dist/api/src -> api/assets
    resolve(__dirname, '../assets'), // api/src -> api/assets, run from source
    join(process.cwd(), 'assets'),
    join(process.cwd(), 'api', 'assets'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'fonts'))) ?? candidates[0]!;
}

function boot(): Promise<Uint8Array[]> {
  if (!ready) {
    ready = (async () => {
      await initWasm(readFileSync(require.resolve('@resvg/resvg-wasm/index_bg.wasm')));
      const fonts = join(assetsDir(), 'fonts');
      return ['BricolageGrotesque-Bold.ttf', 'BricolageGrotesque-Regular.ttf'].map((name) => new Uint8Array(readFileSync(join(fonts, name))));
    })();
    ready.catch(() => { ready = null; });
  }
  return ready;
}

/** The card as an SVG, ready for the renderer: square, or wide for a link's preview. */
export function cardSvg(spec: CardSpec, wide = false): string {
  return wide ? opsToSvg(layoutWideCard(spec), WIDE_CARD) : opsToSvg(layoutCard(spec));
}

/**
 * Android's WhatsApp shows no picture at all for a preview much over 300 KB,
 * where the iPhone's shrinks it: under this, every chat app shows it.
 */
export const PREVIEW_MAX_BYTES = 280_000;

/** An SVG card as a JPEG, small enough for any chat app's preview. */
export async function renderCard(svg: string): Promise<Buffer> {
  const fontBuffers = await boot();
  const resvg = new Resvg(svg, {
    font: { fontBuffers, defaultFontFamily: CARD_FONT, sansSerifFamily: CARD_FONT },
    fitTo: { mode: 'original' },
  });
  const image = resvg.render();
  try {
    const frame = { data: image.pixels, width: image.width, height: image.height };
    // A busy photo can make a large JPEG: step the quality down until it fits.
    let bytes = Buffer.from(encode(frame, 84).data);
    for (const quality of [74, 62, 50]) {
      if (bytes.byteLength <= PREVIEW_MAX_BYTES) break;
      bytes = Buffer.from(encode(frame, quality).data);
    }
    return bytes;
  } finally {
    image.free();
    resvg.free();
  }
}
