import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type { ArtistProfile, BatteryRule, ForwarderProfile, FreightLane, Post, StoreCore, StoreWarehouse, User } from '../../../shared/models.js';
import { STORE_KINDS, isLive, laneLabel, liveOfferings, livePlans, rightsIn, storeOf, insuranceQuote, type StoreKind } from '../../../shared/service-stores.js';
import {
  ARRIVAL_MOVES, CHANNEL_MAX_CHARS, REQUEST_MOVES, answerFor, batteryContentOf, batteryFits, batteryRuleOf,
  billFor, checkAnswers, coverOwedMinor, estimate, followId, formOf, latestExpiry, planIsFree, quoteIsExpired, quoteIsUsable,
  quoteNumber, readWarehouses, requestActions, addressLine, deliveryOf, needsDelivery, withDelivery, requestDueMinor, requestNumber, statusLabel, storeKey, warehousesOf,
  type ChannelMessage, type CustomQuote, type Dimensions, type ItemRow, type RequestAction, type ServiceRequest, type StoreFollow,
} from '../../../shared/service-work.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { limited, tooFast } from '../rate-limit.js';
import { ownPhotos } from '../storage/index.js';
import { notify } from './notify.js';
import { error, handler, json } from './http.js';
import { forgetPageStats, lanesOf } from './store-routes.js';

/**
 * Customers working with a forwarder or an artist directly.
 *
 * - A customer picks a route or a service on the store's page and sends the
 *   store's form; every member who works the jobs is told at once.
 * - The team quotes, the customer accepts and pays direct, the team moves it
 *   along to delivered, and the customer rates it - which is what the store's
 *   level and rating are made of.
 * - A store can also write a request itself, with a price, and send the link:
 *   the customer opens it, accepts and pays. That is a payment link.
 * - Each store has a channel: the company speaks in it (whoever the owner lets),
 *   members speak as themselves under the tag the owner gave them, and anyone
 *   signed in can ask a question.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;
const anon = { authLevel: 'anonymous' } as const;
const KINDS = new Set<string>(STORE_KINDS);
const isKind = (value: unknown): value is StoreKind => typeof value === 'string' && KINDS.has(value);

async function body<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

const text = (value: unknown, max: number): string => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const money = (value: unknown): number => {
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? Math.min(amount, 1_000_000_000) : 0;
};

/** The store behind a URL, whoever is asking. */
async function storeAt(repository: Repo, kindRaw: unknown, ownerId: unknown) {
  if (!isKind(kindRaw) || typeof ownerId !== 'string' || !ownerId) return null;
  const owner = await repository.getUserById(ownerId);
  const store = owner ? storeOf(owner, kindRaw) : null;
  if (!owner || !store) return null;
  return { kind: kindRaw, owner, store, key: storeKey(kindRaw, owner.id) };
}

/** Everyone who should hear about a request: the owner and members who work the jobs. */
function crewIds(owner: User, kind: StoreKind): string[] {
  const store = storeOf(owner, kind);
  return [owner.id, ...(store?.team ?? []).filter((member) => rightsIn(owner, kind, member.userId).includes('work')).map((m) => m.userId)];
}

function teamOf(owner: User, kind: StoreKind) {
  const store = storeOf(owner, kind)!;
  return [
    { userId: owner.id, name: owner.displayName, tag: 'Owner' },
    ...(store.team ?? []).map((member) => ({ userId: member.userId, name: member.displayName, tag: member.tag ?? null })),
  ];
}

const consoleLink = (request: Pick<ServiceRequest, 'kind' | 'ownerId' | 'id'>) =>
  `/services/store/${request.kind}/${request.ownerId}?tab=requests&r=${request.id}`;
const customerLink = (request: Pick<ServiceRequest, 'kind' | 'ownerId' | 'id'>) =>
  `/services/requests/${request.kind}/${request.ownerId}/${request.id}`;

/** A request as one side sees it. */
function requestView(request: ServiceRequest, side: 'store' | 'customer', store: StoreCore, kind: StoreKind) {
  const arrival = request.billing === 'arrival';
  const paidOrLater = arrival
    ? ['billed', 'paid', 'shipped', 'delivered'].includes(request.status) || coverOwedMinor(request) > 0 || Boolean(request.coverPayment)
    : ['accepted', 'paid', 'received', 'in_progress', 'shipped', 'delivered'].includes(request.status);
  const forwarder = kind === 'forwarder' ? (store as ForwarderProfile) : null;
  const lane = forwarder ? lanesOf(forwarder).find((row) => row.id === request.subject?.id) : undefined;
  return {
    request,
    side,
    actions: requestActions(request, side),
    due: requestDueMinor(request),
    /** Paid cover owed before the parcel is sent, when the store asks for it upfront. */
    coverDue: coverOwedMinor(request),
    /** Where to pay, once there is something to pay for. */
    payTo: side === 'customer' && paidOrLater ? (store.payment ?? null) : null,
    /** Where the goods go: a forwarder's warehouses are public; an artist's studio only once paid. */
    sendTo: kind === 'forwarder'
      ? (request.sendTo?.length ? request.sendTo : warehousesOf(lane, forwarder?.warehouse))
      : (['paid', 'received', 'in_progress'].includes(request.status) && (store as ArtistProfile).studioAddress
        ? [{ name: 'Studio', address: (store as ArtistProfile).studioAddress, contact: '', hours: '' }] : []),
  };
}

/* ── A customer asks ─────────────────────────────────────────────────── */

