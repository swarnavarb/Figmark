import type { Lot, User } from '../../../shared/models.js';
import type { Repository } from './repository.js';

/**
 * Each lot beside the shop it belongs to, the shops read in one go. A lot
 * whose shop has gone, or closed, is dropped - as it was when these were found
 * by walking every shop in turn.
 */
export async function withOwners(repository: Repository, lots: readonly Lot[]): Promise<{ owner: User; lot: Lot }[]> {
  const owners = new Map((await repository.listUsersByIds([...new Set(lots.map((lot) => lot.sellerId))]))
    .filter((owner) => owner.sellerProfile).map((owner) => [owner.id, owner]));
  return lots.flatMap((lot) => {
    const owner = owners.get(lot.sellerId);
    return owner ? [{ owner, lot }] : [];
  });
}
