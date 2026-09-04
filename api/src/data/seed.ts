import type {
  Follow,
  Like,
  Listing,
  ListingComment,
  Lot,
  Order,
  SellerTrustSignals,
  TrustSignals,
  User,
  VerificationState,
} from '../../../shared/models.js';
import { hashPassword } from '../auth/passwords.js';

/**
 * Development seed data.
 *
 * Exactly one account can sign in - the demo account below. The other user
 * records are catalog sellers and freight forwarders: they own listings and
 * directory entries so the marketplace has something to show, but they carry no
 * password hash and cannot be signed into.
 *
 * All of it is fictional.
 */

/** The one account you can sign in with. */
export const DEMO_EMAIL = 'demo@figmark.in';
export const DEMO_PHONE = '+919812345678';
export const DEMO_PASSWORD = 'figmark123';

const NOW = new Date('2026-09-01T09:00:00.000Z');
const iso = (days = 0, hours = 0) =>
  new Date(NOW.getTime() + days * 86_400_000 + hours * 3_600_000).toISOString();

/** Phone and email verified so the demo account can transact; nothing heavier. */
function verification(transactable: boolean): VerificationState {
  const state = transactable ? 'verified' : 'unverified';
  return {
    phone: state,
    email: state,
    governmentId: 'unverified',
    address: 'unverified',
    paymentMethod: 'unverified',
    bankAccountMatch: 'unverified',
    businessRegistration: 'unverified',
    lastReviewedAt: null,
    lastReviewedBy: null,
  };
}

const trust = (score = 0, completed = 0): TrustSignals => ({
  score,
  completedTransactions: completed,
  disputesLost: 0,
  computedAt: score > 0 ? iso(-1) : null,
});

const sellerTrust = (score = 0, completed = 0, onTime: number | null = null): SellerTrustSignals => ({
  ...trust(score, completed),
  onTimeDispatchRate: onTime,
  repeatCustomerRate: null,
});

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export function seedUsers(): User[] {
  return [
    /* The single sign-in account. Both buyer and seller, as every account is. */
    {
      id: 'usr_demo',
      email: DEMO_EMAIL,
      phone: DEMO_PHONE,
      displayName: 'Arjun Mehta',
      isAdmin: false,
      passwordHash: hashPassword(DEMO_PASSWORD),
      verification: verification(true),
      buyerTrust: trust(72, 6),
      sellerTrust: sellerTrust(58, 3, 1),
      sellerProfile: {
        storefrontSlug: 'arjun-collects',
        storefrontName: 'Arjun Collects',
        bio: 'Occasional resales from my own collection. Mumbai based.',
        tier: 'verified',
        openLotCap: 2,
        depositHeldMinor: 0,
        dispatchRegion: 'Mumbai, MH',
        followerCount: 14,
      },
      forwarderProfile: null,
      suspended: false,
      createdAt: iso(-120),
      updatedAt: iso(-2),
    },

    /* Catalog sellers. No password hash: they populate the feed, they are not
       accounts you can sign in as. */
    storefront('usr_kaiju', 'Kaiju Imports', 'kaiju-imports', 'Bengaluru, KA', 91, 148, 0.96,
      'Weekly group-buys from Guangzhou. Scale figures and garage kits.'),
    storefront('usr_tokyoline', 'Tokyo Line', 'tokyo-line', 'Delhi, DL', 84, 96, 0.91,
      'Anime merch and trading cards, direct from Akihabara runs.'),
    storefront('usr_sneakervault', 'Sneaker Vault', 'sneaker-vault', 'Pune, MH', 77, 61, 0.88,
      'Deadstock sneakers, authenticated before dispatch.'),
    storefront('usr_gadgetgrid', 'Gadget Grid', 'gadget-grid', 'Hyderabad, TS', 69, 40, 0.83,
      'Shenzhen electronics — audio, handhelds, accessories.'),

    /* Freight forwarders. Directory entries, also not sign-in accounts. */
    forwarder('usr_fwd_lotus', 'Lotus Freight', 'lotus-freight', 'ops@lotusfreight.example',
      '+919000000101', 8_000, 88, 34, 'Consolidated air and sea freight, Guangzhou and Yiwu to west and south India.',
      [
        { originCity: 'Guangzhou', destinationCity: 'Bengaluru', claimedTurnaroundDays: 12, ratePerKgMinor: 48_000, currency: 'INR' },
        { originCity: 'Yiwu', destinationCity: 'Mumbai', claimedTurnaroundDays: 18, ratePerKgMinor: 39_000, currency: 'INR' },
      ]),
    forwarder('usr_fwd_silkroute', 'Silk Route Cargo', 'silk-route-cargo', 'hello@silkroute.example',
      '+919000000102', 15_000, 81, 52, 'Sea freight specialists. Slower, materially cheaper on volume.',
      [
        { originCity: 'Shenzhen', destinationCity: 'Chennai', claimedTurnaroundDays: 26, ratePerKgMinor: 21_000, currency: 'INR' },
        { originCity: 'Guangzhou', destinationCity: 'Mumbai', claimedTurnaroundDays: 24, ratePerKgMinor: 23_500, currency: 'INR' },
      ]),
    forwarder('usr_fwd_swiftwing', 'SwiftWing Express', 'swiftwing-express', 'book@swiftwing.example',
      '+919000000103', 3_500, 93, 19, 'Air express only. Premium rates, fastest clearance at BLR and DEL.',
      [
        { originCity: 'Guangzhou', destinationCity: 'Delhi', claimedTurnaroundDays: 7, ratePerKgMinor: 72_000, currency: 'INR' },
        { originCity: 'Shanghai', destinationCity: 'Bengaluru', claimedTurnaroundDays: 8, ratePerKgMinor: 68_000, currency: 'INR' },
      ]),
  ];
}

