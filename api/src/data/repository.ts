import { createHash } from 'node:crypto';
import type { BackendKind, DemoAccount } from '../../../shared/contracts.js';
import type { Listing, Lot, Order, User } from '../../../shared/models.js';

export interface BackendStatus {
  connected: boolean;
  database: string | null;
  /** Human-readable explanation, surfaced on the status page. */
  detail: string;
}

export interface CatalogQuery {
  sellerId?: string;
  limit?: number;
}

/**
 * Persistence seam.
 *
 * Two implementations exist: Cosmos DB, and an in-process store used when
 * Cosmos is not configured. Handlers depend on this interface so the app is
 * runnable and demonstrable with no cloud resources attached.
 */
export interface Repository {
  readonly backend: BackendKind;

  /** Establish connections and verify reachability. Never throws; sets status. */
  init(): Promise<void>;

  status(): BackendStatus;

  getUserById(id: string): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;

  /** Sign-in hints for the mock provider; empty once real auth is in use. */
  listDemoAccounts(): DemoAccount[];

  revokeSession(token: string, expiresAt: Date): Promise<void>;
  isSessionRevoked(token: string): Promise<boolean>;

  listLots(query?: CatalogQuery): Promise<Lot[]>;
  getLot(sellerId: string, lotId: string): Promise<Lot | null>;
  listListings(query?: CatalogQuery): Promise<Listing[]>;

  /** The lot manifest: every order line in one lot. */
  listOrdersForLot(lotId: string): Promise<Order[]>;
}

/**
 * Session tokens are stored as digests, never verbatim - a revocation list is
 * not a reason to keep live credentials at rest.
 */
export function sessionDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
