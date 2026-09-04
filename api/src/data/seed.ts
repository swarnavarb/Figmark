import type {
  Listing,
  Lot,
  Order,
  SellerTrustSignals,
  TrustSignals,
  User,
  VerificationState,
} from '../../../shared/models.js';
import type { DemoAccount } from '../../../shared/contracts.js';
import { hashPassword } from '../auth/passwords.js';

/**
 * Development seed data.
 *
 * Exists to make the scaffold demonstrable: the status page can show a real
 * sign-in, a real lot with a real manifest, without any cloud resource
 * attached. All of it is fictional.
 */

/** Shared password for every seeded account. Development only. */
export const DEMO_PASSWORD = 'figmark-dev';

const NOW = new Date('2026-09-01T09:00:00.000Z');

function iso(offsetDays = 0): string {
  return new Date(NOW.getTime() + offsetDays * 86_400_000).toISOString();
}

/**
 * Phone is marked verified so the seeded accounts can actually transact -
 * `deriveCapabilities` gates buying and selling on it. Everything heavier (ID,
 * bank match, business registration) stays unverified, which is what keeps the
 * seller tier low and leaves the "become a verified seller" flow meaningful.
 */
function unverified(): VerificationState {
  return {
    phone: 'verified',
    email: 'verified',
    governmentId: 'unverified',
    address: 'unverified',
    paymentMethod: 'unverified',
    bankAccountMatch: 'unverified',
    businessRegistration: 'unverified',
    lastReviewedAt: null,
    lastReviewedBy: null,
  };
}

function noTrust(): TrustSignals {
  return { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null };
}

function noSellerTrust(): SellerTrustSignals {
  return { ...noTrust(), onTimeDispatchRate: null, repeatCustomerRate: null };
}

function makeUser(input: {
  id: string;
  username: string;
  displayName: string;
  email: string;
  phone: string;
  /** Describes the account for the sign-in hint; not a role. */
  label: string;
  isAdmin?: boolean;
  sellerProfile?: User['sellerProfile'];
  forwarderProfile?: User['forwarderProfile'];
}): User & { label: string } {
  return {
    id: input.id,
    username: input.username,
    email: input.email,
    phone: input.phone,
    displayName: input.displayName,
    isAdmin: input.isAdmin ?? false,
    passwordHash: hashPassword(DEMO_PASSWORD),
    verification: unverified(),
    buyerTrust: noTrust(),
    sellerTrust: noSellerTrust(),
    sellerProfile: input.sellerProfile ?? null,
    forwarderProfile: input.forwarderProfile ?? null,
    suspended: false,
    createdAt: iso(-30),
    updatedAt: iso(-30),
    label: input.label,
  };
}

/**
 * Seeded accounts, chosen to exercise the unified model rather than to mirror
 * old roles: `ravi` both buys and sells, which is the normal case and the one a
 * role enum could not represent.
 */
export function seedUsers(): Array<User & { label: string }> {
  return [
    makeUser({
      id: 'usr_admin',
      username: 'admin',
      displayName: 'Platform Admin',
      email: 'admin@figmark.example',
      phone: '+919000000001',
      label: 'platform admin',
      isAdmin: true,
    }),
    makeUser({
      id: 'usr_kaiju',
      username: 'kaiju',
      displayName: 'Kaiju Imports',
      email: 'kaiju@figmark.example',
      phone: '+919000000002',
      label: 'established seller',
      sellerProfile: {
        storefrontSlug: 'kaiju-imports',
        storefrontName: 'Kaiju Imports',
        bio: 'Weekly group-buys from Guangzhou. Scale figures and garage kits.',
        tier: 'unverified',
        openLotCap: 2,
        depositHeldMinor: 0,
        dispatchRegion: 'Bengaluru, KA',
      },
    }),
    makeUser({
      id: 'usr_ravi',
      username: 'ravi',
      displayName: 'Ravi K.',
      email: 'ravi@figmark.example',
      phone: '+919000000003',
      // The whole point of the unified account: Ravi buys from other sellers
      // and lists his own spares, with no mode switch and no second signup.
      label: 'buys and sells',
      sellerProfile: {
        storefrontSlug: 'ravi-spares',
        storefrontName: "Ravi's Spares",
        bio: 'Occasional resales from my own collection.',
        tier: 'unverified',
        openLotCap: 1,
        depositHeldMinor: 0,
        dispatchRegion: 'Pune, MH',
      },
    }),
    makeUser({
      id: 'usr_meera',
      username: 'meera',
      displayName: 'Meera S.',
      email: 'meera@figmark.example',
      phone: '+919000000004',
      label: 'buyer, has never listed',
    }),
    makeUser({
      id: 'usr_forwarder_lotus',
      username: 'lotus',
      displayName: 'Lotus Freight',
      email: 'ops@lotusfreight.example',
      phone: '+919000000005',
      label: 'freight forwarder',
      forwarderProfile: {
        companyName: 'Lotus Freight Pvt Ltd',
        directorySlug: 'lotus-freight',
        description: 'Consolidated air and sea freight, Guangzhou and Yiwu to west/south India.',
        routes: [
          {
            originCity: 'Guangzhou',
            destinationCity: 'Bengaluru',
            claimedTurnaroundDays: 12,
            ratePerKgMinor: 48_000,
            currency: 'INR',
          },
          {
            originCity: 'Yiwu',
            destinationCity: 'Mumbai',
            claimedTurnaroundDays: 18,
            ratePerKgMinor: 39_000,
            currency: 'INR',
          },
        ],
        contactEmail: 'ops@lotusfreight.example',
        contactPhone: '+919000000005',
        claimedMonthlyCapacityKg: 8_000,
        trust: noTrust(),
        listedInDirectory: true,
      },
    }),
  ];
}

