import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  BOARD_LIMIT, BOARD_TOP, HALL_SEASONS, boardInfo, boardScore, categoryBoards, listingOnBoard, postOnBoard,
  rankRows, seasonEndsAt, seasonsBack, tagBoardId, type BoardActivity, type BoardInfo, type BoardRow, type BoardView,
} from '../../../shared/boards.js';
import type { Listing, User } from '../../../shared/models.js';
import { isCancelledLike, isPlaced } from '../../../shared/orders.js';
import { monthKey } from '../../../shared/quest.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * Hobby leaderboards: which boards there are, joining and leaving them, and
 * one board's season. The rules are in `shared/boards.ts`; this file gathers
 * each member's activity in the hobby and records the podiums of seasons that
 * have ended, once each, so the Season Podium honour can count them.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Members read for one board. A board bigger than this ranks the first this many it finds. */
const MEMBER_LIMIT = 300;
/** How long one reading of a board is served before it is worked out again. */
const BOARD_TTL_MS = 60_000;
const cache = new Map<string, { at: number; read: Promise<{ rows: BoardRow[][]; seasons: string[] }> }>();

/** Everything a member did in the hobby, as timestamps - read once, scored for every season shown. */
async function activityOf(repository: Repo, member: User, boardId: string, listings: Map<string, Promise<Listing | null>>): Promise<BoardActivity> {
  const listing = (id: string) => {
    let pending = listings.get(id);
    if (!pending) {
      pending = repository.getListing(id).catch(() => null);
      listings.set(id, pending);
    }
    return pending;
  };
  // A query hands accounts back without their parts; the collection is one of them.
  const [whole, orders, posts] = await Promise.all([
    repository.getUserById(member.id),
    repository.listOrdersForBuyer(member.id),
    repository.listPostsByAuthor(member.id),
  ]);

  const placed = orders.filter((order) => isPlaced(order) && !isCancelledLike(order.status));
  const onBoard = new Map<string, boolean>();
  for (const order of placed) {
    if (onBoard.has(order.listingId)) continue;
    const item = await listing(order.listingId);
    onBoard.set(order.listingId, item ? listingOnBoard(boardId, item) : false);
  }
  const hobbyOrders = placed.filter((order) => onBoard.get(order.listingId));
  const delivered = hobbyOrders.filter((order) => order.status === 'delivered')
    .map((order) => order.completedAt ?? order.updatedAt);

  const collected: string[] = [];
  for (const item of whole?.collection ?? []) {
    if (!onBoard.has(item.listingId)) {
      const found = await listing(item.listingId);
      onBoard.set(item.listingId, found ? listingOnBoard(boardId, found) : false);
    }
    if (onBoard.get(item.listingId)) collected.push(item.addedAt);
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

/** Every member's rows for the current season and the finished ones the Hall of Fame keeps. */
async function computeBoard(repository: Repo, boardId: string, now: number) {
  const seasons = seasonsBack(now, HALL_SEASONS + 1);
  const members = await repository.listBoardMembers(boardId, MEMBER_LIMIT);
  const listings = new Map<string, Promise<Listing | null>>();
  const activities = await Promise.all(members.map((member) => activityOf(repository, member, boardId, listings)));
  const rows = seasons.map((season) => rankRows(members.map((member, index) => ({
    userId: member.id,
    name: member.displayName,
    handle: member.username ?? null,
    photoUrl: member.photoUrl ?? null,
    ...boardScore(activities[index]!, season),
  }))));
  await recordPodiums(repository, boardId, seasons.slice(1), rows.slice(1));
  return { rows, seasons };
}

/** Writes each finished season's top three onto their accounts, once. */
async function recordPodiums(repository: Repo, boardId: string, seasons: string[], rows: BoardRow[][]) {
  for (const [index, season] of seasons.entries()) {
    for (const row of (rows[index] ?? []).slice(0, 3)) {
      const place = row.rank as 1 | 2 | 3;
      const user = await repository.getUserById(row.userId);
      if (!user || (user.podiums ?? []).some((entry) => entry.board === boardId && entry.season === season)) continue;
      user.podiums = [...(user.podiums ?? []), { board: boardId, season, place }];
      user.updatedAt = new Date().toISOString();
      await repository.updateUser(user);
    }
  }
}

function readBoard(repository: Repo, boardId: string) {
  const now = Date.now();
  const hit = cache.get(boardId);
  if (hit && now - hit.at < BOARD_TTL_MS) return hit.read;
  const read = computeBoard(repository, boardId, now);
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
 * GET /api/boards - every category board, every hobby board somebody has
 * joined, how many are on each, and - signed in - yours and the hobbies on
 * your page you could start or join a board for.
 */
async function listBoards(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const viewer = await (await getAuthService()).getCurrentUser(request);
  const counts = new Map((await repository.boardCounts()).map((entry) => [entry.board, entry.members]));
  const tagBoards = [...counts.keys()]
    .filter((id) => id.startsWith('tag:'))
    .map(boardInfo)
    .filter((info): info is BoardInfo => info !== null)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.label.localeCompare(b.label));
  const boards = [...categoryBoards(), ...tagBoards].map((info) => ({ ...info, members: counts.get(info.id) ?? 0 }));

  let mine: string[] = [];
  let suggestions: (BoardInfo & { members: number })[] = [];
  if (viewer) {
    const account = await repository.getUserById(viewer.id);
    mine = account?.boards ?? [];
    suggestions = [...new Set((account?.tags ?? []).map(tagBoardId).filter((id): id is string => id !== null))]
      .filter((id) => !mine.includes(id))
      .map(boardInfo)
      .filter((info): info is BoardInfo => info !== null)
      .map((info) => ({ ...info, members: counts.get(info.id) ?? 0 }));
  }
  return json(200, { boards, mine, suggestions, limit: BOARD_LIMIT });
}

async function boardBody(request: HttpRequest): Promise<string | null> {
  try {
    const body = (await request.json()) as { board?: unknown; tag?: unknown };
    if (typeof body.board === 'string') return body.board;
    if (typeof body.tag === 'string') return tagBoardId(body.tag);
    return null;
  } catch {
    return null;
  }
}

/** POST /api/boards/join - { board } or { tag }: join a board, up to the limit. Joining twice is not an error. */
async function joinBoard(request: HttpRequest, _context: InvocationContext) {
  const principal = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const user = await repository.getUserById(principal.id);
  if (!user) return error(404, 'not_found', 'This account no longer exists.');
  const id = await boardBody(request);
  const info = id ? boardInfo(id) : null;
  if (!info) return error(400, 'invalid_board', 'Pick a category or type a hobby of at least two letters.');
  const boards = user.boards ?? [];
  if (boards.includes(info.id)) return json(200, { boards, joined: info });
  if (boards.length >= BOARD_LIMIT) {
    return error(409, 'board_limit', `You can be on ${BOARD_LIMIT} boards at a time. Leave one to join another.`);
  }
  user.boards = [...boards, info.id];
  user.updatedAt = new Date().toISOString();
  await repository.updateUser(user);
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
  if ((user.boards ?? []).includes(id)) {
    user.boards = (user.boards ?? []).filter((board) => board !== id);
    user.updatedAt = new Date().toISOString();
    await repository.updateUser(user);
    forget(id);
  }
  return json(200, { boards: user.boards ?? [] });
}

/**
 * GET /api/boards/{id} - this season's standings on one board (`?season=`
 * reads one of the Hall of Fame's seasons instead), your own row, and the
 * podiums of the seasons before.
 */
async function readOneBoard(request: HttpRequest, _context: InvocationContext) {
  const id = decodeURIComponent(request.params.id ?? '');
  const info = boardInfo(id);
  if (!info) return error(404, 'not_found', 'No such board.');
  const repository = await getRepository();
  const viewer = await (await getAuthService()).getCurrentUser(request);
  const [{ rows, seasons }, counts] = await Promise.all([readBoard(repository, info.id), repository.boardCounts()]);
  const asked = request.query.get('season');
  const at = asked ? Math.max(0, seasons.indexOf(asked)) : 0;
  const season = seasons[at] ?? monthKey(Date.now());
  const standings = rows[at] ?? [];
  const mine = viewer ? standings.find((row) => row.userId === viewer.id) ?? null : null;
  let joined = false;
  if (viewer) joined = ((await repository.getUserById(viewer.id))?.boards ?? []).includes(info.id);
  const view: BoardView = {
    board: { ...info, members: counts.find((entry) => entry.board === info.id)?.members ?? 0 },
    season,
    endsAt: seasonEndsAt(season),
    rows: standings.slice(0, BOARD_TOP),
    me: mine && mine.rank > BOARD_TOP ? mine : null,
    joined,
    hall: seasons.slice(1).map((past, index) => ({ season: past, podium: (rows[index + 1] ?? []).slice(0, 3) })),
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
