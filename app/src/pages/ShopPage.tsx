import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SellerProfile } from '@shared/models';
import {
  ApiRequestError,
  api,
  type DashboardResponse,
  type StorefrontDraft,
  type ActivityResponse,
} from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, Thumb } from '../components/ui';
import { formatDate, formatMoney } from '../format';
import { useSession } from '../session';

type Section = 'storefront' | 'items' | 'tracking' | 'analytics';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'storefront', label: 'Storefront' },
  { id: 'items', label: 'Items' },
  { id: 'tracking', label: 'Tracking' },
  { id: 'analytics', label: 'Analytics' },
];

/**
 * Everything about selling, in one place.
 *
 * Listing, batches, the storefront and the numbers were four destinations
 * reached from four different places. They are one job done in one sitting, so
 * they are now one tab with sections rather than four entries competing for
 * space in a navigation bar.
 */
export function ShopPage() {
  const [section, setSection] = useState<Section>('storefront');

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Your shop</h1>
          <p className="muted">Your storefront, what you have listed, what is moving, and how it is doing.</p>
        </div>
        <Link to="/sell" className="btn">
          <Icon name="plus" size={15} /> List an item
        </Link>
      </div>

      <div className="chips" style={{ marginBottom: 18 }}>
        {SECTIONS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`chip${section === entry.id ? ' is-on' : ''}`}
            onClick={() => setSection(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* Keyed so switching sections replays the entrance rather than swapping
          content underneath a static frame. */}
      <div className="tab-view" key={section}>
        {section === 'storefront' && <StorefrontEditor />}
        {section === 'items' && <MyItems />}
        {section === 'tracking' && <Tracking />}
        {section === 'analytics' && <Analytics />}
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
function StorefrontEditor() {
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
          bio: result.storefront?.bio ?? '',
          dispatchRegion: result.storefront?.dispatchRegion ?? '',
          photoUrl: result.storefront?.photoUrl ?? '',
          link: result.storefront?.link ?? '',
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

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const result = await api.saveStorefront(draft!);
      setSaved(result.storefront);
      setFlash('Storefront saved.');
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
          <span className="field__hint">
            What buyers see instead of your own name. {saved?.storefrontSlug && <>Address: <code>/s/{saved.storefrontSlug}</code></>}
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

        {flash && <p className="notice notice--ok">{flash}</p>}
        {error && <ErrorNotice message={error} />}

        <button type="submit" className="btn btn--lg" disabled={busy || !draft.storefrontName?.trim()}>
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
function MyItems() {
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
      <div className="row">
        <Link to="/batches" className="btn btn--ghost btn--sm">Manage batches</Link>
        <Link to="/sell" className="btn btn--sm"><Icon name="plus" size={14} /> List an item</Link>
      </div>

      {data.listings.length === 0 ? (
        <EmptyState title="Nothing listed yet">
          Your first listing creates your storefront. It takes about a minute.
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

/** What is in flight right now, and where each batch has got to. */
function Tracking() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.dashboard());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your tracking.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const { tracking } = data;

  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Open batches" value={String(tracking.openLots)} />
        <Stat label="Orders in flight" value={String(tracking.inFlightOrders)} note="Not yet delivered" />
      </div>

      {tracking.lots.length === 0 ? (
        <EmptyState title="Nothing in flight">
          Open a batch from <Link to="/batches">Manage batches</Link>, or when you list an imported item.
        </EmptyState>
      ) : (
        <div className="card">
          {tracking.lots.map((lot) => (
            <Link key={lot.id} to="/batches" className="channel">
              <div className="channel__body">
                <div className="channel__top">
                  <span className="channel__name">{lot.name}</span>
                  <span className="badge">{lot.stage.replace(/_/g, ' ')}</span>
                </div>
                <span className="channel__last">
                  {[
                    lot.origin || null,
                    `${lot.orderCount} order${lot.orderCount === 1 ? '' : 's'}`,
                    lot.estimatedDispatchAt ? `dispatch ${formatDate(lot.estimatedDispatchAt)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {tracking.byStage.length > 0 && (
        <div className="card card--pad stack">
          <h2>Where your batches are</h2>
          {tracking.byStage.map((row) => (
            <div key={row.stage} className="row" style={{ justifyContent: 'space-between' }}>
              <span className="muted">{row.label}</span>
              <span className="badge">{row.lots}</span>
            </div>
          ))}
        </div>
      )}
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

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="stat">
      <div className="stat__label">{label}</div>
      <div className="stat__value">{value}</div>
      {note && <div className="stat__note">{note}</div>}
    </div>
  );
}
