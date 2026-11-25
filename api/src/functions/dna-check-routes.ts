import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import {
  DNA_REPORT_PREFIX, dnaReportDocId, productWords, wordLikeness,
  type DnaCheck, type DnaReport, type ProductDna,
} from '../../../shared/dna.js';
import type { Listing, RegionBox } from '../../../shared/models.js';
import { notifyOperators } from '../community.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { dnasForListing, getDna, itemsOf, rematchListing, saveDna, summaryOf } from '../dna.js';
import { overlapOfBoxes, storedPrints } from '../image-hash.js';
import { everListed } from '../photo-sales.js';
import { everyListing, forgetCatalogue } from './catalog-routes.js';
import { error, handler, json } from './http.js';
import { notify } from './notify.js';

/**
 * Keeping each listing on the right Product DNA, with everybody's help.
 *
 * The seller is asked right after listing - and whenever it is in doubt -
 * which thing in the photo they are selling when it shows several, and
 * whether the product it landed on is it. Anybody looking at a listing can
 * say "not the right product": the first to say so puts it in the
 * operators' queue and asks the shop to fix it, both by notification.
 * Operators rename a product from its page.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/** Things in a photo smaller than this share of it are crumbs, not things. */
const MIN_AREA = 0.02;
const MAX_BOXES = 8;

/** The separate things in a listing's lead photo: what the phone saw when it was listed, else the stored photo's own. */
async function boxesOf(listing: Listing): Promise<RegionBox[]> {
  const lead = listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0];
  let boxes = listing.foundBoxes ?? [];
  if (boxes.length < 2) boxes = lead?.regions?.map((region) => region.box) ?? [];
  if (boxes.length < 2 && lead?.blobName) {
    boxes = (await storedPrints(lead.blobName).catch(() => null))?.regions.map((region) => region.box) ?? [];
  }
  const kept: RegionBox[] = [];
  for (const box of boxes) {
    if (box[2] * box[3] < MIN_AREA) continue;
    if (kept.some((other) => overlapOfBoxes(other, box) >= 0.5)) continue;
    kept.push(box);
  }
  return kept.slice(0, MAX_BOXES);
}

const reportOf = async (repository: Repo, listingId: string, piece: string | null): Promise<DnaReport | null> =>
  ((await repository.getSiteContent(dnaReportDocId(listingId, piece)))?.data as DnaReport | null) ?? null;

async function saveReport(
  repository: Repo, listingId: string, piece: string | null, change: (current: DnaReport | null) => DnaReport | null,
): Promise<DnaReport | null> {
  let saved: DnaReport | null = null;
  const id = dnaReportDocId(listingId, piece);
  await repository.mutateSiteContent(id, (row) => {
    const now = new Date().toISOString();
    saved = change((row?.data as DnaReport | null) ?? null);
    if (!saved) return row ?? { id, data: null, updatedBy: null, createdAt: now, updatedAt: now };
    return { id, data: saved, updatedBy: null, createdAt: row?.createdAt ?? now, updatedAt: now };
  });
  return saved;
}

/**
 * A report settled by what somebody did about it: the shop moved the listing,
 * or staff split it off. Quiet when there is no open report.
 */
export async function settleDnaReport(
  repository: Repo, listingId: string, piece: string | null, how: 'moved' | 'staff', by: string,
): Promise<void> {
  const now = new Date().toISOString();
  await saveReport(repository, listingId, piece, (current) => (current && current.status === 'open' ? {
    ...current, status: 'fixed', resolvedAt: now, resolvedBy: by, updatedAt: now,
    sellerSaid: how === 'moved' ? 'moved' : current.sellerSaid,
  } : null)).catch(() => null);
}

/** The DNA a listing as one thing is on, linking it if need be. */
async function wholeDna(repository: Repo, listing: Listing, catalogue: Listing[]): Promise<ProductDna | null> {
  const dnas = await dnasForListing(repository, listing, catalogue);
  return dnas.find((dna) => dna.links.some((link) => link.kind === 'listing' && link.id === listing.id && !link.piece)) ?? null;
}

