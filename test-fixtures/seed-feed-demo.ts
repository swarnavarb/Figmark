import type { Post } from '../shared/models.js';
import type { PostHotspot, ReactionKind, StoredComment } from '../shared/social.js';
import type { PostReferral, ReferralMilestone, ReferralTarget, ReferralTiming } from '../shared/referral.js';
import { reactorIds, seedArt } from './seed.js';

/**
 * Demo fixtures for Discover and the feed: a post for each thing they do.
 *
 * - Two open debates, each side an item that can be bought - one voted in by
 *   Sana, whom the demo account follows, so the card says she took part.
 * - A debate the demo account voted in that closed a few hours ago: the first
 *   feed or Discover read tells the voters which side won, and it comes back
 *   on top of the demo feed with its result.
 * - Two shelves (flexes) with pieces tagged for sale in other people's shops,
 *   which fill the "Spotted & buyable" rail and lead "This week".
 * - A thread whose conversation took off, with @mentions in it.
 * - A post that @mentions the demo account (@arjun).
 * - Three drops from Tokyo Line inside two hours, which the feed folds into one.
 * - New posts from a shop and a person the demo account does not follow, which
 *   rise on Discover.
 * - Four Spread the word drives, so Discover's "Spread the word" section and
 *   the shops' banners have something in them: one counting during Kaiju's
 *   live drop, one filling the room before Tokyo Line's, one on a single
 *   Sneaker Vault pair, and a shop-wide one from Gadget Grid with goals.
 * - #topics spread across all of them - sneakers, gunpla, shelfie - so the
 *   topic chips and the tag pages have posts behind them.
 *
 * Timed off the real clock, like the showcase lots: rising means under two
 * days old and a result is news for three, so a frozen date would show none of
 * it. Only ever added where missing (see topUpFixtures), so a deployment keeps
 * the ages it was seeded with and the demo ages with it.
 */

const HOUR = 3_600_000;
const SHOPS = new Set(['usr_kaiju', 'usr_tokyoline', 'usr_sneakervault', 'usr_gadgetgrid', 'usr_courtside']);
const KINDS: ReactionKind[] = ['love', 'fire', 'love', 'clap', 'wow', 'love', 'fire', 'haha'];

interface DemoSeed {
  id: string;
  channelId: string;
  channel?: Post['channel'];
  kind?: Post['kind'];
  authorId: string;
  authorName: string;
  body: string;
  hoursAgo: number;
  listingId?: string;
  /** Captions and gradients for the photos. A debate has two; a flex its shelf. */
  art?: [string, string, string][];
  /** How many of the seeded customers reacted, and who else by id. */
  reactors?: number;
  alsoReacted?: string[];
  talk?: [authorId: string, authorName: string, body: string][];
  /** Answers, and who voted for each by id: the first `n` of the customers, or ids named. */
  poll?: { options: string[]; votes: (number | string[])[]; closesInHours: number };
  debate?: [string | null, string | null];
  hotspots?: PostHotspot[];
  /** A Spread the word drive this post runs. Times are hours from now; sharers and joins hours ago. */
  spread?: {
    target: ReferralTarget;
    timing: ReferralTiming;
    startsInHours: number;
    endsInHours: number;
    rewardMinor: number;
    maxPerPerson: number;
    topPrizeMinor: number;
    welcomeMinor?: number;
    milestones?: ReferralMilestone[];
    terms?: string;
    sharers: [userId: string, name: string, hoursAgo: number][];
    /** New accounts, whose link brought them, and when. */
    joins: [userId: string, sharerId: string, hoursAgo: number][];
  };
  /** On-screen counters, so the reading signals have something to weigh. */
  seen?: { views: number; opens: number; dwellMs: number };
}

