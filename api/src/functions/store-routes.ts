import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import type {
  ArtistJob, ArtistOffering, ArtistProfile, ForwarderProfile, FreightLane, InsurancePlan, Lot, Order, OrderAddOn,
  PortfolioPiece, SellerPaymentDetails, StoreCore, StoreLink, StoreRight, StoreStatus, User,
} from '../../../shared/models.js';
import {
  ARTIST_JOB_MOVES, FREIGHT_MODES, STORE_KINDS, STORE_RIGHTS, STORE_ACCENTS, applicationGaps, coverIsOpen, goodsMinor,
  hasRight, insuranceQuote, isLive, jobActionsFor, jobIsLive, laneLabel, liveAddOns, liveLanes, liveOfferings,
  livePlans, memberEntry, partId, rightsIn, statusOf, storeOf, storeSlug, type ArtistJobAction, type StoreKind,
} from '../../../shared/service-stores.js';
import { CREW_CHECKPOINTS, supplierIdOf, type CrewRole } from '../../../shared/services.js';
import {
  currentStepOf, lotEndIndex, lotNo, lotNumberFrom, lotOffset, renderStepText, routeOf, stepButtonLabel, stepTickKey, ticksOf,
} from '../../../shared/routes.js';
import { isCancelledLike, protectionFeeMinor } from '../../../shared/orders.js';
import { marketSettings } from '../settings.js';
import { availableManagers, chargeFee, managerName, pickManager } from '../community.js';
import { orderMoney } from '../../../shared/payments.js';
import { can } from '../../../shared/stores.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { forwarderTookLot } from '../service-access.js';
import { ownedLot } from './fulfilment-routes.js';
import { gistOf } from '../../../shared/notifications.js';
import { notify, orderNames } from './notify.js';
import { error, handler, json } from './http.js';
import { audited } from '../audit.js';

/**
 * Service stores: applying for one, running one, and the people it serves.
 *
 * Four audiences meet here, and each route says which one it is for:
 *
 * - the person applying, and then running the store with their team;
 * - the operator who reads the application and opens the store;
 * - the shop booking a forwarder on a lot, or a buyer adding cover or
 *   commissioning an artist on their order;
 * - anyone browsing a store's public page.
 *
 * And the crew: whoever a lot names - supplier, handler, forwarder - gets the
 * lot's orders with exactly the buttons the shop's route handed them.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

const KIND_SET = new Set<string>(STORE_KINDS);
const isKind = (value: unknown): value is StoreKind => typeof value === 'string' && KIND_SET.has(value);

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
const count = (value: unknown, max = 365): number => {
  const amount = Math.round(Number(value));
  return Number.isFinite(amount) && amount > 0 ? Math.min(amount, max) : 0;
};
const url = (value: unknown): string | null => {
  const raw = text(value, 600);
  return /^(https?:\/\/|data:image\/)/i.test(raw) ? raw : null;
};

/** The team behind a store: the owner and every member who may do the work. */
function crewOf(owner: User, kind: StoreKind, right: StoreRight = 'work'): string[] {
  const store = storeOf(owner, kind);
  return [owner.id, ...(store?.team ?? []).filter((member) => rightsIn(owner, kind, member.userId).includes(right)).map((m) => m.userId)];
}

function storeCardOf(owner: User) {
  return {
    ownerId: owner.id,
    name: owner.sellerProfile?.storefrontName ?? owner.displayName,
    handle: owner.sellerProfile?.username ?? owner.username ?? null,
  };
}

/* ── Reading a store in from a form ──────────────────────────────────── */

interface StoreBody {
  kind?: StoreKind;
  companyName?: string; tagline?: string; description?: string;
  logoUrl?: string | null; coverUrl?: string | null; accent?: string;
  city?: string; country?: string; businessId?: string | null; since?: number | null;
  contactEmail?: string; contactPhone?: string; links?: StoreLink[];
  listedInDirectory?: boolean;
  payment?: SellerPaymentDetails | null;
  // Forwarder
  lanes?: Partial<FreightLane>[]; insurance?: Partial<InsurancePlan>[];
  warehouse?: { address?: string; contact?: string; hours?: string } | null;
  autoAccept?: boolean; claimedMonthlyCapacityKg?: number | null;
  // Artist
  specialties?: string[]; offerings?: Partial<ArtistOffering>[]; portfolio?: Partial<PortfolioPiece>[];
  acceptingWork?: boolean; studioAddress?: string;
}

function readLanes(input: unknown, previous: FreightLane[] = []): FreightLane[] {
  if (!Array.isArray(input)) return previous;
  return input.slice(0, 24).map((raw: Partial<FreightLane>) => ({
    id: text(raw.id, 40) || partId('lane'),
    originCity: text(raw.originCity, 60),
    originCountry: text(raw.originCountry, 60) || 'China',
    destinationCity: text(raw.destinationCity, 60),
    destinationCountry: text(raw.destinationCountry, 60) || 'India',
    mode: (FREIGHT_MODES as readonly string[]).includes(raw.mode as string) ? raw.mode as FreightLane['mode'] : 'air',
    ratePerKgMinor: money(raw.ratePerKgMinor),
    minChargeKg: Math.max(0, Math.min(10_000, Number(raw.minChargeKg) || 0)),
    transitDaysMin: count(raw.transitDaysMin, 180),
    transitDaysMax: count(raw.transitDaysMax, 180),
    customsIncluded: raw.customsIncluded === true,
    note: text(raw.note, 200),
    active: raw.active !== false,
  })).filter((lane) => lane.originCity || lane.destinationCity);
}

function readPlans(input: unknown, previous: InsurancePlan[] = []): InsurancePlan[] {
  if (!Array.isArray(input)) return previous;
  return input.slice(0, 8).map((raw: Partial<InsurancePlan>) => ({
    id: text(raw.id, 40) || partId('plan'),
    name: text(raw.name, 60) || 'Transit cover',
    coverPercent: Math.max(1, Math.min(100, Math.round(Number(raw.coverPercent) || 100))),
    premiumBasisPoints: Math.max(1, Math.min(3_000, Math.round(Number(raw.premiumBasisPoints) || 150))),
    minPremiumMinor: money(raw.minPremiumMinor),
    maxCoverMinor: money(raw.maxCoverMinor) || null,
    terms: text(raw.terms, 1200),
    active: raw.active !== false,
  }));
}

function readOfferings(input: unknown, previous: ArtistOffering[] = []): ArtistOffering[] {
  if (!Array.isArray(input)) return previous;
  return input.slice(0, 20).map((raw: Partial<ArtistOffering>) => ({
    id: text(raw.id, 40) || partId('svc'),
    name: text(raw.name, 60),
    description: text(raw.description, 400),
    priceFromMinor: money(raw.priceFromMinor),
    turnaroundDays: count(raw.turnaroundDays, 365),
    active: raw.active !== false,
  })).filter((offering) => offering.name);
}

function readPortfolio(input: unknown, previous: PortfolioPiece[] = []): PortfolioPiece[] {
  if (!Array.isArray(input)) return previous;
  return input.slice(0, 24).map((raw: Partial<PortfolioPiece>) => ({
    id: text(raw.id, 40) || partId('pic'),
    url: url(raw.url) ?? '',
    caption: text(raw.caption, 120),
  })).filter((piece) => piece.url);
}

function readLinks(input: unknown, previous: StoreLink[] = []): StoreLink[] {
  if (!Array.isArray(input)) return previous;
  return input.slice(0, 6).map((raw: Partial<StoreLink>) => ({
    label: text(raw.label, 40) || 'Link',
    url: url(raw.url) ?? '',
  })).filter((link) => link.url && !link.url.startsWith('data:'));
}

function readPayment(input: unknown, previous: SellerPaymentDetails | null | undefined): SellerPaymentDetails | null {
  if (input === undefined) return previous ?? null;
  if (!input || typeof input !== 'object') return null;
  const raw = input as SellerPaymentDetails;
  const payment = {
    upiId: text(raw.upiId, 80) || null,
    accountName: text(raw.accountName, 80) || null,
    accountNumber: text(raw.accountNumber, 40) || null,
    ifsc: text(raw.ifsc, 20) || null,
    instructions: text(raw.instructions, 300) || null,
  };
  return Object.values(payment).some(Boolean) ? payment : null;
}

