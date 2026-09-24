import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  LOT_CARD_LABELS, LOT_STAGES,
  STORE_PERMISSIONS, STORE_PERMISSION_LABELS,
  type StorePermission,
} from '@shared/enums';
import { countOf, type LotTally } from '@shared/board';
import { CATEGORIES } from '@shared/catalog';
import { countryFlag } from '@shared/countries';
import { CONDITION_TAGS, type Sourcing } from '@shared/enums';
import { preLotRouteOf, type PostTemplate } from '@shared/templates';
import { Ladder } from '../components/Ladder';
import { RouteEditor, RoutesList } from './RoutesPage';
import { phaseOfCounts } from '@shared/insights';
import {
  BUILT_IN_ROUTE, preSteps as preStepsOf, suggestLotName,
} from '@shared/routes';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import type { BuyerReversalDetails, Listing, SellerPaymentDetails, SellerProfile, StoreManager } from '@shared/models';
import { REFUND_ORIGIN_LABELS, isExpired } from '@shared/payments';
import { EditListingDialog, ExpiryChip, StockChip } from '../components/Buy';
import { ProofPicker } from '../components/ProofPicker';
import type { StoreAccess } from '@shared/stores';
import type { SavedCalc } from '@shared/profit';
import {
  ApiRequestError,
  api,
  type DashboardResponse,
  type InsightsResponse,
  type PartyRef,
  type StorefrontDraft,
  type ActivityResponse,
  type LotSummary,
  type LotsResponse,
  type SaleRow,
  type SalesResponse,
  type ShopCredit,
  type RefundableOrder,
  type RoutesResponse,
} from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, type IconName, Modal, Thumb, leadPhoto } from '../components/ui';
import { PowerSalePanel } from '../components/PowerSale';
import { InsightsPanel } from './InsightsPanel';
import { ProfitCalculator } from './ProfitCalculator';
import { SalesPanel } from './SalesPanel';
import { PackingList } from './SupplierPage';
import { LotDetail, NewLotForm } from './LotsPage';
import { formatDate, formatDateOrdinal, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

type Section = 'items' | 'payments' | 'insights' | 'calculator' | 'refunds' | 'lots' | 'routes' | 'packing' | 'analytics' | 'storefront' | 'people';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'items', label: 'Items' },
  // Payments was too narrow a name for what this screen does: money is one of
  // six things an order needs answering about, and the other five had nowhere
  // to live. The id stays `payments` - it is the identity, and renaming it
  // would only be a way to break the rights that reference it.
  { id: 'payments', label: 'Orders' },
  // Who saved what, who stopped at Buy, and how items convert - the Pro tab.
  { id: 'insights', label: '✨ Insights' },
  // Landed cost and margin on the seller's own rates - Pro, beside Insights.
  { id: 'calculator', label: '🧮 Calculator' },
  // Every amount owed back to a buyer - overpaid, cancelled, or a refund the
  // seller starts - in one place, set apart on the right of the same row.
  { id: 'refunds', label: '↩️ Refunds' },
  { id: 'lots', label: 'Track' },
  { id: 'routes', label: 'Routes' },
  { id: 'packing', label: 'Packing' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'storefront', label: 'Storefront' },
  { id: 'people', label: 'People' },
];

/** Sections that are Pro: they wear the gold chip and the PRO badge. */
const PRO_SECTIONS: readonly Section[] = ['insights', 'calculator'];

/**
 * Which sections belong to the same Sell-home card, so the chip bar under a
 * card only ever shows the handful of screens that card promised - not all
 * eight at once.
 */
