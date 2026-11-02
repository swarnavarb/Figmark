import type { ArtistProfile, ForwarderProfile, StoreMember, User } from '../../shared/models.js';
import { STORE_RIGHTS, storeOf, type StoreKind } from '../../shared/service-stores.js';
import type { getRepository } from './data/index.js';

/**
 * A demo freight forwarder and a demo artist, for trying the services on a
 * test site.
 *
 * Each store sits on an account of its own that nobody can sign in to - no
 * password, an address that cannot receive mail - because the demo accounts a
 * repository publishes passwords for must never exist in a real database. The
 * person who asked for them is put on both teams with every right instead, so
 * they run the stores from their own account and use any other account as the
 * customer.
 *
 * Running it again puts the stores back as they were and keeps whoever is on
 * the teams, so it is safe to press twice.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

export const DEMO_FORWARDER_ID = 'usr_demo_store_fwd';
export const DEMO_ARTIST_ID = 'usr_demo_store_art';

const trust = { score: 0, completedTransactions: 0, disputesLost: 0, computedAt: null };

function forwarderStore(now: string, team: StoreMember[]): ForwarderProfile {
  const lanes: NonNullable<ForwarderProfile['lanes']> = [
    {
      id: 'demo_lane_gz_blr', originCity: 'Guangzhou', originCountry: 'China', destinationCity: 'Bengaluru', destinationCountry: 'India',
      mode: 'air', ratePerKgMinor: 48_000, minChargeKg: 5, transitDaysMin: 9, transitDaysMax: 12, customsIncluded: true,
      note: 'Weekly consolidation, flies Saturday.', active: true, batteryAllowed: true,
      products: [
        { id: 'demo_p_boxed', name: 'Boxed figures & model kits', basis: 'kg', priceMinor: 45_000, note: 'Retail boxes, repacked flat where possible' },
        { id: 'demo_p_statue', name: 'Resin statues', basis: 'kg', priceMinor: 56_000, note: 'Foam-crated, fragile handling' },
        { id: 'demo_p_battery', name: 'Items with batteries', basis: 'kg', priceMinor: 62_000, note: 'LED bases, power banks — declared' },
        { id: 'demo_p_cards', name: 'Sealed card boxes', basis: 'piece', priceMinor: 18_000, note: 'Per booster box' },
      ],
      volumetric: { divisor: 6000, mode: 'greater', note: 'Statue boxes are re-measured at our warehouse; we repack to cut volume at no charge.' },
      orderInfo: 'Write your request number (FR-…) on every box. Cut-off Thursday 15:00 for the Saturday flight. Free storage for 14 days while you consolidate.',
      terms: 'Liquids, powders, replica weapons and counterfeit goods are refused at the warehouse. Liability without cover is limited to ₹2,000 per parcel.',
      extras: [
        { label: 'Repacking', value: 'Free — original boxes kept if you ask' },
        { label: 'Photos', value: 'Two photos of every parcel on arrival' },
      ],
    },
    {
      id: 'demo_lane_gz_bom_x', originCity: 'Guangzhou', originCountry: 'China', destinationCity: 'Mumbai', destinationCountry: 'India',
      mode: 'express', ratePerKgMinor: 72_000, minChargeKg: 1, transitDaysMin: 4, transitDaysMax: 6, customsIncluded: true,
      note: 'Door to door, any weekday.', active: true, batteryAllowed: false,
      products: [{ id: 'demo_p_docs', name: 'Small parcel up to 1 kg', basis: 'flat', priceMinor: 85_000, note: 'One box, any contents we carry' }],
      volumetric: { divisor: 5000, mode: 'greater', note: '' },
      orderInfo: 'Hand it to us by 14:00 China time for same-day pickup.',
      terms: 'No batteries on express.',
      extras: [],
    },
    {
      id: 'demo_lane_yw_bom', originCity: 'Yiwu', originCountry: 'China', destinationCity: 'Mumbai', destinationCountry: 'India',
      mode: 'sea', ratePerKgMinor: 21_000, minChargeKg: 50, transitDaysMin: 24, transitDaysMax: 30, customsIncluded: true,
      note: 'LCL, fortnightly sailings from Ningbo.', active: true, batteryAllowed: true,
      products: [{ id: 'demo_p_bulk', name: 'Bulk stock over 200 kg', basis: 'kg', priceMinor: 17_500, note: 'For shops restocking' }],
      volumetric: { divisor: 1000, mode: 'over', overFactor: 1.5, note: 'Sea freight is billed by volume once a shipment is very light for its size.' },
      warehouse: { address: 'Gate 4, Futian Market Logistics Hub, Yiwu, Zhejiang 322000', contact: 'Ms. Wang · +86 139 0000 0202', hours: 'Mon–Fri 9:00–17:00' },
      orderInfo: 'Sea parcels go to our Yiwu hub, not Guangzhou. Palletised on arrival.',
      terms: '', extras: [],
    },
  ];
  return {
    companyName: 'Lotus Freight (Demo)',
    directorySlug: 'demo-lotus-freight',
    description: 'A demo forwarding company for trying Figmark services: consolidated air and sea freight from Guangzhou and Yiwu to India, with product prices, volumetric weight and transit cover.',
    contactEmail: 'demo-forwarder@figmark.invalid',
    contactPhone: '',
    trust,
    listedInDirectory: true,
    status: 'approved',
    application: { submittedAt: now, history: [{ at: now, by: 'demo', status: 'approved', note: 'Demo store.' }] },
    tagline: 'Guangzhou & Yiwu → India, consolidated weekly',
    accent: 'aqua',
    city: 'Guangzhou',
    country: 'China',
    businessId: 'DEMO-0001',
    since: 2016,
    links: [],
    team,
    payment: { upiId: 'demo-lotus@upi', accountName: 'Lotus Freight Demo', accountNumber: null, ifsc: null, instructions: 'Demo only — do not send real money. Quote your FR- number.' },
    requestForm: null,
    terms: 'Quotes are valid for 7 days. Weights are taken at our warehouse and are final. Claims under a cover plan follow that plan’s terms.',
    lanes,
    routes: lanes.map((lane) => ({
      originCity: lane.originCity, destinationCity: lane.destinationCity,
      claimedTurnaroundDays: lane.transitDaysMax, ratePerKgMinor: lane.ratePerKgMinor, currency: 'INR',
    })),
    claimedMonthlyCapacityKg: 8_000,
    insurance: [
      { id: 'demo_plan_std', name: 'Transit Shield', coverPercent: 80, premiumBasisPoints: 150, minPremiumMinor: 4_900, maxCoverMinor: 50_00_000, active: true,
        terms: 'Covers loss and visible transit damage from our China warehouse to landing in India. Claims within 72 hours of delivery with unboxing photos.' },
      { id: 'demo_plan_full', name: 'Transit Shield Plus', coverPercent: 100, premiumBasisPoints: 300, minPremiumMinor: 9_900, maxCoverMinor: 2_00_00_000, active: true,
        terms: 'Full declared value, door to door, including box damage on collector packaging. Claims within 7 days of delivery.' },
    ],
    warehouse: {
      address: 'Unit 12, Baiyun Logistics Park, Taihe Town, Baiyun District, Guangzhou 510540',
      contact: 'Mr. Chen · +86 138 0000 0101',
      hours: 'Mon–Sat, 9:00–18:00 CST. Cut-off Thursday 15:00 for the Saturday flight.',
    },
    autoAccept: true,
  };
}

function artistStore(now: string, team: StoreMember[]): ArtistProfile {
  return {
    companyName: 'Inkwell Studio (Demo)',
    directorySlug: 'demo-inkwell-studio',
    description: 'A demo artist studio for trying Figmark services: repaints, custom sculpts and restoration on scale figures, with prices by scale.',
    contactEmail: 'demo-artist@figmark.invalid',
    contactPhone: '',
    trust,
    listedInDirectory: true,
    status: 'approved',
    application: { submittedAt: now, history: [{ at: now, by: 'demo', status: 'approved', note: 'Demo store.' }] },
    tagline: 'Repaints, custom sculpts & restoration',
    accent: 'pink',
    city: 'Pune',
    country: 'India',
    businessId: null,
    since: 2019,
    links: [],
    team,
    payment: { upiId: 'demo-inkwell@upi', accountName: 'Inkwell Studio Demo', accountNumber: null, ifsc: null, instructions: 'Demo only — do not send real money. Quote your AR- number.' },
    requestForm: null,
    terms: 'Half the price is non-refundable once work starts. Two rounds of changes are included; more are quoted separately.',
    specialties: ['Repaint', 'Custom sculpt', 'Restoration', 'Weathering'],
    offerings: [
      {
        id: 'demo_svc_repaint', name: 'Full repaint', active: true, turnaroundDays: 21, priceFromMinor: 6_500_00,
        description: 'Strip, prime and airbrush to your reference. Gloss or matte finish, sealed.',
        products: [
          { id: 'demo_v_16', name: '1/6 scale figure', basis: 'flat', priceMinor: 9_500_00, note: 'Head and body' },
          { id: 'demo_v_112', name: '1/12 scale figure', basis: 'flat', priceMinor: 6_500_00, note: '' },
          { id: 'demo_v_bust', name: 'Bust', basis: 'flat', priceMinor: 4_800_00, note: 'Up to 20 cm' },
        ],
        includes: 'Stripping, priming, airbrushed base, hand-painted detail, sealing, and two rounds of changes.',
        orderInfo: 'Double box it, with your AR- number inside. Accessories in a separate bag.',
        terms: 'Factory paint is removed and cannot be restored.',
        extras: [{ label: 'Progress photos', value: 'At priming, base coat and finish' }],
      },
      {
        id: 'demo_svc_sculpt', name: 'Custom head sculpt', active: true, turnaroundDays: 30, priceFromMinor: 8_000_00,
        description: 'A new head sculpted to your reference, cast and painted.',
        products: [
          { id: 'demo_v_head16', name: '1/6 head', basis: 'flat', priceMinor: 12_000_00, note: 'Sculpt, cast and paint' },
          { id: 'demo_v_head112', name: '1/12 head', basis: 'flat', priceMinor: 8_000_00, note: '' },
        ],
        includes: 'Digital sculpt preview before printing, resin cast, paint.',
        orderInfo: 'Send three reference photos: front, side and three-quarter.',
        terms: '', extras: [],
      },
      {
        id: 'demo_svc_repair', name: 'Breakage repair', active: true, turnaroundDays: 10, priceFromMinor: 1_500_00,
        description: 'Snapped parts pinned, filled and colour-matched.',
        products: [{ id: 'demo_v_part', name: 'Per broken part', basis: 'piece', priceMinor: 1_500_00, note: '' }],
        includes: '', orderInfo: 'Send every broken piece, even the small ones.', terms: '', extras: [],
      },
    ],
    portfolio: [
      { id: 'demo_pic_1', url: 'seed:demo-repaint', caption: 'Weathered armour repaint' },
      { id: 'demo_pic_2', url: 'seed:demo-sculpt', caption: '1/6 custom head' },
      { id: 'demo_pic_3', url: 'seed:demo-repair', caption: 'Kintsugi-style repair' },
    ],
    acceptingWork: true,
    studioAddress: 'Studio 3, Baner Road, Pune 411045 (demo address)',
  };
}

/** Whoever asked, as a member with every right, beside anyone already on the team. */
function teamWith(existing: StoreMember[] | undefined, member: User): StoreMember[] {
  const now = new Date().toISOString();
  const others = (existing ?? []).filter((row) => row.userId !== member.id);
  return [...others, { userId: member.id, displayName: member.displayName, rights: [...STORE_RIGHTS], addedAt: now, addedBy: 'demo', tag: 'Admin' }];
}

