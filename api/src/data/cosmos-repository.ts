import { CosmosClient, type Container, type Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import { CONTAINERS } from '../../../shared/containers.js';
import type { Follow, Forum, Like, Listing, ListingComment, Lot, Order, Post, User } from '../../../shared/models.js';
import type { CosmosConfig } from '../config.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { BUMP_COOLDOWN_MS, sessionDigest } from './repository.js';
import { identifiersOf, normaliseIdentifier } from './memory-repository.js';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PHONE,
  seedComments,
  seedFollows,
  seedForums,
  seedLikes,
  seedListings,
  seedLots,
  seedOrders,
  seedPosts,
  seedUsers,
} from './seed.js';

/**
 * Whether an empty database may be filled with the development fixtures.
 *
 * On by default: the alternative is a deployment that connects successfully and
 * then behaves as though every password were wrong. Set COSMOS_AUTOSEED=off for
 * a database that is meant to start empty.
 */
function autoSeedEnabled(): boolean {
  return (process.env.COSMOS_AUTOSEED ?? '').trim().toLowerCase() !== 'off';
}

/**
 * Cosmos DB (Core/SQL) implementation.
 *
 * Partition keys come from the shared container definitions rather than being
 * written out here, so a query can never assume a key the container was not
 * created with.
 */
export class CosmosRepository implements Repository {
  readonly backend: BackendKind = 'cosmos';

