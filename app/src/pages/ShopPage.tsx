import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import {
  STORE_PERMISSIONS, STORE_PERMISSION_LABELS,
  type StorePermission,
} from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import { countryFlag } from '@shared/countries';
import { CONDITION_TAGS, SOURCING_LABELS, type Sourcing } from '@shared/enums';
import { lotIsDone, lotPhase, sourcingOf } from '@shared/fulfilment';
import { preOrderView } from '@shared/preorder';
import { listingRarity } from '@shared/quest';
import { LotName, LotPhaseBadge, lotLabel } from '../components/LotName';
import { useUndo } from '../components/Undo';
import { RarityRibbon, XpBar } from '../components/Quest';
import { ShipmentChip, StatusBanner, sellerStatus } from '../components/OrderStatus';
import { LBox, OptionTiles } from '../components/ListingForm';
import { preLotRouteOf, type PostTemplate } from '@shared/templates';
import type { CardButton } from '@shared/buttons';
import { ReceivedDialog } from '../components/ReceivedDialog';
import { SerialButtons } from '../components/SerialButtons';
import { Ladder } from '../components/Ladder';
import { RoutesList } from './RoutesPage';
import { RouteStudio } from './RouteStudioPage';
import {
  BUILT_IN_ROUTE, currentStepOf as currentStepOfLot, lotOffset as lotOffsetOf, preSteps as preStepsOf,
  lotNo, lotNumberFrom, renderStepText, routeOf as routeOfLot,
} from '@shared/routes';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import type { BuyerReversalDetails, Listing, Lot, SellerPaymentDetails, SellerProfile, StoreManager } from '@shared/models';
import { REFUND_ORIGIN_LABELS, isExpired } from '@shared/payments';
import { AdvanceStrip, DropTag, EditListingDialog, ExpiryChip, StockChip } from '../components/Buy';
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
  type LotSummary,
  type LotsResponse,
  type SaleRow,
  type SalesResponse,
  type ShopCredit,
  type RefundableOrder,
  type RoutesResponse,
} from '../api';
import { ItemHead } from '../components/ItemHead';
import { Avatar, EmptyState, ErrorNotice, Icon, type IconName, Modal, Thumb, leadPhoto } from '../components/ui';
import { PowerSalePanel } from '../components/PowerSale';
import { SkeletonText, useToast } from '../components/Feedback';
import { InsightsPanel } from './InsightsPanel';
import { ProfitCalculator } from './ProfitCalculator';
import { SalesPanel } from './SalesPanel';
import { PackingList } from './SupplierPage';
import { LotDetail, NewLotForm } from './LotsPage';
import {
  currencySymbol, formatDateOrdinal, formatMoney, formatTotals, formatWeight, fromMinor, timeAgo, toMinor,
} from '../format';
import { useSession } from '../session';
import { Svg } from '../components/ListingBlocks';
import { CalcIcon } from '../components/CalcIcon';
import { EarnPill, earnOf } from '../components/Affiliate';

type Section = 'items' | 'payments' | 'insights' | 'calculator' | 'refunds' | 'lots' | 'routes' | 'packing' | 'analytics' | 'storefront' | 'people';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'items', label: 'Items' },
  // Payments was too narrow a name for what this screen does: money is one of
  // six things an order needs answering about, and the other five had nowhere
  // to live. The id stays `payments` - it is the identity, and renaming it
  // would only be a way to break the rights that reference it.
  { id: 'payments', label: 'Orders' },
  // Who saved what, who stopped at Buy, and how items convert - the Pro tab.
  { id: 'insights', label: 'Insights' },
  // Landed cost and margin on the seller's own rates - Pro, beside Insights.
  { id: 'calculator', label: 'Calculator' },
  // Every amount owed back to a buyer - overpaid, cancelled, or a refund the
  // seller starts - in one place, set apart on the right of the same row.
  { id: 'refunds', label: 'Refunds' },
  { id: 'lots', label: 'Lots' },
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
        <RouteStudio
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
        Let Pip ask you a few questions, or start from a shape close to yours — everything in it
        is editable — or skip and do it later from Sell → Routes.
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
          {<Icon name="lock" size={13} />} Open the Buyer Protection console instead
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
      // A sub-view belongs to the tab it was opened in, and so does an order
      // waiting to be filed into a lot about to be opened.
      copy.delete('view');
      copy.delete('file');
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
          {<Icon name="lock" size={13} />} Buyer Protection
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
              {entry.id === 'calculator' && <CalcIcon size={16} />}
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
    /* Once a section is open the cards shrink to one line each, so on a
       phone what was picked starts near the top instead of below the fold. */
    <div className={`stack${active ? ' sellhome--compact' : ''}`}>
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
  /* The chips as typed, commas, spaces and all. Parsing them on every
     keystroke threw away a comma or a trailing space the moment it was
     typed, so a second chip - or a two-word one - could only be pasted in. */
  const [chipsText, setChipsText] = useState('');

  useEffect(() => {
    void api
      .storefront()
      .then((result) => {
        setSaved(result.storefront);
        setChipsText((result.storefront?.tags ?? []).join(', '));
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
      const result = await api.saveStorefront({ ...draft!, tags: chipsOf(chipsText) });
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
          <span className="field__hint">A link to an image of your shop or logo.</span>
        </label>

        <label className="field">
          <span>Banner</span>
          <input value={draft.coverUrl ?? ''} onChange={(e) => set('coverUrl', e.target.value)}
            placeholder="https://…" inputMode="url" />
          <span className="field__hint">
            The band behind your name, as a link to an image, same as the picture.
          </span>
        </label>

        <label className="field">
          <span>Chips</span>
          <input value={chipsText} onChange={(e) => setChipsText(e.target.value)}
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
          {/* The chips as they will be saved, so the cap of six shows before saving. */}
          {chipsOf(chipsText).length > 0 && (
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              {chipsOf(chipsText).map((chip) => <span key={chip} className="badge badge--quiet">{chip}</span>)}
            </div>
          )}
          <div className="row">
            <span className="badge">{saved?.tier ?? 'unverified'}</span>
            <span className="faint">{saved?.followerCount ?? 0} followers</span>
          </div>
        </div>
      </aside>
    </div>
  );
}

/** Typed chips as the server keeps them: trimmed, deduplicated, at most six of 24 characters. */
function chipsOf(text: string): string[] {
  return [...new Set(text.split(',').map((chip) => chip.trim()).filter(Boolean))]
    .map((chip) => chip.slice(0, 24))
    .slice(0, 6);
}

/* ── Items ──────────────────────────────────────────────────────────────── */

/** What is listed, and the way back to the lots that carry it. */
function MyItems({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<{ listings: Listing[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Add to a power sale" from a saved calculation lands here, with it.
  const saleCalcs = (useLocation().state as { saleCalcs?: SavedCalc[] } | null)?.saleCalcs;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'stock' | 'power' | 'templates'>(
    saleCalcs?.length || params.get('view') === 'power' ? 'power' : 'stock');
  const [shelf, setShelf] = useState<'available' | 'expired' | 'sold_out'>('available');
  const [editing, setEditing] = useState<Listing | null>(null);
  /** An import listing being pointed at a lot, from its own card. */
  const [tagging, setTagging] = useState<Listing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .myListings()
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
          <span className="door__glyph" aria-hidden="true"><Icon name="tag" size={19} /></span>
          <span className="door__title">List an item</span>
          <span className="door__note">One thing, up for anyone browsing.</span>
        </Link>

        <button type="button" className="door door--pro"
          onClick={() => navigate(`/shop/power-sale?store=${encodeURIComponent(store.ownerId)}`)}>
          <span className="probadge door__flag">PRO</span>
          <span className="door__glyph" aria-hidden="true">{<Icon name="bolt" size={19} />}</span>
          <span className="door__title">Start power selling</span>
          <span className="door__note">A whole sale, on a timer, in your channel.</span>
        </button>
      </div>

      <div className="segwrap">
        <SegTabs label="Items view" value={mode} onChange={setMode} tabs={[
          { id: 'stock', label: 'Your stock', count: all.length },
          { id: 'power', label: 'Scheduled sales' },
          { id: 'templates', label: 'Quick Fill' },
        ]} />
        {mode === 'stock' && data && (
          <SegTabs ext label="Shelf" value={shelf} onChange={setShelf} tabs={[
            { id: 'available', label: 'Available', count: counts.available },
            { id: 'expired', label: 'Expired', count: counts.expired },
            { id: 'sold_out', label: 'Sold out', count: counts.sold_out },
          ]} />
        )}
      </div>

      {notice && <p className="notice notice--ok" role="status">{notice}</p>}

      {mode === 'templates' ? (
        <TemplatesPanel store={store} />
      ) : mode === 'power' ? (
        <PowerSalePanel storeId={store.ownerId} startWith={saleCalcs} />
      ) : !data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          {mine.length === 0 && (
            <EmptyState title={shelf === 'expired' ? 'Nothing expired 🎉' : shelf === 'sold_out' ? 'Nothing sold out' : 'Nothing listed yet'}>
              {shelf === 'available'
                ? `Everything you list goes out under ${store.name}. It takes about a minute.`
                : 'Items land here on their own and can be brought back from here.'}
            </EmptyState>
          )}
          {/* The same collectible card buyers see on the Buy tab, so a shop
              reads its shelf the way its customers do - rarity included. */}
          <div className="grid qgrid">
            {mine.map((listing) => (
              <ShelfCard key={listing.id} listing={listing} onEdit={() => setEditing(listing)}
                onOpenLot={(lotId) => navigate(`/shop?tab=lots&lot=${encodeURIComponent(lotId)}`)}
                onTag={() => { setNotice(null); setTagging(listing); }} />
            ))}
          </div>
        </>
      )}
      {editing && (
        <EditListingDialog listing={editing} onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }} />
      )}
      {tagging && (
        <ListingIntoLot listing={tagging} store={store} onClose={() => setTagging(null)}
          onDone={(said) => { setTagging(null); setNotice(said); load(); }} />
      )}
    </div>
  );
}

/**
 * One of the shop's own listings as a Quest loot card: framed in its rarity,
 * the condition stamped on, with the shop's own numbers - stock, views,
 * saves, lot - where a buyer would see the seller's crest.
 */
function ShelfCard({ listing, onEdit, onOpenLot, onTag }: {
  listing: Listing;
  onEdit: () => void;
  /** Open the lot this listing's sales go into. */
  onOpenLot: (lotId: string) => void;
  /** Point an import with no lot at one. */
  onTag: () => void;
}) {
  const rarity = listingRarity(listing);
  const tier = rarity.tier;
  const view = listing.preOrder ? preOrderView(listing.preOrder) : null;
  const sourcing = sourcingOf(listing);
  const expired = isExpired(listing);
  return (
    <Link to={`/listing/${listing.id}`} className={`qloot qloot--${tier ?? 'plain'}`}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb qloot__art">
        {tier && <RarityRibbon tier={tier} />}
        <span className="qgrade" title="Condition">{listing.condition}</span>
        {expired
          ? <span className="qsticker-tag qsticker-tag--drop">Expired</span>
          : listing.status === 'sold_out'
            ? <span className="qsticker-tag qsticker-tag--drop">Sold out</span>
            : listing.preOrder && <span className="qsticker-tag">Pre-order</span>}
        <DropTag on={listing.channelDrop} />
      </Thumb>
      <AdvanceStrip percent={listing.advancePercent} />

      <div className="qloot__body">
        <span className="qloot__title">{listing.title}</span>
        <span className="pricerow">
          <span className="qloot__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
          <EarnPill amountMinor={earnOf(listing)} currency={listing.currency} />
        </span>
        <span className="qloot__meta">
          <b className={sourcing === 'in_hand' ? 'qok' : ''}>{SOURCING_LABELS[sourcing]}</b>
          {' · '}{listing.category}
        </span>
        <StockChip listing={listing} />
        <ExpiryChip listing={listing} />

        {view && (
          <span className="qloot__lv">
            <span className="qloot__lvlabel">LV {view.committed}/{view.fillThreshold}</span>
            <XpBar progress={view.committed / view.fillThreshold} tone={tier === 'legendary' ? 'gold' : 'violet'} />
          </span>
        )}
        {rarity.reasons.length > 0 && (
          <span className="qloot__why">{rarity.reasons.slice(0, 2).join(' · ')}</span>
        )}

        <span className="qloot__foot">
          <span className="faint"><Svg name="views" size={13} /> {listing.viewCount} · ♥ {listing.likeCount ?? 0}</span>
          {/* Only an import travels in a lot, so only an import says so -
              and the badge is the way there: to its lot, or into one. */}
          {listing.lotId ? (
            <button type="button" className="badge badge--link"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onOpenLot(listing.lotId!); }}>
              📦 Open its lot
            </button>
          ) : sourcing === 'import' ? (
            <button type="button" className="badge badge--quiet badge--link"
              onClick={(event) => { event.preventDefault(); event.stopPropagation(); onTag(); }}>
              ＋ Add to a lot
            </button>
          ) : null}
        </span>
        <button type="button" className="btn btn--ghost btn--sm shelf__edit"
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); onEdit(); }}>
          {expired ? '✨ Make available again' : '✏️ Edit'}
        </button>
      </div>
    </Link>
  );
}