/** POST /api/service-store/{kind}/{ownerId}/requests - send the store's form. */
async function submitRequest(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const wait = await limited(user.id, 'offer');
  if (wait) return error(429, 'slow_down', `Too many requests. Try again ${wait}.`);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found || !isLive(found.store) || found.owner.suspended) return error(404, 'not_found', 'No such store.');
  const { kind, owner, store, key } = found;
  if (owner.id === user.id) return error(400, 'own_store', 'This is your own store.');
  const input = await body<{
    subjectId?: string; optionId?: string | null; planId?: string | null; answers?: Record<string, unknown>;
    addonIds?: string[]; external?: boolean; quoteId?: string | null;
  }>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  // A store that collects details on its own form (a Google Form, say) gets
  // a request with no answers here - just the route, the extras and the cover.
  const external = Boolean(store.formUrl) && input.external === true;
  const picked = new Set(Array.isArray(input.addonIds) ? input.addonIds.filter((id) => typeof id === 'string') : []);
  const addons = (store.serviceOptions ?? []).filter((row) => picked.has(row.id))
    .map((row) => ({ id: row.id, name: row.name, priceMinor: row.priceMinor }));

  let subject: { id: string; label: string } | null = null;
  let option = null;
  let estimated;
  let plan: ServiceRequest['plan'] = null;
  let chargeableKg: number | null = null;
  let rate: ServiceRequest['rate'] = null;
  let sendTo: StoreWarehouse[] | undefined;
  let coverDue: ServiceRequest['coverDue'] = null;
  let quote: CustomQuote | null = null;
  // Even on the store's own form, a forwarder still needs the tracking number here: it is how the box is matched.
  const form = external
    ? (kind === 'forwarder' ? formOf(kind, store.requestForm).filter((row) => row.key === 'awb') : [])
    : formOf(kind, store.requestForm);
  const { answers, gaps } = checkAnswers(form, input.answers);
  if (gaps.length > 0) return error(400, 'incomplete', `Still needed: ${gaps.join(', ')}.`);

  if (kind === 'forwarder') {
    const profile = store as ForwarderProfile;
    let lane: FreightLane | undefined;
    let batteries: BatteryRule;
    if (input.quoteId) {
      // A parcel on the customer's own quote: its rate, its batteries, its warehouses.
      quote = await repository.getServiceWork<CustomQuote>(key, String(input.quoteId));
      if (!quote || quote.type !== 'quote' || quote.customerId !== user.id) return error(404, 'no_quote', 'No such quote.');
      if (!quoteIsUsable(quote) || !quote.offer) return error(409, 'quote_gone', 'That quote has expired or has not been priced yet.');
      lane = quote.route.laneId ? lanesOf(profile).find((row) => row.id === quote!.route.laneId) : undefined;
      subject = { id: lane?.id ?? quote.id, label: `${laneLabel(quote.route)} · ${quote.route.mode} · quote ${quote.number}` };
      rate = { ratePerKgMinor: quote.offer.ratePerKgMinor, minChargeKg: quote.offer.minChargeKg, volumetric: lane?.volumetric ?? null };
      batteries = quote.offer.batteries;
      sendTo = quote.offer.warehouses.length ? quote.offer.warehouses : warehousesOf(lane, profile.warehouse);
    } else {
      lane = lanesOf(profile).find((row) => row.id === input.subjectId);
      if (!lane) return error(400, 'no_route', 'Pick one of the routes this forwarder runs.');
      subject = { id: lane.id, label: `${laneLabel(lane)} · ${lane.mode}` };
      option = (lane.products ?? []).find((row) => row.id === input.optionId) ?? null;
      rate = { ratePerKgMinor: lane.ratePerKgMinor, minChargeKg: lane.minChargeKg, volumetric: lane.volumetric ?? null };
      batteries = batteryRuleOf(lane);
      sendTo = warehousesOf(lane, profile.warehouse);
    }
    const items = answerFor<ItemRow[]>(form, answers, 'items') ?? [];
    if (!batteryFits(batteries, batteryContentOf(answerFor(form, answers, 'battery')))) {
      return error(400, 'no_battery', batteries === 'none'
        ? 'This route does not carry anything with a battery.'
        : 'This route only carries batteries fitted inside an item - no loose batteries or power banks.');
    }
    const declared = (answerFor<number>(form, answers, 'declared_value') ?? 0) * 100
      || items.reduce((sum, row) => sum + row.qty * row.valueMinor, 0);
    const pickedPlan = livePlans(profile).find((row) => row.id === input.planId) ?? null;
    estimated = estimate({
      kind, lane: rate, option,
      weightKg: answerFor<number>(form, answers, 'weight') ?? 0,
      box: answerFor<Dimensions>(form, answers, 'dimensions'),
      pieces: items.reduce((sum, row) => sum + row.qty, 0),
      plan: pickedPlan, declaredMinor: declared, addons,
    });
    chargeableKg = estimated.chargeable?.kg ?? null;
    if (pickedPlan && (planIsFree(pickedPlan) || declared > 0)) {
      plan = { id: pickedPlan.id, name: pickedPlan.name, premiumMinor: estimated.premiumMinor, coverMinor: insuranceQuote(pickedPlan, declared).coverMinor };
      if (plan.premiumMinor > 0) coverDue = profile.coverPayment === 'upfront' ? 'upfront' : 'with_bill';
    }
  } else {
    const profile = store as ArtistProfile;
    if (profile.acceptingWork === false) return error(409, 'closed', 'This studio is not taking new work right now.');
    const offering = liveOfferings(profile).find((row) => row.id === input.subjectId);
    if (!offering) return error(400, 'no_service', 'Pick one of the services on the menu.');
    subject = { id: offering.id, label: offering.name };
    option = (offering.products ?? []).find((row) => row.id === input.optionId) ?? null;
    estimated = estimate({ kind, offering, option, addons });
  }

  const now = new Date().toISOString();
  const account = await repository.getUserById(user.id);
  const doc: ServiceRequest = {
    id: `req_${randomUUID()}`,
    type: 'request',
    storeId: key,
    kind,
    ownerId: owner.id,
    storeName: store.companyName,
    storeSlug: store.directorySlug,
    number: requestNumber(kind),
    origin: 'form',
    subject,
    option,
    customerId: user.id,
    customerName: account?.displayName ?? user.displayName,
    customerHandle: account?.username ?? null,
    fields: form,
    answers,
    title: subject?.label ?? '',
    description: '',
    plan,
    addons,
    external,
    // A forwarder's listed route needs no quote: the parcel is weighed and billed on arrival.
    billing: kind === 'forwarder' ? 'arrival' : 'quote',
    quoteId: quote?.id ?? null,
    rate,
    ...(sendTo ? { sendTo } : {}),
    coverDue,
    coverPayment: null,
    inbound: null,
    bill: null,
    estimateMinor: estimated.totalMinor,
    chargeableKg,
    quoteMinor: null,
    quoteNote: '',
    turnaroundDays: null,
    status: kind === 'forwarder' ? 'booked' : 'submitted',
    assigneeId: null,
    assigneeName: null,
    payment: null,
    tracking: null,
    review: null,
    history: [{
      at: now, by: user.id, byName: account?.displayName ?? user.displayName,
      note: external ? 'Filled in the store’s own form.' : kind === 'forwarder' ? 'Booked a parcel.' : 'Request sent.',
      status: kind === 'forwarder' ? 'booked' : 'submitted',
    }],
    createdAt: now,
    updatedAt: now,
  };
  await repository.saveServiceWork(doc);
  if (quote) await repository.saveServiceWork({ ...quote, used: quote.used + 1, updatedAt: now });
  await notify(repository, crewIds(owner, kind), {
    kind: 'service_store',
    title: `${kind === 'forwarder' ? 'Parcel booked' : 'New request'} ${doc.number} · ${subject?.label ?? store.companyName}`,
    body: external
      ? `${doc.customerName} says they filled in your form.`
      : `${doc.customerName} sent the form${chargeableKg ? ` · about ${chargeableKg} kg` : ''}.`,
    link: consoleLink(doc),
  }, { except: user.id });
  return json(201, requestView(doc, 'customer', store, kind));
}

