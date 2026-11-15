import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { STORE_KIND_LABELS } from '@shared/service-stores';
import { api, type MyServicesView } from '../api';
import { useSession } from '../session';
import { Icon, type IconName } from './ui';
import '../styles/WorkSwitcher.css';

/**
 * Every job one account does, behind the Sell tab.
 *
 * Your own shop, the shops you help run, the forwarding and art stores you
 * own or are on the team of, the lots you supply or hand out, and the
 * Community Service desk: each is a workspace, and one dropdown at the top of
 * whichever you are in switches to another. Services keeps only the people
 * you can hire.
 *
 * The workspace you are in is read from the address, never held here: a
 * notification that opens a forwarder's parcels lands in the forwarder's
 * workspace whatever was picked last. The last one is remembered only so the
 * Sell tab can take you back to it.
 */

export interface WorkRole {
  key: string;
  label: string;
  sub: string;
  icon: IconName;
  /** The colour the workspace wears in the list: the tab hue of its kind. */
  tone: 'aqua' | 'blue' | 'pink' | 'lime' | 'gold' | 'violet';
  to: string;
  /** Things waiting on you there. */
  waiting: number;
}

const LAST_KEY = 'figmark.work.last';

/** Where the Sell tab goes: the workspace this device was last in, else your shop. */
export function workHome(): string {
  try {
    const last = window.localStorage.getItem(LAST_KEY);
    return last && last.startsWith('/') ? last : '/shop';
  } catch {
    return '/shop';
  }
}

function remember(path: string) {
  try {
    window.localStorage.setItem(LAST_KEY, path);
  } catch {
    /* Private window: the tab falls back to the shop. */
  }
}

interface WorkData {
  services: MyServicesView | null;
  shops: StoreAccess[];
}

/* One read shared by every workspace that draws the switcher, so moving
   between them does not wait on the network each time; kept for half a minute,
   so a store approved or a lot named meanwhile turns up soon after. */
let cache: { userId: string; at: number; data: Promise<WorkData> } | null = null;
const FRESH_MS = 30_000;

function load(userId: string): Promise<WorkData> {
  if (cache?.userId === userId && Date.now() - cache.at < FRESH_MS) return cache.data;
  const data = Promise.all([
    api.myServices().catch(() => null),
    api.stores().then((result) => result.stores).catch(() => [] as StoreAccess[]),
  ]).then(([services, shops]) => ({ services, shops }));
  cache = { userId, at: Date.now(), data };
  return data;
}

/** The workspaces this person has, in the order the list shows them. */
export function rolesOf({ services, shops }: WorkData): WorkRole[] {
  const roles: WorkRole[] = [];
  const own = shops.find((shop) => shop.isOwner);
  if (own) {
    roles.push({ key: 'shop', label: own.name, sub: 'Your shop', icon: 'tag', tone: 'aqua', to: '/shop', waiting: 0 });
  }
  for (const shop of shops) {
    // Packing a shop's lots is supplier work, listed under Supplier: a shop is
    // "run" by somebody with a console right in it.
    if (shop.isOwner || !shop.permissions.some((right) => right !== 'export')) continue;
    roles.push({
      key: `manage:${shop.ownerId}`, label: shop.name, sub: 'Shop you help run', icon: 'tag', tone: 'violet',
      to: `/services/manage/${encodeURIComponent(shop.ownerId)}`, waiting: 0,
    });
  }
  for (const store of services?.stores ?? []) {
    const forwarder = store.kind === 'forwarder';
    const pending = store.status !== 'approved';
    roles.push({
      key: `${store.kind}:${store.ownerId}`,
      label: store.name,
      sub: `${forwarder ? 'Freight forwarder' : STORE_KIND_LABELS[store.kind].store}${store.isOwner ? '' : ' · Team'}${pending ? ' · In review' : ''}`,
      icon: forwarder ? 'plane' : 'spark',
      tone: forwarder ? 'blue' : 'pink',
      to: `/services/store/${store.kind}/${store.ownerId}`,
      waiting: store.waiting,
    });
  }
  const crew = services?.crew ?? [];
  const supplying = crew.filter((row) => row.role === 'supplier');
  if (supplying.length > 0) {
    roles.push({
      key: 'supplier', label: 'Supplier', sub: `${supplying.length} ${supplying.length === 1 ? 'lot' : 'lots'} to pack`,
      icon: 'box', tone: 'gold', to: '/services/mine/supplier',
      waiting: supplying.filter((row) => row.toPress > 0).length,
    });
  }
  const handling = crew.filter((row) => row.role === 'handler');
  if (handling.length > 0 || services?.handler) {
    roles.push({
      key: 'handler', label: 'Domestic handler',
      sub: handling.length ? `${handling.length} ${handling.length === 1 ? 'lot' : 'lots'} to hand out` : 'Parcels to customers',
      icon: 'truck', tone: 'lime', to: '/services/mine/handler',
      waiting: handling.filter((row) => row.toPress > 0).length,
    });
  }
  if (services?.communityManager) {
    roles.push({
      key: 'community', label: 'Community Service', sub: 'Community manager desk',
      icon: 'users', tone: 'gold', to: '/community-service', waiting: 0,
    });
  }
  return roles;
}

