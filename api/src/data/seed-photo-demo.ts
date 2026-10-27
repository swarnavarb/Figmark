import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ListingStatus } from '../../../shared/enums.js';
import type { Listing, Post } from '../../../shared/models.js';
import { getPhotoStore } from '../storage/index.js';
import type { Repository } from './repository.js';

/**
 * Demo fixtures for "Seen for sale": posts whose photos are, or were, for sale.
 *
 * Unlike every other fixture these need real pictures in the photo store,
 * because the bar under a photo reads the stored bytes - a seeded SVG has none
 * to read. So the photos ship with the API (api/assets/demo), are uploaded on
 * first boot, and the listings and posts are written pointing at them.
 *
 * - A shop's post of its Frieren restock: the same picture as its live listing,
 *   and as another shop's sold-out one.
 * - A collector's haul post: the three items together, then each on its own.
 *   The shots of one item find their listings by picture; the shot of all
 *   three finds them only when Claude reads it (ANTHROPIC_API_KEY).
 * - A forum question about a Pikachu: sold before by two shops, on sale nowhere.
 * - A photo from a con of a Nike Air Max and a McFarlane Spawn: the exact
 *   items are listed by one shop each, and other shops list Nike and McFarlane
 *   - so the bar names them as likely to get one, then the sneaker and figure
 *   shops after them.
 *
 * Only ever added where missing, like every fixture: each batch's first
 * listing is its marker, so a deployment uploads each batch's photos once.
 */

const MARKER = 'lst_seen_frieren';
const CON_MARKER = 'lst_seen_airmax';
const DAY = 24 * 3_600_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function demoDir(): string | null {
  const candidates = [
    resolve(__dirname, '../../../../assets/demo'), // api/dist/api/src/data -> api/assets/demo
    resolve(__dirname, '../../assets/demo'), // api/src/data -> api/assets/demo, run from source
    join(process.cwd(), 'assets', 'demo'),
    join(process.cwd(), 'api', 'assets', 'demo'),
  ];
  return candidates.find((dir) => existsSync(join(dir, 'haul.jpg'))) ?? null;
}

type Photo = 'frieren' | 'aerial' | 'pika' | 'haul' | 'con';

interface ListingSeed {
  id: string; sellerId: string; title: string; description: string; category: string; tags: string[];
  /** Null for an item listed without one of the demo photos: it is found by its title. */
  photo: Photo | null; status: ListingStatus; priceMinor: number; quantity: number; soldCount: number; ageDays: number;
}

const SEEN: ListingSeed[] = [
  {
    id: MARKER, sellerId: 'usr_tokyoline', title: 'Nendoroid Frieren — Good Smile Company',
    description: "Frieren: Beyond Journey's End. Japanese release, sealed, from this month's Akihabara box.",
    category: 'Figures', tags: ['nendoroid', 'frieren', 'good smile'],
    photo: 'frieren', status: 'active', priceMinor: 4_600_00, quantity: 3, soldCount: 2, ageDays: 3,
  },
  {
    id: 'lst_seen_frieren_kaiju', sellerId: 'usr_kaiju', title: 'Nendoroid Frieren (2024 run)',
    description: 'First-run Frieren Nendoroid. Sold out - ask in the channel for the next run.',
    category: 'Figures', tags: ['nendoroid', 'frieren'],
    photo: 'frieren', status: 'sold_out', priceMinor: 3_900_00, quantity: 0, soldCount: 6, ageDays: 70,
  },
  {
    id: 'lst_seen_aerial', sellerId: 'usr_kaiju', title: 'MG 1/100 Gundam Aerial Ver. Permet — Bandai',
    description: 'Master Grade Aerial, Permet Score Six version. Bandai Japan box.',
    category: 'Model kits', tags: ['gundam', 'gunpla', 'bandai', 'master grade'],
    photo: 'aerial', status: 'active', priceMinor: 6_500_00, quantity: 4, soldCount: 1, ageDays: 5,
  },
  {
    id: 'lst_seen_aerial_tokyo', sellerId: 'usr_tokyoline', title: 'MG Gundam Aerial (Permet) — last run',
    description: 'From the spring run. Gone now.',
    category: 'Model kits', tags: ['gundam', 'gunpla', 'bandai'],
    photo: 'aerial', status: 'archived', priceMinor: 5_900_00, quantity: 0, soldCount: 4, ageDays: 120,
  },
  {
    id: 'lst_seen_pika', sellerId: 'usr_tokyoline', title: 'Pokémon Center Pikachu plush — Japan',
    description: 'Pokémon Center Tokyo tag attached. Sold out.',
    category: 'Anime merch', tags: ['pokemon', 'pikachu', 'plush', 'pokemon center'],
    photo: 'pika', status: 'sold_out', priceMinor: 2_200_00, quantity: 0, soldCount: 11, ageDays: 45,
  },
  {
    id: 'lst_seen_pika_kaiju', sellerId: 'usr_kaiju', title: 'Pikachu plush, Pokémon Center tag',
    description: 'A few from the summer run.',
    category: 'Anime merch', tags: ['pokemon', 'pikachu', 'plush'],
    photo: 'pika', status: 'archived', priceMinor: 2_400_00, quantity: 0, soldCount: 3, ageDays: 90,
  },
];