function storefront(
  id: string, name: string, slug: string, region: string,
  score: number, completed: number, onTime: number, bio: string,
): User {
  return {
    id,
    email: `${slug}@figmark.example`,
    phone: null,
    displayName: name,
    isAdmin: false,
    // No password: a catalog seller, not a sign-in account.
    passwordHash: null,
    verification: verification(true),
    buyerTrust: trust(),
    sellerTrust: sellerTrust(score, completed, onTime),
    sellerProfile: {
      storefrontSlug: slug,
      storefrontName: name,
      bio,
      tier: score > 80 ? 'pro' : 'verified',
      openLotCap: score > 80 ? 6 : 3,
      depositHeldMinor: score > 80 ? 25_00_000 : 0,
      dispatchRegion: region,
      followerCount: Math.round(completed * 2.4),
    },
    forwarderProfile: null,
    suspended: false,
    createdAt: iso(-200),
    updatedAt: iso(-3),
  };
}

function forwarder(
  id: string, company: string, slug: string, email: string, phone: string,
  capacityKg: number, score: number, completed: number, description: string,
  routes: NonNullable<User['forwarderProfile']>['routes'],
): User {
  return {
    id,
    email,
    phone,
    displayName: company,
    isAdmin: false,
    passwordHash: null,
    verification: verification(true),
    buyerTrust: trust(),
    sellerTrust: sellerTrust(),
    sellerProfile: null,
    forwarderProfile: {
      companyName: company,
      directorySlug: slug,
      description,
      routes,
      contactEmail: email,
      contactPhone: phone,
      claimedMonthlyCapacityKg: capacityKg,
      trust: trust(score, completed),
      listedInDirectory: true,
    },
    suspended: false,
    createdAt: iso(-300),
    updatedAt: iso(-5),
  };
}

/* -------------------------------------------------------------------------- */
/* Catalog                                                                    */
/* -------------------------------------------------------------------------- */

interface ListingSeed {
  id: string;
  sellerId: string;
  title: string;
  description: string;
  category: string;
  condition: Listing['condition'];
  /** Opt-in demand pooling, shown to buyers. */
  preOrder?: { fillThreshold: number; filledCount: number; cutoffDays: number };
  priceMinor: number;
  quantity: number;
  lotId?: string;
  tags: string[];
  likeCount: number;
  viewCount: number;
  ageDays: number;
}

