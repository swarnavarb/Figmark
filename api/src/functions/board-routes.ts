import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  BOARD_LIMIT, BOARD_TOP, EMPTY_SCORE, HALL_SEASONS, SCORE_SEASONS, boardForHobby, boardInfo, categoryBoards,
  currentBoardId, currentBoards, gapFor, idsFor, listingOnBoard, podiumOf, postOnBoard, rankRows, seasonEndsAt,
  seasonsBack, storedScore, type BoardActivity, type BoardRow, type BoardScope, type BoardView, type StoredBoardScore,
} from '../../../shared/boards.js';
import type { Listing, User } from '../../../shared/models.js';
import { isCancelledLike, isPlaced } from '../../../shared/orders.js';
import { PERSON_FOLLOW, isPersonFollow } from '../../../shared/storefront.js';
import { getAuthService } from '../auth/index.js';
import { inBatches } from '../data/concurrency.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * Hobby leaderboards: which boards there are, joining and leaving them, and
 * one board's season. The rules are in `shared/boards.ts`.
 *
 * Each member's score is kept on their own account (`boardScores`), so a
 * board is one query over its members rather than a recount of every
 * member's orders and posts on every read. Scores are recounted by the clock
 * once an hour, for whoever opens a board, for a few of the stalest members
 * on each read (so a host with no clock still catches up), and at once when
 * somebody joins. A finished season's podium is written onto the winners'
 * accounts once everybody's score for it has been counted after it ended.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Members read for one board, in one query. */
const MEMBER_LIMIT = 5000;
/** A score older than this is recounted when the board is read. */
const STALE_MS = 3_600_000;
/** How many stale members one read recounts, on top of the viewer. */
const READ_REFRESH = 15;
/** The clock recounts anybody whose score is older than this. */
const CLOCK_STALE_MS = 50 * 60_000;
/** How long one reading of a board is served before it is read again. */
const BOARD_TTL_MS = 60_000;

interface BoardRead {
  /** Ranked rows per season, newest first, matching `seasons`. */
  rows: BoardRow[][];
  seasons: string[];
  /** Every member, with their score's freshness, for podium and refresh decisions. */
  members: { user: User; at: number }[];
}
const cache = new Map<string, { at: number; read: Promise<BoardRead> }>();

/** When an order arrived, for the season it counts in. Never `updatedAt`: a later edit must not move it. */
function arrivedAt(order: { completedAt?: string | null; placedAt?: string | null; createdAt: string }): string {
  return order.completedAt ?? order.placedAt ?? order.createdAt;
}

/** Everything a member did in one hobby, as timestamps. */
async function activityOf(repository: Repo, member: User, boardId: string, listings: Map<string, Promise<Listing | null>>): Promise<BoardActivity> {
  const listing = (id: string) => {
    let pending = listings.get(id);
    if (!pending) {
      pending = repository.getListing(id).catch(() => null);
      listings.set(id, pending);
    }
    return pending;
  };
  const [orders, posts] = await Promise.all([
    repository.listOrdersForBuyer(member.id),
    repository.listPostsByAuthor(member.id),
  ]);

  const placed = orders.filter((order) => isPlaced(order) && !isCancelledLike(order.status));
  const onBoard = new Map<string, boolean>();
  const check = async (listingId: string) => {
    if (!onBoard.has(listingId)) {
      const item = await listing(listingId);
      onBoard.set(listingId, item ? listingOnBoard(boardId, item) : false);
    }
    return onBoard.get(listingId)!;
  };
  for (const order of placed) await check(order.listingId);
  const hobbyOrders = placed.filter((order) => onBoard.get(order.listingId));
  const delivered = hobbyOrders.filter((order) => order.status === 'delivered').map(arrivedAt);

  const collected: string[] = [];
  for (const item of member.collection ?? []) {
    if (await check(item.listingId)) collected.push(item.addedAt);
  }

  const reviews = (await Promise.all(hobbyOrders.map((order) => repository.listReviewsForOrder(order.id))))
    .flat().filter((review) => review.authorId === member.id).map((review) => review.createdAt);

  const postStamps: string[] = [];
  for (const post of posts) {
    const item = post.listingId ? await listing(post.listingId) : null;
    if (postOnBoard(boardId, post, item)) postStamps.push(post.createdAt);
  }
  return { delivered, collected, reviews, posts: postStamps };
}

/**
 * Recounts one person's score on each of their boards and saves it.
 *
 * Reads the account whole (a query hands it back without its collection),
 * puts its boards into today's ids on the way, and writes only when something
 * moved. A write that loses a race is skipped: the next refresh tries again.
 */
