import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { checkUsername, threadIdFor, USERNAME_PROBLEMS } from '../../../shared/handles.js';
import type { Message, MessageParty, User } from '../../../shared/models.js';
import { accessFor } from '../../../shared/stores.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * The handle namespace, and the messages addressed through it.
 *
 * The unit is a handle, not an account, because a storefront is a voice of its
 * own: an owner writing as their shop is saying something different from the
 * same person writing as themselves, and whoever reads it needs to be able to
 * tell. So a thread is between two handles, and the account behind each is
 * recorded alongside rather than instead.
 *
 * People and shops draw from one namespace, so resolving a handle and claiming
 * a personal one live here too - the shop's own is claimed alongside the rest
 * of the storefront, which is where its owner goes to change it.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Every handle this account may speak as: their own, plus stores they run. */
async function handlesFor(userId: string, repository: Repo): Promise<MessageParty[]> {
  const me = await repository.getUserById(userId);
  if (!me) return [];

  const parties: MessageParty[] = [];
  if (me.username) {
    parties.push({ handle: me.username, userId: me.id, isStore: false, displayName: me.displayName });
  }

  // Speaking as a store needs the `posts` right, which is the same permission
  // that lets someone put words in the shop's mouth publicly.
  const own = me.sellerProfile?.username;
  if (own) {
    parties.push({
      handle: own, userId: me.id, isStore: true,
      displayName: me.sellerProfile!.storefrontName,
    });
  }
  for (const owner of await repository.listStoreOwners()) {
    if (owner.id === userId) continue;
    const access = accessFor(owner, userId);
    if (!access?.permissions.includes('posts')) continue;
    const handle = owner.sellerProfile?.username;
    if (handle) {
      parties.push({
        handle, userId: owner.id, isStore: true,
        displayName: owner.sellerProfile!.storefrontName,
      });
    }
  }
  return parties;
}

/**
 * Which of your voices a conversation with someone is already on.
 *
 * Only used when the caller did not name one: a link to `/messages/arjun`
 * should land in the conversation that exists rather than opening a second,
 * empty one under a different handle. Falls back to your own name, which is
 * who a first message is from unless you say otherwise.
 */
async function defaultVoice(
  mine: MessageParty[],
  them: string,
  repository: Repo,
): Promise<MessageParty> {
  const byHandle = new Map(mine.map((party) => [party.handle, party]));
  const messages = await repository.listMessagesForHandles([...byHandle.keys()]);

  let latest: { at: string; us: MessageParty } | null = null;
  for (const message of messages) {
    const usIsSender = byHandle.has(message.from.handle);
    const other = usIsSender ? message.to.handle : message.from.handle;
    if (other !== them) continue;
    const us = usIsSender ? byHandle.get(message.from.handle)! : byHandle.get(message.to.handle)!;
    if (!latest || message.createdAt > latest.at) latest = { at: message.createdAt, us };
  }

  return latest?.us ?? mine.find((party) => !party.isStore) ?? mine[0]!;
}

/** The party a username resolves to, or null when nobody holds it. */
async function partyFor(username: string, repository: Repo): Promise<MessageParty | null> {
  const found = await repository.getByHandle(username);
  if (!found) return null;
  const { user, isStore } = found;
  return {
    handle: username.trim().toLowerCase(),
    userId: user.id,
    isStore,
    displayName: isStore ? (user.sellerProfile?.storefrontName ?? user.displayName) : user.displayName,
  };
}

/**
 * GET /api/messages - the inbox.
 *
 * One row per thread, newest first, across every handle this account speaks as -
 * so an owner sees their own conversations and their shop's in one list, each
 * labelled with which of their voices it belongs to.
 */