const sneakerShelf: PostHotspot[] = [
  { photo: 0, x: 0.22, y: 0.32, label: 'Jordan 4 Military Blue', status: 'for_sale', listingId: 'lst_demo_court_1' },
  { photo: 0, x: 0.7, y: 0.3, label: 'Dunk Low Setsubun', status: 'for_sale', listingId: 'lst_demo_kicks_1' },
  { photo: 0, x: 0.3, y: 0.72, label: 'Air Jordan 1 Chicago', status: 'owned', listingId: null },
  { photo: 0, x: 0.74, y: 0.7, label: 'New Balance 990v6', status: 'wishlist', listingId: null },
];

const gunplaShelf: PostHotspot[] = [
  { photo: 0, x: 0.5, y: 0.28, label: 'MG Gundam Aerial', status: 'for_sale', listingId: 'lst_demo_akiba_2' },
  { photo: 0, x: 0.24, y: 0.66, label: 'RG Strike Freedom', status: 'owned', listingId: null },
  { photo: 0, x: 0.76, y: 0.66, label: 'HG Calibarn', status: 'owned', listingId: null },
  { photo: 1, x: 0.5, y: 0.5, label: 'PG Unicorn', status: 'wishlist', listingId: null },
];

/** The shops the drives belong to, as the posts name them. */
const STORES: Record<string, { name: string; handle: string }> = {
  usr_kaiju: { name: 'Kaiju Imports', handle: 'kaiju_imports' },
  usr_tokyoline: { name: 'Tokyo Line', handle: 'tokyo_line' },
  usr_sneakervault: { name: 'Sneaker Vault', handle: 'sneaker_vault' },
  usr_gadgetgrid: { name: 'Gadget Grid', handle: 'gadget_grid' },
  usr_courtside: { name: 'Courtside Kicks', handle: 'courtside_kicks' },
};