export async function refreshScores(repository: Repo, userId: string, now = Date.now(),
  listings = new Map<string, Promise<Listing | null>>()): Promise<User | null> {
  const user = await repository.getUserById(userId);
  if (!user) return null;
  const boards = currentBoards(user.boards);
  const scores: Record<string, StoredBoardScore> = {};
  for (const boardId of boards) scores[boardId] = storedScore(await activityOf(repository, user, boardId, listings), now);
  const before = JSON.stringify({ boards: user.boards ?? [], seasons: Object.fromEntries(Object.entries(user.boardScores ?? {}).map(([id, entry]) => [id, entry.seasons])) });
  const after = JSON.stringify({ boards, seasons: Object.fromEntries(Object.entries(scores).map(([id, entry]) => [id, entry.seasons])) });
  // Unchanged scores are still re-stamped now and then: a podium waits for every
  // member to have been counted after the season ended, and the board recounts
  // whoever looks stale.
  const seasonStart = Date.parse(seasonEndsAt(seasonsBack(now, 2)[1]!));
  const restamp = boards.some((id) => {
    const at = user.boardScores?.[id] ? Date.parse(user.boardScores[id]!.at) : 0;
    return at < seasonStart || now - at > STALE_MS;
  });
  if (before === after && !restamp) return user;
  user.boards = boards;
  user.boardScores = scores;
  user.updatedAt = new Date(now).toISOString();
  try {
    await repository.updateUser(user);
  } catch {
    // Somebody changed the account at the same moment; the score is recounted next time.
  }
  return user;
}

/** Everybody on a board, under its id and any id it used to have. */
async function membersOf(repository: Repo, boardId: string): Promise<User[]> {
  const lists = await Promise.all(idsFor(boardId).map((id) => repository.listBoardMembers(id, MEMBER_LIMIT)));
  const seen = new Map<string, User>();
  for (const user of lists.flat()) if (!seen.has(user.id)) seen.set(user.id, user);
  return [...seen.values()];
}

const scoreAt = (user: User, boardId: string) => {
  const stored = user.boardScores?.[boardId];
  return stored ? Date.parse(stored.at) : 0;
};

/** Ranked rows for every season kept, from the members' stored scores. */
function rowsFrom(members: User[], boardId: string, seasons: string[]): BoardRow[][] {
  return seasons.map((season) => rankRows(members.map((member) => ({
    userId: member.id,
    name: member.displayName,
    handle: member.username ?? null,
    photoUrl: member.photoUrl ?? null,
    ...(member.boardScores?.[boardId]?.seasons[season] ?? EMPTY_SCORE),
  }))));
}

/**
 * Reads a board: every member in one query, a few of the stalest recounted
 * first (and `alsoRefresh`, the viewer, always), then ranked per season.
 */
async function computeBoard(repository: Repo, boardId: string, now: number, alsoRefresh: string | null): Promise<BoardRead> {
  const seasons = seasonsBack(now, SCORE_SEASONS);
  let members = await membersOf(repository, boardId);
  const stale = members
    .filter((member) => now - scoreAt(member, boardId) > STALE_MS)
    .sort((a, b) => scoreAt(a, boardId) - scoreAt(b, boardId))
    .slice(0, READ_REFRESH)
    .map((member) => member.id);
  if (alsoRefresh && members.some((member) => member.id === alsoRefresh) && !stale.includes(alsoRefresh)) stale.push(alsoRefresh);
  if (stale.length > 0) {
    const listings = new Map<string, Promise<Listing | null>>();
    const fresh = new Map((await inBatches(stale, 5, (id) => refreshScores(repository, id, now, listings)))
      .filter((user): user is User => user !== null).map((user) => [user.id, user]));
    members = members.map((member) => fresh.get(member.id) ?? member)
      .filter((member) => currentBoards(member.boards).includes(boardId));
  }
  const rows = rowsFrom(members, boardId, seasons);
  const read: BoardRead = { rows, seasons, members: members.map((user) => ({ user, at: scoreAt(user, boardId) })) };
  await recordPodiums(repository, boardId, read);
  return read;
}

/** (board, season) pairs this instance has already written every podium for. */
const recorded = new Set<string>();

/**
 * Writes each finished season's top three onto their accounts, once - but
 * only once every member's score was counted after the season ended, so a
 * podium is never handed out on a count that was still missing the last days.
 * Tied places all count: two people level in second both get second.
 */
