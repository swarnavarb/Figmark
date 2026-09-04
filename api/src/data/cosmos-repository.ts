import { CosmosClient, type Container, type Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import { CONTAINERS } from '../../../shared/containers.js';
import type { Follow, Like, Listing, ListingComment, Lot, Order, User } from '../../../shared/models.js';
import type { CosmosConfig } from '../config.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { BUMP_COOLDOWN_MS, sessionDigest } from './repository.js';
import { identifiersOf, normaliseIdentifier } from './memory-repository.js';

/**
 * Cosmos DB (Core/SQL) implementation.
 *
 * Partition keys come from the shared container definitions rather than being
 * written out here, so a query can never assume a key the container was not
 * created with.
 */
export class CosmosRepository implements Repository {
  readonly backend: BackendKind = 'cosmos';

  private readonly client: CosmosClient;
  private database!: Database;
  private state: BackendStatus;

  constructor(private readonly cosmosConfig: CosmosConfig) {
    // A key is used when supplied; otherwise managed identity, which is the
    // preferred path once the Static Web App has an identity assigned.
    this.client = cosmosConfig.key
      ? new CosmosClient({ endpoint: cosmosConfig.endpoint, key: cosmosConfig.key })
      : new CosmosClient({
          endpoint: cosmosConfig.endpoint,
          aadCredentials: new DefaultAzureCredential(),
        });

    this.state = {
      connected: false,
      database: cosmosConfig.database,
      detail: 'Not yet initialised.',
    };
  }

  async init(): Promise<void> {
    this.database = this.client.database(this.cosmosConfig.database);
    try {
      // A database read is the cheapest call that proves endpoint, credential
      // and database name are all correct.
      await this.database.read();
      this.state = {
        connected: true,
        database: this.cosmosConfig.database,
        detail: `Connected to ${this.cosmosConfig.endpoint} using ${
          this.cosmosConfig.key ? 'an account key' : 'managed identity'
        }.`,
      };
    } catch (error) {
      // A failure here must not take the API down: the status page needs to
      // load in order to report it.
      this.state = {
        connected: false,
        database: this.cosmosConfig.database,
        detail: `Could not reach Cosmos DB: ${describeError(error)}. Run "npm run azure:provision" if the database has not been created yet.`,
      };
    }
  }

  status(): BackendStatus {
    return this.state;
  }

  private container(name: keyof typeof CONTAINERS): Container {
    return this.database.container(CONTAINERS[name].name);
  }

  async getUserById(id: string): Promise<User | null> {
    try {
      // users is partitioned by /id, so this is a point read.
      const { resource } = await this.container('users').item(id, id).read<User>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async getUserByIdentifier(identifier: string): Promise<User | null> {
    // Two point reads via the reservation record, rather than a cross-partition
    // query: the same rows that make identifiers unique also make this cheap.
    const key = normaliseIdentifier(identifier);
    let reservation: IdentifierReservation | undefined;
    try {
      const result = await this.container('identifiers').item(key, key).read<IdentifierReservation>();
      reservation = result.resource;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (!reservation) return null;
    return this.getUserById(reservation.userId);
  }

  async createUser(user: User): Promise<User> {
    // Reserve every identifier first: a create conflict (409) is the
    // uniqueness constraint, so a taken identifier fails before the user row
    // exists rather than leaving a half-registered account.
    const reserved: string[] = [];
    try {
      for (const identifier of identifiersOf(user)) {
        await this.container('identifiers').items.create({ id: identifier, userId: user.id });
        reserved.push(identifier);
      }
    } catch (error) {
      // Roll back the reservations this call made, then report the clash.
      for (const identifier of reserved) {
        await this.container('identifiers').item(identifier, identifier).delete().catch(() => {});
      }
      if (isConflict(error)) throw new Error('That email or phone number is already registered.');
      throw error;
    }
    const { resource } = await this.container('users').items.create(user);
    return resource ?? user;
  }

  async listUsersByIds(ids: readonly string[]): Promise<User[]> {
    if (ids.length === 0) return [];
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.id)',
        parameters: [{ name: '@ids', value: [...ids] }],
      })
      .fetchAll();
    return resources;
  }

  async listForwarders(): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.forwarderProfile) AND c.forwarderProfile.listedInDirectory = true',
      })
      .fetchAll();
    return resources;
  }

  listDemoAccounts(): DemoAccount[] {
    // Never advertise sign-in hints against a real database.
    return [];
  }

  async revokeSession(token: string, expiresAt: Date): Promise<void> {
    const id = sessionDigest(token);
    const ttlSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
    // The record only needs to outlive the token it revokes, so Cosmos expires
    // it for us rather than us sweeping the container.
    await this.container('sessions').items.upsert({
      id,
      revokedAt: new Date().toISOString(),
      ttl: ttlSeconds,
    });
  }

  async isSessionRevoked(token: string): Promise<boolean> {
    const id = sessionDigest(token);
    try {
      const { resource } = await this.container('sessions').item(id, id).read();
      return resource !== undefined;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async listLots(query: CatalogQuery = {}): Promise<Lot[]> {
    return this.queryBySeller<Lot>('lots', query);
  }

  async getLot(sellerId: string, lotId: string): Promise<Lot | null> {
    try {
      const { resource } = await this.container('lots').item(lotId, sellerId).read<Lot>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async listListings(query: CatalogQuery = {}): Promise<Listing[]> {
    return this.queryBySeller<Listing>('listings', query);
  }

  async listOrdersForLot(lotId: string): Promise<Order[]> {
    // orders is partitioned by /lotId, so a manifest is a single-partition read.
    const { resources } = await this.container('orders')
      .items.query<Order>(
        { query: 'SELECT * FROM c WHERE c.lotId = @lotId', parameters: [{ name: '@lotId', value: lotId }] },
        { partitionKey: lotId },
      )
      .fetchAll();
    return resources;
  }

  async getListing(id: string): Promise<Listing | null> {
    const { resources } = await this.container('listings')
      .items.query<Listing>({
        query: 'SELECT * FROM c WHERE c.id = @id OFFSET 0 LIMIT 1',
        parameters: [{ name: '@id', value: id }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  async createListing(listing: Listing): Promise<Listing> {
    const { resource } = await this.container('listings').items.create(listing);
    return resource ?? listing;
  }

  async bumpListing(sellerId: string, listingId: string): Promise<boolean> {
    try {
      const { resource } = await this.container('listings').item(listingId, sellerId).read<Listing>();
      if (!resource) return false;
      const last = resource.bumpedAt ? Date.parse(resource.bumpedAt) : 0;
      if (Date.now() - last < BUMP_COOLDOWN_MS) return false;
      await this.container('listings')
        .item(listingId, sellerId)
        .replace({ ...resource, bumpedAt: new Date().toISOString() });
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  async listOrdersForBuyer(buyerId: string): Promise<Order[]> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.buyerId = @buyerId ORDER BY c.createdAt DESC',
        parameters: [{ name: '@buyerId', value: buyerId }],
      })
      .fetchAll();
    return resources;
  }

  async createOrder(order: Order): Promise<Order> {
    const { resource } = await this.container('orders').items.create(order);
    return resource ?? order;
  }

  async listComments(listingId: string): Promise<ListingComment[]> {
    const { resources } = await this.container('comments')
      .items.query<ListingComment>(
        {
          query: 'SELECT * FROM c WHERE c.listingId = @listingId ORDER BY c.createdAt ASC',
          parameters: [{ name: '@listingId', value: listingId }],
        },
        { partitionKey: listingId },
      )
      .fetchAll();
    return resources;
  }

  async addComment(comment: ListingComment): Promise<ListingComment> {
    const { resource } = await this.container('comments').items.create(comment);
    return resource ?? comment;
  }

  async toggleLike(userId: string, listingId: string): Promise<boolean> {
    const id = `${userId}__${listingId}`;
    try {
      await this.container('likes').item(id, userId).delete();
      return false;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const now = new Date().toISOString();
    await this.container('likes').items.create({ id, userId, listingId, createdAt: now, updatedAt: now } satisfies Like);
    return true;
  }

  async listLikedListingIds(userId: string): Promise<string[]> {
    const { resources } = await this.container('likes')
      .items.query<Like>({ query: 'SELECT * FROM c' }, { partitionKey: userId })
      .fetchAll();
    return resources.map((like) => like.listingId);
  }

  async toggleFollow(followerId: string, sellerId: string): Promise<boolean> {
    const id = `${followerId}__${sellerId}`;
    try {
      await this.container('follows').item(id, followerId).delete();
      return false;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const now = new Date().toISOString();
    await this.container('follows').items.create({ id, followerId, sellerId, createdAt: now, updatedAt: now } satisfies Follow);
    return true;
  }

  async listFollowedSellerIds(followerId: string): Promise<string[]> {
    const { resources } = await this.container('follows')
      .items.query<Follow>({ query: 'SELECT * FROM c' }, { partitionKey: followerId })
      .fetchAll();
    return resources.map((follow) => follow.sellerId);
  }

  private async queryBySeller<T>(
    name: 'lots' | 'listings',
    query: CatalogQuery,
  ): Promise<T[]> {
    const limit = query.limit ?? 100;
    const spec = query.sellerId
      ? {
          query: 'SELECT * FROM c WHERE c.sellerId = @sellerId ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
          parameters: [
            { name: '@sellerId', value: query.sellerId },
            { name: '@limit', value: limit },
          ],
        }
      : {
          query: 'SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
          parameters: [{ name: '@limit', value: limit }],
        };

    const { resources } = await this.container(name)
      .items.query<T>(spec, query.sellerId ? { partitionKey: query.sellerId } : undefined)
      .fetchAll();
    return resources;
  }
}

/** An `identifiers` document: the id is the normalised email or phone. */
interface IdentifierReservation {
  id: string;
  userId: string;
}

function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 409;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 404;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