const DEMO: DemoSeed[] = [
  /* Spread the word drives: Discover's own section, and each shop's banner. */
  {
    // During Kaiju's live drop (pws_demo_live): counting until its last window shuts.
    id: 'pst_fd_spread_vault', channelId: 'usr_kaiju', authorId: 'usr_kaiju', authorName: 'Kaiju Imports',
    body: '📣 Midnight Vault is live. Bring a friend who is new to Figmark and earn ₹150 store credit for each one - top sharer takes ₹1,000 more. #kaiju',
    hoursAgo: 1.5,
    reactors: 8,
    spread: {
      target: { kind: 'drop', saleId: 'pws_demo_live', name: 'Kaiju Midnight Vault' }, timing: 'during',
      startsInHours: -1.5, endsInHours: 7 * 24 - 1.5,
      rewardMinor: 150_00, maxPerPerson: 10, topPrizeMinor: 1_000_00, welcomeMinor: 100_00,
      sharers: [['usr_b_vikram', 'Vikram Chauhan', 1.4], ['usr_b_rohit', 'Rohit Deshmukh', 1.2], ['usr_b_sana', 'Sana Qureshi', 0.8]],
      joins: [['usr_b_sourav', 'usr_b_vikram', 1], ['usr_b_neha', 'usr_b_vikram', 0.6], ['usr_b_priyanka', 'usr_b_rohit', 0.4]],
    },
    seen: { views: 190, opens: 34, dwellMs: 700_000 },
  },
  {
    // Before Tokyo Line's drop (pws_demo_soon): fill the room, ends as the first item goes out.
    id: 'pst_fd_spread_grails', channelId: 'usr_tokyoline', authorId: 'usr_tokyoline', authorName: 'Tokyo Line',
    body: '⚡ Friday Night Grails in under 3 hours. Every new collector you bring before it starts is ₹100 credit - and at 10 new buyers the Mystery Akiba box drops 15 minutes early for everyone who shared.',
    hoursAgo: 0.5,
    reactors: 6,
    spread: {
      target: { kind: 'drop', saleId: 'pws_demo_soon', name: 'Friday Night Grails' }, timing: 'before',
      startsInHours: -0.5, endsInHours: 2.9,
      rewardMinor: 100_00, maxPerPerson: 5, topPrizeMinor: 0,
      milestones: [
        { at: 10, creditMinor: 0, perk: 'The drop opens 15 minutes early for sharers' },
        { at: 25, creditMinor: 250_00, perk: 'A mystery item added to the drop' },
      ],
      sharers: [['usr_b_karan', 'Karan Malhotra', 0.4], ['usr_b_meghna', 'Meghna Iyer', 0.3]],
      joins: [['usr_b_avradeep', 'usr_b_karan', 0.2]],
    },
  },
  {
    // One pair, shop-picked: the Setsubun Dunk.
    id: 'pst_fd_spread_dunk', channelId: 'usr_sneakervault', authorId: 'usr_sneakervault', authorName: 'Sneaker Vault',
    body: 'Know someone hunting Setsubun Dunks? Send them our link - ₹200 credit for every new buyer, up to five. Three days only. #sneakers',
    hoursAgo: 20,
    reactors: 7,
    spread: {
      target: { kind: 'listing', listingId: 'lst_demo_kicks_1', title: 'Dunk Low "Setsubun" — UK 9' }, timing: 'now',
      startsInHours: -20, endsInHours: 52,
      rewardMinor: 200_00, maxPerPerson: 5, topPrizeMinor: 500_00,
      terms: 'New accounts only, verified by phone. Credit is spent at Sneaker Vault.',
      sharers: [['usr_b_farah', 'Farah Sheikh', 19], ['usr_b_ipsita', 'Ipsita Nair', 15], ['usr_b_tanmay', 'Tanmay Bose', 9], ['usr_b_aisha', 'Aisha Fernandes', 4]],
      joins: [
        ['usr_b_dev', 'usr_b_farah', 18], ['usr_b_nikhil', 'usr_b_farah', 12],
        ['usr_b_sourav', 'usr_b_ipsita', 10], ['usr_b_neha', 'usr_b_tanmay', 6],
      ],
    },
    seen: { views: 240, opens: 41, dwellMs: 820_000 },
  },
  {
    // The whole shop, a week long, with goals everyone unlocks together.
    id: 'pst_fd_spread_gadget', channelId: 'usr_gadgetgrid', authorId: 'usr_gadgetgrid', authorName: 'Gadget Grid',
    body: 'Spread the word week 🎧 Bring friends who are new to Figmark: ₹75 credit each, ₹50 welcome credit for them, and free shipping for everybody once we hit 20. #gadgets',
    hoursAgo: 30,
    reactors: 5,
    spread: {
      target: { kind: 'shop' }, timing: 'now',
      startsInHours: -30, endsInHours: 7 * 24 - 30,
      rewardMinor: 75_00, maxPerPerson: 20, topPrizeMinor: 750_00, welcomeMinor: 50_00,
      milestones: [
        { at: 5, creditMinor: 50_00, perk: '' },
        { at: 20, creditMinor: 0, perk: 'Free shipping on every order for a week' },
      ],
      sharers: [['usr_b_dev', 'Dev Anand Rao', 28], ['usr_b_priyanka', 'Priyanka Sen', 22]],
      joins: [['usr_b_avradeep', 'usr_b_dev', 26], ['usr_b_sourav', 'usr_b_dev', 20], ['usr_b_neha', 'usr_b_priyanka', 14]],
    },
  },

  /* Debates. */
  {
    id: 'pst_fd_debate_shelf', channelId: 'usr_b_karan', authorId: 'usr_b_karan', authorName: 'Karan Malhotra',
    body: 'One slot left on the top shelf. Frieren Nendoroid or the MG Aerial? #nendoroid #gunpla',
    hoursAgo: 6,
    art: [['Frieren', '#7C3AED', '#06D6E7'], ['Aerial', '#2563EB', '#C026D3']],
    poll: { options: ['Frieren', 'Aerial'], votes: [7, ['usr_b_sana', 'usr_b_rohit', 'usr_b_tanmay', 'usr_b_dev']], closesInHours: 42 },
    debate: ['lst_demo_akiba_1', 'lst_demo_akiba_2'],
    reactors: 9,
    talk: [
      ['usr_b_rohit', 'Rohit Deshmukh', 'Aerial, and it is not close. The Permet finish is something else.'],
      ['usr_b_meghna', 'Meghna Iyer', 'Frieren. A shelf needs a face on it.'],
    ],
    seen: { views: 140, opens: 22, dwellMs: 600_000 },
  },
  {
    id: 'pst_fd_debate_kicks', channelId: 'usr_b_farah', authorId: 'usr_b_farah', authorName: 'Farah Sheikh',
    body: 'Japan-only pairs, one budget. Setsubun Dunk or Kokunai Air Max? #sneakers',
    hoursAgo: 26,
    art: [['Setsubun', '#FF5B1F', '#FF2E7E'], ['Kokunai', '#65A30D', '#0E7490']],
    poll: { options: ['Setsubun Dunk', 'Kokunai Air Max'], votes: [6, 8], closesInHours: 46 },
    debate: ['lst_demo_kicks_1', 'lst_demo_kicks_2'],
    reactors: 11,
    seen: { views: 210, opens: 30, dwellMs: 900_000 },
  },
  {
    // Closed while the demo was away, and voted in by the demo account itself:
    // the one seeded vote of its own, so there is a result for it to hear about.
    id: 'pst_fd_debate_closed', channelId: 'usr_b_meghna', authorId: 'usr_b_meghna', authorName: 'Meghna Iyer',
    body: 'Settle it: Japanese box art or the Western release? #boxart',
    hoursAgo: 75,
    art: [['Japanese box', '#0891B2', '#2563EB'], ['Western box', '#6D28D9', '#A21CAF']],
    poll: { options: ['Japanese', 'Western'], votes: [['usr_demo', 'usr_b_sana', 'usr_b_ipsita', 'usr_b_karan', 'usr_b_vikram'], 3], closesInHours: -4 },
    debate: [null, null],
    reactors: 8,
  },

  /* Shelves. */
  {
    id: 'pst_fd_flex_kicks', channelId: 'usr_b_ipsita', authorId: 'usr_b_ipsita', authorName: 'Ipsita Nair',
    body: 'This month\'s rotation 👟 Two of these are still up for grabs if you are quick. #sneakers #shelfie',
    hoursAgo: 30,
    art: [['Rotation', '#FF5B1F', '#C026D3'], ['Close-up', '#1F2937', '#FF2E7E']],
    hotspots: sneakerShelf,
    reactors: 15,
    alsoReacted: ['usr_b_sana'],
    talk: [['usr_b_aisha', 'Aisha Fernandes', 'The Military Blues on the left 😮‍💨']],
    seen: { views: 320, opens: 48, dwellMs: 1_400_000 },
  },
  {
    id: 'pst_fd_flex_gunpla', channelId: 'usr_b_rohit', authorId: 'usr_b_rohit', authorName: 'Rohit Deshmukh',
    body: 'Gunpla wall is finally done. Took a year of lots. #gunpla #shelfie',
    hoursAgo: 80,
    art: [['Gunpla wall', '#2563EB', '#0E7490'], ['Top shelf', '#6D28D9', '#2563EB']],
    hotspots: gunplaShelf,
    reactors: 13,
    seen: { views: 260, opens: 31, dwellMs: 1_100_000 },
  },

  /* A conversation that took off, with mentions in it. */
  {
    id: 'pst_fd_thread_customs', channelId: 'usr_b_nikhil', authorId: 'usr_b_nikhil', authorName: 'Nikhil Raghavan',
    body: 'Is duty on figures getting worse or is it just me? Paid 38% on a resin kit last month. #customs',
    hoursAgo: 20,
    reactors: 6,
    talk: [
      ['usr_b_tanmay', 'Tanmay Bose', 'Same. Declared value matters more than the category now.'],
      ['usr_b_vikram', 'Vikram Chauhan', '@kaiju_imports does the lot price include duty or is it on us?'],
      ['usr_kaiju', 'Kaiju Imports', 'Included in the lot price for everything in the September run, @vikram.'],
      ['usr_b_neha', 'Neha Kulkarni', 'Sea freight lots have been kinder to me than air.'],
      ['usr_b_dev', 'Dev Anand Rao', 'Bookmarking this. First import is on its way.'],
    ],
    seen: { views: 180, opens: 40, dwellMs: 1_000_000 },
  },

  /* Somebody naming the demo account. */
  {
    id: 'pst_fd_mention', channelId: 'usr_b_aisha', authorId: 'usr_b_aisha', authorName: 'Aisha Fernandes',
    body: '@arjun you were asking about Setsubun Dunks - @sneaker_vault has them in the Nike JP run. #sneakers',
    hoursAgo: 9,
    reactors: 3,
  },

  /* A followed shop dropping three things in a row: the feed folds them. */
  ...([
    ['pst_fd_drop_1', 'lst_demo_akiba_3', 'Ichiban Kuji One Piece prize A is in the Akihabara box. Two slots.', 3],
    ['pst_fd_drop_2', 'lst_demo_akiba_2', 'MG Aerial (Permet) added to the same box. Ships with the lot.', 3.5],
    ['pst_fd_drop_3', 'lst_demo_akiba_1', 'And the Japan-exclusive Frieren Nendoroid. #nendoroid', 4],
  ] as const).map(([id, listingId, body, hoursAgo]): DemoSeed => ({
    id, channelId: 'usr_tokyoline', kind: 'sale', authorId: 'usr_tokyoline', authorName: 'Tokyo Line',
    body, listingId, hoursAgo, reactors: 4,
  })),

  /* New, from people the demo account does not follow: rising. */
  {
    id: 'pst_fd_rising_court', channelId: 'usr_courtside', kind: 'sale', authorId: 'usr_courtside', authorName: 'Courtside Kicks',
    body: 'Jordan 4 "Military Blue" landed from Portland. UK 10 only, one pair. #sneakers',
    listingId: 'lst_demo_court_1', hoursAgo: 3, reactors: 5,
  },
  {
    id: 'pst_fd_rising_first', channelId: 'usr_b_dev', authorId: 'usr_b_dev', authorName: 'Dev Anand Rao',
    body: 'My first import arrived and the box survived 🥹 Thank you @kaiju_imports. #firstimport',
    hoursAgo: 11,
    art: [['First import', '#65A30D', '#0891B2']],
    reactors: 4,
  },
  {
    id: 'pst_fd_tip', channelId: 'usr_b_tanmay', authorId: 'usr_b_tanmay', authorName: 'Tanmay Bose',
    body: 'Panel lining tip: a 0.3 fineliner, then wipe back with a cotton bud and a drop of thinner. #gunpla',
    hoursAgo: 40,
    reactors: 7,
  },

  /* Somebody the demo account follows, posting just now. */
  {
    id: 'pst_fd_sana_now', channelId: 'usr_b_sana', authorId: 'usr_b_sana', authorName: 'Sana Qureshi',
    body: 'Weekend shelf reshuffle. The Frieren finally has company. #shelfie #nendoroid',
    hoursAgo: 1,
    art: [['Reshuffle', '#7C3AED', '#FF2E7E']],
    reactors: 5,
  },
];

