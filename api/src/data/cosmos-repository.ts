import { CosmosClient, type Container, type ContainerRequest, type Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import { CONTAINER_LIST, CONTAINERS, containerBody } from '../../../shared/containers.js';
import type {
  Dispute, Follow, Forum, Like, Listing, ListingComment, Lot, Message, Order, Post, Review, User,
} from '../../../shared/models.js';
import { handleKey } from '../../../shared/handles.js';
import type { CosmosConfig } from '../config.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { BUMP_COOLDOWN_MS, sessionDigest } from './repository.js';
import { identifiersOf, normaliseIdentifier } from './memory-repository.js';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PHONE,
  ESCROW_EMAIL,
  PACKER_EMAIL,
  seedComments,
  seedFollows,
  seedForums,
  seedLikes,
  seedListings,
  seedLotBuyers,
  seedLotOrders,
  seedLots,
  seedOpenLot,
  seedShippedLot,
  seedLiveSale,
  seedOrders,
  seedPosts,
  seedReviews,
  seedDisputes,
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
      missingContainers: null,
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
        missingContainers: null,
      };
      return;
    }

    // A container this code queries but the database does not hold answers
    // every request against it with a 500 and no clue as to why. That was the
    // shape of it: `messages` was added to the schema, the database had been
    // provisioned before it existed, and the inbox was simply broken until
    // somebody re-ran a script by hand. Creating what is missing is cheap,
    // idempotent, and removes the manual step from between a deploy and a
    // working feature.
    const containers = await this.ensureContainers();
    let created = '';
    if (containers.created.length > 0) {
      created = ` Created missing container(s): ${containers.created.join(', ')}.`;
    }
    if (containers.missing.length > 0) {
      // Creating a container is a management-plane operation: an account key
      // can do it, and a data-plane managed identity is refused. Naming the
      // container and the fix beats leaving a feature broken and silent.
      created +=
        ` Missing container(s): ${containers.missing.join(', ')} —` +
        ` every request that reads one will fail. ${containers.failure ?? ''}` +
        ' Run "npm run azure:provision" to create them.';
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
        missingContainers: containers.missing,
      };
      return;
    }

    let seeded = '';
    if (autoSeedEnabled()) {
      try {
        if (signInAccounts === 0) {
          seeded = await this.fill();
        } else {
          // Repair what is broken, then add what is simply not there yet: a
          // database seeded by an older release keeps serving that release
          // until somebody notices the data never moved with the code.
          seeded = (await this.repair()) + (await this.topUpFixtures());
        }
        signInAccounts = await this.countSignInAccounts();
      } catch (error) {
        seeded = ` Preparing the database failed: ${describeError(error)}.`;
      }
    }

    this.state = {
      connected: true,
      database: this.cosmosConfig.database,
      detail: `Connected to ${this.cosmosConfig.endpoint} using ${via}. ${signInAccounts} sign-in account(s).${created}${seeded}`,
      signInAccounts,
      missingContainers: containers.missing,
    };
  }

  /**
   * Creates any container the schema declares and the database does not hold.
   *
   * One listing call, then a create for each gap, so the usual case - nothing
   * missing - costs a single round trip.
   *
   * What is still missing afterwards matters more than what was created: a
   * refused create leaves a feature broken, and the whole point is that the
   * status page says which one rather than every request answering 500.
   */
  private async ensureContainers(): Promise<{ created: string[]; missing: string[]; failure: string | null }> {
    let present: Set<string>;
    try {
      const { resources } = await this.database.containers.readAll().fetchAll();
      present = new Set(resources.map((container) => container.id));
    } catch (error) {
      // The listing itself was refused, so nothing can be said about which
      // containers exist. Report them all as unknown rather than guessing.
      return {
        created: [],
        missing: CONTAINER_LIST.map((definition) => definition.name),
        failure: `Containers could not be listed: ${describeError(error)}.`,
      };
    }

    const created: string[] = [];
    const missing: string[] = [];
    let failure: string | null = null;
    for (const definition of CONTAINER_LIST) {
      if (present.has(definition.name)) continue;
      try {
        await this.database.containers.createIfNotExists(containerBody(definition) as ContainerRequest);
        created.push(definition.name);
      } catch (error) {
        // One refusal is every refusal when it is a permission, but a per
        // container failure must not stop the rest being created.
        missing.push(definition.name);
        failure ??= `Creating them was refused: ${describeError(error)}.`;
      }
    }
    return { created, missing, failure };
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
    // One projection rather than a point read per identifier. This runs on
    // every cold start, so the healthy case - nothing missing - must cost one
    // round trip and not one per account.
    const present = await this.existingIds('identifiers');

    const missing: { id: string; userId: string }[] = [];
    const repaired: string[] = [];
    for (const user of users) {
      for (const identifier of identifiersOf(user)) {
        if (present.has(identifier)) continue;
        missing.push({ id: identifier, userId: user.id });
        repaired.push(user.id);
      }
    }
    await Promise.all(missing.map((row) => this.container('identifiers').items.upsert(row)));

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

  /**
   * Adds fixture rows a later release introduced and this database never got.
   *
   * The seed only ran on an empty database, so a deployment seeded once and
   * then updated kept whatever it had on day one: every account, order and
   * fixture added afterwards was in the code and absent from the data, and the
   * site quietly showed an older product than the one that was deployed. Three
   * releases of escrows, reviews and disputes landed that way and none of them
   * were visible.
   *
   * Only ever adds. A row already there is left exactly as it is, because by
   * then it may carry real use — somebody's order state is not ours to reset.
   * And only on a database that is demonstrably one of ours: `usr_demo` is a
   * fixture id, so a database of real accounts never reaches this at all.
   */
  private async topUpFixtures(): Promise<string> {
    if (!(await this.getUserById('usr_demo'))) return '';

    // What is already there, one container at a time. The usual answer is
    // "everything", and that answer has to be cheap: this runs on every cold
    // start, and every request landing on a cold worker waits behind it.
    const fixtures = [
      ['users', [...seedUsers(), ...seedLotBuyers()]],
      ['lots', [...seedLots(), seedOpenLot(), seedShippedLot()]],
      ['listings', seedListings()],
      ['orders', [...seedOrders(), seedLiveSale(), ...seedLotOrders()]],
      ['comments', seedComments()],
      ['forums', seedForums()],
      ['posts', seedPosts()],
      ['reviews', seedReviews()],
      ['disputes', seedDisputes()],
    ] as const;

    let added = 0;
    const newUsers: User[] = [];

    for (const [name, items] of fixtures) {
      const present = await this.existingIds(name);
      const missing = items.filter((item) => !present.has(item.id));
      if (missing.length === 0) continue;

      // Only the genuinely absent ones are written, and in parallel: a handful
      // of rows after a release, none at all on the run after that.
      await Promise.all(missing.map((item) => this.container(name).items.upsert(item)));
      added += missing.length;
      if (name === 'users') newUsers.push(...(missing as readonly User[]));
    }

    // A new fixture account needs the reservations sign-in and `/<username>`
    // resolve through, or it exists and cannot be reached.
    if (newUsers.length > 0) {
      const reservations: { id: string; userId: string; isStore?: boolean }[] = [];
      for (const user of newUsers) {
        for (const identifier of identifiersOf(user)) reservations.push({ id: identifier, userId: user.id });
        if (user.username) reservations.push({ id: handleKey(user.username), userId: user.id, isStore: false });
        if (user.sellerProfile?.username) {
          reservations.push({ id: handleKey(user.sellerProfile.username), userId: user.id, isStore: true });
        }
      }
      await Promise.all(reservations.map((row) => this.container('identifiers').items.upsert(row)));
    }

    return added === 0 ? '' : ` Added ${added} fixture record(s) this database did not have yet.`;
  }

  /**
   * The ids a container already holds.
   *
   * One projection query instead of a point read per row. Init runs on every
   * cold start and every request that lands on a cold worker waits for it, so
   * the difference between one round trip and two hundred is the difference
   * between a slow page and a page that never arrives.
   */
  private async existingIds(container: keyof typeof CONTAINERS): Promise<Set<string>> {
    const { resources } = await this.container(container)
      .items.query<string>({ query: 'SELECT VALUE c.id FROM c' })
      .fetchAll();
    return new Set(resources);
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
    const users = [...seedUsers(), ...seedLotBuyers()];
    let written = 0;

    for (const user of users) {
      await this.container('users').items.upsert(user);
      for (const identifier of identifiersOf(user)) {
        await this.container('identifiers').items.upsert({ id: identifier, userId: user.id });
      }
      // Handles share the reservation container, so a seeded account is
      // addressable at /<username> without a second pass.
      if (user.username) {
        await this.container('identifiers').items.upsert({
          id: handleKey(user.username), userId: user.id, isStore: false,
        });
      }
      if (user.sellerProfile?.username) {
        await this.container('identifiers').items.upsert({
          id: handleKey(user.sellerProfile.username), userId: user.id, isStore: true,
        });
      }
      written += 1;
    }

    for (const [name, items] of [
      ['lots', [...seedLots(), seedOpenLot(), seedShippedLot()]],
      ['listings', seedListings()],
      ['orders', [...seedOrders(), seedLiveSale(), ...seedLotOrders()]],
      ['comments', seedComments()],
      ['forums', seedForums()],
      ['posts', seedPosts()],
      ['reviews', seedReviews()],
      ['disputes', seedDisputes()],
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

  async getByHandle(username: string): Promise<{ user: User; isStore: boolean } | null> {
    const reservation = await this.readReservation(handleKey(username));
    if (!reservation) return null;
    const user = await this.getUserById(reservation.userId);
    return user ? { user, isStore: Boolean(reservation.isStore) } : null;
  }

  async reserveHandle(username: string, userId: string, isStore: boolean): Promise<boolean> {
    const key = handleKey(username);
    const existing = await this.readReservation(key);
    // Re-claiming your own is not a clash; somebody else's is.
    if (existing) return existing.userId === userId && Boolean(existing.isStore) === isStore;
    try {
      await this.container('identifiers').items.create({ id: key, userId, isStore });
      return true;
    } catch (error) {
      // Two claims racing: whoever lost simply did not get it.
      if (isConflict(error)) return false;
      throw error;
    }
  }

  async releaseHandle(username: string): Promise<void> {
    const key = handleKey(username);
    await this.container('identifiers').item(key, key).delete().catch(() => {});
  }

  async listMessages(threadId: string, limit = 200): Promise<Message[]> {
    const { resources } = await this.container('messages')
      .items.query<Message>(
        {
          query: 'SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
          parameters: [{ name: '@limit', value: limit }],
        },
        { partitionKey: threadId },
      )
      .fetchAll();
    // Read oldest first: a conversation is read downwards.
    return resources.reverse();
  }

  async listMessagesForHandles(handles: readonly string[], limit = 300): Promise<Message[]> {
    if (handles.length === 0) return [];
    const lowered = handles.map((handle) => handle.toLowerCase());
    const { resources } = await this.container('messages')
      .items.query<Message>({
        query:
          // `from` and `to` are reserved words in Cosmos SQL, so they can only
          // be reached through the bracket form: `c.from` is a syntax error and
          // the whole query comes back 400.
          'SELECT * FROM c WHERE ARRAY_CONTAINS(@handles, c["from"].handle) OR ARRAY_CONTAINS(@handles, c["to"].handle)' +
            ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
        parameters: [
          { name: '@handles', value: lowered },
          { name: '@limit', value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }

  async sendMessage(message: Message): Promise<Message> {
    const { resource } = await this.container('messages').items.create(message);
    return resource ?? message;
  }

  /**
   * Reviews are partitioned by who they are about, which is how they are read:
   * a profile asks for everything written about one person.
   */
  async listReviewsAbout(subjectId: string): Promise<Review[]> {
    const { resources } = await this.container('reviews')
      .items.query<Review>(
        { query: 'SELECT * FROM c ORDER BY c.createdAt DESC' },
        { partitionKey: subjectId },
      )
      .fetchAll();
    return resources;
  }

  /**
   * The pair of reviews on one order.
   *
   * Cross-partition, because the two sit under different subjects by
   * definition - and it is bounded at two rows, which is the size that makes
   * the scan acceptable.
   */
  async listReviewsForOrder(orderId: string): Promise<Review[]> {
    const { resources } = await this.container('reviews')
      .items.query<Review>({
        query: 'SELECT * FROM c WHERE c.orderId = @orderId',
        parameters: [{ name: '@orderId', value: orderId }],
      })
      .fetchAll();
    return resources;
  }

  async createReview(review: Review): Promise<Review> {
    const { resource } = await this.container('reviews').items.create(review);
    return resource ?? review;
  }

  async updateReview(review: Review): Promise<Review> {
    const { resource } = await this.container('reviews').items.upsert<Review>(review);
    return resource ?? review;
  }

  async createDispute(dispute: Dispute): Promise<Dispute> {
    const { resource } = await this.container('disputes').items.create(dispute);
    return resource ?? dispute;
  }

  async getDispute(orderId: string, id: string): Promise<Dispute | null> {
    try {
      const { resource } = await this.container('disputes').item(id, orderId).read<Dispute>();
      return resource ?? null;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async updateDispute(dispute: Dispute): Promise<Dispute> {
    const { resource } = await this.container('disputes').items.upsert<Dispute>(dispute);
    return resource ?? dispute;
  }

  /**
   * By id alone. Cross-partition, because a link into a dispute carries only
   * its id and the order it belongs to is what the row itself says.
   */
  async getDisputeById(id: string): Promise<Dispute | null> {
    const { resources } = await this.container('disputes')
      .items.query<Dispute>({
        query: 'SELECT * FROM c WHERE c.id = @id OFFSET 0 LIMIT 1',
        parameters: [{ name: '@id', value: id }],
      })
      .fetchAll();
    return resources[0] ?? null;
  }

  async listDisputes(status?: string): Promise<Dispute[]> {
    const { resources } = await this.container('disputes')
      .items.query<Dispute>(
        status
          ? {
              query: 'SELECT * FROM c WHERE c.status = @status ORDER BY c.updatedAt DESC',
              parameters: [{ name: '@status', value: status }],
            }
          : { query: 'SELECT * FROM c ORDER BY c.updatedAt DESC' },
      )
      .fetchAll();
    return resources;
  }

  /* ── Operating the marketplace ───────────────────────────────────────── */

  async listAllUsers(): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({ query: 'SELECT * FROM c ORDER BY c.createdAt DESC' })
      .fetchAll();
    return resources;
  }

  async listEscrowAgents(): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.escrowRights) AND c.escrowRights != null',
      })
      .fetchAll();
    return resources.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async listPostsByAuthor(authorId: string): Promise<Post[]> {
    const { resources } = await this.container('posts')
      .items.query<Post>({
        query: 'SELECT * FROM c WHERE c.authorId = @authorId ORDER BY c.createdAt DESC',
        parameters: [{ name: '@authorId', value: authorId }],
      })
      .fetchAll();
    return resources;
  }

  async deleteUser(id: string): Promise<void> {
    const user = await this.getUserById(id);
    if (!user) return;
    // The reservations go back with the row. An identifier still pointing at a
    // deleted account locks that email or handle out of the marketplace for
    // good, which is a worse outcome than the deletion itself.
    for (const identifier of identifiersOf(user)) {
      await this.container('identifiers').item(identifier, identifier).delete().catch(() => {});
    }
    for (const handle of [user.username, user.sellerProfile?.username]) {
      if (!handle) continue;
      const key = handleKey(handle);
      await this.container('identifiers').item(key, key).delete().catch(() => {});
    }
    await this.container('users').item(id, id).delete().catch(() => {});
  }

  async deleteListing(sellerId: string, id: string): Promise<void> {
    await this.container('listings').item(id, sellerId).delete().catch(() => {});
  }

  async deletePost(channelId: string, id: string): Promise<void> {
    await this.container('posts').item(id, channelId).delete().catch(() => {});
  }

  async deleteLot(sellerId: string, id: string): Promise<void> {
    await this.container('lots').item(id, sellerId).delete().catch(() => {});
  }

  async deleteReview(subjectId: string, id: string): Promise<void> {
    await this.container('reviews').item(id, subjectId).delete().catch(() => {});
  }

  async markThreadRead(threadId: string, handle: string): Promise<number> {
    const unread = await this.listMessages(threadId);
    const now = new Date().toISOString();
    let changed = 0;
    for (const message of unread) {
      if (message.to.handle !== handle.toLowerCase() || message.readAt) continue;
      message.readAt = now;
      await this.container('messages').items.upsert(message);
      changed += 1;
    }
    return changed;
  }

  async listStoreOwners(): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({ query: 'SELECT * FROM c WHERE IS_DEFINED(c.sellerProfile) AND c.sellerProfile != null' })
      .fetchAll();
    return resources;
  }

  async listOrdersHeldBy(escrowAgentId: string): Promise<Order[]> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.protection.escrowAgentId = @id ORDER BY c.updatedAt DESC',
        parameters: [{ name: '@id', value: escrowAgentId }],
      })
      .fetchAll();
    return resources;
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
    return [
      { identifier: DEMO_EMAIL, label: `${DEMO_PHONE} · ${DEMO_PASSWORD}` },
      { identifier: PACKER_EMAIL, label: `the supplier's packing view · ${DEMO_PASSWORD}` },
      { identifier: ESCROW_EMAIL, label: `the escrow holding the money · ${DEMO_PASSWORD}` },
    ];
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
  /** Only on a `@handle` row: true when the handle belongs to a storefront. */
  isStore?: boolean;
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
