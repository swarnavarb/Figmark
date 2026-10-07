import type { Listing, Post } from '../../../shared/models.js';
import type { Repository } from '../data/repository.js';
import { getPhotoStore, ownPhotoName } from './index.js';

/**
 * Deleting a photo along with the thing that owns it, and never otherwise.
 *
 * A photo gets an owner when something saves it: a post, a hunt or a listing
 * claims the blob by name. Only the owner's deletion releases it. A post that
 * merely shows an item's photo never claimed it, so deleting that post leaves
 * the item's photo alone - which is the failure this exists to rule out, since
 * posts, orders and collection cards all reuse listing photos.
 *
 * Nothing here throws into the request that triggered it: a photo that could not
 * be removed is still found, later, by the operator's unused-photo scan.
 */

/** The blob name behind an address or a bare name, when it is one of ours. */
async function nameOf(entry: string | null | undefined): Promise<string | null> {
  if (!entry) return null;
  return (await ownPhotoName(entry)) ?? (/^[\w.-]+\.(?:jpg|png|webp|gif)$/i.test(entry) ? entry : null);
}

/** Mark photos as used by `owner`, such as `post:pst_x`. The first claim wins. */
export async function claimPhotos(entries: (string | null | undefined)[], owner: string): Promise<void> {
  try {
    const store = await getPhotoStore();
    for (const entry of entries) {
      const name = await nameOf(entry);
      if (name) await store.claimPublic(name, owner);
    }
  } catch {
    // A photo that could not be claimed just cannot be released with its owner.
  }
}

export type DiscardResult = 'discarded' | 'not_found' | 'not_yours' | 'in_use' | 'too_old';

/** A photo older than this is no longer a draft: leave it to the operator's scan. */
const DRAFT_HOURS = 24;

/**
 * Throw away a photo its uploader picked and then took out again before
 * saving. Only the uploader can, only while nothing has claimed it, and only
 * while it is still a draft.
 */
export async function discardUpload(userId: string, entry: string): Promise<DiscardResult> {
  const name = await nameOf(entry);
  if (!name) return 'not_found';
  const store = await getPhotoStore();
  const info = await store.publicInfo(name);
  if (!info) return 'not_found';
  if (!info.uploadedBy || info.uploadedBy !== userId) return 'not_yours';
  if (info.attachedTo) return 'in_use';
  if (Date.parse(info.uploadedAt) < Date.now() - DRAFT_HOURS * 3_600_000) return 'too_old';
  await store.remove('public', name);
  return 'discarded';
}

/**
 * Release the photos of listings that have just been deleted.
 *
 * Posts, orders and collection cards copy a listing's photo addresses, so a
 * photo goes only when no record anywhere still names it. Checked after the
 * delete, against everything the database holds.
 */
export async function releaseListingPhotos(deleted: Listing[], repository: Repository): Promise<number> {
  try {
    const names = new Set<string>();
    for (const listing of deleted) {
      for (const photo of listing.photos ?? []) {
        for (const entry of [photo.url, photo.blobName]) {
          const name = await nameOf(entry);
          if (name) names.add(name);
        }
      }
    }
    if (names.size === 0) return 0;
    const stillUsed = await repository.blobReferences();
    const store = await getPhotoStore();
    let removed = 0;
    for (const name of names) {
      if (!stillUsed.has(name) && await store.remove('public', name)) removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}

const carriesPhotos =(post: Post) => Boolean(post.photoUrl) || (post.photoUrls?.length ?? 0) > 0;

/**
 * Release the photos of posts that have just been deleted.
 *
 * A post posted into several forums is one post per forum, all showing the same
 * photos; they go only when the last of them does. A wall entry carries no
 * photos of its own, so it never holds them back.
 */
export async function releasePostPhotos(deleted: Post[], repository: Repository): Promise<number> {
  try {
    const gone = new Set(deleted.map((post) => post.id));
    const owners = new Set(deleted.map((post) => `post:${post.id}`));

    for (const post of deleted) {
      const others = [
        ...(post.alsoIn ?? []).map((entry) => ({ channelId: entry.forumId, id: entry.postId })),
        ...(post.wallPostId ? [{ channelId: post.authorId, id: post.wallPostId }] : []),
        ...(post.wallOf ? [{ channelId: post.wallOf.forumId, id: post.wallOf.postId }] : []),
      ];
      for (const other of others) {
        owners.add(`post:${other.id}`);
        if (gone.has(other.id)) continue;
        const survivor = await repository.getPost(other.channelId, other.id);
        if (survivor && carriesPhotos(survivor)) return 0;
      }
    }

    const store = await getPhotoStore();
    const names = new Set<string>();
    for (const post of deleted) {
      for (const entry of [post.photoUrl, ...(post.photoUrls ?? [])]) {
        const name = await nameOf(entry);
        if (name) names.add(name);
      }
    }
    let removed = 0;
    for (const name of names) {
      const info = await store.publicInfo(name);
      if (info?.attachedTo && owners.has(info.attachedTo) && await store.remove('public', name)) removed += 1;
    }
    return removed;
  } catch {
    return 0;
  }
}
