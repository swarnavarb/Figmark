import type { StorePermission } from './enums.js';
import type { SellerProfile, StoreManager, User } from './models.js';

/**
 * Who may do what in a store.
 *
 * Shared by the API and the app so the client never reimplements the rule it is
 * about to be judged by: a button that appears when the server would refuse the
 * request behind it is worse than no button.
 *
 * The API is still the one that decides - every one of these is checked again
 * server-side. This is what stops the two answers being written twice.
 */

/** A store, as anyone acting in it needs to see it. */
export interface StoreAccess {
  /** The account that owns the store; also the partition every item sits in. */
  ownerId: string;
  name: string;
  /** True when the viewer owns it rather than being granted rights in it. */
  isOwner: boolean;
  /** What the viewer may do, with ownership and `admin` already expanded. */
  permissions: StorePermission[];
}

/**
 * Ownership is total and `admin` implies the rest.
 *
 * Expanding here rather than at each call site means a check can be a simple
 * `includes` everywhere, and there is one place where "admin covers everything"
 * is written down.
 */
export function expandPermissions(granted: readonly StorePermission[]): StorePermission[] {
  if (granted.includes('admin')) return ['listings', 'lots', 'posts', 'analytics', 'admin'];
  return [...granted];
}

/** The rights this viewer holds in this store, empty when they hold none. */
export function permissionsFor(
  owner: Pick<User, 'id'> & { sellerProfile: SellerProfile | null },
  viewerId: string,
): StorePermission[] {
  if (!owner.sellerProfile) return [];
  if (owner.id === viewerId) return expandPermissions(['admin']);

  const manager = (owner.sellerProfile.managers ?? []).find((entry) => entry.userId === viewerId);
  return manager ? expandPermissions(manager.permissions) : [];
}

export function can(
  owner: Pick<User, 'id'> & { sellerProfile: SellerProfile | null },
  viewerId: string,
  permission: StorePermission,
): boolean {
  return permissionsFor(owner, viewerId).includes(permission);
}

/** The store as the viewer sees it, or null when they may not act in it at all. */
export function accessFor(
  owner: Pick<User, 'id' | 'displayName'> & { sellerProfile: SellerProfile | null },
  viewerId: string,
): StoreAccess | null {
  const permissions = permissionsFor(owner, viewerId);
  if (permissions.length === 0) return null;
  return {
    ownerId: owner.id,
    name: owner.sellerProfile?.storefrontName ?? owner.displayName,
    isOwner: owner.id === viewerId,
    permissions,
  };
}

/** A manager record, with the permissions normalised on the way in. */
export function managerEntry(
  userId: string,
  displayName: string,
  permissions: readonly StorePermission[],
  addedBy: string,
): StoreManager {
  return {
    userId,
    displayName,
    // Stored as granted rather than expanded: what the owner picked is what the
    // member list should show back to them.
    permissions: [...new Set(permissions)],
    addedAt: new Date().toISOString(),
    addedBy,
  };
}
