import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CHECKPOINT_COUNT_LABELS, type OrderCheckpoint } from '@shared/enums';
import { countOf } from '@shared/board';
import { CREW_CHECKPOINTS, SERVICES, type CrewRole } from '@shared/services';
import type { StoreStatus } from '@shared/models';
import { FREIGHT_MODE_LABELS, STORE_KIND_LABELS, type StoreKind } from '@shared/service-stores';
import {
  ApiRequestError,
  api,
  type ConsignmentRow,
  type DistributionLot,
  type DistributionRow,
  type CrewRow,
  type MyServicesView,
  type MyStoreRow,
  type ProviderCard,
} from '../api';
import { formatMoney } from '../format';
import { EmptyState, ErrorNotice, Icon, TrustBadge, type IconName } from '../components/ui';
import { StatusPill, StoreMark, accentStyle } from '../components/StoreKit';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';

/**
 * The trades around the trade.
 *
 * Two halves. At the top, one door - My services - for everybody: whatever a
 * person does for somebody else on Figmark is behind it, and if they do
 * nothing yet it says so. Under it, the services anyone can hire, each in its
 * own colours: the freight forwarders who fly a lot, and the artists who make a
 * piece one of a kind.
 *
 * Suppliers and domestic handlers have no list here. A shop names them on a
 * lot, under Crew, and the lot turns up under that person's My services.
 */
export function ServicesPage() {
  const { user } = useSession();
  const [mine, setMine] = useState<MyServicesView | null>(null);

  useEffect(() => {
    if (!user) return;
    void api.myServices().then(setMine).catch(() => setMine(null));
  }, [user]);

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Services</h1>
          <p className="muted">
            The people around the trade — who flies the crate, and who makes the piece one of a kind.
          </p>
        </div>
      </div>

      <MyServicesButton mine={mine} signedIn={Boolean(user)} />

      <h2 className="ms-section">Find a service</h2>
      <div className="svx-stack">
        <ServiceSection kind="forwarder" mine={mine} limit={4} />
        <ServiceSection kind="artist" mine={mine} limit={4} />
      </div>
    </main>
  );
}

/** Whether this person has anything at all behind My services. */
function enrolled(mine: MyServicesView | null): boolean {
  return Boolean(mine && (mine.stores.length > 0 || mine.crew.length > 0 || mine.communityManager));
}

/** The one door at the top of the tab, the same for everybody. */
function MyServicesButton({ mine, signedIn }: { mine: MyServicesView | null; signedIn: boolean }) {
  const waiting = (mine?.stores ?? []).reduce((sum, row) => sum + row.waiting, 0)
    + (mine?.crew ?? []).filter((row) => row.toPress > 0).length;
  const line = !signedIn
    ? 'Sign in to see the work you do for others'
    : mine === null
      ? 'Loading…'
      : !enrolled(mine)
        ? 'You’re not enrolled in any services'
        : waiting > 0
          ? `${waiting} waiting on you`
          : `${countOf3(mine)} · all caught up`;
  return (
    <Link to="/services/mine" className="svx-mine">
      <span className="svx-mine__icon" aria-hidden="true"><Icon name="users" size={20} /></span>
      <span className="svx-mine__body">
        <span className="svx-mine__title">My services</span>
        <span className="svx-mine__line">{line}</span>
      </span>
      {waiting > 0 && <span className="svx-mine__ping">{waiting}</span>}
      <Icon name="right" size={18} className="svx-mine__go" />
    </Link>
  );
}

/** "2 stores, 3 lots", for the line under the button. */
function countOf3(mine: MyServicesView): string {
  const parts: string[] = [];
  if (mine.stores.length) parts.push(`${mine.stores.length} ${mine.stores.length === 1 ? 'store' : 'stores'}`);
  if (mine.crew.length) parts.push(`${mine.crew.length} ${mine.crew.length === 1 ? 'lot' : 'lots'}`);
  if (mine.communityManager) parts.push('Community Service');
  return parts.join(', ');
}

