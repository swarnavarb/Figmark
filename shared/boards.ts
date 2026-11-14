import { hashtagsIn } from './feed.js';
import { monthKey } from './quest.js';
import { tagKey, tagFromSlug } from './shop-tags.js';

/**
 * Hobby leaderboards, as rules.
 *
 * A fixed set of broad hobby boards - Action figures, Sneakers, Trading cards
 * and so on - each covering one or more listing categories. Boards are not
 * made up by people: one place per hobby keeps every board busy enough to be
 * worth topping, and nobody can start a board under a rude or misspelt name.
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
/** Seasons a member's stored score keeps: this one and the Hall of Fame's. */
export const SCORE_SEASONS = HALL_SEASONS + 1;

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

export interface BoardCategory {
  /** The board id is `cat:<id>`. */
  id: string;
  label: string;
  glyph: string;
  /** Listing categories (catalog CATEGORIES) the board covers. Every category is on exactly one board. */
  members: readonly string[];
  /** Extra hashtags that mean this hobby, besides its name and categories. */
  hashtags: readonly string[];
}

/**
 * The boards. Broad on purpose: a board people actually compete on beats ten
 * empty ones. The ids `figures`, `models`, `cards`, `tech`, `beauty` and `home`
 * are the ones the first boards used, so members and podiums carry over.
 */
export const BOARD_CATEGORIES: readonly BoardCategory[] = [
  { id: 'figures', label: 'Action figures', glyph: '🦸', members: ['Figures', 'Collectibles'],
    hashtags: ['action figure', 'figure', 'figurine', 'nendoroid', 'figma', 'statue', 'scale figure', 'collectible'] },
  { id: 'anime', label: 'Anime merch', glyph: '🎌', members: ['Anime merch'],
    hashtags: ['anime', 'plushy', 'keychain', 'acrylic stand'] },
  { id: 'models', label: 'Model kits', glyph: '🤖', members: ['Model kits'],
    hashtags: ['gunpla', 'model kit', 'plamo', 'resin kit'] },
  { id: 'cards', label: 'Trading cards', glyph: '🃏', members: ['Trading cards'],
    hashtags: ['tcg', 'pokemon tcg', 'trading card', 'card'] },
  { id: 'sneakers', label: 'Sneakers', glyph: '👟', members: ['Sneakers'],
    hashtags: ['sneaker', 'kick', 'sneakerhead'] },
  { id: 'streetwear', label: 'Streetwear', glyph: '🧢', members: ['Streetwear'],
    hashtags: ['streetwear', 'fit', 'drip'] },
  { id: 'tech', label: 'Gaming & tech', glyph: '🎮', members: ['Games & consoles', 'Electronics'],
    hashtags: ['gaming', 'game', 'console', 'tech', 'retro gaming'] },
  { id: 'books', label: 'Books & manga', glyph: '📚', members: ['Books & manga'],
    hashtags: ['manga', 'book', 'comic', 'artbook'] },
  { id: 'beauty', label: 'Beauty & bags', glyph: '💄', members: ['Beauty', 'Bags & watches'],
    hashtags: ['beauty', 'skincare', 'kbeauty', 'bag', 'watch'] },
  { id: 'home', label: 'Home & decor', glyph: '🏠', members: ['Home & decor'],
    hashtags: ['home decor', 'decor', 'room tour', 'shelf'] },
];

/** Board ids from before the boards were broadened, and where their members went. */
const RENAMED: Record<string, string> = { 'cat:wear': 'cat:sneakers' };

export type BoardKind = 'category';

export interface BoardInfo {
  id: string;
  kind: BoardKind;
  label: string;
  glyph: string;
}

const BY_ID = new Map(BOARD_CATEGORIES.map((board) => [`cat:${board.id}`, board]));

/** Every key a board answers to: its id, name, categories and hashtags, keyed like tags. */
function keysOf(board: BoardCategory): Set<string> {
  return new Set([board.id, board.label, ...board.members, ...board.hashtags].map(tagKey).filter((key) => key.length >= 2));
}
const KEYS = new Map(BOARD_CATEGORIES.map((board) => [`cat:${board.id}`, keysOf(board)]));

/**
 * The board an id stands for today, or null.
 *
 * A current id is itself; a renamed one is where it went; an old hobby-tag
 * board (`tag:gunpla`) is the category board that hobby belongs to, when one
 * does - so nobody who joined one is simply dropped.
 */
export function currentBoardId(id: string): string | null {
  if (BY_ID.has(id)) return id;
  if (RENAMED[id]) return RENAMED[id]!;
  if (id.startsWith('tag:')) {
    const key = tagFromSlug(id.slice(4));
    for (const [boardId, keys] of KEYS) if (keys.has(key)) return boardId;
  }
  return null;
}

