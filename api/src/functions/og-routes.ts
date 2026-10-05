import { readFile } from 'node:fs/promises';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, User } from '../../../shared/models.js';
import { rupees } from '../../../shared/payments.js';
import { storeTitleFor } from '../../../shared/storefront.js';
import { titleFor } from '../../../shared/quest.js';
import { linkDiscountMinor } from '../../../shared/affiliate.js';
import { offersAffiliate, resolveShortCode } from '../affiliate.js';
import { getRepository } from '../data/index.js';
import { getPhotoStore, ownPhotoName } from '../storage/index.js';
import { resolveInvite } from '../share.js';
import { error, handler } from './http.js';
import { cardSvg, renderCard } from '../og-card.js';
import { THEMES, type CardSpec } from '../../../shared/shareCard.js';

/**
 * Link previews for everything people share out of the app.
 *
 * WhatsApp, Instagram, Telegram and the rest never run the app's JavaScript:
 * they read the `og:` tags in the HTML the link first answers with, and that
 * is the card the chat shows - photo, title, a line under it. A single-page
 * app answers every address with the same `index.html`, so every shared item
 * used to arrive as the word "Figmark" and nothing else.
 *
 * The share addresses - `/r/<code>`, `/i/<code>` and `/s/...` - are rewritten
 * here by `staticwebapp.config.json` (and by the dev server). This reads what
 * the link is about, and answers with the app's own `index.html` with the
 * right tags written into its head. People get the app, booting at the same
 * address; preview fetchers get the card. One response for both, so nothing
 * has to guess which is which.
 *
 *   /r/<code>[?m=]            an item, through somebody's affiliate link
 *   /i/<code>[?as=seller]     an invite to Figmark, or to sell on it
 *   /s/l/<id>?m=&i=           an item, as a moment (booked, delivered, ...)
 *   /s/p/<handle>?i=          a shop or a person's page
 *
 * The picture is the item's lead photo. Something with no photo gets a card
 * drawn for it instead (`/api/og/card/...`, below) - its tile, price and shop -
 * rather than the Figmark banner, which said nothing about what was shared.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

interface Meta {
  title: string;
  description: string;
  /** Absolute. */
  image: string;
  /** Where somebody lands if the app shell cannot be served. */
  fallback: string;
  /** Wide pictures get the large card; a square shop photo reads better small. */
  large: boolean;
}

const DEFAULT_IMAGE = '/og/figmark.jpg';

/* ── Reading the link ───────────────────────────────────────────────────── */

const RELATIVE = 'http://relative.invalid';