/* ── One service, in its own colours ───────────────────────────────────── */

const THEME: Record<StoreKind, { eyebrow: string; title: string; line: string; icon: IconName; apply: string }> = {
  forwarder: {
    eyebrow: 'Cargo · China → India',
    title: 'Freight forwarders',
    line: 'They consolidate the crate, fly or ship it, and clear customs at both ends. Pick by lane, rate and transit.',
    icon: 'plane',
    apply: 'Apply as a freight forwarder',
  },
  artist: {
    eyebrow: 'Studio · Customs & repaints',
    title: 'Artists',
    line: 'Painters, sculptors and restorers who work on figures — a repaint, a custom head, a broken part made good.',
    icon: 'spark',
    apply: 'Apply as an artist',
  },
};

/**
 * A banner in the service's colours, with Apply tucked under its menu, and the
 * people offering it underneath.
 *
 * `limit` is for the tab, which shows the first few and links to the rest;
 * the category's own page passes none and adds a filter.
 */
function ServiceSection({ kind, mine, limit, filter = false }: {
  kind: StoreKind;
  mine: MyServicesView | null;
  limit?: number;
  filter?: boolean;
}) {
  const theme = THEME[kind];
  const [providers, setProviders] = useState<ProviderCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .serviceDirectory(kind, query || undefined)
        .then((result) => !cancelled && setProviders(result.providers))
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof ApiRequestError ? err.message : 'Could not load that list.');
        });
    }, query ? 180 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [kind, query]);

  const shown = limit ? (providers ?? []).slice(0, limit) : providers ?? [];
  const more = limit && providers ? providers.length - shown.length : 0;

  return (
    <section className={`svx svx--${kind}`} aria-label={theme.title}>
      <header className="svx__hero">
        <span className="svx__art" aria-hidden="true">{kind === 'forwarder' ? <FlightArt /> : <StudioArt />}</span>
        <span className="svx__mark" aria-hidden="true"><Icon name={theme.icon} size={22} /></span>
        <div className="svx__text">
          <span className="svx__eyebrow">{theme.eyebrow}</span>
          <h3 className="svx__title">
            {limit ? <Link to={`/services/${kind}`}>{theme.title}</Link> : theme.title}
          </h3>
          <p className="svx__line">{theme.line}</p>
          <span className="svx__count">
            {providers === null ? '…' : `${providers.length} on Figmark`}
          </span>
        </div>
        <ApplyMenu kind={kind} mine={mine} />
      </header>

      {filter && (
        <div className="search svx__search">
          <span className="search__icon"><Icon name="search" /></span>
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder={kind === 'forwarder' ? 'Filter by route — Guangzhou, Mumbai…' : 'Filter by style — repaint, sculpt…'}
            aria-label={`Filter ${theme.title}`} />
        </div>
      )}

      {error && <ErrorNotice message={error} />}

      {providers === null ? (
        <div className="svx__list" aria-hidden="true">
          {[0, 1].map((key) => <div key={key} className="svx-card svx-card--ghost skel" />)}
        </div>
      ) : providers.length === 0 ? (
        <p className="svx__empty">
          {query ? 'Nobody matches that. Try another city or style.' : `No ${theme.title.toLowerCase()} yet — be the first: apply from the ⋯ menu.`}
        </p>
      ) : (
        <div className="svx__list">
          {shown.map((provider) => kind === 'forwarder'
            ? <ForwarderCard key={provider.userId} provider={provider} />
            : <ArtistCard key={provider.userId} provider={provider} />)}
        </div>
      )}

      {more > 0 && (
        <Link to={`/services/${kind}`} className="svx__all">
          See all {providers!.length} {theme.title.toLowerCase()} <Icon name="right" size={14} />
        </Link>
      )}
    </section>
  );
}