  /**
   * Whether this instance put the development fixtures into the database.
   *
   * Only then is the demo sign-in hint shown. A database that arrived populated
   * holds someone's real accounts, and advertising a password from this
   * repository against it would be a fabrication at best.
   */
  private seeded = false;

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
      signInAccounts: null,
    };
  }

  async init(): Promise<void> {
    this.database = this.client.database(this.cosmosConfig.database);
    const via = this.cosmosConfig.key ? 'an account key' : 'managed identity';
    try {
      // A database read is the cheapest call that proves endpoint, credential
      // and database name are all correct.
      await this.database.read();
    } catch (error) {
      // A failure here must not take the API down: the status page needs to
      // load in order to report it.
      this.state = {
        connected: false,
        database: this.cosmosConfig.database,
        detail: `Could not reach Cosmos DB: ${describeError(error)}. Run "npm run azure:provision" if the database has not been created yet.`,
        signInAccounts: null,
      };
      return;
    }

    // Reaching the database is not the same as being able to serve it. A
    // database with no accounts in it answers a correct password with "that is
    // wrong", so establish which of the two we are in before any request does.
    let signInAccounts: number | null;
    try {
      signInAccounts = await this.countSignInAccounts();
    } catch (error) {
      this.state = {
        connected: false,
        database: this.cosmosConfig.database,
        detail: `Connected to ${this.cosmosConfig.endpoint} using ${via}, but its containers could not be read: ${describeError(
          error,
        )}. Run "npm run azure:provision" to create them.`,
        signInAccounts: null,
      };
      return;
    }

    let seeded = '';
    if (autoSeedEnabled()) {
      try {
        seeded = signInAccounts === 0 ? await this.fill() : await this.repair();
        signInAccounts = await this.countSignInAccounts();
      } catch (error) {
        seeded = ` Preparing the database failed: ${describeError(error)}.`;
      }
    }

    this.state = {
      connected: true,
      database: this.cosmosConfig.database,
      detail: `Connected to ${this.cosmosConfig.endpoint} using ${via}. ${signInAccounts} sign-in account(s).${seeded}`,
      signInAccounts,
    };
  }

  /**
   * Fills a database with nothing in it.
   *
   * Whoever sets COSMOS_ENDPOINT in the portal does not have a terminal with the
   * account key in it to hand, which is what the provisioning script needs. This
   * is safe precisely because the database is empty: there is nothing to
   * overwrite.
   */
  private async fill(): Promise<string> {
    const written = await this.seedFixtures();
    this.seeded = true;
    return ` Seeded ${written} fixture records into an empty database.`;
  }

  /**
   * Repairs accounts that exist but cannot be signed into.
   *
   * Sign-in resolves an identifier through the reservation container, so a user
   * row with no reservation behind it is unreachable - the account is there, and
   * every password for it is answered "incorrect". A half-written seed leaves
   * exactly that, because the user row is written before its reservations.
   *
   * Creating the missing reservation is what writing the account should have
   * done. A reservation already claimed by a different account is left alone:
   * that is a genuine conflict, not a gap to fill.
   */
  private async repair(): Promise<string> {
    const users = await this.listAllUsers();
    const repaired: string[] = [];

    for (const user of users) {
      for (const identifier of identifiersOf(user)) {
        const existing = await this.readReservation(identifier);
        if (existing) continue;
        await this.container('identifiers').items.upsert({ id: identifier, userId: user.id });
        repaired.push(user.id);
      }
    }

    if (repaired.length === 0) return '';

    // A half-written seed loses the catalog along with the reservations, so
    // finish the job rather than leaving a signed-in user staring at nothing.
    // Guarded on the fixture account being one of the unreachable rows, which
    // only a seed of ours puts there - a database of real accounts never
    // reaches this.
    if (repaired.includes('usr_demo')) {
      const written = await this.seedFixtures();
      this.seeded = true;
      return ` Completed a half-written seed: ${written} fixture records, including the identifier reservations sign-in resolves through.`;
    }

    return ` Restored ${repaired.length} missing identifier reservation(s), without which those accounts could not be signed into.`;
  }

  private async readReservation(identifier: string): Promise<IdentifierReservation | null> {
    try {
      const { resource } = await this.container('identifiers')
        .item(identifier, identifier)
        .read<IdentifierReservation>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  private async listAllUsers(): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({ query: 'SELECT * FROM c' })
      .fetchAll();
    return resources;
  }

  /** Accounts holding a password hash, i.e. accounts sign-in can resolve. */
  private async countSignInAccounts(): Promise<number> {
    const { resources } = await this.container('users')
      .items.query<number>({
        query: 'SELECT VALUE COUNT(1) FROM c WHERE IS_DEFINED(c.passwordHash) AND c.passwordHash != null',
      })
      .fetchAll();
    return resources[0] ?? 0;
  }

  /**
   * Writes the development fixtures, including the identifier reservations that
   * sign-in resolves through.
   *
   * Upserts rather than creates: two workers may reach this at the same moment
   * on a cold start, and the fixtures are identical, so last write wins is the
   * correct outcome rather than a conflict to handle.
   */
  private async seedFixtures(): Promise<number> {
    const users = seedUsers();
    let written = 0;

    for (const user of users) {
      await this.container('users').items.upsert(user);
      for (const identifier of identifiersOf(user)) {
        await this.container('identifiers').items.upsert({ id: identifier, userId: user.id });
      }
      written += 1;
    }

    for (const [name, items] of [
      ['lots', seedLots()],
      ['listings', seedListings()],
      ['orders', seedOrders()],
      ['comments', seedComments()],
      ['forums', seedForums()],
      ['posts', seedPosts()],
    ] as const) {
      for (const item of items) await this.container(name).items.upsert(item);
      written += items.length;
    }

    // Likes and follows are addressed by a composite id here, since that is
    // what toggling them reads back. Seeding the fixture ids verbatim would
    // leave rows this repository could never find again.
    for (const like of seedLikes()) {
      await this.container('likes').items.upsert({ ...like, id: `${like.userId}__${like.listingId}` });
      written += 1;
    }
    for (const follow of seedFollows()) {
      await this.container('follows').items.upsert({ ...follow, id: `${follow.followerId}__${follow.sellerId}` });
      written += 1;
    }

    return written;
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

  async updateUser(user: User): Promise<User> {
    const { resource } = await this.container('users').items.upsert<User>(user);
    return resource ?? user;
  }

  async listOrdersForSeller(sellerId: string): Promise<Order[]> {
    // Orders are partitioned by lot, so a seller's book is cross-partition.
    // Bounded by one seller's order count, which is the right size for the
    // dashboards that ask for it.
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.sellerId = @sellerId',
        parameters: [{ name: '@sellerId', value: sellerId }],
      })
      .fetchAll();
    return resources;
  }

  async listPosts(channelId: string, limit = 50): Promise<Post[]> {
    const { resources } = await this.container('posts')
      .items.query<Post>(
        { query: 'SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit', parameters: [{ name: '@limit', value: limit }] },
        { partitionKey: channelId },
      )
      .fetchAll();
    return resources;
  }

  async listPostsForChannels(channelIds: readonly string[], limit = 60): Promise<Post[]> {
    if (channelIds.length === 0) return [];
    const { resources } = await this.container('posts')
      .items.query<Post>({
        query:
          'SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.channelId) ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
        parameters: [
          { name: '@ids', value: [...channelIds] },
          { name: '@limit', value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }

  async createPost(post: Post): Promise<Post> {
    const { resource } = await this.container('posts').items.create(post);
    // The forum's own count is denormalised, so a room can show its size
    // without counting its posts.
    if (post.channel === 'forum') {
      const forum = await this.getForum(post.channelId);
      if (forum) {
        forum.postCount += 1;
        forum.updatedAt = new Date().toISOString();
        await this.container('forums').items.upsert(forum);
      }
    }
    return resource ?? post;
  }

  async listForums(): Promise<Forum[]> {
    const { resources } = await this.container('forums')
      .items.query<Forum>({ query: 'SELECT * FROM c ORDER BY c.name' })
      .fetchAll();
    return resources;
  }

  async getForum(id: string): Promise<Forum | null> {
    try {
      const { resource } = await this.container('forums').item(id, id).read<Forum>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async createForum(forum: Forum): Promise<Forum> {
    const { resource } = await this.container('forums').items.create(forum);
    return resource ?? forum;
  }

  listDemoAccounts(): DemoAccount[] {
    // Only for a database this instance seeded itself: those fixtures are the
    // ones in this repository, so naming them tells the user nothing the source
    // does not. A database holding real accounts is never advertised.
    if (!this.seeded) return [];
    return [{ identifier: DEMO_EMAIL, label: `${DEMO_PHONE} · ${DEMO_PASSWORD}` }];
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

  async createLot(lot: Lot): Promise<Lot> {
    const { resource } = await this.container('lots').items.create(lot);
    return resource ?? lot;
  }

  async updateLot(lot: Lot): Promise<Lot> {
    const { resource } = await this.container('lots')
      .item(lot.id, lot.sellerId)
      .replace({ ...lot, updatedAt: new Date().toISOString() });
    return (resource as Lot | undefined) ?? lot;
  }

  async listListingsInLot(lotId: string): Promise<Listing[]> {
    const { resources } = await this.container('listings')
      .items.query<Listing>({
        query: 'SELECT * FROM c WHERE c.lotId = @lotId',
        parameters: [{ name: '@lotId', value: lotId }],
      })
      .fetchAll();
    return resources;
  }

  async assignListingsToLot(
    sellerId: string,
    listingIds: readonly string[],
    lotId: string | null,
  ): Promise<number> {
    let changed = 0;
    for (const id of listingIds) {
      try {
        const { resource } = await this.container('listings').item(id, sellerId).read<Listing>();
        if (!resource) continue;
        await this.container('listings')
          .item(id, sellerId)
          .replace({ ...resource, lotId, updatedAt: new Date().toISOString() });
        changed += 1;
      } catch (error) {
        // Not this seller's listing, or already gone: skip rather than fail.
        if (!isNotFound(error)) throw error;
      }
    }
    return changed;
  }

  async getOrder(id: string): Promise<Order | null> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.id = @id OFFSET 0 LIMIT 1',
        parameters: [{ name: '@id', value: id }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  async updateOrder(order: Order): Promise<Order> {
    const { resource } = await this.container('orders')
      .item(order.id, order.lotId)
      .replace({ ...order, updatedAt: new Date().toISOString() });
    return (resource as Order | undefined) ?? order;
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