/**
 * The exact items, sold under their own names by Courtside and Kaiju; other
 * Nike pairs at Arjun Collects and other McFarlane figures at Tokyo Line, so
 * those two are the shops likely to get them.
 */
const CON: ListingSeed[] = [
  {
    id: CON_MARKER, sellerId: 'usr_courtside', title: "Nike Air Max 90 'Infrared' — UK 10",
    description: 'The 2020 retro of the original colourway. Bought in Portland, flown in.',
    category: 'Sneakers', tags: ['nike', 'air max'],
    photo: null, status: 'active', priceMinor: 13_900_00, quantity: 1, soldCount: 2, ageDays: 6,
  },
  {
    id: 'lst_seen_dunk', sellerId: 'usr_demo', title: "Nike Dunk Low 'Panda' — UK 9",
    description: 'Deadstock, authenticated in-house.', category: 'Sneakers', tags: ['nike', 'dunk'],
    photo: null, status: 'sold_out', priceMinor: 11_500_00, quantity: 0, soldCount: 7, ageDays: 40,
  },
  {
    id: 'lst_seen_cortez', sellerId: 'usr_demo', title: 'Nike Cortez Classic — UK 8',
    description: 'White and red, original box.', category: 'Sneakers', tags: ['nike'],
    photo: null, status: 'archived', priceMinor: 7_900_00, quantity: 0, soldCount: 3, ageDays: 75,
  },
  {
    id: 'lst_seen_blazer', sellerId: 'usr_demo', title: "Nike Blazer Mid '77 — UK 9",
    description: 'Vintage white.', category: 'Sneakers', tags: ['nike'],
    photo: null, status: 'active', priceMinor: 8_400_00, quantity: 2, soldCount: 0, ageDays: 8,
  },
  {
    id: 'lst_seen_spawn', sellerId: 'usr_kaiju', title: 'McFarlane Spawn 7-inch action figure',
    description: 'McFarlane Toys, carded.', category: 'Figures', tags: ['mcfarlane', 'spawn'],
    photo: null, status: 'active', priceMinor: 2_800_00, quantity: 3, soldCount: 4, ageDays: 9,
  },
  {
    id: 'lst_seen_batman', sellerId: 'usr_tokyoline', title: 'McFarlane DC Multiverse Batman',
    description: 'Carded, from the spring run.', category: 'Figures', tags: ['mcfarlane', 'dc'],
    photo: null, status: 'sold_out', priceMinor: 2_600_00, quantity: 0, soldCount: 5, ageDays: 50,
  },
  {
    id: 'lst_seen_scorpion', sellerId: 'usr_tokyoline', title: 'McFarlane Mortal Kombat Scorpion',
    description: 'Carded.', category: 'Figures', tags: ['mcfarlane'],
    photo: null, status: 'archived', priceMinor: 2_500_00, quantity: 0, soldCount: 2, ageDays: 95,
  },
  {
    id: 'lst_seen_joker', sellerId: 'usr_tokyoline', title: 'McFarlane DC Multiverse Joker',
    description: 'Opened once for photos.', category: 'Figures', tags: ['mcfarlane', 'dc'],
    photo: null, status: 'active', priceMinor: 2_300_00, quantity: 1, soldCount: 0, ageDays: 12,
  },
];

function post(fields: Pick<Post, 'id' | 'channelId' | 'channel' | 'kind' | 'authorId' | 'authorName' | 'body'>
  & { photoUrls: string[]; listingId?: string; ageDays: number; voice: Post['voice']; reach: Post['reach'] }): Post {
  const at = ago(fields.ageDays);
  return {
    id: fields.id, channelId: fields.channelId, channel: fields.channel, kind: fields.kind,
    authorId: fields.authorId, authorName: fields.authorName, body: fields.body,
    listingId: fields.listingId ?? null,
    photoUrl: fields.photoUrls[0] ?? null,
    photoUrls: fields.photoUrls,
    likeCount: 0, replyCount: 0, reactions: [], comments: [], shareCount: 0,
    voice: fields.voice, reach: fields.reach, announcement: false,
    poll: null, vibe: null, replyTo: null,
    createdAt: at, updatedAt: at,
  };
}