/** The ⋯ on a service's banner: apply, or carry on with an application or a store. */
function ApplyMenu({ kind, mine }: { kind: StoreKind; mine: MyServicesView | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const status: StoreStatus | null = mine?.own[kind] ?? null;
  const own = mine?.stores.find((row) => row.kind === kind && row.isOwner) ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const live = status === 'approved' || status === 'suspended';
  const target = live ? `/services/store/${kind}/${own?.ownerId ?? ''}` : `/services/apply/${kind}`;
  const label = status === null ? THEME[kind].apply
    : live ? 'Open your store console'
      : status === 'pending' ? 'View your application'
        : status === 'changes' ? 'Fix and resend your application'
          : status === 'rejected' ? 'Edit and reapply' : 'View your store';

  return (
    <div className="svx__menuwrap" ref={box}>
      <button type="button" className="svx__more" aria-label={`More for ${THEME[kind].title}`}
        aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" size={18} />
      </button>
      {open && (
        <div className="spost__menu" role="menu">
          <Link role="menuitem" to={target} onClick={() => setOpen(false)}>
            <Icon name={live ? 'external' : 'compose'} size={15} /> {label}
          </Link>
          {status && !live && <span className="svx__menunote"><StatusPill status={status} /></span>}
        </div>
      )}
    </div>
  );
}

/** The store's own name and mark, linking to its page. */
function CardHead({ provider, kind }: { provider: ProviderCard; kind: StoreKind }) {
  return (
    <div className="svx-card__head">
      <StoreMark name={provider.name} logoUrl={provider.logoUrl ?? null} accent={provider.accent ?? undefined} size={44} />
      <span className="svx-card__who">
        <span className="svx-card__name">{provider.name}</span>
        <span className="svx-card__sub">
          {[provider.tagline, provider.place].filter(Boolean).join(' · ') || SERVICES[kind].label}
        </span>
      </span>
      {provider.trustScore !== null && (provider.completed ?? 0) > 0 ? (
        <span className="svx-card__trust"><TrustBadge score={provider.trustScore} /><span>{provider.completed} done</span></span>
      ) : (
        <span className="svx-card__new">New</span>
      )}
    </div>
  );
}

/** A forwarder as a shop chooses one: the lanes, how long, how much a kilo. */
function ForwarderCard({ provider }: { provider: ProviderCard }) {
  const lanes = provider.lanes ?? [];
  const extra = lanes.length - 3;
  const href = provider.slug ? `/services/forwarder/${provider.slug}` : null;
  return (
    <article className="svx-card" style={accentStyle(provider.accent ?? 'aqua')}>
      <CardHead provider={provider} kind="forwarder" />
      {lanes.length === 0 ? (
        <span className="svx-card__note">Routes on request</span>
      ) : (
        <ul className="svx-lanes" aria-label="Routes">
          {lanes.slice(0, 3).map((lane, index) => (
            <li key={`${lane.from}-${lane.to}-${index}`} className="svx-lane">
              <span className="svx-lane__ends">
                <b>{lane.from || '?'}</b>
                <span className="svx-lane__path" aria-hidden="true">
                  <span>{lane.mode ? FREIGHT_MODE_LABELS[lane.mode].glyph : '✈'}</span>
                </span>
                <b>{lane.to || '?'}</b>
              </span>
              <span className="svx-lane__facts">
                {lane.mode && <span>{FREIGHT_MODE_LABELS[lane.mode].label}</span>}
                <span>{lane.days}</span>
                {lane.ratePerKgMinor > 0 && <span className="svx-lane__rate">{formatMoney(lane.ratePerKgMinor, 'INR')}/kg</span>}
              </span>
            </li>
          ))}
          {extra > 0 && <li className="svx-lanes__more">+{extra} more {extra === 1 ? 'route' : 'routes'}</li>}
        </ul>
      )}
      <div className="svx-card__foot">
        {provider.handle && <Link to={`/messages/${provider.handle}`} className="btn btn--quiet btn--sm">Message</Link>}
        {href && <Link to={href} className="btn btn--sm svx-card__more">More <Icon name="right" size={13} /></Link>}
      </div>
    </article>
  );
}

/** An artist as a buyer chooses one: what they do, a few pieces, where prices start. */
function ArtistCard({ provider }: { provider: ProviderCard }) {
  const pieces = provider.portfolio ?? [];
  const href = provider.slug ? `/services/artist/${provider.slug}` : null;
  return (
    <article className="svx-card" style={accentStyle(provider.accent ?? 'pink')}>
      <CardHead provider={provider} kind="artist" />
      {pieces.length > 0 && (
        <div className="svx-gallery">
          {pieces.slice(0, 4).map((url) => (
            <span key={url} className="svx-gallery__pic">
              {/* A piece that will not load leaves an empty frame, not a broken picture. */}
              <img src={url} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.visibility = 'hidden'; }} />
            </span>
          ))}
        </div>
      )}
      <div className="svx-tags">
        {(provider.specialties ?? []).slice(0, 4).map((tag) => <span key={tag} className="svx-tag">{tag}</span>)}
        {provider.acceptingWork === false && <span className="svx-tag svx-tag--off">Not taking work</span>}
      </div>
      <div className="svx-card__foot">
        {provider.fromMinor ? <span className="svx-card__from">from <b>{formatMoney(provider.fromMinor, 'INR')}</b></span> : <span />}
        {href && <Link to={href} className="btn btn--sm svx-card__more">More <Icon name="right" size={13} /></Link>}
      </div>
    </article>
  );
}

