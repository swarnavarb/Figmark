import { CosmosClient, type Container, type Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import { CONTAINERS } from '../../../shared/containers.js';
import type { Listing, Lot, Order, User } from '../../../shared/models.js';
import type { CosmosConfig } from '../config.js';
import type { BackendStatus, CatalogQuery, Repository } from './repository.js';
import { sessionDigest } from './repository.js';

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

  async getUserByUsername(username: string): Promise<User | null> {
    // Two point reads via the reservation record, rather than a cross-partition
    // query: the same lookup that makes usernames unique also makes this cheap.
    const key = username.toLowerCase();
    let reservation: UsernameReservation | undefined;
    try {
      const result = await this.container('usernames')
        .item(key, key)
        .read<UsernameReservation>();
      reservation = result.resource;
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    if (!reservation) return null;
    return this.getUserById(reservation.userId);
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

/** A `usernames` document: the id is the lowercased username. */
interface UsernameReservation {
  id: string;
  userId: string;
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 404;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
