import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  CHECKPOINT_COUNT_LABELS, LOT_CARD_LABELS, STORE_PERMISSIONS, STORE_PERMISSION_LABELS,
  type StorePermission,
} from '@shared/enums';
import { countOf, type LotTally } from '@shared/board';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import type { SellerPaymentDetails, SellerProfile, StoreManager } from '@shared/models';
import type { StoreAccess } from '@shared/stores';
import {
  ApiRequestError,
  api,
  type DashboardResponse,
  type StorefrontDraft,
  type ActivityResponse,
  type BoardLot,
  type LotsBoard,
  type SaleRow,
} from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, Thumb, Tile } from '../components/ui';
import { PackingList } from './ExporterPage';
import { formatDate, formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

type Section = 'items' | 'payments' | 'tracking' | 'packing' | 'analytics' | 'storefront' | 'people';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'items', label: 'Items' },
  { id: 'payments', label: 'Payments' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'packing', label: 'Packing' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'storefront', label: 'Storefront' },
  { id: 'people', label: 'People' },
];

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

  if (stores.length === 0 && !opening) {
    return <ShopStart onOpen={() => setOpening(true)} />;
  }
  if (stores.length === 0) {
    return (
      <main className="page tab-view">
        <div className="page__head">
          <div>
            <h1>Open a storefront</h1>
            <p className="muted">
              A name, a picture and a line about what you sell. You can change all of it later.
            </p>
          </div>
        </div>
        <StorefrontEditor onSaved={() => { setOpening(false); void load(); }} />
      </main>
    );
  }

  return <ShopConsole stores={stores} onChanged={load} />;
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
      <div className="page__head">
        <div>
          <h1>Sell</h1>
          <p className="muted">Everything is listed from a storefront. Opening one takes a minute.</p>
        </div>
      </div>

      <div className="doors">
        <button type="button" className="door" onClick={onOpen}>
          <span className="door__glyph" aria-hidden="true">🏬</span>
          <span className="door__title">Open a storefront</span>
          <span className="door__note">
            A username buyers can find you at, a name they follow, lot tracking, analytics, and people
            you can bring in to help run it.
          </span>
        </button>
      </div>

      {/* Somebody may hold money for other people's trades without selling a
          thing themselves, and their console has to be reachable. */}
      {user?.escrowRights && (
        <Link to="/escrow" className="door" style={{ marginTop: 14 }}>
          <span className="door__glyph" aria-hidden="true">🔒</span>
          <span className="door__title">Escrow</span>
          <span className="door__note">
            Payments buyers have asked you to hold, and the disputes waiting on your decision.
          </span>
        </Link>
      )}

      <p className="notice notice--info" style={{ marginTop: 16 }}>
        Already helping run someone else's shop? It shows up here once they add you.
      </p>
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
  const [section, setSection] = useState<Section>('items');

  const store = stores.find((entry) => entry.ownerId === storeId) ?? stores[0]!;
  // A section nobody may open should not be offered: a tab that answers 403 is
  // worse than a tab that is not there.
  const visible = SECTIONS.filter((entry) => {
    if (entry.id === 'items') return store.permissions.includes('listings');
    // Answering for money is an owner's call, so it rides on the same right
    // the API checks rather than on a wider one.
    if (entry.id === 'payments') return store.permissions.includes('admin');
    if (entry.id === 'analytics') return store.permissions.includes('analytics');
    if (entry.id === 'tracking') return store.permissions.includes('lots');
    if (entry.id === 'packing') return store.permissions.includes('export');
    if (entry.id === 'storefront' || entry.id === 'people') return store.permissions.includes('admin');
    return true;
  });
  const active = visible.some((entry) => entry.id === section) ? section : visible[0]!.id;

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>{store.name}</h1>
          <p className="muted">
            {store.isOwner ? 'Your shop.' : 'You help run this shop.'}{' '}
            {store.permissions.length} of {STORE_PERMISSIONS.length} rights.
          </p>
        </div>
        <div className="row">
          {user?.escrowRights && (
            <Link to="/escrow" className="btn btn--ghost">🔒 Escrow</Link>
          )}
          {store.permissions.includes('listings') && (
            <Link to={`/sell?store=${encodeURIComponent(store.ownerId)}`} className="btn">
              <Icon name="plus" size={15} /> List an item
            </Link>
          )}
        </div>
      </div>

      {stores.length > 1 && (
        <label className="field" style={{ marginBottom: 14 }}>
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

      <div className="chips" style={{ marginBottom: 18 }}>
        {visible.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`chip${active === entry.id ? ' is-on' : ''}`}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Keyed so switching sections replays the entrance rather than swapping
          content underneath a static frame. */}
      <div className="tab-view" key={`${store.ownerId}:${active}`}>
        {active === 'items' && <MyItems store={store} />}
        {active === 'payments' && <Payments store={store} />}
        {active === 'tracking' && <Tracking store={store} />}
        {active === 'packing' && <PackingList storeId={store.ownerId} />}
        {active === 'analytics' && <Analytics />}
        {active === 'storefront' && <StorefrontEditor />}
        {active === 'people' && <People store={store} onChanged={onChanged} />}
      </div>
    </main>
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
            placeholder="What you sell, where you import from, how often you run a batch." rows={4} />
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

/** What is listed, and the way back to the batches that carry it. */
function MyItems({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .activity()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your listings.'),
      );
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  return (
    <div className="stack">
      {/* No second "list an item" here: the console header already carries it,
          and two of the same button on one screen is one too many. */}
      <div className="row">
        <Link to="/batches" className="btn btn--ghost btn--sm">Manage batches</Link>
      </div>

      {data.listings.length === 0 ? (
        <EmptyState title="Nothing listed yet">
          Everything you list goes out under {store.name}. It takes about a minute.
        </EmptyState>
      ) : (
        <div className="grid">
          {data.listings.map((listing) => (
            <Link key={listing.id} to={`/listing/${listing.id}`} className="card card--link">
              <Thumb seed={listing.id} label={listing.title}>
                <div className="thumb__badges">
                  <span className="badge badge--solid">{listing.condition}</span>
                </div>
              </Thumb>
              <div className="listing__body">
                <span className="listing__title">{listing.title}</span>
                <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
                <div className="listing__meta">
                  <span className="badge">{listing.lotId ? 'In a batch' : 'No batch'}</span>
                  <span className="faint">{listing.viewCount} views</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Tracking ───────────────────────────────────────────────────────────── */

/**
 * The lot board.
 *
 * One card per lot: who is in it, how much is in it, and how far each piece has
 * physically got. Every number is a count of orders past a checkpoint rather
 * than a state stored on the lot, because a crate does not arrive all at once -
 * thirty-three of thirty-four land and one is still with the supplier, and that
 * is exactly the thing worth seeing.
 */
/**
 * Payments a buyer says they have sent.
 *
 * A direct sale ends here: somebody transferred money outside this app and the
 * only person who can confirm it landed is the one whose account it landed in.
 * So this is a queue of decisions rather than a feed of notifications — what is
 * waiting on this shop first, then what it has already answered, because a
 * denial the seller regrets should still be findable afterwards.
 */
function Payments({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<{ waiting: SaleRow[]; answered: SaleRow[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.sales(store.ownerId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load payments.');
    }
  }, [store.ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  if (data.waiting.length === 0 && data.answered.length === 0) {
    return (
      <EmptyState title="No payments to check">
        When a buyer pays you directly and says so, it lands here for you to confirm.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {data.waiting.length > 0 && (
        <>
          <h2 style={{ margin: 0 }}>Waiting on you</h2>
          {data.waiting.map((row) => (
            <Link key={row.id} to={`/order/${row.id}`} className="card card--pad salerow">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{row.itemName}</div>
                <span className="faint">
                  {row.buyerName} · said paid {timeAgo(row.claim?.claimedAt ?? row.createdAt)}
                  {row.claim?.reference ? ` · ${row.claim.reference}` : ''}
                </span>
              </div>
              <div className="row" style={{ alignItems: 'center' }}>
                <strong>{formatMoney(row.totalMinor, row.currency)}</strong>
                <span className="badge badge--warn">check it</span>
              </div>
            </Link>
          ))}
        </>
      )}

      {data.answered.length > 0 && (
        <>
          <h2 style={{ marginBottom: 0 }}>Already answered</h2>
          {data.answered.map((row) => (
            <Link key={row.id} to={`/order/${row.id}`} className="card card--pad salerow">
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 650 }}>{row.itemName}</div>
                <span className="faint">
                  {row.buyerName} · {timeAgo(row.claim?.decidedAt ?? row.createdAt)}
                </span>
              </div>
              <div className="row" style={{ alignItems: 'center' }}>
                <strong>{formatMoney(row.totalMinor, row.currency)}</strong>
                <span className={`badge badge--${row.claim?.decision === 'accepted' ? 'ok' : 'warn'}`}>
                  {row.claim?.decision === 'accepted' ? 'received' : 'not received'}
                </span>
              </div>
            </Link>
          ))}
        </>
      )}
    </div>
  );
}

function Tracking({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<LotsBoard | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.lotsBoard(store.isOwner ? undefined : store.ownerId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your lots.');
    }
  }, [store.ownerId, store.isOwner]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;
  if (data.lots.length === 0) {
    return (
      <EmptyState title="No lots yet">
        A lot is one consignment. Open one from <Link to="/batches">Manage batches</Link>, or when you list
        an imported item.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {data.lots.map(({ lot, tally }) => (
        <LotCard key={lot.id} lot={lot} tally={tally} store={store} />
      ))}
    </div>
  );
}

/**
 * One lot at a glance.
 *
 * The open lot is worth the whole card; a lot already on its way is a single
 * line, because the thing you do with it is open it, not read it. The arrow is
 * the way in either way.
 */
function LotCard({ lot, tally, store }: { lot: BoardLot; tally: LotTally; store: StoreAccess }) {
  const working = lot.stage === 'ordering';
  const to = `/lot/${lot.id}${store.isOwner ? '' : `?store=${encodeURIComponent(store.ownerId)}`}`;

  if (!working) {
    return (
      <div className="lotcard lotcard--moving">
        <div className="lotcard__head">
          <span className="lotcard__name">{lot.name}</span>
          <span className="lotcard__state">{LOT_CARD_LABELS[lot.stage as keyof typeof LOT_CARD_LABELS]}</span>
        </div>
        <Link to={to} className="lotcard__go" aria-label={`Open ${lot.name}`}>→</Link>
      </div>
    );
  }

  return (
    <div className="lotcard">
      <div className="lotcard__head">
        <span className="lotcard__name">{lot.name}</span>
        <span className="lotcard__state">
          {LOT_CARD_LABELS[lot.stage as keyof typeof LOT_CARD_LABELS]} — {tally.orders} orders
        </span>
        <Link to={to} className="lotcard__go" aria-label={`Open ${lot.name}`}>→</Link>
      </div>

      <div className="lotcard__body">
        <div className="tiles tiles--big">
          <Tile value={String(tally.customers)} label="Customers" />
          <Tile value={String(tally.orders)} label="Orders" />
        </div>

        <div className="tiles">
          <Tile value={String(countOf(tally, 'ready_to_dispatch').done)} label="Ready to dispatch" tone="blue" />
          <Tile value={String(countOf(tally, 'packed').done)} label="Packed" tone="blue" />
          <Tile value={`${tally.customersDispatched}/${tally.customers}`} label="Dispatched" tone="green" />
        </div>

        <div className="bars">
          {tally.progress.map((row) => (
            <div key={row.checkpoint} className="bar">
              <span className="bar__label">{CHECKPOINT_COUNT_LABELS[row.checkpoint]}</span>
              <span className="bar__track">
                <span
                  className="bar__fill"
                  style={{ width: `${row.total === 0 ? 0 : (row.done / row.total) * 100}%` }}
                />
              </span>
              <span className="bar__count">{row.done}/{row.total}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Analytics ──────────────────────────────────────────────────────────── */

/** The numbers worth checking, and nothing that cannot be acted on. */
function Analytics() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .dashboard()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your analytics.'),
      );
  }, []);

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
    </div>
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