/**
 * A store as the form describes it, laid over what is already there. One
 * reader for applying and for editing, so a field you can apply with is a
 * field you can correct afterwards.
 */
function mergeStore(kind: StoreKind, account: User, input: StoreBody): ForwarderProfile | ArtistProfile {
  const existing = storeOf(account, kind);
  const pick = <T,>(value: T | undefined, fallback: T): T => (value === undefined ? fallback : value);
  const name = text(input.companyName, 80) || existing?.companyName || account.displayName;
  const core: StoreCore = {
    companyName: name,
    directorySlug: existing?.directorySlug ?? storeSlug(name, account.id),
    description: input.description === undefined ? (existing?.description ?? '') : text(input.description, 2000),
    contactEmail: input.contactEmail === undefined ? (existing?.contactEmail ?? account.email ?? '') : text(input.contactEmail, 120),
    contactPhone: input.contactPhone === undefined ? (existing?.contactPhone ?? account.phone ?? '') : text(input.contactPhone, 40),
    trust: existing?.trust ?? { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null },
    listedInDirectory: pick(input.listedInDirectory, existing?.listedInDirectory ?? true) !== false,
    status: existing?.status,
    application: existing?.application ?? null,
    tagline: input.tagline === undefined ? (existing?.tagline ?? '') : text(input.tagline, 120),
    logoUrl: input.logoUrl === undefined ? (existing?.logoUrl ?? null) : url(input.logoUrl),
    coverUrl: input.coverUrl === undefined ? (existing?.coverUrl ?? null) : url(input.coverUrl),
    accent: (STORE_ACCENTS as readonly string[]).includes(input.accent ?? '') ? input.accent : (existing?.accent ?? (kind === 'artist' ? 'pink' : 'aqua')),
    city: input.city === undefined ? (existing?.city ?? '') : text(input.city, 60),
    country: input.country === undefined ? (existing?.country ?? '') : text(input.country, 60),
    businessId: input.businessId === undefined ? (existing?.businessId ?? null) : text(input.businessId, 60) || null,
    since: input.since === undefined ? (existing?.since ?? null)
      : (Number(input.since) >= 1950 && Number(input.since) <= 2100 ? Math.round(Number(input.since)) : null),
    links: readLinks(input.links, existing?.links ?? []),
    team: existing?.team ?? [],
    payment: readPayment(input.payment, existing?.payment),
  };

  if (kind === 'forwarder') {
    const previous = account.forwarderProfile;
    const lanes = readLanes(input.lanes, previous?.lanes ?? []);
    return {
      ...core,
      lanes,
      // The directory's old shape, kept in step with the priced lanes.
      routes: lanes.length > 0
        ? lanes.filter((lane) => lane.active).map((lane) => ({
          originCity: lane.originCity,
          destinationCity: lane.destinationCity,
          claimedTurnaroundDays: lane.transitDaysMax || lane.transitDaysMin,
          ratePerKgMinor: lane.ratePerKgMinor,
          currency: 'INR',
        }))
        : (previous?.routes ?? []),
      claimedMonthlyCapacityKg: input.claimedMonthlyCapacityKg === undefined
        ? (previous?.claimedMonthlyCapacityKg ?? null)
        : count(input.claimedMonthlyCapacityKg, 10_000_000) || null,
      insurance: readPlans(input.insurance, previous?.insurance ?? []),
      warehouse: input.warehouse === undefined ? (previous?.warehouse ?? null)
        : input.warehouse && text(input.warehouse.address, 400)
          ? { address: text(input.warehouse.address, 400), contact: text(input.warehouse.contact, 120), hours: text(input.warehouse.hours, 120) }
          : null,
      autoAccept: pick(input.autoAccept, previous?.autoAccept ?? true) === true,
    };
  }

  const previous = account.artistProfile;
  return {
    ...core,
    specialties: Array.isArray(input.specialties)
      ? [...new Set(input.specialties.map((tag) => text(tag, 30)).filter(Boolean))].slice(0, 12)
      : (previous?.specialties ?? []),
    offerings: readOfferings(input.offerings, previous?.offerings ?? []),
    portfolio: readPortfolio(input.portfolio, previous?.portfolio ?? []),
    acceptingWork: pick(input.acceptingWork, previous?.acceptingWork ?? true) !== false,
    studioAddress: input.studioAddress === undefined ? (previous?.studioAddress ?? '') : text(input.studioAddress, 400),
  };
}

function setStore(account: User, kind: StoreKind, store: ForwarderProfile | ArtistProfile): void {
  if (kind === 'forwarder') account.forwarderProfile = store as ForwarderProfile;
  else account.artistProfile = store as ArtistProfile;
}

/* ── Applying ────────────────────────────────────────────────────────── */

/**
 * POST /api/me/services/apply - send a store for review, or send it back.
 *
 * Anyone can apply; nothing is listed or bookable until an operator approves
 * it. A live store is edited from its console instead - applying again would
 * take it off the directory while somebody re-reads what they already passed.
 */
async function apply(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const input = await body<StoreBody>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  if (!isKind(input.kind)) return error(400, 'invalid_kind', 'Apply for a forwarding company or an artist studio.');
  const kind = input.kind;

  const repository = await getRepository();
  const account = await repository.getUserById(user.id);
  if (!account) return error(404, 'not_found', 'No such account.');

  const status = statusOf(storeOf(account, kind));
  if (status === 'approved') return error(409, 'already_live', 'Your store is live. Edit it from its console.');
  if (status === 'suspended') return error(409, 'suspended', 'This store is suspended. Message Figmark to talk about it.');

  const store = mergeStore(kind, account, input);
  const gaps = applicationGaps(kind, store);
  if (gaps.length > 0) return error(400, 'incomplete', `Still needed: ${gaps.join(', ')}.`);

  const now = new Date().toISOString();
  store.status = 'pending';
  store.application = {
    submittedAt: now,
    history: [
      ...(store.application?.history ?? []),
      { at: now, by: user.id, status: 'pending', note: status ? 'Sent back for review.' : 'Application sent.' },
    ],
  };
  setStore(account, kind, store);
  account.updatedAt = now;
  const saved = await repository.updateUser(account);
  return json(200, { kind, store: storeOf(saved, kind) });
}

/* ── Running one ─────────────────────────────────────────────────────── */

async function storeFor(request: HttpRequest, right: StoreRight | null, fixedKind?: StoreKind) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const kind = fixedKind ?? request.params.kind;
  const ownerId = request.params.ownerId;
  if (!isKind(kind) || !ownerId) return { refusal: error(404, 'not_found', 'No such store.') } as const;
  const repository = await getRepository();
  const owner = await repository.getUserById(ownerId);
  const store = owner ? storeOf(owner, kind) : null;
  if (!owner || !store) return { refusal: error(404, 'not_found', 'No such store.') } as const;
  const rights = rightsIn(owner, kind, user.id);
  if (rights.length === 0 || (right && !rights.includes(right))) {
    return { refusal: error(403, 'forbidden', right ? `That needs the "${right}" right in this store.` : 'You do not work in this store.') } as const;
  }
  return { refusal: null, user, kind, owner, store, rights, repository } as const;
}

function consoleView(owner: User, kind: StoreKind, viewerId: string) {
  const store = storeOf(owner, kind)!;
  return {
    kind,
    ownerId: owner.id,
    ownerName: owner.displayName,
    handle: owner.username ?? null,
    isOwner: owner.id === viewerId,
    rights: rightsIn(owner, kind, viewerId),
    status: statusOf(store),
    store,
  };
}

/** GET /api/service-stores/{kind}/{ownerId} - the store, as its team sees it. */
async function storeConsole(request: HttpRequest, _context: InvocationContext) {
  const found = await storeFor(request, null);
  if (found.refusal) return found.refusal;
  return json(200, consoleView(found.owner, found.kind, found.user.id));
}