/** The board a hobby typed by a person belongs to ("gunpla" → Model kits), or null. */
export function boardForHobby(raw: string): string | null {
  const key = tagKey(raw.replace(/^#/, ''));
  for (const [boardId, keys] of KEYS) if (keys.has(key)) return boardId;
  return null;
}

/** Every stored id that now means `boardId`, itself included. */
export function idsFor(boardId: string): string[] {
  return [boardId, ...Object.entries(RENAMED).filter(([, to]) => to === boardId).map(([from]) => from)];
}

/** A person's boards as they are today: old ids mapped, unknown ones dropped, no repeats, at most the limit. */
export function currentBoards(ids: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const id of ids ?? []) {
    const now = currentBoardId(id);
    if (now && !out.includes(now)) out.push(now);
  }
  return out.slice(0, BOARD_LIMIT);
}

/** What an id names, or null for one that is not a board (old ids are read as their board). */
export function boardInfo(id: string): BoardInfo | null {
  const current = currentBoardId(id);
  const board = current ? BY_ID.get(current) : undefined;
  return board ? { id: `cat:${board.id}`, kind: 'category', label: board.label, glyph: board.glyph } : null;
}

/** Every board, in order. */
export function categoryBoards(): BoardInfo[] {
  return BOARD_CATEGORIES.map((board) => ({ id: `cat:${board.id}`, kind: 'category', label: board.label, glyph: board.glyph }));
}

/** The board a listing category is on, or null for one no board covers. */
export function boardForCategory(category: string): string | null {
  const board = BOARD_CATEGORIES.find((entry) => entry.members.includes(category));
  return board ? `cat:${board.id}` : null;
}

interface ListingLike {
  category: string;
}

/** Whether an item belongs to a board's hobby: its category is one the board covers. */
export function listingOnBoard(boardId: string, listing: ListingLike): boolean {
  return BY_ID.get(currentBoardId(boardId) ?? '')?.members.includes(listing.category) ?? false;
}

/** Whether a post is about a board's hobby: an item in it, or a hashtag for it. */
export function postOnBoard(boardId: string, post: { body: string }, listing: ListingLike | null): boolean {
  if (listing) return listingOnBoard(boardId, listing);
  const keys = KEYS.get(currentBoardId(boardId) ?? '');
  return keys ? hashtagsIn(post.body).some((tag) => keys.has(tag)) : false;
}

/** One person's activity in one hobby, as timestamps. */
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

/** A member's score on one board, as kept on their account so a board is read in one query. */
export interface StoredBoardScore {
  /** When it was last counted. */
  at: string;
  /** Season (monthKey) to score; seasons with nothing in them are left out. */
  seasons: Record<string, BoardScore>;
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

/** The stored form of an activity: every season shown, scored, empty ones left out. */
export function storedScore(activity: BoardActivity, now: number): StoredBoardScore {
  const seasons: Record<string, BoardScore> = {};
  for (const season of seasonsBack(now, SCORE_SEASONS)) {
    const score = boardScore(activity, season);
    if (score.points > 0) seasons[season] = score;
  }
  return { at: new Date(now).toISOString(), seasons };
}

export const EMPTY_SCORE: BoardScore = { points: 0, delivered: 0, collected: 0, reviews: 0, posts: 0 };

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

/** Which rows a board shows: everybody, or only the people the viewer follows (and the viewer). */
export type BoardScope = 'all' | 'following';

export interface BoardView {
  board: BoardInfo & { members: number };
  season: string;
  /** When the season ends, as an ISO instant. */
  endsAt: string;
  scope: BoardScope;
  rows: BoardRow[];
  /** The viewer's own row, when they are on the board but not in `rows`. */
  me: BoardRow | null;
  /** How far the viewer is from the next place up, when there is one to chase. */
  gap: BoardGap | null;
  joined: boolean;
  hall: { season: string; podium: BoardRow[] }[];
}

/** "You're #4, 12 points behind #3." */
export interface BoardGap {
  rank: number;
  /** The rank above, and the points needed to draw level with it. */
  aheadRank: number;
  points: number;
}

/** The first instant of the season after this one, India time. */
export function seasonEndsAt(season: string): string {
  const [year, month] = season.split('-').map(Number) as [number, number];
  const next = month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, '0')}`;
  return new Date(Date.parse(`${next}-01T00:00:00+05:30`)).toISOString();
}

/**
 * Ranks rows: points first, then delivered orders. People level on both share
 * a rank (1, 2, 2, 4), so a tie is never settled by who happens to be read
 * first. Zero-point rows are left out.
 */
export function rankRows<T extends BoardScore>(rows: T[]): (T & { rank: number })[] {
  const sorted = rows.filter((row) => row.points > 0)
    .sort((a, b) => b.points - a.points || b.delivered - a.delivered);
  let rank = 0;
  return sorted.map((row, index) => {
    const prev = sorted[index - 1];
    if (!prev || prev.points !== row.points || prev.delivered !== row.delivered) rank = index + 1;
    return { ...row, rank };
  });
}

/** The top three places of a ranked season: everybody ranked 1st, 2nd or 3rd, ties included. */
export function podiumOf<T extends { rank: number }>(rows: readonly T[]): T[] {
  return rows.filter((row) => row.rank <= 3);
}

/** How far a ranked viewer is from the next place up, or null at the top or off the board. */
export function gapFor(rows: readonly BoardRow[], userId: string): BoardGap | null {
  const mine = rows.find((row) => row.userId === userId);
  if (!mine || mine.rank === 1) return null;
  const ahead = [...rows].reverse().find((row) => row.rank < mine.rank);
  if (!ahead) return null;
  return { rank: mine.rank, aheadRank: ahead.rank, points: Math.max(1, ahead.points - mine.points) };
}