/** A dotted flight path over the forwarders' banner. */
function FlightArt() {
  return (
    <svg viewBox="0 0 220 120" fill="none">
      <path d="M8 104C60 96 92 28 212 14" stroke="currentColor" strokeWidth="2" strokeDasharray="3 7" strokeLinecap="round" />
      <circle cx="8" cy="104" r="4" fill="currentColor" />
      <circle cx="212" cy="14" r="4" fill="currentColor" />
    </svg>
  );
}

/** Loose brush strokes over the artists' banner. */
function StudioArt() {
  return (
    <svg viewBox="0 0 220 120" fill="none">
      <path d="M20 90c30-30 60 20 90-10s50-50 90-30" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.5" />
      <path d="M60 110c20-14 50-6 70-20" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
      <circle cx="186" cy="30" r="9" fill="currentColor" opacity="0.6" />
    </svg>
  );
}

const ROLE_COPY: Record<CrewRole, { label: string; icon: IconName }> = {
  supplier: { label: 'Supplier', icon: 'search' },
  handler: { label: 'Domestic handler', icon: 'box' },
  forwarder: { label: 'Forwarder', icon: 'plane' },
};

function groupCrew(rows: CrewRow[]): { role: CrewRole; rows: CrewRow[] }[] {
  const order: CrewRole[] = ['supplier', 'forwarder', 'handler'];
  return order.map((role) => ({ role, rows: rows.filter((row) => row.role === role) })).filter((group) => group.rows.length > 0);
}

/* ── One category ───────────────────────────────────────────────────────── */

/** Everyone offering one of the two services anyone can hire, with a filter. */
export function ServiceDirectoryPage() {
  const { kind } = useParams<{ kind: string }>();
  const { user } = useSession();
  const [mine, setMine] = useState<MyServicesView | null>(null);

  useEffect(() => {
    if (!user) return;
    void api.myServices().then(setMine).catch(() => setMine(null));
  }, [user]);

  // Suppliers and handlers are named on a lot, not picked from a list.
  if (kind !== 'forwarder' && kind !== 'artist') return <Navigate to="/services" replace />;

  return (
    <main className="page">
      <BackLink to="/services">← Services</BackLink>
      <ServiceSection key={kind} kind={kind} mine={mine} filter />
    </main>
  );
}

/* ── My services ────────────────────────────────────────────────────── */

/**
 * Everything this person does for somebody else, on one screen.
 *
 * The stores they run or help run, and the lots a shop named them on - each
 * under the job they were named for. Nothing else: somebody with none of it is
 * told so, and where to apply.
 */