const SECTION_GROUPS: Record<string, Section[]> = {
  items: ['items', 'payments', 'insights', 'calculator', 'refunds'],
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
  const cameFor = (useLocation().state as { store?: string } | null)?.store;
  const [storeId, setStoreId] = useState(
    stores.some((entry) => entry.ownerId === cameFor) ? cameFor! : stores[0]!.ownerId);
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
      // A sub-view belongs to the tab it was opened in.
      copy.delete('view');
      return copy;
    }, { replace: true });

  const store = stores.find((entry) => entry.ownerId === storeId) ?? stores[0]!;
  // A section nobody may open should not be offered: a tab that answers 403 is
  // worse than a tab that is not there.
  const visible = SECTIONS.filter((entry) => {
    if (entry.id === 'items') return store.permissions.includes('listings');
    if (entry.id === 'analytics' || entry.id === 'insights' || entry.id === 'calculator') return store.permissions.includes('analytics');
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
              className={`chip${entry.id === 'refunds' ? ' chip--refunds' : ''}${PRO_SECTIONS.includes(entry.id) ? ' chip--pro' : ''}${active === entry.id ? ' is-on' : ''}`}
              onClick={() => setSection(entry.id)}
            >
              {entry.label}
              {PRO_SECTIONS.includes(entry.id) && <span className="probadge">PRO</span>}
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
          {active === 'insights' && <InsightsPanel store={store} />}
          {active === 'calculator' && <ProfitCalculator store={store} />}
          {active === 'refunds' && <Refunds store={store} />}
          {active === 'lots' && <Lots store={store} spotlightNew={params.get('spotlight') === 'new'} />}
          {active === 'routes' && <RoutesList spotlightNew={params.get('spotlight') === 'new'} />}
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
  // "Add to a power sale" from a saved calculation lands here, with it.
  const saleCalcs = (useLocation().state as { saleCalcs?: SavedCalc[] } | null)?.saleCalcs;
  const [mode, setMode] = useState<'stock' | 'power' | 'templates'>(saleCalcs?.length ? 'power' : 'stock');
  const [shelf, setShelf] = useState<'available' | 'expired' | 'sold_out'>('available');
  const [editing, setEditing] = useState<Listing | null>(null);

  const load = useCallback(() => {
    void api
      .activity()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your listings.'),
      );
  }, []);
  useEffect(load, [load]);

  if (error) return <ErrorNotice message={error} />;

  const all = data?.listings.filter((listing) => listing.sellerId === store.ownerId) ?? [];
  // Expired is read off the clock; sold out only ever applies to a counted item.
  const shelfOf = (listing: Listing) =>
    isExpired(listing) ? 'expired' : listing.status === 'sold_out' ? 'sold_out' : 'available';
  const counts = { available: 0, expired: 0, sold_out: 0 };
  for (const listing of all) counts[shelfOf(listing)] += 1;
  const mine = all.filter((listing) => shelfOf(listing) === shelf);

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
          <span className="probadge door__flag">PRO</span>
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
        <PowerSalePanel storeId={store.ownerId} startWith={saleCalcs} />
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="seg" role="tablist" aria-label="Shelf">
            {(['available', 'expired', 'sold_out'] as const).map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={shelf === entry}
                className={shelf === entry ? 'is-on' : ''} onClick={() => setShelf(entry)}>
                {entry === 'available' ? '🟢 Available' : entry === 'expired' ? '⛔ Expired' : '📭 Sold out'} · {counts[entry]}
              </button>
            ))}
          </div>
          {mine.length === 0 && (
            <EmptyState title={shelf === 'expired' ? 'Nothing expired 🎉' : shelf === 'sold_out' ? 'Nothing sold out' : 'Nothing listed yet'}>
              {shelf === 'available'
                ? `Everything you list goes out under ${store.name}. It takes about a minute.`
                : 'Items land here on their own and can be brought back from here.'}
            </EmptyState>
          )}
          <div className="grid">
            {mine.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="card card--link">
                <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)}>
                  <div className="thumb__badges">
                    <span className="badge badge--solid">{listing.condition}</span>
                    <ExpiryChip listing={listing} />
                  </div>
                </Thumb>
                <div className="listing__body">
                  <span className="listing__title">{listing.title}</span>
                  <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
                  <StockChip listing={listing} />
                  <button type="button" className="btn btn--ghost btn--sm"
                    onClick={(event) => { event.preventDefault(); setEditing(listing); }}>
                    {isExpired(listing) ? '✨ Make available again' : '✏️ Edit'}
                  </button>
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
      {editing && (
        <EditListingDialog listing={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
    </div>
  );
}

/** What a seller can be looking for on this screen. */
type OrderFilter = 'all' | 'answer' | 'nolot';

/** Done, either because the buyer confirmed it or because the seller ticked
 *  it delivered on the lot's own item list - either one is the same fact. */
function isCompleted(row: SaleRow): boolean {
  return row.status === 'delivered' || Boolean(row.deliveredAt);
}

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
  const [cancelling, setCancelling] = useState<SaleRow | null>(null);
  const [filing, setFiling] = useState<SaleRow | null>(null);
  const [denyingClaim, setDenyingClaim] = useState<SaleRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * Both filters live in the URL, so opening an order and coming back lands
   * on the same list it was opened from - not "All, Active" with the order
   * somewhere below the fold.
   */
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const filter = (['all', 'answer', 'nolot'] as const).find((entry) => entry === params.get('show')) ?? 'all';
  /** Delivered is done; everything else is still being worked. */
  const statusFilter = params.get('state') === 'completed' ? 'completed' : 'active';
  const setParam = (key: string, value: string) => setParams((current) => {
    const copy = new URLSearchParams(current);
    copy.set(key, value);
    return copy;
  }, { replace: true });
  const setFilter = (next: OrderFilter) => setParam('show', next);
  const setStatusFilter = (next: 'active' | 'completed') => setParam('state', next);
  const here = `${location.pathname}${location.search}`;
  const focusOrder = (location.state as { focusOrder?: string } | null)?.focusOrder ?? null;
  const [glowing, setGlowing] = useState<string | null>(null);

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

  /* Coming back from an order: put it in the middle of the screen and let it
     glow for a moment, then forget the request so a reload does not repeat it. */
  useEffect(() => {
    if (!data || !focusOrder) return;
    const card = document.getElementById(`order-${focusOrder}`);
    if (card) {
      card.scrollIntoView({ block: 'center' });
      setGlowing(focusOrder);
    }
    navigate(here, { replace: true, state: null });
    const timer = window.setTimeout(() => setGlowing(null), 1800);
    return () => window.clearTimeout(timer);
  }, [data, focusOrder, here, navigate]);

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

  async function accept(row: SaleRow) {
    setBusy(row.id);
    setError(null);
    try {
      await api.acceptOrder(row.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not accept that.');
    } finally {
      setBusy(null);
    }
  }

  /* Confirming that a claimed payment arrived is the same one-tap shape as
     Accept: nothing left to say, so nothing here should make the seller open
     the order to say it. Denying still needs a reason, so that opens its own
     small dialog rather than firing straight away. */
  async function settleReceived(row: SaleRow) {
    setBusy(row.id);
    setError(null);
    try {
      await api.settleClaim(row.id, { accept: true });
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not confirm that.');
    } finally {
      setBusy(null);
    }
  }

  if (error && !data) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const needsAnswer = new Set([...data.waiting, ...data.placed].map((row) => row.id));
  const scoped = data.orders.filter((row) =>
    statusFilter === 'completed' ? isCompleted(row) : !isCompleted(row));
  /* The "All / To answer / No lot" split only means anything for active
     orders - a completed one needs nothing answered and rides no lot search. */
  const shown = statusFilter === 'completed' ? scoped : scoped.filter((row) =>
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

      <div className="seg" role="tablist" aria-label="Order status">
        {(['active', 'completed'] as const).map((entry) => (
          <button key={entry} type="button" role="tab" aria-selected={statusFilter === entry}
            className={statusFilter === entry ? 'is-on' : ''}
            onClick={() => setStatusFilter(entry)}>
            {entry === 'active'
              ? `Active orders ${data.orders.filter((row) => !isCompleted(row)).length}`
              : `Completed orders ${data.orders.filter(isCompleted).length}`}
          </button>
        ))}
      </div>

      {statusFilter === 'active' && (
        <div className="seg" role="tablist" aria-label="Which orders">
          {([
            ['all', `All ${scoped.length}`],
            ['answer', `To answer ${needsAnswer.size}`],
            ['nolot', `No lot ${scoped.filter((row) => row.awaitingLot).length}`],
          ] as [OrderFilter, string][]).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={filter === id}
              className={filter === id ? 'is-on' : ''} onClick={() => setFilter(id)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {shown.length === 0 ? (
        <p className="muted">
          {statusFilter === 'completed'
            ? 'Nothing delivered yet.'
            : filter === 'answer' ? 'Nothing waiting on you.' : 'Every order is in a lot.'}
        </p>
      ) : (
        <div className="orows">
          {shown.map((row, index) => (
          <OrderRow
            key={row.id}
            index={index}
            row={row}
            store={store}
            from={here}
            glowing={glowing === row.id}
            busy={busy === row.id}
            needsAnswer={needsAnswer.has(row.id)}
            onWarehouse={(on) => void markWarehouse(row, on)}
            onFile={() => setFiling(row)}
            onReject={() => setRejecting(row)}
            onAccept={() => void accept(row)}
            onCancel={() => setCancelling(row)}
            onSettleReceived={() => void settleReceived(row)}
            onSettleDenied={() => setDenyingClaim(row)}
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

      {denyingClaim && (
        <DenyClaimRow
          row={denyingClaim}
          onClose={() => setDenyingClaim(null)}
          onDone={() => { setDenyingClaim(null); void load(); }}
        />
      )}

      {cancelling && (
        <CancelOrderRow
          row={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); void load(); }}
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
  if (row.status === 'dispute_raised') return { tone: 'danger', label: 'Dispute Raised' };
  if (row.status === 'payment_reversal_pending') return { tone: 'accent', label: 'Payment Reversal Pending' };
  if (row.status === 'cancelled_reversed') return { tone: 'ok', label: 'Cancelled + Reversed' };
  if (row.status === 'rejected') return { tone: 'danger', label: 'Rejected' };
  if (row.status === 'cancelled') return { tone: 'quiet', label: 'Cancelled' };
  if (row.escrowState === 'disputed') return { tone: 'danger', label: 'In dispute' };
  if (row.bookingOnly && !row.accepted) return { tone: 'warn', label: '📘 Book — awaiting acceptance' };
  if (needsAnswer) return { tone: 'warn', label: PAYMENT_WORDS[row.paymentStatus] ?? 'To answer' };
  if (row.paymentStatus === 'paid') return { tone: 'ok', label: 'Paid' };
  if (row.paymentStatus === 'partially_paid') return { tone: 'purple', label: 'Partially paid' };
  if (row.paymentStatus === 'refunded') return { tone: 'quiet', label: 'Refunded' };
  return { tone: 'quiet', label: PAYMENT_WORDS[row.paymentStatus] ?? row.paymentStatus };
}

/**
 * One purchase, as a card that reads top to bottom: what it is and who
 * bought it, where the money has got to, and then - on a line of its own -
 * whatever it needs from the seller right now.
 *
 * A card needing an answer wears a slowly turning aura in its own colour, so
 * a seller scrolling a long list sees what is waiting on them before reading
 * a word. The decisions themselves are always labelled and coloured - green
 * for yes, red for no - because touch has no hover and a bare glyph is a
 * guess.
 */
function OrderRow({
  index, row, store, from, glowing, busy, needsAnswer, onWarehouse, onFile, onReject, onAccept, onCancel,
  onSettleReceived, onSettleDenied,
}: {
  index: number;
  row: SaleRow;
  store: StoreAccess;
  /** Where this list is, so the order page can come back to exactly here. */
  from: string;
  glowing: boolean;
  busy: boolean;
  needsAnswer: boolean;
  onWarehouse: (on: boolean) => void;
  onFile: () => void;
  onReject: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onSettleReceived: () => void;
  onSettleDenied: () => void;
}) {
  const awaitingClaim = Boolean(row.claim && row.claim.decision === null);
  const received = Boolean(row.chinaReceivedAt);
  const lotHref = row.lotId
    ? `/lot/${row.lotId}${store.isOwner ? '' : `?store=${encodeURIComponent(store.ownerId)}`}`
    : null;
  const { tone, label } = orderTone(row, needsAnswer);
  const paidShare = row.totalMinor > 0 ? Math.min(100, Math.round((row.paidMinor / row.totalMinor) * 100)) : 0;
  const orderLink = { pathname: `/order/${row.id}` };
  const linkState = { from };

  return (
    <article id={`order-${row.id}`}
      className={`ocard ocard--${tone}${needsAnswer ? ' is-urgent' : ''}${glowing ? ' is-glowing' : ''}${busy ? ' is-busy' : ''}`}
      style={{ '--i': Math.min(index, 12) } as CSSProperties}>
      <div className="ocard__head">
        <Link to={orderLink} state={linkState} className="ocard__thumb" tabIndex={-1} aria-hidden="true">
          <Thumb seed={row.id} label={row.itemName} photo={row.photoUrl ? { url: row.photoUrl } : null}
            className="thumb ocard__img" />
        </Link>
        <div className="ocard__title">
          <Link to={orderLink} state={linkState} className="ocard__name">{row.itemName}</Link>
          {row.privateDeal && <span className="badge badge--pink">🔒 Private deal</span>}
          <div className="ocard__meta">
            {row.buyer.handle
              ? <Link to={`/${row.buyer.handle}`} className="ocard__buyer">{row.buyer.name}</Link>
              : <span className="ocard__buyer">{row.buyer.name}</span>}
            <span aria-hidden="true">·</span>
            <span>{timeAgo(row.createdAt)}</span>
            {row.quantity > 1 && <><span aria-hidden="true">·</span><span>×{row.quantity}</span></>}
          </div>
        </div>
        <div className="ocard__price">
          <b>{formatMoney(row.totalMinor, row.currency)}</b>
          <span className={`badge badge--${tone === 'quiet' ? 'accent' : tone}`}>{label}</span>
        </div>
      </div>

      {/* The money, as a bar rather than a sentence: how much of this has
          actually landed is the first thing a seller wants to know. */}
      <div className="ocard__money">
        <div className="ocard__bar" aria-hidden="true"><span style={{ width: `${paidShare}%` }} /></div>
        <div className="ocard__moneytext">
          <span><b>{formatMoney(row.paidMinor, row.currency)}</b> paid</span>
          {row.outstandingMinor > 0
            ? <span><b>{formatMoney(row.outstandingMinor, row.currency)}</b> left</span>
            : row.paidMinor > 0 && <span className="ocard__done">✨ Fully paid</span>}
          {row.creditMinor > 0 && <span className="ocard__extra">💰 {formatMoney(row.creditMinor, row.currency)} extra</span>}
        </div>
      </div>

      {!row.inHand && (
        <div className="ocard__chips">
          {lotHref
            /* The lot by the name the seller gave it, which is what the lot
               page is headed with. */
            ? <Link to={lotHref} className="ocard__chip ocard__chip--lot">📦 {row.lotName ?? `LOT ${row.lotNumber}`}</Link>
            : <span className="ocard__chip ocard__chip--none">No lot yet</span>}
          {row.lotStep && <span className="ocard__chip ocard__chip--step">🚚 {row.lotStep}</span>}
          {received && <span className="ocard__chip ocard__chip--ok">✓ At warehouse</span>}
        </div>
      )}

      {awaitingClaim && row.claim && (
        <div className="ocard__claim">
          💸 Buyer says they paid <b>{formatMoney(row.claim.amountMinor ?? row.totalMinor, row.currency)}</b>
          {row.claim.reference && <span className="ocard__ref"> · ref {row.claim.reference}</span>}
        </div>
      )}

      {/* The decision, when there is one, gets a row of its own: two equal
          buttons, yes on the left in green and no on the right in red. */}
      {(row.canAccept || awaitingClaim) && (
        <div className="ocard__decide">
          {row.canAccept ? (
            <>
              <button type="button" className="orow__decide orow__decide--ok" disabled={busy}
                aria-label="Accept this order" onClick={onAccept}>
                <Icon name="check" size={15} /> Accept
              </button>
              <button type="button" className="orow__decide orow__decide--danger" disabled={busy}
                aria-label="Reject this order" onClick={onReject}>
                <Icon name="close" size={15} /> Reject
              </button>
            </>
          ) : (
            <>
              <button type="button" className="orow__decide orow__decide--ok" disabled={busy}
                aria-label="Confirm the payment arrived" onClick={onSettleReceived}>
                <Icon name="check" size={15} /> Received
              </button>
              <button type="button" className="orow__decide orow__decide--danger" disabled={busy}
                aria-label="Say the payment has not arrived" onClick={onSettleDenied}>
                <Icon name="close" size={15} /> Not received
              </button>
            </>
          )}
        </div>
      )}

      <div className="ocard__acts">
        {/* A domestic sale never goes near a warehouse and never joins a lot. */}
        {!row.inHand && (
          <>
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
              <button type="button" className="orow__toggle" aria-label="Add this order to a lot" onClick={onFile}>
                <Icon name="plus" size={13} />
                <span>Lot</span>
              </button>
            )}
          </>
        )}
        <span className="ocard__spacer" />
        {row.canCancel && !awaitingClaim && (
          <button type="button" className="ocard__x" aria-label="Cancel this order" onClick={onCancel}>
            <Icon name="close" size={14} />
          </button>
        )}
        <Link to={orderLink} state={linkState} className="ocard__open" aria-label="Open this order">
          Open <Icon name="right" size={13} />
        </Link>
      </div>
    </article>
  );
}

/**
 * Everything the shop owes back, and everything it has sent back.
 *
 * Three ways money ends up owed to a buyer - they paid more than the item
 * cost, the seller cancelled after they had paid, or the seller decided to
 * refund some of it themselves (a dispute settled between them, a damaged
 * box) - and one place to deal with all three. Each can be returned whole or
 * in parts, moved onto another of that buyer's orders, or kept for their
 * next one; every return waits on the buyer to say it arrived, and every
 * one is kept in the history: to whom, for what, how much and when.
 */
function Refunds({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<SalesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'owed' | 'history'>('owed');
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.sales(store.ownerId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load refunds.');
    }
  }, [store.ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !data) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const deciding = data.credits.filter((credit) => credit.status !== 'refund_pending');
  const waiting = data.credits.filter((credit) => credit.status === 'refund_pending');
  const owedMinor = data.credits.reduce((sum, credit) => sum + credit.leftMinor, 0);
  const sentMinor = data.refundHistory
    .filter((entry) => entry.kind === 'refund' && entry.status === 'received')
    .reduce((sum, entry) => sum + entry.amountMinor, 0);
  const currency = data.credits[0]?.currency ?? data.refundHistory[0]?.currency ?? 'INR';

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}

      <section className="rfhero">
        <div className="rfhero__main">
          <small>Still to refund</small>
          <b>{formatMoney(owedMinor, currency)}</b>
          <span>
            {deciding.length} to decide · {waiting.length} waiting on the buyer · {formatMoney(sentMinor, currency)} refunded so far
          </span>
        </div>
        <button type="button" className="rfhero__new" onClick={() => setStarting((open) => !open)}>
          {starting ? 'Close' : '＋ New refund'}
        </button>
      </section>

      {starting && (
        <NewRefund refundable={data.refundable} onClose={() => setStarting(false)} onChanged={load}
          onDone={async () => { setStarting(false); setView('history'); await load(); }} />
      )}

      <div className="seg" role="tablist" aria-label="Refunds">
        <button type="button" role="tab" aria-selected={view === 'owed'} className={view === 'owed' ? 'is-on' : ''}
          onClick={() => setView('owed')}>
          To refund {data.credits.length}
        </button>
        <button type="button" role="tab" aria-selected={view === 'history'} className={view === 'history' ? 'is-on' : ''}
          onClick={() => setView('history')}>
          History {data.refundHistory.length}
        </button>
      </div>

      {view === 'owed' && (data.credits.length === 0 ? (
        <EmptyState title="Nothing to refund">
          When a buyer pays more than they owe, or you cancel an order they have paid for, the money
          they are owed lands here. You can also start a refund yourself with New refund.
        </EmptyState>
      ) : data.credits.map((credit) => <RefundCard key={credit.creditId} credit={credit} onChanged={load} />))}

      {view === 'history' && (data.refundHistory.length === 0 ? (
        <p className="muted">No refunds sent yet.</p>
      ) : (
        <ul className="rfhist">
          {data.refundHistory.map((entry) => (
            <li key={entry.id} className={`rfhist__row rfhist__row--${entry.kind === 'moved' ? 'moved' : entry.status}`}>
              <span className="rfhist__icon" aria-hidden="true">{entry.kind === 'moved' ? '➡️' : '↩️'}</span>
              <span className="rfhist__body">
                <b>{entry.buyer.name}</b>
                <small>
                  {entry.kind === 'moved' ? `Moved to ${entry.movedTo} · from ${entry.itemName}` : entry.itemName}
                  {' · '}{REFUND_ORIGIN_LABELS[entry.origin]}{entry.reason ? ` — ${entry.reason}` : ''}
                </small>
                <small>
                  {formatDateOrdinal(entry.at)}{entry.reference ? ` · ref ${entry.reference}` : ''}
                  {entry.screenshotUrl && (
                    <> · <a href={entry.screenshotUrl} target="_blank" rel="noopener noreferrer">📎 screenshot</a></>
                  )}
                </small>
              </span>
              <span className="rfhist__side">
                <b>{formatMoney(entry.amountMinor, entry.currency)}</b>
                <span className={`badge ${entry.kind === 'moved' ? 'badge--aqua'
                  : entry.status === 'received' ? 'badge--ok' : entry.status === 'awaiting' ? 'badge--warn' : 'badge--danger'}`}>
                  {entry.kind === 'moved' ? 'Moved' : entry.status === 'received' ? 'Received'
                    : entry.status === 'awaiting' ? 'Awaiting buyer' : 'Not received'}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

/** One amount owed back, and the three things a seller can do with it. */
function RefundCard({ credit, onChanged }: { credit: ShopCredit; onChanged: () => Promise<void> }) {
  const [mode, setMode] = useState<'refund' | 'apply' | null>(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = credit.status === 'refund_pending';
  const chosen = credit.targets.find((entry) => entry.orderId === target);
  const typedMinor = Math.round(Number(amount) * 100) || 0;
  const cap = mode === 'apply' && chosen ? Math.min(credit.leftMinor, chosen.outstandingMinor) : credit.leftMinor;

  function open(next: 'refund' | 'apply') {
    setMode(next);
    setError(null);
    setReference('');
    setShot(null);
    // Filled with what is owed, and editable: refund less and the rest stays here.
    if (next === 'refund') {
      setAmount(String(credit.leftMinor / 100));
      setMessage('');
    } else {
      const first = credit.targets[0];
      setTarget(first?.orderId ?? '');
      setAmount(first ? String(Math.min(credit.leftMinor, first.outstandingMinor) / 100) : '');
    }
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      setMode(null);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={`xcredit xcredit--${credit.status} xcredit--from-${credit.origin}`}>
      <div className="xcredit__head">
        <span className="xcredit__amt">{formatMoney(credit.leftMinor, credit.currency)}</span>
        <span className="xcredit__who">
          <b>{credit.buyer.name}</b>
          <small>
            <Link to={`/order/${credit.orderId}`}>{credit.itemName}</Link> · {timeAgo(credit.createdAt)}
          </small>
        </span>
        <span className="xcredit__tags">
          <span className="badge badge--accent">{REFUND_ORIGIN_LABELS[credit.origin]}</span>
          <span className={`badge ${pending ? 'badge--warn' : credit.status === 'held' ? 'badge--purple' : 'badge--pink'}`}>
            {pending ? 'Awaiting buyer' : credit.status === 'held' ? 'Kept for future' : 'To decide'}
          </span>
        </span>
      </div>

      {credit.reason && <p className="faint xcredit__note">“{credit.reason}”</p>}
      {credit.detailsCheck?.requestedAt && !credit.detailsCheck.confirmedAt && (
        <p className="faint xcredit__note">
          ⏳ Waiting for {credit.buyer.name} to {credit.buyerDetails ? 'confirm' : 'add'} their payment reversal details.
        </p>
      )}
      {(credit.refundedMinor > 0 || credit.applications.length > 0) && (
        <p className="faint xcredit__note">
          Of {formatMoney(credit.amountMinor, credit.currency)}:
          {credit.refundedMinor > 0 && ` ${formatMoney(credit.refundedMinor, credit.currency)} refunded`}
          {credit.applications.map((moved) => ` · ${formatMoney(moved.amountMinor, credit.currency)} → ${moved.itemName}`)}
        </p>
      )}
      {credit.disputable.map((entry) => (
        <div key={entry.subject} className="disputebar">
          <span>⚠️ {entry.label}. Check, and send it again - or dispute it.</span>
          <button type="button" className="btn btn--sm btn--danger" disabled={busy !== null}
            onClick={() => void run(`dispute-${entry.subject}`, () => api.flagDispute(credit.orderId, { subject: entry.subject }))}>
            {busy === `dispute-${entry.subject}` ? 'Recording…' : '⚖️ Dispute'}
          </button>
        </div>
      ))}
      {credit.refundDenials > 0 && !pending && credit.disputable.length === 0 && (
        <p className="notice notice--warn xcredit__note">
          The buyer said an earlier refund of this did not arrive - it is on record under My disputes.
        </p>
      )}
      {pending && credit.pendingRefund && (
        <p className="faint xcredit__note">
          ↩️ You refunded {formatMoney(credit.pendingRefund.amountMinor, credit.currency)}
          {credit.pendingRefund.reference ? ` (ref ${credit.pendingRefund.reference})` : ''} {timeAgo(credit.pendingRefund.sentAt)} —
          waiting for {credit.buyer.name} to confirm it arrived.
        </p>
      )}

      {!pending && !mode && (
        <div className="xcredit__acts">
          <button type="button" className="btn btn--sm btn--ok" onClick={() => open('refund')}>↩️ Refund</button>
          <button type="button" className="btn btn--sm btn--ghost" disabled={credit.targets.length === 0}
            title={credit.targets.length === 0 ? 'This buyer has no other order that still owes anything' : undefined}
            onClick={() => open('apply')}>
            ➡️ Use for an order
          </button>
          {credit.status === 'open' && (
            <button type="button" className="btn btn--sm btn--quiet" disabled={busy !== null}
              onClick={() => void run('hold', () => api.holdCredit(credit.orderId, credit.creditId))}>
              {busy === 'hold' ? 'Saving…' : '🕒 Keep for future orders'}
            </button>
          )}
        </div>
      )}

      {mode && (
        <div className="xcredit__form">
          {mode === 'refund' && (
            <PayoutDetails orderId={credit.orderId} buyerName={credit.buyer.name}
              details={credit.buyerDetails} check={credit.detailsCheck} onChanged={onChanged} />
          )}
          {mode === 'apply' && (
            <label className="field">
              <span>Put it towards</span>
              <select value={target} onChange={(e) => {
                setTarget(e.target.value);
                const next = credit.targets.find((entry) => entry.orderId === e.target.value);
                if (next) setAmount(String(Math.min(credit.leftMinor, next.outstandingMinor) / 100));
              }}>
                {credit.targets.map((entry) => (
                  <option key={entry.orderId} value={entry.orderId}>
                    {entry.itemName} — {formatMoney(entry.outstandingMinor, credit.currency)} owed
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="field">
            <span>Amount (₹)</span>
            <input type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <span className="field__hint">
              {typedMinor > cap
                ? `At most ${formatMoney(cap, credit.currency)}.`
                : typedMinor > 0 && typedMinor < credit.leftMinor
                  ? `${formatMoney(credit.leftMinor - typedMinor, credit.currency)} stays here to refund later.`
                  : `The full ${formatMoney(credit.leftMinor, credit.currency)}.`}
            </span>
          </label>
          {mode === 'refund' && (
            <>
              <label className="field">
                <span>Transaction id (UTR)</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 412345678901" />
              </label>
              <div className="field">
                <span>Screenshot of the transfer</span>
                <ProofPicker value={shot} onChange={setShot} />
                <span className="field__hint">The transaction id or a screenshot - at least one of the two.</span>
              </div>
              <label className="field">
                <span>Message to {credit.buyer.name}</span>
                <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Optional — a standard note is sent if you leave this empty." />
                <span className="field__hint">They are notified and asked to confirm it arrived.</span>
              </label>
            </>
          )}
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--ok"
              disabled={busy !== null || typedMinor <= 0 || typedMinor > cap || (mode === 'apply' && !target)
                || (mode === 'refund' && ((!reference.trim() && !shot) || !payoutReady(credit.buyerDetails, credit.detailsCheck)))}
              onClick={() => void run(mode, () => (mode === 'refund'
                ? api.refundCredit(credit.orderId, {
                    creditId: credit.creditId, amountMinor: typedMinor, screenshotUrl: shot ?? undefined,
                    reference: reference.trim() || undefined, message: message.trim() || undefined,
                  })
                : api.applyCredit(credit.orderId, { creditId: credit.creditId, targetOrderId: target, amountMinor: typedMinor })))}>
              {busy ? 'Saving…' : mode === 'refund'
                ? `I've refunded ${formatMoney(typedMinor, credit.currency)}`
                : 'Apply to this order'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => setMode(null)}>Back</button>
          </div>
        </div>
      )}
      {error && <ErrorNotice message={error} />}
    </section>
  );
}

/**
 * Where the buyer's money goes back to, shown in the refund window itself.
 *
 * The seller should not have to leave the refund to find out, or trust a
 * UPI id from a months-old chat. If the details are missing - or the seller
 * just wants to be sure they are still right - they ask from here: the buyer
 * gets a message and a notification, and the refund waits until the buyer
 * confirms them or saves new ones.
 */
function PayoutDetails({ orderId, buyerName, details, check, onChanged }: {
  orderId: string;
  buyerName: string;
  details: BuyerReversalDetails | null;
  check: ShopCredit['detailsCheck'];
  onChanged: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = Boolean(check?.requestedAt && !check.confirmedAt);

  function open() {
    setMessage(details
      ? 'Before I refund you, please check your payment reversal details are up to date (My refunds → Payment reversal details) and confirm them, or update them if anything has changed.'
      : 'I need to refund you. Please add your payment reversal details (My refunds → Payment reversal details) so I know where to send it.');
    setAsking(true);
    setError(null);
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await api.requestReversalDetails(orderId, message.trim() || undefined);
      setAsking(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`payout${details ? '' : ' payout--missing'}${pending ? ' payout--pending' : ''}`}>
      <div className="payout__head">
        <b>💳 Send it to</b>
        {details && (
          <small>
            Updated {formatDateOrdinal(details.updatedAt)}
            {check?.confirmedAt ? ` · confirmed ${formatDateOrdinal(check.confirmedAt)}` : ''}
          </small>
        )}
      </div>
      {details ? (
        <div className="payout__body">
          <dl className="payout__grid">
            <dt>Method</dt><dd>{details.method}</dd>
            <dt>Account / UPI</dt><dd className="mono">{details.identifier}</dd>
            <dt>Name</dt><dd>{details.accountName}</dd>
            {details.notes && <><dt>Notes</dt><dd>{details.notes}</dd></>}
          </dl>
          {details.qrCodeUrl && (
            <a href={details.qrCodeUrl} target="_blank" rel="noopener noreferrer" className="payout__qr">
              <img src={details.qrCodeUrl} alt={`${buyerName}'s payment QR code`} />
            </a>
          )}
        </div>
      ) : (
        <p className="payout__none">{buyerName} has not added payment reversal details yet.</p>
      )}
      {pending && check && (
        <p className="payout__wait">
          ⏳ You asked {buyerName} to {details ? 'check' : 'add'} these {timeAgo(check.requestedAt)}. You can
          refund once they confirm or update them.
        </p>
      )}
      {asking ? (
        <div className="payout__ask">
          <label className="field">
            <span>Message to {buyerName}</span>
            <textarea rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
            <span className="field__hint">They get it in their messages and as a notification.</span>
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void send()}>
              {busy ? 'Sending…' : '💬 Send'}
            </button>
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn--sm btn--ghost payout__askbtn" onClick={open}>
          💬 {pending ? `Remind ${buyerName}` : details ? `Ask ${buyerName} to confirm these` : `Ask ${buyerName} to add them`}
        </button>
      )}
      {error && <ErrorNotice message={error} />}
    </div>
  );
}

/** A refund needs somewhere to go, and the seller's own doubt about it answered. */
function payoutReady(details: BuyerReversalDetails | null, check: ShopCredit['detailsCheck']): boolean {
  return Boolean(details) && !(check?.requestedAt && !check.confirmedAt);
}

/**
 * A refund the seller starts themselves - after a dispute, a damaged box, a
 * goodwill gesture. Nothing is owed until they say so, so nothing is filled
 * in for them: they choose the order, type the amount, and say why.
 */
function NewRefund({ refundable, onClose, onDone, onChanged }: {
  refundable: RefundableOrder[];
  onClose: () => void;
  onDone: () => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [orderId, setOrderId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [shot, setShot] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = refundable.find((entry) => entry.orderId === orderId);
  const typedMinor = Math.round(Number(amount) * 100) || 0;

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.startRefund(chosen.orderId, {
        amountMinor: typedMinor, reason: reason.trim(), screenshotUrl: shot ?? undefined,
        reference: reference.trim() || undefined, message: message.trim() || undefined,
      });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not start that refund.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rfnew">
      <h3>＋ New refund</h3>
      {refundable.length === 0 ? (
        <p className="muted">No order has a payment on it that has not already been refunded.</p>
      ) : (
        <>
          <label className="field">
            <span>Order</span>
            <select value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">Choose an order…</option>
              {refundable.map((entry) => (
                <option key={entry.orderId} value={entry.orderId}>
                  {entry.buyer.name} — {entry.itemName} (up to {formatMoney(entry.refundableMinor, entry.currency)})
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <PayoutDetails orderId={chosen.orderId} buyerName={chosen.buyer.name}
              details={chosen.buyerDetails} check={chosen.detailsCheck} onChanged={onChanged} />
          )}
          <label className="field">
            <span>Amount (₹)</span>
            <input type="number" min="1" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
            {chosen && typedMinor > chosen.refundableMinor && (
              <span className="field__hint">At most {formatMoney(chosen.refundableMinor, chosen.currency)} on this order.</span>
            )}
          </label>
          <label className="field">
            <span>What is it for?</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="Box arrived dented — settled after the dispute" />
          </label>
          <label className="field">
            <span>Transaction id (UTR)</span>
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. 412345678901" />
          </label>
          <div className="field">
            <span>Screenshot of the transfer</span>
            <ProofPicker value={shot} onChange={setShot} />
            <span className="field__hint">The transaction id or a screenshot - at least one of the two.</span>
          </div>
          <label className="field">
            <span>Message to the buyer</span>
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional — a standard note is sent if you leave this empty." />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--ok"
              disabled={busy || !chosen || typedMinor <= 0 || typedMinor > (chosen?.refundableMinor ?? 0)
                || reason.trim().length < 3 || (!reference.trim() && !shot)
                || !payoutReady(chosen?.buyerDetails ?? null, chosen?.detailsCheck ?? null)}
              onClick={() => void submit()}>
              {busy ? 'Sending…' : typedMinor > 0 && chosen ? `Refund ${formatMoney(typedMinor, chosen.currency)}` : 'Refund'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
      {error && <ErrorNotice message={error} />}
    </section>
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
  const navigate = useNavigate();
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [lotId, setLotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots(store.isOwner ? undefined : store.ownerId)
      .then((result) => {
        setLots(result.lots);
        setLotId(result.lots[0]?.lot.id ?? '');
      })
      .catch(() => setLots([]));
  }, [store.ownerId, store.isOwner]);

  function goCreateLot() {
    onClose();
    navigate('/shop?tab=lots&spotlight=new');
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.assignOrderToLot(row.id, { lotId });
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
        <fieldset className="pickset">
          <legend>Choose a lot</legend>
          <span className="field__hint">
            Select one of your open lots, or create a new one.
          </span>

          {lots === null ? (
            <p className="muted">Loading…</p>
          ) : lots.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No lots open yet. Create one below.</p>
          ) : (
            lots.map(({ lot, tally }) => (
              <label key={lot.id} className={`pick${lotId === lot.id ? ' is-on' : ''}`}>
                <input type="radio" name="lot" checked={lotId === lot.id}
                  onChange={() => setLotId(lot.id)} />
                <span className="pick__body">
                  <span className="pick__name">
                    {lot.lotNumber ? `LOT ${lot.lotNumber} — ` : ''}{lot.name}
                  </span>
                  <span className="faint" style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 'var(--t-xs)' }}>
                    <span>{countryFlag(lot.originCountry)} → {countryFlag(lot.destinationCountry)}</span>
                    {lot.supplier?.name && <span>Supplier: {lot.supplier.name}</span>}
                    {lot.forwarder?.name && <span>Forwarder: {lot.forwarder.name}</span>}
                    {lot.handler?.name && <span>Handler: {lot.handler.name}</span>}
                  </span>
                </span>
              </label>
            ))
          )}
        </fieldset>

        <button type="button" className="silkcta" onClick={goCreateLot}>
          <span className="silkcta__label">✨ Create a new lot</span>
          <span className="silkcta__note">Opens the lots tab, ready to fill in</span>
        </button>

        {error && <ErrorNotice message={error} />}
        <button type="button" className="btn btn--block"
          disabled={busy || !lotId}
          onClick={() => void submit()}>
          {busy ? 'Filing…' : 'Add to lot'}
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
 * Saying a claimed payment has not landed, from the row rather than the
 * order screen - the same "did it arrive" question, just answered "no"
 * here, which is the one answer that needs a reason attached for the buyer.
 */
function DenyClaimRow({ row, onClose, onDone }: {
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
      await api.settleClaim(row.id, { accept: false, reason: reason.trim() });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Say this payment has not arrived" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {row.itemName} — {row.buyer.name}, {formatMoney(row.claim?.amountMinor ?? row.totalMinor, row.currency)}.
        </p>
        <label className="field">
          <span>What is wrong</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2}
            placeholder="Nothing has arrived, the amount is short, the reference does not match…" />
          <span className="field__hint">The buyer reads this and acts on it.</span>
        </label>
        {error && <p className="notice notice--error">{error}</p>}
        <button type="submit" className="btn btn--danger btn--block" disabled={busy || reason.trim().length < 4}>
          {busy ? 'Sending…' : 'It has not arrived'}
        </button>
      </form>
    </Modal>
  );
}

/**
 * Calling off an order already accepted or placed.
 *
 * The X button's other meaning: once the buyer has been told yes, turning the
 * order down is `Cancel`, never `Reject` again — the two statuses must stay
 * apart, and this dialog is the one that produces `Cancelled` (or, once
 * anything was paid, starts the payment reversal that ends in
 * `Cancelled + Reversed`).
 */
function CancelOrderRow({ row, onClose, onDone }: {
  row: SaleRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paid = row.paymentStatus === 'paid' || row.paymentStatus === 'partially_paid';

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.cancelOrder(row.id, { reason: reason.trim(), message: message.trim() || undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not cancel that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Cancel this order" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">
          {row.itemName} — {row.buyer.name}, {formatMoney(row.totalMinor, row.currency)}.
        </p>
        <label className="field">
          <span>Why</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={3}
            placeholder="Out of stock, buyer requested it…" />
        </label>
        <label className="field">
          <span>Message to the buyer</span>
          <textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={2}
            placeholder={`Your order for ${row.itemName} has been cancelled.`} />
          <span className="field__hint">Edit it, or leave it blank for the default.</span>
        </label>
        {error && <p className="notice notice--error">{error}</p>}
        {paid ? (
          <p className="notice notice--warn" style={{ margin: 0 }}>
            Money has already been paid. This moves the order to <strong>Payment Reversal Pending</strong>
            {' '}until the reversal is recorded on the order page.
          </p>
        ) : (
          <p className="notice notice--warn" style={{ margin: 0 }}>
            The order becomes <strong>Cancelled</strong>. This cannot be undone.
          </p>
        )}
        <button type="submit" className="btn btn--danger btn--block" disabled={busy || reason.trim().length < 4}>
          {busy ? 'Cancelling…' : 'Cancel order'}
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
function Lots({ store, spotlightNew = false }: { store: StoreAccess; spotlightNew?: boolean }) {
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

  /** Delivered is done; everything else is still being worked. */
  const [statusFilter, setStatusFilter] = useState<'active' | 'completed'>('active');

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

  const filtered = data.lots.filter((entry) =>
    statusFilter === 'completed' ? entry.lot.stage === 'delivered' : entry.lot.stage !== 'delivered');

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
        <span className="spotlight-row" style={{ justifySelf: 'start' }}>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} /> New lot
          </button>
          {spotlightNew && (
            <span className="spotlight-badge" aria-hidden="true">
              <Icon name="left" size={18} />
            </span>
          )}
        </span>
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
        <>
          <div className="seg" role="tablist" aria-label="Lot status">
            {(['active', 'completed'] as const).map((entry) => (
              <button key={entry} type="button" role="tab" aria-selected={statusFilter === entry}
                className={statusFilter === entry ? 'is-on' : ''}
                onClick={() => setStatusFilter(entry)}>
                {entry === 'active' ? 'Active lots' : 'Completed lots'}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <p className="muted">No {statusFilter} lots.</p>
          ) : (
            <div className="lot-grid">
              {filtered.map((summary) => (
                <LotCard key={summary.lot.id} summary={summary} store={store}
                  onOpen={() => setOpenId(summary.lot.id)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A lid colour per lot, stable across reloads and filtering.
 *
 * Hashed off the id rather than the list position, so a lot does not change
 * colour when another one above it leaves the filtered view.
 */
const CARTON_HUES = ['violet', 'coral', 'aqua', 'blue', 'pink', 'lime'] as const;
function hueOf(id: string): (typeof CARTON_HUES)[number] {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return CARTON_HUES[sum % CARTON_HUES.length]!;
}

/** The one status pill on a carton, from the same phase the bars beneath it chart. */
const PHASE_PILL: Record<ReturnType<typeof phaseOfCounts>, { label: string; icon: IconName; tone: 'ok' | 'info' | 'warn' | 'accent' }> = {
  empty: { label: 'Not started', icon: 'box', tone: 'warn' },
  filling: { label: 'Filling', icon: 'box', tone: 'warn' },
  prepping: { label: 'At Origin', icon: 'tag', tone: 'info' },
  china_done: { label: 'Dispatched', icon: 'truck', tone: 'info' },
  india: { label: 'In Transit', icon: 'truck', tone: 'ok' },
  domestic: { label: 'Out for Delivery', icon: 'truck', tone: 'ok' },
  completed: { label: 'Delivered', icon: 'check', tone: 'accent' },
};

/** What each icon-only flip tile means, for the tap-to-reveal label. */
const TILE_HINTS = {
  customers: 'Customers', orders: 'Orders', ready: 'Ready to dispatch',
  packed: 'Packed', dispatched: 'Dispatched',
} as const;
type TileKey = keyof typeof TILE_HINTS;

/** A number with just an icon - five of them have to fit where three used to. */
function MiniTile({ icon, value, tone, onClick, open }: {
  icon: IconName; value: string; tone?: 'blue' | 'green'; onClick?: () => void; open?: boolean;
}) {
  const className = `tile${tone ? ` tile--${tone}` : ''}${onClick ? ' tile--tap' : ''}${open ? ' is-open' : ''}`;
  const body = <><Icon name={icon} size={15} /><span className="tile__value">{value}</span></>;
  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-expanded={open ?? false}>{body}</button>
  ) : (
    <div className={className}>{body}</div>
  );
}

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
  const [hint, setHint] = useState<{ id: number; text: string } | null>(null);

  /** A little label that names an icon-only tile, then vanishes on its own. */
  const showHint = (key: TileKey) => {
    const id = Date.now();
    setHint({ id, text: TILE_HINTS[key] });
    setTimeout(() => setHint((current) => (current?.id === id ? null : current)), 1400);
  };

  const hue = hueOf(lot.id);
  const pill = PHASE_PILL[phase];
  const originFlag = countryFlag(lot.originCountry);
  const destFlag = countryFlag(lot.destinationCountry);
  /** The three progress checkpoints, said as a flag rather than a country name. */
  const BAR_LABEL: Record<string, string> = {
    china_received: `${originFlag} WH`,
    china_packed: `${originFlag} Packed`,
    india_received: `${destFlag} Rcvd`,
  };

  return (
    <article className={`lot lot--carton lot--${hue}${lot.stage === 'ordering' ? '' : ' lot--moving'}${open ? ' lot--flipped' : ''}`}>
      {/* The lid stays put - only the body below it flips. */}
      <div className="lot__head" role="button" tabIndex={0} onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(); }
        }}>
        <div className="lot__headtop">
          <span className="lot__title">
            <span className="lot__name">{lot.name}</span>
            {lot.lotNumber && <span className="lot__no">#LOT{lot.lotNumber}</span>}
          </span>
          {/* The current status, said once, at the top - not repeated below. */}
          <span className={`lotpill lotpill--sm lotpill--${pill.tone}`}>
            <Icon name={pill.icon} size={11} /> {pill.label}
          </span>
        </div>
        <span className="lot__lane">
          <span className="lot__flag" aria-hidden="true">{originFlag}</span>
          <Icon name="right" size={11} />
          <span className="lot__flag" aria-hidden="true">{destFlag}</span>
        </span>
        {/* The fold where an open flap meets the box - drawn, not photographed. */}
        <svg className="lot__crease" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 0 L38 0 L50 9 L62 0 L100 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        </svg>
      </div>

      <div className="lot__flip">
        {/* Front: what the box holds and who's working it. */}
        <div className="lot__face lot__face--front">
          <div className="lot__box">
            <dl className="factlist lot__facts">
              <div><dt>Supplier</dt><dd className={lot.supplier?.name ? '' : 'is-unset'}>{lot.supplier?.name || 'Not assigned'}</dd></div>
              <div><dt>Freight Forwarder</dt><dd className={lot.forwarder?.name ? '' : 'is-unset'}>{lot.forwarder?.name || 'Not assigned'}</dd></div>
              <div><dt>Domestic Handler</dt><dd className={lot.handler?.name ? '' : 'is-unset'}>{lot.handler?.name || 'Not assigned'}</dd></div>
            </dl>
          </div>

          {/* Flips the body over to show what's inside. */}
          <button type="button" className="lot__more" aria-expanded={open} onClick={() => setOpen(true)}>
            <span className="lot__count"><Icon name="users" size={12} />{tally.customers}</span>
            <span className="lot__count"><Icon name="box" size={12} />{summary.orderCount}</span>
            <Icon name="right" size={13} />
          </button>

          <button type="button" className="lot__open" onClick={onOpen}>
            Open <Icon name="right" size={13} />
          </button>
        </div>

        {/* Back: the numbers, once asked. */}
        <div className="lot__face lot__face--back" aria-hidden={!open}>
          {summary.orderCount === 0 ? (
            <p className="lot__empty">Nothing in this lot yet.</p>
          ) : (
            <div className="lot__body">
              <div className="lot__tiles lot__tiles--2">
                <MiniTile icon="users" value={String(tally.customers)} onClick={() => showHint('customers')} />
                <MiniTile icon="box" value={String(summary.orderCount)} onClick={() => showHint('orders')} />
              </div>
              <div className="lot__tiles lot__tiles--3">
                <MiniTile icon="tag" value={String(countOf(tally, 'ready_to_dispatch').done)}
                  onClick={() => showHint('ready')} />
                <MiniTile icon="check" value={String(countOf(tally, 'packed').done)} tone="blue"
                  onClick={() => showHint('packed')} />
                <MiniTile icon="truck" value={`${tally.customersDispatched}/${tally.customers}`} tone="green"
                  onClick={() => showHint('dispatched')} />
              </div>

              {hint && <div key={hint.id} className="lot__hint">{hint.text}</div>}

              <div className="bars">
                {tally.progress.map((row) => (
                  <div key={row.checkpoint} className="bar">
                    <span className="bar__label">{BAR_LABEL[row.checkpoint]}</span>
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

          <button type="button" className="lot__more" onClick={() => setOpen(false)}>
            <Icon name="left" size={13} /> Back
          </button>
        </div>
      </div>
    </article>
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
          err instanceof ApiRequestError ? err.message : 'Could not load what is in flight.',
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
      {pro && <RunningShop data={pro} />}
      <SalesPanel shop={store.isOwner ? undefined : store.ownerId} />
    </div>
  );
}

/* ── Running the shop ───────────────────────────────────────────────────── */

/** A customer's name, linking to their page when they have one. */
function Person({ who }: { who: PartyRef }) {
  return who.handle ? (
    <Link to={`/${who.handle}`} className="ins__who">{who.name}</Link>
  ) : (
    <span className="ins__who">{who.name}</span>
  );
}

/**
 * What is moving and who owes what - the day-to-day figures every shop needs,
 * so they stay free. The why and the who-to-chase live in Insights (Pro).
 */
function RunningShop({ data }: { data: InsightsResponse }) {
  const { headline, pending, toCollect } = data;
  const owed = toCollect.reduce((sum, row) => sum + row.outstandingMinor, 0);
  return (
    <>
      <div className="stats">
        <Stat
          label="In flight"
          value={String(headline.ordersInFlight)}
          note={`${headline.customers} customer${headline.customers === 1 ? '' : 's'} in all`}
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
        <Stat label="To collect" value={formatMoney(owed)} note="on orders you accepted" />
      </div>

      {toCollect.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>To collect</h2>
            <span className="field__hint">Balances on orders you have accepted, by buyer. Largest first.</span>
          </div>
          {toCollect.map((row) => (
            <div key={row.who.handle ?? row.who.name} className="ins__row">
              <span style={{ minWidth: 0 }}>
                <Person who={row.who} />
                <span className="faint"> · {row.orders} order{row.orders === 1 ? '' : 's'}</span>
              </span>
              <span className="badge badge--warn">{formatMoney(row.outstandingMinor, row.currency)}</span>
            </div>
          ))}
        </div>
      )}

      {pending.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Landed and not paid for</h2>
            <span className="field__hint">In India, waiting on money. Most owed first.</span>
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
