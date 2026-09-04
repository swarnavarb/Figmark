import type { BackendKind } from '../../../shared/contracts.js';
import type { UserRole } from '../../../shared/enums.js';
import type { Listing, Lot, Order, User } from '../../../shared/models.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { sessionDigest } from './repository.js';
import { DEMO_PASSWORD, seedListings, seedLots, seedOrders, seedUsers } from './seed.js';

/**
 * In-process store used when Cosmos DB is not configured.
 *
 * State lives for the lifetime of the function host, so it is not durable
 * across restarts or shared between instances. That is acceptable for its only
 * job: keeping the app browsable before credentials are wired up.
 */
export class MemoryRepository implements Repository {
  readonly backend: BackendKind = 'memory';

  private readonly users = new Map<string, User>();
  private readonly usersByUsername = new Map<string, User>();
  private readonly lots = new Map<string, Lot>();
  private readonly listings = new Map<string, Listing>();
  private readonly orders = new Map<string, Order>();
  private readonly revokedSessions = new Map<string, number>();

  async init(): Promise<void> {
    for (const user of seedUsers()) {
      this.users.set(user.id, user);
      this.usersByUsername.set(user.username, user);
    }
    for (const lot of seedLots()) this.lots.set(lot.id, lot);
    for (const listing of seedListings()) this.listings.set(listing.id, listing);
    for (const order of seedOrders()) this.orders.set(order.id, order);
  }

  status(): BackendStatus {
    return {
      connected: true,
      database: null,
      detail: `In-memory store with ${this.users.size} seeded users, ${this.lots.size} lots, ${this.orders.size} orders. Set COSMOS_ENDPOINT to use Cosmos DB.`,
    };
  }

  async getUserById(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return this.usersByUsername.get(username.toLowerCase()) ?? null;
  }

  listDemoAccounts(): Array<{ username: string; role: UserRole }> {
    return [...this.users.values()].map((user) => ({ username: user.username, role: user.role }));
  }

  async revokeSession(token: string, expiresAt: Date): Promise<void> {
    this.revokedSessions.set(sessionDigest(token), expiresAt.getTime());
  }

  async isSessionRevoked(token: string): Promise<boolean> {
    const digest = sessionDigest(token);
    const expiry = this.revokedSessions.get(digest);
    if (expiry === undefined) return false;
    // Once the token would have expired on its own, drop the record.
    if (expiry <= Date.now()) {
      this.revokedSessions.delete(digest);
      return false;
    }
    return true;
  }

  async listLots(query: CatalogQuery = {}): Promise<Lot[]> {
    return applyQuery([...this.lots.values()], query);
  }

  async getLot(sellerId: string, lotId: string): Promise<Lot | null> {
    const lot = this.lots.get(lotId);
    return lot && lot.sellerId === sellerId ? lot : null;
  }

  async listListings(query: CatalogQuery = {}): Promise<Listing[]> {
    return applyQuery([...this.listings.values()], query);
  }

  async listOrdersForLot(lotId: string): Promise<Order[]> {
    return [...this.orders.values()].filter((order) => order.lotId === lotId);
  }
}

function applyQuery<T extends { sellerId: string; createdAt: string }>(
  items: T[],
  query: CatalogQuery,
): T[] {
  const filtered = query.sellerId ? items.filter((i) => i.sellerId === query.sellerId) : items;
  const sorted = filtered.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return query.limit ? sorted.slice(0, query.limit) : sorted;
}

export { DEMO_PASSWORD };