/** What a seller can be looking for on this screen. */
type OrderFilter = 'all' | 'answer' | 'nolot';

/** Done, either because the buyer confirmed it or because the seller ticked
 *  it delivered on the lot's own item list - either one is the same fact. */
function isCompleted(row: SaleRow): boolean {
  return !isClosed(row) && (row.status === 'delivered' || Boolean(row.deliveredAt));
}

/** Called off for good - turned down, cancelled, or cancelled with the money sent back. */
function isClosed(row: SaleRow): boolean {
  return row.status === 'rejected' || row.status === 'cancelled' || row.status === 'cancelled_reversed';
}

type OrderState = 'active' | 'completed' | 'closed';

function stateOf(row: SaleRow): OrderState {
  return isClosed(row) ? 'closed' : isCompleted(row) ? 'completed' : 'active';
}

const ORDER_STATE_LABELS: Record<OrderState, string> = {
  active: 'Active',
  completed: 'Completed',
  closed: 'Cancelled',
};

const ORDER_STATE_ICONS: Record<OrderState, string> = {
  active: '🔥',
  completed: '✅',
  closed: '🚫',
};

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
export function Orders({ store, lotId, onChanged, onTracking }: {
  store: StoreAccess;
  /**
   * One lot's orders only, worked customer by customer - the lot's own
   * Customers & Orders section. The cards are these same cards, so the two
   * screens can never disagree about what an order needs.
   */
  lotId?: string;
  /** Something here moved the lot or an item in it: the lot screen re-reads its header. */
  onChanged?: () => void;
  /** Where "check the items in" goes when this is drawn inside the lot. */
  onTracking?: () => void;
}) {
  const [data, setData] = useState<SalesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<SaleRow | null>(null);
  const [cancelling, setCancelling] = useState<SaleRow | null>(null);
  const [filing, setFiling] = useState<SaleRow | null>(null);
  /** Said once something is filed, so the order leaving the list is not a mystery. */
  const [notice, setNotice] = useState<string | null>(null);
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
  /** Delivered is done, called off is closed; everything else is still being worked. */
  const statusFilter: OrderState = (['completed', 'closed'] as const)
    .find((entry) => entry === params.get('state')) ?? 'active';
  const setParam = (key: string, value: string) => setParams((current) => {
    const copy = new URLSearchParams(current);
    copy.set(key, value);
    return copy;
  }, { replace: true });
  const setFilter = (next: OrderFilter) => setParam('show', next);
  const setStatusFilter = (next: OrderState) => setParam('state', next);
  const here = `${location.pathname}${location.search}`;
  const focusOrder = (location.state as { focusOrder?: string } | null)?.focusOrder ?? null;
  const [glowing, setGlowing] = useState<string | null>(null);
  /*
   * Inside a lot, each customer folds to one line. The whole-list choice is
   * remembered on this device, because a seller who likes it folded likes it
   * folded every time; a customer opened on its own is just for now.
   */
  const [allOpen, setAllOpenState] = useState<boolean>(() => readCustomersOpen());
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({});
  const setAllOpen = (open: boolean) => {
    setAllOpenState(open);
    setOpenOverride({});
    writeCustomersOpen(open);
  };

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
    /* It was drawn open to be found; keep it open once the request is forgotten. */
    const row = data.orders.find((entry) => entry.id === focusOrder);
    if (row) setOpenOverride((current) => ({ ...current, [customerKey(row)]: true }));
    navigate(here, { replace: true, state: null });
    const timer = window.setTimeout(() => setGlowing(null), 1800);
    return () => window.clearTimeout(timer);
  }, [data, focusOrder, here, navigate]);

  /** A press can be taken back for three minutes, from the undo bar. */
  const offerUndo = useUndo();

  /**
   * The order's next button, pressed from its card - or undone. The card's
   * next button comes from the server, read off the same route its timeline
   * draws, so the list is read again rather than guessed at here.
   */
  /** The order whose warehouse button was pressed with no lot to say what that means. */
  const [receiving, setReceiving] = useState<{ row: SaleRow; button: CardButton } | null>(null);

  async function refresh() {
    await load();
    onChanged?.();
  }

  async function press(row: SaleRow, button: CardButton, on: boolean, label?: string) {
    /* No lot yet: ask where it was received, or offer to put it in a lot. */
    if (on && button.checkpoint === 'china_received' && !row.lotId && !row.inHand && label === undefined) {
      setReceiving({ row, button });
      return;
    }
    setBusy(row.id);
    setError(null);
    try {
      const result = await api.setCheckpoint(row.id, button.checkpoint, on, label ? { label } : undefined);
      setReceiving(null);
      const undo = result.undo;
      if (undo) {
        offerUndo({
          label: `${row.itemName}: ${button.label}${on ? '' : ' (undone)'}`,
          until: undo.until,
          undo: async () => { await api.setCheckpoint(row.id, button.checkpoint, !on, undefined, undo.id); },
          onUndone: () => void refresh(),
        });
      }
      await refresh();
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
  /* Inside a lot, the book is that lot's orders and nothing else. */
  const book = lotId ? data.orders.filter((row) => row.lotId === lotId) : data.orders;
  const scoped = book.filter((row) => stateOf(row) === statusFilter);
  /* The "All / To answer / No lot" split only means anything for active
     orders - a completed or cancelled one needs nothing answered and rides
     no lot search. */
  const toAnswer = scoped.filter((row) => needsAnswer.has(row.id));
  const withoutLot = scoped.filter((row) => row.awaitingLot);
  /* "No lot" means nothing inside a lot, where every order has one. */
  /* Inside a lot "To answer" only shows while something needs answering, so
     with nothing left to answer the list falls back to everything. */
  const chip = lotId && (filter === 'nolot' || (filter === 'answer' && toAnswer.length === 0)) ? 'all' : filter;
  const shown = statusFilter !== 'active' || chip === 'all'
    ? scoped
    : chip === 'answer' ? toAnswer : withoutLot;
  const countOfState = (state: OrderState) => book.filter((row) => stateOf(row) === state).length;
  /* One customer at a time, inside a lot: a parcel goes to a person, not to a
     line item, so that is how a lot is worked. */
  const customers = lotId ? byCustomer(shown) : null;
  const isOpen = (customer: CustomerGroup) =>
    openOverride[customer.key] ?? (allOpen || customer.rows.some((row) => row.id === focusOrder));
  const everyOpen = customers ? customers.every(isOpen) : true;

  const card = (row: SaleRow, index: number) => (
    <OrderRow
      key={row.id}
      index={index}
      row={row}
      store={store}
      from={here}
      inLot={Boolean(lotId)}
      glowing={glowing === row.id}
      busy={busy === row.id}
      needsAnswer={needsAnswer.has(row.id)}
      onPress={(button, on) => void press(row, button, on)}
      onLotTracking={() => (onTracking
        ? onTracking()
        : navigate(`/shop?tab=lots&lot=${encodeURIComponent(row.lotId ?? '')}&view=tracking`))}
      onFile={() => setFiling(row)}
      onReject={() => setRejecting(row)}
      onAccept={() => void accept(row)}
      onCancel={() => setCancelling(row)}
      onSettleReceived={() => void settleReceived(row)}
      onSettleDenied={() => setDenyingClaim(row)}
    />
  );

  if (lotId && book.length === 0) {
    return (
      <EmptyState title="Nobody in this lot yet">
        Customers and their orders appear here as orders are added to this lot.
      </EmptyState>
    );
  }

  if (book.length === 0) {
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
      {notice && <p className="notice notice--ok" role="status">{notice}</p>}

      {lotId && <LotPulse rows={book} />}

      {/* Three big tiles for where orders are, each in its own colour, then
          chips for what an active order needs - the one that needs the
          seller lights up when anything is in it. */}
      {lotId ? (
        /* Inside a lot, one row: where orders are, the answer chip only when
           there is something to answer, and the switch that folds every customer. */
        <div className="ofilters">
          <div className="segwrap">
            <SegTabs label="Order status" value={statusFilter} onChange={setStatusFilter}
              tabs={(['active', 'completed', 'closed'] as const).map((entry) => ({
                /* An empty bucket says so by having no count: room is short on a phone. */
                id: entry, label: ORDER_STATE_LABELS[entry], count: countOfState(entry) || undefined,
              }))} />
          </div>
          {statusFilter === 'active' && toAnswer.length > 0 && (
            <button type="button" className={`ofilters__answer${chip === 'answer' ? ' is-on' : ''}`}
              aria-pressed={chip === 'answer'} aria-label={`To answer: ${toAnswer.length}`} title="To answer"
              onClick={() => setFilter(chip === 'answer' ? 'all' : 'answer')}>
              <Icon name="bell" size={14} /> <b>{toAnswer.length}</b>
            </button>
          )}
          {customers && customers.length > 0 && (
            <button type="button" className="ofilters__fold" aria-pressed={everyOpen}
              aria-label={everyOpen ? 'Collapse all customers' : 'Expand all customers'}
              title={everyOpen ? 'Collapse all' : 'Expand all'}
              onClick={() => setAllOpen(!everyOpen)}>
              <Icon name={everyOpen ? 'up' : 'down'} size={16} />
            </button>
          )}
        </div>
      ) : <div className="segwrap">
        <SegTabs label="Order status" value={statusFilter} onChange={setStatusFilter}
          tabs={(['active', 'completed', 'closed'] as const).map((entry) => ({
            id: entry, label: <><span className="segtab__icon">{ORDER_STATE_ICONS[entry]}</span> {ORDER_STATE_LABELS[entry]}</>, count: countOfState(entry),
          }))} />
        {statusFilter === 'active' && (
          <SegTabs ext label="Which orders" value={chip} onChange={setFilter} tabs={[
            { id: 'all', label: 'All', count: scoped.length },
            { id: 'answer', label: 'To answer', count: toAnswer.length, hot: toAnswer.length > 0 },
            { id: 'nolot' as const, label: 'No lot', count: withoutLot.length },
          ]} />
        )}
      </div>}

      {shown.length === 0 ? (
        <div className="oempty">
          <span className="oempty__icon" aria-hidden="true">
            {statusFilter === 'completed' ? '📬' : statusFilter === 'closed' ? '🕊️'
              : chip === 'answer' ? '🎉' : chip === 'nolot' ? '✅' : '🛍️'}
          </span>
          <b className="oempty__title">
            {statusFilter === 'completed'
              ? 'Nothing delivered yet'
              : statusFilter === 'closed'
                ? 'Nothing cancelled or turned down'
                : chip === 'answer'
                  ? 'All caught up!'
                  : chip === 'nolot' ? 'Every order is in a lot' : 'No active orders right now'}
          </b>
          <span className="faint">
            {statusFilter === 'completed'
              ? 'Orders land here once they reach the buyer.'
              : statusFilter === 'closed'
                ? 'Good news — every order is still going.'
                : chip === 'answer'
                  ? 'Nothing is waiting on you.'
                  : chip === 'nolot' ? 'Nothing is waiting to be filed.' : 'New orders show up here the moment someone buys.'}
          </span>
        </div>
      ) : customers ? (
        <div className="ocusts">
          <span className="ocusts__count faint">
            {customers.length} {customers.length === 1 ? 'customer' : 'customers'} · {shown.length}{' '}
            {shown.length === 1 ? 'order' : 'orders'}
          </span>
          {customers.map((customer) => (
            <CustomerOrders key={customer.key} customer={customer}
              open={isOpen(customer)} needsAnswer={needsAnswer}
              onToggle={(open) => setOpenOverride((current) => ({ ...current, [customer.key]: open }))}>
              {customer.rows.map((row, index) => card(row, customer.start + index))}
            </CustomerOrders>
          ))}
        </div>
      ) : (
        <div className="orows">
          {shown.map((row, index) => card(row, index))}
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

      {receiving && (
        <ReceivedDialog itemName={receiving.row.itemName} busy={busy === receiving.row.id}
          onLot={() => { setFiling(receiving.row); setReceiving(null); }}
          onPick={(label) => void press(receiving.row, { ...receiving.button, label }, true, label)}
          onClose={() => setReceiving(null)} />
      )}

      {filing && (
        <FileIntoLot
          row={filing}
          store={store}
          onClose={() => setFiling(null)}
          onDone={(said) => { setFiling(null); setNotice(said); void refresh(); }}
        />
      )}
    </div>
  );
}

/**
 * A lot at a glance, above its customers: how many people and orders, the
 * money still out, how far along the route the orders have got step by step,
 * and which couriers took the ones already sent.
 */
function LotPulse({ rows }: { rows: readonly SaleRow[] }) {
  const live = rows.filter((row) => !isClosed(row));
  const people = new Set(live.map(customerKey)).size;
  const money = (pick: (row: SaleRow) => number) =>
    formatTotals(live.map((row) => ({ amountMinor: pick(row), currency: row.currency })), live[0]?.currency);
  const pendingCount = live.filter((row) => row.outstandingMinor > 0).length;
  const valueMinor = live.reduce((acc, row) => acc + row.totalMinor, 0);
  const paidMinor = live.reduce((acc, row) => acc + Math.min(row.paidMinor, row.totalMinor), 0);
  const paidShare = valueMinor > 0 ? Math.min(100, Math.round((paidMinor / valueMinor) * 100)) : 0;

  /* Every order in a lot rides the same route, so one order's line of
     buttons names the steps and each order's own line says which are done.
     Only the orders' own presses: the lot's moves are said on Tracking. */
  const template = live.find((row) => row.serial && row.serial.length > 0)?.serial ?? [];
  const steps = template.flatMap((button, index) => button.kind === 'lot' ? [] : [{
    label: button.label,
    done: live.filter((row) => row.serial?.[index]?.done).length,
  }]);

  const couriers = new Map<string, number>();
  for (const row of live) {
    const name = row.shipment?.courier?.trim();
    if (name) couriers.set(name, (couriers.get(name) ?? 0) + 1);
  }

  return (
    <section className="lpulse" aria-label="This lot at a glance">
      {/* The lot in one line, then the money as a bar: what has landed, and what is still out. */}
      <div className="lpulse__sum">
        <span className="lpulse__line">
          <b>{people}</b> {people === 1 ? 'customer' : 'customers'} · <b>{live.length}</b>{' '}
          {live.length === 1 ? 'order' : 'orders'} · <b>{money((row) => row.totalMinor)}</b>
        </span>
        <div className="ocard__bar" aria-hidden="true"><span style={{ width: `${paidShare}%` }} /></div>
        <span className="lpulse__pay">
          <span><b>{money((row) => Math.min(row.paidMinor, row.totalMinor))}</b> paid</span>
          {pendingCount > 0
            ? <span className="is-due"><b>{money((row) => row.outstandingMinor)}</b> pending · {pendingCount}</span>
            : live.length > 0 && <span className="is-clear">✓ All paid</span>}
        </span>
      </div>

      {steps.length > 0 && live.length > 0 && (
        <ol className="lpulse__route" aria-label="Orders at each step">
          {steps.map((step, index) => {
            const share = Math.round((step.done / live.length) * 100);
            const state = step.done === live.length ? 'all' : step.done > 0 ? 'some' : 'none';
            return (
              <li key={index} className={`lpulse__step lpulse__step--${state}`}
                title={`${step.label}: ${step.done} of ${live.length} orders`}>
                <span className="lpulse__ring" style={{ '--p': `${share}%` } as CSSProperties}>
                  <span>{state === 'all' ? '✓' : step.done}</span>
                </span>
                <span className="lpulse__stepname">{step.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {couriers.size > 0 && (
        <div className="lpulse__couriers">
          <small>Sent with</small>
          {[...couriers].sort((a, b) => b[1] - a[1]).map(([name, count]) => (
            <span key={name} className="lpulse__courier">🚚 {name} <b>{count}</b></span>
          ))}
        </div>
      )}
    </section>
  );
}

/** One customer's orders in a lot, and what they come to between them. */
interface CustomerGroup {
  key: string;
  buyer: PartyRef;
  rows: SaleRow[];
  /** Where this customer's first card sits in the whole list, for the stagger. */
  start: number;
}

/* A buyer with no handle is still one person: their name keeps them together. */
function customerKey(row: SaleRow): string {
  return row.buyer.handle ?? `name:${row.buyer.name}`;
}

/** Whether a lot's customers start open, as last chosen on this device. */
const CUSTOMERS_OPEN_KEY = 'figmark.lot.customersOpen';

function readCustomersOpen(): boolean {
  try {
    return window.localStorage.getItem(CUSTOMERS_OPEN_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeCustomersOpen(open: boolean) {
  try {
    window.localStorage.setItem(CUSTOMERS_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* Private mode or blocked storage: the choice lasts as long as the screen. */
  }
}

/** Orders grouped by who bought them, in the order each customer first appears. */
function byCustomer(rows: readonly SaleRow[]): CustomerGroup[] {
  const groups = new Map<string, CustomerGroup>();
  for (const row of rows) {
    const key = customerKey(row);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, buyer: row.buyer, rows: [row], start: 0 });
  }
  let start = 0;
  return [...groups.values()].map((group) => {
    const placed = { ...group, start };
    start += group.rows.length;
    return placed;
  });
}

/**
 * Where one order has got to, in a word or two, for its customer's folded
 * line: called off, delivered, or the furthest step pressed on its route.
 */
function shortStep(row: SaleRow): string {
  if (isClosed(row)) return ORDER_STATE_LABELS.closed;
  if (isCompleted(row)) return 'Delivered';
  if (row.done) return row.done.label;
  if (row.bookingOnly && !row.accepted) return 'Booked';
  return 'Not started';
}

/**
 * One customer, as the head of their own little stack of order cards: who they
 * are, how many orders, and the money across all of them - what they come to,
 * what has landed, and what is still pending - so a seller packing their parcel
 * knows whether to chase before it goes out.
 *
 * Folded, it is two lines: the customer with their order count and what is
 * pending, then each order's name and where it has got to - enough to scan a
 * whole lot without the cards.
 */
function CustomerOrders({ customer, open, needsAnswer, onToggle, children }: {
  customer: CustomerGroup;
  open: boolean;
  needsAnswer: ReadonlySet<string>;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  const { buyer, rows } = customer;
  /* Called-off orders owe nothing; they are listed but not counted. */
  const live = rows.filter((row) => !isClosed(row));
  const sum = (pick: (row: SaleRow) => number) =>
    live.map((row) => ({ amountMinor: pick(row), currency: row.currency }));
  const total = live.reduce((acc, row) => acc + row.totalMinor, 0);
  const paid = live.reduce((acc, row) => acc + Math.min(row.paidMinor, row.totalMinor), 0);
  const pending = live.reduce((acc, row) => acc + row.outstandingMinor, 0);
  const share = total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0;
  const currency = rows[0]?.currency;
  const tone = live.length === 0 ? 'quiet' : pending > 0 ? (paid > 0 ? 'purple' : 'warn') : 'ok';
  const panelId = `ocust-${customer.key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;

  return (
    <section className={`ocust ocust--${tone}${open ? ' is-open' : ' is-folded'}`}>
      <header className={`ocust__head${open ? '' : ' ocust__head--slim'}`}>
        <button type="button" className="ocust__fold" aria-expanded={open} aria-controls={panelId}
          aria-label={`${open ? 'Collapse' : 'Expand'} ${buyer.name}'s orders`}
          onClick={() => onToggle(!open)}>
          <Icon name={open ? 'down' : 'right'} size={16} />
        </button>
        {open && <Avatar name={buyer.name} size={40} />}
        <div className="ocust__who">
          {buyer.handle
            ? <Link to={`/${buyer.handle}`} className="ocust__name">{buyer.name}</Link>
            : <span className="ocust__name">{buyer.name}</span>}
          <span className="ocust__meta">
            {rows.length} {rows.length === 1 ? 'order' : 'orders'}
            {rows.length !== live.length && ` · ${rows.length - live.length} called off`}
          </span>
        </div>
        <div className="ocust__total">
          {open && <b>{formatTotals(sum((row) => row.totalMinor), currency)}</b>}
          <span className={`badge badge--${tone === 'quiet' ? 'accent' : tone}`}>
            {live.length === 0
              ? 'Nothing owed'
              : pending > 0
                ? <>Pending{!open && ` ${formatTotals(sum((row) => row.outstandingMinor), currency)}`}</>
                : 'All paid'}
          </span>
        </div>
      </header>

      {!open && (
        /* Each order on one line: a dot in its money colour, its name, and its step. */
        <div className="ocust__line" onClick={() => onToggle(true)}>
          {rows.map((row) => {
            const { tone: rowTone, label } = orderTone(row, needsAnswer.has(row.id));
            const step = shortStep(row);
            return (
              <span key={row.id} className={`ocust__chip ocust__chip--${rowTone}`}
                title={`${row.itemName} · ${step} · ${label}`}>
                <i aria-hidden="true" />
                <span className="ocust__chipname">{row.itemName}</span>
                <span className="ocust__chipstep">{step}</span>
              </span>
            );
          })}
        </div>
      )}

      {open && (
        <div id={panelId} className="ocust__body">
          {/* All paid says itself in the badge; the breakdown is for when money is still out. */}
          {live.length > 0 && pending > 0 && (
            <div className="ocust__money">
              <div className="ocard__bar" aria-hidden="true"><span style={{ width: `${share}%` }} /></div>
              <div className="ocust__sums">
                <span><small>Orders</small><b>{formatTotals(sum((row) => row.totalMinor), currency)}</b></span>
                <span><small>Paid</small><b>{formatTotals(sum((row) => Math.min(row.paidMinor, row.totalMinor)), currency)}</b></span>
                <span className={pending > 0 ? 'is-due' : 'is-clear'}>
                  <small>Pending</small>
                  <b>{formatTotals(sum((row) => row.outstandingMinor), currency)}</b>
                </span>
              </div>
            </div>
          )}
          <div className="orows">{children}</div>
        </div>
      )}
    </section>
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
    if (!window.confirm(`Delete the template "${template.name}"? Items already listed from it keep what it filled in.`)) return;
    setBusy(template.id);
    setError(null);
    try {
      await api.deleteTemplate(template.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not delete.');
    } finally {
      setBusy(null);
    }
  }

  // Only a first load that fails has nothing to show; a failed delete says so
  // above the list and leaves the list where it is.
  if (error && templates === null) return <ErrorNotice message={error} />;
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
      {error && <ErrorNotice message={error} />}
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
              {template.kind === 'power' && <span className="probadge">⚡ Power · PRO</span>}
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
              {template.kind === 'power' ? (
                <Link to={`/shop/power-sale?store=${encodeURIComponent(store.ownerId)}`} className="btn btn--quiet btn--sm">Use in a power sale</Link>
              ) : (
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setEditing(template)}>
                  Edit
                </button>
              )}
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
  }, [store.ownerId, store.isOwner]);

  /* "Write a route" opens in a new tab so this half-written template is not
     lost; coming back to this one reads the routes again, so the new route is
     there to pick. */
  useEffect(() => {
    const readRoutes = () => void api.routes().then(setRoutes).catch(() => setRoutes(null));
    readRoutes();
    const onVisible = () => { if (!document.hidden) readRoutes(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

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
    <form className="sellform" onSubmit={submit}>
      <h2 style={{ margin: 0 }}>{template ? 'Edit template' : 'New template'}</h2>

      <LBox icon="⚡" title="Template" hint="What you pick it by. Buyers never see it.">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Template name"
          placeholder="Marvel Standard" required autoFocus />
      </LBox>

      <LBox icon="🏷️" title="The item" hint="Everything here stays editable on every listing.">
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
          <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="Marvel, Action figure, 1/12" />
        </label>
        <label className="field">
          <span>Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
            placeholder={'Original Marvel Legends figure.\nCondition: MISB.'} />
        </label>
      </LBox>

      <LBox icon="🚚" title="Ships from">
        <OptionTiles label="What this template lists" value={sourcing} onChange={setSourcing}
          options={[
            { id: 'in_hand', icon: '🏠', title: 'In hand', note: 'Ships from your shelf' },
            { id: 'import', icon: '✈️', title: 'Import', note: 'Travels in a lot' },
          ]} />
        <label className="field">
          <span>Default lot</span>
          <select value={defaultLotId} onChange={(e) => setDefaultLotId(e.target.value)}>
            <option value="">No lot — filed after it sells</option>
            {lots.map(({ lot }) => (
              <option key={lot.id} value={lot.id}>
                {lotLabel(lot)}
              </option>
            ))}
          </select>
        </label>
      </LBox>

      {/* One route, not two ladders. The route already says where the item
          stops travelling alone, so both halves come from the same list and
          cannot contradict each other the way two written ones did. */}
      <LBox icon="🧭" title="Tracking" hint="The journey a buyer of this item follows.">
        <select value={lotRouteId} onChange={(e) => setLotRouteId(e.target.value)} aria-label="Route">
          <option value="">
            {routes ? `${routes.builtIn.name} — ${routes.builtIn.steps.length} steps` : 'Loading…'}
          </option>
          {(routes?.routes ?? []).map((route) => (
            <option key={route.id} value={route.id}>
              {route.name} — {route.steps.length} steps
            </option>
          ))}
        </select>
        <span className="lbox__hint">
          None fit? <Link to="/routes/studio/new" target="_blank" rel="noopener">Write a route</Link> (new tab).
        </span>
        <div className="field">
          <span>Before it joins a lot</span>
          <Ladder steps={before} current={-1} />
          <span className="field__hint">
            {before.length === 0
              ? 'No steps before the lot — the buyer waits with no timeline until one is opened.'
              : `The other ${chosen.steps.length - before.length} steps arrive with the lot.`}
          </span>
        </div>
      </LBox>

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

/** The two presses a buyer is told about, which ask before they happen. */
const LAST_MILE = new Set<string>(['dispatched', 'delivered']);

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
  index, row, store, from, inLot = false, glowing, busy, needsAnswer, onPress, onLotTracking, onFile, onReject,
  onAccept, onCancel, onSettleReceived, onSettleDenied,
}: {
  index: number;
  row: SaleRow;
  store: StoreAccess;
  /** Where this list is, so the order page can come back to exactly here. */
  from: string;
  /**
   * Drawn inside its own lot, under its customer's head: the buyer and the
   * lot are already said above it, so the card does not say them again.
   */
  inLot?: boolean;
  glowing: boolean;
  busy: boolean;
  needsAnswer: boolean;
  onPress: (button: CardButton, on: boolean) => void;
  /** The Lot stop on this card's buttons: opens the lot's Tracking, where the crate is moved. */
  onLotTracking: () => void;
  onFile: () => void;
  onReject: () => void;
  onAccept: () => void;
  onCancel: () => void;
  onSettleReceived: () => void;
  onSettleDenied: () => void;
}) {
  const awaitingClaim = Boolean(row.claim && row.claim.decision === null);
  /* The lot's own page, the same place its Lot button on the route line opens. */
  const lotHref = row.lotId ? `/shop?tab=lots&lot=${encodeURIComponent(row.lotId)}` : null;
  /* Something to press: not called off, and not a booking still waiting to be taken on. */
  const working = !isClosed(row) && !(row.bookingOnly && !row.accepted);
  const { tone, label } = orderTone(row, needsAnswer);
  /* Fully paid and nothing extra: the badge says it, the bar would only repeat it. */
  const settled = row.outstandingMinor <= 0 && row.paidMinor > 0 && row.creditMinor <= 0;
  const paidShare = row.totalMinor > 0 ? Math.min(100, Math.round((row.paidMinor / row.totalMinor) * 100)) : 0;
  const orderLink = { pathname: `/order/${row.id}` };
  const linkState = { from };
  const statusLine = sellerStatus({
    placed: true,
    status: row.status,
    paymentStatus: row.paymentStatus,
    bookingOnly: row.bookingOnly,
    accepted: row.accepted,
    canPay: false,
    claimDenied: false,
    outstandingMinor: row.outstandingMinor,
    currency: row.currency,
    dispatched: Boolean(row.dispatchedAt) || row.status === 'shipped',
    shipment: row.shipment,
    receivedAt: null,
    inHand: row.inHand,
    disputed: row.escrowState === 'disputed',
    claimOpen: awaitingClaim,
  });

  return (
    <article id={`order-${row.id}`}
      className={`ocard ocard--${tone}${needsAnswer ? ' is-urgent' : ''}${glowing ? ' is-glowing' : ''}${busy ? ' is-busy' : ''}`}
      style={{ '--i': Math.min(index, 12) } as CSSProperties}>
      <ItemHead id={row.id} name={row.itemName} photoUrl={row.photoUrl} to={orderLink.pathname} state={linkState}
        badges={row.privateDeal && <span className="badge badge--pink">🤝 Private deal</span>}
        meta={<>
          {!inLot && (row.buyer.handle
            ? <Link to={`/${row.buyer.handle}`} className="ocard__buyer">{row.buyer.name}</Link>
            : <span className="ocard__buyer">{row.buyer.name}</span>)}
          {!inLot && <span aria-hidden="true">·</span>}
          <span>{timeAgo(row.createdAt)}</span>
          {row.quantity > 1 && <><span aria-hidden="true">·</span><span>×{row.quantity}</span></>}
        </>}
        side={<>
          <b>{formatMoney(row.totalMinor, row.currency)}</b>
          <span className={`badge badge--${tone === 'quiet' ? 'accent' : tone}`}>{label}</span>
        </>} />

      {/* The money, as a bar rather than a sentence: how much of this has
          actually landed. Once it is all in, the Paid badge already says so. */}
      {!settled && <div className="ocard__money">
        <div className="ocard__bar" aria-hidden="true"><span style={{ width: `${paidShare}%` }} /></div>
        <div className="ocard__moneytext">
          <span><b>{formatMoney(row.paidMinor, row.currency)}</b> paid</span>
          {row.outstandingMinor > 0
            ? <span><b>{formatMoney(row.outstandingMinor, row.currency)}</b> left</span>
            : row.paidMinor > 0 && <span className="ocard__done">✨ Fully paid</span>}
          {row.creditMinor > 0 && <span className="ocard__extra">💰 {formatMoney(row.creditMinor, row.currency)} extra</span>}
        </div>
      </div>}

      {/* The one line on where it stands. A claimed payment already has its
          own line below, with the amount and the reference. */}
      {statusLine && !awaitingClaim && !(row.serial && statusLine.tone === 'ok') && (
        <StatusBanner line={statusLine} compact />
      )}

      {/* In hand: no lot and no warehouse, so what it needs is a courier. */}
      {row.inHand && (
        <div className="ocard__chips">
          <span className="ocard__chip ocard__chip--ok">🏠 In hand</span>
          {row.shipment
            ? <ShipmentChip shipment={row.shipment} />
            : row.dispatchedAt && (
              <Link to={orderLink} state={linkState} className="ocard__chip ocard__chip--none">➕ Add courier & AWB</Link>
            )}
        </div>
      )}

      {/* Which lot it rides and where that lot is - one chip. Inside the lot
          it is said above, and the route line below says what is done. */}
      {!row.inHand && !inLot && (lotHref || !isClosed(row)) && (
        <div className="ocard__chips">
          {lotHref
            ? (
              <Link to={lotHref} className="ocard__chip ocard__chip--lot">
                <span className="ocard__chipname">📦 {row.lotName ?? `LOT ${lotNo(row.lotNumber)}`}</span>
                {row.lotName && row.lotNumber ? <span className="lotname__no">LOT {lotNo(row.lotNumber)}</span> : null}
                {/* Delivered is where this item ended, whatever the crate did after. */}
                {isCompleted(row)
                  ? <span className="ocard__chipstep ocard__chipstep--ok">· ✓ Delivered</span>
                  : row.lotStep && <span className="ocard__chipstep">· {row.lotStep}</span>}
              </Link>
            )
            : <span className="ocard__chip ocard__chip--none">No lot yet</span>}
          {!row.serial && row.done && <span className="ocard__chip ocard__chip--ok">✓ {row.done.label}</span>}
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

      {/* In a lot: the route's buttons and the lot's moves, one after another. */}
      {working && row.serial && row.serial.length > 0 && (
        <SerialButtons
          buttons={row.serial}
          busy={busy}
          who={{ itemName: row.itemName, buyerName: row.buyer.name }}
          onItem={(key, on) => {
            const button = row.serial!.find((entry) => entry.kind === 'item' && entry.key === key);
            onPress({ checkpoint: key, label: button?.label ?? key, step: button?.step ?? key }, on);
          }}
          onLot={onLotTracking}
          orderLink={{ to: `/order/${row.id}`, state: linkState }}
          stepOf={row.routeStep}
        />
      )}

      <div className="ocard__acts">
        {/* A domestic sale never goes near a warehouse and never joins a lot,
            and one that has been called off is not going anywhere at all. */}
        {/* The one press this order is waiting on, in its route's words - the
            same button its timeline shows. The two that tell the buyer
            something (dispatched, delivered) open the order, where they ask
            for the courier or a confirmation first. */}
        {working && !row.serial && row.next && (LAST_MILE.has(row.next.checkpoint) ? (
          <Link to={orderLink} state={{ ...linkState, act: row.next.checkpoint }} className="ocard__next"
            aria-label={`${row.next.label} - opens the order to confirm`}>
            <span aria-hidden="true">⚡</span> {row.next.label}
          </Link>
        ) : (
          <button type="button" className="ocard__next" disabled={busy}
            title={`Press when this has happened: ${row.next.step}`}
            onClick={() => onPress(row.next!, true)}>
            <span aria-hidden="true">⚡</span> {row.next.label}
          </button>
        ))}
        {working && !row.serial && !row.next && row.waitingOnLot && (
          <span className="ocard__wait">🚢 Moves with the lot</span>
        )}
        {!row.inHand && !isClosed(row) && !lotHref && (
          <button type="button" className="orow__toggle" aria-label="Add this order to a lot" onClick={onFile}>
            <Icon name="plus" size={13} />
            <span>Lot</span>
          </button>
        )}
        <Link to={`/listing/${row.listingId}`} className="ocard__view" aria-label="See the listing as it was listed">
          <Svg name="open" size={13} /> Listing
        </Link>
        <span className="ocard__spacer" />
        {row.canCancel && !awaitingClaim && (
          <button type="button" className="ocard__x" aria-label="Cancel this order" disabled={busy} onClick={onCancel}>
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
  // Per currency: a shop selling in two never sees them added together.
  const owed = formatTotals(data.credits.map((credit) => ({ amountMinor: credit.leftMinor, currency: credit.currency })));
  const sent = formatTotals(data.refundHistory
    .filter((entry) => entry.kind === 'refund' && entry.status === 'received')
    .map((entry) => ({ amountMinor: entry.amountMinor, currency: entry.currency })));

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}

      <section className="rfhero">
        <div className="rfhero__main">
          <small>Still to refund</small>
          <b>{owed}</b>
          <span>
            {deciding.length} to decide · {waiting.length} waiting on the buyer · {sent} refunded so far
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
  const [inPerson, setInPerson] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = credit.status === 'refund_pending';
  const chosen = credit.targets.find((entry) => entry.orderId === target);
  const typedMinor = toMinor(amount);
  const cap = mode === 'apply' && chosen ? Math.min(credit.leftMinor, chosen.outstandingMinor) : credit.leftMinor;

  function open(next: 'refund' | 'apply') {
    setMode(next);
    setError(null);
    setReference('');
    setShot(null);
    setInPerson(false);
    // Filled with what is owed, and editable: refund less and the rest stays here.
    if (next === 'refund') {
      setAmount(fromMinor(credit.leftMinor));
      setMessage('');
    } else {
      const first = credit.targets[0];
      setTarget(first?.orderId ?? '');
      setAmount(first ? fromMinor(Math.min(credit.leftMinor, first.outstandingMinor)) : '');
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
            <>
              <InPersonTick checked={inPerson} onChange={setInPerson} buyerName={credit.buyer.name} />
              {!inPerson && (
                <PayoutDetails orderId={credit.orderId} buyerName={credit.buyer.name}
                  details={credit.buyerDetails} check={credit.detailsCheck} onChanged={onChanged} />
              )}
            </>
          )}
          {mode === 'apply' && (
            <label className="field">
              <span>Put it towards</span>
              <select value={target} onChange={(e) => {
                setTarget(e.target.value);
                const next = credit.targets.find((entry) => entry.orderId === e.target.value);
                if (next) setAmount(fromMinor(Math.min(credit.leftMinor, next.outstandingMinor)));
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
            <span>Amount ({currencySymbol(credit.currency)})</span>
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
              <ProofFields inPerson={inPerson} reference={reference} onReference={setReference}
                shot={shot} onShot={setShot} />
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
                || (mode === 'refund' && ((!reference.trim() && !shot)
                  || (!inPerson && !payoutReady(credit.buyerDetails, credit.detailsCheck))))}
              onClick={() => void run(mode, () => (mode === 'refund'
                ? api.refundCredit(credit.orderId, {
                    creditId: credit.creditId, amountMinor: typedMinor, screenshotUrl: shot ?? undefined,
                    reference: reference.trim() || undefined, message: message.trim() || undefined,
                    inPerson,
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
      ? 'Before I refund you, please check your payment reversal details are up to date (My wallet → Payment reversal details) and confirm them, or update them if anything has changed.'
      : 'I need to refund you. Please add your payment reversal details (My wallet → Payment reversal details) so I know where to send it.');
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

/**
 * Money handed back across a counter rather than sent to an account.
 *
 * Without it a buyer who never added payout details could never be recorded
 * as refunded, however the money actually went back. The buyer still confirms
 * it arrived, the same as any other refund.
 */
function InPersonTick({ checked, onChange, buyerName }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  buyerName: string;
}) {
  return (
    <label className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ marginTop: 3 }} />
      <span>
        <span style={{ fontSize: 'var(--t-sm)' }}>Handed back in person (cash)</span>
        <span className="field__hint" style={{ display: 'block' }}>
          No account needed. {buyerName} is still asked to confirm they got it.
        </span>
      </span>
    </label>
  );
}

/** The proof a refund carries: a transfer's id and screenshot, or a note of the hand-over. */
function ProofFields({ inPerson, reference, onReference, shot, onShot }: {
  inPerson: boolean;
  reference: string;
  onReference: (next: string) => void;
  shot: string | null;
  onShot: (next: string | null) => void;
}) {
  if (inPerson) {
    return (
      <label className="field">
        <span>When and where</span>
        <input value={reference} onChange={(e) => onReference(e.target.value)}
          placeholder="Cash at the Sunday meet, 14 Sept" />
        <span className="field__hint">What the buyer will recognise when asked to confirm it.</span>
      </label>
    );
  }
  return (
    <>
      <label className="field">
        <span>Transaction id (UTR)</span>
        <input value={reference} onChange={(e) => onReference(e.target.value)} placeholder="e.g. 412345678901" />
      </label>
      <div className="field">
        <span>Screenshot of the transfer</span>
        <ProofPicker value={shot} onChange={onShot} />
        <span className="field__hint">The transaction id or a screenshot - at least one of the two.</span>
      </div>
    </>
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
  const [inPerson, setInPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chosen = refundable.find((entry) => entry.orderId === orderId);
  const typedMinor = toMinor(amount);

  async function submit() {
    if (!chosen) return;
    setBusy(true);
    setError(null);
    try {
      await api.startRefund(chosen.orderId, {
        amountMinor: typedMinor, reason: reason.trim(), screenshotUrl: shot ?? undefined,
        reference: reference.trim() || undefined, message: message.trim() || undefined,
        inPerson,
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
            <select value={orderId} onChange={(e) => { setOrderId(e.target.value); setAmount(''); }}>
              <option value="">Choose an order…</option>
              {refundable.map((entry) => (
                <option key={entry.orderId} value={entry.orderId}>
                  {entry.buyer.name} — {entry.itemName} (up to {formatMoney(entry.refundableMinor, entry.currency)})
                </option>
              ))}
            </select>
          </label>
          {chosen && (
            <>
              <InPersonTick checked={inPerson} onChange={setInPerson} buyerName={chosen.buyer.name} />
              {!inPerson && (
                <PayoutDetails orderId={chosen.orderId} buyerName={chosen.buyer.name}
                  details={chosen.buyerDetails} check={chosen.detailsCheck} onChanged={onChanged} />
              )}
            </>
          )}
          <label className="field">
            <span>Amount ({currencySymbol(chosen?.currency)})</span>
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
          <ProofFields inPerson={inPerson} reference={reference} onReference={setReference}
            shot={shot} onShot={setShot} />
          <label className="field">
            <span>Message to the buyer</span>
            <textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional — a standard note is sent if you leave this empty." />
          </label>
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <button type="button" className="btn btn--ok"
              disabled={busy || !chosen || typedMinor <= 0 || typedMinor > (chosen?.refundableMinor ?? 0)
                || reason.trim().length < 3 || (!reference.trim() && !shot)
                || (!inPerson && !payoutReady(chosen?.buyerDetails ?? null, chosen?.detailsCheck ?? null))}
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
 * Point an import listing at a lot, from its own card: every order of it from
 * now on goes straight into that lot. Orders already placed and waiting are
 * filed too, so nothing sold before this is left behind.
 */
function ListingIntoLot({ listing, store, onClose, onDone }: {
  listing: Listing;
  store: StoreAccess;
  onClose: () => void;
  onDone: (said: string) => void;
}) {
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [lotId, setLotId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots(store.isOwner ? undefined : store.ownerId)
      .then((result) => {
        const open = result.lots.filter((entry) => !lotIsDone(entry.lot));
        setLots(open);
        if (open.length === 1) setLotId(open[0]!.lot.id);
      })
      .catch(() => setLots([]));
  }, [store.ownerId, store.isOwner]);

  const picked = lots?.find((entry) => entry.lot.id === lotId)?.lot ?? null;

  async function submit() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await api.assignToLot(picked.id, [listing.id]);
      // Anything of it already sold and waiting goes in the same lot.
      const waiting = (await api.lotCandidates(picked.id)).items
        .filter((item) => item.listingId === listing.id).map((item) => item.id);
      if (waiting.length > 0) await api.addItemsToLot(picked.id, waiting);
      const name = lotLabel(picked);
      onDone(`${listing.title} now goes into ${name}${waiting.length > 0
        ? `, with the ${waiting.length === 1 ? 'order' : `${waiting.length} orders`} already waiting` : ''}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Add ${listing.title} to a lot`} onClose={onClose}>
      <div className="stack">
        <span className="field__hint">
          Every order of this listing goes straight into the lot you pick.
        </span>
        {lots === null ? (
          <p className="muted">Loading…</p>
        ) : lots.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            No lots open yet. <Link to="/shop?tab=lots&spotlight=new" onClick={onClose}>Create one</Link> first.
          </p>
        ) : (
          <fieldset className="pickset">
            <legend>Choose a lot</legend>
            {lots.map(({ lot }) => (
              <label key={lot.id} className={`pick${lotId === lot.id ? ' is-on' : ''}`}>
                <input type="radio" name="tag-lot" checked={lotId === lot.id} onChange={() => setLotId(lot.id)} />
                <span className="pick__body">
                  <span className="pick__name"><LotName name={lot.name} number={lot.lotNumber} /></span>
                  <span className="faint" style={{ fontSize: 'var(--t-xs)' }}>
                    {lot.route?.name ?? 'Generic route'} · now: {lotStepLabel(lot)}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {error && <ErrorNotice message={error} />}
        <button type="button" className="btn btn--block" disabled={busy || !picked} onClick={() => void submit()}>
          {busy ? 'Adding…' : picked ? 'Add to lot' : 'Pick a lot first'}
        </button>
      </div>
    </Modal>
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
  /** Handed what to tell the seller, now the order has left this list. */
  onDone: (said: string) => void;
}) {
  const navigate = useNavigate();
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [lotId, setLotId] = useState('');
  /* The listing goes along by default when it feeds no lot yet: the next
     sale of it then lands in this lot without anybody filing it. */
  const [feed, setFeed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.myLots(store.isOwner ? undefined : store.ownerId)
      .then((result) => {
        // Only lots still open to orders: a finished one is never offered.
        const open = result.lots.filter((entry) => !lotIsDone(entry.lot));
        setLots(open);
        if (open.length === 1) setLotId(open[0]!.lot.id);
      })
      .catch(() => setLots([]));
  }, [store.ownerId, store.isOwner]);

  /* The order goes along, so the lot opened there has this order filed into it
     and the seller comes straight back to the order - rather than opening the
     lot and then having to find the order again. */
  function goCreateLot() {
    onClose();
    navigate(`/shop?tab=lots&spotlight=new&file=${encodeURIComponent(row.id)}`);
  }

  const picked = lots?.find((entry) => entry.lot.id === lotId)?.lot ?? null;

  async function submit() {
    if (!picked) return;
    setBusy(true);
    setError(null);
    try {
      await api.assignOrderToLot(row.id, { lotId });
      let fed = false;
      if (feed) {
        // Best effort: the order is filed either way, which is what was asked.
        fed = await api.assignToLot(lotId, [row.listingId]).then(() => true, () => false);
      }
      const name = lotLabel(picked);
      onDone(`${row.itemName} is in ${name}.${fed ? ' New orders of this listing will go straight in too.' : ''}`);
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
            One of your open lots, or a new one. The order joins at the step the lot is on.
          </span>

          {lots === null ? (
            <p className="muted">Loading…</p>
          ) : lots.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>No lots open yet. Create one below.</p>
          ) : (
            lots.map(({ lot }) => (
              <label key={lot.id} className={`pick${lotId === lot.id ? ' is-on' : ''}`}>
                <input type="radio" name="lot" checked={lotId === lot.id}
                  onChange={() => setLotId(lot.id)} />
                <span className="pick__body">
                  <span className="pick__name">
                    <LotName name={lot.name} number={lot.lotNumber} />
                  </span>
                  <span className="faint" style={{ display: 'grid', gap: 4, marginTop: 6, fontSize: 'var(--t-xs)' }}>
                    <span>
                      {lot.originCountry || lot.destinationCountry
                        ? `${countryFlag(lot.originCountry)} ${lot.originCountry ?? '?'} → ${countryFlag(lot.destinationCountry)} ${lot.destinationCountry ?? '?'}`
                        : 'Countries not set'}
                    </span>
                    <span>{lot.route?.name ?? 'Generic route'} · now: {lotStepLabel(lot)}</span>
                  </span>
                </span>
              </label>
            ))
          )}
        </fieldset>

        <button type="button" className="silkcta" onClick={goCreateLot}>
          <span className="silkcta__label">✨ Create a new lot</span>
          <span className="silkcta__note">Opens the lots tab, and adds this order to it once saved</span>
        </button>

        <label className="tick">
          <input type="checkbox" checked={feed} onChange={(event) => setFeed(event.target.checked)} />
          <span>Send future orders of this listing straight into this lot</span>
        </label>

        {error && <ErrorNotice message={error} />}
        <button type="button" className="btn btn--block"
          disabled={busy || !picked}
          onClick={() => void submit()}>
          {busy ? 'Adding…' : picked ? 'Add to lot' : 'Pick a lot first'}
        </button>
      </div>
    </Modal>
  );
}

/** Where a lot is, in a word or two, for a picker: filling, or the step it is on. */
function lotStepLabel(lot: Lot): string {
  const route = routeOfLot(lot);
  const at = currentStepOfLot(lot);
  if (at < lotOffsetOf(route)) return 'filling';
  return renderStepText(route.steps[at]?.name ?? 'filling', { origin: lot.originCountry, destination: lot.destinationCountry });
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
  const navigate = useNavigate();
  /*
   * Which lot is open lives in the URL, like the tab does, so a lot is a place
   * that can be linked to. An order's timeline sends its seller straight here
   * to move the lot on, and "go to Track, find the lot, open it" is not a
   * thing anybody should be told to do from a screen that knows which lot.
   */
  const [params, setParams] = useSearchParams();
  const openId = params.get('lot');
  /** An order sent here from Orders to be filed into the lot about to be opened. */
  const fileOrder = params.get('file');
  const [creating, setCreating] = useState(Boolean(fileOrder));

  /* The lot is open; put the order that asked for it inside, and take the
     seller back to that order on the Orders screen. */
  async function created(lot: Lot) {
    setCreating(false);
    if (!fileOrder) {
      void load();
      return;
    }
    try {
      await api.assignOrderToLot(fileOrder, { lotId: lot.id });
      navigate('/shop?tab=payments', { replace: true, state: { focusOrder: fileOrder } });
    } catch (err) {
      dropFileOrder();
      // Read first: a reload clears the error, and this one has to stay up.
      await load();
      setError(err instanceof ApiRequestError
        ? `The lot is open, but the order was not filed into it: ${err.message}`
        : 'The lot is open, but the order was not filed into it.');
    }
  }
  const dropFileOrder = () =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      copy.delete('file');
      return copy;
    }, { replace: true });
  const setOpenId = (next: string | null) =>
    setParams((current) => {
      const copy = new URLSearchParams(current);
      if (next) copy.set('lot', next);
      else copy.delete('lot');
      copy.delete('view');
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
    return (
      <LotDetail lotId={openId} onBack={() => { setOpenId(null); void load(); }}
        customers={({ onChanged, onTracking }) => (
          <Orders store={store} lotId={openId} onChanged={onChanged} onTracking={onTracking} />
        )} />
    );
  }

  if (error && !data) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  /* Closed or fully delivered is done - the same rule the server uses to stop
     filing orders into a lot or moving it. */
  const filtered = data.lots.filter((entry) =>
    statusFilter === 'completed' ? lotIsDone(entry.lot) : !lotIsDone(entry.lot));

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}
      {creating ? (
        <NewLotForm
          onDone={(lot) => void created(lot)}
          onCancel={() => { setCreating(false); dropFileOrder(); }}
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

      {/* Orders sold, bound for a lot, and in none - the ones actually
          waiting on the seller. One tap takes them to that list. */}
      {data.awaitingOrders > 0 && (
        <div className="note-row">
          <div style={{ minWidth: 0 }}>
            <span className="card__title">
              {data.awaitingOrders === 1 ? '1 order is' : `${data.awaitingOrders} orders are`} waiting for a lot
            </span>
            <span className="faint">Their buyers see no shipment tracking until they are in one.</span>
          </div>
          <button type="button" className="btn btn--sm" onClick={() => navigate('/shop?tab=payments&show=nolot')}>
            Add to a lot
          </button>
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
                <LotCard key={summary.lot.id} summary={summary} onOpen={() => setOpenId(summary.lot.id)} />
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

/** A country as a card says it: its flag, or a question mark for one not set. */
function flagOf(country: string | null | undefined): string {
  return country ? countryFlag(country) : '?';
}

/** How long the lid takes to swing open before the lot itself is shown. */
const LID_OPEN_MS = 460;

/**
 * One consignment, drawn as the box it is: a coloured lid with a strip of
 * tape over a carton that says what is inside. Small enough for two on a
 * phone's row; the whole box opens the lot, lid first.
 */
function LotCard({ summary, onOpen }: {
  summary: LotSummary;
  onOpen: () => void;
}) {
  const { lot, tally } = summary;
  const hue = hueOf(lot.id);
  const phase = lotPhase(lot);
  const number = lotNo(lot.lotNumber) ?? lotNumberFrom(lot.id, lot.createdAt);
  // Packed out of everything in it: the one bar that says how ready the box is.
  const packed = tally.progress.find((row) => row.checkpoint === 'china_packed');
  const share = packed && packed.total > 0 ? packed.done / packed.total : 0;
  const [opening, setOpening] = useState(false);

  function open() {
    if (opening) return;
    const still = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) { onOpen(); return; }
    setOpening(true);
    window.setTimeout(onOpen, LID_OPEN_MS);
  }

  return (
    <article role="button" tabIndex={0} aria-label={`Open ${lot.name}`}
      className={`lotbox lotbox--${hue}${opening ? ' is-opening' : ''}`}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      }}>
      <span className="lotbox__glow" aria-hidden="true" />
      <span className="lotbox__lid" aria-hidden="true">
        <span className="lotbox__tape" />
      </span>
      <div className="lotbox__body">
        <span className="lotbox__name">{lot.name}</span>
        <span className="lotbox__meta">
          <span className="lotname__no">LOT {number}</span>
          {(lot.originCountry || lot.destinationCountry) && (
            <span className="lotbox__lane">
              {flagOf(lot.originCountry)} → {flagOf(lot.destinationCountry)}
            </span>
          )}
        </span>
        <LotPhaseBadge phase={phase} />
        <span className="lotbox__count">
          {summary.orderCount} {summary.orderCount === 1 ? 'order' : 'orders'} · {tally.customers} {tally.customers === 1 ? 'buyer' : 'buyers'}
        </span>
        {summary.orderCount > 0 && (
          <span className="lotbox__bar" title={`${packed?.done ?? 0} of ${packed?.total ?? 0} packed`}>
            <span style={{ width: `${share * 100}%` }} />
          </span>
        )}
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
  /** The day tapped on the chart - touch has no hover to show it on. */
  const [picked, setPicked] = useState<string | null>(null);

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
  const dayLabel = (day: (typeof analytics.daily)[number]) =>
    `${formatDateOrdinal(day.date)}: ${formatMoney(day.revenueMinor)} from ${day.orders} order${day.orders === 1 ? '' : 's'}`;
  const pickedDay = analytics.daily.find((day) => day.date === picked) ?? null;

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
          <span className="field__hint">Revenue per day. Tap a bar for that day.</span>
        </div>
        <div className="spark">
          {analytics.daily.map((day) => (
            <span
              key={day.date}
              role="button"
              tabIndex={0}
              aria-pressed={picked === day.date}
              aria-label={dayLabel(day)}
              className={`spark__bar${day.revenueMinor === 0 ? ' spark__bar--empty' : ''}`}
              style={{
                height: `${Math.max(4, (day.revenueMinor / peak) * 100)}%`,
                cursor: 'pointer',
                outline: picked === day.date ? '2px solid currentColor' : undefined,
              }}
              title={dayLabel(day)}
              onClick={() => setPicked((current) => (current === day.date ? null : day.date))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setPicked((current) => (current === day.date ? null : day.date));
                }
              }}
            />
          ))}
        </div>
        <span className="field__hint" aria-live="polite">
          {pickedDay ? dayLabel(pickedDay) : 'Nothing picked.'}
        </span>
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

  /** Whether it worked, so the caller only clears what was typed when it did. */
  async function run(fn: () => Promise<{ managers: StoreManager[] }>, message: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      setManagers((await fn()).managers);
      setFlash(message);
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not work.');
      return false;
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
            ).then((ok) => { if (ok) setIdentifier(''); })
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
                  onClick={() => {
                    if (!window.confirm(`Remove ${manager.displayName} from this shop? They lose every right here at once.`)) return;
                    void run(
                      () => api.updateManager({ storeId: store.ownerId, identifier: manager.userId, remove: true }),
                      'Removed.',
                    );
                  }}>
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

/**
 * A full-width row of tabs sharing one track. `ext` is the row under it -
 * narrower, lighter and joined on, so it reads as the first row opened up.
 */
function SegTabs<T extends string>({ label, value, onChange, tabs, ext = false }: {
  label: string;
  value: T;
  onChange: (next: T) => void;
  tabs: { id: T; label: ReactNode; count?: number; hot?: boolean }[];
  ext?: boolean;
}) {
  return (
    <div className={`segtabs${ext ? ' segtabs--ext' : ''}`} role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" aria-selected={value === tab.id}
          className={`segtab${value === tab.id ? ' is-on' : ''}${tab.hot ? ' segtab--hot' : ''}`}
          onClick={() => onChange(tab.id)}>
          <span className="segtab__label">{tab.label}</span>
          {tab.count !== undefined && <span className="segtab__n">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}