export function MyServicesPage() {
  const { user } = useSession();
  const [mine, setMine] = useState<MyServicesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setMine(await api.myServices());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your services.');
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [load, user]);

  if (!user) {
    return (
      <main className="page">
        <BackLink to="/services">← Services</BackLink>
        <EmptyState icon="◍" title="Sign in to see your services">
          <Link to="/" className="btn">Sign in</Link>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="page">
      <BackLink to="/services">← Services</BackLink>
      <div className="page__head">
        <div>
          <h1>My services</h1>
          <p className="muted">The stores you run, and the lots shops have named you on.</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {mine === null ? (
        !error && <p className="muted">Loading…</p>
      ) : !enrolled(mine) ? (
        <EmptyState icon={<Icon name="users" size={26} />} title="You’re not enrolled in any services">
          When a shop names you on a lot — as its supplier or handler — the lot appears here. To run
          a forwarding company or an artist studio, apply from the ⋯ menu on{' '}
          <Link to="/services/forwarder">Freight forwarders</Link> or <Link to="/services/artist">Artists</Link>.
        </EmptyState>
      ) : (
        <div className="stack ms-page">
          {mine.stores.length > 0 && (
            <section className="stack">
              <h2 className="ms-section">Your stores</h2>
              {mine.stores.map((row) => <StoreRowCard key={`${row.kind}-${row.ownerId}`} row={row} />)}
            </section>
          )}

          {groupCrew(mine.crew).map(({ role, rows }) => (
            <section key={role} className="stack ms-crew-group">
              <h2 className="ms-section">
                <Icon name={ROLE_COPY[role].icon} size={15} /> {ROLE_COPY[role].label}
              </h2>
              {rows.map((row) => <CrewCard key={`${row.role}-${row.lot.id}`} row={row} />)}
            </section>
          ))}

          {/* Only for the people Figmark has appointed community managers. */}
          {mine.communityManager && (
            <section className="stack">
              <h2 className="ms-section">My job</h2>
              <Link to="/community-service" className="svc">
                <span className="svc__glyph"><Icon name="users" size={22} /></span>
                <span className="svc__body">
                  <span className="svc__name">Community Service</span>
                  <span className="faint">Disputes waiting on your decision, held payments to release, and what you have earned.</span>
                </span>
              </Link>
            </section>
          )}
        </div>
      )}
    </main>
  );
}

function StoreRowCard({ row }: { row: MyStoreRow }) {
  return (
    <Link to={`/services/store/${row.kind}/${row.ownerId}`} className="ms-store" style={accentStyle(row.accent)}>
      <StoreMark name={row.name} logoUrl={row.logoUrl} accent={row.accent} size={48} />
      <span className="ms-store__body">
        <span className="ms-store__top">
          <span className="ms-store__name">{row.name}</span>
          <StatusPill status={row.status} />
        </span>
        <span className="faint">
          {STORE_KIND_LABELS[row.kind].store}{row.isOwner ? ' · Owner' : ` · ${row.rights.join(', ')}`}
        </span>
        {row.status === 'approved' ? (
          <span className="ms-store__counts">
            <span className={row.waiting > 0 ? 'ms-store__hot' : ''}>
              <b>{row.waiting}</b> {row.kind === 'forwarder' ? 'requests' : 'need a move'}
            </span>
            <span><b>{row.active}</b> {row.kind === 'forwarder' ? 'lots on' : 'in progress'}</span>
          </span>
        ) : row.lastNote && (
          <span className="ms-store__note">“{row.lastNote}”</span>
        )}
      </span>
      <span className="ms-store__go" aria-hidden="true"><Icon name="right" size={18} /></span>
    </Link>
  );
}