/**
 * POST /api/service-stores/{kind}/{ownerId}/save - edit the store.
 *
 * A live store stays live through an edit: rates move every month, and making
 * a forwarder wait on review to change a price would make the prices lie.
 * What an operator approved was the business, not this week's rate card.
 */
async function saveStore(request: HttpRequest, _context: InvocationContext) {
  const found = await storeFor(request, 'store');
  if (found.refusal) return found.refusal;
  const input = await body<StoreBody>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const { owner, kind, repository, user } = found;

  const store = mergeStore(kind, owner, input);
  if (isLive(store)) {
    const gaps = applicationGaps(kind, store);
    if (gaps.length > 0) return error(400, 'incomplete', `A live store needs: ${gaps.join(', ')}.`);
  }
  setStore(owner, kind, store);
  owner.updatedAt = new Date().toISOString();
  const saved = await repository.updateUser(owner);
  return json(200, consoleView(saved, kind, user.id));
}

/** POST /api/service-stores/{kind}/{ownerId}/team - add, change or remove a member. */
async function storeTeam(request: HttpRequest, _context: InvocationContext) {
  const found = await storeFor(request, 'team');
  if (found.refusal) return found.refusal;
  const input = await body<{ identifier?: string; rights?: StoreRight[]; remove?: string }>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const { owner, kind, repository, user } = found;
  const store = storeOf(owner, kind)!;
  const team = store.team ?? [];

  if (input.remove) {
    store.team = team.filter((member) => member.userId !== input.remove);
  } else {
    const identifier = text(input.identifier, 120).replace(/^@/, '');
    if (!identifier) return error(400, 'invalid_member', 'Name the person by @handle, email or phone.');
    const member = (await repository.getUserByIdentifier(identifier))
      ?? (await repository.getByHandle(identifier.toLowerCase()))?.user
      ?? null;
    if (!member) return error(404, 'no_such_person', 'Nobody here goes by that.');
    if (member.id === owner.id) return error(400, 'is_owner', 'The owner already holds every right.');
    const rights = (input.rights ?? []).filter((right) => (STORE_RIGHTS as readonly string[]).includes(right));
    if (rights.length === 0) return error(400, 'no_rights', 'Pick at least one thing they may do.');
    const entry = memberEntry(member.id, member.displayName, rights, user.id);
    const existing = team.find((row) => row.userId === member.id);
    store.team = existing
      ? team.map((row) => (row.userId === member.id ? { ...entry, addedAt: row.addedAt, addedBy: row.addedBy } : row))
      : [...team, entry];
    if (!existing) {
      await notify(repository, [member.id], {
        kind: 'service_store',
        title: `You were added to ${store.companyName}`,
        body: 'It is under My services now.',
        link: '/services/mine',
      });
    }
  }
  owner.updatedAt = new Date().toISOString();
  const saved = await repository.updateUser(owner);
  return json(200, consoleView(saved, kind, user.id));
}

/* ── The work ────────────────────────────────────────────────────────── */

/** Every lot, in every shop, that books this forwarder. */
async function lotsBooking(repository: Repo, forwarderId: string): Promise<{ owner: User; lot: Lot }[]> {
  const rows: { owner: User; lot: Lot }[] = [];
  for (const owner of await repository.listStoreOwners()) {
    for (const lot of await repository.listLots({ sellerId: owner.id })) {
      if (lot.forwarder?.forwarderUserId === forwarderId) rows.push({ owner, lot });
    }
  }
  return rows;
}

/** A lot's own countries, for the `{origin}`/`{destination}` in its step names. */
const placesOf = (lot: Lot) => ({ origin: lot.originCountry ?? null, destination: lot.destinationCountry ?? null });

function lotRef(lot: Lot) {
  const route = routeOf(lot);
  const at = currentStepOf(lot);
  return {
    id: lot.id,
    sellerId: lot.sellerId,
    name: lot.name,
    number: lotNo(lot.lotNumber ?? lotNumberFrom(lot.id, lot.createdAt)),
    stage: lot.stage,
    status: lot.status,
    origin: lot.origin ?? '',
    step: renderStepText(route.steps[at]?.name ?? '', placesOf(lot)),
    stepIndex: at,
    steps: route.steps.length,
  };
}

/**
 * GET /api/service-stores/{kind}/{ownerId}/work - what the store has on.
 *
 * A forwarder's is lots: weight and pieces, the lane, the cover its buyers
 * took - and never prices, which are the shop's business. An artist's is
 * commissions: the piece, the brief, and where the money is.
 */
async function storeWork(request: HttpRequest, _context: InvocationContext) {
  const found = await storeFor(request, 'work');
  if (found.refusal) return found.refusal;
  const { owner, kind, repository } = found;

  if (kind === 'forwarder') {
    const rows = await Promise.all((await lotsBooking(repository, owner.id)).map(async ({ owner: shop, lot }) => {
      const orders = (await repository.listOrdersForLot(lot.id)).filter((order) => !isCancelledLike(order.status));
      const covered = orders.filter((order) => liveAddOns(order).some((addOn) => addOn.providerId === owner.id));
      return {
        store: storeCardOf(shop),
        lot: lotRef(lot),
        laneLabel: lot.forwarder?.laneLabel ?? null,
        acceptance: lot.forwarder?.acceptance ?? 'accepted',
        trackingReference: lot.forwarder?.trackingReference ?? null,
        pieces: orders.reduce((sum, order) => sum + order.quantity, 0),
        weightGrams: orders.reduce((sum, order) => sum + order.quantity * order.unitWeightGrams, 0),
        covered: covered.length,
        premiumsMinor: covered.reduce((sum, order) =>
          sum + liveAddOns(order).filter((addOn) => addOn.providerId === owner.id).reduce((s, a) => s + a.premiumMinor, 0), 0),
        coverMinor: covered.reduce((sum, order) =>
          sum + liveAddOns(order).filter((addOn) => addOn.providerId === owner.id).reduce((s, a) => s + a.coverMinor, 0), 0),
      };
    }));
    rows.sort((a, b) => (a.acceptance === 'pending' ? -1 : 0) - (b.acceptance === 'pending' ? -1 : 0));
    return json(200, { kind, lots: rows, jobs: [] });
  }

  const orders = await repository.listOrdersCommissionedFrom(owner.id);
  const people = await repository.listUsersByIds([...new Set(orders.flatMap((order) => [order.buyerId, order.sellerId]))]);
  const byId = new Map(people.map((person) => [person.id, person]));
  return json(200, {
    kind,
    lots: [],
    jobs: orders.map((order) => jobRow(order, byId)),
  });
}

function jobRow(order: Order, people: Map<string, User>) {
  const buyer = people.get(order.buyerId);
  const seller = people.get(order.sellerId);
  return {
    orderId: order.id,
    item: { name: order.itemName, condition: order.condition, quantity: order.quantity },
    buyer: { name: buyer?.displayName ?? 'A buyer', handle: buyer?.username ?? null },
    shop: seller ? storeCardOf(seller) : null,
    job: order.artistJob!,
    actions: jobActionsFor(order.artistJob!, 'artist'),
  };
}

/** POST /api/service-stores/forwarder/{ownerId}/respond - take a lot, or turn it down. */
async function respondToLot(request: HttpRequest, _context: InvocationContext) {
  const found = await storeFor(request, 'work', 'forwarder');
  if (found.refusal) return found.refusal;
  const input = await body<{ sellerId?: string; lotId?: string; accept?: boolean }>(request);
  if (!input?.sellerId || !input.lotId) return error(400, 'invalid_lot', 'Name the lot.');
  const { owner, repository, user } = found;
  const lot = await repository.getLot(input.sellerId, input.lotId);
  if (!lot || lot.forwarder?.forwarderUserId !== owner.id) return error(404, 'not_found', 'That lot does not book you.');

  const now = new Date().toISOString();
  lot.forwarder = { ...lot.forwarder, acceptance: input.accept === false ? 'declined' : 'accepted', respondedAt: now, respondedBy: user.id };
  lot.updatedAt = now;
  await repository.updateLot(lot);
  await notify(repository, [lot.sellerId], {
    kind: 'service_store',
    title: input.accept === false ? `${owner.forwarderProfile!.companyName} turned down ${lot.name}` : `${owner.forwarderProfile!.companyName} took ${lot.name}`,
    body: input.accept === false ? 'Pick another forwarder on the lot.' : 'They can work the lot now.',
    link: `/lot/${encodeURIComponent(lot.id)}`,
  });
  return json(200, { lot: lotRef(lot), acceptance: lot.forwarder.acceptance });
}

