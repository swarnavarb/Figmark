import { createHash, randomBytes, randomInt } from 'node:crypto';
import type { HttpRequest } from '@azure/functions';
import type { ShareEvent, ShareKind, ShareOpen, User } from '../../shared/models.js';
import { tidyGrowth } from '../../shared/store-growth.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Sharing outside the app, counted.
 *
 * Three things are remembered here, each on the account it belongs to:
 *
 *   - **Opens.** Somebody other than the sharer opening a shared link. One row
 *     per visitor per link, so a friend tapping the same link ten times, or a
 *     WhatsApp preview bot fetching it, is not ten opens. This is what the
 *     quests count: a share that reaches nobody is not marketing.
 *   - **Sends.** The sharer pressing WhatsApp, Share or Save. Self-reported,
 *     so it only ever pays the small daily quest; everything bigger is paid
 *     on opens, sign-ups and sales, which the server sees for itself.
 *   - **Invites.** A personal `/i/<code>` link, and who signed up through it.
 */

const OPENS_KEPT = 500;
const LOG_KEPT = 300;
const INVITEES_KEPT = 500;

/* ── Visitors ───────────────────────────────────────────────────────────── */

/**
 * Link-preview fetchers and crawlers. They open every link they are shown,
 * so counting them would pay for posting a link nobody tapped.
 */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|discord|slack|linkedin|embedly|preview|headless|curl|wget|python-requests|okhttp/i;

export function isBot(request: HttpRequest): boolean {
  const agent = request.headers.get('user-agent') ?? '';
  return agent === '' || BOT.test(agent);
}

export const VISITOR_COOKIE = 'fm_vid';
export const INVITE_COOKIE = 'fm_inv';
const COOKIE_DAYS = 30;

export function readCookie(request: HttpRequest, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const raw = header.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return raw ? decodeURIComponent(raw.slice(name.length + 1)) : null;
}

