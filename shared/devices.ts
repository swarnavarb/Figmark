import type { ClientBrowser, ClientDevice, ClientPlatform } from './models.js';

/**
 * Where people use Figmark, as totals for the operators.
 *
 * Counted by person rather than by device: one person with Safari and the
 * home-screen copy on the same iPhone is one iPhone user, who has installed
 * it. A person on two kinds of device counts once in each.
 */

export type PlatformGroup = 'ios' | 'android' | 'desktop' | 'other';

export const PLATFORM_GROUP_LABELS: Record<PlatformGroup, string> = {
  ios: 'iPhone / iPad',
  android: 'Android',
  desktop: 'Computer',
  other: 'Other',
};

export const BROWSER_LABELS: Record<ClientBrowser, string> = {
  safari: 'Safari',
  chrome: 'Chrome',
  samsung: 'Samsung Internet',
  edge: 'Edge',
  firefox: 'Firefox',
  opera: 'Opera',
  other: 'Other',
};

export function groupOf(platform: ClientPlatform): PlatformGroup {
  if (platform === 'ios' || platform === 'android') return platform;
  if (platform === 'mac' || platform === 'windows' || platform === 'linux') return 'desktop';
  return 'other';
}

export interface PlatformFigures {
  group: PlatformGroup;
  /** People who used it on this kind of device. */
  people: number;
  /** ...of whom have ever opened it from the home screen / as an installed app. */
  installed: number;
  /** ...of whom have notifications on on at least one such device. */
  pushOn: number;
  /** ...of whom used it on this kind of device in the last 7 days. */
  active7d: number;
}

export interface BrowserFigures {
  group: PlatformGroup;
  browser: ClientBrowser;
  /** People who used this browser (in a tab, not from the home screen). */
  people: number;
}

export interface DeviceFigures {
  /** People who have reported at least one device. */
  people: number;
  installed: number;
  pushOn: number;
  active7d: number;
  platforms: PlatformFigures[];
  browsers: BrowserFigures[];
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function deviceFigures(
  accounts: ReadonlyArray<{ clientDevices?: readonly ClientDevice[] }>,
  now = Date.now(),
): DeviceFigures {
  const platforms = new Map<PlatformGroup, PlatformFigures>();
  const browsers = new Map<string, BrowserFigures>();
  const totals = { people: 0, installed: 0, pushOn: 0, active7d: 0 };

  for (const account of accounts) {
    const devices = account.clientDevices ?? [];
    if (devices.length === 0) continue;
    totals.people += 1;
    if (devices.some((device) => device.installedAt)) totals.installed += 1;
    if (devices.some((device) => device.push === 'on')) totals.pushOn += 1;
    if (devices.some((device) => now - Date.parse(device.lastSeen) < WEEK_MS)) totals.active7d += 1;

    const byGroup = new Map<PlatformGroup, ClientDevice[]>();
    for (const device of devices) {
      const group = groupOf(device.platform);
      byGroup.set(group, [...(byGroup.get(group) ?? []), device]);
    }
    for (const [group, mine] of byGroup) {
      const row = platforms.get(group) ?? { group, people: 0, installed: 0, pushOn: 0, active7d: 0 };
      row.people += 1;
      if (mine.some((device) => device.installedAt)) row.installed += 1;
      if (mine.some((device) => device.push === 'on')) row.pushOn += 1;
      if (mine.some((device) => now - Date.parse(device.lastSeen) < WEEK_MS)) row.active7d += 1;
      platforms.set(group, row);

      const used = new Set(mine.filter((device) => !device.installed).map((device) => device.browser));
      for (const browser of used) {
        const key = `${group}:${browser}`;
        const entry = browsers.get(key) ?? { group, browser, people: 0 };
        entry.people += 1;
        browsers.set(key, entry);
      }
    }
  }

  const order: PlatformGroup[] = ['ios', 'android', 'desktop', 'other'];
  return {
    ...totals,
    platforms: order.filter((group) => platforms.has(group)).map((group) => platforms.get(group)!),
    browsers: [...browsers.values()].sort((a, b) => b.people - a.people || order.indexOf(a.group) - order.indexOf(b.group)),
  };
}

/** "38%", or "-" when there is nobody to take a share of. */
export function percent(part: number, whole: number): string {
  return whole === 0 ? '-' : `${Math.round((part / whole) * 100)}%`;
}