async function inbox(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const mine = await handlesFor(user.id, repository);
  const byHandle = new Map(mine.map((party) => [party.handle, party]));
  const messages = await repository.listMessagesForHandles([...byHandle.keys()]);

  // Newest message per thread wins the row; the rest are history.
  const threads = new Map<string, { message: Message; unread: number }>();
  for (const message of messages) {
    const existing = threads.get(message.threadId);
    const unread = !message.readAt && byHandle.has(message.to.handle) ? 1 : 0;
    if (!existing) {
      threads.set(message.threadId, { message, unread });
    } else {
      existing.unread += unread;
      if (message.createdAt > existing.message.createdAt) existing.message = message;
    }
  }

  const rows = [...threads.values()].map(({ message, unread }) => {
    // "Us" is whichever end of this thread is one of ours.
    const usIsSender = byHandle.has(message.from.handle);
    return {
      threadId: message.threadId,
      us: usIsSender ? message.from : message.to,
      them: usIsSender ? message.to : message.from,
      lastMessage: message.body,
      lastAt: message.createdAt,
      lastFromUs: usIsSender,
      unread,
    };
  });

  rows.sort((a, b) => b.lastAt.localeCompare(a.lastAt));
  return json(200, { handles: mine, threads: rows });
}

/**
 * GET /api/messages/{handle}?as=<handle> - one conversation.
 *
 * `as` names which of the caller's voices this thread belongs to, because the
 * same two people have a different conversation when a shop is one end of it.
 */
async function thread(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const other = request.params.handle;
  if (!other) return error(400, 'invalid_handle', 'Name who the conversation is with.');

  const mine = await handlesFor(user.id, repository);
  if (mine.length === 0) return error(409, 'no_handle', 'Pick a username before messaging.');

  const them = await partyFor(other, repository);
  if (!them) return error(404, 'not_found', `Nobody holds @${other}.`);

  const asHandle = request.query.get('as')?.toLowerCase();
  const us = asHandle
    ? mine.find((party) => party.handle === asHandle)
    : await defaultVoice(mine, them.handle, repository);
  if (!us) return error(403, 'forbidden', 'That is not one of your handles.');
  if (them.handle === us.handle) return error(400, 'invalid_handle', 'You cannot message yourself.');

  const threadId = threadIdFor(us.handle, them.handle);
  const messages = await repository.listMessages(threadId);
  await repository.markThreadRead(threadId, us.handle);

  // Every voice the caller has, so the thread can offer a switch rather than
  // making them go back to the inbox to change who is speaking.
  return json(200, { us, them, handles: mine, threadId, messages });
}