function originOf(request: HttpRequest, original: URL | null): string {
  if (original && original.origin !== RELATIVE) return original.origin;
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? 'localhost';
  const proto = request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host.split(',')[0]!.trim()}`;
}

/** The address the visitor actually asked for, before the rewrite. */
function originalUrl(request: HttpRequest): URL | null {
  const header = request.headers.get('x-ms-original-url') ?? request.headers.get('x-original-url');
  const raw = header ?? request.query.get('u');
  if (!raw) return null;
  try {
    const parsed = new URL(raw, RELATIVE);
    // `?u=` is anybody's to type, so only its path counts. Its origin would
    // decide where the page shell is fetched from, and a shell from somebody
    // else's server served on this one is their script running as us.
    return header ? parsed : new URL(`${parsed.pathname}${parsed.search}`, RELATIVE);
  } catch {
    return null;
  }
}

function absolute(origin: string, url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? `${origin}${url}` : null;
}

function leadPhoto(listing: Listing): string | null {
  return (listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0])?.url ?? null;
}

function shopName(user: User | null): string {
  return user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'a shop';
}

function firstName(user: User | null): string {
  return (user?.displayName ?? 'A friend').split(/\s+/)[0] ?? 'A friend';
}

/** The pre-order line, when there is one: how full, how many left, how long. */
function fillLine(listing: Listing, now: number): { line: string; left: number } | null {
  const pre = listing.preOrder;
  if (!pre || pre.fillThreshold <= 0) return null;
  const joined = Math.min(pre.fillThreshold, pre.filledCount + (pre.pledgedCount ?? 0));
  const left = Math.max(0, pre.fillThreshold - joined);
  const days = Math.ceil((Date.parse(pre.cutoffAt) - now) / 86_400_000);
  const clock = days > 1 ? ` · closes in ${days} days` : days === 1 ? ' · closes tomorrow' : '';
  return { line: left > 0 ? `${joined} of ${pre.fillThreshold} joined, ${left} spot${left === 1 ? '' : 's'} left${clock}` : 'Pre-order full', left };
}

/** The shop with its standing: "Kaiju Imports (Level 7 Trusted Importer)". */
function shopLine(user: User | null): string {
  const name = shopName(user);
  const level = user?.sellerProfile ? user.sellerProfile.levelCache ?? 1 : null;
  return level ? `${name} (Level ${level} ${storeTitleFor(level)})` : name;
}

async function listingMeta(
  repository: Repo, origin: string, listing: Listing, sharer: User | null, moment: string | null, fallback: string,
  /** The affiliate link's code: the one kind of link that can take money off. */
  code: string | null = null,
): Promise<Meta> {
  const viaLink = code !== null;
  const now = Date.now();
  const seller = await repository.getUserById(listing.sellerId);
  const price = rupees(listing.priceMinor);
  const offMinor = viaLink && offersAffiliate(listing) ? linkDiscountMinor(listing.affiliate) : 0;
  const off = offMinor > 0 ? rupees(offMinor) : null;
  const fill = fillLine(listing, now);
  const who = firstName(sharer);
  const titles: Record<string, string> = {
    fill: fill && fill.left > 0 ? `${fill.left} spot${fill.left === 1 ? '' : 's'} left · ${listing.title}` : listing.title,
    booked: `${who} booked a spot: ${listing.title}`,
    purchased: `${who} just got ${listing.title}`,
    delivered: `${who}'s ${listing.title} just arrived`,
    sold: `Just sold: ${listing.title}`,
    filled: `Pre-order full: ${listing.title}`,
  };
  // "Somebody booked a spot" needs a somebody: without a sharer, the item speaks for itself.
  const personal = moment === 'booked' || moment === 'purchased' || moment === 'delivered';
  const base = (moment && (!personal || sharer) && titles[moment]) || `${listing.title} · ${price}`;
  // A discount is the reason to tap, so it leads.
  const title = off ? `Get ${off} off · ${base}` : base;
  const parts = [
    off
      ? `🎁 ${off} off with ${sharer ? `${who}'s` : 'this'} link: ${rupees(Math.max(100, listing.priceMinor - offMinor))} instead of ${price}`
      : price,
    fill?.line,
    `from ${shopLine(seller)}`,
    moment === 'booked' || moment === 'fill' || (listing.preOrder && !moment)
      ? 'Join the pre-order - it ships when it fills. Buyer Protection on Figmark.'
      : 'Buyer Protection on Figmark.',
  ].filter(Boolean);
  const photo = absolute(origin, leadPhoto(listing));
  return { title, description: parts.join(' · '), image: photo ?? listingCardUrl(origin, listing, seller, offMinor, code), large: true, fallback };
}