function CrewCard({ row }: { row: CrewRow }) {
  const progress = row.lot.steps > 1 ? Math.max(0, row.lot.stepIndex) / (row.lot.steps - 1) : 0;
  return (
    <Link to={`/services/crew/${row.lot.sellerId}/${row.lot.id}?role=${row.role}`} className="ms-crew">
      <span className="ms-crew__top">
        <span className="ms-crew__name">{row.lot.name} <span className="faint">{row.lot.number}</span></span>
        {row.toPress > 0
          ? <span className="badge badge--warn">{row.toPress} to press</span>
          : <span className="badge badge--ok">Done for now</span>}
      </span>
      <span className="faint">{row.store.name} · {row.lot.step || row.lot.stage.replace(/_/g, ' ')}</span>
      <span className="ms-crew__bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
      <span className="ms-crew__btns">
        {row.buttons.length === 0
          ? <span className="faint">No buttons handed to you on this route yet.</span>
          : row.buttons.map((label) => <span key={label} className="ms-btnchip">⚡ {label}</span>)}
      </span>
      <span className="ms-crew__stats">
        <span><b>{row.items}</b> items</span>
        {row.role === 'handler' && <span><b>{row.parcels}</b> parcels</span>}
      </span>
    </Link>
  );
}

/* ── The forwarder's console ────────────────────────────────────────────── */

/**
 * What has been consigned to this forwarder.
 *
 * Pieces and weight, because that is what they quote on and load. No prices:
 * what the shop sold it for is not their business, and a screen that showed it
 * would be handing over a shop's margin to the company flying its crates.
 */