/** POST /api/messages/{handle}/send - say something, as one of your handles. */
async function send(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  const other = request.params.handle;
  if (!other) return error(400, 'invalid_handle', 'Name who this is for.');

  let body: { body?: string; as?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const text = body.body?.trim();
  if (!text) return error(400, 'invalid_message', 'Write something first.');
  if (text.length > 4000) return error(400, 'invalid_message', 'Keep a message under 4000 characters.');

  const mine = await handlesFor(user.id, repository);
  if (mine.length === 0) return error(409, 'no_handle', 'Pick a username before messaging.');

  const them = await partyFor(other, repository);
  if (!them) return error(404, 'not_found', `Nobody holds @${other}.`);

  const us = body.as
    ? mine.find((party) => party.handle === body.as!.toLowerCase())
    : await defaultVoice(mine, them.handle, repository);
  if (!us) return error(403, 'forbidden', 'That is not one of your handles.');
  if (them.handle === us.handle) return error(400, 'invalid_handle', 'You cannot message yourself.');

  const now = new Date().toISOString();
  const message: Message = {
    id: `msg_${randomUUID().slice(0, 12)}`,
    threadId: threadIdFor(us.handle, them.handle),
    from: us,
    to: them,
    body: text,
    readAt: null,
    createdAt: now,
    updatedAt: now,
  };

  return json(201, { message: await repository.sendMessage(message) });
}

/**
 * GET /api/u/{handle} - the public page behind a username.
 *
 * One route for people and shops alike, because `/<username>` is one namespace:
 * what comes back says which it was, and the page renders accordingly.
 */
async function publicProfile(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const handle = request.params.handle;
  if (!handle) return error(400, 'invalid_handle', 'A username is required.');

  const found = await repository.getByHandle(handle);
  if (!found) return error(404, 'not_found', `Nobody holds @${handle}.`);

  const { user, isStore }: { user: User; isStore: boolean } = found;
  const listings = isStore ? await repository.listListings({ sellerId: user.id, limit: 24 }) : [];

  return json(200, {
    handle: handle.toLowerCase(),
    isStore,
    displayName: isStore ? (user.sellerProfile?.storefrontName ?? user.displayName) : user.displayName,
    bio: isStore ? (user.sellerProfile?.bio ?? '') : '',
    photoUrl: isStore ? (user.sellerProfile?.photoUrl ?? null) : null,
    link: isStore ? (user.sellerProfile?.link ?? null) : null,
    dispatchRegion: isStore ? (user.sellerProfile?.dispatchRegion ?? '') : '',
    followerCount: isStore ? (user.sellerProfile?.followerCount ?? 0) : 0,
    tier: isStore ? (user.sellerProfile?.tier ?? null) : null,
    // The owner's own handle, so a shop page can point at the person behind it.
    ownerHandle: isStore ? (user.username ?? null) : null,
    sellerId: user.id,
    listings: listings.map((listing) => ({
      id: listing.id,
      title: listing.title,
      priceMinor: listing.priceMinor,
      currency: listing.currency,
      condition: listing.condition,
      lotId: listing.lotId,
      sourcing: listing.sourcing,
      quantityAvailable: listing.quantityAvailable,
      likeCount: listing.likeCount,
    })),
  });
}

/**
 * POST /api/me/username - claim or change your own handle.
 *
 * Separate from the storefront's, because they are two addresses: the shop is
 * followed and bought from, the person behind it is not the same party. An
 * account that predates handles has none at all, which is the case this exists
 * to close.
 */
async function setUsername(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();

  let body: { username?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const record = await repository.getUserById(user.id);
  if (!record) return error(404, 'not_found', 'This account no longer exists.');

  const wanted = (body.username ?? '').trim().toLowerCase();
  const problem = checkUsername(wanted);
  if (problem) return error(400, 'invalid_username', USERNAME_PROBLEMS[problem]);

  if (wanted !== record.username) {
    // The new one is held before the old is let go: a rename that frees first
    // can lose both if the name it wanted turns out to be taken.
    if (!(await repository.reserveHandle(wanted, record.id, false))) {
      return error(409, 'username_taken', `@${wanted} is already taken.`);
    }
    if (record.username) await repository.releaseHandle(record.username);
    record.username = wanted;
    record.updatedAt = new Date().toISOString();
    await repository.updateUser(record);
  }

  return json(200, { username: record.username });
}

export const inboxRoute = handler(inbox);
export const setUsernameRoute = handler(setUsername);
export const threadRoute = handler(thread);
export const sendMessageRoute = handler(send);
export const publicProfileRoute = handler(publicProfile);

const anon = { authLevel: 'anonymous' } as const;

app.http('messages-inbox', { ...anon, methods: ['GET'], route: 'messages', handler: inboxRoute });
app.http('messages-thread', { ...anon, methods: ['GET'], route: 'messages/{handle}', handler: threadRoute });
// A distinct template, not just a distinct method: the Functions host treats
// equivalent templates as a conflict regardless of verb.
app.http('messages-send', { ...anon, methods: ['POST'], route: 'messages/{handle}/send', handler: sendMessageRoute });
app.http('public-profile', { ...anon, methods: ['GET'], route: 'u/{handle}', handler: publicProfileRoute });
app.http('me-username', { ...anon, methods: ['POST'], route: 'me/username', handler: setUsernameRoute });