/* ── Artist, working a commission ────────────────────────────────────── */

function jobEvent(job: ArtistJob, by: string, note: string): void {
  const now = new Date().toISOString();
  job.history = [...job.history, { at: now, by, status: job.status, note }];
  job.updatedAt = now;
}

/** POST /api/service-stores/artist/{ownerId}/jobs/{orderId} - the artist's side of a commission. */
async function artistAct(request: HttpRequest, _context: InvocationContext) {
  const found = await storeFor(request, 'work', 'artist');
  if (found.refusal) return found.refusal;
  const { owner, repository, user } = found;
  const input = await body<{ action?: ArtistJobAction; quoteMinor?: number; days?: number; note?: string; photos?: string[]; courier?: string; awb?: string }>(request);
  if (!input?.action || !(input.action in ARTIST_JOB_MOVES)) return error(400, 'invalid_action', 'Say what to do.');

  const order = await repository.getOrder(request.params.orderId ?? '');
  const job = order?.artistJob;
  if (!order || !job || job.artistId !== owner.id) return error(404, 'not_found', 'No such commission.');
  if (!jobActionsFor(job, 'artist').includes(input.action)) return error(409, 'not_now', 'That is not a move this commission can make now.');

  const note = text(input.note, 600);
  switch (input.action) {
    case 'quote': {
      const price = money(input.quoteMinor);
      if (!price) return error(400, 'invalid_quote', 'Quote a price.');
      job.quoteMinor = price;
      job.turnaroundDays = count(input.days) || job.turnaroundDays;
      job.quoteNote = note;
      job.status = 'quoted';
      jobEvent(job, user.id, `Quoted ${(price / 100).toLocaleString('en-IN')} rupees${job.turnaroundDays ? `, ${job.turnaroundDays} days` : ''}.`);
      break;
    }
    case 'decline':
      job.status = 'declined';
      jobEvent(job, user.id, note || 'The artist cannot take this one.');
      break;
    case 'confirm_payment':
      job.payments = job.payments.map((payment) => payment.confirmedAt ? payment : { ...payment, confirmedAt: new Date().toISOString() });
      job.status = 'paid';
      jobEvent(job, user.id, 'Payment received.');
      break;
    case 'start':
      job.status = 'working';
      jobEvent(job, user.id, note || 'Work started.');
      break;
    case 'ready': {
      const photos = (input.photos ?? []).map((value) => url(value)).filter((value): value is string => Boolean(value)).slice(0, 8);
      job.photos = photos.length ? photos : job.photos;
      job.status = 'ready';
      jobEvent(job, user.id, note || 'Finished.');
      break;
    }
    case 'ship':
      job.shipment = { courier: text(input.courier, 80), awb: text(input.awb, 80), at: new Date().toISOString() };
      job.status = 'shipped';
      jobEvent(job, user.id, [job.shipment.courier && `Courier: ${job.shipment.courier}`, job.shipment.awb && `AWB ${job.shipment.awb}`].filter(Boolean).join(' · ') || 'Sent back.');
      break;
    default:
      return error(409, 'not_yours', 'That move is the buyer’s.');
  }
  order.artistJob = job;
  order.updatedAt = job.updatedAt;
  await repository.updateOrder(order);
  await notify(repository, [order.buyerId], {
    kind: 'commission',
    title: `${job.artistName}: ${job.history[job.history.length - 1]!.note}`,
    body: order.itemName,
    link: `/order/${encodeURIComponent(order.id)}`,
  });
  const people = await repository.listUsersByIds([order.buyerId, order.sellerId]);
  return json(200, jobRow(order, new Map(people.map((person) => [person.id, person]))));
}

/* ── The public page ─────────────────────────────────────────────────── */

function publicStore(owner: User, kind: StoreKind) {
  const store = storeOf(owner, kind)!;
  const base = {
    kind,
    ownerId: owner.id,
    handle: owner.username ?? null,
    name: store.companyName,
    slug: store.directorySlug,
    tagline: store.tagline ?? '',
    about: store.description,
    logoUrl: store.logoUrl ?? null,
    coverUrl: store.coverUrl ?? null,
    accent: store.accent ?? (kind === 'artist' ? 'pink' : 'aqua'),
    city: store.city ?? '',
    country: store.country ?? '',
    registered: Boolean(store.businessId),
    since: store.since ?? null,
    links: store.links ?? [],
    contactEmail: store.contactEmail || null,
    contactPhone: store.contactPhone || null,
    trust: store.trust,
    teamSize: 1 + (store.team?.length ?? 0),
    status: statusOf(store),
  };
  if (kind === 'forwarder') {
    const profile = owner.forwarderProfile!;
    return {
      ...base,
      lanes: profile.lanes ? liveLanes(profile) : profile.routes.map((route, index): FreightLane => ({
        id: `route_${index}`, originCity: route.originCity, originCountry: 'China', destinationCity: route.destinationCity,
        destinationCountry: 'India', mode: 'air', ratePerKgMinor: route.ratePerKgMinor, minChargeKg: 0,
        transitDaysMin: route.claimedTurnaroundDays, transitDaysMax: route.claimedTurnaroundDays, customsIncluded: false,
        note: '', active: true,
      })),
      insurance: livePlans(profile),
      warehouse: profile.warehouse ?? null,
      autoAccept: profile.autoAccept ?? true,
      capacityKg: profile.claimedMonthlyCapacityKg,
      offerings: [], portfolio: [], specialties: [], acceptingWork: false,
    };
  }
  const profile = owner.artistProfile!;
  return {
    ...base,
    lanes: [], insurance: [], warehouse: null, autoAccept: false, capacityKg: null,
    offerings: liveOfferings(profile),
    portfolio: profile.portfolio ?? [],
    specialties: profile.specialties ?? [],
    acceptingWork: profile.acceptingWork !== false,
  };
}

/** GET /api/service-store/{kind}/{slug} - the store's own page. */
async function storePage(request: HttpRequest, _context: InvocationContext) {
  const kind = request.params.kind;
  const slug = request.params.slug;
  if (!isKind(kind) || !slug) return error(404, 'not_found', 'No such store.');
  const repository = await getRepository();
  const owner = (await repository.listAllUsers()).find((user) => storeOf(user, kind)?.directorySlug === slug);
  if (!owner) return error(404, 'not_found', 'No such store.');

  // Not live yet: only its own team (previewing) and operators may look.
  if (!isLive(storeOf(owner, kind)) || owner.suspended) {
    const auth = await getAuthService();
    const viewer = await auth.getCurrentUser(request);
    if (!viewer || (rightsIn(owner, kind, viewer.id).length === 0 && !viewer.capabilities.isAdmin)) {
      return error(404, 'not_found', 'No such store.');
    }
  }
  const lotsCarried = kind === 'forwarder' ? (await lotsBooking(repository, owner.id)).filter(({ lot }) => forwarderTookLot(lot)).length : 0;
  const commissions = kind === 'artist' ? (await repository.listOrdersCommissionedFrom(owner.id)).filter((o) => o.artistJob?.status === 'completed').length : 0;
  return json(200, { store: publicStore(owner, kind), stats: { lotsCarried, commissions } });
}

/** Every live store of one kind, for the directory. */
export async function liveStores(repository: Repo, kind: StoreKind): Promise<User[]> {
  const users = kind === 'forwarder' ? await repository.listForwarders() : await repository.listAllUsers();
  return users.filter((user) => {
    const store = storeOf(user, kind);
    return store && store.listedInDirectory && isLive(store) && !user.suspended;
  });
}

