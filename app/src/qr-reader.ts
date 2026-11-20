import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ReaderOptions } from 'zxing-wasm/reader';

/**
 * Reading a QR from a photo or a camera frame - the Aadhaar Secure QR above all.
 *
 * That QR is the densest there is (about 177 x 177 modules: it carries a photo),
 * and people photograph printed copies that are grey, soft and a little skewed.
 * Each reader below catches what the one before it missed:
 *
 * 1. The browser's own BarcodeDetector, where there is one (Android Chrome).
 *    Fast and good, but Safari has none.
 * 2. ZXing (zxing-cpp compiled to WebAssembly), served from this site, not a
 *    CDN. Far better than jsQR at dense and blurred codes.
 * 3. For a still picture, ZXing again on prepared copies: enlarged, then
 *    greyscaled, contrast-stretched and sharpened. Tried on a real blurred
 *    photo of a printed Aadhaar QR, enlarging and sharpening was what made it
 *    readable; neither reader managed the photo as it was.
 * 4. jsQR, last, since it occasionally reads what ZXing does not.
 */

interface Detector {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

type Zxing = typeof import('zxing-wasm/reader');
let zxingModule: Promise<Zxing> | null = null;

/** Loaded on first use only: the WebAssembly is about a megabyte. */
function zxing(): Promise<Zxing> {
  zxingModule ??= import('zxing-wasm/reader').then(async (mod) => {
    await mod.prepareZXingModule({
      overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
      fireImmediately: true,
    });
    return mod;
  });
  // A failed load (offline, blocked) is retried on the next scan rather than remembered.
  zxingModule.catch(() => {
    zxingModule = null;
  });
  return zxingModule;
}

const BASE: Partial<ReaderOptions> = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  maxNumberOfSymbols: 1,
};

async function zxingRead(image: ImageData, options: Partial<ReaderOptions> = {}): Promise<string | null> {
  try {
    const { readBarcodes } = await zxing();
    const [found] = await readBarcodes(image, { ...BASE, ...options });
    return found?.isValid && found.text ? found.text : null;
  } catch {
    return null;
  }
}

async function nativeRead(source: CanvasImageSource): Promise<string | null> {
  const Native = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
  if (!Native) return null;
  try {
    const found = await new Native({ formats: ['qr_code'] }).detect(source);
    return found[0]?.rawValue || null;
  } catch {
    return null;
  }
}

async function jsqrRead(image: ImageData): Promise<string | null> {
  const { default: jsQR } = await import('jsqr');
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
}

/** The source drawn at `longSide` pixels on its longer side. */
function pixels(source: CanvasImageSource, width: number, height: number, longSide: number): ImageData | null {
  const scale = longSide / Math.max(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** One pass of a box blur of radius `r` over a greyscale plane, both directions. */
function boxBlur(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = 2 * r + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let x = -r; x <= r; x += 1) sum += src[row + Math.min(width - 1, Math.max(0, x))]!;
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / span;
      sum += src[row + Math.min(width - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let y = -r; y <= r; y += 1) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x]!;
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      sum += tmp[Math.min(height - 1, y + r + 1) * width + x]! - tmp[Math.max(0, y - r) * width + x]!;
    }
  }
  return out;
}

/**
 * Greyscale, stretch the contrast to the 1st-99th percentile, then an unsharp
 * mask: what a grey, slightly soft print of a dense QR needs before reading.
 * Pure, so it can be checked outside a browser.
 */
export function sharpenForQr(image: { data: Uint8ClampedArray; width: number; height: number }): Uint8ClampedArray<ArrayBuffer> {
  const { data, width, height } = image;
  const grey = new Float32Array(width * height);
  const histogram = new Uint32Array(256);
  for (let i = 0; i < grey.length; i += 1) {
    const value = 0.299 * data[i * 4]! + 0.587 * data[i * 4 + 1]! + 0.114 * data[i * 4 + 2]!;
    grey[i] = value;
    histogram[Math.round(value)]! += 1;
  }
  const percentile = (fraction: number) => {
    let seen = 0;
    for (let level = 0; level < 256; level += 1) {
      seen += histogram[level]!;
      if (seen >= grey.length * fraction) return level;
    }
    return 255;
  };
  const low = percentile(0.01);
  const high = Math.max(low + 1, percentile(0.99));
  for (let i = 0; i < grey.length; i += 1) grey[i] = ((grey[i]! - low) * 255) / (high - low);

  // Two box blurs approximate a Gaussian; the radius follows the image size.
  const radius = Math.max(1, Math.round(Math.max(width, height) / 900));
  const blurred = boxBlur(boxBlur(grey, width, height, radius), width, height, radius);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < grey.length; i += 1) {
    const value = grey[i]! + 2 * (grey[i]! - blurred[i]!);
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = value;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function sharpened(image: ImageData): ImageData {
  return new ImageData(sharpenForQr(image), image.width, image.height);
}

/**
 * A QR's text from one camera frame. Quick: the camera calls this a few times
 * a second, and the next frame is another chance.
 */
export async function readQrFrame(video: HTMLVideoElement, attempt: number): Promise<string | null> {
  const { videoWidth: width, videoHeight: height } = video;
  if (!width || !height) return null;
  const native = await nativeRead(video);
  if (native) return native;
  const frame = pixels(video, width, height, Math.max(width, height));
  if (!frame) return null;
  // Every other frame is sharpened, so a soft focus gets its chance too.
  return zxingRead(attempt % 2 === 0 ? frame : sharpened(frame));
}

/** A QR's text from a picture: every reader and preparation in turn, stopping at the first that reads it. */
export async function readQrPicture(file: Blob): Promise<string | null> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = bitmap;
    const native = await nativeRead(bitmap);
    if (native) return native;

    const longSide = Math.max(width, height);
    const original = pixels(bitmap, width, height, Math.min(longSide, 3000));
    if (!original) return null;
    const attempts: (() => Promise<string | null>)[] = [
      () => zxingRead(original),
      () => zxingRead(sharpened(original)),
    ];
    // Enlarging a small or soft picture gives the reader more pixels per module.
    for (const target of [1800, 2400]) {
      if (target <= longSide * 1.2) continue;
      const enlarged = pixels(bitmap, width, height, target);
      if (!enlarged) continue;
      attempts.push(() => zxingRead(enlarged), () => zxingRead(sharpened(enlarged)));
      attempts.push(() => zxingRead(sharpened(enlarged), { binarizer: 'GlobalHistogram' }));
    }
    attempts.push(() => zxingRead(sharpened(original), { binarizer: 'FixedThreshold' }));
    attempts.push(() => jsqrRead(original));

    for (const attempt of attempts) {
      const text = await attempt();
      if (text) return text;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