const LISTINGS: ListingSeed[] = [
  {
    id: 'lst_dragon_knight', sellerId: 'usr_kaiju', title: '1/7 Scale Dragon Knight — resin statue',
    description: 'Factory sealed, sourced direct from the Guangzhou studio. Pre-book against the September lot; ships once the lot clears customs.',
    category: 'Scale figures', condition: 'MISB', priceMinor: 1_45_000,
    quantity: 17, lotId: 'lot_gz_sep', tags: ['resin', 'scale', 'dragon', 'preorder'],
    preOrder: { fillThreshold: 20, filledCount: 3, cutoffDays: 9 },
    likeCount: 34, viewCount: 412, ageDays: -6,
  },
  {
    id: 'lst_mecha_kit', sellerId: 'usr_kaiju', title: 'HG Mecha model kit — assorted wave 4',
    description: 'In stock in Bengaluru. Ships within 2 working days. Box fresh, unbuilt.',
    category: 'Model kits', condition: 'MIB', priceMinor: 32_000,
    quantity: 6, tags: ['mecha', 'kit', 'gundam', 'in-stock'],
    likeCount: 12, viewCount: 188, ageDays: -12,
  },
  {
    id: 'lst_card_booster', sellerId: 'usr_tokyoline', title: 'TCG booster box — Japanese print',
    description: 'Sealed Japanese print run, not the English release. One box per buyer while stock lasts.',
    category: 'Trading cards', condition: 'MISB', priceMinor: 78_000,
    quantity: 4, tags: ['tcg', 'cards', 'sealed', 'japanese'],
    likeCount: 51, viewCount: 623, ageDays: -3,
  },
  {
    id: 'lst_anime_figure', sellerId: 'usr_tokyoline', title: 'Prize figure set — 3 piece',
    description: 'Complete set of three, opened for photos then re-boxed. No damage to the figures.',
    category: 'Anime merch', condition: 'BIB', priceMinor: 24_500,
    quantity: 2, tags: ['prize', 'figure', 'set'],
    likeCount: 8, viewCount: 97, ageDays: -18,
  },
  {
    id: 'lst_sneaker_retro', sellerId: 'usr_sneakervault', title: 'Retro high-top — UK 9, deadstock',
    description: 'Deadstock pair, authenticated in-house before dispatch. Original box included.',
    category: 'Sneakers', condition: 'MIB', priceMinor: 2_15_000,
    quantity: 1, tags: ['sneakers', 'deadstock', 'uk9'],
    likeCount: 73, viewCount: 1_204, ageDays: -1,
  },
  {
    id: 'lst_sneaker_runner', sellerId: 'usr_sneakervault', title: 'Runner — UK 8.5, worn twice',
    description: 'Worn twice indoors, soles clean. Selling because the fit was wrong for me.',
    category: 'Sneakers', condition: 'LOOSE', priceMinor: 68_000,
    quantity: 1, tags: ['sneakers', 'used', 'uk85'],
    likeCount: 5, viewCount: 71, ageDays: -9,
  },
  {
    id: 'lst_iem_audio', sellerId: 'usr_gadgetgrid', title: 'Planar IEM — Shenzhen direct',
    description: 'Group-buy slot against the October Shenzhen consolidation. Balanced cable included.',
    category: 'Electronics', condition: 'MISB', priceMinor: 54_000,
    quantity: 22, lotId: 'lot_sz_oct', tags: ['audio', 'iem', 'planar', 'preorder'],
    preOrder: { fillThreshold: 30, filledCount: 8, cutoffDays: 16 },
    likeCount: 29, viewCount: 347, ageDays: -4,
  },
  {
    id: 'lst_handheld', sellerId: 'usr_gadgetgrid', title: 'Retro handheld console — 64GB',
    description: 'Preloaded, tested before shipping. Charger and case in the box.',
    category: 'Electronics', condition: 'MIB', priceMinor: 89_000,
    quantity: 3, tags: ['handheld', 'retro', 'gaming'],
    likeCount: 41, viewCount: 512, ageDays: -7,
  },
  /* The demo account's own listings — this is what "My Listings" shows. */
  {
    id: 'lst_my_statue', sellerId: 'usr_demo', title: 'Garage kit statue — built and painted',
    description: 'Built and painted by me over two months. Selling to make shelf space. Collection preferred in Mumbai.',
    category: 'Collectibles', condition: 'LOOSE', priceMinor: 1_20_000,
    quantity: 1, lotId: 'lot_my_batch', tags: ['garage-kit', 'painted', 'mumbai'],
    likeCount: 3, viewCount: 44, ageDays: -5,
  },
  {
    id: 'lst_my_cards', sellerId: 'usr_demo', title: 'Card binder — 200+ commons and rares',
    description: 'Clearing out duplicates. Binder included. Happy to split if someone wants specific cards.',
    category: 'Trading cards', condition: 'LOOSE', priceMinor: 18_000,
    quantity: 1, tags: ['cards', 'bulk', 'binder'],
    likeCount: 1, viewCount: 22, ageDays: -14,
  },
];

export function seedListings(): Listing[] {
  return LISTINGS.map((entry) => ({
    id: entry.id,
    sellerId: entry.sellerId,
    title: entry.title,
    description: entry.description,
    category: entry.category,
    condition: entry.condition,
    status: 'active',
    priceMinor: entry.priceMinor,
    currency: 'INR',
    quantityAvailable: entry.quantity,
    preOrder: entry.preOrder
      ? {
          fillThreshold: entry.preOrder.fillThreshold,
          filledCount: entry.preOrder.filledCount,
          cutoffAt: iso(entry.preOrder.cutoffDays),
        }
      : null,
    lotId: entry.lotId ?? null,
    photos: [],
    tags: entry.tags,
    likeCount: entry.likeCount,
    viewCount: entry.viewCount,
    bumpedAt: null,
    createdAt: iso(entry.ageDays),
    updatedAt: iso(entry.ageDays),
  }));
}