/* ── A shop booking a forwarder ──────────────────────────────────────── */

/** GET /api/lots/{id}/forwarders - the stores this lot could book, priced for it. */
async function lotForwarderOptions(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot } = await ownedLot(request, id);
  const repository = await getRepository();
  const orders = (await repository.listOrdersForLot(lot.id)).filter((order) => !isCancelledLike(order.status));
  const weightGrams = orders.reduce((sum, order) => sum + order.quantity * order.unitWeightGrams, 0);
  const stores = (await liveStores(repository, 'forwarder')).map((owner) => publicStore(owner, 'forwarder'));
  return json(200, { weightGrams, current: lot.forwarder ?? null, stores });
}

/**
 * POST /api/lots/{id}/forwarder-store - book a forwarder's store on this lot.
 *
 * Instant: the shop picks and the lot is booked. A store on auto-accept takes
 * it there and then; any other gets it as a request it accepts or declines,
 * and its team cannot work the lot until it does.
 */
async function bookForwarder(request: HttpRequest, _context: InvocationContext) {
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'A lot id is required.');
  const { lot, userId } = await ownedLot(request, id);
  const input = await body<{ storeOwnerId?: string | null; laneId?: string | null; insurancePlanIds?: string[]; trackingReference?: string }>(request);
  if (!input) return error(400, 'invalid_body', 'Request body must be JSON.');
  const repository = await getRepository();
  const now = new Date().toISOString();

  if (!input.storeOwnerId) {
    // Unbooking a store leaves a typed-in name, so the lot's history still
    // says who moved it; cover already bought stays on the orders.
    lot.forwarder = lot.forwarder ? { ...lot.forwarder, forwarderUserId: null, acceptance: undefined, insurancePlanIds: [] } : null;
    lot.updatedAt = now;
    return json(200, { lot: await repository.updateLot(lot) });
  }

  const owner = await repository.getUserById(input.storeOwnerId);
  const profile = owner?.forwarderProfile;
  if (!owner || !profile || !isLive(profile) || owner.suspended) return error(404, 'not_found', 'That forwarder is not taking bookings.');
  const lane = input.laneId ? liveLanes(profile).find((row) => row.id === input.laneId) : null;
  if (input.laneId && !lane) return error(400, 'invalid_lane', 'That lane is not on offer.');
  const planIds = (input.insurancePlanIds ?? []).filter((planId) => livePlans(profile).some((plan) => plan.id === planId));

  const same = lot.forwarder?.forwarderUserId === owner.id;
  lot.forwarder = {
    forwarderUserId: owner.id,
    name: profile.companyName,
    contact: profile.contactEmail || profile.contactPhone || null,
    trackingReference: input.trackingReference === undefined ? (lot.forwarder?.trackingReference ?? null) : text(input.trackingReference, 80) || null,
    laneId: lane?.id ?? null,
    laneLabel: lane ? `${laneLabel(lane)} · ${lane.mode}` : null,
    acceptance: same && lot.forwarder?.acceptance ? lot.forwarder.acceptance : profile.autoAccept === false ? 'pending' : 'accepted',
    respondedAt: same ? (lot.forwarder?.respondedAt ?? null) : profile.autoAccept === false ? null : now,
    respondedBy: same ? (lot.forwarder?.respondedBy ?? null) : null,
    insurancePlanIds: planIds,
  };
  lot.updatedAt = now;
  const saved = await repository.updateLot(lot);

  if (!same) {
    const shop = await repository.getUserById(lot.sellerId);
    await notify(repository, crewOf(owner, 'forwarder'), {
      kind: 'service_store',
      title: saved.forwarder?.acceptance === 'pending'
        ? `${shop?.sellerProfile?.storefrontName ?? 'A shop'} wants you on ${lot.name}`
        : `${shop?.sellerProfile?.storefrontName ?? 'A shop'} booked you on ${lot.name}`,
      body: lane ? laneLabel(lane) : 'Open it to see the weight and pieces.',
      link: `/services/store/forwarder/${owner.id}`,
    }, { except: userId });
  }
  return json(200, { lot: saved });
}

/* ── A buyer's extras ────────────────────────────────────────────────── */

async function orderParty(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const order = await repository.getOrder(request.params.id ?? '');
  if (!order) return { refusal: error(404, 'not_found', 'No such order.') } as const;
  const owner = order.sellerId === user.id ? null : await repository.getUserById(order.sellerId);
  const side: 'buyer' | 'seller' | null = order.buyerId === user.id ? 'buyer'
    : order.sellerId === user.id || (owner && can(owner, user.id, 'lots')) ? 'seller' : null;
  if (!side) return { refusal: error(403, 'forbidden', 'That order is not yours.') } as const;
  return { refusal: null, user, order, side, repository } as const;
}

async function lotOf(repository: Repo, order: Order): Promise<Lot | null> {
  if (!order.lotId || order.lotId.startsWith('__')) return null;
  return repository.getLot(order.sellerId, order.lotId);
}

/**
 * GET /api/orders/{id}/services - what can be added to this item, and what has.
 *
 * Cover comes from the forwarder booked on the item's lot, and only the plans
 * the shop chose to offer. Artists are every live studio taking work. The
 * shop sees the same, read-only - and, once a commission is paid, where the
 * piece has to go.
 */
async function orderServices(request: HttpRequest, _context: InvocationContext) {
  const found = await orderParty(request);
  if (found.refusal) return found.refusal;
  const { order, side, repository, user } = found;

  const lot = await lotOf(repository, order);
  const forwarder = lot?.forwarder?.forwarderUserId ? await repository.getUserById(lot.forwarder.forwarderUserId) : null;
  const offered = new Set(lot?.forwarder?.insurancePlanIds ?? []);
  const plans = forwarder && isLive(forwarder.forwarderProfile) && forwarderTookLot(lot!)
    ? livePlans(forwarder.forwarderProfile).filter((plan) => offered.has(plan.id))
    : [];
  const value = goodsMinor(order);
  const current = liveAddOns(order).find((addOn) => addOn.kind === 'insurance') ?? null;

  const job = order.artistJob ?? null;
  const artistOwner = job ? await repository.getUserById(job.artistId) : null;
  const artists = side === 'buyer' && !jobIsLive(job)
    ? (await liveStores(repository, 'artist'))
      .filter((owner) => owner.artistProfile?.acceptingWork !== false && owner.id !== user.id && owner.id !== order.sellerId)
      .map((owner) => publicStore(owner, 'artist'))
    : [];
  const protectionFlat = (await marketSettings(repository)).protectionFeeMinor;
  // Buyer Protection on a commission: Figmark holds the payment and a
  // community manager is assigned to it, for this fee. Null when no manager
  // could be - neither the buyer nor the artist, and available.
  const protectionFee = side === 'buyer' && job && ['quoted', 'accepted'].includes(job.status)
    && (await availableManagers(repository, [order.buyerId, job.artistId])).length > 0
    ? protectionFeeMinor(job.quoteMinor ?? 0, protectionFlat)
    : null;
  const paidUp = job && ['paid', 'working', 'ready', 'shipped', 'completed'].includes(job.status);

  return json(200, {
    side,
    insurance: {
      open: coverIsOpen(order) && side === 'buyer',
      provider: forwarder?.forwarderProfile && plans.length > 0
        ? { ownerId: forwarder.id, name: forwarder.forwarderProfile.companyName, slug: forwarder.forwarderProfile.directorySlug }
        : null,
      valueMinor: value,
      plans: plans.map((plan) => ({ ...plan, ...insuranceQuote(plan, value) })),
      current,
    },
    commission: {
      job,
      actions: job ? jobActionsFor(job, 'buyer') : [],
      artist: artistOwner?.artistProfile ? publicStore(artistOwner, 'artist') : null,
      artistPayment: side === 'buyer' && job?.status === 'accepted' ? artistOwner?.artistProfile?.payment ?? null : null,
      // Where the piece goes, for whoever ships it - only once it is paid for.
      studioAddress: paidUp ? artistOwner?.artistProfile?.studioAddress ?? null : null,
      artists,
      protectionFeeMinor: protectionFee,
    },
  });
}

