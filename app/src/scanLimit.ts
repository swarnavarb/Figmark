/**
 * How often one person may tap "Scan with AI", whichever service reads the
 * photo - Figmark's free keys or their own Puter account.
 *
 * The server holds its own count for Figmark's keys (aiscan in
 * api/src/rate-limit.ts); this one also covers Puter, which the server never
 * sees, so nobody scans the same photo over and over. Kept on the device:
 * clearing it only gets back what the server and Puter still limit.
 */

/** A pause between scans: long enough that a second tap is a decision, not a habit. */
export const SCAN_GAP_MS = 20_000;
/** Each photo: the first scan and one more try. */
export const SCANS_PER_PHOTO = 2;
/** All photos, per day on this device. */
export const SCANS_PER_DAY = 20;

const DAY_KEY = 'figmark.aiScans';
const perPhoto = new Map<string, number>();
let lastAt = 0;

function today(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

function readDay(now: number): number {
  try {
    const stored = JSON.parse(window.localStorage.getItem(DAY_KEY) ?? 'null') as { day?: string; count?: number } | null;
    return stored?.day === today(now) ? stored.count ?? 0 : 0;
  } catch {
    return 0;
  }
}

export type ScanAllowance = { ok: true } | { ok: false; message: string; waitMs?: number };

/** Whether this photo may be scanned now, or what to say instead. */
export function scanAllowance(photo: string, now = Date.now()): ScanAllowance {
  if ((perPhoto.get(photo) ?? 0) >= SCANS_PER_PHOTO) {
    return { ok: false, message: 'This photo has had its AI scans. Tap or draw around anything it missed.' };
  }
  if (readDay(now) >= SCANS_PER_DAY) {
    return { ok: false, message: `That's ${SCANS_PER_DAY} AI scans today. More tomorrow.` };
  }
  const wait = lastAt + SCAN_GAP_MS - now;
  if (wait > 0) return { ok: false, message: `You can scan again in ${Math.ceil(wait / 1000)}s.`, waitMs: wait };
  return { ok: true };
}

/** Count one scan, as it starts: a scan that fails still asked a service. */
export function noteScan(photo: string, now = Date.now()): void {
  perPhoto.set(photo, (perPhoto.get(photo) ?? 0) + 1);
  lastAt = now;
  try {
    window.localStorage.setItem(DAY_KEY, JSON.stringify({ day: today(now), count: readDay(now) + 1 }));
  } catch { /* storage blocked: the gap and the per-photo count still hold */ }
}

/** Test seam. */
export function resetScanLimit(): void {
  perPhoto.clear();
  lastAt = 0;
}
