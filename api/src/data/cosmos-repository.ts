import { isPersonFollow } from '../../../shared/storefront.js';
import { AWAITING_LOT_ID } from '../../../shared/fulfilment.js';
import { isPlaced } from '../../../shared/orders.js';
import type { TrackingRoute } from '../../../shared/routes.js';
import type { PostTemplate } from '../../../shared/templates.js';
import { CosmosClient, type Container, type ContainerRequest, type Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import { CONTAINER_LIST, CONTAINERS, containerBody } from '../../../shared/containers.js';
import type {
  ClientDevice,
  Dispute, Follow, Forum, Like, Listing, ListingComment, Lot, Message, Order, Pledge, Post, Notification, PowerSale, Review, SiteContent, StoreReview, User, Want, WantOffer, WantSeeker,
} from '../../../shared/models.js';
import { checkUsername, handleKey, suggestUsername } from '../../../shared/handles.js';
import { matchesSearch, newestOrder, popularity } from '../../../shared/catalog.js';
import type { CosmosConfig } from '../config.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { BUMP_COOLDOWN_MS, sessionDigest } from './repository.js';
import { identifiersOf, normaliseIdentifier } from './memory-repository.js';
import { photoNamesIn } from '../storage/unused.js';
import { ReadSnapshots, StaleWriteError, adopt, mergeChanges } from './concurrency.js';
import {
  DEMO_EMAIL,
  DEMO_PASSWORD,
  DEMO_PHONE,
  MANAGER_EMAIL,
  HANDLER_EMAIL,
  ARTIST_EMAIL,
  FORWARDER_EMAIL,
  PACKER_EMAIL,
  seedComments,
  seedFollows,
  seedForums,
  RETIRED_FIXTURE_POSTS,
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
  seedWants,
  seedWantOffers,
  seedPledges,
  seedUsers,
} from './seed.js';
import { seedShowcaseListings, seedShowcaseLots, seedShowcaseOrders, seedShowcaseSales } from './seed-showcase.js';

/**
 * Whether an empty database may be filled with the development fixtures.
 *
 * On by default: the alternative is a deployment that connects successfully and
 * then behaves as though every password were wrong. Set COSMOS_AUTOSEED=off for
 * a database that is meant to start empty.
 */
/** Site-content id of the marker left once rows are in the current buyer-protection shape. */
const PAYMENT_HOLDS_MARKER = 'migration:protection-managers';

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

/** How long one instance reuses the newest-posts window and the forum list. */
const RECENT_TTL_MS = 15_000;
const FORUM_TTL_MS = 60_000;
/** Forums made up to here predate admins, and go to the site owner. */
const FORUM_OWNER_CUTOFF = '2026-10-07T00:00:00.000Z';

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

  /**
   * The background fixture pass, while it is still running.
   *
   * Nothing on a request path waits for this. It is held so that the tests can
   * assert on what it did, and so a second `init()` cannot start a second one.
   */
  private maintenance: Promise<void> | null = null;

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

    // Before any request reads a row: an order or user still in the old shape
    // would fail every read that expects the new one. Once done it costs one
    // point read of the marker it leaves.
    // An empty database has nothing in the old shape, and is left untouched.
    let migrated = '';
    try {
      if (signInAccounts > 0) migrated = await this.migratePaymentHolds();
    } catch (error) {
      migrated = ` Payment-hold migration failed: ${describeError(error)}.`;
    }

    let seeded = '';
    if (autoSeedEnabled()) {
      if (signInAccounts === 0) {
        // An empty database cannot serve anybody: every password is answered
        // "incorrect" until something is in it. So this one waits.
        try {
          seeded = await this.fill();
          signInAccounts = await this.countSignInAccounts();
        } catch (error) {
          seeded = ` Preparing the database failed: ${describeError(error)}.`;
        }
      } else {
        // A populated database already serves. Repairing it and adding what a
        // later release introduced are both maintenance, and maintenance does
        // not belong in front of a request: it used to run here, so the first
        // person to reach a cold worker waited for a full pass over every
        // container before their own read even started.
        seeded = ' Checking the fixtures in the background.';
        this.maintenance = this.runMaintenance(via, created).catch(() => undefined);
      }
    }

    this.state = {
      connected: true,
      database: this.cosmosConfig.database,
      detail: `Connected to ${this.cosmosConfig.endpoint} using ${via}. ${signInAccounts} sign-in account(s).${created}${migrated}${seeded}`,
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
   * Clears out the unpaid orders left from before the cart.
   *
   * Pressing Buy used to make a real order at once, unpaid, and take stock for
   * it; those piled up on profiles as "pay" rows nobody meant. Now an unpaid
   * Buy is a cart item (`placedAt: null`) and an order exists only once it is
   * paid or booked. An old row - no `placedAt` at all - still waiting on a
   * first payment, never booked, accepted or claimed, is one of those clicks:
   * its stock goes back on the shelf and the row goes. Anything with money or
   * a seller's decision on it is a real order and stays. Safe on every start.
   */
  private async clearLegacyUnpaid(): Promise<string> {
    const { resources } = await this.container('orders').items.query<Order>({
      query: "SELECT * FROM c WHERE NOT IS_DEFINED(c.placedAt) AND c.status = 'pending_payment' AND c.paymentStatus = 'unpaid'",
    }).fetchAll();
    const stale = resources.filter((order) => !order.bookingOnly && !order.accepted && !order.paymentClaim
      && !(order.payments?.length) && !(order.credits?.length));
    for (const order of stale) {
      const listing = await this.getListing(order.listingId);
      if (listing) {
        if (listing.quantityMode !== 'multiple') {
          listing.quantityAvailable += order.quantity;
          if (listing.status === 'sold_out') listing.status = 'active';
        }
        if (listing.preOrder) listing.preOrder.filledCount = Math.max(0, listing.preOrder.filledCount - order.quantity);
        listing.soldCount = Math.max(0, (listing.soldCount ?? 0) - order.quantity);
        await this.updateListing(listing);
      }
      await this.deleteOrder(order);
    }
    return stale.length ? ` Cleared ${stale.length} unpaid order(s) from before the cart.` : '';
  }

  /**
   * Rewrites rows stored in an older shape of buyer protection.
   *
   * Once a member the buyer picked held the payment, and rows named them as
   * its holder: the user's grant, the order's hold and the dispute topic all
   * carried the old name. Now Figmark holds every payment and a community
   * manager is assigned to the purchase, so the grant and hold are renamed,
   * the topic moved, and the holder becomes the assigned manager.
   *
   * An earlier release of this pass dropped the holder instead of keeping
   * them. Those orders get their manager back from the fee ledger - the
   * protection fee was recorded with the manager it paid - or, failing that,
   * the longest-serving manager who is neither party.
   *
   * Once: a marker records that the pass finished, and a row already in the
   * new shape is never rewritten.
   */
  private async migratePaymentHolds(): Promise<string> {
    if (await this.getSiteContent(PAYMENT_HOLDS_MARKER)) return '';

    const LEGACY_HOLD = 'escrow';
    const LEGACY_GRANT = 'escrowRights';
    type Row = Record<string, unknown> & { id: string };
    let moved = 0;

    const { resources: users } = await this.container('users').items.query<Row>({
      query: 'SELECT * FROM c WHERE IS_DEFINED(c.escrowRights)',
    }).fetchAll();
    for (const user of users) {
      if (!(LEGACY_GRANT in user)) continue;
      const grant = user[LEGACY_GRANT] as Record<string, unknown> | null;
      delete user[LEGACY_GRANT];
      if (grant) delete grant.feeBasisPoints;
      user.managerRights = user.managerRights ?? grant ?? null;
      await this.container('users').items.upsert(user);
      moved += 1;
    }

    // Who each protection fee paid, by order: the record of the manager an
    // order was protected with, if the order itself lost it.
    const ledger = await this.getSiteContent('fee-ledger');
    const paidTo = new Map<string, string>();
    for (const entry of ((ledger?.data as { entries?: { kind?: string; reference?: string; managerId?: string | null }[] } | undefined)?.entries ?? [])) {
      if (entry.kind === 'protection' && entry.reference && entry.managerId) paidTo.set(entry.reference, entry.managerId);
    }
    const managers = (await this.listManagers())
      .filter((user) => user.managerRights && !user.suspended)
      .sort((a, b) => (a.managerRights?.grantedAt ?? '').localeCompare(b.managerRights?.grantedAt ?? ''));
    const named = new Map(managers.map((user) => [user.id, user]));
    /** Gives a protection record its manager: the holder it named, the ledger's, or a neutral one. */
    const assign = async (record: Record<string, unknown>, orderId: string, parties: string[]): Promise<boolean> => {
      const legacyId = record.escrowAgentId as string | undefined;
      const legacyName = record.escrowName as string | undefined;
      const had = 'escrowAgentId' in record || 'escrowName' in record;
      delete record.escrowAgentId;
      delete record.escrowName;
      if (record.managerId) return had;
      const id = legacyId ?? paidTo.get(orderId) ?? managers.find((user) => !parties.includes(user.id))?.id;
      if (!id) return had;
      const user = named.get(id) ?? await this.getUserById(id);
      record.managerId = id;
      record.managerName = legacyName ?? user?.displayName ?? 'Community manager';
      return true;
    };

    const { resources: orders } = await this.container('orders').items.query<Row>({
      query: 'SELECT * FROM c WHERE IS_DEFINED(c.escrow) OR (IS_DEFINED(c.protection) AND c.protection != null AND NOT IS_DEFINED(c.protection.managerId))'
        + " OR (c.artistJob.method = 'protected' AND NOT IS_DEFINED(c.artistJob.managerId))"
        + " OR ARRAY_CONTAINS(c.disputeLinks, { topic: 'escrow' }, true)",
    }).fetchAll();
    for (const order of orders) {
      let changed = false;
      const parties = [order.buyerId as string, order.sellerId as string];
      if (LEGACY_HOLD in order) {
        order.hold = order.hold ?? order[LEGACY_HOLD];
        delete order[LEGACY_HOLD];
        changed = true;
      }
      if (order.protection && typeof order.protection === 'object') {
        if (await assign(order.protection as Record<string, unknown>, order.id, parties)) changed = true;
      }
      const job = order.artistJob as Record<string, unknown> | null | undefined;
      if (job && job.method === 'protected') {
        if (await assign(job, order.id, [order.buyerId as string, job.artistId as string])) changed = true;
      }
      for (const link of (order.disputeLinks as { topic?: string }[] | undefined) ?? []) {
        if (link.topic === LEGACY_HOLD) {
          link.topic = 'held_payment';
          changed = true;
        }
      }
      if (!changed) continue;
      await this.container('orders').items.upsert(order);
      moved += 1;
    }

    const { resources: disputes } = await this.container('disputes').items.query<Row>({
      query: "SELECT * FROM c WHERE c.topic = 'escrow'",
    }).fetchAll();
    for (const dispute of disputes) {
      if (dispute.topic !== LEGACY_HOLD) continue;
      dispute.topic = 'held_payment';
      await this.container('disputes').items.upsert(dispute);
      moved += 1;
    }

    await this.markPaymentHoldsMigrated(moved);
    return moved ? ` Moved ${moved} row(s) to Figmark-held payments with assigned managers.` : '';
  }

  /** Records that every row is in the Figmark-held shape, so the pass never runs again. */
  private async markPaymentHoldsMigrated(moved: number): Promise<void> {
    const now = new Date().toISOString();
    await this.saveSiteContent({ id: PAYMENT_HOLDS_MARKER, data: { moved }, updatedBy: null, createdAt: now, updatedAt: now });
  }

  /**
   * Makes the site owner the admin of every forum that existed before forums
   * had admins. Forums opened after the cutoff keep whoever opened them, so
   * this is safe to run on every start. The owner's handle comes from
   * FORUM_OWNER_HANDLE (default `swarnava`), matched by handle, else by first name.
   */
  private async assignForumOwner(): Promise<string> {
    const wanted = (process.env.FORUM_OWNER_HANDLE ?? 'swarnava').trim().toLowerCase();
    const users = await this.listAllUsers();
    const byHandle = users.filter((user) => (user.username ?? '').toLowerCase() === wanted);
    const byName = users.filter((user) => (user.displayName ?? '').trim().toLowerCase().split(/\s+/)[0] === wanted);
    // One account, or nobody: never guess between two people of the same name.
    const owner = byHandle.length === 1 ? byHandle[0] : byName.length === 1 ? byName[0] : null;
    if (!owner) return '';
    let moved = 0;
    for (const forum of await this.listForums()) {
      if (forum.createdBy === owner.id || forum.createdAt > FORUM_OWNER_CUTOFF) continue;
      await this.saveForum({
        ...forum,
        createdBy: owner.id,
        memberIds: [...new Set([...(forum.memberIds ?? []), owner.id])],
        moderatorIds: (forum.moderatorIds ?? []).filter((id) => id !== owner.id),
        bannedIds: (forum.bannedIds ?? []).filter((id) => id !== owner.id),
        updatedAt: new Date().toISOString(),
      });
      moved += 1;
    }
    return moved ? ` Made @${owner.username ?? owner.displayName} admin of ${moved} forum(s).` : '';
  }

  /**
   * Gives a handle to any account that has none.
   *
   * A row written before handles existed carries no username, and nothing
   * backfills one - the fixture top-up only ever adds whole rows and leaves
   * existing ones untouched, which is the right rule and the reason this gap
   * stayed open. The effect is an account with no address: it cannot be linked
   * to, `/<username>` has nothing to resolve, and every mention of that person
   * anywhere in the app renders as plain text because there is nowhere to send
   * the reader.
   *
   * Only an absent handle is filled. A handle somebody already has is theirs,
   * and a name they chose is not ours to change.
   */
  private async backfillHandles(): Promise<string> {
    const users = await this.listAllUsers();
    // Handle reservations share the identifiers container with sign-in
    // identifiers - one namespace, one uniqueness guarantee - so what is
    // already claimed is exactly what is in there.
    const claimed = await this.existingIds('identifiers');

    let given = 0;
    for (const user of users) {
      const wantsPersonal = !user.username;
      const wantsStore = Boolean(user.sellerProfile) && !user.sellerProfile!.username;
      if (!wantsPersonal && !wantsStore) continue;

      if (wantsPersonal) {
        const handle = await this.freeHandle(suggestUsername(nameFor(user)), claimed);
        if (handle && (await this.reserveHandle(handle, user.id, false))) {
          user.username = handle;
          claimed.add(handleKey(handle));
          given += 1;
        }
      }
      if (wantsStore) {
        const shop = user.sellerProfile!;
        const handle = await this.freeHandle(suggestUsername(shop.storefrontName || nameFor(user)), claimed);
        if (handle && (await this.reserveHandle(handle, user.id, true))) {
          shop.username = handle;
          claimed.add(handleKey(handle));
          given += 1;
        }
      }

      user.updatedAt = new Date().toISOString();
      await this.updateUser(user);
    }

    return given === 0 ? '' : ` Gave ${given} handle(s) to accounts that had none.`;
  }

  /**
   * The wanted handle, or the first numbered variant nobody holds.
   *
   * Two shops called "Kaiju Imports" cannot both be at /kaiju_imports, and the
   * second one silently getting no handle at all is worse than it getting
   * kaiju_imports2.
   */
  private async freeHandle(wanted: string, claimed: Set<string>): Promise<string | null> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = attempt === 0 ? wanted : `${wanted}${attempt + 1}`;
      if (checkUsername(candidate)) continue;
      if (!claimed.has(handleKey(candidate))) return candidate;
    }
    return null;
  }

  /**
   * Waits for the background fixture pass, if one is running.
   *
   * Only the tests call this: a request that waited for maintenance would be
   * back to paying for it, which is the whole thing this moved off that path.
   */
  async settled(): Promise<void> {
    await this.maintenance;
  }

  /**
   * Repair, then top up, with nobody waiting on the result.
   *
   * Runs against a database that is already serving, so it may only ever add
   * what is missing - never rewrite a row somebody is using. The outcome lands
   * in the status detail, because a maintenance pass nobody can see the result
   * of is one that fails silently.
   */
  private async runMaintenance(via: string, created: string): Promise<void> {
    let outcome: string;
    try {
      // Independent passes over different containers, so they overlap rather
      // than queue: the repair reads users and identifiers, the top-up reads
      // the nine containers that hold fixtures.
      // First, so the fixtures this removes come straight back - as cart items.
      const cleared = await this.clearLegacyUnpaid().catch((error) => ` Unpaid clean-up failed: ${describeError(error)}.`);
      const [repaired, toppedUp] = await Promise.all([this.repair(), this.topUpFixtures()]);
      // After the rows are in place, so anything the top-up just added is
      // considered too.
      const handles = await this.backfillHandles();
      // Never lets a failure here stop the start-up repairs reporting.
      const forums = await this.assignForumOwner().catch((error) => ` Forum owner pass failed: ${describeError(error)}.`);
      outcome = `${cleared}${repaired}${toppedUp}${handles}${forums}` || ' Fixtures were already up to date.';
    } catch (error) {
      outcome = ` Preparing the database failed: ${describeError(error)}.`;
    }

    let signInAccounts = this.state.signInAccounts;
    try {
      signInAccounts = await this.countSignInAccounts();
    } catch {
      // Leave the count as init found it; the outcome above is the news here.
    }

    this.state = {
      ...this.state,
      detail: `Connected to ${this.cosmosConfig.endpoint} using ${via}. ${signInAccounts} sign-in account(s).${created}${outcome}`,
      signInAccounts,
    };
    this.maintenance = null;
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
    // Seeded in the current shape: there is nothing for the migration to move.
    await this.markPaymentHoldsMigrated(0);
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
   * releases of protection, reviews and disputes landed that way and none of them
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
      ['lots', [...seedLots(), seedOpenLot(), seedShippedLot(), ...seedShowcaseLots()]],
      ['listings', [...seedListings(), ...seedShowcaseListings()]],
      ['orders', [...seedOrders(), seedLiveSale(), ...seedLotOrders(), ...seedShowcaseOrders()]],
      ['powerSales', seedShowcaseSales()],
      ['comments', seedComments()],
      ['forums', seedForums()],
      ['posts', seedPosts()],
      ['reviews', seedReviews()],
      ['disputes', seedDisputes()],
      ['wants', seedWants()],
      ['wantOffers', seedWantOffers()],
      ['pledges', seedPledges()],
    ] as const;

    let added = 0;
    const newUsers: User[] = [];
    let postIds = new Set<string>();

    for (const [name, items] of fixtures) {
      const present = await this.existingIds(name);
      if (name === 'posts') postIds = present;
      const missing = items.filter((item) => !present.has(item.id));
      if (missing.length === 0) continue;

      // Only the genuinely absent ones are written, and in parallel: a handful
      // of rows after a release, none at all on the run after that.
      await Promise.all(missing.map((item) => this.container(name).items.upsert(item)));
      added += missing.length;
      if (name === 'users') newUsers.push(...(missing as readonly User[]));
    }

    // Shops do not belong in forums - a forum is people talking as themselves.
    // The first fixture rooms were seeded with shops speaking in them; take
    // those out wherever they are still standing.
    const retired = RETIRED_FIXTURE_POSTS.filter(([, id]) => postIds.has(id));
    await Promise.all(retired.map(([channelId, id]) => this.deletePost(channelId, id)));

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
      ['lots', [...seedLots(), seedOpenLot(), seedShippedLot(), ...seedShowcaseLots()]],
      ['listings', [...seedListings(), ...seedShowcaseListings()]],
      ['orders', [...seedOrders(), seedLiveSale(), ...seedLotOrders(), ...seedShowcaseOrders()]],
      ['powerSales', seedShowcaseSales()],
      ['comments', seedComments()],
      ['forums', seedForums()],
      ['posts', seedPosts()],
      ['reviews', seedReviews()],
      ['disputes', seedDisputes()],
      ['wants', seedWants()],
      ['wantOffers', seedWantOffers()],
      ['pledges', seedPledges()],
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

  /** How orders, listings and users looked when read - see concurrency.ts. */
  private readonly snapshots = new ReadSnapshots();

  /**
   * Writes a document read earlier, only if nobody else wrote it in between.
   *
   * A lost race is merged when the two changes touch different fields, and
   * refused with `StaleWriteError` when they touch the same one. A document
   * with no etag was never read from the store, so there is nothing to check
   * it against and it is written as before.
   */
  private async writeChecked<T extends { id: string; _etag?: string }>(
    name: 'orders' | 'listings' | 'users',
    partition: string,
    doc: T,
  ): Promise<T> {
    const item = this.container(name).item(doc.id, partition);
    if (!doc._etag) {
      const { resource } = name === 'users'
        ? await this.container(name).items.upsert<T>(doc)
        : await item.replace<T>(doc);
      const saved = (resource as T | undefined) ?? doc;
      this.snapshots.remember(name, saved);
      return adopt(doc, saved);
    }

    const base = this.snapshots.recall<T>(name, doc.id, doc._etag);
    let next: T = doc;
    let etag = doc._etag;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const { resource } = await item.replace<T>(next, { accessCondition: { type: 'IfMatch', condition: etag } });
        const saved = (resource as T | undefined) ?? next;
        this.snapshots.remember(name, saved);
        return adopt(doc, saved);
      } catch (error) {
        if ((error as { code?: number }).code !== 412) throw error;
      }
      if (!base) throw new StaleWriteError();
      const { resource: current, etag: currentEtag } = await item.read<T>().catch((error: unknown) => {
        if (isNotFound(error)) return { resource: undefined, etag: undefined };
        throw error;
      });
      if (!current || !currentEtag) throw new StaleWriteError();
      const merged = mergeChanges(base, doc, current);
      if (!merged) throw new StaleWriteError();
      next = merged;
      etag = currentEtag;
    }
    throw new StaleWriteError('This is too busy to change right now. Try again.');
  }

  async getUserById(id: string): Promise<User | null> {
    try {
      // users is partitioned by /id, so this is a point read.
      const { resource } = await this.container('users').item(id, id).read<User>();
      return resource ? this.snapshots.remember('users', resource) : null;
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

  async listTemplates(sellerId: string): Promise<PostTemplate[]> {
    const { resources } = await this.container('postTemplates')
      .items.query<PostTemplate>(
        {
          query: 'SELECT * FROM c WHERE c.sellerId = @sellerId ORDER BY c.name ASC',
          parameters: [{ name: '@sellerId', value: sellerId }],
        },
        { partitionKey: sellerId },
      )
      .fetchAll();
    return resources;
  }

  async getTemplate(sellerId: string, templateId: string): Promise<PostTemplate | null> {
    try {
      const { resource } = await this.container('postTemplates')
        .item(templateId, sellerId)
        .read<PostTemplate>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async saveTemplate(template: PostTemplate): Promise<PostTemplate> {
    const { resource } = await this.container('postTemplates').items.upsert<PostTemplate>(template);
    return resource ?? template;
  }

  async deleteTemplate(sellerId: string, templateId: string): Promise<boolean> {
    try {
      await this.container('postTemplates').item(templateId, sellerId).delete();
      return true;
    } catch {
      return false;
    }
  }

  async listRoutes(sellerId: string): Promise<TrackingRoute[]> {
    const { resources } = await this.container('routes')
      .items.query<TrackingRoute>(
        {
          query: 'SELECT * FROM c WHERE c.sellerId = @sellerId ORDER BY c.name ASC',
          parameters: [{ name: '@sellerId', value: sellerId }],
        },
        { partitionKey: sellerId },
      )
      .fetchAll();
    return resources;
  }

  async getRoute(sellerId: string, routeId: string): Promise<TrackingRoute | null> {
    try {
      const { resource } = await this.container('routes').item(routeId, sellerId).read<TrackingRoute>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async saveRoute(route: TrackingRoute): Promise<TrackingRoute> {
    const { resource } = await this.container('routes').items.upsert<TrackingRoute>(route);
    return resource ?? route;
  }

  async deleteRoute(sellerId: string, routeId: string): Promise<boolean> {
    try {
      await this.container('routes').item(routeId, sellerId).delete();
      return true;
    } catch {
      return false;
    }
  }

  async listOrdersAwaitingLot(sellerId: string): Promise<Order[]> {
    // Single-partition: every waiting item is filed under the one sentinel, so
    // "what is there to put in this lot" is a cheap read however many shops
    // are using the app.
    const { resources } = await this.container('orders')
      .items.query<Order>(
        {
          query:
            'SELECT * FROM c WHERE c.lotId = @lotId AND c.sellerId = @sellerId'
            + ' AND c.status != "cancelled" ORDER BY c.createdAt ASC',
          parameters: [
            { name: '@lotId', value: AWAITING_LOT_ID },
            { name: '@sellerId', value: sellerId },
          ],
        },
        { partitionKey: AWAITING_LOT_ID },
      )
      .fetchAll();
    this.snapshots.rememberAll('orders', resources);
    return resources.filter(isPlaced);
  }

  async moveOrderToLot(order: Order, fromLotId: string): Promise<Order> {
    // `lotId` is the partition key, so this is not an update. Create in the new
    // partition first: if the delete then fails the item is in two lots,
    // which a manifest makes obvious - the other order would leave it in none,
    // which nothing would.
    const moved: Order = { ...order, updatedAt: new Date().toISOString() };
    const { resource } = await this.container('orders').items.upsert<Order>(moved);
    if (fromLotId !== moved.lotId) {
      await this.container('orders').item(moved.id, fromLotId).delete().catch(() => undefined);
    }
    return (resource as Order | undefined) ?? moved;
  }

  async listHandlers(): Promise<User[]> {
    // Listed ones only. An unlisted handler still works - a shop names them on
    // a lot by hand - they are simply not on offer to strangers.
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.handlerProfile) AND c.handlerProfile.listedInDirectory = true',
      })
      .fetchAll();
    return resources.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async updateUser(user: User): Promise<User> {
    return this.writeChecked('users', user.id, user as User & { _etag?: string });
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

  async changePhone(user: User, phone: string): Promise<boolean> {
    const next = normaliseIdentifier(phone);
    const previous = user.phone ? normaliseIdentifier(user.phone) : null;
    if (next !== previous) {
      const existing = await this.readReservation(next);
      if (existing && existing.userId !== user.id) return false;
      if (!existing) {
        try {
          await this.container('identifiers').items.create({ id: next, userId: user.id });
        } catch (error) {
          if (isConflict(error)) return false;
          throw error;
        }
      }
    }
    user.phone = phone;
    await this.updateUser(user);
    if (previous && previous !== next) {
      await this.container('identifiers').item(previous, previous).delete().catch(() => {});
    }
    return true;
  }

  async listMessages(threadId: string, limit = 200, before?: string): Promise<Message[]> {
    const { resources } = await this.container('messages')
      .items.query<Message>(
        {
          // No `before` reads from the newest: every ISO time sorts below '~'.
          query: 'SELECT * FROM c WHERE c.createdAt <= @before ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
          parameters: [{ name: '@before', value: before ?? '~' }, { name: '@limit', value: limit }],
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

  async deleteMessage(threadId: string, id: string): Promise<void> {
    await this.container('messages').item(id, threadId).delete().catch(() => {});
  }

  async updateMessage(message: Message): Promise<Message> {
    const { resource } = await this.container('messages').items.upsert(message);
    return (resource as Message | undefined) ?? message;
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

  async saveDisputeIfVersion(dispute: Dispute, expectedVersion: number): Promise<Dispute | null> {
    // The version is the rule the routes reason about; the etag makes the
    // check and the write one step, so nothing lands between them.
    const item = this.container('disputes').item(dispute.id, dispute.orderId);
    const { resource: current, etag } = await item.read<Dispute>().catch((error: unknown) => {
      if (isNotFound(error)) return { resource: undefined, etag: undefined };
      throw error;
    });
    if (!current || (current.version ?? 0) !== expectedVersion) return null;
    try {
      const { resource } = await item.replace<Dispute>(dispute, { accessCondition: { type: 'IfMatch', condition: etag ?? '' } });
      return resource ?? dispute;
    } catch (error) {
      if ((error as { code?: number }).code === 412) return null;
      throw error;
    }
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

  async listDisputesForOrder(orderId: string): Promise<Dispute[]> {
    const { resources } = await this.container('disputes')
      .items.query<Dispute>(
        { query: 'SELECT * FROM c WHERE c.orderId = @orderId', parameters: [{ name: '@orderId', value: orderId }] },
        { partitionKey: orderId },
      )
      .fetchAll();
    return resources;
  }

  /** Cross-partition, bounded by how many disputes one person is ever in. */
  async listDisputesForParty(userId: string): Promise<Dispute[]> {
    const { resources } = await this.container('disputes')
      .items.query<Dispute>({
        query: 'SELECT * FROM c WHERE c.raisedBy = @id OR c.againstUserId = @id ORDER BY c.updatedAt DESC',
        parameters: [{ name: '@id', value: userId }],
      })
      .fetchAll();
    return resources;
  }

  async listDisputesForManager(managerId: string): Promise<Dispute[]> {
    const { resources } = await this.container('disputes')
      .items.query<Dispute>({
        query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(c.managerIds, @id) ORDER BY c.updatedAt DESC',
        parameters: [{ name: '@id', value: managerId }],
      })
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

  async blobReferences(): Promise<Set<string>> {
    const found = new Set<string>();
    for (const definition of CONTAINER_LIST) {
      const pages = this.container(definition.name as keyof typeof CONTAINERS)
        .items.query({ query: 'SELECT * FROM c' })
        .getAsyncIterator();
      for await (const page of pages) {
        for (const name of photoNamesIn(JSON.stringify(page.resources ?? []))) found.add(name);
      }
    }
    return found;
  }

  async listManagers(): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.managerRights) AND c.managerRights != null',
      })
      .fetchAll();
    return resources.sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  async listOpenWants(options: { category?: string; limit?: number } = {}): Promise<Want[]> {
    // Cross-partition, bounded, and filtered on the server rather than after:
    // a seller scanning for demand reads the recent end of the board, and an
    // expired hunt is one nobody is still hunting.
    //
    // One fixed query with the category always supplied rather than a WHERE
    // clause built by concatenation. An assembled query cannot be read by the
    // check that verifies every named parameter is actually passed, and losing
    // that check is a worse trade than one redundant comparison: an empty
    // category means "any", which the first half of the OR says outright.
    const { resources } = await this.container('wants')
      .items.query<Want>({
        query:
          "SELECT * FROM c WHERE c.status = 'open' AND c.expiresAt > @now" +
          ' AND (@category = "" OR c.category = @category)' +
          ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
        parameters: [
          { name: '@now', value: new Date().toISOString() },
          { name: '@category', value: options.category ?? '' },
          { name: '@limit', value: options.limit ?? 50 },
        ],
      })
      .fetchAll();
    return resources;
  }

  async listWantsBy(buyerId: string): Promise<Want[]> {
    const { resources } = await this.container('wants')
      .items.query<Want>(
        { query: 'SELECT * FROM c ORDER BY c.createdAt DESC' },
        { partitionKey: buyerId },
      )
      .fetchAll();
    return resources;
  }

  async getWant(id: string, buyerId: string): Promise<Want | null> {
    // Partitioned by the person who posted it, so reading one needs both -
    // and the board hands the caller the pair.
    try {
      const { resource } = await this.container('wants').item(id, buyerId).read<Want>();
      return resource ?? null;
    } catch {
      return null;
    }
  }

  async saveWant(want: Want): Promise<Want> {
    const { resource } = await this.container('wants').items.upsert<Want>(want);
    return resource!;
  }

  async listWantOffers(wantId: string): Promise<WantOffer[]> {
    const { resources } = await this.container('wantOffers')
      .items.query<WantOffer>(
        { query: 'SELECT * FROM c ORDER BY c.createdAt DESC' },
        { partitionKey: wantId },
      )
      .fetchAll();
    return resources;
  }

  async saveWantOffer(offer: WantOffer): Promise<WantOffer> {
    const { resource } = await this.container('wantOffers').items.upsert<WantOffer>(offer);
    return resource!;
  }

  async listWantSeekers(wantId: string): Promise<WantSeeker[]> {
    const { resources } = await this.container('wantSeekers')
      .items.query<WantSeeker>({ query: 'SELECT * FROM c' }, { partitionKey: wantId })
      .fetchAll();
    return resources;
  }

  async saveWantSeeker(seeker: WantSeeker): Promise<WantSeeker> {
    const { resource } = await this.container('wantSeekers').items.upsert<WantSeeker>(seeker);
    return resource!;
  }

  async listWantIdsSeekingBy(userId: string): Promise<string[]> {
    // Cross-partition, and small: it is bounded by how many hunts one person
    // has joined, not by how many exist.
    const { resources } = await this.container('wantSeekers')
      .items.query<string>({
        query: 'SELECT VALUE c.wantId FROM c WHERE c.userId = @userId',
        parameters: [{ name: '@userId', value: userId }],
      })
      .fetchAll();
    return resources;
  }

  async deleteWantSeeker(id: string, wantId: string): Promise<void> {
    await this.container('wantSeekers').item(id, wantId).delete();
  }

  async listPledges(listingId: string): Promise<Pledge[]> {
    const { resources } = await this.container('pledges')
      .items.query<Pledge>({ query: 'SELECT * FROM c ORDER BY c.createdAt ASC' }, { partitionKey: listingId })
      .fetchAll();
    return resources;
  }

  async savePledge(pledge: Pledge): Promise<Pledge> {
    const { resource } = await this.container('pledges').items.upsert<Pledge>(pledge);
    return resource!;
  }

  async deletePledge(id: string, listingId: string): Promise<void> {
    try {
      await this.container('pledges').item(id, listingId).delete();
    } catch (error) {
      // Leaving is idempotent: a second tap on "I'm in" must not answer 500.
      if (!isNotFound(error)) throw error;
    }
  }

  async listPledgedListingIds(userId: string): Promise<string[]> {
    // Cross-partition, and small: bounded by how many campaigns one person has
    // joined, not by how many exist.
    const { resources } = await this.container('pledges')
      .items.query<string>({
        query: 'SELECT VALUE c.listingId FROM c WHERE c.userId = @userId',
        parameters: [{ name: '@userId', value: userId }],
      })
      .fetchAll();
    return resources;
  }

  async updateListing(listing: Listing): Promise<Listing> {
    listing.updatedAt = new Date().toISOString();
    return this.writeChecked('listings', listing.sellerId, listing as Listing & { _etag?: string });
  }

  async listPowerSales(sellerId: string): Promise<PowerSale[]> {
    const { resources } = await this.container('powerSales')
      .items.query<PowerSale>({ query: 'SELECT * FROM c ORDER BY c.createdAt DESC' }, { partitionKey: sellerId })
      .fetchAll();
    return resources;
  }

  async listLivePowerSales(): Promise<PowerSale[]> {
    // Cross-partition, and bounded by how many sales are live right now.
    const { resources } = await this.container('powerSales')
      .items.query<PowerSale>({ query: 'SELECT * FROM c WHERE c.status IN ("scheduled", "running")' })
      .fetchAll();
    return resources;
  }

  async getPowerSale(sellerId: string, id: string): Promise<PowerSale | null> {
    try {
      const { resource } = await this.container('powerSales').item(id, sellerId).read<PowerSale>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async savePowerSale(sale: PowerSale): Promise<PowerSale> {
    const { resource } = await this.container('powerSales').items.upsert<PowerSale>(sale);
    return resource!;
  }

  async listNotifications(userId: string, limit = 40, before?: string): Promise<Notification[]> {
    const { resources } = await this.container('notifications')
      .items.query<Notification>(
        before
          ? {
            query: 'SELECT * FROM c WHERE c.createdAt < @before ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
            parameters: [{ name: '@before', value: before }, { name: '@limit', value: limit }],
          }
          : {
            query: 'SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
            parameters: [{ name: '@limit', value: limit }],
          },
        { partitionKey: userId },
      )
      .fetchAll();
    return resources;
  }

  async saveNotification(notification: Notification): Promise<Notification> {
    const { resource } = await this.container('notifications').items.upsert<Notification>(notification);
    return resource!;
  }

  /* Cross-partition, but bounded to a few minutes of holds, and a clock that
     finds nothing costs one small query. */
  async listHeldNotificationsDue(from: string, until: string): Promise<Notification[]> {
    const { resources } = await this.container('notifications')
      .items.query<Notification>({
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.notBefore) AND c.notBefore >= @since AND c.notBefore <= @until'
          + ' AND NOT IS_DEFINED(c.pushedAt) AND (NOT IS_DEFINED(c.withdrawn) OR c.withdrawn = false)',
        parameters: [{ name: '@since', value: from }, { name: '@until', value: until }],
      })
      .fetchAll();
    return resources;
  }

  /* Cross-partition over accounts, projected to the two fields the figures
     need; read only when an operator opens the installs page. */
  async listClientDevices(): Promise<Array<{ id: string; clientDevices: ClientDevice[] }>> {
    const { resources } = await this.container('users')
      .items.query<{ id: string; clientDevices: ClientDevice[] }>({
        query: 'SELECT c.id, c.clientDevices FROM c WHERE IS_DEFINED(c.clientDevices)',
      })
      .fetchAll();
    return resources;
  }

  /* Cross-partition over accounts, but only run when a device turns
     notifications on, which is once per device. */
  async listUsersByPushEndpoint(endpoint: string): Promise<User[]> {
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(c.pushEndpoints, { "endpoint": @endpoint }, true)',
        parameters: [{ name: '@endpoint', value: endpoint }],
      })
      .fetchAll();
    return resources;
  }

  async listStoreReviews(subjectId: string): Promise<StoreReview[]> {
    const { resources } = await this.container('storeReviews')
      .items.query<StoreReview>(
        { query: 'SELECT * FROM c ORDER BY c.createdAt DESC' },
        { partitionKey: subjectId },
      )
      .fetchAll();
    return resources;
  }

  async saveStoreReview(review: StoreReview): Promise<StoreReview> {
    const { resource } = await this.container('storeReviews').items.upsert<StoreReview>(review);
    return resource!;
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
    this.recentCache = null;
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

  async listStoresManagedBy(userId: string): Promise<User[]> {
    // A partial match on the manager entry: only its userId has to agree.
    const { resources } = await this.container('users')
      .items.query<User>({
        query: 'SELECT * FROM c WHERE IS_DEFINED(c.sellerProfile.managers)'
          + ' AND ARRAY_CONTAINS(c.sellerProfile.managers, { "userId": @id }, true)',
        parameters: [{ name: '@id', value: userId }],
      })
      .fetchAll();
    return resources;
  }

  async listOrdersCommissionedFrom(artistId: string): Promise<Order[]> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.artistJob.artistId = @id',
        parameters: [{ name: '@id', value: artistId }],
      })
      .fetchAll();
    return resources.sort((a, b) => (b.artistJob?.updatedAt ?? '').localeCompare(a.artistJob?.updatedAt ?? ''));
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
    this.snapshots.rememberAll('orders', resources);
    return resources.filter(isPlaced);
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

  async listPostsForChannels(
    channelIds: readonly string[], limit = 60, options: { before?: string; feedOnly?: boolean } = {},
  ): Promise<Post[]> {
    if (channelIds.length === 0) return [];
    const { resources } = await this.container('posts')
      .items.query<Post>({
        query:
          'SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.channelId) AND c.createdAt < @before'
          + " AND (@everything = true OR NOT IS_DEFINED(c.reach) OR c.reach = 'feed')"
          + ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
        parameters: [
          { name: '@ids', value: [...channelIds] },
          // No `before` reads from the newest: every ISO time sorts below '~'.
          { name: '@before', value: options.before ?? '~' },
          { name: '@everything', value: !options.feedOnly },
          { name: '@limit', value: limit },
        ],
      })
      .fetchAll();
    return resources;
  }

  async createPost(post: Post): Promise<Post> {
    this.recentCache = null;
    if (post.channel === 'forum') this.forumCache = null;
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

  /**
   * The newest posts anywhere, kept for a few seconds per instance.
   *
   * Trending and the home feed both read the same couple of hundred posts on
   * every load, across every partition. Any post written through this
   * instance clears it; one written elsewhere shows within the TTL.
   */
  private recentCache: { at: number; limit: number; posts: Promise<Post[]> } | null = null;

  async listRecentPosts(limit: number): Promise<Post[]> {
    const cached = this.recentCache;
    if (cached && cached.limit >= limit && Date.now() - cached.at < RECENT_TTL_MS) {
      return structuredClone((await cached.posts).slice(0, limit));
    }
    const posts = this.container('posts')
      .items.query<Post>({
        query: 'SELECT * FROM c ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
        parameters: [{ name: '@limit', value: limit }],
      })
      .fetchAll()
      .then(({ resources }) => resources);
    const entry = { at: Date.now(), limit, posts };
    this.recentCache = entry;
    posts.catch(() => {
      if (this.recentCache === entry) this.recentCache = null;
    });
    return structuredClone(await posts);
  }

  async getPost(channelId: string, id: string): Promise<Post | null> {
    try {
      const { resource } = await this.container('posts').item(id, channelId).read<Post>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async mutatePost(channelId: string, id: string, change: (post: Post) => Post | null): Promise<Post | null> {
    // Optimistic: replace only if nobody else wrote in between, and on losing
    // that race read again and redo the change against what won. A handful of
    // attempts is plenty for a reaction; past that something else is wrong.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { resource, etag } = await this.container('posts').item(id, channelId).read<Post>()
        .catch((error: unknown) => {
          if (isNotFound(error)) return { resource: undefined, etag: undefined };
          throw error;
        });
      if (!resource) return null;
      const next = change(resource);
      if (!next) return resource;
      this.recentCache = null;
      try {
        const { resource: saved } = await this.container('posts').item(id, channelId).replace<Post>(next, {
          accessCondition: { type: 'IfMatch', condition: etag ?? '' },
        });
        return saved ?? next;
      } catch (error) {
        if ((error as { code?: number }).code === 412) continue;
        throw error;
      }
    }
    throw new Error('That post is too busy to change right now. Try again.');
  }

  /** Forums change rarely and are read by every feed with a forum post in it. */
  private forumCache: { at: number; forums: Promise<Forum[]> } | null = null;

  async listForums(): Promise<Forum[]> {
    const cached = this.forumCache;
    if (cached && Date.now() - cached.at < FORUM_TTL_MS) return structuredClone(await cached.forums);
    const forums = this.container('forums')
      .items.query<Forum>({ query: 'SELECT * FROM c ORDER BY c.name' })
      .fetchAll()
      .then(({ resources }) => resources);
    const entry = { at: Date.now(), forums };
    this.forumCache = entry;
    forums.catch(() => {
      if (this.forumCache === entry) this.forumCache = null;
    });
    return structuredClone(await forums);
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
    this.forumCache = null;
    const { resource } = await this.container('forums').items.create(forum);
    return resource ?? forum;
  }

  async saveForum(forum: Forum): Promise<Forum> {
    this.forumCache = null;
    const { resource } = await this.container('forums').items.upsert(forum);
    return (resource as Forum | undefined) ?? forum;
  }

  listDemoAccounts(): DemoAccount[] {
    // Only for a database this instance seeded itself: those fixtures are the
    // ones in this repository, so naming them tells the user nothing the source
    // does not. A database holding real accounts is never advertised.
    if (!this.seeded) return [];
    return [
      { identifier: DEMO_EMAIL, label: `${DEMO_PHONE} · ${DEMO_PASSWORD}` },
      { identifier: PACKER_EMAIL, label: `the supplier's packing view · ${DEMO_PASSWORD}` },
      { identifier: MANAGER_EMAIL, label: `a community manager who decides disputes · ${DEMO_PASSWORD}` },
      { identifier: HANDLER_EMAIL, label: `the handler getting the parcels out · ${DEMO_PASSWORD}` },
      { identifier: FORWARDER_EMAIL, label: `the freight forwarder's store · ${DEMO_PASSWORD}` },
      { identifier: ARTIST_EMAIL, label: `the artist studio taking commissions · ${DEMO_PASSWORD}` },
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

  async bumpCounter(id: string, by: number, ttlSeconds: number): Promise<number | null> {
    // Kept in the sessions container: it already expires its rows, and a
    // container of its own would be the 25th - the most a shared-throughput
    // database allows.
    const item = this.container('sessions').item(id, id);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (by === 0) {
          const { resource } = await item.read<{ count?: number }>();
          return resource?.count ?? 0;
        }
        const { resource } = await item.patch<{ count?: number }>([{ op: 'incr', path: '/count', value: by }]);
        return resource?.count ?? by;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      if (by <= 0) return 0;
      try {
        await this.container('sessions').items.create({ id, count: by, ttl: ttlSeconds });
        return by;
      } catch (error) {
        // Created by another instance in between: count on top of theirs.
        if (!isConflict(error)) throw error;
      }
    }
    return null;
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

  /**
   * The catalog, narrowed.
   *
   * Everything a chip can set is pushed into the SQL rather than filtered
   * afterwards: this used to return the newest hundred listings and ignore the
   * filters entirely, so every chip on the buy page did nothing in production
   * while passing every test against the in-memory store.
   *
   * One static statement with dead clauses switched off by their own parameter,
   * rather than a WHERE assembled from whichever filters are set. Assembled SQL
   * cannot be checked before it is sent, and an unchecked query is exactly how
   * a reserved word reached production last time.
   *
   * Search is the exception and stays in JavaScript: "every one of these words,
   * across four fields" is not expressible without building the statement from
   * the term. It therefore searches the window this query returns rather than
   * all of history, so the window is opened wider when there is a term.
   */
  async listListings(query: CatalogQuery = {}): Promise<Listing[]> {
    const byPopularity = query.sort === 'popular';
    const limit = byPopularity ? 400 : query.limit ?? (query.search ? 400 : 100);
    // "Newest" means the later of listed and bumped, which Cosmos cannot ORDER BY.
    const ranked = !query.sort || query.sort === 'newest';
    const where =
      // The operations console passes @all, because it deletes what an
      // account made and cannot do that from a filtered list. Everybody else
      // gets the catalog: active, and not hidden behind a members' window.
      'SELECT * FROM c WHERE (@all = true OR c.status = "active")' +
      ' AND (@all = true OR NOT IS_DEFINED(c.unlisted) OR c.unlisted = false)' +
      ' AND (@seller = "" OR c.sellerId = @seller)' +
      ' AND (@cat = "" OR c.category = @cat)' +
      ' AND (IS_NULL(@cats) OR ARRAY_CONTAINS(@cats, c.category))' +
      ' AND (@cond = "" OR c.condition = @cond)' +
      ' AND (@price = 0 OR c.priceMinor <= @price)' +
      ' AND (@kind = "" OR (@kind = "pre_order" AND IS_DEFINED(c.preOrder) AND NOT IS_NULL(c.preOrder))' +
      ' OR (@kind = "mixed_lot" AND c.bundle = true)' +
      ' OR (@kind = "in_hand" AND (c.sourcing = "in_hand" OR (NOT IS_DEFINED(c.sourcing) AND NOT IS_DEFINED(c.lotId))))' +
      ' OR (@kind = "in_stock" AND (NOT IS_DEFINED(c.preOrder) OR IS_NULL(c.preOrder))))';
    const bound = {
      parameters: [
        { name: '@all', value: query.includeHidden === true },
        { name: '@seller', value: query.sellerId ?? '' },
        { name: '@cat', value: query.category ?? '' },
        // Null rather than an empty array: absent means every category, and an
        // empty list means none of them, which is what an unknown heading is.
        { name: '@cats', value: query.categories ? [...query.categories] : null },
        { name: '@cond', value: query.condition ?? '' },
        { name: '@price', value: query.maxPriceMinor ?? 0 },
        { name: '@kind', value: query.kind && query.kind !== 'all' ? query.kind : '' },
        { name: '@limit', value: limit },
      ],
    };
    const options = query.sellerId ? { partitionKey: query.sellerId } : undefined;
    const read = (sql: string) =>
      this.container('listings').items.query<Listing>({ query: sql, parameters: bound.parameters }, options).fetchAll();

    // A bump is recency without rewriting createdAt, and Cosmos cannot ORDER BY
    // "the later of two fields". So "newest" also reads the latest bumps and
    // merges: the freshest N are always among the newest N listed plus the N
    // most recently bumped.
    const [listed, bumped] = await Promise.all([
      read(where + catalogOrder(query.sort)),
      ranked
        ? read(where + ' AND IS_DEFINED(c.bumpedAt) AND NOT IS_NULL(c.bumpedAt) ORDER BY c.bumpedAt DESC OFFSET 0 LIMIT @limit')
        : Promise.resolve({ resources: [] as Listing[] }),
    ]);
    const resources = [...new Map([...listed.resources, ...bumped.resources].map((l) => [l.id, l])).values()];

    const matched = query.search
      ? resources.filter((listing) => matchesSearch(listing, query.search!))
      : resources;

    if (byPopularity) {
      return [...matched].sort((a, b) => popularity(b) - popularity(a)).slice(0, query.limit ?? 100);
    }

    if (!ranked) return matched;
    return [...matched].sort(newestOrder).slice(0, limit);
  }

  async listOrdersForLot(lotId: string): Promise<Order[]> {
    // orders is partitioned by /lotId, so a manifest is a single-partition read.
    const { resources } = await this.container('orders')
      .items.query<Order>(
        { query: 'SELECT * FROM c WHERE c.lotId = @lotId', parameters: [{ name: '@lotId', value: lotId }] },
        { partitionKey: lotId },
      )
      .fetchAll();
    this.snapshots.rememberAll('orders', resources);
    return resources.filter(isPlaced);
  }

  async getListing(id: string): Promise<Listing | null> {
    const { resources } = await this.container('listings')
      .items.query<Listing>({
        query: 'SELECT * FROM c WHERE c.id = @id OFFSET 0 LIMIT 1',
        parameters: [{ name: '@id', value: id }],
      })
      .fetchAll();
    return resources[0] ? this.snapshots.remember('listings', resources[0]) : null;
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
    this.snapshots.rememberAll('orders', resources);
    return resources[0] ?? null;
  }

  async deleteOrder(order: Order): Promise<void> {
    await this.container('orders').item(order.id, order.lotId).delete();
  }

  async updateOrder(order: Order): Promise<Order> {
    order.updatedAt = new Date().toISOString();
    return this.writeChecked('orders', order.lotId, order as Order & { _etag?: string });
  }

  async listOrdersForBuyer(buyerId: string): Promise<Order[]> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.buyerId = @buyerId ORDER BY c.createdAt DESC',
        parameters: [{ name: '@buyerId', value: buyerId }],
      })
      .fetchAll();
    this.snapshots.rememberAll('orders', resources);
    return resources;
  }

  async listOrdersForListing(listingId: string): Promise<Order[]> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.listingId = @listingId ORDER BY c.createdAt ASC',
        parameters: [{ name: '@listingId', value: listingId }],
      })
      .fetchAll();
    this.snapshots.rememberAll('orders', resources);
    return resources.filter(isPlaced);
  }

  /**
   * Write an order, and move what the order changed.
   *
   * Stock and pre-order fill are denormalised onto the listing so the feed can
   * draw a card without counting orders, and that only holds if placing an
   * order maintains them. It did not here - only the in-memory store did - so
   * on the deployed site stock never went down and no pre-order ever filled,
   * which is the difference between a group-buy and a progress bar that is
   * always at zero.
   *
   * The listing update is deliberately not rolled back if it fails: the order
   * exists, the money is the buyer's, and losing the order because a counter
   * could not be written would be the worse half of the trade.
   */
  async createOrder(order: Order): Promise<Order> {
    const { resource } = await this.container('orders').items.create(order);
    const saved = resource ?? order;
    if (isPlaced(order)) await this.takeStock(order).catch(() => false);
    return saved;
  }

  async listCheckoutDrafts(sellerId: string): Promise<Order[]> {
    const { resources } = await this.container('orders')
      .items.query<Order>({
        query: 'SELECT * FROM c WHERE c.sellerId = @sellerId AND IS_NULL(c.placedAt) ORDER BY c.updatedAt DESC',
        parameters: [{ name: '@sellerId', value: sellerId }],
      })
      .fetchAll();
    this.snapshots.rememberAll('orders', resources);
    return resources;
  }

  async listLikesForListings(listingIds: readonly string[]): Promise<Like[]> {
    if (listingIds.length === 0) return [];
    const { resources } = await this.container('likes')
      .items.query<Like>({
        query: 'SELECT * FROM c WHERE ARRAY_CONTAINS(@ids, c.listingId)',
        parameters: [{ name: '@ids', value: [...listingIds] }],
      })
      .fetchAll();
    return resources;
  }

  async takeStock(order: Order): Promise<boolean> {
    const listing = await this.getListing(order.listingId);
    if (!listing) return false;
    const taken = await this.mutateListing(listing.id, listing.sellerId, (current) => {
      // A "multiple" item has no count to run down, so it never sells out.
      const counted = current.quantityMode !== 'multiple';
      if (counted && current.quantityAvailable < order.quantity) return null;
      const quantityAvailable = counted ? current.quantityAvailable - order.quantity : current.quantityAvailable;
      return {
        ...current,
        quantityAvailable,
        status: counted && quantityAvailable === 0 ? 'sold_out' : current.status,
        preOrder: current.preOrder
          ? { ...current.preOrder, filledCount: current.preOrder.filledCount + order.quantity }
          : null,
        soldCount: (current.soldCount ?? 0) + order.quantity,
        updatedAt: new Date().toISOString(),
      };
    });
    return taken !== null;
  }

  /**
   * Changes one listing only if nobody else wrote it in between, and on
   * losing that race reads again and redoes the change against what won -
   * which is what stops two buyers both taking the last one. `change`
   * returns null to refuse, and then nothing is written.
   */
  private async mutateListing(id: string, sellerId: string, change: (listing: Listing) => Listing | null): Promise<Listing | null> {
    const item = this.container('listings').item(id, sellerId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const { resource, etag } = await item.read<Listing>().catch((error: unknown) => {
        if (isNotFound(error)) return { resource: undefined, etag: undefined };
        throw error;
      });
      if (!resource) return null;
      const next = change(resource);
      if (!next) return null;
      try {
        const { resource: saved } = await item.replace<Listing>(next, {
          accessCondition: { type: 'IfMatch', condition: etag ?? '' },
        });
        return saved ?? next;
      } catch (error) {
        if ((error as { code?: number }).code === 412) continue;
        throw error;
      }
    }
    throw new Error('That item is too busy to change right now. Try again.');
  }

  async countView(listing: Listing): Promise<void> {
    // An increment rather than a read and a write: views never conflict, and
    // a count that misses one under load costs nothing.
    await this.container('listings').item(listing.id, listing.sellerId)
      .patch([{ op: 'incr', path: '/viewCount', value: 1 }])
      .catch(() => undefined);
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

  async updateComment(comment: ListingComment): Promise<ListingComment> {
    const { resource } = await this.container('comments').items.upsert(comment);
    return (resource as ListingComment | undefined) ?? comment;
  }

  async toggleLike(userId: string, listingId: string): Promise<boolean> {
    const id = `${userId}__${listingId}`;
    let liked = true;
    try {
      await this.container('likes').item(id, userId).delete();
      liked = false;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (liked) {
      const now = new Date().toISOString();
      await this.container('likes').items.create({ id, userId, listingId, createdAt: now, updatedAt: now } satisfies Like);
    }
    // The count on the listing is what rarity and "N saved" read, so it moves
    // with the save rather than being counted on every feed.
    const listing = await this.getListing(listingId);
    if (listing) {
      await this.container('listings').item(listing.id, listing.sellerId)
        .patch([{ op: 'incr', path: '/likeCount', value: liked ? 1 : -1 }])
        .catch(() => undefined);
    }
    return liked;
  }

  async listLikedListingIds(userId: string): Promise<string[]> {
    const { resources } = await this.container('likes')
      .items.query<Like>({ query: 'SELECT * FROM c' }, { partitionKey: userId })
      .fetchAll();
    return resources.map((like) => like.listingId);
  }

  async listLikesBy(userId: string): Promise<Like[]> {
    const { resources } = await this.container('likes')
      .items.query<Like>({ query: 'SELECT * FROM c' }, { partitionKey: userId })
      .fetchAll();
    return resources;
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
    return resources.map((follow) => follow.sellerId).filter((id) => !isPersonFollow(id));
  }

  async getSiteContent(id: string): Promise<SiteContent | null> {
    try {
      const { resource } = await this.container('siteContent').item(id, id).read<SiteContent>();
      return resource ?? null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async saveSiteContent(content: SiteContent): Promise<SiteContent> {
    const { resource } = await this.container('siteContent').items.upsert<SiteContent>(content);
    return (resource as SiteContent | undefined) ?? content;
  }

  async mutateSiteContent(id: string, change: (current: SiteContent | null) => SiteContent): Promise<SiteContent> {
    // Optimistic, like mutatePost: on losing a race, read again and redo the
    // change against what won, so an appended fee or action is never dropped.
    const item = this.container('siteContent').item(id, id);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const { resource, etag } = await item.read<SiteContent>().catch((error: unknown) => {
        if (isNotFound(error)) return { resource: undefined, etag: undefined };
        throw error;
      });
      const next = change(resource ?? null);
      try {
        const { resource: saved } = resource
          ? await item.replace<SiteContent>(next, { accessCondition: { type: 'IfMatch', condition: etag ?? '' } })
          : await this.container('siteContent').items.create<SiteContent>(next);
        return (saved as SiteContent | undefined) ?? next;
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === 412 || code === 409) continue;
        throw error;
      }
    }
    throw new Error(`${id} is too busy to change right now. Try again.`);
  }

  async deleteSiteContent(id: string): Promise<void> {
    try {
      await this.container('siteContent').item(id, id).delete();
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  async listFollowsBy(followerId: string): Promise<Follow[]> {
    const { resources } = await this.container('follows')
      .items.query<Follow>({ query: 'SELECT * FROM c' }, { partitionKey: followerId })
      .fetchAll();
    return resources;
  }

  async listFollowsOf(sellerId: string): Promise<Follow[]> {
    const { resources } = await this.container('follows')
      .items.query<Follow>({
        query: 'SELECT * FROM c WHERE c.sellerId = @sellerId',
        parameters: [{ name: '@sellerId', value: sellerId }],
      })
      .fetchAll();
    return resources;
  }

  async listFollowerIds(sellerId: string): Promise<string[]> {
    const { resources } = await this.container('follows')
      .items.query<string>({
        query: 'SELECT VALUE c.followerId FROM c WHERE c.sellerId = @sellerId',
        parameters: [{ name: '@sellerId', value: sellerId }],
      })
      .fetchAll();
    return resources;
  }

  private async queryBySeller<T>(name: 'lots', query: CatalogQuery): Promise<T[]> {
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

/**
 * The tail of the catalog query, one complete clause per sort.
 *
 * Whole literals rather than an ORDER BY assembled from a column name and a
 * direction: an ORDER BY over a path excluded from the index is refused at
 * query time rather than merely being slow, and a literal is the only form the
 * static check can read. Every path here is indexed and present on every
 * listing - a document missing the ordered path is dropped from the result set
 * entirely, which would turn a sort into a silent filter.
 */
const CATALOG_ORDER: Record<string, string> = {
  newest: ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
  price_asc: ' ORDER BY c.priceMinor ASC OFFSET 0 LIMIT @limit',
  price_desc: ' ORDER BY c.priceMinor DESC OFFSET 0 LIMIT @limit',
  // Popularity is a sum of two fields, which Cosmos cannot ORDER BY. The newest
  // window is fetched wide and ranked in JavaScript instead; see listListings.
  popular: ' ORDER BY c.createdAt DESC OFFSET 0 LIMIT @limit',
};

/** The clause for one sort, falling back to newest for anything unrecognised. */
function catalogOrder(sort: string | undefined): string {
  return (sort && CATALOG_ORDER[sort]) || CATALOG_ORDER.newest!;
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

/**
 * Something to build a handle from, for a row that may be missing pieces.
 *
 * A partial row is a fact of any database that has been running a while, and a
 * maintenance pass that throws on one leaves every later row unrepaired. The
 * email's local part, then the id, are both worse than a display name and both
 * better than nothing.
 */
function nameFor(user: { displayName?: string; email?: string; id: string }): string {
  return user.displayName?.trim() || user.email?.split('@')[0] || user.id.replace(/^usr_/, '');
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
