import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions';
import { MAX_DRAFT_BYTES, MAX_LISTING_DRAFTS, type ListingDraft } from '../../../shared/templates.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { deleteListingRoute, editListingRoute } from './catalog-routes.js';
import { acceptOrderRoute, settleClaimRoute } from './order-routes.js';
import { listingShop } from './template-routes.js';
import { error, handler, json } from './http.js';

/**
 * The seller's desk: work a shop does to many things at once, and work it
 * leaves half done.
 *
 * Accepting thirty orders after a weekend drop, or repricing a shelf, used to
 * be thirty requests fired from the browser one after another - thirty round
 * trips on a phone, and a closed tab halfway left half of them done with
 * nothing to say which. Here the list arrives once and each one is answered
 * for by name.
 *
 * Nothing is decided here. Every item goes through the same handler a single
 * press uses, as the same person, so a rule added to one is a rule for both
 * and a batch can never do what a single press would refuse.
 */

/** How many one request may carry. */
const MAX_BATCH = 100;

interface BatchResult { id: string; ok: boolean; message?: string }

/** The caller's request, as if it had been made about one item with this body. */
function single(request: HttpRequest, id: string, body: unknown): HttpRequest {
  return {
    method: 'POST',
    url: request.url,
    headers: request.headers,
    query: request.query,
    params: { id },
    json: async () => body,
  } as unknown as HttpRequest;
}

type Route = (request: HttpRequest, context: InvocationContext) => Promise<HttpResponseInit>;

/** One item through its own route; a refusal is that item's, not the batch's. */
async function runOne(route: Route, request: HttpRequest, context: InvocationContext, id: string, body: unknown): Promise<BatchResult> {
  try {
    const response = await route(single(request, id, body), context);
    const status = response.status ?? 200;
    if (status >= 200 && status < 300) return { id, ok: true };
    const message = (response.jsonBody as { message?: string } | undefined)?.message;
    return { id, ok: false, message: message ?? 'That was refused.' };
  } catch {
    return { id, ok: false, message: 'That did not save.' };
  }
}

function summary(results: BatchResult[]): HttpResponseInit {
  return json(200, { results, done: results.filter((entry) => entry.ok).length, failed: results.filter((entry) => !entry.ok).length });
}

function cleanIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length < 80))].slice(0, MAX_BATCH);
}

/**
 * POST /api/me/orders/answer - say yes to several orders, or that several
 * claimed payments arrived.
 *
 * `accept` is the seller's yes to a fresh order; `received` confirms a payment
 * the buyer says they sent. Denying a payment is not here: it needs a reason,
 * and a reason is written about one order.
 */
async function answerOrders(request: HttpRequest, context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireAuth(request);
  const body = await request.json().catch(() => null) as { ids?: unknown; action?: unknown } | null;
  const ids = cleanIds(body?.ids);
  if (ids.length === 0) return error(400, 'invalid_request', 'Name the orders to answer.');
  if (body?.action !== 'accept' && body?.action !== 'received') {
    return error(400, 'invalid_request', 'Say whether to accept the orders or confirm their payments.');
  }
  const results: BatchResult[] = [];
  // One at a time: two of a shop's orders can draw on the same stock.
  for (const id of ids) {
    results.push(body.action === 'accept'
      ? await runOne(acceptOrderRoute as Route, request, context, id, {})
      : await runOne(settleClaimRoute as Route, request, context, id, { accept: true }));
  }
  return summary(results);
}

/**
 * POST /api/me/listings/batch - the same change to several listings.
 *
 * Each entry is one listing and what to do to it: `edit` carries the fields
 * the single edit takes (a new price, stock, an expiry to bring it back),
 * `expire` takes it off sale, `remove` takes it out of the shop.
 */