type Uploaded = Record<string, { blobName: string; url: string }>;

/**
 * One batch of the demo: the photos it needs, its listings, and the posts
 * that use them. Added together, or not at all, keyed on the first listing.
 */
interface Batch {
  photos: Photo[];
  listings: ListingSeed[];
  posts: (photos: Uploaded) => Post[];
}

const BATCHES: Batch[] = [
  {
    photos: ['frieren', 'aerial', 'pika', 'haul'],
    listings: SEEN,
    posts: (photos) => [
      post({
        id: 'pst_seen_frieren', channelId: 'usr_tokyoline', channel: 'seller', kind: 'sale',
        authorId: 'usr_tokyoline', authorName: 'Tokyo Line', listingId: MARKER, ageDays: 0.2,
        voice: 'store', reach: 'feed',
        body: 'Frieren Nendoroids cleared customs this morning 📦 Three left from this batch.',
        photoUrls: [photos.frieren!.url],
      }),
      post({
        id: 'pst_seen_haul', channelId: 'usr_b_sana', channel: 'seller', kind: 'update',
        authorId: 'usr_b_sana', authorName: 'Sana Qureshi', ageDays: 0.1,
        voice: 'store', reach: 'feed',
        body: 'October haul is finally home! Frieren, the Aerial, and a Pokémon Center Pikachu I have wanted for years. Tap a photo to see where to get them.',
        photoUrls: [photos.haul!.url, photos.aerial!.url, photos.pika!.url],
      }),
      post({
        id: 'pst_seen_pika', channelId: 'frm_authenticity', channel: 'forum', kind: 'thread',
        authorId: 'usr_b_nikhil', authorName: 'Nikhil Raghavan', ageDays: 0.3,
        voice: 'visitor', reach: 'channel',
        body: 'Is this a real Pokémon Center Pikachu? The tag looks right to me. Has anyone here sold these before?',
        photoUrls: [photos.pika!.url],
      }),
    ],
  },
  {
    photos: ['con'],
    listings: CON,
    posts: (photos) => [
      post({
        id: 'pst_seen_con', channelId: 'usr_b_sana', channel: 'seller', kind: 'update',
        authorId: 'usr_b_sana', authorName: 'Sana Qureshi', ageDays: 0.05,
        voice: 'store', reach: 'feed',
        body: 'Spotted at Comic Con Mumbai: Nike Air Max 90s and a McFarlane Spawn action figure. Who here can get these?',
        photoUrls: [photos.con!.url],
      }),
    ],
  },
];

/** Upload the demo photos and write what uses them, batch by batch, unless already there. Never fails boot. */
export async function topUpPhotoDemo(repository: Repository): Promise<void> {
  for (const batch of BATCHES) {
    try {
      await addBatch(repository, batch);
    } catch (error) {
      console.warn(`seed: a photo demo batch was not added: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function addBatch(repository: Repository, batch: Batch): Promise<void> {
  const [marker, ...rest] = batch.listings;
  if (!marker || await repository.getListing(marker.id)) return;
  const dir = demoDir();
  if (!dir) return;
  const store = await getPhotoStore();
  const photos: Uploaded = {};
  for (const name of batch.photos) {
    photos[name] = await store.upload(new Uint8Array(readFileSync(join(dir, `${name}.jpg`))), 'image/jpeg');
  }

  // The marker goes last, so a boot that dies half way tries again next time.
  for (const entry of [...rest, marker]) {
    const photo = entry.photo ? photos[entry.photo]! : null;
    const at = ago(entry.ageDays);
    const listing: Listing = {
      id: entry.id, sellerId: entry.sellerId, title: entry.title, description: entry.description,
      category: entry.category, condition: 'MISB', status: entry.status,
      priceMinor: entry.priceMinor, currency: 'INR', quantityAvailable: entry.quantity,
      preOrder: null, lotId: null, sourcing: 'in_hand',
      photos: photo ? [{ blobName: photo.blobName, url: photo.url, imageHash: null, isPrimary: true }] : [],
      tags: entry.tags, likeCount: 0, viewCount: 0, soldCount: entry.soldCount, bumpedAt: null,
      createdAt: at, updatedAt: at,
    };
    await repository.createListing(listing);
    // Claimed by the first listing to use each, so the unused-photo sweep leaves it alone.
    if (photo) await store.claimPublic(photo.blobName, `listing:${entry.id}`);
  }

  for (const entry of batch.posts(photos)) {
    await repository.createPost(entry);
    // Photos no listing uses are the post's.
    for (const url of entry.photoUrls ?? []) {
      const own = Object.values(photos).find((photo) => photo.url === url);
      if (own) await store.claimPublic(own.blobName, `post:${entry.id}`);
    }
  }
}