/** POST /api/orders/{id}/insurance - add transit cover, change it, or take it off. */
async function setInsurance(request: HttpRequest, _context: InvocationContext) {
  const found = await orderParty(request);
  if (found.refusal) return found.refusal;
  const { order, side, repository, user } = found;
  if (side !== 'buyer') return error(403, 'forbidden', 'Only the buyer chooses cover.');
  if (!coverIsOpen(order)) return error(409, 'cover_closed', 'Cover can only be changed before the item leaves the origin warehouse.');
  const input = await body<{ planId?: string | null }>(request);

  const now = new Date().toISOString();
  const kept = (order.addOns ?? []).map((addOn) =>
    addOn.kind === 'insurance' && !addOn.removedAt ? { ...addOn, removedAt: now } : addOn);

  let added: OrderAddOn | null = null;
  if (input?.planId) {
    const lot = await lotOf(repository, order);
    const forwarder = lot?.forwarder?.forwarderUserId ? await repository.getUserById(lot.forwarder.forwarderUserId) : null;
    const plan = forwarder && isLive(forwarder.forwarderProfile) && lot && forwarderTookLot(lot)
      && (lot.forwarder?.insurancePlanIds ?? []).includes(input.planId)
      ? livePlans(forwarder.forwarderProfile).find((row) => row.id === input.planId) : null;
    if (!plan || !forwarder) return error(404, 'no_such_plan', 'That cover is not offered on this item.');
    const quote = insuranceQuote(plan, goodsMinor(order));
    added = {
      id: `add_${randomUUID().slice(0, 10)}`,
      kind: 'insurance',
      providerId: forwarder.id,
      providerName: forwarder.forwarderProfile!.companyName,
      planId: plan.id,
      planName: plan.name,
      valueMinor: goodsMinor(order),
      coverMinor: quote.coverMinor,
      premiumMinor: quote.premiumMinor,
      terms: plan.terms,
      addedAt: now,
      addedBy: user.id,
      removedAt: null,
    };
  }
  order.addOns = added ? [...kept, added] : kept;
  order.stageHistory = [...order.stageHistory, {
    stage: order.stage, enteredAt: now, recordedBy: user.id,
    note: added ? `🛡 Transit cover added — ${added.planName} by ${added.providerName}.` : '🛡 Transit cover removed.',
  }];
  // Paid in full before is partly paid now, when cover adds to the total -
  // and the balance is paid the way any balance is.
  if (order.paymentStatus !== 'claimed' && (order.payments ?? []).length > 0) {
    const money = orderMoney(order);
    order.paymentStatus = money.outstandingMinor === 0 ? 'paid' : money.paidMinor > 0 ? 'partially_paid' : 'unpaid';
  }
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);
  return json(200, { order: saved });
}

/** POST /api/orders/{id}/commission - ask an artist to work on this item. */
async function commission(request: HttpRequest, _context: InvocationContext) {
  const found = await orderParty(request);
  if (found.refusal) return found.refusal;
  const { order, side, repository, user } = found;
  if (side !== 'buyer') return error(403, 'forbidden', 'Only the buyer commissions work on an item.');
  if (jobIsLive(order.artistJob)) return error(409, 'already', 'This item already has a commission running.');
  if (['cancelled', 'refunded', 'rejected'].includes(order.status) || isCancelledLike(order.status)) {
    return error(409, 'order_stopped', 'This order was called off.');
  }
  const input = await body<{ artistId?: string; offeringId?: string | null; brief?: string; refUrls?: string[] }>(request);
  if (!input?.artistId) return error(400, 'no_artist', 'Pick an artist.');
  const brief = text(input.brief, 2000);
  if (brief.length < 10) return error(400, 'no_brief', 'Tell the artist what you want, in a sentence or two.');

  const artist = await repository.getUserById(input.artistId);
  const profile = artist?.artistProfile;
  if (!artist || !profile || !isLive(profile) || artist.suspended || profile.acceptingWork === false) {
    return error(404, 'not_taking_work', 'That artist is not taking commissions right now.');
  }
  if (artist.id === user.id) return error(400, 'own_studio', 'You cannot commission your own studio.');
  const offering = input.offeringId ? liveOfferings(profile).find((row) => row.id === input.offeringId) ?? null : null;

  const now = new Date().toISOString();
  const job: ArtistJob = {
    id: `job_${randomUUID().slice(0, 10)}`,
    artistId: artist.id,
    artistName: profile.companyName,
    offeringId: offering?.id ?? null,
    offeringName: offering?.name ?? 'Custom work',
    brief,
    refUrls: (input.refUrls ?? []).map((value) => url(value)).filter((value): value is string => Boolean(value)).slice(0, 6),
    status: 'requested',
    quoteMinor: null,
    quoteNote: '',
    turnaroundDays: offering?.turnaroundDays || null,
    method: null,
    protectionFeeMinor: 0,
    payments: [],
    heldMinor: 0,
    releasedAt: null,
    photos: [],
    shipment: null,
    history: [{ at: now, by: user.id, status: 'requested', note: 'Commission requested.' }],
    createdAt: now,
    updatedAt: now,
  };
  order.artistJob = job;
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);
  const named = await orderNames(repository, order);
  await notify(repository, crewOf(artist, 'artist'), {
    kind: 'commission',
    title: `${named.buyer} commissioned ${gistOf(offering?.name, 'custom work', 40)}`,
    body: order.itemName,
    link: `/services/store/artist/${artist.id}`,
  });
  return json(200, { order: saved });
}

/** POST /api/orders/{id}/commission/act - the buyer's side of a commission. */
async function commissionAct(request: HttpRequest, _context: InvocationContext) {
  const found = await orderParty(request);
  if (found.refusal) return found.refusal;
  const { order, side, repository, user } = found;
  if (side !== 'buyer') return error(403, 'forbidden', 'Only the buyer moves their commission.');
  const job = order.artistJob;
  if (!job) return error(404, 'not_found', 'No commission on this item.');
  const input = await body<{ action?: ArtistJobAction; method?: 'protected' | 'direct'; reference?: string }>(request);
  const action = input?.action;
  if (!action || !jobActionsFor(job, 'buyer').includes(action)) return error(409, 'not_now', 'That is not a move this commission can make now.');

  const now = new Date().toISOString();
  switch (action) {
    case 'accept':
      job.status = 'accepted';
      jobEvent(job, user.id, 'Quote accepted.');
      break;
    case 'cancel':
      if (job.payments.length > 0) return error(409, 'paid', 'Money has moved on this one - ask the artist, or open a dispute on the order.');
      job.status = 'cancelled';
      jobEvent(job, user.id, 'Cancelled by the buyer.');
      break;
    case 'pay': {
      const price = job.quoteMinor ?? 0;
      if (!price) return error(409, 'no_quote', 'There is no agreed price yet.');
      if (input?.method === 'protected') {
        // Figmark holds the payment; the system assigns a community manager,
        // who is paid a share of the fee Figmark sets centrally.
        const manager = await pickManager(repository, [order.buyerId, job.artistId]);
        if (!manager) return error(409, 'protection_unavailable', 'No community manager is available for Buyer Protection right now. Try again soon, or pay direct.');
        const settings = await marketSettings(repository);
        job.method = 'protected';
        job.managerId = manager.id;
        job.managerName = managerName(manager);
        job.protectionFeeMinor = protectionFeeMinor(price, settings.protectionFeeMinor);
        await chargeFee(repository, {
          kind: 'protection', payerId: user.id, amountMinor: job.protectionFeeMinor, currency: order.currency,
          reference: order.id, managerId: manager.id,
        }, settings);
        job.heldMinor = price + job.protectionFeeMinor;
        job.payments = [...job.payments, { at: now, amountMinor: job.heldMinor, method: 'protected', reference: null, confirmedAt: now }];
        job.status = 'paid';
        jobEvent(job, user.id, `Paid with Buyer Protection. Figmark is holding it; ${job.managerName} is the community manager on it.`);
      } else {
        const artist = await repository.getUserById(job.artistId);
        if (!artist?.artistProfile?.payment) return error(409, 'no_details', 'This artist has not set up direct payment. Pay with protection instead.');
        job.method = 'direct';
        job.payments = [...job.payments, { at: now, amountMinor: price, method: 'direct', reference: text(input?.reference, 80) || null, confirmedAt: null }];
        jobEvent(job, user.id, 'Paid directly - waiting for the artist to confirm it arrived.');
      }
      break;
    }
    case 'complete':
      job.status = 'completed';
      if (job.method === 'protected' && !job.releasedAt) job.releasedAt = now;
      jobEvent(job, user.id, job.method === 'protected' ? 'Received. The held payment goes to the artist.' : 'Received.');
      break;
    default:
      return error(409, 'not_yours', 'That move is the artist’s.');
  }
  order.artistJob = job;
  order.updatedAt = now;
  const saved = await repository.updateOrder(order);
  const artist = await repository.getUserById(job.artistId);
  if (artist) {
    const buyer = (await orderNames(repository, order)).buyer;
    await notify(repository, crewOf(artist, 'artist'), {
      kind: 'commission',
      title: `${buyer}: ${job.history[job.history.length - 1]!.note}`,
      body: `${job.offeringName} · ${order.itemName}`,
      link: `/services/store/artist/${artist.id}`,
    });
  }
  return json(200, { order: saved });
}