export function seedFeedDemoPosts(base = Date.now()): Post[] {
  const customers = reactorIds();
  return DEMO.map((entry, postIndex) => {
    const at = new Date(base - entry.hoursAgo * HOUR).toISOString();
    const reactorList = [
      ...customers.filter((id) => id !== entry.authorId && !(entry.alsoReacted ?? []).includes(id)).slice(0, entry.reactors ?? 0),
      ...(entry.alsoReacted ?? []),
    ];
    const reactions = reactorList.map((userId, index) => ({ userId, kind: KINDS[(index + postIndex) % KINDS.length]!, at }));
    const comments: StoredComment[] = (entry.talk ?? []).map(([authorId, authorName, body], index) => ({
      id: `cmt_${entry.id}_${index}`,
      authorId,
      authorName,
      // A shop answering speaks as the shop.
      ...(SHOPS.has(authorId) ? { asStore: authorId } : {}),
      body,
      parentId: null,
      likedBy: reactorList.slice(0, 2),
      createdAt: new Date(base - entry.hoursAgo * HOUR + (index + 1) * 20 * 60_000).toISOString(),
    }));
    // Voters: a count takes that many customers who are not the author, after
    // the ones already named for an earlier answer.
    const named = new Set((entry.poll?.votes ?? []).flatMap((votes) => (Array.isArray(votes) ? votes : [])));
    const pool = customers.filter((id) => id !== entry.authorId && !named.has(id));
    let next = 0;
    const poll = entry.poll
      ? {
          options: entry.poll.options.map((label, index) => {
            const votes = entry.poll!.votes[index]!;
            const voterIds = Array.isArray(votes) ? votes : pool.slice(next, (next += votes));
            return { id: `opt_${index + 1}`, label, voterIds };
          }),
          closesAt: new Date(base + entry.poll.closesInHours * HOUR).toISOString(),
        }
      : null;
    const when = (hours: number) => new Date(base + hours * HOUR).toISOString();
    const store = STORES[entry.channelId];
    const referral: PostReferral | null = entry.spread && store
      ? {
          storeId: entry.channelId, storeName: store.name, storeHandle: store.handle,
          target: entry.spread.target, timing: entry.spread.timing,
          startsAt: when(entry.spread.startsInHours), endsAt: when(entry.spread.endsInHours),
          rewardMinor: entry.spread.rewardMinor, maxPerPerson: entry.spread.maxPerPerson,
          topPrizeMinor: entry.spread.topPrizeMinor, terms: entry.spread.terms ?? null,
          sharers: entry.spread.sharers.map(([userId, name, hoursAgo]) => ({ userId, name, at: when(-hoursAgo) })),
          joins: entry.spread.joins.map(([userId, sharerId, hoursAgo]) => ({ userId, sharerId, at: when(-hoursAgo) })),
          ...(entry.spread.welcomeMinor ? { welcomeMinor: entry.spread.welcomeMinor } : {}),
          ...(entry.spread.milestones
            ? { milestones: entry.spread.milestones, reached: entry.spread.milestones.map(() => null) }
            : {}),
        }
      : null;
    const photoUrls = (entry.art ?? []).map((art, index) => seedArt(art, postIndex * 10 + index));
    return {
      id: entry.id,
      channelId: entry.channelId,
      channel: entry.channel ?? 'seller',
      kind: entry.kind ?? 'update',
      authorId: entry.authorId,
      authorName: entry.authorName,
      body: entry.body,
      listingId: entry.listingId ?? null,
      photoUrl: photoUrls[0] ?? null,
      photoUrls,
      likeCount: reactions.length,
      replyCount: comments.length,
      reactions,
      comments,
      shareCount: Math.floor(reactions.length / 4),
      poll,
      vibe: null,
      voice: 'store',
      reach: 'feed',
      announcement: false,
      replyTo: null,
      ...(entry.debate ? { debate: { listingIds: entry.debate } } : {}),
      ...(entry.hotspots ? { flex: { hotspots: entry.hotspots } } : {}),
      ...(referral ? { referral, hostShopId: referral.storeId } : {}),
      ...(entry.seen ?? {}),
      resultsSentAt: null,
      createdAt: at,
      updatedAt: at,
    };
  });
}