export function ConsignmentsPage() {
  const [rows, setRows] = useState<ConsignmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .consignments()
      .then((result) => setRows(result.consignments))
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your consignments.'),
      );
  }, []);

  return (
    <main className="page">
      <BackLink to="/services/mine">← My services</BackLink>
      <div className="page__head">
        <div>
          <h1>Consigned to you</h1>
          <p className="muted">Lots a shop has named you on. Weight and pieces, as loaded.</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="✈" title="Nothing consigned yet">
          When a shop picks you on a lot it turns up here, with what it weighs.
        </EmptyState>
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <article key={row.lot.id} className="jobcard">
              <div className="jobcard__top">
                <span className="jobcard__name">{row.lot.name}</span>
                <span className="badge">{row.lot.stage.replace(/_/g, ' ')}</span>
              </div>
              <span className="faint">
                {row.store.name} · {row.lot.origin || 'origin not set'}
              </span>
              <div className="jobcard__stats">
                <span><b>{row.pieces}</b> pieces</span>
                <span><b>{(row.weightGrams / 1000).toFixed(1)}</b> kg</span>
                {row.lot.trackingReference && <span className="faint">{row.lot.trackingReference}</span>}
              </div>
              {row.store.handle && (
                <Link to={`/messages/${row.store.handle}`} className="btn btn--quiet btn--sm">
                  Message the shop
                </Link>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

/* ── The handler's console ──────────────────────────────────────────────── */

/** The lots this handler has to get out, counted in parcels. */
export function DistributionPage() {
  const [rows, setRows] = useState<DistributionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api.distribution()).lots);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your lots.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (openId) {
    return <DistributionDetail lotId={openId} onBack={() => { setOpenId(null); void load(); }} />;
  }

  return (
    <main className="page">
      <BackLink to="/services/mine">← My services</BackLink>
      <div className="page__head">
        <div>
          <h1>To distribute</h1>
          <p className="muted">
            Lots named to you. Counted in parcels, not pieces — three items for one buyer is one
            job.
          </p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="📦" title="Nothing to hand out yet">
          When a shop names you on a lot it lands here, with the parcels to make up.
        </EmptyState>
      ) : (
        <div className="stack">
          {rows.map((row) => (
            <button key={row.lot.id} type="button" className="jobcard jobcard--tap"
              onClick={() => setOpenId(row.lot.id)}>
              <div className="jobcard__top">
                <span className="jobcard__name">{row.lot.name}</span>
                <span className={`badge badge--${row.dispatched === row.parcels ? 'ok' : 'warn'}`}>
                  {row.dispatched}/{row.parcels} out
                </span>
              </div>
              <span className="faint">
                {row.store.name}{row.city ? ` · ${row.city}` : ''} · {row.lot.stage.replace(/_/g, ' ')}
              </span>
              <div className="jobcard__stats">
                <span><b>{row.parcels}</b> parcels</span>
                <span><b>{countOf(row.tally, 'india_received').done}</b> landed</span>
                <span><b>{countOf(row.tally, 'packed').done}</b> packed</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

/**
 * One lot as parcels to send.
 *
 * The mirror image of the supplier's packing list. Theirs is pieces and never
 * customers, because they pack a crate; a handler's entire job is which box
 * goes to which person, so they get the names and a phone number - and still no
 * prices, which stay between the shop and its buyer.
 */
function DistributionDetail({ lotId, onBack }: { lotId: string; onBack: () => void }) {
  const [data, setData] = useState<DistributionLot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.distributionLot(lotId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load that lot.');
    }
  }, [lotId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Tick one checkpoint across everything in a parcel: a parcel moves whole. */
  async function markParcel(buyerId: string, checkpoint: OrderCheckpoint, on: boolean) {
    const parcel = data?.parcels.find((row) => row.buyerId === buyerId);
    if (!parcel) return;
    setBusy(buyerId);
    setError(null);
    try {
      for (const item of parcel.items) {
        await api.setCheckpoint(item.id, checkpoint, on);
      }
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (error) return <main className="page"><ErrorNotice message={error} /></main>;
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  return (
    <main className="page">
      <button type="button" className="backlink" onClick={onBack}>← To distribute</button>
      <div className="page__head">
        <div>
          <h1>{data.lot.name}</h1>
          <p className="muted">
            {data.store.name}{data.city ? ` · ${data.city}` : ''} · {data.parcels.length} parcels
          </p>
        </div>
        {data.store.handle && (
          <Link to={`/messages/${data.store.handle}`} className="btn btn--ghost btn--sm">Message</Link>
        )}
      </div>

      <div className="bars" style={{ marginBottom: 16 }}>
        {CREW_CHECKPOINTS.handler.map((checkpoint) => {
          const row = countOf(data.tally, checkpoint);
          return (
            <div key={checkpoint} className="bar">
              <span className="bar__label">{CHECKPOINT_COUNT_LABELS[checkpoint]}</span>
              <span className="bar__track">
                <span className="bar__fill"
                  style={{ width: `${row.total === 0 ? 0 : (row.done / row.total) * 100}%` }} />
              </span>
              <span className="bar__count">{row.done}/{row.total}</span>
            </div>
          );
        })}
      </div>

      <div className="stack">
        {data.parcels.map((parcel) => {
          const every = (checkpoint: OrderCheckpoint) =>
            parcel.items.every((item) => Boolean(item.checkpoints[checkpoint]));
          const gone = every('dispatched');
          const weight = parcel.items.reduce(
            (sum, item) => sum + item.quantity * item.unitWeightGrams, 0,
          );

          return (
            <article key={parcel.buyerId} className={`parcel${gone ? ' parcel--gone' : ''}`}>
              <div className="parcel__top">
                <span className="parcel__name">{parcel.name}</span>
                <span className="faint">{(weight / 1000).toFixed(1)} kg</span>
              </div>
              {parcel.phone && <span className="faint">{parcel.phone}</span>}

              <ul className="parcel__items">
                {parcel.items.map((item) => (
                  <li key={item.id}>
                    <span>{item.itemName}</span>
                    <span className="faint">
                      {item.condition}{item.quantity > 1 ? ` · ×${item.quantity}` : ''}
                    </span>
                  </li>
                ))}
              </ul>

              {/* Only the four a handler may tick. The other two belong to the
                  packing floor in China, and a button that 403s is worse than
                  no button. */}
              <div className="parcel__acts">
                {CREW_CHECKPOINTS.handler.map((checkpoint) => {
                  const done = every(checkpoint);
                  return (
                    <button
                      key={checkpoint}
                      type="button"
                      className={`tickbtn${done ? ' is-on' : ''}`}
                      disabled={busy === parcel.buyerId}
                      aria-pressed={done}
                      onClick={() => void markParcel(parcel.buyerId, checkpoint, !done)}
                    >
                      {CHECKPOINT_COUNT_LABELS[checkpoint]}
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
