import { CATEGORY_GROUPS } from './catalog.js';
import { hashtagsIn } from './feed.js';
import { monthKey } from './quest.js';
import { tagKey, tagFromSlug, tagSlug, tidyLabel, wordKeys } from './shop-tags.js';

/**
 * Hobby leaderboards, as rules.
 *
 * Generic on purpose: no hobby is written into the code. A board is either one
 * of the catalogue's category headings (`cat:figures`, `cat:cards`, … - every
 * heading gets one, today's and any added later) or any hobby somebody puts on
 * their page (`tag:gunpla`, `tag:pokemon`, `tag:resin kit` …), keyed the way
 * shop tags are, so "Gundam kits", "#gunpla" and "Gunpla" land on one board.
 *
 * People join up to BOARD_LIMIT boards. Each board runs in monthly seasons
 * (India time), so it resets on the 1st and a newcomer can top it; the top
 * three of every finished season go into its Hall of Fame and earn the Season
 * Podium honour. Points come only from activity in that hobby - orders
 * delivered, the collection, reviews and posts - never from XP, which would
 * hand the board to whoever has been here longest.
 */

export const BOARD_LIMIT = 3;
/** How many rows a board shows; your own row is added when you are lower. */
export const BOARD_TOP = 25;
/** Finished seasons the Hall of Fame keeps. */
export const HALL_SEASONS = 3;

export const BOARD_POINTS = {
  /** An order in the hobby that arrived. */
  delivered: 10,
  /** A delivered piece put on the collection shelf. */
  collected: 5,
  /** A review of an order in the hobby. */
  review: 5,
  /** A post about the hobby (a hashtag for it, or an item in it). */
  post: 2,
} as const;
/** Posts count up to this many a season, so a board is not won by posting. */
export const BOARD_POST_CAP = 20;

export type BoardKind = 'category' | 'tag';

export interface BoardInfo {
  id: string;
  kind: BoardKind;
  label: string;
  /** An emoji for category boards; tag boards draw a hash. */
  glyph: string | null;
}

/** The board id for a hobby typed by a person, or null when there is nothing to key. */
export function tagBoardId(raw: string): string | null {
  const key = tagKey(raw.replace(/^#/, ''));
  return key.length >= 2 ? `tag:${tagSlug(key)}` : null;
}

/** What an id names, or null for one that is not a board. */
export function boardInfo(id: string): BoardInfo | null {
  if (id.startsWith('cat:')) {
    const group = CATEGORY_GROUPS.find((entry) => entry.id === id.slice(4));
    return group ? { id, kind: 'category', label: group.label, glyph: group.glyph } : null;
  }
  if (id.startsWith('tag:')) {
    const key = tagFromSlug(id.slice(4));
    if (key.length < 2 || `tag:${tagSlug(key)}` !== id) return null;
    return { id, kind: 'tag', label: tidyLabel(key), glyph: null };
  }
  return null;
}

/** Every category board, in catalogue order. */
export function categoryBoards(): BoardInfo[] {
  return CATEGORY_GROUPS.map((group) => ({ id: `cat:${group.id}`, kind: 'category', label: group.label, glyph: group.glyph }));
}

/** The words a tag board is matched by: "resin kit" needs both words. */
function tagWords(id: string): string[] {
  return tagFromSlug(id.slice(4)).split(' ').filter(Boolean);
}

interface ListingLike {
  category: string;
  title: string;
  tags?: readonly string[];
}

/** Whether an item belongs to a board's hobby. */
export function listingOnBoard(boardId: string, listing: ListingLike): boolean {
  if (boardId.startsWith('cat:')) {
    return CATEGORY_GROUPS.find((group) => `cat:${group.id}` === boardId)?.members.includes(listing.category) ?? false;
  }
  const key = tagFromSlug(boardId.slice(4));
  if ((listing.tags ?? []).some((tag) => tagKey(tag) === key) || tagKey(listing.category) === key) return true;
  const words = new Set(wordKeys(listing.title));
  return tagWords(boardId).every((word) => words.has(word));
}

/** Whether a post is about a board's hobby: a hashtag for it, or an item in it. */
export function postOnBoard(boardId: string, post: { body: string }, listing: ListingLike | null): boolean {
  if (listing && listingOnBoard(boardId, listing)) return true;
  const tags = hashtagsIn(post.body);
  if (boardId.startsWith('cat:')) {
    const group = CATEGORY_GROUPS.find((entry) => `cat:${entry.id}` === boardId);
    if (!group) return false;
    const keys = new Set([tagKey(group.id), tagKey(group.label), ...group.members.map(tagKey)]);
    return tags.some((tag) => keys.has(tag));
  }
  return tags.includes(tagFromSlug(boardId.slice(4)));
}

/** One person's season on one board, already filtered to the hobby. */
export interface BoardActivity {
  delivered: string[];
  collected: string[];
  reviews: string[];
  posts: string[];
}

export interface BoardScore {
  points: number;
  delivered: number;
  collected: number;
  reviews: number;
  posts: number;
}

/** Points for one season (a monthKey) from timestamps of activity in the hobby. */
export function boardScore(activity: BoardActivity, season: string): BoardScore {
  const inSeason = (list: string[]) => list.filter((at) => monthKey(at) === season).length;
  const delivered = inSeason(activity.delivered);
  const collected = inSeason(activity.collected);
  const reviews = inSeason(activity.reviews);
  const posts = Math.min(BOARD_POST_CAP, inSeason(activity.posts));
  return {
    points: delivered * BOARD_POINTS.delivered + collected * BOARD_POINTS.collected
      + reviews * BOARD_POINTS.review + posts * BOARD_POINTS.post,
    delivered, collected, reviews, posts,
  };
}

/** The season an instant falls in, and the ones before it, newest first. */
export function seasonsBack(now: number, count: number): string[] {
  const seasons: string[] = [];
  let [year, month] = monthKey(now).split('-').map(Number) as [number, number];
  for (let index = 0; index < count; index += 1) {
    seasons.push(`${year}-${String(month).padStart(2, '0')}`);
    month -= 1;
    if (month === 0) { month = 12; year -= 1; }
  }
  return seasons;
}

/** "November 2026" for a season key. */
export function seasonLabel(season: string): string {
  const [year, month] = season.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** A row on a board as the app reads it. */
export interface BoardRow extends BoardScore {
  rank: number;
  userId: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
}

export interface BoardView {
  board: BoardInfo & { members: number };
  season: string;
  /** When the season ends, as an ISO instant. */
  endsAt: string;
  rows: BoardRow[];
  /** The viewer's own row, when they are on the board but not in `rows`. */
  me: BoardRow | null;
  joined: boolean;
  hall: { season: string; podium: BoardRow[] }[];
}

/** The first instant of the season after this one, India time. */
export function seasonEndsAt(season: string): string {
  const [year, month] = season.split('-').map(Number) as [number, number];
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return new Date(Date.parse(`${next}-01T00:00:00+05:30`)).toISOString();
}

/** Ranks rows: points first, then delivered orders, then whoever is earlier in the list. Zero-point rows are left out. */
export function rankRows<T extends BoardScore>(rows: T[]): (T & { rank: number })[] {
  return rows
    .filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || b.delivered - a.delivered)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}
