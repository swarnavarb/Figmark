import type { User } from '../../../shared/models.js';

/**
 * The parts of an account kept as documents of their own, in `userParts`.
 *
 * These are the lists that only grow: a card per delivered order, a row per
 * share and per open, an id per commission, an endpoint per browser. On the
 * `users` row they pushed it toward Cosmos's 2 MB item limit, and every screen
 * that touched any of them wrote the same document. Each part is now one
 * document in the account's partition with its own etag, so the collection
 * page and the notifications switch never contend, and the row stays small.
 *
 * Callers do not see the split: the Cosmos repository joins the parts onto the
 * user it reads by id and splits them off again on `updateUser`. Lists of users
 * read by query come back without them - those are for names and shops, not
 * for anybody's collection.
 *
 * Rows written before the split carried these fields inline. They are read as
 * they are, and the one-off storage clean-up on start-up saves each such
 * account once, which moves them into their parts.
 */
export const USER_PARTS = {
  collection: ['collection', 'collectionGroups'],
  sharing: ['shareOpens', 'shareLog', 'invitees'],
  affiliate: ['referrals', 'affiliateOrderIds', 'affiliateLinks'],
  push: ['pushEndpoints'],
  devices: ['clientDevices'],
  profit: ['profitTemplates', 'savedCalcs'],
} as const satisfies Record<string, readonly (keyof User)[]>;

export type UserPartName = keyof typeof USER_PARTS;
export const USER_PART_NAMES = Object.keys(USER_PARTS) as UserPartName[];
const PART_FIELDS = new Set<string>(Object.values(USER_PARTS).flat());

/** One part as stored. */
export interface UserPartDoc {
  id: string;
  userId: string;
  part: UserPartName;
  _etag?: string;
  [field: string]: unknown;
}

/** What a part held when the user was read: its etag (null: no document yet) and its fields. */
export interface PartVersion {
  etag: string | null;
  was: string;
}

/** A user as joined: the row plus its parts, and which version of each it was read at. */
export type JoinedUser = User & { _etag?: string; _parts?: Partial<Record<UserPartName, PartVersion>> };

/** Ids carry the account so they are unique across partitions, like likes and follows. */
export const partId = (userId: string, part: UserPartName) => `${userId}__${part}`;

/** The part's fields that are set, in a fixed order so equal parts compare equal. */
export function fieldsOf(source: object, part: UserPartName): Record<string, unknown> {
  const record = source as Record<string, unknown>;
  const fields: Record<string, unknown> = {};
  for (const key of USER_PARTS[part]) if (record[key] !== undefined) fields[key] = record[key];
  return fields;
}

/** Whether a user object says anything about this part at all. */
export const mentions = (user: object, part: UserPartName) => USER_PARTS[part].some((key) => key in user);

/** The `users` row: everything but the parts and the join's bookkeeping. */
export function rowOf<T extends object>(user: T): T {
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(user)) if (!PART_FIELDS.has(key) && key !== '_parts') row[key] = value;
  return row as T;
}

export function partDoc(userId: string, part: UserPartName, fields: Record<string, unknown>, etag?: string | null): UserPartDoc {
  return { id: partId(userId, part), userId, part, ...fields, ...(etag ? { _etag: etag } : {}) };
}

/**
 * The row with its parts laid over it. A part with no document yet keeps
 * whatever the row still carries inline, so an account not yet moved reads
 * exactly as it did.
 */
export function joinUser(row: User, docs: UserPartDoc[]): JoinedUser {
  const user = { ...row } as JoinedUser & Record<string, unknown>;
  const parts: Partial<Record<UserPartName, PartVersion>> = {};
  for (const part of USER_PART_NAMES) {
    const doc = docs.find((entry) => entry.part === part);
    if (doc) {
      for (const key of USER_PARTS[part]) delete user[key];
      Object.assign(user, fieldsOf(doc, part));
    }
    parts[part] = { etag: doc?._etag ?? null, was: JSON.stringify(doc ? fieldsOf(doc, part) : {}) };
  }
  user._parts = parts;
  return user;
}