async function ensure(repository: Repo, kind: StoreKind, member: User): Promise<{ kind: StoreKind; slug: string; ownerId: string; name: string }> {
  const id = kind === 'forwarder' ? DEMO_FORWARDER_ID : DEMO_ARTIST_ID;
  const now = new Date().toISOString();
  const existing = await repository.getUserById(id);
  const team = teamWith(existing ? storeOf(existing, kind)?.team : [], member);
  const store = kind === 'forwarder' ? forwarderStore(now, team) : artistStore(now, team);
  if (existing) {
    if (kind === 'forwarder') existing.forwarderProfile = store as ForwarderProfile;
    else existing.artistProfile = store as ArtistProfile;
    existing.updatedAt = now;
    await repository.updateUser(existing);
  } else {
    await repository.createUser({
      id,
      email: store.contactEmail,
      phone: null,
      displayName: store.companyName,
      isAdmin: false,
      // Nobody signs in as a demo store: its team does the work.
      passwordHash: null,
      verification: {
        phone: 'unverified', email: 'unverified', governmentId: 'unverified', address: 'unverified', paymentMethod: 'unverified',
        bankAccountMatch: 'unverified', businessRegistration: 'unverified', lastReviewedAt: null, lastReviewedBy: null,
      },
      buyerTrust: trust,
      sellerTrust: { ...trust, onTimeDispatchRate: null, repeatCustomerRate: null },
      sellerProfile: null,
      forwarderProfile: kind === 'forwarder' ? (store as ForwarderProfile) : null,
      ...(kind === 'artist' ? { artistProfile: store as ArtistProfile } : {}),
      suspended: false,
      createdAt: now,
      updatedAt: now,
    } as User);
  }
  return { kind, slug: store.directorySlug, ownerId: id, name: store.companyName };
}

export async function createDemoStores(repository: Repo, member: User) {
  return [await ensure(repository, 'forwarder', member), await ensure(repository, 'artist', member)];
}
