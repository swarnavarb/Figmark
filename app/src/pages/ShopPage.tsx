import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CHECKPOINT_COUNT_LABELS, LOT_CARD_LABELS, LOT_STAGES, LOT_STAGE_LABELS,
  STORE_PERMISSIONS, STORE_PERMISSION_LABELS,
  type StorePermission,
} from '@shared/enums';
import { countOf, type LotTally } from '@shared/board';
import { CATEGORIES } from '@shared/catalog';
import { CONDITION_TAGS, type Sourcing } from '@shared/enums';
import { preLotRouteOf, type PostTemplate } from '@shared/templates';
import { Ladder } from '../components/Ladder';
import { RouteEditor, RoutesList } from './RoutesPage';
import {
  PHASE_LABELS, SEGMENTS, SEGMENT_LABELS, phaseOfCounts,
} from '@shared/insights';
import { BUILT_IN_ROUTE, currentStepName, preSteps as preStepsOf, routeOf, suggestLotName } from '@shared/routes';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import type { SellerPaymentDetails, SellerProfile, StoreManager } from '@shared/models';
import type { StoreAccess } from '@shared/stores';
import { supplierIdOf } from '@shared/services';
import {
  ApiRequestError,
  api,
  type DashboardResponse,
  type InsightsResponse,
  type PartyRef,
  type StorefrontDraft,
  type ActivityResponse,
  type LotBoard,
  type LotSummary,
  type LotsResponse,
  type SaleRow,
  type SalesResponse,
  type ProviderCard,
  type RoutesResponse,
} from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, Modal, Thumb, Tile, leadPhoto } from '../components/ui';
import { PowerSalePanel } from '../components/PowerSale';
import { PackingList } from './SupplierPage';
import { LotDetail, NewLotForm } from './LotsPage';
import { formatDate, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

type Section = 'items' | 'payments' | 'lots' | 'routes' | 'packing' | 'analytics' | 'storefront' | 'people';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'items', label: 'Items' },
  // Payments was too narrow a name for what this screen does: money is one of
  // six things an order needs answering about, and the other five had nowhere
  // to live. The id stays `payments` - it is the identity, and renaming it
  // would only be a way to break the rights that reference it.
  { id: 'payments', label: 'Orders' },
  { id: 'lots', label: 'Track' },
  { id: 'routes', label: 'Routes' },
  { id: 'packing', label: 'Packing' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'storefront', label: 'Storefront' },
  { id: 'people', label: 'People' },
];

/**
 * Which sections belong to the same Sell-home card, so the chip bar under a
 * card only ever shows the handful of screens that card promised - not all
 * eight at once.
 */
const SECTION_GROUPS: Record<string, Section[]> = {
  items: ['items', 'payments'],
  manage: ['storefront', 'people', 'packing'],
  lots: ['lots'],
  routes: ['routes'],
  analytics: ['analytics'],
};

function groupOf(section: Section): string {
  return Object.entries(SECTION_GROUPS).find(([, ids]) => ids.includes(section))?.[0] ?? 'items';
}

/**
 * The sell tab, which is two different screens depending on where you are.
 *
 * Before a store exists there is exactly one thing to offer: open one. Items
 * are listed from a shop and only from a shop, so a "list an item" door here
 * would lead to a refusal one screen later. Once a shop exists the tab becomes
 * its console.
 */
