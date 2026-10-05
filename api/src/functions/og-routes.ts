import { readFile } from 'node:fs/promises';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { Listing, User } from '../../../shared/models.js';
import { rupees } from '../../../shared/payments.js';
import { storeTitleFor } from '../../../shared/storefront.js';
import { titleFor } from '../../../shared/quest.js';
import { linkDiscountMinor } from '../../../shared/affiliate.js';
import { offersAffiliate, resolveShortCode } from '../affiliate.js';
import { getRepository } from '../data/index.js';
import { resolveInvite } from '../share.js';
import { handler } from './http.js';

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
const INVITE_IMAGE = '/og/invite.jpg';
const SELLER_IMAGE = '/og/invite-seller.jpg';

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
  const raw = request.headers.get('x-ms-original-url') ?? request.headers.get('x-original-url') ?? request.query.get('u');
  if (!raw) return null;
  try {
    return new URL(raw, RELATIVE);
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
  /** True for an affiliate link: the one kind of link that can take money off. */
  viaLink = false,
): Promise<Meta> {
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
  return { title, description: parts.join(' · '), image: photo ?? `${origin}${DEFAULT_IMAGE}`, large: true, fallback };
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
    if (!target || !listing) return fallbackMeta;
    const sharer = await repository.getUserById(target.referrerId);
    return listingMeta(repository, origin, listing, sharer, url.searchParams.get('m'), `/listing/${encodeURIComponent(listing.id)}`, true);
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
          image: `${origin}${SELLER_IMAGE}`, large: true, fallback: `/?i=${encodeURIComponent(first)}`,
        }
      : {
          title: `${name} invited you to Figmark`,
          description: 'Pre-orders from import resellers, Buyer Protection on payments and reviews only real buyers can leave. Collect cards and level up as you shop.',
          image: `${origin}${INVITE_IMAGE}`, large: true, fallback: `/?i=${encodeURIComponent(first)}`,
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
      return { title: `${shop.storefrontName} on Figmark`, description: bits.join(' · '), image: photo ?? `${origin}${DEFAULT_IMAGE}`, large: !photo, fallback: back };
    }
    const level = user.quest?.levelCache ?? 1;
    return {
      title: `${user.displayName} on Figmark`,
      description: [`Level ${level} ${titleFor(level)}`, `${(user.collection ?? []).length} in their collection`, user.bio?.trim().slice(0, 120)].filter(Boolean).join(' · '),
      image: `${origin}${DEFAULT_IMAGE}`, large: true, fallback: back,
    };
  }
  return fallbackMeta;
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
  return stripped.replace(/<head>/i, `<head>\n    ${tags(meta, url)}`);
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

export const ogRoute = handler(og);

app.http('og', { authLevel: 'anonymous', methods: ['GET'], route: 'og', handler: ogRoute });