/* ── The crew: whoever a lot names ───────────────────────────────────── */

interface CrewSeat { role: CrewRole; owner: User; lot: Lot; forwarder: User | null }

/** Every lot this person works, and as what. */
async function seatsOf(repository: Repo, userId: string): Promise<CrewSeat[]> {
  const seats: CrewSeat[] = [];
  const all = await repository.listAllUsers();
  const forwarders = new Map(all.filter((user) => isLive(user.forwarderProfile) && hasRight(user, 'forwarder', userId, 'work'))
    .map((user) => [user.id, user]));
  for (const owner of all.filter((user) => user.sellerProfile)) {
    const packsAll = can(owner, userId, 'export') && owner.id !== userId;
    for (const lot of await repository.listLots({ sellerId: owner.id })) {
      if (supplierIdOf(lot) === userId || (packsAll && lot.status !== 'closed')) seats.push({ role: 'supplier', owner, lot, forwarder: null });
      if (lot.handler?.handlerUserId === userId) seats.push({ role: 'handler', owner, lot, forwarder: null });
      const fwd = lot.forwarder?.forwarderUserId ? forwarders.get(lot.forwarder.forwarderUserId) : undefined;
      if (fwd && forwarderTookLot(lot)) seats.push({ role: 'forwarder', owner, lot, forwarder: fwd });
    }
  }
  return seats;
}

/** The buttons the shop's route hands this role, in route order. */
function buttonsFor(lot: Lot, role: CrewRole) {
  const steps = routeOf(lot).steps;
  return steps.flatMap((step, index) => {
    const key = stepTickKey(step);
    if (!key) return [];
    const mine = step.assignee === role || (step.trigger && CREW_CHECKPOINTS[role].includes(step.trigger));
    return mine ? [{ key, label: stepButtonLabel(step, placesOf(lot)), step: renderStepText(step.name, placesOf(lot)), index, assigned: step.assignee === role }] : [];
  });
}

/** The lot moves handed to a forwarder: whole-crate steps the route gives them. */
function movesFor(lot: Lot, role: CrewRole) {
  if (role !== 'forwarder') return [];
  const route = routeOf(lot);
  const first = Math.max(0, lotOffset(route) - 1);
  const last = lotEndIndex(route);
  return route.steps.flatMap((step, index) =>
    index >= first && index <= last && step.assignee === 'forwarder'
      ? [{ index, name: renderStepText(step.name, placesOf(lot)), forward: Boolean(step.forward) }] : []);
}

/** GET /api/me/services - everything this person does for other people's lots and orders. */
async function myServices(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const all = await repository.listAllUsers();
  const account = all.find((row) => row.id === user.id) ?? null;

  const stores = await Promise.all(all.flatMap((owner) => STORE_KINDS.flatMap((kind) => {
    const store = storeOf(owner, kind);
    const rights = store ? rightsIn(owner, kind, user.id) : [];
    if (!store || rights.length === 0) return [];
    return [(async () => {
      let waiting = 0;
      let active = 0;
      if (isLive(store) && rights.includes('work')) {
        if (kind === 'forwarder') {
          const lots = await lotsBooking(repository, owner.id);
          waiting = lots.filter(({ lot }) => lot.forwarder?.acceptance === 'pending').length;
          active = lots.filter(({ lot }) => forwarderTookLot(lot) && lot.status !== 'closed').length;
        } else {
          const jobs = (await repository.listOrdersCommissionedFrom(owner.id)).map((order) => order.artistJob!);
          waiting = jobs.filter((job) => jobActionsFor(job, 'artist').length > 0).length;
          active = jobs.filter((job) => jobIsLive(job)).length;
        }
      }
      return {
        kind, ownerId: owner.id, isOwner: owner.id === user.id, rights,
        name: store.companyName, slug: store.directorySlug, tagline: store.tagline ?? '',
        logoUrl: store.logoUrl ?? null, accent: store.accent ?? (kind === 'artist' ? 'pink' : 'aqua'),
        status: statusOf(store), waiting, active,
        lastNote: store.application?.history.slice(-1)[0]?.note ?? null,
      };
    })()];
  })));

  const seats = (await seatsOf(repository, user.id)).filter(({ role }) => role !== 'forwarder');
  const crew = await Promise.all(seats.map(async ({ role, owner, lot }) => {
    const orders = (await repository.listOrdersForLot(lot.id)).filter((order) => !isCancelledLike(order.status));
    const buttons = buttonsFor(lot, role);
    const toPress = orders.filter((order) => {
      const ticks = ticksOf(order);
      return buttons.some((button) => !ticks[button.key]);
    }).length;
    return {
      role, store: storeCardOf(owner), lot: lotRef(lot),
      items: orders.length, parcels: new Set(orders.map((order) => order.buyerId)).size,
      buttons: buttons.map((button) => button.label), toPress,
    };
  }));

  return json(200, {
    stores,
    crew: crew.filter((row) => row.lot.status !== 'closed' || row.toPress > 0),
    own: {
      forwarder: statusOf(account?.forwarderProfile),
      artist: statusOf(account?.artistProfile),
    },
    handler: Boolean(account?.handlerProfile),
    communityManager: Boolean(account?.managerRights),
  });
}

/**
 * GET /api/me/crew/{sellerId}/{lotId} - one lot, worked by the crew.
 *
 * The orders with exactly the buttons the shop's route handed this role, and
 * for a forwarder, the whole-crate moves too. What each role sees of the
 * buyers follows what the job needs: a handler addresses parcels, so gets the
 * names and a phone; a supplier and a forwarder handle pieces, so get pieces.
 * No one in the crew sees a price.
 */
