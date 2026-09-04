import type { Listing, Lot, Order, TrustSignals, User, VerificationState } from '../../../shared/models.js';
import type { UserRole } from '../../../shared/enums.js';
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

/** Nothing is verified yet - the flow lands with real auth, not before. */
function unverified(): VerificationState {
  return {
    phone: 'unverified',
    email: 'unverified',
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
  return {
    score: 0,
    completedTransactions: 0,
    disputesLost: 0,
    onTimeDispatchRate: null,
    repeatCustomerRate: null,
    computedAt: null,
  };
}

function makeUser(input: {
  id: string;
  username: string;
  displayName: string;
  email: string;
  role: UserRole;
  sellerProfile?: User['sellerProfile'];
}): User {
  return {
    id: input.id,
    username: input.username,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    passwordHash: hashPassword(DEMO_PASSWORD),
    verification: unverified(),
    trust: noTrust(),
    sellerProfile: input.sellerProfile ?? null,
    suspended: false,
    createdAt: iso(-30),
    updatedAt: iso(-30),
  };
}

export function seedUsers(): User[] {
  return [
    makeUser({
      id: 'usr_admin',
      username: 'admin',
      displayName: 'Platform Admin',
      email: 'admin@figmark.example',
      role: 'admin',
    }),
    makeUser({
      id: 'usr_seller_kaiju',
      username: 'kaiju',
      displayName: 'Kaiju Imports',
      email: 'kaiju@figmark.example',
      role: 'seller',
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
      id: 'usr_buyer_ravi',
      username: 'ravi',
      displayName: 'Ravi K.',
      email: 'ravi@figmark.example',
      role: 'buyer',
    }),
    makeUser({
      id: 'usr_buyer_meera',
      username: 'meera',
      displayName: 'Meera S.',
      email: 'meera@figmark.example',
      role: 'buyer',
    }),
  ];
}

export function seedLots(): Lot[] {
  return [
    {
      id: 'lot_gz_sep',
      sellerId: 'usr_seller_kaiju',
      name: 'Guangzhou run - September',
      description: 'Consolidated shipment closing end of month. Air freight, QC before repack.',
      status: 'open',
      stage: 'ordering',
      stageHistory: [
        { stage: 'ordering', enteredAt: iso(-6), note: 'Lot opened for pre-booking.', recordedBy: 'usr_seller_kaiju' },
      ],
      fillThreshold: 20,
      filledCount: 3,
      cutoffAt: iso(9),
      estimatedDispatchAt: iso(24),
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
      sellerId: 'usr_seller_kaiju',
      name: 'Guangzhou run - August',
      description: 'Closed lot, currently in customs clearance at BLR.',
      status: 'closed',
      stage: 'india_received',
      stageHistory: [
        { stage: 'ordering', enteredAt: iso(-40), note: null, recordedBy: 'usr_seller_kaiju' },
        { stage: 'china_wh_received', enteredAt: iso(-26), note: 'All 18 units checked in.', recordedBy: 'usr_seller_kaiju' },
        { stage: 'dispatched_from_china', enteredAt: iso(-19), note: 'Air freight, AWB on file.', recordedBy: 'usr_seller_kaiju' },
        { stage: 'india_received', enteredAt: iso(-4), note: 'Awaiting customs assessment.', recordedBy: 'usr_seller_kaiju' },
      ],
      fillThreshold: 15,
      filledCount: 18,
      cutoffAt: iso(-28),
      estimatedDispatchAt: iso(3),
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
      sellerId: 'usr_seller_kaiju',
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
      sellerId: 'usr_seller_kaiju',
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
      sellerId: 'usr_seller_kaiju',
      buyerId: 'usr_buyer_ravi',
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
      sellerId: 'usr_seller_kaiju',
      buyerId: 'usr_buyer_meera',
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