export function seedLots(): Lot[] {
  return [
    {
      id: 'lot_gz_sep',
      sellerId: 'usr_kaiju',
      name: 'Guangzhou run - September',
      description: 'Consolidated shipment closing end of month. Air freight, QC before repack.',
      status: 'open',
      stage: 'ordering',
      stageHistory: [
        { stage: 'ordering', enteredAt: iso(-6), note: 'Lot opened for pre-booking.', recordedBy: 'usr_kaiju' },
      ],
      fillThreshold: 20,
      filledCount: 3,
      cutoffAt: iso(9),
      estimatedDispatchAt: iso(24),
      forwarder: {
        forwarderUserId: 'usr_forwarder_lotus',
        name: 'Lotus Freight Pvt Ltd',
        contact: 'ops@lotusfreight.example',
        trackingReference: null,
      },
      costModel: {
        currency: 'INR',
        goodsCostMinor: 18_50_000,
        freightMinor: 2_40_000,
        customsDutyMinor: 3_10_000,
        packagingMinor: 45_000,
        localShippingMinor: 60_000,
        totalWeightGrams: 24_500,
      },
      createdAt: iso(-6),
      updatedAt: iso(-1),
    },
    {
      id: 'lot_gz_aug',
      sellerId: 'usr_kaiju',
      name: 'Guangzhou run - August',
      description: 'Closed lot, currently in customs clearance at BLR.',
      status: 'closed',
      stage: 'india_received',
      stageHistory: [
        { stage: 'ordering', enteredAt: iso(-40), note: null, recordedBy: 'usr_kaiju' },
        { stage: 'china_wh_received', enteredAt: iso(-26), note: 'All 18 units checked in.', recordedBy: 'usr_kaiju' },
        { stage: 'dispatched_from_china', enteredAt: iso(-19), note: 'Air freight, AWB on file.', recordedBy: 'usr_kaiju' },
        { stage: 'india_received', enteredAt: iso(-4), note: 'Awaiting customs assessment.', recordedBy: 'usr_kaiju' },
      ],
      fillThreshold: 15,
      filledCount: 18,
      cutoffAt: iso(-28),
      estimatedDispatchAt: iso(3),
      // The escape hatch: a forwarder the seller already works with, not in the
      // directory, with a tracking reference typed in by hand.
      forwarder: {
        forwarderUserId: null,
        name: 'Shenzhen Star Cargo',
        contact: 'wa: +8613800000000',
        trackingReference: 'SSC-2026-08-4471',
      },
      costModel: {
        currency: 'INR',
        goodsCostMinor: 14_20_000,
        freightMinor: 1_95_000,
        customsDutyMinor: 2_40_000,
        packagingMinor: 38_000,
        localShippingMinor: 52_000,
        totalWeightGrams: 19_800,
      },
      createdAt: iso(-40),
      updatedAt: iso(-4),
    },
  ];
}

export function seedListings(): Listing[] {
  return [
    {
      id: 'lst_scale_dragon',
      sellerId: 'usr_kaiju',
      title: '1/7 Scale Dragon Knight - resin statue',
      description: 'Factory sealed. Pre-book against the September Guangzhou lot.',
      category: 'Scale figures',
      condition: 'MISB',
      kind: 'lot_slot',
      status: 'active',
      priceMinor: 1_45_000,
      currency: 'INR',
      quantityAvailable: 17,
      lotId: 'lot_gz_sep',
      photos: [],
      tags: ['resin', 'scale', 'dragon', 'preorder'],
      createdAt: iso(-6),
      updatedAt: iso(-1),
    },
    {
      id: 'lst_mecha_kit',
      sellerId: 'usr_kaiju',
      title: 'HG Mecha model kit - assorted',
      description: 'In stock, ships from Bengaluru within 2 working days.',
      category: 'Model kits',
      condition: 'MIB',
      kind: 'in_stock',
      status: 'active',
      priceMinor: 32_000,
      currency: 'INR',
      quantityAvailable: 6,
      lotId: null,
      photos: [],
      tags: ['mecha', 'kit', 'in-stock'],
      createdAt: iso(-12),
      updatedAt: iso(-2),
    },
  ];
}

export function seedOrders(): Order[] {
  return [
    {
      id: 'ord_1001',
      lotId: 'lot_gz_sep',
      sellerId: 'usr_kaiju',
      buyerId: 'usr_ravi',
      listingId: 'lst_scale_dragon',
      itemName: '1/7 Scale Dragon Knight - resin statue',
      condition: 'MISB',
      quantity: 2,
      unitWeightGrams: 1_400,
      unitPriceMinor: 1_45_000,
      currency: 'INR',
      status: 'confirmed',
      paymentStatus: 'paid',
      escrow: {
        state: 'held',
        amountMinor: 2_90_000,
        heldAt: iso(-5),
        releasedAt: null,
        autoReleaseAt: iso(31),
        disputeId: null,
      },
      completedAt: null,
      createdAt: iso(-5),
      updatedAt: iso(-5),
    },
    {
      id: 'ord_1002',
      lotId: 'lot_gz_sep',
      sellerId: 'usr_kaiju',
      buyerId: 'usr_meera',
      listingId: 'lst_scale_dragon',
      itemName: '1/7 Scale Dragon Knight - resin statue',
      condition: 'MISB',
      quantity: 1,
      unitWeightGrams: 1_400,
      unitPriceMinor: 1_45_000,
      currency: 'INR',
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      escrow: {
        state: 'none',
        amountMinor: 1_45_000,
        heldAt: null,
        releasedAt: null,
        autoReleaseAt: null,
        disputeId: null,
      },
      completedAt: null,
      createdAt: iso(-2),
      updatedAt: iso(-2),
    },
  ];
}
