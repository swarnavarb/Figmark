import type { Listing, User } from '../../shared/models.js';
import { isExpired } from '../../shared/payments.js';
import { buildIdentity, sameIdentity, type ShopTag } from '../../shared/shop-tags.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Keeping each shop's identity (shared/shop-tags.ts) current, and reading
 * every shop's at once.
 *
 * The identity lives on the shop's own profile row: no table of its own, no
 * row per tag. It is rewritten only when it actually changes.
 */

/** A shop's listings as the identity counts them: private deals left out. */
function counted(listings: readonly Listing[]) {
  return listings
    .filter((listing) => !listing.privateFor && listing.status !== 'archived')
    .map((listing) => ({ tags: listing.tags, category: listing.category, expired: isExpired(listing) }));
}

/** The identity this shop should have now. */
export async function identityFor(repository: Repo, owner: User, ownTags?: readonly string[]): Promise<ShopTag[]> {
  const listings = await repository.listListings({ sellerId: owner.id, includeHidden: true });
  return buildIdentity(ownTags ?? owner.sellerProfile?.tags ?? [], counted(listings));
}

/**
 * Recount a shop's identity after its listings changed, and save it if it
 * moved. Never throws: a listing that saved must not fail because its shop's
 * tags could not be recounted - the next change, or the index, catches up.
 */
export async function refreshIdentity(repository: Repo, sellerId: string): Promise<void> {
  try {
    const owner = await repository.getUserById(sellerId);
    if (!owner?.sellerProfile) return;
    const identity = await identityFor(repository, owner);
    if (sameIdentity(owner.sellerProfile.identity, identity)) return;
    await repository.updateUser({ ...owner, sellerProfile: { ...owner.sellerProfile, identity } });
    forgetIndex();
  } catch {
    /* caught up on the next change */
  }
}

/** One shop as search and suggestions read it. */
export interface IndexedShop {
  id: string;
  name: string;
  handle: string | null;
  photoUrl: string | null;
  followerCount: number;
  tier: string;
  dispatchRegion: string;
  identity: ShopTag[];
}

/*
 * Every shop's identity, held for a minute. Search and suggestions run on
 * every keystroke and every Buy tab, and a shop's tags change far less often
 * than that.
 */
const INDEX_MS = 60_000;
let index: { at: number; shops: Promise<IndexedShop[]> } | null = null;

export function forgetIndex() {
  index = null;
}

export function shopIndex(repository: Repo): Promise<IndexedShop[]> {
  if (index && Date.now() - index.at < INDEX_MS) return index.shops;
  const shops = (async () => {
    const owners = await repository.listStoreOwners();
    return Promise.all(owners.map(async (owner) => {
      const profile = owner.sellerProfile!;
      let identity = profile.identity;
      // A shop from before identities existed is counted once, and kept.
      if (!identity) {
        identity = await identityFor(repository, owner);
        await repository.updateUser({ ...owner, sellerProfile: { ...profile, identity } }).catch(() => undefined);
      }
      return {
        id: owner.id,
        name: profile.storefrontName,
        handle: profile.username ?? null,
        photoUrl: profile.photoUrl ?? null,
        followerCount: profile.followerCount ?? 0,
        tier: profile.tier,
        dispatchRegion: profile.dispatchRegion ?? '',
        identity,
      };
    }));
  })();
  index = { at: Date.now(), shops };
  // A failed read is not kept: the next request tries again.
  shops.catch(() => { if (index?.shops === shops) index = null; });
  return shops;
}

/** A shop as a card: the few tags that say most about it. */
export function shopCard(shop: IndexedShop, matched: string[] = []) {
  return {
    id: shop.id,
    name: shop.name,
    handle: shop.handle,
    photoUrl: shop.photoUrl,
    followerCount: shop.followerCount,
    tier: shop.tier,
    dispatchRegion: shop.dispatchRegion,
    tags: shop.identity.slice(0, 3).map((tag) => tag.l),
    matched,
  };
}