export function ShopPage() {
  const [stores, setStores] = useState<StoreAccess[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  /** The one question after the shop exists: how does your stock travel? */
  const [routing, setRouting] = useState(false);

  const load = useCallback(async () => {
    try {
      setStores((await api.stores()).stores);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your shop.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!stores) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  if (stores.length === 0 && !opening && !routing) {
    return <ShopStart onOpen={() => setOpening(true)} />;
  }
  /*
   * Opened, and now asked the one question a shop cannot answer later without
   * having already got it wrong: how does your stock actually travel?
   *
   * Here rather than buried in a settings screen, because the route is what
   * every buyer of this shop will read for six weeks, and a shop that never
   * finds the screen ships everybody the built-in seven words. Skippable,
   * because a shop that does not know yet should not be held at the door.
   */
  if (routing) {
    return (
      <main className="page tab-view">
        <RouteEditor
          editing={null}
          intro={<RouteIntro />}
          cancelLabel="Skip for now"
          onSaved={() => { setRouting(false); void load(); }}
          onCancel={() => { setRouting(false); void load(); }}
        />
      </main>
    );
  }

  if (stores.length === 0) {
    return (
      <main className="page tab-view">
        <button type="button" className="btn btn--quiet" style={{ justifySelf: 'start', marginBottom: 12 }}
          onClick={() => setOpening(false)}>
          <Icon name="back" size={14} /> Back
        </button>
        <div className="page__head">
          <div>
            <h1>Open your storefront</h1>
            <p className="muted">
              A name, a handle and a line about what you sell. Everything here can change later.
            </p>
          </div>
        </div>
        {/* Saving is what makes the account a shop. Then one more question,
            before the console, about how the stock travels. */}
        <StorefrontEditor onSaved={() => { setOpening(false); setRouting(true); }} />
      </main>
    );
  }

  return <ShopConsole stores={stores} onChanged={load} />;
}

/**
 * What a route is, for somebody meeting one for the first time.
 *
 * Said in the words of the thing it produces rather than in the words of the
 * feature: a seller does not want "a configurable fulfilment pipeline", they
 * want their buyers to stop asking where it is.
 */
function RouteIntro() {
  return (
    <div className="stack" style={{ marginBottom: 18 }}>
      <div className="page__head"><div>
        <h1>How does your stock travel?</h1>
        <p className="muted">
          A route is the list of steps your buyers read as their tracking — in your words, not
          ours. Write it once and every shipment you open uses it.
        </p>
      </div></div>
      <div className="notice notice--info">
        <strong>Why it is worth a minute.</strong> Buyers ask "where is it?" because nothing
        told them. A route answers before they ask: they see the same steps you work, ticked as
        you tick them, from the day they order to the day it lands. You can change it whenever
        the way you ship changes.
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        Start from a shape close to yours — everything in it is editable — or skip and do it
        later from Track → Routes.
      </p>
    </div>
  );
}

/**
 * The sell tab before there is a shop.
 *
 * One door. Everything sold here is sold from a storefront, so the shop is not
 * an upgrade you take later — it is the first step, and the screen says so
 * rather than offering a shortcut that ends in an error.
 */
function ShopStart({ onOpen }: { onOpen: () => void }) {
  const { user } = useSession();
  return (
    <main className="page tab-view">
      <div className="gate">
        <span className="gate__mark" aria-hidden="true">{<Icon name="bank" size={19} />}</span>
        <h1 className="gate__title">Open your storefront</h1>
        <p className="gate__note">
          Everything on Figmark is sold from a shop — a name buyers follow, a handle they can find
          you at, and a channel to sell in. It takes about a minute, and you can change all of it
          afterwards.
        </p>
        <button type="button" className="btn btn--lg gate__go" onClick={onOpen}>
          Open your storefront
        </button>
      </div>

      {/* Somebody may hold money for other people's trades without selling a
          thing themselves. Hiding this would strand them in a tab with one
          door they do not want - it is a different role, not a second option
          for a new seller. */}
      {user?.escrowRights && (
        <Link to="/escrow" className="btn btn--quiet" style={{ justifySelf: 'center', marginTop: 18 }}>
          {<Icon name="lock" size={13} />} Open the escrow console instead
        </Link>
      )}
    </main>
  );
}

/**
 * The sell tab once a shop exists.
 *
 * Sections rather than pages, because running a shop is one sitting: file an
 * item, check what is moving, look at the numbers. The store switcher only
 * appears for someone who acts in more than one.
 */
function ShopConsole({ stores, onChanged }: { stores: StoreAccess[]; onChanged: () => void | Promise<void> }) {
  const { user } = useSession();
  const [storeId, setStoreId] = useState(stores[0]!.ownerId);
  /*
   * The open section lives in the URL, not in this component.
   *
   * Because leaving the console and coming back is normal - Routes, a lot, an
   * order - and a tab held in state puts you back on Items every time, which
   * reads as the app having forgotten what you were doing.
   */
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const setSection = (next: Section) =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      copy.set('tab', next);
      return copy;
    }, { replace: true });

  const store = stores.find((entry) => entry.ownerId === storeId) ?? stores[0]!;
  // A section nobody may open should not be offered: a tab that answers 403 is
  // worse than a tab that is not there.
  const visible = SECTIONS.filter((entry) => {
    if (entry.id === 'items') return store.permissions.includes('listings');
    // Answering for money is an owner's call, so it rides on the same right
    // the API checks rather than on a wider one.
    if (entry.id === 'payments') return store.permissions.includes('admin');
    if (entry.id === 'analytics') return store.permissions.includes('analytics');
    if (entry.id === 'lots' || entry.id === 'routes') return store.permissions.includes('lots');
    if (entry.id === 'packing') return store.permissions.includes('export');
    if (entry.id === 'storefront' || entry.id === 'people') return store.permissions.includes('admin');
    return true;
  });
  // No tab, or a tab this store cannot open: nothing renders below the
  // workflow buttons.
  const active = visible.find((entry) => entry.id === requested)?.id ?? null;
  const chips = active ? visible.filter((entry) => SECTION_GROUPS[groupOf(active)]!.includes(entry.id)) : [];

  return (
    <main className="page tab-view">
      {/* No "list an item" here: the Items section opens with that door, and
          no shop-name header here either - the workflow below already says
          where you are. */}
      {user?.escrowRights && (
        <Link to="/escrow" className="btn btn--ghost btn--sm" style={{ justifySelf: 'end', marginBottom: 10 }}>
          {<Icon name="lock" size={13} />} Escrow
        </Link>
      )}

      <SellHome active={active} onGo={setSection} />

      {stores.length > 1 && (
        <label className="field" style={{ marginBlock: 14 }}>
          <span>Store</span>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            {stores.map((entry) => (
              <option key={entry.ownerId} value={entry.ownerId}>
                {entry.name}{entry.isOwner ? '' : ' — you help run this'}
              </option>
            ))}
          </select>
        </label>
      )}

      {active && chips.length > 1 && (
        <div className="sections" role="tablist" aria-label="Shop sections" style={{ marginTop: 18 }}>
          {chips.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active === entry.id}
              className={`chip${active === entry.id ? ' is-on' : ''}`}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
      )}

      {/* Keyed so switching sections replays the entrance rather than swapping
          content underneath a static frame. The Sell page itself never
          changes - the workflow above stays put and only this area swaps. */}
      {active && (
        <div className="tab-view" style={{ marginTop: chips.length > 1 ? 14 : 20 }} key={`${store.ownerId}:${active}`}>
          {active === 'items' && <MyItems store={store} />}
          {active === 'payments' && <Orders store={store} />}
          {active === 'lots' && <Lots store={store} />}
          {active === 'routes' && <RoutesList />}
          {active === 'packing' && <PackingList storeId={store.ownerId} />}
          {active === 'analytics' && <Analytics store={store} />}
          {active === 'storefront' && <StorefrontEditor />}
          {active === 'people' && <People store={store} onChanged={onChanged} />}
        </div>
      )}
    </main>
  );
}

/**
 * The Sell tab's front door: five cards, always on screen.
 *
 * Two primary actions up top - the business, not the stock - then the
 * workflow every import actually follows, drawn as the three things it is:
 * items become part of a lot, and a lot follows a route. All five stay in
 * place; picking one only changes what appears in the area below them, so
 * the Sell page itself is never left.
 */
function SellHome({ active, onGo }: { active: Section | null; onGo: (section: Section) => void }) {
  const on = (section: Section) => (active ? groupOf(active) === groupOf(section) : false);
  return (
    <div className="stack">
      <div className="doors doors--two">
        <button type="button" className={`door door--card door--analytics${on('analytics') ? ' is-on' : ''}`}
          onClick={() => onGo('analytics')}>
          <span className="door__glyph" aria-hidden="true"><Icon name="spark" size={22} /></span>
          <span className="door__title">Analytics</span>
          <span className="door__note">Sales, views and trends for your shop.</span>
        </button>
        <button type="button" className={`door door--card door--manage${on('storefront') ? ' is-on' : ''}`}
          onClick={() => onGo('storefront')}>
          <span className="door__glyph" aria-hidden="true"><Icon name="bank" size={22} /></span>
          <span className="door__title">Manage Store</span>
          <span className="door__note">Your storefront, your team, and packing.</span>
        </button>
      </div>

      <div className="workflow">
        <span className="workflow__label">Workflow</span>
        <div className="workflow__row">
          <button type="button" className={`workflow__step workflow__step--items${on('items') ? ' is-on' : ''}`}
            onClick={() => onGo('items')}>
            <span className="workflow__glyph" aria-hidden="true"><Icon name="tag" size={20} /></span>
            <span className="workflow__title">Items</span>
          </button>
          <span className="workflow__arrow" aria-hidden="true"><Icon name="right" size={16} /></span>
          <button type="button" className={`workflow__step workflow__step--lots${on('lots') ? ' is-on' : ''}`}
            onClick={() => onGo('lots')}>
            <span className="workflow__glyph" aria-hidden="true"><Icon name="box" size={20} /></span>
            <span className="workflow__title">Lots</span>
          </button>
          <span className="workflow__arrow" aria-hidden="true"><Icon name="right" size={16} /></span>
          <button type="button" className={`workflow__step workflow__step--routes${on('routes') ? ' is-on' : ''}`}
            onClick={() => onGo('routes')}>
            <span className="workflow__glyph" aria-hidden="true"><Icon name="truck" size={20} /></span>
            <span className="workflow__title">Routes</span>
          </button>
        </div>
        <p className="faint workflow__hint">
          Items are added → items become part of a lot → lots follow a route.
        </p>
      </div>
    </div>
  );
}

/* ── Storefront ─────────────────────────────────────────────────────────── */

/**
 * Design the storefront.
 *
 * A name, a picture, what you sell, and one link. The single link is the point:
 * a row of them is a link farm, one is a front door.
 */
function StorefrontEditor({ onSaved }: { onSaved?: () => void } = {}) {
  const { user } = useSession();
  const [draft, setDraft] = useState<StorefrontDraft | null>(null);
  const [saved, setSaved] = useState<SellerProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .storefront()
      .then((result) => {
        setSaved(result.storefront);
        setDraft({
          storefrontName: result.storefront?.storefrontName ?? result.displayName,
          username: result.storefront?.username ?? suggestUsername(result.displayName),
          bio: result.storefront?.bio ?? '',
          dispatchRegion: result.storefront?.dispatchRegion ?? '',
          photoUrl: result.storefront?.photoUrl ?? '',
          link: result.storefront?.link ?? '',
          payment: result.storefront?.payment ?? null,
          coverUrl: result.storefront?.coverUrl ?? '',
          tags: result.storefront?.tags ?? [],
        });
      })
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your storefront.'),
      );
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!draft) return <p className="muted">Loading…</p>;

  const set = <K extends keyof StorefrontDraft>(key: K, value: StorefrontDraft[K]) =>
    setDraft({ ...draft, [key]: value });

  /** One payment field at a time, without losing the others already typed. */
  const setPayment = (key: keyof SellerPaymentDetails, value: string) =>
    setDraft({ ...draft, payment: { ...(draft.payment ?? {}), [key]: value } });

  // The same rules the server enforces, so a bad handle is caught while it is
  // being typed rather than on save.
  const handleProblem = checkUsername(draft.username ?? '');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const result = await api.saveStorefront(draft!);
      setSaved(result.storefront);
      setFlash('Storefront saved.');
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save your storefront.');
    } finally {
      setBusy(false);
    }
  }

  const name = draft.storefrontName?.trim() || user?.displayName || 'Your storefront';

  return (
    <div className="detail">
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Storefront name</span>
          <input value={draft.storefrontName ?? ''} onChange={(e) => set('storefrontName', e.target.value)}
            placeholder="Kaiju Imports" required />
          <span className="field__hint">What buyers see instead of your own name.</span>
        </label>

        {/* The shop's own address, not the owner's: a shop is followed,
            linked to and messaged as itself, and the person behind it keeps a
            separate handle of their own. */}
        <label className="field">
          <span>Shop username</span>
          <input value={draft.username ?? ''} onChange={(e) => set('username', e.target.value.toLowerCase())}
            placeholder="kaiju_imports" autoCapitalize="off" autoCorrect="off" spellCheck={false} required />
          <span className="field__hint">
            {handleProblem
              ? USERNAME_PROBLEMS[handleProblem]
              : (
                <>
                  Your shop lives at <code>/{draft.username}</code> and is messaged at <code>@{draft.username}</code>.
                  This is the shop's, not yours —{' '}
                  {user?.username
                    ? <>you are <code>@{user.username}</code>.</>
                    : <Link to="/me?tab=settings">pick your own username</Link>}
                </>
              )}
          </span>
        </label>

        <label className="field">
          <span>Photo</span>
          <input value={draft.photoUrl ?? ''} onChange={(e) => set('photoUrl', e.target.value)}
            placeholder="https://…" inputMode="url" />
          <span className="field__hint">
            A link to an image for now — uploads land with blob storage, and this is the field they will fill.
          </span>
        </label>

        <label className="field">
          <span>Banner</span>
          <input value={draft.coverUrl ?? ''} onChange={(e) => set('coverUrl', e.target.value)}
            placeholder="https://…" inputMode="url" />
          <span className="field__hint">
            The band behind your name. A link for now, same as the picture.
          </span>
        </label>

        <label className="field">
          <span>Chips</span>
          <input value={(draft.tags ?? []).join(', ')}
            onChange={(e) => set('tags', e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))}
            placeholder="Custom painter, Fujian, ships weekly" />
          <span className="field__hint">
            Up to six, separated by commas. These are scanned, not read — a paragraph gets skipped,
            three short facts do not.
          </span>
        </label>

        <label className="field">
          <span>Description</span>
          <textarea value={draft.bio ?? ''} onChange={(e) => set('bio', e.target.value)}
            placeholder="What you sell, where you import from, how often you run a lot." rows={4} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Dispatch region</span>
            <input value={draft.dispatchRegion ?? ''} onChange={(e) => set('dispatchRegion', e.target.value)}
              placeholder="Mumbai, MH" />
          </label>
          <label className="field">
            <span>Link</span>
            <input value={draft.link ?? ''} onChange={(e) => set('link', e.target.value)}
              placeholder="instagram.com/yourshop" inputMode="url" />
            <span className="field__hint">One only. Instagram, a group, a price list.</span>
          </label>
        </div>

        <fieldset className="fieldset">
          <legend>How buyers pay you directly</legend>
          <p className="faint" style={{ marginTop: 0 }}>
            Shown only to somebody checking out an order with you, never on the storefront. Without
            at least one of these, buyers cannot buy from you directly at all. Figmark does not move
            this money and does not check the account exists.
          </p>
          <label className="field">
            <span>UPI ID</span>
            <input value={draft.payment?.upiId ?? ''}
              onChange={(e) => setPayment('upiId', e.target.value)}
              placeholder="yourshop@okhdfcbank" />
          </label>
          <div className="field-row">
            <label className="field">
              <span>Account name</span>
              <input value={draft.payment?.accountName ?? ''}
                onChange={(e) => setPayment('accountName', e.target.value)} />
            </label>
            <label className="field">
              <span>Account number</span>
              <input value={draft.payment?.accountNumber ?? ''}
                onChange={(e) => setPayment('accountNumber', e.target.value)} />
            </label>
          </div>
          <div className="field-row">
            <label className="field">
              <span>IFSC</span>
              <input value={draft.payment?.ifsc ?? ''}
                onChange={(e) => setPayment('ifsc', e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>Anything else they should do</span>
              <input value={draft.payment?.instructions ?? ''}
                onChange={(e) => setPayment('instructions', e.target.value)}
                placeholder="Quote the order number in the note" />
            </label>
          </div>
        </fieldset>

        {flash && <p className="notice notice--ok">{flash}</p>}
        {error && <ErrorNotice message={error} />}

        <button type="submit" className="btn btn--lg"
          disabled={busy || !draft.storefrontName?.trim() || handleProblem !== null}>
          {busy ? 'Saving…' : 'Save storefront'}
        </button>
      </form>

      <aside className="stack">
        <span className="muted">Preview</span>
        <div className="card card--pad stack">
          <div className="row">
            {draft.photoUrl ? (
              <img className="channel__photo" src={draft.photoUrl} alt=""
                onError={(e) => ((e.currentTarget.style.display = 'none'))} />
            ) : (
              <Avatar name={name} size={46} />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{name}</div>
              <span className="faint">{draft.dispatchRegion || 'No dispatch region yet'}</span>
            </div>
          </div>
          <p className="muted" style={{ fontSize: 'var(--t-sm)' }}>
            {draft.bio || 'No description yet — buyers use this to decide whether to follow you.'}
          </p>
          {draft.username && <span className="faint">@{draft.username}</span>}
          {draft.link && <span className="badge">{draft.link.replace(/^https?:\/\//, '')}</span>}
          <div className="row">
            <span className="badge">{saved?.tier ?? 'unverified'}</span>
            <span className="faint">{saved?.followerCount ?? 0} followers</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

/* ── Items ──────────────────────────────────────────────────────────────── */

/** What is listed, and the way back to the lots that carry it. */
function MyItems({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'stock' | 'power' | 'templates'>('stock');

  useEffect(() => {
    void api
      .activity()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your listings.'),
      );
  }, []);

  if (error) return <ErrorNotice message={error} />;

  const mine = data?.listings.filter((listing) => listing.sellerId === store.ownerId) ?? [];

  return (
    <div className="stack">
      {/* Two ways to sell, and they are genuinely different jobs. One item put
          up for whoever finds it, or a run of them dropped into the channel on
          a timer. Both are here because a shop does both, at different hours. */}
      <div className="doors doors--two">
        <Link to={`/sell?store=${encodeURIComponent(store.ownerId)}`} className="door">
          <span className="door__glyph" aria-hidden="true">{<Icon name="tag" size={19} />}️</span>
          <span className="door__title">List an item</span>
          <span className="door__note">One thing, up for anyone browsing.</span>
        </Link>

        <button type="button" className="door door--pro" onClick={() => setMode('power')}>
          <span className="door__flag">Pro</span>
          <span className="door__glyph" aria-hidden="true">{<Icon name="bolt" size={19} />}</span>
          <span className="door__title">Start power selling</span>
          <span className="door__note">A whole sale, on a timer, in your channel.</span>
        </button>
      </div>

      <div className="seg" role="tablist" aria-label="Items view">
        <button type="button" role="tab" aria-selected={mode === 'stock'}
          className={mode === 'stock' ? 'is-on' : ''} onClick={() => setMode('stock')}>
          Your stock{mine.length > 0 ? ` · ${mine.length}` : ''}
        </button>
        <button type="button" role="tab" aria-selected={mode === 'power'}
          className={mode === 'power' ? 'is-on' : ''} onClick={() => setMode('power')}>
          Scheduled sales
        </button>
        <button type="button" role="tab" aria-selected={mode === 'templates'}
          className={mode === 'templates' ? 'is-on' : ''} onClick={() => setMode('templates')}>
          Templates
        </button>
      </div>

      {mode === 'templates' ? (
        <TemplatesPanel store={store} />
      ) : mode === 'power' ? (
        <PowerSalePanel storeId={store.ownerId} />
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : mine.length === 0 ? (
        <EmptyState title="Nothing listed yet">
          Everything you list goes out under {store.name}. It takes about a minute.
        </EmptyState>
      ) : (
        <>
          <div className="grid">
            {mine.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="card card--link">
                <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)}>
                  <div className="thumb__badges">
                    <span className="badge badge--solid">{listing.condition}</span>
                  </div>
                </Thumb>
                <div className="listing__body">
                  <span className="listing__title">{listing.title}</span>
                  <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
                  <div className="listing__meta">
                    {/* An item with no lot is not a problem to fix - most
                        never need one. It says which it is and stops there. */}
                    <span className={`badge${listing.lotId ? '' : ' badge--quiet'}`}>
                      {listing.lotId ? 'In a lot' : 'No lot'}
                    </span>
                    <span className="faint">{listing.viewCount} views</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** What a seller can be looking for on this screen. */
type OrderFilter = 'all' | 'answer' | 'nolot';

/**
 * Every customer purchase, one card each.
 *
 * This was the Payments screen, and payments was too narrow a name for it.
 * Money is one of six things an order needs answering about and the other five
 * had nowhere to live: whether the piece has reached the warehouse, whether it
 * is in a lot, which lot, where that lot has got to, and whether the
 * buyer has been told any of it. Those answers were spread across three
 * screens, so the normal working day was a tour.
 *
 * Nothing that answered a payment has been taken away. It is on the card now,
 * next to the rest of what the order needs.
 */
function Orders({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<SalesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SaleRow | null>(null);
  const [filing, setFiling] = useState<SaleRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('all');

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.sales(store.ownerId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your orders.');
    }
  }, [store.ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The one tick this screen makes. Everything else opens something. */
  async function markWarehouse(row: SaleRow, on: boolean) {
    setBusy(row.id);
    setError(null);
    try {
      await api.setCheckpoint(row.id, 'china_received', on);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const needsAnswer = new Set([...data.waiting, ...data.placed].map((row) => row.id));
  const shown = data.orders.filter((row) =>
    filter === 'all'
      ? true
      : filter === 'answer'
        ? needsAnswer.has(row.id)
        : row.awaitingLot);

  if (data.orders.length === 0) {
    return (
      <EmptyState title="No orders yet">
        Every purchase lands here — the money, the warehouse, the lot it travels in, and the one
        tick that tells the buyer it has arrived.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}

      <div className="seg" role="tablist" aria-label="Which orders">
        {([
          ['all', `All ${data.orders.length}`],
          ['answer', `To answer ${needsAnswer.size}`],
          ['nolot', `No lot ${data.orders.filter((row) => row.awaitingLot).length}`],
        ] as [OrderFilter, string][]).map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id}
            className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="muted">
          {filter === 'answer' ? 'Nothing waiting on you.' : 'Every order is in a lot.'}
        </p>
      ) : (
        <div className="orows">
          {shown.map((row) => (
          <OrderRow
            key={row.id}
            row={row}
            store={store}
            busy={busy === row.id}
            needsAnswer={needsAnswer.has(row.id)}
            onWarehouse={(on) => void markWarehouse(row, on)}
            onFile={() => setFiling(row)}
            onReject={() => setRejecting(row)}
          />
          ))}
        </div>
      )}

      {rejecting && (
        <RejectOrder
          row={rejecting}
          onClose={() => setRejecting(null)}
          onDone={() => { setRejecting(null); void load(); }}
        />
      )}

      {filing && (
        <FileIntoLot
          row={filing}
          store={store}
          onClose={() => setFiling(null)}
          onDone={() => { setFiling(null); void load(); }}
        />
      )}
    </div>
  );
}

/* ── Quick Post templates ───────────────────────────────────────────────── */

/**
 * The stationery a shop lists from.
 *
 * A shop that sells Marvel Legends lists forty of them a month, and every one
 * has the same category, the same three tags, the same two lines about
 * condition and shipping, and the same journey. Typing that forty times is how
 * a listing screen becomes a chore - and a chore is how a shop ends up with
 * forty listings that describe themselves forty different ways.
 *
 * A template is not a kind of listing and it is not attached to one. It fills
 * the form in and gets out of the way; every field it touches stays editable,
 * which is the difference between a template and a straitjacket.
 */
function TemplatesPanel({ store }: { store: StoreAccess }) {
  const [templates, setTemplates] = useState<PostTemplate[] | null>(null);
  const [editing, setEditing] = useState<PostTemplate | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTemplates((await api.templates()).templates);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your templates.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function remove(template: PostTemplate) {
    setBusy(template.id);
    try {
      await api.deleteTemplate(template.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not delete.');
    } finally {
      setBusy(null);
    }
  }

  if (error) return <ErrorNotice message={error} />;
  if (templates === null) return <p className="muted">Loading…</p>;

  if (editing) {
    return (
      <TemplateForm
        store={store}
        template={editing === 'new' ? null : editing}
        onCancel={() => setEditing(null)}
        onSaved={() => { setEditing(null); void load(); }}
      />
    );
  }

  return (
    <div className="stack">
      <button type="button" className="btn" style={{ justifySelf: 'start' }}
        onClick={() => setEditing('new')}>
        <Icon name="plus" size={15} /> Create template
      </button>

      {templates.length === 0 ? (
        <EmptyState icon="◫" title="No templates yet">
          Make one for the kind of thing you list most. The next item starts half-written — category,
          tags, your usual two lines, and the journey it will travel.
        </EmptyState>
      ) : (
        templates.map((template) => (
          <article key={template.id} className="tplcard">
            <div className="tplcard__top">
              <span className="tplcard__name">{template.name}</span>
              <span className="badge">{template.category || 'No category'}</span>
            </div>
            <span className="faint">
              {[
                template.tags.length > 0 ? template.tags.join(', ') : null,
                template.condition,
                template.defaultLotId ? 'Goes into a lot' : 'No lot',
              ].filter(Boolean).join(' · ')}
            </span>
            <span className="faint">
              {template.lotRouteName ?? 'China → India'} ·{' '}
              {preLotRouteOf(template).steps.length} steps before the lot
            </span>
            {template.description && <p className="tplcard__body">{template.description}</p>}
            <div className="tplcard__foot">
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(template)}>
                Edit
              </button>
              <button type="button" className="btn btn--ghost btn--sm" disabled={busy === template.id}
                onClick={() => void remove(template)}>
                Delete
              </button>
            </div>
          </article>
        ))
      )}
    </div>
  );
}

/** Write one, or correct one. The same form either way. */
function TemplateForm({ store, template, onCancel, onSaved }: {
  store: StoreAccess;
  template: PostTemplate | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(template?.name ?? '');
  const [category, setCategory] = useState(template?.category ?? CATEGORIES[0]!);
  const [tags, setTags] = useState((template?.tags ?? []).join(', '));
  const [condition, setCondition] = useState(template?.condition ?? '');
  const [sourcing, setSourcing] = useState<Sourcing>(template?.sourcing ?? 'in_hand');
  const [description, setDescription] = useState(template?.description ?? '');
  const [defaultLotId, setDefaultLotId] = useState(template?.defaultLotId ?? '');
  const [lotRouteId, setLotRouteId] = useState(template?.lotRouteId ?? '');
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots(store.isOwner ? undefined : store.ownerId)
      .then((result) => setLots(result.lots)).catch(() => setLots([]));
    void api.routes().then(setRoutes).catch(() => setRoutes(null));
  }, [store.ownerId, store.isOwner]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.saveTemplate({
        ...(template ? { id: template.id } : {}),
        name: name.trim(),
        category,
        tags: tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        condition: condition || null,
        sourcing,
        description: description.trim(),
        defaultLotId: defaultLotId || null,
        lotRouteId: lotRouteId || null,
        /* The first half of the route this item is expected to travel, stored
           on the template so an order sold before any lot exists still has a
           ladder to read. Derived rather than written a second time: two
           hand-authored ladders is exactly what used to put "at the China
           warehouse" on a buyer's screen twice. */
        preLotSteps: before.map((step) => ({ name: step.name, description: step.description })),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  /* The route this template's items are expected to travel, and the half of it
     that happens before any lot exists. */
  const chosen = routes?.routes.find((route) => route.id === lotRouteId)
    ?? routes?.builtIn
    ?? BUILT_IN_ROUTE;
  const before = preStepsOf(chosen);

  return (
    <form className="card card--pad form" onSubmit={submit}>
      <h2>{template ? 'Edit template' : 'New template'}</h2>

      <label className="field">
        <span>Template name *</span>
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Marvel Standard" required autoFocus />
        <span className="field__hint">What you will pick it by. Buyers never see it.</span>
      </label>

      <div className="field-row">
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Condition</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Ask each time</option>
            {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Tags</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="Marvel, Action figure, 1/12" />
        <span className="field__hint">Comma separated.</span>
      </label>

      <div className="field">
        <span>What this lists</span>
        <div className="seg" role="radiogroup" aria-label="What this template lists">
          <button type="button" role="radio" aria-checked={sourcing === 'in_hand'}
            className={sourcing === 'in_hand' ? 'is-on' : ''} onClick={() => setSourcing('in_hand')}>
            In hand
          </button>
          <button type="button" role="radio" aria-checked={sourcing === 'import'}
            className={sourcing === 'import' ? 'is-on' : ''} onClick={() => setSourcing('import')}>
            Imports
          </button>
        </div>
        <span className="field__hint">
          An import sold before its run is opened waits on the Orders screen until you file it into
          one. Say it here and you never have to say it again.
        </span>
      </div>

      <label className="field">
        <span>Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          placeholder={'Original Marvel Legends figure.\nCondition: MISB.\nShipping extra as applicable.'} />
        <span className="field__hint">The lines you write every time. Editable on every listing.</span>
      </label>

      <label className="field">
        <span>Default lot</span>
        <select value={defaultLotId} onChange={(e) => setDefaultLotId(e.target.value)}>
          <option value="">No lot — filed after it sells</option>
          {lots.map(({ lot }) => (
            <option key={lot.id} value={lot.id}>
              {lot.lotNumber ? `LOT ${lot.lotNumber} — ` : ''}{lot.name}
            </option>
          ))}
        </select>
        <span className="field__hint">
          Most items are sold first and filed into a run later, which is what the Orders screen is
          for. Pick one only if the run is already open.
        </span>
      </label>

      {/* One route, not two ladders. The route already says where the item
          stops travelling alone, so both halves come from the same list and
          cannot contradict each other the way two written ones did. */}
      <div className="card card--pad stack" style={{ background: 'var(--surface-2)' }}>
        <div>
          <div style={{ fontWeight: 600 }}>Tracking</div>
          <span className="field__hint">
            What a buyer of this item reads. Pick the journey it travels; the route says which
            steps happen to the order on its own and which happen once it is in a lot.
          </span>
        </div>

        <label className="field">
          <span>Route</span>
          <select value={lotRouteId} onChange={(e) => setLotRouteId(e.target.value)}>
            <option value="">
              {routes ? `${routes.builtIn.name} — ${routes.builtIn.steps.length} steps` : 'Loading…'}
            </option>
            {(routes?.routes ?? []).map((route) => (
              <option key={route.id} value={route.id}>
                {route.name} — {route.steps.length} steps
              </option>
            ))}
          </select>
          <span className="field__hint">
            Pre-selected when you open a lot for one of these items.{' '}
            <Link to="/routes">Write a route</Link> if none of these is the journey.
          </span>
        </label>

        <div className="field">
          <span>Before it joins a lot</span>
          <Ladder steps={before} current={-1} />
          <span className="field__hint">
            {before.length === 0
              ? 'This route has no steps before the lot, so a buyer waits with no timeline until one is opened.'
              : `What the buyer reads while they wait. The other ${chosen.steps.length - before.length} steps arrive with the lot.`}
          </span>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}
      <div className="row">
        <button type="submit" className="btn" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : 'Save template'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

/** The payment words a seller uses, rather than the ones the model stores. */
const PAYMENT_WORDS: Record<string, string> = {
  unpaid: 'Not paid',
  claimed: 'Says paid',
  paid: 'Paid',
  refunded: 'Refunded',
};

const ESCROW_WORDS: Record<string, string> = {
  none: 'No escrow',
  held: 'Held',
  released: 'Released',
  refunded: 'Refunded',
  disputed: 'In dispute',
};

/**
 * The one state worth colouring the edge of a row with.
 *
 * A queue is read down its left edge before any word in it is, so the stripe
 * has to answer the only question a shop is asking while scrolling: does this
 * one need me. Disputes first, then anything waiting on an answer, then money
 * that has landed, then everything quietly in progress.
 */
function orderTone(row: SaleRow, needsAnswer: boolean): { tone: string; label: string } {
  if (row.escrowState === 'disputed') return { tone: 'danger', label: 'In dispute' };
  if (needsAnswer) return { tone: 'warn', label: PAYMENT_WORDS[row.paymentStatus] ?? 'To answer' };
  if (row.paymentStatus === 'paid') return { tone: 'ok', label: 'Paid' };
  if (row.paymentStatus === 'refunded') return { tone: 'quiet', label: 'Refunded' };
  return { tone: 'quiet', label: PAYMENT_WORDS[row.paymentStatus] ?? row.paymentStatus };
}

/**
 * One purchase, as a row rather than a card.
 *
 * This was a 219px card 1140px wide, which put four orders on a desktop screen
 * and made reviewing thirty-eight of them ten screens of scrolling. A shop
 * works this list in a sitting, so it is a table now: the facts on one line,
 * the state in the edge, and the two controls that are actually used from here
 * kept on the row rather than promoted to full-width buttons.
 *
 * The actions stay in the markup at every width instead of appearing on hover,
 * because hover does not exist on the device most of this app is read on.
 * They are quiet until the row is under the pointer, which is a different
 * thing from being absent.
 */
function OrderRow({ row, store, busy, needsAnswer, onWarehouse, onFile, onReject }: {
  row: SaleRow;
  store: StoreAccess;
  busy: boolean;
  needsAnswer: boolean;
  onWarehouse: (on: boolean) => void;
  onFile: () => void;
  onReject: () => void;
}) {
  const received = Boolean(row.chinaReceivedAt);
  const lotHref = row.lotId
    ? `/lot/${row.lotId}${store.isOwner ? '' : `?store=${encodeURIComponent(store.ownerId)}`}`
    : null;
  const { tone, label } = orderTone(row, needsAnswer);

  return (
    <article className={`orow orow--${tone}${busy ? ' is-busy' : ''}`}>
      <span className="orow__stripe" aria-hidden="true" />

      <div className="orow__main">
        <Link to={`/order/${row.id}`} className="orow__name">{row.itemName}</Link>
        <div className="orow__meta">
          <span>{row.buyer.handle
            ? <Link to={`/${row.buyer.handle}`} className="orow__buyer">{row.buyer.name}</Link>
            : row.buyer.name}
          </span>
          <span>{timeAgo(row.createdAt)}</span>
          {row.quantity > 1 && <span>{row.quantity} units</span>}
          {!row.inHand && (
            lotHref
              /* The lot by the name the seller gave it, which is what the
                 lot page is headed with. Showing the generated number here
                 and the name over there gave one lot two labels and made
                 the link look like it went somewhere else. */
              ? <Link to={lotHref} className="orow__lot">{row.lotName ?? `LOT ${row.lotNumber}`}</Link>
              : <span className="orow__lot orow__lot--none">no lot</span>
          )}
          {row.lotStep && <span className="orow__step">{row.lotStep}</span>}
        </div>
      </div>

      <span className={`badge badge--${tone === 'quiet' ? 'accent' : tone}`}>{label}</span>
      <span className="orow__price">{formatMoney(row.totalMinor, row.currency)}</span>

      <div className="orow__acts">
        {/* A domestic sale has neither of these: it never goes near a
            warehouse and never joins a lot. */}
        {!row.inHand && (
          <>
            {/* Labelled, not a bare tick. This was a full-width button reading
                "China WH received" before the row rewrite, and shrinking it to
                an icon with a `title` left it undiscoverable on the device most
                of this is used on: touch has no hover, so the tooltip never
                appears and the control becomes a mystery glyph. */}
            <button type="button" disabled={busy} aria-pressed={received}
              className={`orow__toggle${received ? ' is-on' : ''}`}
              aria-label={received
                ? 'Received at the China warehouse. Tap to undo.'
                : 'Mark received at the China warehouse'}
              onClick={() => onWarehouse(!received)}>
              <Icon name={received ? 'check' : 'box'} size={13} />
              <span>China WH</span>
            </button>
            {!lotHref && (
              <button type="button" className="orow__toggle" aria-label="Add this order to a lot"
                onClick={onFile}>
                <Icon name="plus" size={13} />
                <span>Lot</span>
              </button>
            )}
          </>
        )}
        {needsAnswer && (
          <button type="button" className="orow__act orow__act--danger"
            aria-label="Can't serve this order" onClick={onReject}>
            <Icon name="close" size={15} />
          </button>
        )}
        <Link to={`/order/${row.id}`} className="orow__act" aria-label="Open this order">
          <Icon name="right" size={15} />
        </Link>
      </div>
    </article>
  );
}

/**
 * Put this order in a lot: an existing one, or one opened here.
 *
 * Opened here is the case worth designing for. A shop sells an item, the run it
 * belongs in does not exist yet, and the lot screen is two taps away and
 * asks for eight things - so the lot gets opened later, or never, and the
 * buyer waits without a timeline. This asks for a name and a route and does
 * both jobs in one request.
 */
function FileIntoLot({ row, store, onClose, onDone }: {
  row: SaleRow;
  store: StoreAccess;
  onClose: () => void;
  onDone: () => void;
}) {
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [routes, setRoutes] = useState<RoutesResponse | null>(null);
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [lotId, setLotId] = useState('');
  /* Prefilled, not defaulted. A name that appears in the field is one the
     seller reads and corrects; one applied silently when the field is left
     blank is how a shop ends up with a lot called "Lot for <the first thing
     that went in it>" holding thirty other people's parcels. */
  const [name, setName] = useState(() => suggestLotName());
  const [origin, setOrigin] = useState('');
  const [supplier, setSupplier] = useState('');
  const [handlerId, setHandlerId] = useState('');
  const [handlers, setHandlers] = useState<ProviderCard[]>([]);
  // The template's answer, pre-selected: picking the template once should be
  // the last time anybody thinks about this item's tracking.
  const [routeId, setRouteId] = useState(row.lotRouteId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots(store.isOwner ? undefined : store.ownerId)
      .then((result) => {
        setLots(result.lots);
        setLotId(result.lots[0]?.lot.id ?? '');
        // No lots yet means there is nothing to pick, so the form opens on
        // the door that works.
        if (result.lots.length === 0) setMode('new');
      })
      .catch(() => setLots([]));
    void api.routes().then(setRoutes).catch(() => setRoutes(null));
    void api.serviceDirectory('handler').then((r) => setHandlers(r.providers)).catch(() => setHandlers([]));
  }, [store.ownerId, store.isOwner]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.assignOrderToLot(row.id, mode === 'existing'
        ? { lotId }
        : {
            newLot: {
              name: name.trim(),
              origin: origin.trim(),
              supplierHandle: supplier.trim() || undefined,
              handlerUserId: handlerId || undefined,
              routeId: routeId || undefined,
            },
          });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Add ${row.itemName} to a lot`} onClose={onClose}>
      <div className="stack">
        <div className="seg" role="radiogroup" aria-label="Which lot">
          <button type="button" role="radio" aria-checked={mode === 'existing'}
            disabled={(lots?.length ?? 0) === 0}
            className={mode === 'existing' ? 'is-on' : ''} onClick={() => setMode('existing')}>
            Existing lot
          </button>
          <button type="button" role="radio" aria-checked={mode === 'new'}
            className={mode === 'new' ? 'is-on' : ''} onClick={() => setMode('new')}>
            New lot
          </button>
        </div>

        {mode === 'existing' ? (
          lots === null ? (
            <p className="muted">Loading…</p>
          ) : lots.length === 0 ? (
            <p className="muted">No lots open yet. Make one.</p>
          ) : (
            <label className="field">
              <span>Lot</span>
              <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                {lots.map(({ lot }) => (
                  <option key={lot.id} value={lot.id}>
                    {lot.lotNumber ? `LOT ${lot.lotNumber} — ` : ''}{lot.name}
                  </option>
                ))}
              </select>
            </label>
          )
        ) : (
          <>
            <label className="field">
              <span>Lot name *</span>
              <input value={name} onChange={(e) => setName(e.target.value)}
                placeholder="September import" required autoFocus />
              <span className="field__hint">
                Yours to recognise, and every later item goes in under it. Buyers never see it.
              </span>
            </label>
            <label className="field">
              <span>Origin</span>
              <input value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="China" />
            </label>
            <label className="field">
              <span>Supplier (optional)</span>
              <input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="@their_handle" />
            </label>
            <label className="field">
              <span>Domestic handler (optional)</span>
              <select value={handlerId} onChange={(e) => setHandlerId(e.target.value)}>
                <option value="">Nobody — you dispatch it yourself</option>
                {handlers.map((entry) => (
                  <option key={entry.userId} value={entry.userId}>{entry.name}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tracking template</span>
              <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                <option value="">
                  {routes ? `${routes.builtIn.name} — ${routes.builtIn.steps.length} steps` : 'Loading…'}
                </option>
                {(routes?.routes ?? []).map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name} — {route.steps.length} steps
                  </option>
                ))}
              </select>
              <span className="field__hint">
                Every item in this lot travels these steps, and the buyer reads them.
              </span>
            </label>
          </>
        )}

        {error && <ErrorNotice message={error} />}
        <button type="button" className="btn btn--block"
          disabled={busy || (mode === 'existing' ? !lotId : !name.trim())}
          onClick={() => void submit()}>
          {busy ? 'Filing…' : mode === 'existing' ? 'Add to lot' : 'Create lot & add order'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Turning an order down.
 *
 * Every order is a promise made before anything moves, and sometimes it cannot
 * be kept: the stock went, the supplier pulled the line, the lot will not
 * fill. The reason is required because the buyer is owed one - they may have
 * already sent money - and because "cancelled" with no explanation is how a
 * shop loses somebody who would otherwise have waited.
 */
function RejectOrder({ row, onClose, onDone }: {
  row: SaleRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.rejectOrder(row.id, reason.trim());
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not turn that down.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Turn this order down" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {row.itemName} — {row.buyer.name}, {formatMoney(row.totalMinor, row.currency)}.
        </p>
        <label className="field">
          <span>Why</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3}
            placeholder="Sold the last one this morning — sorry. Happy to put you first on the next run." />
          <span className="field__hint">
            They see this word for word. If they have already sent money, say what happens to it.
          </span>
        </label>
        {error && <p className="notice notice--error">{error}</p>}
        <p className="notice notice--warn" style={{ margin: 0 }}>
          The stock goes back on sale and, if they paid, the payment is marked for refund. This
          cannot be undone — a new order would have to be placed.
        </p>
        <button type="submit" className="btn btn--danger btn--block" disabled={busy || reason.trim().length < 4}>
          {busy ? 'Sending…' : 'Turn it down'}
        </button>
      </form>
    </Modal>
  );
}

/**
 * Consignments: opening them, filling them, and watching them move.
 *
 * These were two screens - "Manage lots" out on its own page, and a tracking
 * board in here - asking the database for the same rows twice and disagreeing
 * about what a lot card looks like. A lot is one object with one lifecycle;
 * splitting "administer it" from "watch it" put a trip out of the tab between a
 * seller and the thing they were already looking at.
 */
function Lots({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<LotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /*
   * Which lot is open lives in the URL, like the tab does, so a lot is a place
   * that can be linked to. An order's timeline sends its seller straight here
   * to move the lot on, and "go to Track, find the lot, open it" is not a
   * thing anybody should be told to do from a screen that knows which lot.
   */
  const [params, setParams] = useSearchParams();
  const openId = params.get('lot');
  const setOpenId = (next: string | null) =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      if (next) copy.set('lot', next);
      else copy.delete('lot');
      return copy;
    }, { replace: true });

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.myLots(store.isOwner ? undefined : store.ownerId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your lots.');
    }
  }, [store.ownerId, store.isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return <LotDetail lotId={openId} onBack={() => { setOpenId(null); void load(); }} />;
  }

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {creating ? (
        <NewLotForm
          suggestedName={suggestLotName()}
          onDone={() => { setCreating(false); void load(); }}
          onCancel={() => setCreating(false)}
        />
      ) : (
        // Routes now live on their own Sell-home card, not beside this button.
        <div className="row row--tight" style={{ justifySelf: 'start' }}>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New lot
          </button>
        </div>
      )}

      {/* Items with nowhere to travel. Not an error - most items never need a
          lot - but a seller who meant to file one wants to see it. */}
      {data.unassigned.length > 0 && (
        <div className="note-row">
          <div style={{ minWidth: 0 }}>
            <span className="card__title">{data.unassigned.length} not in a lot</span>
            <span className="faint">
              {data.unassigned.slice(0, 3).map((listing) => listing.title).join(' · ')}
              {data.unassigned.length > 3 && ` and ${data.unassigned.length - 3} more`}
            </span>
          </div>
          <span className="badge">Untracked</span>
        </div>
      )}

      {data.lots.length === 0 ? (
        <EmptyState icon="◲" title="No lots yet">
          A lot is one consignment. Open one for your next run, then file the items travelling in
          it — buyers never see the lot, only the tracking it produces.
        </EmptyState>
      ) : (
        data.lots.map((summary) => (
          <LotCard key={summary.lot.id} summary={summary} store={store} onOpen={() => setOpenId(summary.lot.id)} />
        ))
      )}
    </div>
  );
}

/** The numbers on a lot card that open the people behind them. */
type Drill = 'customers' | 'packed' | 'dispatched';

const DRILL_HINTS: Record<Drill, string> = {
  customers: 'Everyone with something in this lot, most items first.',
  packed: 'How far each person is, least packed first — that is the work left.',
  dispatched: 'Who has gone and who is still here.',
};

/**
 * One consignment: what is in it, where it is, and the two things to do with it.
 *
 * The counts collapse once it has left: a lot in transit is a tracking
 * number and a stage, and the packing figures it was worked by are history the
 * moment it is on a plane.
 */
function LotCard({ summary, store, onOpen }: {
  summary: LotSummary;
  store: StoreAccess;
  onOpen: () => void;
}) {
  const { lot, tally } = summary;
  const board = `/lot/${lot.id}${store.isOwner ? '' : `?store=${encodeURIComponent(store.ownerId)}`}`;
  // Read off the same tally the bars below chart, rather than from the stage
  // the seller last ticked: thirty-three of thirty-four in the warehouse is
  // "prepping" whatever the lot record says, and a line derived from the same
  // counts cannot disagree with the bars under it.
  const phase = phaseOfCounts(tally.counts);

  /*
   * Open or shut, and nothing else decides it.
   *
   * The counts used to be hidden once the lot left "ordering", so two lots on
   * one screen were two different components: one a header, one a dashboard,
   * and no way to tell which you would get. A card is one shape; how much of
   * it you are looking at is your choice.
   */
  const [open, setOpen] = useState(false);
  const [drill, setDrill] = useState<Drill | null>(null);
  const [people, setPeople] = useState<LotBoard | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);

  /**
   * Open the rows behind a number.
   *
   * The manifest is fetched the first time one is tapped rather than with the
   * card: a seller with nine lots would otherwise pay for nine manifests to
   * see a list of names nobody asked for.
   */
  const drillInto = (chip: Drill) => {
    setDrill((current) => (current === chip ? null : chip));
    if (people || peopleError) return;
    void api
      .lotBoard(lot.id, store.isOwner ? undefined : store.ownerId)
      .then(setPeople)
      .catch((err: unknown) =>
        setPeopleError(
          err instanceof ApiRequestError ? err.message : 'Could not load who is in this lot.',
        ),
      );
  };

  return (
    <article className={`lot${lot.stage === 'ordering' ? '' : ' lot--moving'}`}>
      <div className="lot__head">
        <span className="lot__title">
          <span className="lot__name">
            {lot.lotNumber && <span className="lot__no">LOT {lot.lotNumber}</span>}
            {lot.name}
          </span>
          <span className="faint">
            {[
              lot.origin || null,
              summary.orderCount > 0 ? `${summary.orderCount} items` : null,
              routeOf(lot).name,
              lot.forwarder?.trackingReference ?? null,
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span className={`badge badge--${lot.stage === 'delivered' ? 'ok' : 'warn'}`}>
          {LOT_STAGE_LABELS[lot.stage]}
        </span>
        {/* The way in. A card is a summary you read; this is the lot you work. */}
        <button type="button" className="lot__enter" onClick={onOpen}
          aria-label={`Open ${lot.name}`}>
          <Icon name="right" size={18} />
        </button>
      </div>

      <div className="lot__bar" aria-hidden="true">
        <span style={{ width: `${((LOT_STAGES.indexOf(lot.stage) + 1) / LOT_STAGES.length) * 100}%` }} />
      </div>

      {/* Where the lot is on its own route, in the seller's words, and then
          what the parcels inside it are doing - which is not the same question
          and does not always have the same answer. */}
      <div className="lot__status">
        <span className={`lot__pip lot__pip--${phase}`} aria-hidden="true" />
        <strong>{currentStepName(lot)}</strong>
        <span className="faint">· {PHASE_LABELS[phase]}</span>
      </div>
      {(supplierIdOf(lot) || lot.handler?.name) && (
        <div className="lot__crew">
          {supplierIdOf(lot) && <span className="chipfact">Supplier tagged</span>}
          {lot.handler?.name && <span className="chipfact">Handler: {lot.handler.name}</span>}
        </div>
      )}

      {/* Everything a lot card can say, once it is asked. Shut by default
          because a seller with nine lots is looking for one of them. */}
      <button type="button" className="lot__more" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name={open ? 'down' : 'right'} size={13} />
        {open ? 'Less' : `${tally.customers} ${tally.customers === 1 ? 'customer' : 'customers'} · ${countOf(tally, 'packed').done} packed · ${tally.customersDispatched} sent`}
      </button>

      {open && summary.orderCount === 0 && (
        <p className="lot__empty">Nothing in this lot yet.</p>
      )}

      {open && summary.orderCount > 0 && (
        <div className="lot__body">
          <div className="tiles">
            <Tile
              value={String(tally.customers)}
              label="Customers"
              onClick={() => drillInto('customers')}
              open={drill === 'customers'}
            />
            <Tile
              value={String(countOf(tally, 'packed').done)}
              label="Packed"
              tone="blue"
              onClick={() => drillInto('packed')}
              open={drill === 'packed'}
            />
            <Tile
              value={`${tally.customersDispatched}/${tally.customers}`}
              label="Dispatched"
              tone="green"
              onClick={() => drillInto('dispatched')}
              open={drill === 'dispatched'}
            />
          </div>

          {drill && (
            <div className="drill">
              {peopleError ? (
                <p className="faint">{peopleError}</p>
              ) : people ? (
                <DrillRows board={people} chip={drill} to={board} />
              ) : (
                <p className="faint">Loading…</p>
              )}
            </div>
          )}

          <div className="bars">
            {tally.progress.map((row) => (
              <div key={row.checkpoint} className="bar">
                <span className="bar__label">{CHECKPOINT_COUNT_LABELS[row.checkpoint]}</span>
                <span className="bar__track">
                  <span className="bar__fill"
                    style={{ width: `${row.total === 0 ? 0 : (row.done / row.total) * 100}%` }} />
                </span>
                <span className="bar__count">{row.done}/{row.total}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="lot__foot">
        <button type="button" className="btn btn--quiet btn--sm" onClick={onOpen}>Edit lot</button>
        <Link to={board} className="btn btn--ghost btn--sm">Packing board →</Link>
      </div>
    </article>
  );
}

/**
 * The people behind one of a lot card's numbers.
 *
 * Per person rather than per item, because a parcel goes to a person: "four
 * packed" is a fact about cardboard, and "Priya 1 of 3" is the thing to do
 * something about. The per-person counts add back up to the number that was
 * tapped, so the list can never contradict the tile above it.
 */
function DrillRows({ board, chip, to }: { board: LotBoard; chip: Drill; to: string }) {
  const rows = board.customers.map((customer) => {
    const ticked = (checkpoint: 'packed' | 'dispatched') =>
      customer.orders.filter((order) => Boolean(order.checkpoints?.[checkpoint])).length;
    return {
      customer,
      total: Math.max(1, customer.orders.length),
      packed: ticked('packed'),
      dispatched: ticked('dispatched'),
    };
  });

  // Whichever number was tapped, the rows that still need work come first.
  if (chip === 'packed') rows.sort((a, b) => a.packed / a.total - b.packed / b.total);
  else if (chip === 'dispatched') rows.sort((a, b) => a.dispatched / a.total - b.dispatched / b.total);
  else rows.sort((a, b) => b.total - a.total);

  if (rows.length === 0) return <p className="faint">Nobody has ordered into this lot yet.</p>;

  // Eight, then the board. A lot of forty is a working session, not a
  // glance, and the screen built for it is one tap away.
  const shown = rows.slice(0, 8);

  return (
    <>
      <span className="faint">{DRILL_HINTS[chip]}</span>
      {shown.map(({ customer, total, packed, dispatched }) => {
        const done = chip === 'dispatched' ? dispatched : packed;
        const tone = done === total ? ' badge--ok' : done === 0 ? '' : ' badge--warn';
        return (
          <div key={customer.buyerId} className="drill__row">
            <span className="drill__name">{customer.name}</span>
            {chip === 'customers' ? (
              <span className="badge">{total} item{total === 1 ? '' : 's'}</span>
            ) : (
              <span className={`badge${tone}`}>
                {done}/{total} {chip === 'dispatched' ? 'gone' : 'packed'}
              </span>
            )}
          </div>
        );
      })}
      {rows.length > shown.length && (
        <Link to={to} className="drill__more">
          {rows.length - shown.length} more on the packing board →
        </Link>
      )}
    </>
  );
}

/* ── Analytics ──────────────────────────────────────────────────────────── */

/** The numbers worth checking, and nothing that cannot be acted on. */
function Analytics({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [pro, setPro] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [proError, setProError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .dashboard()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your analytics.'),
      );
  }, []);

  // A second request rather than a bigger first one: the shop figures come
  // from listings and the consignment figures from the packing board, and one
  // of them failing is no reason to show neither.
  useEffect(() => {
    setPro(null);
    setProError(null);
    void api
      .insights(store.isOwner ? undefined : store.ownerId)
      .then(setPro)
      .catch((err: unknown) =>
        setProError(
          err instanceof ApiRequestError ? err.message : 'Could not load your consignment figures.',
        ),
      );
  }, [store.ownerId, store.isOwner]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const { analytics } = data;
  const peak = Math.max(1, ...analytics.daily.map((day) => day.revenueMinor));

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Revenue" value={formatMoney(analytics.revenueMinor)} note="All orders, excluding cancelled" />
        <Stat label="Units sold" value={String(analytics.unitsSold)} note={`${analytics.orderCount} orders`} />
        <Stat label="Views" value={String(analytics.views)} note={`${analytics.saves} saves`} />
        <Stat
          label="Conversion"
          value={`${(analytics.conversion * 100).toFixed(1)}%`}
          note="Units sold per view"
        />
      </div>

      <div className="card card--pad stack">
        <div>
          <h2>Last 30 days</h2>
          <span className="field__hint">Revenue per day. Hover a bar for the date.</span>
        </div>
        <div className="spark">
          {analytics.daily.map((day) => (
            <span
              key={day.date}
              className={`spark__bar${day.revenueMinor === 0 ? ' spark__bar--empty' : ''}`}
              style={{ height: `${Math.max(4, (day.revenueMinor / peak) * 100)}%` }}
              title={`${day.date}: ${formatMoney(day.revenueMinor)} from ${day.orders} order${day.orders === 1 ? '' : 's'}`}
            />
          ))}
        </div>
      </div>

      <div className="card card--pad stack">
        <h2>Best performing</h2>
        {analytics.topListings.length === 0 ? (
          <p className="muted">Nothing listed yet.</p>
        ) : (
          analytics.topListings.map((listing) => (
            <Link key={listing.id} to={`/listing/${listing.id}`} className="channel">
              <div className="channel__body">
                <div className="channel__top">
                  <span className="channel__name">{listing.title}</span>
                  <span className="badge">{listing.unitsSold} sold</span>
                </div>
                <span className="channel__last">
                  {listing.viewCount} views · {listing.likeCount} saves
                </span>
              </div>
            </Link>
          ))
        )}
      </div>

      {proError && <p className="faint">{proError}</p>}
      {pro && <ProInsights data={pro} />}
    </div>
  );
}

/* ── Pro analytics ──────────────────────────────────────────────────────── */

/**
 * A stretch of time in the unit that suits it.
 *
 * "0.0d" beside a bar is a number that has been rounded until it says nothing.
 * A leg measured in hours is reported in hours, and one too short to have hours
 * says so in words.
 */
function days(value: number): string {
  if (value >= 1) return `${value.toFixed(1)}d`;
  const hours = value * 24;
  return hours >= 1 ? `${Math.round(hours)}h` : 'same day';
}

/** A customer's name, linking to their page when they have one. */
function Person({ who }: { who: PartyRef }) {
  return who.handle ? (
    <Link to={`/${who.handle}`} className="ins__who">{who.name}</Link>
  ) : (
    <span className="ins__who">{who.name}</span>
  );
}

/**
 * What the consignments have been doing.
 *
 * Every figure below is the packing board read a different way - the same
 * checkpoints the seller ticks on a lot, counted and timed. Nothing here asks
 * anyone to fill in a second set of numbers, which is why it can be trusted:
 * a stat nobody maintains is a stat nobody believes.
 *
 * Added beneath the shop figures rather than replacing them. Revenue and views
 * answer "is the shop working"; these answer "where is everything, and who is
 * waiting", which is the question somebody running an import actually has.
 */
function ProInsights({ data }: { data: InsightsResponse }) {
  const { headline, boxes, timings, perLot, pending, cohorts, top, dormant, bulk, preOrders } = data;
  const sales = data.powerSales;
  const quiet =
    perLot.length === 0 && preOrders.length === 0 && sales.runs === 0 && headline.ordersInFlight === 0;

  // Segment bars are drawn against the slowest leg rather than against a fixed
  // scale, so the one to fix is the one that fills the row.
  const measured = SEGMENTS.filter((segment) => timings[segment] !== null);
  const slowest = Math.max(0.1, ...measured.map((segment) => timings[segment]!));

  return (
    <>
      <div className="ins__head">
        <span className="tag-pro">Pro</span>
        <div style={{ minWidth: 0 }}>
          <h2>Consignment analytics</h2>
          <span className="field__hint">
            Your packing board, read a different way. Nothing extra to fill in.
          </span>
        </div>
      </div>

      {quiet ? (
        <EmptyState icon="◷" title="Nothing has moved yet">
          Open a lot and file some orders into it. These figures are counted off the checkpoints
          you tick, so they fill themselves in as the consignment travels.
        </EmptyState>
      ) : (
        <>
          <div className="stats">
            <Stat
              label="In flight"
              value={String(headline.ordersInFlight)}
              note={`${headline.customers} customer${headline.customers === 1 ? '' : 's'} in all`}
            />
            <Stat
              label="Value moving"
              value={formatMoney(headline.valueInFlightMinor)}
              note={`${headline.openLots} lot${headline.openLots === 1 ? '' : 'es'} open`}
            />
            <Stat
              label="Awaiting payment"
              value={formatMoney(headline.unpaidMinor)}
              note={
                headline.oldestWaitingDays > 0
                  ? `oldest landed ${headline.oldestWaitingDays} days ago`
                  : 'nothing landed and unpaid'
              }
            />
            <Stat
              label="Repeat customers"
              value={String(data.repeat)}
              note="bought across two lots or more"
            />
          </div>

          {boxes.byLot.length > 0 && (
            <div className="card card--pad stack">
              <div>
                <h2>Boxes still to pack</h2>
                <span className="field__hint">
                  One parcel per customer per lot, sized off what is in it. A customer drops out
                  once theirs is packed.
                </span>
              </div>
              <div className="tiles">
                <Tile value={String(boxes.small)} label="Small" />
                <Tile value={String(boxes.medium)} label="Medium" tone="blue" />
                <Tile value={String(boxes.large)} label="Large" tone="green" />
              </div>
              {boxes.byLot.map((row) => (
                <div key={row.lotId} className="ins__row">
                  <span className="ins__name">{row.lotName}</span>
                  <span className="faint">
                    {[
                      row.small > 0 && `${row.small} small`,
                      row.medium > 0 && `${row.medium} medium`,
                      row.large > 0 && `${row.large} large`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {measured.length > 0 && (
            <div className="card card--pad stack">
              <div>
                <h2>Time in each stage</h2>
                <span className="field__hint">
                  Average days, across every order you have moved. The long one is where to push.
                </span>
              </div>
              <div className="legs">
                {measured.map((segment) => (
                  <div key={segment} className="leg">
                    <span className="leg__label">{SEGMENT_LABELS[segment]}</span>
                    <span className="leg__days">{days(timings[segment]!)}</span>
                    <span className="leg__track">
                      <span
                        className="leg__fill"
                        style={{ width: `${Math.max(3, (timings[segment]! / slowest) * 100)}%` }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {perLot.length > 0 && (
            <div className="card card--pad stack">
              <div>
                <h2>Lot by lot</h2>
                <span className="field__hint">
                  Where each consignment actually is, and what is riding on it.
                </span>
              </div>
              {perLot.map((row) => (
                <div key={row.lotId} className="ins__lot">
                  <div className="ins__row">
                    <span className="ins__name">{row.lotName}</span>
                    <span className="badge">{row.progress}%</span>
                  </div>
                  <span className="faint">{PHASE_LABELS[row.phase]}</span>
                  <span className="ins__track">
                    <span className="ins__fill" style={{ width: `${row.progress}%` }} />
                  </span>
                  <div className="ins__meta">
                    <span>{formatMoney(row.valueMinor)}</span>
                    <span className="faint">
                      {row.customers} customer{row.customers === 1 ? '' : 's'} · {row.orders} order
                      {row.orders === 1 ? '' : 's'}
                    </span>
                    {row.unpaidMinor > 0 && (
                      <span className="ins__owed">{formatMoney(row.unpaidMinor)} unpaid</span>
                    )}
                    {row.doorToDoor !== null && (
                      <span className="faint">{days(row.doorToDoor)} door to door</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <div className="card card--pad stack">
              <div>
                <h2>Landed and not paid for</h2>
                <span className="field__hint">
                  In India, waiting on money. Most owed first.
                </span>
              </div>
              {pending.map((row) => (
                <div key={row.buyerId} className="ins__row">
                  <span style={{ minWidth: 0 }}>
                    <Person who={row.who} />
                    <span className="faint">
                      {' '}· {row.orders} order{row.orders === 1 ? '' : 's'} ·{' '}
                      {row.waitingDays === 0
                        ? 'landed today'
                        : `waiting ${row.waitingDays} day${row.waitingDays === 1 ? '' : 's'}`}
                    </span>
                  </span>
                  <span className="badge badge--warn">{formatMoney(row.totalMinor)}</span>
                </div>
              ))}
            </div>
          )}

          {top.length > 0 && (
            <div className="card card--pad stack">
              <div>
                <h2>Best customers</h2>
                <span className="field__hint">By what they have actually spent with you.</span>
              </div>
              {top.map((row) => (
                <div key={row.buyerId} className="ins__row">
                  <span style={{ minWidth: 0 }}>
                    <Person who={row.who} />
                    <span className="faint">
                      {' '}· {row.orders} order{row.orders === 1 ? '' : 's'} across {row.lots} lot
                      {row.lots === 1 ? '' : 'es'}
                    </span>
                  </span>
                  <span className="ins__money">{formatMoney(row.totalMinor)}</span>
                </div>
              ))}
            </div>
          )}

          {cohorts.length > 0 && (
            <div className="card card--pad stack">
              <div>
                <h2>New against returning</h2>
                <span className="field__hint">
                  Customers in each lot, and whether you had seen them before.
                </span>
              </div>
              <div className="legs">
                {cohorts.map((row, index) => (
                  <div key={`${row.lotName}:${index}`} className="coh">
                    <span className="coh__name">{row.lotName}</span>
                    <span className="coh__count">
                      {row.newCount} new · {row.returningCount} back
                    </span>
                    <span className="coh__track">
                      <span className="coh__new" style={{ flexGrow: row.newCount }} />
                      <span className="coh__old" style={{ flexGrow: row.returningCount }} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {(bulk.length > 0 || dormant.length > 0) && (
            <div className="card card--pad stack">
              {bulk.length > 0 && (
                <>
                  <div>
                    <h2>Worth packing together</h2>
                    <span className="field__hint">
                      Several items in one lot, going to one person — one parcel, not three.
                    </span>
                  </div>
                  {bulk.map((row) => (
                    <div key={`${row.buyerId}:${row.lotName}`} className="ins__row">
                      <span style={{ minWidth: 0 }}>
                        <Person who={row.who} />
                        <span className="faint"> · {row.lotName}</span>
                      </span>
                      <span className="badge">{row.count} items</span>
                    </div>
                  ))}
                </>
              )}

              {dormant.length > 0 && (
                <>
                  <div style={{ marginTop: bulk.length > 0 ? 6 : 0 }}>
                    <h2>Not seen lately</h2>
                    <span className="field__hint">
                      Bought before, nothing in your last three lots.
                    </span>
                  </div>
                  {dormant.map((row) => (
                    <div key={row.buyerId} className="ins__row">
                      <span style={{ minWidth: 0 }}>
                        <Person who={row.who} />
                        <span className="faint"> · last in {row.lastLotName}</span>
                      </span>
                      <span className="badge">{row.lotsAgo} lots ago</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {(sales.runs > 0 || preOrders.length > 0) && (
            <div className="card card--pad stack">
              <div>
                <h2>Sales and pre-orders</h2>
                <span className="field__hint">
                  What the channel did, and which pre-orders got there.
                </span>
              </div>

              {sales.runs > 0 && (
                <div className="tiles">
                  <Tile value={String(sales.posted)} label="Items dropped" />
                  <Tile value={String(sales.inWindow)} label="In the window" tone="blue" />
                  <Tile value={String(sales.handedOver)} label="Moved to the shop" tone="green" />
                </div>
              )}

              {preOrders.map((row) => {
                const percent = Math.min(
                  100,
                  Math.round(((row.booked + row.pledged) / Math.max(1, row.threshold)) * 100),
                );
                return (
                  <div key={row.listingId} className="ins__lot">
                    <div className="ins__row">
                      <Link to={`/listing/${row.listingId}`} className="ins__name">{row.title}</Link>
                      <span className={`badge${row.filled ? ' badge--ok' : row.closedShort ? ' badge--warn' : ''}`}>
                        {row.filled ? 'Filled' : row.closedShort ? 'Closed short' : `${percent}%`}
                      </span>
                    </div>
                    <span className="ins__track">
                      <span className="ins__fill" style={{ width: `${percent}%` }} />
                    </span>
                    <span className="faint">
                      {row.booked} paid{row.pledged > 0 && ` · ${row.pledged} pledged`} of{' '}
                      {row.threshold} needed
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ── People ─────────────────────────────────────────────────────────────── */

/**
 * Who else runs this shop, and what they may do.
 *
 * Separate rights rather than one "manager" switch, because the jobs are
 * different: whoever lists the items is often not whoever should see the
 * revenue, and neither of them should be handing out access.
 */
function People({ store, onChanged }: { store: StoreAccess; onChanged: () => void | Promise<void> }) {
  const [managers, setManagers] = useState<StoreManager[] | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [granted, setGranted] = useState<StorePermission[]>(['listings']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    void api
      .storefront()
      .then((result) => setManagers(result.storefront?.managers ?? []))
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the people here.'),
      );
  }, [store.ownerId]);

  async function run(fn: () => Promise<{ managers: StoreManager[] }>, message: string) {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      setManagers((await fn()).managers);
      setFlash(message);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  const toggle = (permission: StorePermission) =>
    setGranted((current) =>
      current.includes(permission)
        ? current.filter((entry) => entry !== permission)
        : [...current, permission],
    );

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <div>
          <div style={{ fontWeight: 600 }}>Bring someone in</div>
          <span className="field__hint">
            They need an account here already. Name them by the email or phone they signed up with.
          </span>
        </div>

        <label className="field">
          <span>Email or phone</span>
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)}
            placeholder="them@example.com" />
        </label>

        <div className="stack" style={{ gap: 8 }}>
          <span className="field__hint">What they may do</span>
          {STORE_PERMISSIONS.map((permission) => (
            <label key={permission} className="row" style={{ cursor: 'pointer', gap: 9 }}>
              <input type="checkbox" checked={granted.includes(permission)}
                onChange={() => toggle(permission)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              <span style={{ fontSize: 'var(--t-sm)' }}>{STORE_PERMISSION_LABELS[permission]}</span>
            </label>
          ))}
        </div>

        {flash && <p className="notice notice--ok">{flash}</p>}
        {error && <ErrorNotice message={error} />}

        <button type="button" className="btn" style={{ justifySelf: 'start' }}
          disabled={busy || !identifier.trim() || granted.length === 0}
          onClick={() =>
            void run(
              () => api.updateManager({ storeId: store.ownerId, identifier: identifier.trim(), permissions: granted }),
              'Added.',
            ).then(() => setIdentifier(''))
          }>
          {busy ? 'Saving…' : 'Add to the shop'}
        </button>
      </div>

      <div className="card">
        <div className="channel">
          <Avatar name={store.name} size={40} />
          <div className="channel__body">
            <div className="channel__top">
              <span className="channel__name">{store.isOwner ? 'You' : 'The owner'}</span>
              <span className="badge badge--accent">Owner</span>
            </div>
            <span className="channel__last">Everything, and cannot be removed.</span>
          </div>
        </div>

        {(managers ?? []).map((manager) => (
          <div key={manager.userId} className="channel">
            <Avatar name={manager.displayName} size={40} />
            <div className="channel__body">
              <div className="channel__top">
                <span className="channel__name">{manager.displayName}</span>
                <button type="button" className="btn btn--quiet btn--sm" disabled={busy}
                  onClick={() =>
                    void run(
                      () => api.updateManager({ storeId: store.ownerId, identifier: manager.userId, remove: true }),
                      'Removed.',
                    )
                  }>
                  Remove
                </button>
              </div>
              <span className="channel__last">
                {manager.permissions.map((p) => STORE_PERMISSION_LABELS[p]).join(' · ')}
              </span>
            </div>
          </div>
        ))}
      </div>

      {managers?.length === 0 && (
        <p className="muted">Nobody else yet. A shop runs fine with one person.</p>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {note && <div className="stat__note">{note}</div>}
    </div>
  );
}