/** Which workspace an address belongs to, or null for one this account does not have. */
export function roleAt(roles: WorkRole[], pathname: string, search: string): WorkRole | null {
  const by = (key: string) => roles.find((role) => role.key === key) ?? null;
  const manage = pathname.match(/^\/services\/manage\/([^/]+)/);
  if (manage) return by(`manage:${decodeURIComponent(manage[1]!)}`);
  const store = pathname.match(/^\/services\/store\/(forwarder|artist)\/([^/]+)/);
  if (store) return by(`${store[1]}:${decodeURIComponent(store[2]!)}`);
  if (pathname.startsWith('/services/mine/supplier')) return by('supplier');
  if (pathname.startsWith('/services/mine/handler')) return by('handler');
  if (pathname.startsWith('/services/crew/')) {
    return by(new URLSearchParams(search).get('role') === 'handler' ? 'handler' : 'supplier');
  }
  if (pathname.startsWith('/community-service')) return by('community');
  if (/^\/(shop|sell|lots?|lot\/|routes)/.test(pathname)) return by('shop');
  return null;
}

/**
 * The dropdown at the top of a workspace.
 *
 * Drawn only when there is somewhere else to go: somebody who just has a shop
 * sees their shop exactly as before.
 */
export function WorkSwitcher({ title, fallback = null, className }: {
  title?: string;
  /** Drawn instead while the roles load, or when there is nowhere else to go: the page's own title, say. */
  fallback?: ReactNode;
  className?: string;
} = {}) {
  const { user } = useSession();
  const { pathname, search } = useLocation();
  const [roles, setRoles] = useState<WorkRole[] | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void load(userId).then((data) => { if (live) setRoles(rolesOf(data)); });
    return () => { live = false; };
  }, [userId]);

  const current = roles ? roleAt(roles, pathname, search) : null;
  useEffect(() => {
    if (current) remember(current.to);
  }, [current]);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  if (!roles) return <>{fallback}</>;
  const others = roles.filter((role) => role !== current);
  if (others.length === 0) return <>{fallback}</>;
  const elsewhere = others.reduce((sum, role) => sum + role.waiting, 0);

  return (
    <div className={`wsw${className ? ` ${className}` : ''}`} ref={box}>
      <button type="button" className={`wsw__btn wsw--${current?.tone ?? 'aqua'}`} aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen((now) => !now)}>
        <span className="wsw__icon" aria-hidden="true"><Icon name={current?.icon ?? 'tag'} size={16} /></span>
        <span className="wsw__text">
          <span className="wsw__kicker">{current ? current.sub : 'Your work'}</span>
          <span className="wsw__name">{current ? current.label : (title ?? 'Switch workspace')}</span>
        </span>
        {elsewhere > 0 && <span className="wsw__ping" aria-label={`${elsewhere} waiting in your other workspaces`}>{elsewhere}</span>}
        <Icon name="down" size={16} className="wsw__chev" />
      </button>
      {open && (
        <div className="wsw__menu" role="menu" aria-label="Switch workspace">
          {roles.map((role) => {
            const on = role === current;
            return (
              <Link key={role.key} role="menuitemradio" aria-checked={on} to={role.to}
                className={`wsw__item wsw--${role.tone}${on ? ' is-on' : ''}`}
                onClick={() => { remember(role.to); setOpen(false); }}>
                <span className="wsw__icon" aria-hidden="true"><Icon name={role.icon} size={16} /></span>
                <span className="wsw__text">
                  <span className="wsw__name">{role.label}</span>
                  <span className="wsw__kicker">{role.sub}</span>
                </span>
                {role.waiting > 0 && <span className="wsw__count">{role.waiting}</span>}
                {on && <Icon name="check" size={16} className="wsw__tick" />}
              </Link>
            );
          })}
          <div className="wsw__foot">
            <Link role="menuitem" to="/services/mine" className="wsw__more" onClick={() => setOpen(false)}>
              <Icon name="users" size={14} /> All my work
            </Link>
            <Link role="menuitem" to="/open" className="wsw__more" onClick={() => setOpen(false)}>
              <Icon name="plus" size={14} /> Open a business
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
