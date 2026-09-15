import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { CONDITION_TAGS, type ConditionTag } from '../../../shared/enums.js';
import { inLot, isDirect } from '../../../shared/fulfilment.js';
import type { Order, StageEvent } from '../../../shared/models.js';
import { coarseStage, currentStepOf, lotRefOf, normaliseSteps, routeOf } from '../../../shared/routes.js';
import type { PostTemplate } from '../../../shared/templates.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { getPhotoStore } from '../storage/index.js';
import { buildLot, type NewLotBody } from './fulfilment-routes.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';

/**
 * Quick Post templates, photo uploads, and putting one order in a lot.
 *
 * Three things that look unrelated and are the same thing: the work a shop does
 * over and over that nothing was helping with. Forty listings a month with the
 * same category and the same two lines; a photo that had nowhere to go because
 * upload was the one part of the storage seam nobody had written; and an order
 * that had to be filed into a lot from the lot's screen rather than from
 * the order in front of you.
 */

/* ── Quick Post templates ──────────────────────────────────────────────── */

/** GET /api/templates - the stationery this shop lists from. */
async function listTemplates(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  return json(200, { templates: await repository.listTemplates(user.id) });
}

interface TemplateBody {
  id?: string;
  name?: string;
  category?: string;
  tags?: string[];
  condition?: string | null;
  sourcing?: string;
  description?: string;
  defaultLotId?: string | null;
  preLotSteps?: { id?: string; name?: string; description?: string }[];
  preLotName?: string;
  lotRouteId?: string | null;
}

