import type { Listing, Lot, Order, PowerSale, PowerSaleItem } from '../../../shared/models.js';

/**
 * Demo fixtures for the Buy tab's two event shelves: lots still filling from
 * a few different shops, and power-sale drops at each point of their story -
 * one live, one about to start, one later in the week.
 *
 * Timed off the real clock rather than the frozen one the other fixtures use,
 * because both shelves are about now: a drop counting down to a date in
 * September is not a drop. The timings are long on purpose - the live drop
 * releases one item every two days, the later one opens two days out - so a
 * deployment seeded today still has something on both shelves next week.
 *
 * Only ever added where missing (see topUpFixtures), like every fixture.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const from = (base: number, ms: number) => new Date(base + ms).toISOString();

/** Three shops' lots, still filling, each with things to buy into it. */
const LOTS: {
  id: string; sellerId: string; name: string; description: string; origin: string;
  originCountry: string; destinationCountry: string; closesInDays: number;
  items: [id: string, title: string, category: string, condition: Listing['condition'], priceMinor: number][];
  buyers: string[];
}[] = [
  {
    id: 'lot_demo_akiba', sellerId: 'usr_tokyoline', name: 'Akihabara October box',
    description: 'Figures and kits from Akihabara, shipped together by sea.', origin: 'Tokyo, JP',
    originCountry: 'Japan', destinationCountry: 'India', closesInDays: 9,
    items: [
      ['lst_demo_akiba_1', 'Nendoroid Frieren — Japan exclusive', 'Scale figures', 'MISB', 4_200_00],
      ['lst_demo_akiba_2', 'MG Gundam Aerial — Ver. Permet', 'Model kits', 'MISB', 6_800_00],
      ['lst_demo_akiba_3', 'Ichiban Kuji — One Piece prize A', 'Scale figures', 'MIB', 5_500_00],
    ],
    buyers: ['usr_b_avradeep', 'usr_b_nikhil', 'usr_b_sana', 'usr_b_rohit', 'usr_b_ipsita', 'usr_b_karan', 'usr_b_meghna'],
  },
  {
    id: 'lot_demo_kicks', sellerId: 'usr_sneakervault', name: 'Nike JP restock run',
    description: 'Japan-only colourways, consolidated in Osaka.', origin: 'Osaka, JP',
    originCountry: 'Japan', destinationCountry: 'India', closesInDays: 5,
    items: [
      ['lst_demo_kicks_1', 'Dunk Low "Setsubun" — UK 9', 'Sneakers', 'MIB', 14_500_00],
      ['lst_demo_kicks_2', 'Air Max 1 "Kokunai" — UK 8', 'Sneakers', 'MIB', 12_900_00],
    ],
    buyers: ['usr_b_tanmay', 'usr_b_farah', 'usr_b_dev', 'usr_b_priyanka'],
  },
  {
    id: 'lot_demo_court', sellerId: 'usr_courtside', name: 'US pairs — November consolidation',
    description: 'Pairs bought in the US, flown in together.', origin: 'Portland, US',
    originCountry: 'United States', destinationCountry: 'India', closesInDays: 14,
    items: [
      ['lst_demo_court_1', 'Jordan 4 "Military Blue" — UK 10', 'Sneakers', 'MIB', 21_000_00],
      ['lst_demo_court_2', 'New Balance 990v6 — UK 9', 'Sneakers', 'MIB', 17_500_00],
    ],
    buyers: ['usr_b_vikram', 'usr_b_aisha'],
  },
];

export function seedShowcaseLots(base = Date.now()): Lot[] {
  return LOTS.map((lot) => ({
    id: lot.id,
    sellerId: lot.sellerId,
    name: lot.name,
    description: lot.description,
    origin: lot.origin,
    originCountry: lot.originCountry,
    destinationCountry: lot.destinationCountry,
    supplier: null,
    status: 'open',
    stage: 'ordering',
    stageHistory: [{ stage: 'ordering', enteredAt: from(base, -6 * DAY), note: 'Lot opened.', recordedBy: lot.sellerId }],
    estimatedDispatchAt: from(base, lot.closesInDays * DAY),
    forwarder: null,
    costModel: {
      currency: 'INR', goodsCostMinor: 0, freightMinor: 0, customsDutyMinor: 0,
      packagingMinor: 0, localShippingMinor: 0, totalWeightGrams: 0,
    },
    createdAt: from(base, -6 * DAY),
    updatedAt: from(base, -1 * DAY),
  }));
}

export function seedShowcaseListings(base = Date.now()): Listing[] {
  return LOTS.flatMap((lot) => lot.items.map(([id, title, category, condition, priceMinor], index) => ({
    id,
    sellerId: lot.sellerId,
    title,
    description: `Travelling in ${lot.name}. Order now and it ships with everyone else's.`,
    category,
    condition,
    status: 'active' as const,
    priceMinor,
    currency: 'INR',
    quantityAvailable: 6,
    preOrder: null,
    lotId: lot.id,
    sourcing: 'import' as const,
    bundle: false,
    photos: [],
    tags: ['import', 'pre-order'],
    likeCount: 4 + index * 3,
    viewCount: 60 + index * 25,
    soldCount: lot.buyers.filter((_, at) => at % lot.items.length === index).length,
    bumpedAt: null,
    createdAt: from(base, -6 * DAY + index * HOUR),
    updatedAt: from(base, -1 * DAY),
  })));
}