async function batchListings(request: HttpRequest, context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireCapability(request, ['sell']);
  const body = await request.json().catch(() => null) as { items?: unknown } | null;
  const items = (Array.isArray(body?.items) ? body.items : [])
    .filter((entry): entry is { id: string; edit?: Record<string, unknown>; expire?: boolean; remove?: boolean } =>
      Boolean(entry) && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string')
    .slice(0, MAX_BATCH);
  if (items.length === 0) return error(400, 'invalid_request', 'Name the listings to change.');

  const results: BatchResult[] = [];
  for (const item of items) {
    if (item.remove || item.expire) {
      results.push(await runOne(deleteListingRoute as Route, request, context, item.id, { remove: item.remove === true }));
    } else if (item.edit && typeof item.edit === 'object') {
      // Photos are an item's own; a batch never carries them.
      const { photos: _photos, ...edit } = item.edit;
      results.push(await runOne(editListingRoute as Route, request, context, item.id, edit));
    } else {
      results.push({ id: item.id, ok: false, message: 'Nothing to change.' });
    }
  }
  return summary(results);
}

/* ── Drafts ────────────────────────────────────────────────────────────── */

/** GET /api/me/drafts?store= - listings started and not yet published. */
async function listDrafts(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const shop = await listingShop(request, user.id, repository);
  if ('refusal' in shop) return shop.refusal;
  const drafts = await repository.listListingDrafts(shop.shopId);
  // The shelf draws a card from the summary; the form comes with one draft, when it is opened.
  const id = request.query.get('id');
  if (id) {
    const draft = drafts.find((entry) => entry.id === id);
    return draft ? json(200, { draft }) : error(404, 'not_found', 'No such draft.');
  }
  return json(200, { drafts: drafts.map(({ form: _form, ...card }) => card) });
}

/**
 * POST /api/me/drafts/save?store= - keep the sell form as it stands.
 *
 * Allowed before the shop is verified: keeping a half-written listing is the
 * one thing an unverified seller should be able to do while they wait.
 */
async function saveDraft(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const shop = await listingShop(request, user.id, repository);
  if ('refusal' in shop) return shop.refusal;
  const owner = await repository.getUserById(shop.shopId);
  if (!owner?.sellerProfile) return error(409, 'no_storefront', 'Open a storefront first — every item is listed from one.');

  const body = await request.json().catch(() => null) as { id?: unknown; form?: unknown } | null;
  const form = body?.form;
  if (!form || typeof form !== 'object' || Array.isArray(form)) return error(400, 'invalid_draft', 'There is nothing to keep.');
  if (JSON.stringify(form).length > MAX_DRAFT_BYTES) return error(413, 'draft_too_big', 'This draft is too long to keep.');

  const fields = form as { title?: unknown; price?: unknown; category?: unknown; photos?: unknown };
  const title = typeof fields.title === 'string' ? fields.title.trim().slice(0, 200) : '';
  const price = Math.round(Number(fields.price) * 100);
  const photos = Array.isArray(fields.photos) ? fields.photos as { url?: unknown; isPrimary?: unknown }[] : [];
  const lead = photos.find((photo) => photo?.isPrimary) ?? photos[0];

  const existing = typeof body?.id === 'string' ? await repository.getListingDraft(shop.shopId, body.id) : null;
  if (!existing && (await repository.listListingDrafts(shop.shopId)).length >= MAX_LISTING_DRAFTS) {
    return error(409, 'too_many_drafts', `A shop keeps up to ${MAX_LISTING_DRAFTS} drafts. Publish or delete one first.`);
  }
  const now = new Date().toISOString();
  const draft: ListingDraft = {
    id: existing?.id ?? `ldr_${randomUUID().slice(0, 16)}`,
    sellerId: shop.shopId,
    docType: 'listingDraft',
    title,
    priceMinor: Number.isFinite(price) && price > 0 ? price : null,
    category: typeof fields.category === 'string' ? fields.category.slice(0, 80) : null,
    photoUrl: lead && typeof lead.url === 'string' ? lead.url.slice(0, 600) : null,
    form: form as Record<string, unknown>,
    savedBy: user.id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await repository.saveListingDraft(draft);
  const { form: _form, ...card } = draft;
  return json(200, { draft: card });
}

/** POST /api/me/drafts/{id}/delete?store= - published, or given up on. */
async function deleteDraft(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A draft id is required.');
  const repository = await getRepository();
  const shop = await listingShop(request, user.id, repository);
  if ('refusal' in shop) return shop.refusal;
  // Gone already is the answer that was wanted.
  await repository.deleteListingDraft(shop.shopId, id);
  return json(200, { deleted: id });
}

export const answerOrdersRoute = handler(answerOrders);
export const batchListingsRoute = handler(batchListings);
export const listDraftsRoute = handler(listDrafts);
export const saveDraftRoute = handler(saveDraft);
export const deleteDraftRoute = handler(deleteDraft);

const anon = { authLevel: 'anonymous' } as const;

app.http('me-orders-answer', { ...anon, methods: ['POST'], route: 'me/orders/answer', handler: answerOrdersRoute });
app.http('me-listings-batch', { ...anon, methods: ['POST'], route: 'me/listings/batch', handler: batchListingsRoute });
app.http('me-drafts', { ...anon, methods: ['GET'], route: 'me/drafts', handler: listDraftsRoute });
app.http('me-drafts-save', { ...anon, methods: ['POST'], route: 'me/drafts/save', handler: saveDraftRoute });
app.http('me-drafts-delete', { ...anon, methods: ['POST'], route: 'me/drafts/{id}/delete', handler: deleteDraftRoute });