export function seedLots(): Lot[] {
  return [
    {
      id: 'lot_gz_sep', sellerId: 'usr_kaiju',
      name: 'Guangzhou run — September',
      description: 'Consolidated shipment closing end of month. Air freight, QC before repack.',
      status: 'open', stage: 'ordering',
      stageHistory: [{ stage: 'ordering', enteredAt: iso(-6), note: 'Lot opened for pre-booking.', recordedBy: 'usr_kaiju' }],
      estimatedDispatchAt: iso(24),
      forwarder: { forwarderUserId: 'usr_fwd_lotus', name: 'Lotus Freight', contact: 'ops@lotusfreight.example', trackingReference: null },
      costModel: { currency: 'INR', goodsCostMinor: 18_50_000, freightMinor: 2_40_000, customsDutyMinor: 3_10_000, packagingMinor: 45_000, localShippingMinor: 60_000, totalWeightGrams: 24_500 },
      createdAt: iso(-6), updatedAt: iso(-1),
    },
    {
      id: 'lot_sz_oct', sellerId: 'usr_gadgetgrid',
      name: 'Shenzhen consolidation — October',
      description: 'Audio and small electronics. Sea freight to Chennai, then domestic dispatch.',
      status: 'open', stage: 'ordering',
      stageHistory: [{ stage: 'ordering', enteredAt: iso(-4), note: null, recordedBy: 'usr_gadgetgrid' }],
      estimatedDispatchAt: iso(46),
      forwarder: { forwarderUserId: 'usr_fwd_silkroute', name: 'Silk Route Cargo', contact: 'hello@silkroute.example', trackingReference: null },
      costModel: { currency: 'INR', goodsCostMinor: 12_80_000, freightMinor: 1_10_000, customsDutyMinor: 2_05_000, packagingMinor: 32_000, localShippingMinor: 48_000, totalWeightGrams: 16_200 },
      createdAt: iso(-4), updatedAt: iso(-1),
    },
    {
      /* The demo account's own shipment batch, so the seller console has
         something real in it the moment you sign in. */
      id: 'lot_my_batch', sellerId: 'usr_demo',
      name: 'Mumbai dispatch — week 36',
      description: 'Items going out from my own shelf this week.',
      status: 'open', stage: 'ordering',
      stageHistory: [{ stage: 'ordering', enteredAt: iso(-3), note: 'Batch opened.', recordedBy: 'usr_demo' }],
      estimatedDispatchAt: iso(4),
      forwarder: null,
      costModel: { currency: 'INR', goodsCostMinor: 0, freightMinor: 0, customsDutyMinor: 0, packagingMinor: 12_000, localShippingMinor: 18_000, totalWeightGrams: 1_800 },
      createdAt: iso(-3), updatedAt: iso(-3),
    },
    {
      id: 'lot_gz_aug', sellerId: 'usr_kaiju',
      name: 'Guangzhou run — August',
      description: 'Closed lot, currently in customs clearance at BLR.',
      status: 'closed', stage: 'india_received',
      stageHistory: [
        { stage: 'ordering', enteredAt: iso(-40), note: null, recordedBy: 'usr_kaiju' },
        { stage: 'china_wh_received', enteredAt: iso(-26), note: 'All 18 units checked in.', recordedBy: 'usr_kaiju' },
        { stage: 'dispatched_from_china', enteredAt: iso(-19), note: 'Air freight, AWB on file.', recordedBy: 'usr_kaiju' },
        { stage: 'india_received', enteredAt: iso(-4), note: 'Awaiting customs assessment.', recordedBy: 'usr_kaiju' },
      ],
      estimatedDispatchAt: iso(3),
      // The escape hatch: a forwarder the seller already works with, off-platform.
      forwarder: { forwarderUserId: null, name: 'Shenzhen Star Cargo', contact: 'wa: +8613800000000', trackingReference: 'SSC-2026-08-4471' },
      costModel: { currency: 'INR', goodsCostMinor: 14_20_000, freightMinor: 1_95_000, customsDutyMinor: 2_40_000, packagingMinor: 38_000, localShippingMinor: 52_000, totalWeightGrams: 19_800 },
      createdAt: iso(-40), updatedAt: iso(-4),
    },
  ];
}

