import type { ChannelRow } from '../api';

/*
 * What you have seen in channels and forums, on this device.
 *
 * Apart from Channels.tsx so the social header can show unread dots without
 * loading the channel screen and everything it draws with.
 */

const SEEN_KEY = 'figmark.channels.seen';

/**
 * When each room was last opened on this device.
 *
 * Kept on the device rather than on the server: it is a nudge, not a record,
 * and a read receipt per person per room would be a write on every visit for
 * something a phone can remember perfectly well.
 */
export function seenMap(): Record<string, string> {
  try {
    return JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '{}') as Record<string, string>;
  } catch {
    return {};
  }
}

export function markSeen(channelId: string) {
  try {
    const map = seenMap();
    map[channelId] = new Date().toISOString();
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(map));
  } catch {
    /* Unread counts just stay; nothing else depends on it. */
  }
}

/** How many messages arrived since you last opened it. Never opened: all of the recent ones. */
export function unreadOf(row: ChannelRow, seen: Record<string, string>): number {
  const since = seen[row.sellerId];
  return (row.recent ?? []).filter((at) => !since || at > since).length;
}

/** A forum you are in with a post since you last opened it. */
export function forumHasNews(row: { id: string; member: boolean; lastPostAt?: string | null }, seen: Record<string, string>): boolean {
  return row.member && Boolean(row.lastPostAt) && (!seen[row.id] || row.lastPostAt! > seen[row.id]!);
}