/** The people already in each box: one paid order each, spread over its items. */
export function seedShowcaseOrders(base = Date.now()): Order[] {
  return LOTS.flatMap((lot) => lot.buyers.map((buyerId, at) => {
    const [listingId, itemName, , condition, priceMinor] = lot.items[at % lot.items.length]!;
    const placed = from(base, -5 * DAY + at * 3 * HOUR);
    return {
      id: `ord_demo_${lot.id.replace('lot_demo_', '')}_${at + 1}`,
      lotId: lot.id,
      sellerId: lot.sellerId,
      buyerId,
      listingId,
      itemName,
      condition,
      quantity: 1,
      unitWeightGrams: 900,
      unitPriceMinor: priceMinor,
      currency: 'INR',
      status: 'confirmed' as const,
      paymentStatus: 'paid' as const,
      hold: {
        state: 'held' as const, amountMinor: priceMinor, heldAt: placed,
        releasedAt: null, autoReleaseAt: null, disputeId: null,
      },
      stage: 'ordering' as const,
      stageHistory: [{ stage: 'ordering' as const, enteredAt: placed, note: 'Order placed.', recordedBy: buyerId }],
      checkpoints: {},
      completedAt: null,
      placedAt: placed,
      createdAt: placed,
      updatedAt: placed,
    } as Order;
  }));
}

function item(id: string, title: string, category: string, priceMinor: number, listPriceMinor: number): PowerSaleItem {
  return {
    id, title, description: `${title}. One of a kind — gone when it is gone.`, category, condition: 'MISB',
    priceMinor, listPriceMinor, quantity: 1, allowMultiple: false,
    postedAt: null, windowEndsAt: null, liftedAt: null, listingId: null,
  };
}

/**
 * Three drops, each at a different point of its story. All start
 * unannounced; the first look at the shelf (or the minute timer) posts each
 * one's opening message to its shop's channel and sets it going.
 */
export function seedShowcaseSales(base = Date.now()): PowerSale[] {
  const sale = (over: Partial<PowerSale> & Pick<PowerSale, 'id' | 'sellerId' | 'name' | 'openingBody' | 'items'>): PowerSale => ({
    status: 'scheduled',
    openingAt: from(base, -5 * 60_000),
    leadMinutes: 30,
    everyMinutes: 60,
    windowMinutes: 120,
    closingBody: 'That is the lot — thank you for coming!',
    openedAt: null,
    closedAt: null,
    afterWindow: { channel: true, feed: false },
    reminders: [],
    remindedAt: null,
    createdAt: from(base, -1 * DAY),
    updatedAt: from(base, -1 * DAY),
    ...over,
  });
  return [
    // Live now: its first item is already out, and one more every two days.
    sale({
      id: 'pws_demo_live', sellerId: 'usr_kaiju', name: 'Kaiju Midnight Vault',
      openingBody: '🌙 Midnight Vault is open — grails from the back room, one at a time. Members get first dibs!',
      openingAt: from(base, -2 * HOUR),
      leadMinutes: 30,
      everyMinutes: 2 * 24 * 60,
      windowMinutes: 3 * 24 * 60,
      items: [
        item('psi_demo_live_1', 'Godzilla 1954 — Toho vinyl, 1st run', 'Scale figures', 12_500_00, 15_000_00),
        item('psi_demo_live_2', 'Ultraman Tiga — S.H.Figuarts Shinkocchou', 'Scale figures', 9_800_00, 11_500_00),
        item('psi_demo_live_3', 'Mechagodzilla 1974 — X-Plus', 'Scale figures', 14_000_00, 16_500_00),
        item('psi_demo_live_4', 'Mothra Larva — Bandai Movie Monster', 'Scale figures', 2_400_00, 2_900_00),
      ],
    }),
    // About to start: announced now, first item in three hours.
    sale({
      id: 'pws_demo_soon', sellerId: 'usr_tokyoline', name: 'Friday Night Grails',
      openingBody: '⚡ Friday Night Grails starts in 3 hours! Five pieces, members\' price for two hours each. Tap Remind me.',
      leadMinutes: 3 * 60,
      everyMinutes: 30,
      windowMinutes: 120,
      items: [
        item('psi_demo_soon_1', 'Evangelion Unit-01 — Metal Build', 'Scale figures', 32_000_00, 38_000_00),
        item('psi_demo_soon_2', 'PG Gundam RX-78-2 Unleashed', 'Model kits', 24_500_00, 28_000_00),
        item('psi_demo_soon_3', 'Chainsaw Man — 1/7 Makima', 'Scale figures', 15_500_00, 18_000_00),
        item('psi_demo_soon_4', 'Dragon Ball — SHF Ultra Instinct Goku', 'Scale figures', 6_200_00, 7_200_00),
        item('psi_demo_soon_5', 'Mystery Akiba box', 'Scale figures', 4_999_00, 4_999_00),
      ],
    }),
    // Later this week: announced now, first item in two days.
    sale({
      id: 'pws_demo_later', sellerId: 'usr_sneakervault', name: 'Weekend Heat',
      openingBody: '🔥 Weekend Heat drops Sunday — four pairs you will not see again this year. Set a reminder.',
      leadMinutes: 2 * 24 * 60,
      everyMinutes: 20,
      windowMinutes: 60,
      items: [
        item('psi_demo_later_1', 'Travis Scott x Jordan 1 Low "Olive" — UK 9', 'Sneakers', 68_000_00, 78_000_00),
        item('psi_demo_later_2', 'Dunk Low "Panda" — UK 8', 'Sneakers', 9_500_00, 11_000_00),
        item('psi_demo_later_3', 'Yeezy 350 "Onyx" — UK 10', 'Sneakers', 21_000_00, 24_000_00),
        item('psi_demo_later_4', 'Samba OG — UK 9', 'Sneakers', 10_500_00, 12_000_00),
      ],
    }),
  ];
}
