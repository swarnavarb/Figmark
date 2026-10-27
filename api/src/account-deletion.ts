import { currentRound, isClosed } from '../../shared/disputes.js';
import { getRepository } from './data/index.js';
import { inBatches } from './data/concurrency.js';
import { releaseListingPhotos, releasePostPhotos } from './storage/release.js';

/*
 * Erasing an account, shared by the operations console and the account's own
 * "Delete my account": the same blockers and the same erasure either way.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Why this account cannot be deleted yet.
 *
 * Checked before the button is offered and again before it acts, because the
 * state can change between the two and the second check is the one that
 * matters.
 */
export async function deletionBlockers(id: string, repository: Repo): Promise<string[]> {
  const [purchases, sales, asParty, asManager] = await Promise.all([
    repository.listOrdersForBuyer(id),
    repository.listOrdersForSeller(id),
    repository.listDisputesForParty(id),
    repository.listDisputesForManager(id),
  ]);

  const blockers: string[] = [];
  const live = [...purchases, ...sales].filter(
    (order) => order.hold.state === 'held' || order.hold.state === 'disputed',
  );
  if (live.length > 0) {
    blockers.push(
      `${live.length} order(s) still hold money. Settle or release them before deleting the account.`,
    );
  }
  const open = [...asParty, ...asManager.filter((dispute) => currentRound(dispute)?.managerId === id)]
    .filter((dispute) => !isClosed(dispute));
  if (open.length > 0) {
    blockers.push(`${new Set(open.map((dispute) => dispute.id)).size} dispute(s) they are in or deciding are still open.`);
  }
  return blockers;
}

/**
 * Deletes the account and what it made. Orders deliberately stay: they are
 * the counterparty's record too, and erasing one side of a completed
 * transaction takes the other side's history with it. Call only once
 * `deletionBlockers` is empty.
 */
export async function eraseAccount(id: string, repository: Repo): Promise<{ user: string; listings: number; lots: number; posts: number }> {
  const [listings, lots, posts] = await Promise.all([
    repository.listListings({ sellerId: id, includeHidden: true }),
    repository.listLots({ sellerId: id }),
    repository.listPostsByAuthor(id),
  ]);
  await inBatches(listings, 10, (listing) => repository.deleteListing(id, listing.id));
  await inBatches(lots, 10, (lot) => repository.deleteLot(id, lot.id));
  await inBatches(posts, 10, (post) => repository.deletePost(post.channelId, post.id));
  await releasePostPhotos(posts, repository);
  await releaseListingPhotos(listings, repository);
  await repository.deleteUser(id);
  return { user: id, listings: listings.length, lots: lots.length, posts: posts.length };
}