async function checkOf(repository: Repo, listing: Listing, catalogue: Listing[]): Promise<DnaCheck> {
  const answer: DnaCheck = { listingId: listing.id, photo: null, match: null };
  if (!everListed(listing) || listing.privateFor) return answer;
  const items = itemsOf(listing);
  // A lot or a set already says which thing is where: each is its own product.
  if (items.length !== 1 || items[0]!.piece !== null) return answer;
  if (!listing.dnaFocus) {
    const boxes = await boxesOf(listing);
    const lead = listing.photos.find((photo) => photo.isPrimary) ?? listing.photos[0];
    const url = lead?.url ?? lead?.thumbUrl ?? null;
    if (boxes.length >= 2 && url) answer.photo = { url, boxes };
  }
  const dna = await wholeDna(repository, listing, catalogue);
  if (!dna) return answer;
  const link = dna.links.find((entry) => entry.kind === 'listing' && entry.id === listing.id && !entry.piece);
  const report = await reportOf(repository, listing.id, null);
  const byId = new Map(catalogue.map((entry) => [entry.id, entry]));
  byId.set(listing.id, listing);
  if (report?.status === 'open' && report.sellerSaid !== 'right') {
    answer.match = { dna: summaryOf(dna, byId), why: 'reported', reports: report.no };
  } else if (link?.by === 'auto' && dna.links.some((entry) => entry.kind === 'listing' && entry.id !== listing.id)
    && wordLikeness(productWords(listing.title), dna.words) < 1) {
    // Joined to other shops' listings on a name that is not word for word its own: worth a yes.
    answer.match = { dna: summaryOf(dna, byId), why: 'name-differs', reports: 0 };
  }
  return answer;
}

type Owned = { ok: false; refusal: HttpResponseInit } | { ok: true; listing: Listing };

async function ownListing(request: HttpRequest, repository: Repo): Promise<Owned> {
  const user = await (await getAuthService()).requireAuth(request);
  const listing = await repository.getListing(request.params.id ?? '');
  if (!listing) return { ok: false, refusal: error(404, 'not_found', 'No such item.') };
  if (listing.sellerId !== user.id && !user.capabilities.isAdmin) {
    return { ok: false, refusal: error(403, 'not_yours', 'Only the shop that listed it can answer this.') };
  }
  return { ok: true, listing };
}

/** GET /api/dna/check/{id} - what to ask the seller about their listing's product, if anything. */
async function check(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const own = await ownListing(request, repository);
  if (!own.ok) return own.refusal;
  return json(200, await checkOf(repository, own.listing, await everyListing(repository)));
}

const isBox = (value: unknown): value is RegionBox => Array.isArray(value) && value.length === 4
  && value.every((part) => typeof part === 'number' && part >= 0 && part <= 1) && value[2] > 0 && value[3] > 0;

/**
 * POST /api/dna/check/{id}/focus {box} - which thing in the photo the seller
 * is selling, or `null`: every thing in it is the same item. The listing is
 * matched again on that part of the photo; the next question comes back.
 */
