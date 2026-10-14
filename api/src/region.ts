import { config } from './config.js';

/**
 * Where a request probably comes from, as a dispatch region: "Pune, MH".
 *
 * Read from the IP address on the server, so the browser never asks to share
 * a location - the app's Permissions-Policy switches geolocation off entirely.
 * It is only ever a pre-filled guess the seller can change.
 *
 * One lookup per address: answers (and failures) are kept for a day, so a
 * shop opened twice from the same network costs nothing the second time.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; region: string | null }>();

/** Addresses that say nothing about a place: loopback, private, link-local. */
export function isPrivateIp(ip: string): boolean {
  if (!ip || ip === 'unknown') return true;
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip.replace(/^::ffff:/, ''));
  if (!v4) return false;
  const [a, b] = [Number(v4[1]), Number(v4[2])];
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** The lookup's answer as a region: city and state code in India, city and country elsewhere. */
export function regionFrom(answer: {
  error?: boolean; city?: string | null; region_code?: string | null; region?: string | null;
  country_code?: string | null; country_name?: string | null;
} | null): string | null {
  if (!answer || answer.error) return null;
  const city = answer.city?.trim();
  if (!city) return null;
  const tail = answer.country_code === 'IN'
    ? answer.region_code?.trim() || answer.region?.trim()
    : answer.country_name?.trim();
  return (tail ? `${city}, ${tail}` : city).slice(0, 60);
}

export async function guessRegion(ip: string): Promise<string | null> {
  if (!config.regionGuess || isPrivateIp(ip)) return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < DAY_MS) return hit.region;
  let region: string | null = null;
  try {
    const response = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
      headers: { 'user-agent': 'figmark' },
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) region = regionFrom(await response.json() as Parameters<typeof regionFrom>[0]);
  } catch {
    region = null;
  }
  if (cache.size > 5000) cache.clear();
  cache.set(ip, { at: Date.now(), region });
  return region;
}