async function recordPodiums(repository: Repo, boardId: string, read: BoardRead) {
  for (let index = 1; index < read.seasons.length; index += 1) {
    const season = read.seasons[index]!;
    const memo = `${boardId}|${season}`;
    if (recorded.has(memo)) continue;
    const ended = Date.parse(seasonEndsAt(season));
    if (read.members.some((member) => member.at < ended)) continue;
    for (const row of podiumOf(read.rows[index] ?? [])) {
      const place = row.rank as 1 | 2 | 3;
      const user = await repository.getUserById(row.userId);
      if (!user || (user.podiums ?? []).some((entry) => (currentBoardId(entry.board) ?? entry.board) === boardId && entry.season === season)) continue;
      user.podiums = [...(user.podiums ?? []), { board: boardId, season, place }];
      user.updatedAt = new Date().toISOString();
      await repository.updateUser(user);
    }
    recorded.add(memo);
  }
}

function readBoard(repository: Repo, boardId: string, viewerId: string | null) {
  const now = Date.now();
  const hit = cache.get(boardId);
  if (hit && now - hit.at < BOARD_TTL_MS) return hit.read;
  const read = computeBoard(repository, boardId, now, viewerId);
  cache.set(boardId, { at: now, read });
  // A failed read is not kept: the next visitor tries again.
  read.catch(() => { if (cache.get(boardId)?.read === read) cache.delete(boardId); });
  return read;
}

/** Dropped when somebody joins or leaves, so they see themselves at once. */
function forget(boardId: string) {
  cache.delete(boardId);
}

/**
 * The clock's part: every board's members recounted (anybody counted in the
 * last hour is skipped) and finished seasons' podiums written. Returns how
 * many accounts were recounted.
 */
export async function refreshBoards(repository: Repo, now = Date.now()): Promise<number> {
  let counted = 0;
  const listings = new Map<string, Promise<Listing | null>>();
  const done = new Set<string>();
  for (const board of categoryBoards()) {
    const members = await membersOf(repository, board.id);
    const due = members.filter((member) => !done.has(member.id) && now - scoreAt(member, board.id) > CLOCK_STALE_MS).map((member) => member.id);
    await inBatches(due, 5, async (id) => {
      done.add(id);
      await refreshScores(repository, id, now, listings);
    });
    counted += due.length;
    forget(board.id);
    await readBoard(repository, board.id, null);
  }
  return counted;
}

/** Board counts with old ids folded into the boards they became. */
async function memberCounts(repository: Repo): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const entry of await repository.boardCounts()) {
    const id = currentBoardId(entry.board);
    if (id) counts.set(id, (counts.get(id) ?? 0) + entry.members);
  }
  return counts;
}

/**
 * GET /api/boards - every board and how many are on it, and - signed in -
 * yours and the boards the hobbies on your page belong to.
 */
async function listBoards(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const viewer = await (await getAuthService()).getCurrentUser(request);
  const counts = await memberCounts(repository);
  const boards = categoryBoards().map((info) => ({ ...info, members: counts.get(info.id) ?? 0 }));

  let mine: string[] = [];
  let suggestions: typeof boards = [];
  let podiums: NonNullable<User['podiums']> = [];
  if (viewer) {
    const account = await repository.getUserById(viewer.id);
    mine = currentBoards(account?.boards);
    // Your own top-three finishes, newest first, under today's board ids, shown small above the boards.
    podiums = (account?.podiums ?? [])
      .map((entry) => ({ ...entry, board: currentBoardId(entry.board) ?? entry.board }))
      .sort((a, b) => b.season.localeCompare(a.season) || a.place - b.place);
    const hinted = new Set((account?.tags ?? []).map(boardForHobby).filter((id): id is string => id !== null));
    suggestions = boards.filter((board) => hinted.has(board.id) && !mine.includes(board.id));
  }
  return json(200, { boards, mine, suggestions, podiums, limit: BOARD_LIMIT });
}

/** The board a request names: `{ board }`, or `{ tag }` from older apps, read as the board that hobby is on. */
async function boardBody(request: HttpRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { board?: unknown; tag?: unknown };
    if (typeof body.board === 'string') return currentBoardId(body.board);
    if (typeof body.tag === 'string') return boardForHobby(body.tag);
    return null;
  } catch {
    return null;
  }
}

/** POST /api/boards/join - { board }: join a board, up to the limit. Joining twice is not an error. */
async function joinBoard(request: HttpRequest, _context: InvocationContext) {
  const principal = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const id = await boardBody(request);
  const info = id ? boardInfo(id) : null;
  if (!info) return error(400, 'invalid_board', 'Pick one of the hobby boards.');
  const boards = currentBoards(user.boards);
  if (boards.includes(info.id)) return json(200, { boards, joined: info });
  if (boards.length >= BOARD_LIMIT) {
    return error(409, 'board_limit', `You can be on ${BOARD_LIMIT} boards at a time. Leave one to join another.`);
  }
  user.boards = [...boards, info.id];
  user.updatedAt = new Date().toISOString();
  await repository.updateUser(user);
  // Counted now, so whatever they already did this month puts them on the board at once.
  await refreshScores(repository, user.id).catch(() => null);
  forget(info.id);
  return json(200, { boards: user.boards, joined: info });
}