async function metaFor(repository: Repo, origin: string, url: URL): Promise<Meta> {
  const segments = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  const sharerOf = async () => {
    const code = url.searchParams.get('i');
    return code ? resolveInvite(repository, code) : null;
  };
  const fallbackMeta: Meta = {
    title: 'Figmark - import pre-orders, Buyer Protection and real reviews',
    description: 'Join pre-orders from import resellers, track every stage, and pay with Buyer Protection. Collect cards and level up as you shop.',
    image: `${origin}${DEFAULT_IMAGE}`,
    large: true,
    fallback: '/',
  };

  const [kind, first, second] = segments;
  if (kind === 'r' && first) {
    const target = await resolveShortCode(repository, first);
    const listing = target ? await repository.getListing(target.listingId) : null;
    if (!target || !listing || listing.privateFor) return fallbackMeta;
    const sharer = await repository.getUserById(target.referrerId);
    return listingMeta(repository, origin, listing, sharer, url.searchParams.get('m'), `/listing/${encodeURIComponent(listing.id)}`, first);
  }
  if (kind === 'i' && first) {
    const inviter = await resolveInvite(repository, first);
    if (!inviter) return fallbackMeta;
    const seller = url.searchParams.get('as') === 'seller';
    const name = inviter.sellerProfile?.storefrontName ?? inviter.displayName;
    return seller
      ? {
          title: `${name} invited you to sell on Figmark`,
          description: 'Run pre-orders with order manifests, tracking buyers can see, Buyer Protection and affiliates who sell for you. Opening a shop takes a minute.',
          image: inviteCardUrl(origin, first, true, inviter), large: true, fallback: `/?i=${encodeURIComponent(first)}`,
        }
      : {
          title: `${name} invited you to Figmark`,
          description: 'Pre-orders from import resellers, Buyer Protection on payments and reviews only real buyers can leave. Collect cards and level up as you shop.',
          image: inviteCardUrl(origin, first, false, inviter), large: true, fallback: `/?i=${encodeURIComponent(first)}`,
        };
  }
  if (kind === 's' && first === 'l' && second) {
    const listing = await repository.getListing(second);
    if (!listing || listing.privateFor) return fallbackMeta;
    const invite = url.searchParams.get('i');
    const back = `/listing/${encodeURIComponent(listing.id)}${invite ? `?i=${encodeURIComponent(invite)}` : ''}`;
    return listingMeta(repository, origin, listing, await sharerOf(), url.searchParams.get('m'), back);
  }
  if (kind === 's' && first === 'p' && second) {
    const found = await repository.getByHandle(second);
    if (!found) return fallbackMeta;
    const invite = url.searchParams.get('i');
    const back = `/${encodeURIComponent(second)}${invite ? `?i=${encodeURIComponent(invite)}` : ''}`;
    const { user, isStore } = found;
    if (isStore && user.sellerProfile) {
      const shop = user.sellerProfile;
      const level = shop.levelCache ?? 1;
      const bits = [
        `Level ${level} ${storeTitleFor(level)}`,
        shop.followerCount ? `${shop.followerCount.toLocaleString('en-IN')} followers` : null,
        user.sellerTrust.score >= 80 ? 'Trusted seller' : null,
        shop.bio?.trim().slice(0, 120) || null,
      ].filter(Boolean);
      const photo = absolute(origin, shop.photoUrl);
      return { title: `${shop.storefrontName} on Figmark`, description: bits.join(' · '), image: photo ?? personCardUrl(origin, second, user), large: !photo, fallback: back };
    }
    const level = user.quest?.levelCache ?? 1;
    return {
      title: `${user.displayName} on Figmark`,
      description: [`Level ${level} ${titleFor(level)}`, `${(user.collection ?? []).length} in their collection`, user.bio?.trim().slice(0, 120)].filter(Boolean).join(' · '),
      image: personCardUrl(origin, second, user), large: true, fallback: back,
    };
  }
  return fallbackMeta;
}

/* ── Drawn previews ─────────────────────────────────────────────────────── */