/** The demo account's purchases, so "My Purchases" is not empty. */
export function seedOrders(): Order[] {
  return [
    {
      id: 'ord_1001', lotId: 'lot_gz_sep', sellerId: 'usr_kaiju', buyerId: 'usr_demo',
      listingId: 'lst_dragon_knight', itemName: '1/7 Scale Dragon Knight — resin statue',
      condition: 'MISB', quantity: 2, unitWeightGrams: 1_400, unitPriceMinor: 1_45_000, currency: 'INR',
      status: 'confirmed', paymentStatus: 'paid',
      stage: 'ordering',
      stageHistory: [{ stage: 'ordering', enteredAt: iso(-5), note: 'Order placed.', recordedBy: 'usr_demo' }],
      escrow: { state: 'held', amountMinor: 2_90_000, heldAt: iso(-5), releasedAt: null, autoReleaseAt: iso(31), disputeId: null },
      completedAt: null, createdAt: iso(-5), updatedAt: iso(-5),
    },
    {
      id: 'ord_1002', lotId: 'lot_gz_aug', sellerId: 'usr_kaiju', buyerId: 'usr_demo',
      listingId: 'lst_mecha_kit', itemName: 'HG Mecha model kit — assorted wave 3',
      condition: 'MIB', quantity: 1, unitWeightGrams: 900, unitPriceMinor: 32_000, currency: 'INR',
      status: 'in_fulfilment', paymentStatus: 'paid',
      stage: 'india_received',
      stageHistory: [
        { stage: 'ordering', enteredAt: iso(-30), note: 'Order placed.', recordedBy: 'usr_demo' },
        { stage: 'china_wh_received', enteredAt: iso(-26), note: null, recordedBy: 'usr_kaiju' },
        { stage: 'dispatched_from_china', enteredAt: iso(-19), note: 'Air freight, AWB on file.', recordedBy: 'usr_kaiju' },
        { stage: 'india_received', enteredAt: iso(-4), note: 'Awaiting customs assessment.', recordedBy: 'usr_kaiju' },
      ],
      escrow: { state: 'held', amountMinor: 32_000, heldAt: iso(-30), releasedAt: null, autoReleaseAt: iso(12), disputeId: null },
      completedAt: null, createdAt: iso(-30), updatedAt: iso(-4),
    },
    {
      id: 'ord_1003', lotId: 'lot_sz_oct', sellerId: 'usr_gadgetgrid', buyerId: 'usr_demo',
      listingId: 'lst_iem_audio', itemName: 'Planar IEM — Shenzhen direct',
      condition: 'MISB', quantity: 1, unitWeightGrams: 400, unitPriceMinor: 54_000, currency: 'INR',
      status: 'pending_payment', paymentStatus: 'unpaid',
      stage: 'ordering',
      stageHistory: [{ stage: 'ordering', enteredAt: iso(-2), note: 'Order placed.', recordedBy: 'usr_demo' }],
      escrow: { state: 'none', amountMinor: 54_000, heldAt: null, releasedAt: null, autoReleaseAt: null, disputeId: null },
      completedAt: null, createdAt: iso(-2), updatedAt: iso(-2),
    },
  ];
}

export function seedComments(): ListingComment[] {
  return [
    { id: 'cmt_1', listingId: 'lst_dragon_knight', authorId: 'usr_demo', authorName: 'Arjun Mehta', body: 'Is the base included, or is that sold separately?', replyToId: null, createdAt: iso(-4), updatedAt: iso(-4) },
    { id: 'cmt_2', listingId: 'lst_dragon_knight', authorId: 'usr_kaiju', authorName: 'Kaiju Imports', body: 'Base is included. Sealed in the same box.', replyToId: 'cmt_1', createdAt: iso(-4, 3), updatedAt: iso(-4, 3) },
    { id: 'cmt_3', listingId: 'lst_sneaker_retro', authorId: 'usr_demo', authorName: 'Arjun Mehta', body: 'Any chance of a UK 10 in the next drop?', replyToId: null, createdAt: iso(-1), updatedAt: iso(-1) },
  ];
}

/** The demo account already follows one seller and has bookmarked a few items. */
export function seedFollows(): Follow[] {
  return [{ id: 'flw_1', followerId: 'usr_demo', sellerId: 'usr_kaiju', createdAt: iso(-20), updatedAt: iso(-20) }];
}

export function seedLikes(): Like[] {
  return [
    { id: 'like_1', userId: 'usr_demo', listingId: 'lst_sneaker_retro', createdAt: iso(-1), updatedAt: iso(-1) },
    { id: 'like_2', userId: 'usr_demo', listingId: 'lst_card_booster', createdAt: iso(-3), updatedAt: iso(-3) },
  ];
}