async function crewLot(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const { sellerId, lotId } = request.params;
  const wanted = request.query.get('role') as CrewRole | null;
  const seats = (await seatsOf(repository, user.id)).filter((seat) => seat.lot.id === lotId && seat.owner.id === sellerId);
  const seat = seats.find((row) => row.role === wanted) ?? seats[0];
  if (!seat) return error(403, 'forbidden', 'That lot is not yours to work.');

  const { lot, role, owner } = seat;
  const orders = (await repository.listOrdersForLot(lot.id)).filter((order) => !isCancelledLike(order.status));
  const buyers = role === 'handler' ? await repository.listUsersByIds([...new Set(orders.map((order) => order.buyerId))]) : [];
  const byId = new Map(buyers.map((buyer) => [buyer.id, buyer]));
  const route = routeOf(lot);

  return json(200, {
    role,
    roles: seats.map((row) => row.role),
    store: storeCardOf(owner),
    forwarder: seat.forwarder ? { ownerId: seat.forwarder.id, name: seat.forwarder.forwarderProfile!.companyName } : null,
    lot: { ...lotRef(lot), laneLabel: lot.forwarder?.laneLabel ?? null, trackingReference: lot.forwarder?.trackingReference ?? null, city: lot.handler?.city ?? null },
    steps: route.steps.map((step, index) => ({ index, name: renderStepText(step.name, placesOf(lot)), assignee: step.assignee ?? null, key: stepTickKey(step) })),
    buttons: buttonsFor(lot, role),
    moves: movesFor(lot, role),
    items: orders.map((order) => {
      const buyer = byId.get(order.buyerId);
      return {
        id: order.id,
        itemName: order.itemName,
        condition: order.condition,
        quantity: order.quantity,
        weightGrams: order.quantity * order.unitWeightGrams,
        parcel: role === 'handler' ? order.buyerId : null,
        buyer: role === 'handler' ? { name: buyer?.displayName ?? 'A buyer', phone: buyer?.phone ?? null } : null,
        ticks: ticksOf(order),
        covered: liveAddOns(order).some((addOn) => addOn.kind === 'insurance'),
        toStudio: jobIsLive(order.artistJob) && ['paid', 'working'].includes(order.artistJob!.status),
      };
    }),
  });
}

/* ── Operators ───────────────────────────────────────────────────────── */

async function operator(request: HttpRequest) {
  const auth = await getAuthService();
  return auth.requireCapability(request, ['admin']);
}

/** GET /api/ops/stores - every store and application, waiting ones first. */
async function opsStores(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  const rows = (await repository.listAllUsers()).flatMap((owner) => STORE_KINDS.flatMap((kind) => {
    const store = storeOf(owner, kind);
    if (!store) return [];
    return [{
      kind,
      owner: { id: owner.id, displayName: owner.displayName, email: owner.email, phone: owner.phone, username: owner.username ?? null, createdAt: owner.createdAt, suspended: owner.suspended },
      status: statusOf(store)!,
      submittedAt: store.application?.submittedAt ?? null,
      store: publicStore(owner, kind),
      businessId: store.businessId ?? null,
      history: store.application?.history ?? [],
      team: store.team ?? [],
      payment: Boolean(store.payment),
      studioAddress: kind === 'artist' ? owner.artistProfile?.studioAddress ?? '' : null,
    }];
  }));
  const order: Record<StoreStatus, number> = { pending: 0, changes: 1, approved: 2, suspended: 3, rejected: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || (b.submittedAt ?? '').localeCompare(a.submittedAt ?? ''));
  return json(200, { stores: rows });
}

/**
 * POST /api/ops/stores/{kind}/{ownerId}/review - decide an application, or
 * suspend a live store. Every decision carries a note, because the person
 * reading "changes requested" needs to know which changes.
 */
async function opsReview(request: HttpRequest, _context: InvocationContext) {
  const admin = await operator(request);
  const kind = request.params.kind;
  if (!isKind(kind)) return error(404, 'not_found', 'No such store.');
  const input = await body<{ decision?: StoreStatus; note?: string }>(request);
  const decision = input?.decision;
  if (!decision || !['approved', 'changes', 'rejected', 'suspended'].includes(decision)) {
    return error(400, 'invalid_decision', 'Approve, ask for changes, reject or suspend.');
  }
  const note = text(input?.note, 1000);
  if (decision !== 'approved' && !note) return error(400, 'no_note', 'Say why, so they know what to fix.');

  const repository = await getRepository();
  const owner = await repository.getUserById(request.params.ownerId ?? '');
  const store = owner ? storeOf(owner, kind) : null;
  if (!owner || !store) return error(404, 'not_found', 'No such store.');

  const now = new Date().toISOString();
  store.status = decision;
  store.application = {
    submittedAt: store.application?.submittedAt ?? now,
    history: [...(store.application?.history ?? []), { at: now, by: admin.id, status: decision, note: note || 'Approved.' }],
  };
  if (decision === 'approved') store.listedInDirectory = store.listedInDirectory !== false;
  owner.updatedAt = now;
  await repository.updateUser(owner);

  const label = kind === 'forwarder' ? 'forwarding company' : 'artist studio';
  await notify(repository, [owner.id], {
    kind: 'service_store',
    title: decision === 'approved' ? `Your ${label} is live 🎉`
      : decision === 'changes' ? `Your ${label} needs a few changes`
        : decision === 'suspended' ? `Your ${label} was suspended` : `Your ${label} was not approved`,
    body: note || `${store.companyName} is open for business.`,
    link: '/services/mine',
  });
  return json(200, { ok: true, status: decision });
}

export const myServicesRoute = handler(myServices);
export const applyStoreRoute = handler(apply);
export const storeConsoleRoute = handler(storeConsole);
export const saveStoreRoute = handler(saveStore);
export const storeTeamRoute = handler(storeTeam);
export const storeWorkRoute = handler(storeWork);
export const respondLotRoute = handler(respondToLot);
export const artistActRoute = handler(artistAct);
export const storePageRoute = handler(storePage);
export const lotForwarderOptionsRoute = handler(lotForwarderOptions);
export const bookForwarderRoute = handler(bookForwarder);
export const orderServicesRoute = handler(orderServices);
export const setInsuranceRoute = handler(setInsurance);
export const commissionRoute = handler(commission);
export const commissionActRoute = handler(commissionAct);
export const crewLotRoute = handler(crewLot);
export const opsStoresRoute = handler(opsStores);
export const opsReviewRoute = audited('store.review', handler(opsReview));

const anon = { authLevel: 'anonymous' } as const;

app.http('my-services', { ...anon, methods: ['GET'], route: 'me/services', handler: myServicesRoute });
app.http('services-apply', { ...anon, methods: ['POST'], route: 'me/services/apply', handler: applyStoreRoute });
app.http('crew-lot', { ...anon, methods: ['GET'], route: 'me/crew/{sellerId}/{lotId}', handler: crewLotRoute });
app.http('svc-store', { ...anon, methods: ['GET'], route: 'service-stores/{kind}/{ownerId}', handler: storeConsoleRoute });
app.http('svc-store-save', { ...anon, methods: ['POST'], route: 'service-stores/{kind}/{ownerId}/save', handler: saveStoreRoute });
app.http('svc-store-team', { ...anon, methods: ['POST'], route: 'service-stores/{kind}/{ownerId}/team', handler: storeTeamRoute });
app.http('svc-store-work', { ...anon, methods: ['GET'], route: 'service-stores/{kind}/{ownerId}/work', handler: storeWorkRoute });
app.http('svc-store-respond', { ...anon, methods: ['POST'], route: 'service-stores/forwarder/{ownerId}/respond', handler: respondLotRoute });
app.http('svc-store-job', { ...anon, methods: ['POST'], route: 'service-stores/artist/{ownerId}/jobs/{orderId}', handler: artistActRoute });
app.http('svc-store-page', { ...anon, methods: ['GET'], route: 'service-store/{kind}/{slug}', handler: storePageRoute });
app.http('lot-forwarders', { ...anon, methods: ['GET'], route: 'lots/{id}/forwarders', handler: lotForwarderOptionsRoute });
app.http('lot-forwarder-store', { ...anon, methods: ['POST'], route: 'lots/{id}/forwarder-store', handler: bookForwarderRoute });
app.http('order-services', { ...anon, methods: ['GET'], route: 'orders/{id}/services', handler: orderServicesRoute });
app.http('order-insurance', { ...anon, methods: ['POST'], route: 'orders/{id}/insurance', handler: setInsuranceRoute });
app.http('order-commission', { ...anon, methods: ['POST'], route: 'orders/{id}/commission', handler: commissionRoute });
app.http('order-commission-act', { ...anon, methods: ['POST'], route: 'orders/{id}/commission/act', handler: commissionActRoute });
app.http('ops-stores', { ...anon, methods: ['GET'], route: 'ops/stores', handler: opsStoresRoute });
app.http('ops-store-review', { ...anon, methods: ['POST'], route: 'ops/stores/{kind}/{ownerId}/review', handler: opsReviewRoute });