/**
 * GET /api/me/assigned-requests - the requests a team lead gave this person,
 * across every store they are on. Only stores they are still on: somebody
 * removed from a team stops seeing its work.
 */
async function assignedRequests(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const rows = await repository.listServiceRequestsAssignedTo(user.id);
  const owners = new Map<string, User | null>();
  const visible: ServiceRequest[] = [];
  for (const row of rows) {
    if (!owners.has(row.ownerId)) owners.set(row.ownerId, await repository.getUserById(row.ownerId));
    const owner = owners.get(row.ownerId);
    if (owner && rightsIn(owner, row.kind, user.id).includes('work')) visible.push(row);
  }
  return json(200, {
    requests: visible.map((row) => ({ request: row, due: requestDueMinor(row), actions: requestActions(row, 'store') })),
  });
}
export const assignedRequestsRoute = handler(assignedRequests);

/** GET /api/me/service-requests - everything this person has asked stores for. */
async function myRequests(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const rows = await repository.listServiceRequestsBy(user.id);
  return json(200, {
    requests: rows.map((row) => ({
      request: row,
      actions: requestActions(row, 'customer'),
      due: requestDueMinor(row),
    })),
  });
}

/** Who is looking at a request, and from which side. */
async function requestFor(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found) return { refusal: error(404, 'not_found', 'No such request.') } as const;
  const doc = await repository.getServiceWork<ServiceRequest>(found.key, request.params.id ?? '');
  if (!doc || doc.type !== 'request') return { refusal: error(404, 'not_found', 'No such request.') } as const;
  const rights = rightsIn(found.owner, found.kind, user.id);
  const isCustomer = doc.customerId === user.id;
  // A payment link nobody has taken yet may be opened by whoever has it.
  const openLink = doc.origin === 'link' && !doc.customerId && rights.length === 0;
  const side: 'store' | 'customer' | null = rights.includes('work') ? 'store' : (isCustomer || openLink) ? 'customer' : null;
  if (!side) return { refusal: error(404, 'not_found', 'No such request.') } as const;
  return { refusal: null, user, repository, doc, side, ...found } as const;
}

/** GET /api/service-requests/{kind}/{ownerId}/{id} */
async function getRequest(request: HttpRequest, _context: InvocationContext) {
  const found = await requestFor(request);
  if (found.refusal) return found.refusal;
  return json(200, {
    ...requestView(found.doc, found.side, found.store, found.kind),
    store: { name: found.store.companyName, slug: found.store.directorySlug, accent: found.store.accent ?? null, logoUrl: found.store.logoUrl ?? null },
    team: found.side === 'store' ? teamOf(found.owner, found.kind) : [],
  });
}

/**
 * POST /api/service-requests/{kind}/{ownerId}/{id}/act - one move.
 *
 * Who may make it is `REQUEST_MOVES`, the same table the screens draw their
 * buttons from, so a button never appears for a move the server refuses.
 */