/** POST /api/templates/new - write one, or correct one. */
async function saveTemplate(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: TemplateBody;
  try {
    body = (await request.json()) as TemplateBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const name = body.name?.trim();
  if (!name) return error(400, 'invalid_template', 'Give the template a name.');

  const repository = await getRepository();
  const existing = body.id ? await repository.getTemplate(user.id, body.id) : null;
  if (body.id && !existing) return error(404, 'not_found', 'No such template.');

  // The after-lot route is a pointer, not a copy: nothing is travelling it yet,
  // and the name is carried so the picker can say which one without a lookup.
  let lotRouteId: string | null = null;
  let lotRouteName: string | null = null;
  if (body.lotRouteId) {
    const route = await repository.getRoute(user.id, body.lotRouteId);
    if (!route) return error(404, 'not_found', 'No such route.');
    lotRouteId = route.id;
    lotRouteName = route.name;
  }

  const preSteps = normaliseSteps(body.preLotSteps ?? []);
  const now = new Date().toISOString();
  const condition = CONDITION_TAGS.includes(body.condition as ConditionTag)
    ? (body.condition as ConditionTag)
    : null;

  const template: PostTemplate = {
    id: existing?.id ?? `tpl_${randomUUID().slice(0, 12)}`,
    sellerId: user.id,
    name,
    category: body.category?.trim() ?? existing?.category ?? '',
    tags: (body.tags ?? existing?.tags ?? []).map((tag) => tag.trim()).filter(Boolean),
    condition,
    sourcing: body.sourcing === 'import' ? 'import' : 'in_hand',
    description: body.description?.trim() ?? existing?.description ?? '',
    defaultLotId: body.defaultLotId ?? existing?.defaultLotId ?? null,
    // Two steps or none: one step before the wall says nothing a status word
    // would not, and the built-in pair is the sensible default.
    preLotRoute: preSteps.length >= 2
      ? { routeId: null, name: body.preLotName?.trim() || 'Before the lot', steps: preSteps }
      : null,
    lotRouteId,
    lotRouteName,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  return json(existing ? 200 : 201, { template: await repository.saveTemplate(template) });
}

/** POST /api/templates/{id}/delete - drop one. Listings already made keep theirs. */
async function deleteTemplate(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A template id is required.');

  const repository = await getRepository();
  const gone = await repository.deleteTemplate(user.id, id);
  if (!gone) return error(404, 'not_found', 'No such template.');
  return json(200, { deleted: id });
}

/* ── Photos ────────────────────────────────────────────────────────────── */

/** The most a single photo may be, after the browser has shrunk it. */
const MAX_PHOTO_BYTES = 900_000;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/**
 * POST /api/uploads - a picture in, a URL out.
 *
 * A data URL rather than multipart, because the browser has already had to read
 * the file to shrink it and re-encoding it as a form is work for nothing. The
 * cap is enforced here rather than trusted from the client: a phone camera
 * produces four megabytes and a listing with six of those in it is a document
 * no store will accept.
 */
async function upload(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  await auth.requireCapability(request, ['sell']);

  let body: { dataUrl?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const match = /^data:([a-z/+-]+);base64,(.+)$/i.exec(body.dataUrl ?? '');
  if (!match) return error(400, 'invalid_photo', 'Send the photo as a base64 data URL.');

  const contentType = match[1]!.toLowerCase();
  if (!ALLOWED_TYPES.includes(contentType)) {
    return error(400, 'invalid_photo', 'Photos must be JPEG, PNG, WebP or GIF.');
  }

  const bytes = Buffer.from(match[2]!, 'base64');
  if (bytes.byteLength === 0) return error(400, 'invalid_photo', 'That photo is empty.');
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return error(413, 'photo_too_large', 'That photo is too large. Try a smaller one.');
  }

  const store = await getPhotoStore();
  const stored = await store.upload(new Uint8Array(bytes), contentType);
  return json(201, stored);
}

/**
 * GET /api/photos/{name} - serve a photo the store has no public URL for.
 *
 * Only the in-memory backend needs this; a storage account serves its own
 * container directly and the URL never points here.
 */
async function photo(request: HttpRequest, _context: InvocationContext) {
  const name = request.params.name;
  if (!name) return error(400, 'invalid_request', 'A photo name is required.');

  const store = await getPhotoStore();
  const found = await store.read(name);
  if (!found) return { status: 404, body: 'Not found' };

  return {
    status: 200,
    headers: {
      'Content-Type': found.contentType,
      // Immutable: the name is a uuid, so the bytes behind it never change.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
    body: Buffer.from(found.bytes),
  };
}

/* ── One order into a lot ────────────────────────────────────────────── */

/**
 * POST /api/orders/{id}/lot - file this one order.
 *
 * The lot screen can take several at once; this is the other direction, from
 * the order in front of you. It is the same move either way - an item joins a
 * lot and inherits its route - and it is here because the seller's answer to
 * "where does this go" happens while they are looking at the order, not while
 * they are looking at the lot.
 *
 * The lot may not exist yet. Creating it goes through the same builder the
 * lots screen uses, so a lot opened from here is a lot like any other.
 */
async function assignOrderToLot(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const orderId = request.params.id;
  if (!orderId) return error(400, 'invalid_request', 'An order id is required.');

  let body: { lotId?: string; newLot?: NewLotBody };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }

  const repository = await getRepository();
  const order = await repository.getOrder(orderId);
  if (!order) return error(404, 'not_found', 'No such order.');
  if (order.sellerId !== user.id) return error(403, 'forbidden', 'That order is not yours.');
  if (isDirect(order)) {
    return error(409, 'already_filed', 'That is a domestic sale. It is not travelling in a lot.');
  }

  /*
   * An item already in a lot may be moved to another one, which is a thing
   * shops do: a piece misses the cut-off and rides the next run instead. It
   * used to be refused, and the only way to do it was to tell the buyer
   * nothing and hope they did not look.
   */
  const previous = inLot(order) ? await repository.getLot(order.sellerId, order.lotId) : null;
  const was = previous ? lotRefOf(previous) : null;

  let lot = body.lotId ? await repository.getLot(user.id, body.lotId) : null;
  if (body.lotId && !lot) return error(404, 'not_found', 'No such lot.');
  if (lot && lot.id === order.lotId) {
    return error(409, 'already_filed', 'That item is already in that lot.');
  }

  if (!lot) {
    if (!body.newLot) return error(400, 'invalid_request', 'Pick a lot, or describe a new one.');
    const made = await buildLot(user.id, body.newLot, repository);
    if (made.refusal) return error(made.refusal.status, made.refusal.code, made.refusal.message);
    lot = made.lot;
  }

  const route = routeOf(lot);
  const index = currentStepOf(lot);
  const now = new Date().toISOString();
  const event: StageEvent = {
    stage: coarseStage(route, index),
    step: route.steps[index]?.name,
    enteredAt: now,
    kind: was ? 'moved' : 'joined',
    lot: lotRefOf(lot),
    from: was,
    note: null,
    recordedBy: user.id,
  };

  const moved: Order = await repository.moveOrderToLot(
    {
      ...order,
      lotId: lot.id,
      stage: coarseStage(route, index),
      // Its own position goes with it: the item now rides this lot's ladder,
      // and a place on the last one means nothing here.
      currentStep: index,
      stageHistory: [...order.stageHistory, event],
      status: order.status === 'cancelled' ? order.status : 'in_fulfilment',
      updatedAt: now,
    },
    order.lotId,
  );

  await notify(
    repository,
    [moved.buyerId],
    {
      kind: 'lot_moved',
      title: was ? `Your item moved to ${lot.name}` : `Your item is in ${lot.name}`,
      body: was
        ? `It travels with ${lot.name} now instead of ${was.name}.`
        : `It now travels with the lot: ${route.name}.`,
      link: '/me?tab=purchases',
    },
    { except: user.id },
  );

  return json(200, { order: moved, lot });
}

export const listTemplatesRoute = handler(listTemplates);
export const saveTemplateRoute = handler(saveTemplate);
export const deleteTemplateRoute = handler(deleteTemplate);
export const uploadRoute = handler(upload);
export const photoRoute = handler(photo);
export const assignOrderToLotRoute = handler(assignOrderToLot);

const anon = { authLevel: 'anonymous' } as const;

app.http('templates-list', { ...anon, methods: ['GET'], route: 'templates', handler: listTemplatesRoute });
app.http('templates-save', {
  ...anon, methods: ['POST'], route: 'templates/new', handler: saveTemplateRoute,
});
app.http('templates-delete', {
  ...anon, methods: ['POST'], route: 'templates/{id}/delete', handler: deleteTemplateRoute,
});
app.http('uploads', { ...anon, methods: ['POST'], route: 'uploads', handler: uploadRoute });
app.http('photo', { ...anon, methods: ['GET'], route: 'photos/{name}', handler: photoRoute });
app.http('order-lot', {
  ...anon, methods: ['POST'], route: 'orders/{id}/lot', handler: assignOrderToLotRoute,
});
