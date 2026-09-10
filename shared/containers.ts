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
  storeReviews: {
    name: 'storeReviews',
    partitionKeyPath: '/subjectId',
    rationale:
      'Opinions left on somebody\'s page, read as "everything said about this account", which is exactly one partition. Separate from `reviews` because these are not earned by a transaction and must never be averaged in with the ones that are - and because the unique key differs: one per author here, one per order there.',
    uniqueKeyPaths: [['/authorId']],
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
  posts: {
    name: 'posts',
    partitionKeyPath: '/channelId',
    rationale:
      "A channel thread and a forum are each exactly one partition, which is how both are read. The cross-partition query is the 'everyone I follow' feed, which is bounded by how many sellers a person follows and is the accepted cost of keeping the two thread views single-partition.",
    excludedPaths: ['/body/?'],
    compositeIndexes: [
      [
        { path: '/channel', order: 'ascending' },
        { path: '/createdAt', order: 'descending' },
      ],
    ],
  },
  forums: {
    name: 'forums',
    partitionKeyPath: '/id',
    rationale:
      'A handful of rooms read as a list and opened one at a time. Partitioned by id because there is no other axis: a forum belongs to nobody.',
  },
  messages: {
    name: 'messages',
    partitionKeyPath: '/threadId',
    rationale:
      'A conversation is one partition, and the thread id is derived from the two handles rather than allocated, so either side addresses the same partition without a handshake. The inbox is a cross-partition query over the handles a person speaks as, which is a small set.',
    excludedPaths: ['/body/?'],
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

/**
 * A container definition as the Cosmos SDK wants it.
 *
 * Shared by the provisioning script and the API, because a container the code
 * knows how to query is a container the code should be able to create: the two
 * had drifted once already, and the symptom was a screen that answered every
 * request with a 500 until somebody remembered to re-provision by hand.
 */
export function containerBody(definition: ContainerDefinition): Record<string, unknown> {
  const body: Record<string, unknown> = {
    id: definition.name,
    partitionKey: { paths: [definition.partitionKeyPath] },
    indexingPolicy: {
      indexingMode: 'consistent',
      automatic: true,
      includedPaths: [{ path: '/*' }],
      excludedPaths: [
        { path: '/"_etag"/?' },
        ...(definition.excludedPaths ?? []).map((path) => ({ path })),
      ],
      ...(definition.compositeIndexes ? { compositeIndexes: definition.compositeIndexes } : {}),
    },
  };
  if (definition.uniqueKeyPaths) {
    body.uniqueKeyPolicy = { uniqueKeys: definition.uniqueKeyPaths.map((paths) => ({ paths })) };
  }
  if (definition.defaultTtlSeconds !== undefined) body.defaultTtl = definition.defaultTtlSeconds;
  return body;
}