/** Short and stable: changes when anything the card shows does, so a chat app's cached copy is replaced. */
function versionOf(...parts: unknown[]): string {
  let hash = 2166136261 >>> 0;
  for (const char of parts.map(String).join('|')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function listingCardUrl(origin: string, listing: Listing, seller: User | null, offMinor: number, code: string | null): string {
  const v = versionOf(listing.updatedAt, listing.title, listing.priceMinor, listing.preOrder?.filledCount, listing.preOrder?.pledgedCount,
    seller?.sellerProfile?.levelCache, seller?.sellerProfile?.storefrontName, seller?.sellerProfile?.photoUrl?.length, offMinor);
  const via = offMinor > 0 && code ? `&r=${encodeURIComponent(code)}` : '';
  return `${origin}/api/og/card/l/${encodeURIComponent(listing.id)}.jpg?v=${v}${via}`;
}

function inviteCardUrl(origin: string, code: string, seller: boolean, inviter: User): string {
  const v = versionOf(inviter.updatedAt, inviter.displayName, inviter.quest?.levelCache, inviter.sellerProfile?.storefrontName, inviter.sellerProfile?.levelCache);
  return `${origin}/api/og/card/i/${encodeURIComponent(code)}.jpg?v=${v}${seller ? '&as=seller' : ''}`;
}

function personCardUrl(origin: string, handle: string, user: User): string {
  const shop = user.sellerProfile;
  const v = versionOf(user.updatedAt, user.displayName, user.quest?.levelCache, shop?.storefrontName, shop?.levelCache, shop?.followerCount, (user.collection ?? []).length);
  return `${origin}/api/og/card/p/${encodeURIComponent(handle)}.jpg?v=${v}`;
}

/**
 * A photo the card can embed: a data URL as it is, or one of our own uploads
 * read from the store and inlined, since the renderer cannot reach the network
 * itself.
 *
 * Only our own. Fetching whatever link a profile carries would let anybody
 * point this server at an address of their choosing - an internal one
 * included - just by sharing their page.
 */
async function inlinePhoto(_origin: string, url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (/^data:image\/(png|jpe?g|gif|webp)[;,]/i.test(url)) return url;
  const name = await ownPhotoName(url);
  if (!name) return null;
  try {
    const photo = await (await getPhotoStore()).read(name);
    if (!photo || !/^image\/(png|jpe?g|gif|webp)/i.test(photo.contentType)) return null;
    if (photo.bytes.byteLength > 2_000_000) return null;
    return `data:${photo.contentType.split(';')[0]};base64,${Buffer.from(photo.bytes).toString('base64')}`;
  } catch {
    return null;
  }
}

/** The square picture for an item with no photo: the same one the app shares. */
async function listingCard(repository: Repo, origin: string, listing: Listing, code: string | null): Promise<CardSpec> {
  const seller = await repository.getUserById(listing.sellerId);
  let offMinor = 0;
  if (code) {
    const target = await resolveShortCode(repository, code);
    if (target?.listingId === listing.id && offersAffiliate(listing)) offMinor = linkDiscountMinor(listing.affiliate);
  }
  const pre = listing.preOrder;
  const fill = fillLine(listing, Date.now());
  const level = seller?.sellerProfile ? seller.sellerProfile.levelCache ?? 1 : null;
  const preOrder = Boolean(pre) || (listing.tags ?? []).includes('pre-order');
  return {
    seed: listing.id,
    hero: { kind: 'tile', label: listing.title },
    chips: [
      ...(preOrder ? [{ label: 'PRE-ORDER', fill: '#F472B6', ink: '#2A0614' }] : []),
      ...(listing.condition ? [{ label: listing.condition.toUpperCase(), fill: 'rgba(8,11,18,0.62)', ink: '#FFFFFF' }] : []),
    ],
    meter: pre && fill && pre.fillThreshold > 0
      ? { joined: Math.min(pre.fillThreshold, pre.filledCount + (pre.pledgedCount ?? 0)), total: pre.fillThreshold, line: fill.line.split(' · ')[0]! }
      : null,
    headline: offMinor > 0 ? `Get ${rupees(offMinor)} off with my link` : null,
    title: listing.title,
    detail: preOrder ? 'Pre-order · ships when the lot lands' : null,
    price: rupees(Math.max(100, listing.priceMinor - offMinor)),
    was: offMinor > 0 ? rupees(listing.priceMinor) : null,
    off: offMinor > 0 ? rupees(offMinor) : null,
    badge: {
      name: shopName(seller),
      level,
      title: level ? storeTitleFor(level) : null,
      photo: await inlinePhoto(origin, seller?.sellerProfile?.photoUrl),
    },
    protection: true,
  };
}

/** A shop or a person with no photo: their mark, large, with their standing. */
async function personCard(origin: string, user: User, isStore: boolean): Promise<CardSpec> {
  const shop = isStore ? user.sellerProfile : null;
  if (shop) {
    const level = shop.levelCache ?? 1;
    const theme = THEMES.shop;
    return {
      seed: shop.storefrontName,
      stamp: { label: theme.stamp, from: theme.from, to: theme.to, ink: theme.ink },
      headline: 'Shop with us',
      hero: { kind: 'avatar', name: shop.storefrontName, level, photo: await inlinePhoto(origin, shop.photoUrl) },
      title: shop.storefrontName,
      detail: [
        `Level ${level} ${storeTitleFor(level)}`,
        shop.followerCount ? `${shop.followerCount.toLocaleString('en-IN')} followers` : null,
        user.sellerTrust.score >= 80 ? 'Trusted seller' : null,
      ].filter(Boolean).join(' · '),
      protection: true,
    };
  }
  const level = user.quest?.levelCache ?? 1;
  const owned = (user.collection ?? []).length;
  const theme = THEMES.profile;
  return {
    seed: user.displayName,
    stamp: { label: theme.stamp, from: theme.from, to: theme.to, ink: theme.ink },
    headline: `Meet ${user.displayName.split(/\s+/)[0]}`,
    hero: { kind: 'level', level },
    title: user.displayName,
    detail: [`Level ${level} ${titleFor(level)}`, owned ? `${owned} in their collection` : null].filter(Boolean).join(' · '),
    badge: { name: user.displayName, level, title: titleFor(level) },
  };
}

/** An invite: Figmark's mark, with the person inviting at its foot. */
async function inviteCard(origin: string, inviter: User, seller: boolean): Promise<CardSpec> {
  const theme = THEMES[seller ? 'invite_seller' : 'invite'];
  const shop = inviter.sellerProfile;
  const level = shop ? shop.levelCache ?? 1 : inviter.quest?.levelCache ?? 1;
  return {
    seed: inviter.id,
    stamp: { label: theme.stamp, from: theme.from, to: theme.to, ink: theme.ink },
    headline: seller ? 'Sell with me on Figmark' : 'Come shop with me',
    hero: { kind: 'brand' },
    title: seller ? 'Open your shop' : 'Join me on Figmark',
    detail: seller ? 'Pre-orders · tracking · Buyer Protection · affiliates' : 'Pre-orders · Buyer Protection · card packs',
    badge: {
      name: shop?.storefrontName ?? inviter.displayName,
      level,
      title: shop ? storeTitleFor(level) : titleFor(level),
      photo: await inlinePhoto(origin, shop?.photoUrl),
    },
  };
}

const cardCache = new Map<string, Buffer>();
const CARD_CACHE_SIZE = 200;

/** GET /api/og/card/{l|p|i}/{id}.jpg - the drawn preview: an item or page with no photo, or an invite. */
async function ogCard(request: HttpRequest, _context: InvocationContext) {
  const kind = request.params.kind;
  const name = (request.params.name ?? '').replace(/\.jpe?g$/i, '');
  if (!name || (kind !== 'l' && kind !== 'p' && kind !== 'i')) return { status: 404, body: 'Not found' };
  const key = `${kind}/${name}?${request.query.get('v') ?? ''}&${request.query.get('r') ?? ''}&${request.query.get('as') ?? ''}`;
  let bytes = cardCache.get(key);
  if (!bytes) {
    const repository = await getRepository();
    const origin = originOf(request, null);
    let svg: string | null = null;
    if (kind === 'l') {
      const listing = await repository.getListing(name);
      if (listing && !listing.privateFor) svg = cardSvg(await listingCard(repository, origin, listing, request.query.get('r')));
    } else if (kind === 'i') {
      const inviter = await resolveInvite(repository, name);
      if (inviter) svg = cardSvg(await inviteCard(origin, inviter, request.query.get('as') === 'seller'));
    } else {
      const found = await repository.getByHandle(name);
      if (found) svg = cardSvg(await personCard(origin, found.user, found.isStore));
    }
    if (!svg) return { status: 404, body: 'Not found' };
    try {
      bytes = await renderCard(svg);
    } catch {
      // A photo the renderer could not read: draw it again with initials instead.
      bytes = await renderCard(svg.replace(/<image [^>]*\/>/g, ''));
    }
    if (cardCache.size >= CARD_CACHE_SIZE) cardCache.delete(cardCache.keys().next().value!);
    cardCache.set(key, bytes);
  }
  return {
    status: 200,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' },
    body: bytes,
  };
}

/* ── Writing the page ───────────────────────────────────────────────────── */

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tags(meta: Meta, url: string): string {
  const pairs: [string, string][] = [
    ['og:site_name', 'Figmark'],
    ['og:type', 'website'],
    ['og:title', meta.title],
    ['og:description', meta.description],
    ['og:image', meta.image],
    ['og:image:alt', meta.title],
    ['og:url', url],
  ];
  return [
    `<title>${escape(meta.title)}</title>`,
    `<meta name="description" content="${escape(meta.description)}" />`,
    ...pairs.map(([property, content]) => `<meta property="${property}" content="${escape(content)}" />`),
    `<meta name="twitter:card" content="${meta.large ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${escape(meta.title)}" />`,
    `<meta name="twitter:description" content="${escape(meta.description)}" />`,
    `<meta name="twitter:image" content="${escape(meta.image)}" />`,
  ].join('\n    ');
}

/** The app's own index.html, with the default title and preview tags swapped for these. */
export function injectMeta(shell: string, meta: Meta, url: string): string {
  const stripped = shell
    .replace(/<title>[\s\S]*?<\/title>/i, '')
    .replace(/<meta\s+name="description"[\s\S]*?\/?>/gi, '')
    .replace(/<meta\s+(?:property|name)="(?:og|twitter):[^"]*"[\s\S]*?\/?>/gi, '');
  // A function, not a string: in a replacement string `$'` and `$&` are
  // instructions, and a shop is free to put them in its name.
  const head = `<head>\n    ${tags(meta, url)}`;
  return stripped.replace(/<head>/i, () => head);
}

/** Enough of a page for a preview, sending a person on to the app when the shell could not be read. */
function fallbackPage(meta: Meta, url: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${tags(meta, url)}
    <meta http-equiv="refresh" content="0;url=${escape(meta.fallback)}" />
  </head>
  <body style="background:#080B12;color:#F2F5FA;font-family:system-ui,sans-serif">
    <p><a href="${escape(meta.fallback)}" style="color:#A78BFA">Open on Figmark</a></p>
  </body>
</html>`;
}

let shellCache: { html: string; at: number; origin: string } | null = null;
const SHELL_TTL_MS = 5 * 60 * 1000;

/**
 * The deployed index.html, read from the site itself and kept for a few
 * minutes - a deploy changes its asset names, so it cannot be baked in here.
 */
async function loadShell(origin: string): Promise<string | null> {
  // The dev server and the tests point at the built file rather than asking
  // a server for it - in the dev server's case, the server is itself.
  const file = process.env.FIGMARK_SHELL_FILE;
  if (file) return readFile(file, 'utf8').catch(() => null);
  if (shellCache && shellCache.origin === origin && Date.now() - shellCache.at < SHELL_TTL_MS) return shellCache.html;
  try {
    const response = await fetch(`${origin}/index.html`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) return shellCache?.html ?? null;
    const html = await response.text();
    if (!/<div id="root">/.test(html)) return shellCache?.html ?? null;
    shellCache = { html, at: Date.now(), origin };
    return html;
  } catch {
    return shellCache?.html ?? null;
  }
}

/** GET /api/og - the page a shared link answers with. See the top of this file. */
async function og(request: HttpRequest, _context: InvocationContext) {
  const original = originalUrl(request);
  const origin = originOf(request, original);
  const path = original ? `${original.pathname}${original.search}` : '/';
  const url = new URL(path, origin);
  let meta: Meta;
  try {
    meta = await metaFor(await getRepository(), origin, url);
  } catch {
    meta = {
      title: 'Figmark', description: 'Import pre-orders, Buyer Protection and real reviews.',
      image: `${origin}${DEFAULT_IMAGE}`, large: true, fallback: '/',
    };
  }
  const shell = await loadShell(origin);
  const body = shell ? injectMeta(shell, meta, url.toString()) : fallbackPage(meta, url.toString());
  return {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
    body,
  };
}

/**
 * GET /api/link-preview?u=<path> - the same card, for a link posted inside
 * Figmark. A post carries the link alone and the app draws the card from
 * this, the way a chat app would, so a picture is not stored again for every
 * share. Only Figmark's own share addresses (and an item's page) are read,
 * and only by path: what it answers is what `/api/og` tells anybody already.
 */
async function linkPreview(request: HttpRequest, _context: InvocationContext) {
  let path: URL;
  try {
    const parsed = new URL(request.query.get('u') ?? '', RELATIVE);
    path = new URL(`${parsed.pathname}${parsed.search}`, RELATIVE);
  } catch {
    return error(400, 'invalid_url', 'Not a link.');
  }
  const item = /^\/listing\/([^/]+)\/?$/.exec(path.pathname);
  if (item) path = new URL(`/s/l/${item[1]}${path.search}`, RELATIVE);
  if (!/^\/(r|i|s\/l|s\/p)\/[^/]+\/?$/.test(path.pathname)) {
    return error(404, 'no_preview', 'Nothing to show for that link.');
  }
  const origin = originOf(request, null);
  const meta = await metaFor(await getRepository(), origin, path);
  if (meta.fallback === '/') {
    return error(404, 'no_preview', 'Nothing to show for that link.');
  }
  // Same-origin pictures go back as paths, so the app loads them from wherever it runs.
  const image = meta.image.startsWith(origin) ? meta.image.slice(origin.length) : meta.image;
  return {
    status: 200,
    headers: { 'Cache-Control': 'public, max-age=300' },
    jsonBody: { title: meta.title, description: meta.description, image, href: meta.fallback, wide: meta.large },
  };
}

export const ogRoute = handler(og);

export const ogCardRoute = handler(ogCard);

export const linkPreviewRoute = handler(linkPreview);

app.http('og', { authLevel: 'anonymous', methods: ['GET'], route: 'og', handler: ogRoute });
app.http('og-card', { authLevel: 'anonymous', methods: ['GET'], route: 'og/card/{kind}/{name}', handler: ogCardRoute });
app.http('link-preview', { authLevel: 'anonymous', methods: ['GET'], route: 'link-preview', handler: linkPreviewRoute });