/** POST /api/boards/leave - { board }. Leaving a board you are not on is not an error. */
async function leaveBoard(request: HttpRequest, _context: InvocationContext) {
  const principal = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const id = await boardBody(request);
  if (!id) return error(400, 'invalid_board', 'Which board?');
  const boards = currentBoards(user.boards);
  if (boards.includes(id) || (user.boards ?? []).some((stored) => currentBoardId(stored) === id)) {
    user.boards = boards.filter((board) => board !== id);
    if (user.boardScores?.[id]) {
      const { [id]: _gone, ...rest } = user.boardScores;
      user.boardScores = rest;
    }
    user.updatedAt = new Date().toISOString();
    await repository.updateUser(user);
    forget(id);
  }
  return json(200, { boards: user.boards ?? [] });
}

/**
 * GET /api/boards/board/{id} - this season's standings on one board
 * (`?season=` reads one of the Hall of Fame's seasons instead;
 * `?scope=following` ranks only the people you follow, and you), your own
 * row, how far you are from the next place, and the seasons before.
 */
async function readOneBoard(request: HttpRequest, _context: InvocationContext) {
  const id = decodeURIComponent(request.params.id ?? '');
  const info = boardInfo(id);
  if (!info) return error(404, 'not_found', 'No such board.');
  const repository = await getRepository();
  const viewer = await (await getAuthService()).getCurrentUser(request);
  const account = viewer ? await repository.getUserById(viewer.id) : null;
  const joined = currentBoards(account?.boards).includes(info.id);
  // The viewer's own score is recounted before their board is read, so what they just did shows.
  if (joined && account) {
    const was = JSON.stringify(account.boardScores?.[info.id]?.seasons ?? null);
    const fresh = await refreshScores(repository, account.id).catch(() => null);
    if (fresh && JSON.stringify(fresh.boardScores?.[info.id]?.seasons ?? null) !== was) forget(info.id);
  }
  const [{ rows, seasons }, counts] = await Promise.all([
    readBoard(repository, info.id, null),
    memberCounts(repository),
  ]);
  const asked = request.query.get('season');
  const at = asked ? Math.max(0, seasons.indexOf(asked)) : 0;
  const season = seasons[at]!;

  let scope: BoardScope = request.query.get('scope') === 'following' && account ? 'following' : 'all';
  let standings = rows[at] ?? [];
  if (scope === 'following') {
    const follows = await repository.listFollowsBy(account!.id);
    const people = new Set(follows.filter((follow) => isPersonFollow(follow.sellerId))
      .map((follow) => follow.sellerId.slice(PERSON_FOLLOW.length)));
    people.add(account!.id);
    standings = rankRows(standings.filter((row) => people.has(row.userId)));
  } else {
    scope = 'all';
  }

  const mine = account ? standings.find((row) => row.userId === account.id) ?? null : null;
  const view: BoardView = {
    board: { ...info, members: counts.get(info.id) ?? 0 },
    season,
    endsAt: seasonEndsAt(season),
    scope,
    rows: standings.slice(0, BOARD_TOP),
    me: mine && !standings.slice(0, BOARD_TOP).includes(mine) ? mine : null,
    gap: account && at === 0 ? gapFor(standings, account.id) : null,
    joined,
    hall: seasons.slice(1, HALL_SEASONS + 1).map((past, index) => ({ season: past, podium: podiumOf(rows[index + 1] ?? []) })),
  };
  return json(200, view);
}

export const boardsListRoute = handler(listBoards);
export const boardJoinRoute = handler(joinBoard);
export const boardLeaveRoute = handler(leaveBoard);
export const boardReadRoute = handler(readOneBoard);

const anon = { authLevel: 'anonymous' } as const;
app.http('boards-list', { ...anon, methods: ['GET'], route: 'boards', handler: boardsListRoute });
app.http('boards-join', { ...anon, methods: ['POST'], route: 'boards/join', handler: boardJoinRoute });
app.http('boards-leave', { ...anon, methods: ['POST'], route: 'boards/leave', handler: boardLeaveRoute });
app.http('boards-read', { ...anon, methods: ['GET'], route: 'boards/board/{id}', handler: boardReadRoute });