async function focus(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const own = await ownListing(request, repository);
  if (!own.ok) return own.refusal;
  let body: { box?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (body.box !== null && !isBox(body.box)) return error(400, 'invalid_box', 'Tap the thing you are selling.');
  const saved = await repository.updateListing({
    ...own.listing, dnaFocus: { box: body.box as RegionBox | null, at: new Date().toISOString() },
  });
  forgetCatalogue();
  const catalogue = await everyListing(repository);
  if (body.box) await rematchListing(repository, saved, catalogue);
  return json(200, await checkOf(repository, saved, catalogue));
}

/** POST /api/dna/check/{id}/confirm - the seller says the product it is on is right. */
async function confirm(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const own = await ownListing(request, repository);
  if (!own.ok) return own.refusal;
  const catalogue = await everyListing(repository);
  const dna = await wholeDna(repository, own.listing, catalogue);
  if (!dna) return error(404, 'not_found', 'It is not on a product yet.');
  await saveDna(repository, dna.id, (current) => (current ? {
    ...current,
    links: current.links.map((link) => (link.kind === 'listing' && link.id === own.listing.id && !link.piece
      ? { ...link, by: 'owner' as const } : link)),
  } : null));
  const now = new Date().toISOString();
  await saveReport(repository, own.listing.id, null, (current) => (current
    ? { ...current, sellerSaid: 'right', updatedAt: now } : null));
  return json(200, { ok: true });
}

/**
 * POST /api/dna/vote {listingId, right} - somebody looking at a listing says
 * whether its product is right. The first "no" opens a report: the shop and
 * the operators are told. Later answers are counted, once a person.
 */
async function vote(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  let body: { listingId?: string; right?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (typeof body.right !== 'boolean' || !body.listingId) return error(400, 'invalid_body', 'Say yes or no.');
  const listing = await repository.getListing(body.listingId);
  if (!listing || !everListed(listing)) return error(404, 'not_found', 'No such item.');
  if (listing.sellerId === user.id) return error(400, 'yours', 'It is your listing: use "Wrong product?" to move it.');
  const catalogue = await everyListing(repository);
  const dna = await wholeDna(repository, listing, catalogue);
  if (!dna) return error(404, 'not_found', 'It is not on a product yet.');
  const right = body.right;
  const now = new Date().toISOString();
  let opened = false;
  const report = await saveReport(repository, listing.id, null, (current) => {
    // A yes with nothing reported is just thanks: nothing to keep.
    if (!current && right) return null;
    const was = current?.voters[user.id];
    if (was === (right ? 'yes' : 'no') && current?.dnaId === dna.id) return null;
    const base: DnaReport = current && current.dnaId === dna.id ? current : {
      id: dnaReportDocId(listing.id, null).slice(DNA_REPORT_PREFIX.length), listingId: listing.id, piece: null,
      dnaId: dna.id, sellerId: listing.sellerId, listingTitle: listing.title, dnaName: dna.name,
      photoUrl: listing.photos.find((photo) => photo.isPrimary)?.thumbUrl ?? listing.photos[0]?.thumbUrl ?? listing.photos[0]?.url ?? null,
      status: 'open', no: 0, yes: 0, voters: {}, sellerSaid: null,
      createdAt: now, updatedAt: now, resolvedAt: null, resolvedBy: null,
    };
    const voters = { ...base.voters, [user.id]: right ? 'yes' as const : 'no' as const };
    const counted = Object.values(voters);
    const reopen = !right && base.status !== 'open';
    opened = !right && (!current || current.dnaId !== dna.id || reopen);
    return {
      ...base, voters, no: counted.filter((answer) => answer === 'no').length, yes: counted.filter((answer) => answer === 'yes').length,
      status: reopen ? 'open' : base.status, ...(reopen ? { resolvedAt: null, resolvedBy: null, sellerSaid: null } : {}),
      listingTitle: listing.title, dnaName: dna.name, updatedAt: now,
    };
  });
  if (opened && report) {
    await notify(repository, [listing.sellerId], {
      kind: 'dna_report',
      title: `Is “${listing.title.slice(0, 50)}” on the right product?`,
      body: `A buyer says it may not be “${dna.name.slice(0, 50)}”. Check it in one tap, so buyers comparing shops find yours.`,
      link: `/listing/${encodeURIComponent(listing.id)}?dna=check`,
    }).catch(() => undefined);
    await notifyOperators(repository, {
      title: 'Product DNA: a listing may be on the wrong product',
      body: `“${listing.title.slice(0, 60)}” on “${dna.name.slice(0, 60)}”. Fix it from the product page, or in the console's Product DNA queue.`,
      link: `/dna/${encodeURIComponent(dna.id)}`,
    }).catch(() => undefined);
  }
  return json(200, { ok: true, reported: !right });
}

/** GET /api/ops/dna-reports - listings people said are on the wrong product, open first. */
async function reports(request: HttpRequest, _context: InvocationContext) {
  await (await getAuthService()).requireCapability(request, ['admin']);
  const repository = await getRepository();
  const rows = (await repository.listSiteContentRange(DNA_REPORT_PREFIX, 'dnarep;'))
    .map((row) => row.data as DnaReport | null).filter((row): row is DnaReport => Boolean(row && row.listingId));
  // Where each now is: it may have moved since it was reported.
  const now = await Promise.all(rows.map(async (row) => {
    const dna = await getDna(repository, row.dnaId);
    const { voters: _voters, ...rest } = row;
    return { ...rest, dnaNow: dna ? { id: dna.id, name: dna.name } : null };
  }));
  now.sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.updatedAt.localeCompare(a.updatedAt));
  return json(200, { reports: now });
}

/** POST /api/ops/dna-reports/{id}/resolve {status} - fixed, or it was right all along. */
async function resolve(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireCapability(request, ['admin']);
  const repository = await getRepository();
  let body: { status?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  if (body.status !== 'fixed' && body.status !== 'right' && body.status !== 'open') {
    return error(400, 'invalid_status', 'Fixed, right, or open again.');
  }
  const [listingId, piece = null] = (request.params.id ?? '').split('#');
  const now = new Date().toISOString();
  const status = body.status;
  const saved = await saveReport(repository, listingId!, piece, (current) => (current ? {
    ...current, status, updatedAt: now,
    resolvedAt: status === 'open' ? null : now, resolvedBy: status === 'open' ? null : user.displayName,
  } : null));
  if (!saved) return error(404, 'not_found', 'No such report.');
  return json(200, { ok: true });
}

/** POST /api/dna/view/{id}/rename {name} - staff give a product the name buyers know it by. */
async function rename(request: HttpRequest, _context: InvocationContext) {
  await (await getAuthService()).requireCapability(request, ['admin']);
  const repository = await getRepository();
  let body: { name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 90) return error(400, 'invalid_name', 'A name of 2 to 90 characters.');
  const dna = await getDna(repository, request.params.id ?? '');
  if (!dna) return error(404, 'not_found', 'No such product.');
  // Its new words join the old: listings named either way keep finding it.
  const words = [...new Set([...dna.words, ...productWords(name)])];
  const saved = await saveDna(repository, dna.id, (current) => (current ? { ...current, name, words } : null));
  return json(200, { name: saved?.name ?? name });
}

export const dnaCheckRoute = handler(check);
export const dnaFocusRoute = handler(focus);
export const dnaConfirmRoute = handler(confirm);
export const dnaVoteRoute = handler(vote);
export const dnaReportsRoute = handler(reports);
export const dnaReportResolveRoute = handler(resolve);
export const dnaRenameRoute = handler(rename);

const anon = { authLevel: 'anonymous' } as const;

app.http('dna-check', { ...anon, methods: ['GET'], route: 'dna/check/{id}', handler: dnaCheckRoute });
app.http('dna-check-focus', { ...anon, methods: ['POST'], route: 'dna/check/{id}/focus', handler: dnaFocusRoute });
app.http('dna-check-confirm', { ...anon, methods: ['POST'], route: 'dna/check/{id}/confirm', handler: dnaConfirmRoute });
app.http('dna-vote', { ...anon, methods: ['POST'], route: 'dna/vote', handler: dnaVoteRoute });
app.http('ops-dna-reports', { ...anon, methods: ['GET'], route: 'ops/dna-reports', handler: dnaReportsRoute });
app.http('ops-dna-report-resolve', { ...anon, methods: ['POST'], route: 'ops/dna-reports/{id}/resolve', handler: dnaReportResolveRoute });
app.http('dna-rename', { ...anon, methods: ['POST'], route: 'dna/view/{id}/rename', handler: dnaRenameRoute });
