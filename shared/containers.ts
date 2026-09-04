/**
 * Cosmos DB physical schema, as data.
 *
 * The provisioning script and the Cosmos repository both read this, so the
 * partition keys used at query time can never drift from the ones the
 * containers were actually created with.
 */

export const DATABASE_NAME = 'figmark';

/**
 * The free tier grants 1000 RU/s. Provisioning it as *shared* database
 * throughput means every container draws from that one pool and we stay inside
 * the free allowance. A shared-throughput database allows up to 25 containers,
 * which is the ceiling on what may be defined below.
 */
export const SHARED_THROUGHPUT_RU = 1000;

export interface ContainerDefinition {
  name: string;
  /** Cosmos partition key path, e.g. `/sellerId`. */
  partitionKeyPath: string;
  /** Why this key: kept next to the definition so the trade-off stays visible. */
  rationale: string;
  /** Properties excluded from indexing to keep RU cost down on writes. */
  excludedPaths?: string[];
  /** Composite indexes required by the queries we know we will run. */
  compositeIndexes?: Array<Array<{ path: string; order: 'ascending' | 'descending' }>>;
  /** Unique constraints scoped to a partition. */
  uniqueKeyPaths?: string[][];
  /** Optional TTL default in seconds; -1 enables TTL without expiring items. */
  defaultTtlSeconds?: number;
}

export const CONTAINERS = {
  users: {
    name: 'users',
    partitionKeyPath: '/id',
    rationale:
      'Point reads by user id dominate. Note the absence of a unique key on the identifier fields: Cosmos enforces unique keys within a logical partition, and with /id as the partition key every user is alone in its own partition, so such a constraint would guarantee nothing. Global uniqueness is enforced by the `identifiers` reservation container instead.',
    compositeIndexes: [
      [
        { path: '/role', order: 'ascending' },
        { path: '/createdAt', order: 'descending' },
      ],
    ],
  },
  identifiers: {
    name: 'identifiers',
    partitionKeyPath: '/id',
    rationale:
      'Reservation records making sign-in identifiers globally unique. The document id is the normalised identifier (lowercased email, or E.164 phone), so a create either succeeds or conflicts (409). One row per identifier means an account with both an email and a phone reserves both, and sign-in by either is a point read rather than a cross-partition query.',
  },
  listings: {
    name: 'listings',
    partitionKeyPath: '/sellerId',
    rationale:
      'Storefront pages and seller dashboards read one seller at a time. The unified catalog is a cross-partition query, which is the accepted cost of keeping storefronts single-partition.',
    excludedPaths: ['/description/?', '/photos/*'],
    compositeIndexes: [
      [
        { path: '/status', order: 'ascending' },
        { path: '/createdAt', order: 'descending' },
      ],
      [
        { path: '/category', order: 'ascending' },
        { path: '/priceMinor', order: 'ascending' },
      ],
    ],
  },
  lots: {
    name: 'lots',
    partitionKeyPath: '/sellerId',
    rationale: 'Lots are always listed and managed in the context of their seller.',
    excludedPaths: ['/description/?', '/stageHistory/*'],
    compositeIndexes: [
      [
        { path: '/status', order: 'ascending' },
        { path: '/cutoffAt', order: 'ascending' },
      ],
    ],
  },
  orders: {
    name: 'orders',
    partitionKeyPath: '/lotId',
    rationale:
      'Generating a lot manifest is the hot path and becomes a single-partition read. Buyer order history is cross-partition; revisit with a materialised view if it gets hot.',
    compositeIndexes: [
      [
        { path: '/buyerId', order: 'ascending' },
        { path: '/createdAt', order: 'descending' },
      ],
      [
        { path: '/sellerId', order: 'ascending' },
        { path: '/status', order: 'ascending' },
      ],
    ],
  },
  reviews: {
    name: 'reviews',
    partitionKeyPath: '/subjectId',
    rationale:
      'Reviews are read as "everything written about this user", which is exactly one partition.',
    uniqueKeyPaths: [['/orderId', '/direction']],
    compositeIndexes: [
      [
        { path: '/revealed', order: 'ascending' },
        { path: '/createdAt', order: 'descending' },
      ],
    ],
  },
  comments: {
    name: 'comments',
    partitionKeyPath: '/listingId',
    rationale: 'A listing page renders every comment on that listing, which is exactly one partition.',
  },
  likes: {
    name: 'likes',
    partitionKeyPath: '/userId',
    rationale:
      "Partitioned by the liker so \"my bookmarks\" is a single-partition read. Per-listing counts live denormalised on the listing itself rather than being counted here.",
    uniqueKeyPaths: [['/listingId']],
  },
  follows: {
    name: 'follows',
    partitionKeyPath: '/followerId',
    rationale:
      'The personalised feed asks "who does this user follow?", which is one partition. Follower counts are denormalised onto the seller profile.',
    uniqueKeyPaths: [['/sellerId']],
  },
  disputes: {
    name: 'disputes',
    partitionKeyPath: '/orderId',
    rationale: 'A dispute belongs to exactly one order and is always fetched with it.',
    excludedPaths: ['/evidence/*'],
  },
  sessions: {
    name: 'sessions',
    partitionKeyPath: '/id',
    rationale:
      'Mock-auth session revocation list. Tokens are self-describing and stateless; this container only records explicit logouts, so it stays tiny and expires itself.',
    defaultTtlSeconds: -1,
  },
} as const satisfies Record<string, ContainerDefinition>;

export type ContainerName = keyof typeof CONTAINERS;

export const CONTAINER_LIST: ContainerDefinition[] = Object.values(CONTAINERS);

/** Blob container holding listing and condition photos. */
export const PHOTO_CONTAINER_NAME = 'listing-photos';
/** Blob container holding dispute evidence. Never publicly readable. */
export const EVIDENCE_CONTAINER_NAME = 'dispute-evidence';
