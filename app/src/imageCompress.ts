/**
 * Compress a picture to 70-90 KB before it goes anywhere.
 *
 * The canvas does the work in the browser because the bytes cross the wire
 * either way and the smaller number is the one worth sending. Quality is
 * searched for, not fixed: the highest JPEG quality that still fits 90 KB, so a
 * photo lands near the top of the range rather than far under it, and a photo
 * that cannot fit at any quality is shrunk a step and tried again.
 *
 * The result is compared with what was chosen, and the smaller of the two is
 * what is sent: a tiny PNG that a JPEG would only make bigger stays as it is.
 * The API repeats the same rule (`api/src/storage/compress.ts`), so a client
 * that skips this still cannot store a large photo.
 */
export const PHOTO_MAX_BYTES = 90 * 1024;

const MAX_EDGE = 1600;
const SCALES = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.35, 0.3];
const FLOOR_QUALITY = 0.35;
const CEILING_QUALITY = 0.92;

const read = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result));
  reader.onerror = () => reject(new Error('Could not read that file.'));
  reader.readAsDataURL(blob);
});

const toBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | null>((resolve) => {
  canvas.toBlob(resolve, 'image/jpeg', quality);
});

async function decode(blob: Blob): Promise<{ draw: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { draw: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
    } catch { /* fall through to <img>, which reads a few more formats */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('Could not decode that image.'));
      element.src = url;
    });
    return { draw: image, width: image.width, height: image.height, close: () => {} };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The highest quality that fits at this canvas size, or the smallest there is. */
async function bestFit(canvas: HTMLCanvasElement): Promise<{ blob: Blob; fits: boolean } | null> {
  const smallest = await toBlob(canvas, FLOOR_QUALITY);
  if (!smallest) return null;
  if (smallest.size > PHOTO_MAX_BYTES) return { blob: smallest, fits: false };
  let best = smallest;
  let low = FLOOR_QUALITY;
  let high = CEILING_QUALITY;
  for (let step = 0; step < 6; step += 1) {
    const mid = (low + high) / 2;
    const tried = await toBlob(canvas, mid);
    if (!tried) break;
    if (tried.size <= PHOTO_MAX_BYTES) { best = tried; low = mid; } else { high = mid; }
  }
  return { blob: best, fits: true };
}

/**
 * The picture as a data URL, compressed - or untouched when it could not be
 * decoded here, which the API will size-check and explain.
 */
export async function compressImage(file: Blob): Promise<string> {
  let compressed: Blob | null = null;
  try {
    const image = await decode(file);
    try {
      const base = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
      for (const step of SCALES) {
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.width * base * step));
        canvas.height = Math.max(1, Math.round(image.height * base * step));
        const context = canvas.getContext('2d');
        if (!context) break;
        // JPEG has no transparency: without a ground a clear PNG goes black.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image.draw, 0, 0, canvas.width, canvas.height);
        const found = await bestFit(canvas);
        if (!found) break;
        if (!compressed || found.blob.size < compressed.size) compressed = found.blob;
        if (found.fits) { compressed = found.blob; break; }
      }
    } finally {
      image.close();
    }
  } catch {
    return read(file);
  }
  // Store whichever is smaller: what was chosen, or the compressed picture.
  return read(compressed && compressed.size < file.size ? compressed : file);
}
