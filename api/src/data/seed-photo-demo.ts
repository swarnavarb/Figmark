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
 *
 * Only ever added where missing, like every fixture: the first listing is the
 * marker, so a deployment uploads the photos once.
 */

const MARKER = 'lst_seen_frieren';
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

type Photo = 'frieren' | 'aerial' | 'pika';

const LISTINGS: {
  id: string; sellerId: string; title: string; description: string; category: string; tags: string[];
  photo: Photo; status: ListingStatus; priceMinor: number; quantity: number; soldCount: number; ageDays: number;
}[] = [
  {
    id: MARKER, sellerId: 'usr_tokyoline', title: 'Nendoroid Frieren — Good Smile Company',
    description: "Frieren: Beyond Journey's End. Japanese release, sealed, from this month's Akihabara box.",
    category: 'Scale figures', tags: ['nendoroid', 'frieren', 'good smile'],
    photo: 'frieren', status: 'active', priceMinor: 4_600_00, quantity: 3, soldCount: 2, ageDays: 3,
  },
  {
    id: 'lst_seen_frieren_kaiju', sellerId: 'usr_kaiju', title: 'Nendoroid Frieren (2024 run)',
    description: 'First-run Frieren Nendoroid. Sold out - ask in the channel for the next run.',
    category: 'Scale figures', tags: ['nendoroid', 'frieren'],
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

/** Upload the demo photos and write what uses them, unless already there. Never fails boot. */
export async function topUpPhotoDemo(repository: Repository): Promise<void> {
  try {
    if (await repository.getListing(MARKER)) return;
    const dir = demoDir();
    if (!dir) return;
    const store = await getPhotoStore();
    const upload = async (name: Photo | 'haul') =>
      store.upload(new Uint8Array(readFileSync(join(dir, `${name}.jpg`))), 'image/jpeg');
    const photos = {
      frieren: await upload('frieren'), aerial: await upload('aerial'), pika: await upload('pika'), haul: await upload('haul'),
    };

    // The marker goes last, so a boot that dies half way tries again next time.
    for (const entry of [...LISTINGS.slice(1), LISTINGS[0]!]) {
      const photo = photos[entry.photo];
      const at = ago(entry.ageDays);
      const listing: Listing = {
        id: entry.id, sellerId: entry.sellerId, title: entry.title, description: entry.description,
        category: entry.category, condition: 'MISB', status: entry.status,
        priceMinor: entry.priceMinor, currency: 'INR', quantityAvailable: entry.quantity,
        preOrder: null, lotId: null, sourcing: 'in_hand',
        photos: [{ blobName: photo.blobName, url: photo.url, imageHash: null, isPrimary: true }],
        tags: entry.tags, likeCount: 0, viewCount: 0, soldCount: entry.soldCount, bumpedAt: null,
        createdAt: at, updatedAt: at,
      };
      await repository.createListing(listing);
      // Claimed by the first listing to use each, so the unused-photo sweep leaves it alone.
      await store.claimPublic(photo.blobName, `listing:${entry.id}`);
    }

    const posts = [
      post({
        id: 'pst_seen_frieren', channelId: 'usr_tokyoline', channel: 'seller', kind: 'sale',
        authorId: 'usr_tokyoline', authorName: 'Tokyo Line', listingId: MARKER, ageDays: 0.2,
        voice: 'store', reach: 'feed',
        body: 'Frieren Nendoroids cleared customs this morning 📦 Three left from this batch.',
        photoUrls: [photos.frieren.url],
      }),
      post({
        id: 'pst_seen_haul', channelId: 'usr_b_sana', channel: 'seller', kind: 'update',
        authorId: 'usr_b_sana', authorName: 'Sana Qureshi', ageDays: 0.1,
        voice: 'store', reach: 'feed',
        body: 'October haul is finally home! Frieren, the Aerial, and a Pokémon Center Pikachu I have wanted for years. Tap a photo to see where to get them.',
        photoUrls: [photos.haul.url, photos.aerial.url, photos.pika.url],
      }),
      post({
        id: 'pst_seen_pika', channelId: 'frm_authenticity', channel: 'forum', kind: 'thread',
        authorId: 'usr_b_nikhil', authorName: 'Nikhil Raghavan', ageDays: 0.3,
        voice: 'visitor', reach: 'channel',
        body: 'Is this a real Pokémon Center Pikachu? The tag looks right to me. Has anyone here sold these before?',
        photoUrls: [photos.pika.url],
      }),
    ];
    for (const entry of posts) await repository.createPost(entry);
    await store.claimPublic(photos.haul.blobName, 'post:pst_seen_haul');
  } catch (error) {
    console.warn(`seed: the photo demo was not added: ${error instanceof Error ? error.message : String(error)}`);
  }
}