async function actOnRequest(request: HttpRequest, _context: InvocationContext) {
  const found = await requestFor(request);
  if (found.refusal) return found.refusal;
  const { doc, side, user, repository, owner, kind, store } = found;
  const input = await body<{
    action?: RequestAction; quoteMinor?: number; days?: number; note?: string; reference?: string; amountMinor?: number;
    courier?: string; awb?: string; stars?: number; text?: string; assigneeId?: string | null;
    weightKg?: number; box?: Partial<Dimensions> | null; photoUrls?: unknown; added?: { label?: string; minor?: number }[];
    address?: unknown;
  }>(request);
  if (!input?.action || !(input.action in REQUEST_MOVES || input.action in ARRIVAL_MOVES)) return error(400, 'invalid_action', 'Unknown move.');
  const action = input.action;
  if (!requestActions(doc, side).includes(action)) return error(409, 'not_now', 'That cannot be done on this request right now.');
  const actor = await repository.getUserById(user.id);
  const byName = actor?.displayName ?? user.displayName;
  const now = new Date().toISOString();
  const note = text(input.note, 500);
  let told: { to: 'customer' | 'store'; title: string; body: string } | null = null;
  const label = (status: ServiceRequest['status']) => statusLabel({ kind, status, billing: doc.billing }).label;
  const rupees = (minor: number) => `₹${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

  switch (action) {
    case 'quote': {
      const quote = money(input.quoteMinor);
      if (!quote) return error(400, 'no_price', 'Give the price you are quoting.');
      doc.quoteMinor = quote;
      doc.quoteNote = note;
      doc.turnaroundDays = Math.max(0, Math.min(365, Math.round(Number(input.days) || 0))) || null;
      doc.status = 'quoted';
      told = { to: 'customer', title: `${store.companyName} quoted ${doc.number}`, body: `₹${(quote / 100).toLocaleString('en-IN')}${note ? ` · ${note}` : ''}` };
      break;
    }
    case 'decline':
      doc.status = 'declined';
      told = { to: 'customer', title: `${store.companyName} declined ${doc.number}`, body: note || 'They cannot take this one.' };
      break;
    case 'accept':
      if (!doc.customerId) {
        doc.customerId = user.id;
        doc.customerName = byName;
        doc.customerHandle = actor?.username ?? null;
      }
      doc.status = 'accepted';
      told = { to: 'store', title: `${doc.customerName} accepted ${doc.number}`, body: 'They will pay next.' };
      break;
    case 'address': {
      const next = withDelivery(doc, input.address);
      if (!next.ok) return error(400, 'no_address', 'Give the full delivery address: name, phone, street, city and PIN code.');
      doc.fields = next.fields;
      doc.answers = next.answers;
      const where = deliveryOf(doc);
      told = { to: 'store', title: `${doc.customerName} changed the delivery address on ${doc.number}`, body: where ? addressLine(where) : '' };
      break;
    }
    case 'pay': {
      // A parcel billed on arrival goes out for delivery once paid, so it has to know where to.
      if (input.address !== undefined && input.address !== null) {
        const next = withDelivery(doc, input.address);
        if (!next.ok) return error(400, 'no_address', 'Give the full delivery address: name, phone, street, city and PIN code.');
        doc.fields = next.fields;
        doc.answers = next.answers;
      }
      if (needsDelivery(doc)) return error(400, 'no_address', 'Add where it should be delivered before you pay.');
      const amount = money(input.amountMinor) || requestDueMinor(doc);
      doc.payment = { amountMinor: amount, reference: text(input.reference, 80) || null, claimedAt: now, confirmedAt: null, confirmedBy: null };
      told = { to: 'store', title: `${doc.customerName} says they paid ${doc.number}`, body: `₹${(amount / 100).toLocaleString('en-IN')}${doc.payment.reference ? ` · ref ${doc.payment.reference}` : ''} — check and confirm.` };
      break;
    }
    case 'confirm_payment':
      doc.payment = { ...doc.payment!, confirmedAt: now, confirmedBy: user.id };
      doc.status = 'paid';
      told = {
        to: 'customer', title: `Payment confirmed · ${doc.number}`,
        body: doc.billing === 'arrival' ? 'It goes out for delivery next.' : kind === 'forwarder' ? 'Send your parcel to the warehouse.' : 'Send your piece to the studio.',
      };
      break;
    case 'send_in': {
      // The tracking number is how the warehouse matches the box to this customer.
      const awb = text(input.awb, 60) || text(answerFor<string>(doc.fields, doc.answers, 'awb'), 60);
      if (!awb) return error(400, 'no_awb', 'Give the tracking number on the box - the warehouse matches your parcel by it.');
      doc.inbound = { courier: text(input.courier, 60) || text(answerFor<string>(doc.fields, doc.answers, 'origin_courier'), 60), awb, at: now };
      doc.status = 'sent_in';
      told = { to: 'store', title: `${doc.customerName} sent ${doc.number} to your warehouse`, body: [doc.inbound.courier, doc.inbound.awb].filter(Boolean).join(' ') || 'No tracking number given.' };
      break;
    }
    case 'bill': {
      const weightKg = Math.round(Math.min(10_000, Math.max(0, Number(input.weightKg) || 0)) * 100) / 100;
      if (!weightKg) return error(400, 'no_weight', 'Give the weight the scale shows.');
      const photoUrls = await ownPhotos(input.photoUrls ?? [], 4);
      if (photoUrls === null || photoUrls.length === 0) return error(400, 'no_photo', 'Add a photo of the parcel on the scale.');
      const rawBox = input.box ?? null;
      const box = rawBox && Number(rawBox.l) > 0 && Number(rawBox.w) > 0 && Number(rawBox.h) > 0
        ? { l: Math.min(500, Number(rawBox.l)), w: Math.min(500, Number(rawBox.w)), h: Math.min(500, Number(rawBox.h)) } : null;
      const added = (Array.isArray(input.added) ? input.added : []).slice(0, 6)
        .map((row) => ({ label: text(row?.label, 60), minor: Math.max(-100_000_000, Math.min(100_000_000, Math.round(Number(row?.minor) || 0))) }))
        .filter((row) => row.label && row.minor);
      const priced = billFor(doc, weightKg, box, added);
      doc.bill = { weightKg, box, ...priced, photoUrls, note, at: now, byName };
      doc.chargeableKg = priced.chargeableKg;
      doc.status = 'billed';
      const where = deliveryOf(doc);
      told = {
        to: 'customer', title: `${doc.number} arrived · ${rupees(priced.totalMinor)} to pay`,
        body: `Weighed ${weightKg} kg${priced.by !== 'actual' ? ` (billed ${priced.chargeableKg} kg ${priced.by})` : ''}. `
          + (where
            ? `Delivering to: ${addressLine(where)}. Need it somewhere else? Change it before you pay.`
            : 'No delivery address yet - add it when you pay.'),
      };
      break;
    }
    case 'pay_cover': {
      const amount = coverOwedMinor(doc);
      doc.coverPayment = { amountMinor: amount, reference: text(input.reference, 80) || null, claimedAt: now, confirmedAt: null, confirmedBy: null };
      told = { to: 'store', title: `${doc.customerName} paid the cover on ${doc.number}`, body: `${rupees(amount)}${doc.coverPayment.reference ? ` · ref ${doc.coverPayment.reference}` : ''} — check and confirm.` };
      break;
    }
    case 'confirm_cover':
      doc.coverPayment = { ...doc.coverPayment!, confirmedAt: now, confirmedBy: user.id };
      told = { to: 'customer', title: `Cover confirmed · ${doc.number}`, body: 'Your parcel is covered.' };
      break;
    case 'receive':
    case 'start':
      doc.status = action === 'receive' ? 'received' : 'in_progress';
      told = { to: 'customer', title: `${doc.number}: ${label(doc.status)}`, body: note || store.companyName };
      break;
    case 'ship': {
      const awb = text(input.awb, 60);
      if (!awb) return error(400, 'no_awb', 'Give the tracking number.');
      doc.tracking = { courier: text(input.courier, 60), awb, at: now };
      doc.status = 'shipped';
      told = { to: 'customer', title: `${doc.number}: ${label('shipped')}`, body: `${doc.tracking.courier ? `${doc.tracking.courier} ` : ''}${awb}` };
      break;
    }
    case 'deliver':
    case 'complete':
      doc.status = 'delivered';
      forgetPageStats(kind, owner.id);
      told = action === 'deliver'
        ? { to: 'customer', title: `${doc.number}: ${label('delivered')}`, body: 'Tell others how it went — rate it.' }
        : { to: 'store', title: `${doc.customerName} got ${doc.number}`, body: 'Marked as received.' };
      break;
    case 'cancel':
      doc.status = 'cancelled';
      told = { to: 'store', title: `${doc.customerName} cancelled ${doc.number}`, body: note || 'Nothing more to do.' };
      break;
    case 'review': {
      const stars = Math.round(Number(input.stars));
      if (!(stars >= 1 && stars <= 5)) return error(400, 'no_stars', 'Pick one to five stars.');
      doc.review = { stars, text: text(input.text, 1000), at: now };
      forgetPageStats(kind, owner.id);
      told = { to: 'store', title: `${stars}★ for ${doc.number}`, body: doc.review.text || `${doc.customerName} rated it.` };
      break;
    }
    case 'assign': {
      const team = teamOf(owner, kind);
      const who = input.assigneeId ? team.find((row) => row.userId === input.assigneeId) : null;
      if (input.assigneeId && !who) return error(400, 'not_on_team', 'Assign it to somebody on the team.');
      doc.assigneeId = who?.userId ?? null;
      doc.assigneeName = who?.name ?? null;
      if (who && who.userId !== user.id) {
        await notify(repository, [who.userId], { kind: 'service_store', title: `${doc.number} is yours`, body: `${byName} assigned it to you.`, link: consoleLink(doc) });
      }
      break;
    }
  }

  const done: Partial<Record<RequestAction, string>> = {
    quote: `Quoted ₹${((doc.quoteMinor ?? 0) / 100).toLocaleString('en-IN')}`,
    decline: 'Declined', accept: 'Accepted the quote', cancel: 'Cancelled',
    pay: `Paid ₹${((doc.payment?.amountMinor ?? 0) / 100).toLocaleString('en-IN')}${doc.payment?.reference ? ` (ref ${doc.payment.reference})` : ''}`,
    confirm_payment: 'Confirmed the payment arrived',
    send_in: `Sent it to the warehouse${doc.inbound?.awb ? ` · ${[doc.inbound.courier, doc.inbound.awb].filter(Boolean).join(' ')}` : ''}`,
    bill: `Weighed ${doc.bill?.weightKg ?? ''} kg · bill ${rupees(doc.bill?.totalMinor ?? 0)}`,
    pay_cover: `Paid the cover ${rupees(doc.coverPayment?.amountMinor ?? 0)}${doc.coverPayment?.reference ? ` (ref ${doc.coverPayment.reference})` : ''}`,
    confirm_cover: 'Confirmed the cover payment arrived',
    address: 'Changed the delivery address',
    complete: 'Confirmed it arrived', review: `Rated it ${doc.review?.stars ?? ''}★`,
    ship: `Shipped${doc.tracking ? ` · ${[doc.tracking.courier, doc.tracking.awb].filter(Boolean).join(' ')}` : ''}`,
  };
  const words = action === 'assign'
    ? (doc.assigneeName ? `Assigned to ${doc.assigneeName}.` : 'Unassigned.')
    : `${done[action] ?? label(doc.status)}${note && action !== 'quote' ? ` — ${note}` : ''}.`;
  doc.history = [...doc.history, { at: now, by: user.id, byName, note: words, status: doc.status }].slice(-80);
  doc.updatedAt = now;
  await repository.saveServiceWork(doc);

  if (told) {
    const audience = told.to === 'customer' ? [doc.customerId] : crewIds(owner, kind);
    await notify(repository, audience, {
      kind: 'service_store', title: told.title, body: told.body,
      link: told.to === 'customer' ? customerLink(doc) : consoleLink(doc),
    }, { except: user.id });
  }
  return json(200, { ...requestView(doc, side, store, kind), team: side === 'store' ? teamOf(owner, kind) : [] });
}

/* ── The team's side ─────────────────────────────────────────────────── */

async function crewStore(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found) return { refusal: error(404, 'not_found', 'No such store.') } as const;
  if (!rightsIn(found.owner, found.kind, user.id).includes('work')) {
    return { refusal: error(403, 'forbidden', 'That needs the "work" right in this store.') } as const;
  }
  return { refusal: null, user, repository, ...found } as const;
}

/** GET /api/service-stores/{kind}/{ownerId}/requests - every request, for the dashboard. */
async function storeRequests(request: HttpRequest, _context: InvocationContext) {
  const found = await crewStore(request);
  if (found.refusal) return found.refusal;
  const rows = await found.repository.listServiceWork<ServiceRequest>(found.key, 'request');
  return json(200, {
    requests: rows.map((row) => ({ request: row, actions: requestActions(row, 'store'), due: requestDueMinor(row) })),
    team: teamOf(found.owner, found.kind),
  });
}

/**
 * POST /api/service-stores/{kind}/{ownerId}/links - a payment link.
 *
 * The store writes the request itself - what the work is, what it costs - and
 * sends the link. Whoever opens it first and accepts becomes its customer.
 */
async function createLink(request: HttpRequest, _context: InvocationContext) {
  const found = await crewStore(request);
  if (found.refusal) return found.refusal;
  const { owner, kind, store, key, repository, user } = found;
  if (!isLive(store)) return error(409, 'not_live', 'Your store needs to be live to take payments.');
  const input = await body<{ title?: string; description?: string; amountMinor?: number; days?: number; subjectId?: string; customer?: string }>(request);
  const title = text(input?.title, 120);
  const amount = money(input?.amountMinor);
  if (!title || !amount) return error(400, 'incomplete', 'Give the link a title and a price.');
  const subjects = kind === 'forwarder'
    ? lanesOf(store as ForwarderProfile).map((lane) => ({ id: lane.id, label: `${laneLabel(lane)} · ${lane.mode}` }))
    : liveOfferings(store as ArtistProfile).map((offering) => ({ id: offering.id, label: offering.name }));
  const actor = await repository.getUserById(user.id);
  const now = new Date().toISOString();
  const doc: ServiceRequest = {
    id: `req_${randomUUID()}`, type: 'request', storeId: key, kind, ownerId: owner.id,
    storeName: store.companyName, storeSlug: store.directorySlug, number: requestNumber(kind), origin: 'link',
    subject: subjects.find((row) => row.id === input?.subjectId) ?? null, option: null,
    customerId: null, customerName: 'Whoever opens the link', customerHandle: null,
    fields: [], answers: {}, title, description: text(input?.description, 2000), plan: null,
    estimateMinor: amount, chargeableKg: null, quoteMinor: amount, quoteNote: '',
    turnaroundDays: Math.max(0, Math.min(365, Math.round(Number(input?.days) || 0))) || null,
    status: 'quoted', assigneeId: user.id, assigneeName: actor?.displayName ?? user.displayName,
    payment: null, tracking: null, review: null,
    history: [{ at: now, by: user.id, byName: actor?.displayName ?? user.displayName, note: 'Payment link created.' }],
    createdAt: now, updatedAt: now,
  };
  await repository.saveServiceWork(doc);
  return json(201, { request: doc, link: customerLink(doc) });
}

/* ── The channel ─────────────────────────────────────────────────────── */

/** GET /api/service-store/{kind}/{ownerId}/channel */
async function readChannel(request: HttpRequest, _context: InvocationContext) {
  const repository = await getRepository();
  const auth = await getAuthService();
  const [found, viewer] = await Promise.all([
    storeAt(repository, request.params.kind, request.params.ownerId),
    auth.getCurrentUser(request),
  ]);
  if (!found) return error(404, 'not_found', 'No such store.');
  const rights = viewer ? rightsIn(found.owner, found.kind, viewer.id) : [];
  if ((!isLive(found.store) || found.owner.suspended) && rights.length === 0) return error(404, 'not_found', 'No such store.');
  const messages = await repository.listServiceWork<ChannelMessage>(found.key, 'chat', 150);
  return json(200, {
    messages: messages.reverse(),
    me: viewer ? {
      canSpeakAsCompany: rights.includes('voice'),
      isMember: rights.length > 0,
      moderates: rights.includes('team'),
      tag: viewer.id === found.owner.id ? 'Owner' : (found.store.team ?? []).find((m) => m.userId === viewer.id)?.tag ?? null,
    } : null,
  });
}

/** POST /api/service-store/{kind}/{ownerId}/channel - say something. */
async function postChannel(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const wait = await limited(user.id, 'comment');
  if (wait) return error(429, 'slow_down', `You are writing quickly. Try again ${wait}.`);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found) return error(404, 'not_found', 'No such store.');
  const { owner, kind, store, key } = found;
  const rights = rightsIn(owner, kind, user.id);
  if ((!isLive(store) || owner.suspended) && rights.length === 0) return error(404, 'not_found', 'No such store.');
  const input = await body<{ body?: string; asCompany?: boolean; announcement?: boolean; toSocial?: boolean; photoUrls?: unknown }>(request);
  const words = text(input?.body, CHANNEL_MAX_CHARS);
  if (!words) return error(400, 'empty', 'Write something first.');
  if (input?.asCompany && !rights.includes('voice')) return error(403, 'no_voice', 'The owner has not let you speak as the company.');
  const account = await repository.getUserById(user.id);
  const asCompany = input?.asCompany === true;
  const now = new Date().toISOString();

  // Said as the company and shared: a post on Social too, in the store's own
  // name, which reaches its followers' feeds and Discover like any post.
  let post: Post | null = null;
  if (asCompany && input?.toSocial === true && isLive(store) && !owner.suspended) {
    const slow = await tooFast(user.id, 'post');
    if (slow) return slow;
    const photoUrls = await ownPhotos(input.photoUrls ?? [], 4);
    if (photoUrls === null) return error(400, 'invalid_post', 'Up to 4 photos, uploaded here first.');
    post = await repository.createPost({
      id: `pst_${randomUUID().slice(0, 12)}`,
      channelId: key, channel: 'service', kind: 'update',
      authorId: user.id, authorName: store.companyName,
      body: words, listingId: null, photoUrl: photoUrls[0] ?? null, photoUrls,
      likeCount: 0, replyCount: 0, voice: 'store', reach: 'feed', announcement: true,
      reactions: [], comments: [], shareCount: 0,
      service: { kind, ownerId: owner.id, name: store.companyName, slug: store.directorySlug },
      createdAt: now, updatedAt: now,
    });
  }
  const message: ChannelMessage = {
    id: `msg_${randomUUID()}`, type: 'chat', storeId: key,
    authorId: user.id,
    authorName: asCompany ? store.companyName : (account?.displayName ?? user.displayName),
    authorHandle: asCompany ? null : (account?.username ?? null),
    voice: asCompany ? 'company' : rights.length > 0 ? 'member' : 'visitor',
    tag: asCompany ? null : rights.length > 0 ? (owner.id === user.id ? 'Owner' : (store.team ?? []).find((m) => m.userId === user.id)?.tag ?? 'Team') : null,
    body: words,
    announcement: asCompany && (input?.announcement === true || post !== null),
    postId: post?.id ?? null,
    createdAt: now, updatedAt: now,
  };
  await repository.saveServiceWork(message);
  if (message.announcement) {
    const followers = await repository.listServiceWork<StoreFollow>(key, 'follow', 500);
    await notify(repository, followers.map((row) => row.userId), {
      kind: 'service_store', title: store.companyName, body: words.slice(0, 140),
      link: `/services/${kind}/${store.directorySlug}?tab=channel`,
    }, { except: user.id, pushLater: true });
  } else if (message.voice === 'visitor') {
    // A customer asking in the channel is a question for the team.
    await notify(repository, crewIds(owner, kind), {
      kind: 'service_store', title: `${message.authorName} in ${store.companyName}’s channel`, body: words.slice(0, 140),
      link: `/services/store/${kind}/${owner.id}?tab=channel`,
    }, { except: user.id, pushLater: true });
  }
  return json(201, { message, post: post ? { channelId: post.channelId, id: post.id } : null });
}

/** POST /api/service-store/{kind}/{ownerId}/channel/{id}/delete */
async function deleteChannel(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found) return error(404, 'not_found', 'No such store.');
  const message = await repository.getServiceWork<ChannelMessage>(found.key, request.params.id ?? '');
  if (!message || message.type !== 'chat') return error(404, 'not_found', 'No such message.');
  const moderates = rightsIn(found.owner, found.kind, user.id).includes('team');
  if (message.authorId !== user.id && !moderates) return error(403, 'forbidden', 'Only its author or the store’s managers can remove it.');
  await repository.deleteServiceWork(found.key, message.id);
  return json(200, { ok: true });
}

/** POST /api/service-store/{kind}/{ownerId}/follow - {follow: boolean} */
async function follow(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found || !isLive(found.store)) return error(404, 'not_found', 'No such store.');
  const input = await body<{ follow?: boolean }>(request);
  const id = followId(user.id);
  if (input?.follow === false) {
    await repository.deleteServiceWork(found.key, id);
  } else {
    const now = new Date().toISOString();
    await repository.saveServiceWork<StoreFollow>({ id, type: 'follow', storeId: found.key, userId: user.id, createdAt: now, updatedAt: now });
  }
  forgetPageStats(found.kind, found.owner.id);
  return json(200, { following: input?.follow !== false, followers: await repository.countServiceFollowers(found.key) });
}

export const submitRequestRoute = handler(submitRequest);
export const channelRoute = handler(readChannel);
export const channelPostRoute = handler(postChannel);
export const channelDeleteRoute = handler(deleteChannel);
export const followStoreRoute = handler(follow);
export const myRequestsRoute = handler(myRequests);
export const requestRoute = handler(getRequest);
export const requestActRoute = handler(actOnRequest);
export const storeRequestsRoute = handler(storeRequests);
export const paymentLinkRoute = handler(createLink);

app.http('svc-request-submit', { ...anon, methods: ['POST'], route: 'service-store/{kind}/{ownerId}/requests', handler: submitRequestRoute });
// One template, two methods: the Functions host refuses the same route registered twice.
app.http('svc-channel', {
  ...anon, methods: ['GET', 'POST'], route: 'service-store/{kind}/{ownerId}/channel',
  handler: (request, context) => (request.method === 'POST' ? channelPostRoute(request, context) : channelRoute(request, context)),
});
app.http('svc-channel-delete', { ...anon, methods: ['POST'], route: 'service-store/{kind}/{ownerId}/channel/{id}/delete', handler: channelDeleteRoute });
app.http('svc-follow', { ...anon, methods: ['POST'], route: 'service-store/{kind}/{ownerId}/follow', handler: followStoreRoute });
app.http('svc-my-requests', { ...anon, methods: ['GET'], route: 'me/service-requests', handler: myRequestsRoute });
app.http('svc-assigned-requests', { ...anon, methods: ['GET'], route: 'me/assigned-requests', handler: assignedRequestsRoute });
app.http('svc-request', { ...anon, methods: ['GET'], route: 'service-requests/{kind}/{ownerId}/{id}', handler: requestRoute });
app.http('svc-request-act', { ...anon, methods: ['POST'], route: 'service-requests/{kind}/{ownerId}/{id}/act', handler: requestActRoute });
app.http('svc-store-requests', { ...anon, methods: ['GET'], route: 'service-stores/{kind}/{ownerId}/requests', handler: storeRequestsRoute });
app.http('svc-store-links', { ...anon, methods: ['POST'], route: 'service-stores/{kind}/{ownerId}/links', handler: paymentLinkRoute });

/* ── Custom quotes ───────────────────────────────────────────────────── */

const MODES = ['air', 'express', 'sea', 'rail', 'road'] as const;
const quoteLink = (quote: Pick<CustomQuote, 'kind' | 'ownerId' | 'id'>) => `/services/quotes/${quote.kind}/${quote.ownerId}/${quote.id}`;
const quoteConsoleLink = (quote: Pick<CustomQuote, 'kind' | 'ownerId' | 'id'>) => `/services/store/${quote.kind}/${quote.ownerId}?tab=quotes&q=${quote.id}`;

/** Drop the expired ones from a list, deleting them as it goes. */
async function liveQuotes(repository: Repo, rows: CustomQuote[]): Promise<CustomQuote[]> {
  const now = Date.now();
  const expired = rows.filter((row) => quoteIsExpired(row, now));
  await Promise.all(expired.map((row) => repository.deleteServiceWork(row.storeId, row.id)));
  return rows.filter((row) => !quoteIsExpired(row, now));
}

/** The clock's sweep: every quote past its date is deleted. */
export async function sweepExpiredQuotes(repository: Repo): Promise<number> {
  const rows = await repository.listExpiredServiceQuotes(new Date().toISOString(), 200);
  await Promise.all(rows.map((row) => repository.deleteServiceWork(row.storeId, row.id)));
  return rows.length;
}

function quoteView(quote: CustomQuote, side: 'store' | 'customer', store: StoreCore) {
  const profile = store as ForwarderProfile;
  const lane = quote.route.laneId ? lanesOf(profile).find((row) => row.id === quote.route.laneId) : undefined;
  return {
    quote,
    side,
    usable: quoteIsUsable(quote),
    sendTo: quote.offer?.warehouses.length ? quote.offer.warehouses : warehousesOf(lane, profile.warehouse),
    store: { name: store.companyName, slug: store.directorySlug, accent: store.accent ?? null, logoUrl: store.logoUrl ?? null },
  };
}

/**
 * POST /api/service-store/{kind}/{ownerId}/quotes - ask a forwarder for a
 * custom price: a route they list or one they do not, and what is being sent.
 */
async function askQuote(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const wait = await limited(user.id, 'offer');
  if (wait) return error(429, 'slow_down', `Too many requests. Try again ${wait}.`);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found || found.kind !== 'forwarder' || !isLive(found.store) || found.owner.suspended) return error(404, 'not_found', 'No such store.');
  const { kind, owner, store, key } = found;
  if (owner.id === user.id) return error(400, 'own_store', 'This is your own store.');
  const input = await body<{
    laneId?: string | null; originCountry?: string; destinationCountry?: string; mode?: string;
    what?: string; weightKg?: number; battery?: string; notes?: string;
  }>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const lane = input.laneId ? lanesOf(store as ForwarderProfile).find((row) => row.id === input.laneId) : undefined;
  const route = lane
    ? { laneId: lane.id, originCountry: lane.originCountry, destinationCountry: lane.destinationCountry, mode: lane.mode }
    : {
      laneId: null,
      originCountry: text(input.originCountry, 60),
      destinationCountry: text(input.destinationCountry, 60),
      mode: (MODES as readonly string[]).includes(input.mode ?? '') ? input.mode as FreightLane['mode'] : 'air',
    };
  if (!route.originCountry || !route.destinationCountry) return error(400, 'no_route', 'Say where it ships from and to.');
  const what = text(input.what, 1000);
  if (!what) return error(400, 'incomplete', 'Say what you are sending.');
  const account = await repository.getUserById(user.id);
  const now = new Date().toISOString();
  const name = account?.displayName ?? user.displayName;
  const quote: CustomQuote = {
    id: `qt_${randomUUID()}`, type: 'quote', storeId: key, kind, ownerId: owner.id,
    storeName: store.companyName, storeSlug: store.directorySlug, number: quoteNumber(),
    customerId: user.id, customerName: name, customerHandle: account?.username ?? null,
    route,
    ask: {
      what,
      weightKg: Math.round(Math.min(100_000, Math.max(0, Number(input.weightKg) || 0)) * 10) / 10 || null,
      battery: input.battery === 'loose' || input.battery === 'in_device' ? input.battery : 'none',
      notes: text(input.notes, 1000),
    },
    status: 'asked', offer: null,
    expiresAt: latestExpiry(),
    used: 0,
    history: [{ at: now, by: user.id, byName: name, note: 'Asked for a quote.' }],
    createdAt: now, updatedAt: now,
  };
  await repository.saveServiceWork(quote);
  await notify(repository, crewIds(owner, kind), {
    kind: 'service_store', title: `Quote asked ${quote.number} · ${laneLabel(route)}`,
    body: `${name}: ${what.slice(0, 120)}`, link: quoteConsoleLink(quote),
  }, { except: user.id });
  return json(201, quoteView(quote, 'customer', store));
}

/** GET /api/me/service-quotes - the quotes this person asked for, expired ones gone. */
async function myQuotes(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const rows = await liveQuotes(repository, await repository.listServiceQuotesFor(user.id));
  return json(200, { quotes: rows.map((quote) => ({ quote, usable: quoteIsUsable(quote) })) });
}

/** GET /api/service-stores/{kind}/{ownerId}/quotes - the team's list. */
async function storeQuotes(request: HttpRequest, _context: InvocationContext) {
  const found = await crewStore(request);
  if (found.refusal) return found.refusal;
  const rows = await liveQuotes(found.repository, await found.repository.listServiceWork<CustomQuote>(found.key, 'quote'));
  return json(200, { quotes: rows.map((quote) => ({ quote, usable: quoteIsUsable(quote) })) });
}

async function quoteFor(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const found = await storeAt(repository, request.params.kind, request.params.ownerId);
  if (!found) return { refusal: error(404, 'not_found', 'No such quote.') } as const;
  const quote = await repository.getServiceWork<CustomQuote>(found.key, request.params.id ?? '');
  if (!quote || quote.type !== 'quote') return { refusal: error(404, 'not_found', 'No such quote.') } as const;
  if (quoteIsExpired(quote)) {
    await repository.deleteServiceWork(found.key, quote.id);
    return { refusal: error(404, 'expired', 'That quote has expired and was deleted.') } as const;
  }
  const side: 'store' | 'customer' | null = rightsIn(found.owner, found.kind, user.id).includes('work') ? 'store'
    : quote.customerId === user.id ? 'customer' : null;
  if (!side) return { refusal: error(404, 'not_found', 'No such quote.') } as const;
  return { refusal: null, user, repository, quote, side, ...found } as const;
}

/** GET /api/service-quotes/{kind}/{ownerId}/{id} */
async function getQuote(request: HttpRequest, _context: InvocationContext) {
  const found = await quoteFor(request);
  if (found.refusal) return found.refusal;
  return json(200, quoteView(found.quote, found.side, found.store));
}

/**
 * POST /api/service-quotes/{kind}/{ownerId}/{id}/act
 *
 * The team: `offer` (price it, or change the price - the expiry is theirs to
 * set, at most three months out) or `decline`. The customer: `withdraw`,
 * which deletes it.
 */
async function actOnQuote(request: HttpRequest, _context: InvocationContext) {
  const found = await quoteFor(request);
  if (found.refusal) return found.refusal;
  const { quote, side, user, repository, store, key } = found;
  const input = await body<{
    action?: string; ratePerKgMinor?: number; minChargeKg?: number; transitDaysMin?: number; transitDaysMax?: number;
    batteries?: string; note?: string; expiresAt?: string; warehouses?: unknown;
  }>(request);
  const actor = await repository.getUserById(user.id);
  const byName = actor?.displayName ?? user.displayName;
  const now = new Date().toISOString();

  if (input?.action === 'withdraw') {
    if (side !== 'customer') return error(403, 'forbidden', 'Only who asked can withdraw it.');
    await repository.deleteServiceWork(key, quote.id);
    return json(200, { deleted: true });
  }
  if (side !== 'store') return error(403, 'forbidden', 'That needs the "work" right in this store.');
  if (input?.action === 'decline') {
    quote.status = 'declined';
    quote.history = [...quote.history, { at: now, by: user.id, byName, note: `Declined${input.note ? ` — ${text(input.note, 300)}` : ''}.` }];
  } else if (input?.action === 'offer') {
    const ratePerKgMinor = money(input.ratePerKgMinor);
    if (!ratePerKgMinor) return error(400, 'no_price', 'Give the rate per kg.');
    const minChargeKg = Math.max(0, Math.min(10_000, Number(input.minChargeKg) || 0));
    if (!minChargeKg) return error(400, 'no_min_kg', 'Give the minimum kg billed on this quote.');
    const expires = Date.parse(String(input.expiresAt ?? ''));
    if (!Number.isFinite(expires) || expires <= Date.now()) return error(400, 'no_expiry', 'Pick the date the quote expires.');
    // Never more than three months out: past that the block is deleted anyway.
    const expiresAt = new Date(Math.min(expires, Date.parse(latestExpiry()))).toISOString();
    const low = Math.max(0, Math.min(180, Math.round(Number(input.transitDaysMin) || 0)));
    quote.offer = {
      ratePerKgMinor,
      minChargeKg,
      transitDaysMin: low,
      transitDaysMax: Math.max(low, Math.min(180, Math.round(Number(input.transitDaysMax) || 0))),
      batteries: input.batteries === 'all' || input.batteries === 'in_device' ? input.batteries : 'none',
      note: text(input.note, 1000),
      warehouses: readWarehouses(input.warehouses),
      sentAt: now, sentByName: byName,
    };
    quote.status = 'quoted';
    quote.expiresAt = expiresAt;
    quote.history = [...quote.history, { at: now, by: user.id, byName, note: `Quoted ₹${(ratePerKgMinor / 100).toLocaleString('en-IN')}/kg until ${expiresAt.slice(0, 10)}.` }];
  } else {
    return error(400, 'invalid_action', 'Unknown move.');
  }
  quote.updatedAt = now;
  await repository.saveServiceWork(quote);
  await notify(repository, [quote.customerId], {
    kind: 'service_store',
    title: quote.status === 'quoted' ? `${store.companyName} quoted ${quote.number}` : `${store.companyName} declined ${quote.number}`,
    body: quote.status === 'quoted' && quote.offer
      ? `₹${(quote.offer.ratePerKgMinor / 100).toLocaleString('en-IN')}/kg · valid until ${new Date(quote.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
      : 'They cannot price this one.',
    link: quoteLink(quote),
  }, { except: user.id });
  return json(200, quoteView(quote, side, store));
}

export const askQuoteRoute = handler(askQuote);
export const myQuotesRoute = handler(myQuotes);
export const storeQuotesRoute = handler(storeQuotes);
export const quoteRoute = handler(getQuote);
export const quoteActRoute = handler(actOnQuote);

app.http('svc-quote-ask', { ...anon, methods: ['POST'], route: 'service-store/{kind}/{ownerId}/quotes', handler: askQuoteRoute });
app.http('svc-my-quotes', { ...anon, methods: ['GET'], route: 'me/service-quotes', handler: myQuotesRoute });
app.http('svc-store-quotes', { ...anon, methods: ['GET'], route: 'service-stores/{kind}/{ownerId}/quotes', handler: storeQuotesRoute });
app.http('svc-quote', { ...anon, methods: ['GET'], route: 'service-quotes/{kind}/{ownerId}/{id}', handler: quoteRoute });
app.http('svc-quote-act', { ...anon, methods: ['POST'], route: 'service-quotes/{kind}/{ownerId}/{id}/act', handler: quoteActRoute });