function cookie(name: string, value: string, days: number): string {
  return [
    `${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'Secure', 'SameSite=Lax',
    `Max-Age=${days * 24 * 60 * 60}`,
  ].join('; ');
}

/**
 * Who is opening a link, as a short one-way hash: the account when signed in,
 * otherwise a random id kept in a cookie. Returns the cookie to set when the
 * browser did not have one yet.
 */
export function visitorOf(request: HttpRequest, viewerId: string | null): { visitor: string; cookies: string[] } {
  if (viewerId) return { visitor: digest(`u:${viewerId}`), cookies: [] };
  const known = readCookie(request, VISITOR_COOKIE);
  if (known && /^[A-Za-z0-9_-]{8,40}$/.test(known)) return { visitor: digest(`v:${known}`), cookies: [] };
  const fresh = randomBytes(12).toString('base64url');
  return { visitor: digest(`v:${fresh}`), cookies: [cookie(VISITOR_COOKIE, fresh, 365)] };
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 12);
}

/* ── Opens ──────────────────────────────────────────────────────────────── */

export interface OpenTarget {
  kind: ShareOpen['kind'];
  /** The item id, shop owner id, handle or invite code. */
  target: string;
  /** The shop the link leads into, when it leads into one, so the shop's quests count it too. */
  storeOwnerId?: string | null;
}

/**
 * Remembers that somebody opened what `sharerId` shared.
 *
 * Not a sharer opening their own link, not a preview bot, and not the same
 * visitor twice for the same link. The shop the link leads into hears of it
 * as well - for its growth quests - unless the visitor is the shop itself.
 * When the sharer and the shop are the same account (a shop sharing its own
 * item), the one open lands in both lists, each for its own quests.
 * Never throws: a lost count is better than a link that fails to open.
 */
export async function recordOpen(
  repository: Repo, request: HttpRequest, sharerId: string, open: OpenTarget, viewerId: string | null,
): Promise<string[]> {
  // A sharer checking their own link reached nobody - not them, not the shop.
  if (isBot(request) || viewerId === sharerId) return [];
  const { visitor, cookies } = visitorOf(request, viewerId);
  try {
    const at = new Date().toISOString();
    const sharer = await repository.getUserById(sharerId);
    if (sharer && !sharer.suspended) {
      const opens = sharer.shareOpens ?? [];
      const seen = opens.some((row) => row.visitor === visitor && row.kind === open.kind && row.target === open.target);
      if (!seen) {
        sharer.shareOpens = [...opens, { at, kind: open.kind, target: open.target, visitor }].slice(-OPENS_KEPT);
        await repository.updateUser(sharer);
      }
    }
    const storeId = open.storeOwnerId;
    if (storeId && storeId !== viewerId) {
      const owner = await repository.getUserById(storeId);
      const shop = owner?.sellerProfile;
      if (owner && shop) {
        const growth = shop.growth ?? { claimed: {}, spotlights: 0 };
        const opens = growth.opens ?? [];
        if (!opens.some((row) => row.visitor === visitor && row.target === open.target)) {
          shop.growth = tidyGrowth({ ...growth, opens: [...opens, { at, visitor, target: open.target }] });
          await repository.updateUser(owner);
        }
      }
    }
  } catch {
    // Counting is a bonus on top of opening the link; it never blocks it.
  }
  return cookies;
}

/* ── Sends ──────────────────────────────────────────────────────────────── */

const KINDS: readonly ShareKind[] = [
  'item', 'fill', 'booked', 'purchased', 'delivered', 'sold', 'filled',
  'level', 'card', 'set', 'shop', 'invite', 'invite_seller', 'profile',
];
const VIAS: readonly ShareEvent['via'][] = ['whatsapp', 'native', 'download', 'copy'];

export function isShareKind(value: unknown): value is ShareKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

export function isShareVia(value: unknown): value is ShareEvent['via'] {
  return typeof value === 'string' && (VIAS as readonly string[]).includes(value);
}

/** Adds a send to the account. Saves the user. */
export async function logSend(repository: Repo, user: User, event: ShareEvent): Promise<void> {
  user.shareLog = [...(user.shareLog ?? []), event].slice(-LOG_KEPT);
  await repository.updateUser(user);
}

/* ── Invites ────────────────────────────────────────────────────────────── */

const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode(): string {
  return Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

/** This person's invite code, made the first time they ask. Saves the user when it is new. */
export async function inviteCodeFor(repository: Repo, user: User): Promise<string> {
  if (user.inviteCode) return user.inviteCode;
  let code = newCode();
  for (let tries = 0; tries < 5 && (await repository.getSiteContent(`inv:${code}`)); tries += 1) code = newCode();
  const now = new Date().toISOString();
  await repository.saveSiteContent({ id: `inv:${code}`, data: { userId: user.id }, updatedBy: user.id, createdAt: now, updatedAt: now });
  user.inviteCode = code;
  await repository.updateUser(user);
  return code;
}

/** Whose invite a code is, or null for one never issued. */
export async function resolveInvite(repository: Repo, code: string): Promise<User | null> {
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return null;
  const row = await repository.getSiteContent(`inv:${code}`);
  const userId = (row?.data as { userId?: string } | undefined)?.userId;
  if (!userId) return null;
  const user = await repository.getUserById(userId);
  return user && !user.suspended ? user : null;
}

/** The cookie that carries an invite to sign-up. `seller` marks an invite to open a shop. */
export function inviteCookie(code: string, seller: boolean): string {
  return cookie(INVITE_COOKIE, seller ? `${code}~s` : code, COOKIE_DAYS);
}

/**
 * Files a brand-new account under whoever invited it, from the invite cookie.
 *
 * Only once, only for a new account (an existing member signing in on a
 * friend's link was not brought here by them), and never your own invite.
 */
export async function claimInvite(repository: Repo, request: HttpRequest, userId: string): Promise<void> {
  const held = readCookie(request, INVITE_COOKIE);
  if (!held) return;
  const [code = '', flag] = held.split('~');
  const user = await repository.getUserById(userId);
  if (!user || user.invitedBy) return;
  if (Date.now() - Date.parse(user.createdAt) > 60 * 60 * 1000) return;
  const inviter = await resolveInvite(repository, code);
  if (!inviter || inviter.id === user.id) return;
  const at = new Date().toISOString();
  user.invitedBy = { userId: inviter.id, at, asSeller: flag === 's' };
  await repository.updateUser(user);
  if (!(inviter.invitees ?? []).some((entry) => entry.userId === user.id)) {
    inviter.invitees = [...(inviter.invitees ?? []), { userId: user.id, at }].slice(-INVITEES_KEPT);
    await repository.updateUser(inviter);
  }
}

/** Of the people this person invited, how many have a shop now. */
export async function invitedSellerCount(repository: Repo, user: User): Promise<number> {
  const ids = (user.invitees ?? []).map((entry) => entry.userId).slice(-100);
  if (ids.length === 0) return 0;
  const people = await repository.listUsersByIds(ids);
  return people.filter((person) => person.sellerProfile).length;
}
