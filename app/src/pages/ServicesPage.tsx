import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { CHECKPOINT_COUNT_LABELS, type OrderCheckpoint } from '@shared/enums';
import { countOf } from '@shared/board';
import { CREW_CHECKPOINTS, type CrewRole } from '@shared/services';
import type { StoreStatus } from '@shared/models';
import { FREIGHT_MODE_LABELS, STORE_KIND_LABELS, minKgLabel, type StoreKind } from '@shared/service-stores';
import {
  ApiRequestError,
  api,
  type RequestRow,
  type ConsignmentRow,
  type DistributionLot,
  type DistributionRow,
  type CrewRow,
  type MyServicesView,
  type MyStoreRow,
  type ProviderCard,
  type RouteMatch,
  type SearchStore,
  type StudioMatch,
} from '../api';
import { countryFlag } from '@shared/countries';
import { formatMoney } from '../format';
import { BATTERY_RULE_LABELS, requestIsOpen } from '@shared/service-work';
import { EmptyState, ErrorNotice, Icon, type IconName, PageError } from '../components/ui';
import { Picture, StatusPill, StoreMark, accentStyle } from '../components/StoreKit';
import { useSession } from '../session';
import { RequestRowCard } from '../components/ServiceWorkKit';
import { BackBar, BackLink } from '../components/ScrollManager';
import { ConditionTag } from '../components/ConditionTag';
import { PageLoading } from '../components/Feedback';
import { SkelCards, SkelFaces, SkelInline } from '../components/PageSkeletons';
import '../styles/ServicesPage.css';
import { StickerCluster } from '../components/Sticker';

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
          <h1 className="page__titled">
            Services
            <StickerCluster
              className="title-stickers"
              items={[
                { name: 'box', size: 34, x: 0, y: 4, tilt: -10 },
                { name: 'toy', size: 30, x: 58, y: 0, tilt: 10 },
              ]}
            />
          </h1>
          <p className="muted">
            The people around the trade — who flies the crate, and who makes the piece one of a kind.
          </p>
        </div>
      </div>

      <MyServicesButton mine={mine} signedIn={Boolean(user)} />

      <h2 className="ms-section">Find a service</h2>
      <div className="svx-stack">
        <ServiceTile kind="forwarder" mine={mine} />
        <ServiceTile kind="artist" mine={mine} />
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
      ? <SkelInline w={150} />
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

/** Who offers one service, refetched as the filter changes. */
function useProviders(kind: StoreKind, query = '') {
  const [providers, setProviders] = useState<ProviderCard[] | null>(null);
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

  return { providers, error };
}

/**
 * One service on the tab, as a door: its colours, what it is, a glimpse of
 * who offers it - and the whole tile opens the list. Apply stays under ⋯.
 */
function ServiceTile({ kind, mine }: { kind: StoreKind; mine: MyServicesView | null }) {
  const theme = THEME[kind];
  const { providers } = useProviders(kind);
  const faces = (providers ?? []).slice(0, 4);
  const others = (providers?.length ?? 0) - faces.length;
  return (
    <section className={`svx svx--${kind} svx--tile`} aria-label={theme.title}>
      <header className="svx__hero">
        <span className="svx__art" aria-hidden="true">{kind === 'forwarder' ? <FlightArt /> : <StudioArt />}</span>
        <span className="svx__mark" aria-hidden="true"><Icon name={theme.icon} size={22} /></span>
        <div className="svx__text">
          <span className="svx__eyebrow">{theme.eyebrow}</span>
          <h3 className="svx__title">
            {/* Stretched over the whole tile, so anywhere on it opens the list. */}
            <Link to={`/services/${kind}`} className="svx__open">{theme.title}</Link>
          </h3>
          <p className="svx__line">{theme.line}</p>
        </div>
        <ApplyMenu kind={kind} mine={mine} />
      </header>
      <div className="svx__foot">
        <span className="svx__faces" aria-hidden="true">
          {providers === null && <SkelFaces n={3} />}
          {faces.map((provider) => (
            <span key={provider.userId} className="svx__face">
              <StoreMark name={provider.name} logoUrl={provider.logoUrl ?? null} accent={provider.accent ?? undefined} size={30} />
            </span>
          ))}
          {others > 0 && <span className="svx__face svx__face--more">+{others}</span>}
        </span>
        <span className="svx__count">
          {providers === null ? <SkelInline w={92} /> : providers.length === 0 ? 'Nobody yet' : `${providers.length} on Figmark`}
        </span>
        <span className="svx__go">Explore <Icon name="right" size={15} /></span>
      </div>
    </section>
  );
}

/**
 * A service's own page: the banner at full size, a filter, and everyone
 * offering it, each with a More to their store.
 */
function ServiceSection({ kind, mine }: { kind: StoreKind; mine: MyServicesView | null }) {
  const theme = THEME[kind];
  return (
    <section className={`svx svx--${kind} svx--page`} aria-label={theme.title}>
      <header className="svx__hero">
        <span className="svx__art" aria-hidden="true">{kind === 'forwarder' ? <FlightArt /> : <StudioArt />}</span>
        <span className="svx__mark" aria-hidden="true"><Icon name={theme.icon} size={26} /></span>
        <div className="svx__text">
          <span className="svx__eyebrow">{theme.eyebrow}</span>
          <h1 className="svx__title">{theme.title}</h1>
          <p className="svx__line">{kind === 'forwarder' ? 'Pick where it ships from and to. The best match comes first.' : 'Say what you want done. The best studios come first.'}</p>
        </div>
        <ApplyMenu kind={kind} mine={mine} />
      </header>
      <div className="svx__body">
        {kind === 'forwarder' ? <RouteSearch /> : <StudioSearch />}
      </div>
    </section>
  );
}

/** The level and rating line under a store's name in a result. */
function StandingLine({ store }: { store: SearchStore }) {
  return (
    <span className="svs-standing">
      <span className="svs-level">Lv {store.level} · {store.title}</span>
      {store.rating !== null ? <span>★ {store.rating.toFixed(1)} <span className="faint">({store.reviews})</span></span> : <span className="faint">No ratings yet</span>}
      {store.completed > 0 && <span className="faint">{store.completed} done</span>}
    </span>
  );
}

/**
 * Forwarders as the routes they run: from one country to another, every
 * store's matching route in one list, best match first - rated and levelled
 * stores, then the cheaper.
 */
function RouteSearch() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [mode, setMode] = useState('');
  // What the parcel holds: routes that would refuse it drop out.
  const [battery, setBattery] = useState<'in_device' | 'loose' | null>(null);
  const [freeCover, setFreeCover] = useState(false);
  const [door, setDoor] = useState(false);
  const [result, setResult] = useState<{ routes: RouteMatch[]; countries: { from: string[]; to: string[] } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countries, setCountries] = useState<{ from: string[]; to: string[] }>({ from: [], to: [] });

  useEffect(() => {
    let live = true;
    void api.searchRoutes({ from, to, mode, battery, freeCover, door })
      .then((next) => {
        if (!live) return;
        setResult(next);
        // The lists come from every route on Figmark, so they are kept from the first, unfiltered answer.
        setCountries((current) => (current.from.length ? current : next.countries));
      })
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not search routes.'));
    return () => { live = false; };
  }, [from, to, mode, battery, freeCover, door]);

  return (
    <div className="stack svs">
      <div className="svs-where">
        <label className="field"><span>From</span>
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            <option value="">Anywhere</option>
            {countries.from.map((country) => <option key={country} value={country}>{countryFlag(country)} {country}</option>)}
          </select></label>
        <span className="svs-where__arrow" aria-hidden="true">→</span>
        <label className="field"><span>To</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">Anywhere</option>
            {countries.to.map((country) => <option key={country} value={country}>{countryFlag(country)} {country}</option>)}
          </select></label>
      </div>
      <div className="chips chips--tight" role="group" aria-label="Filters">
        {(['', 'air', 'express', 'sea'] as const).map((value) => (
          <button key={value || 'all'} type="button" className={`chip${mode === value ? ' is-on' : ''}`} aria-pressed={mode === value} onClick={() => setMode(value)}>
            {value ? `${FREIGHT_MODE_LABELS[value].glyph} ${FREIGHT_MODE_LABELS[value].label}` : 'Any mode'}
          </button>
        ))}
        <button type="button" className={`chip${battery === 'in_device' ? ' is-on' : ''}`} aria-pressed={battery === 'in_device'}
          onClick={() => setBattery(battery === 'in_device' ? null : 'in_device')}>🔋 Battery in an item</button>
        <button type="button" className={`chip${battery === 'loose' ? ' is-on' : ''}`} aria-pressed={battery === 'loose'}
          onClick={() => setBattery(battery === 'loose' ? null : 'loose')}>🔋 Loose / power bank</button>
        <button type="button" className={`chip${freeCover ? ' is-on' : ''}`} aria-pressed={freeCover} onClick={() => setFreeCover(!freeCover)}>🛡️ Free cover</button>
        <button type="button" className={`chip${door ? ' is-on' : ''}`} aria-pressed={door} onClick={() => setDoor(!door)}>🚚 Door-to-door</button>
      </div>
      {error && <ErrorNotice message={error} />}
      {result === null ? <SkelCards n={2} h={150} /> : result.routes.length === 0 ? (
        <p className="svx__empty">No forwarder runs that yet. Try another country or fewer filters.</p>
      ) : (
        <div className="svs-list">
          {result.routes.map((row, index) => (
            <Link key={`${row.store.ownerId}-${row.lane.id}`} to={`/services/forwarder/${row.store.slug}/route/${row.lane.id}`}
              className="svs-route" style={accentStyle(row.store.accent)}>
              {index === 0 && <span className="svs-best">Best match</span>}
              <span className="svs-route__top">
                <StoreMark name={row.store.name} logoUrl={row.store.logoUrl} accent={row.store.accent} size={36} />
                <span className="svs-route__who"><b>{row.store.name}</b><StandingLine store={row.store} /></span>
                {row.lane.fromMinor > 0 && <span className="svs-route__price">from <b>{formatMoney(row.lane.fromMinor, 'INR')}</b>/kg</span>}
              </span>
              <span className="svs-route__lane">
                <b>{row.lane.label}</b>
                <span className="faint">{FREIGHT_MODE_LABELS[row.lane.mode].glyph} {FREIGHT_MODE_LABELS[row.lane.mode].label} · {row.lane.days} · {minKgLabel(row.lane)}</span>
              </span>
              <span className="svs-tags">
                <span>🔋 {BATTERY_RULE_LABELS[row.lane.batteries]}</span>
                {row.lane.customsIncluded && <span>✓ Customs cleared</span>}
                {row.freeCover && <span>🛡️ Free cover</span>}
                {row.door && <span>🚚 Door-to-door</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** Artists by what you want done: a repaint, a sculpt, a repair. */
function StudioSearch() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<{ studios: StudioMatch[]; specialties: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api.searchStudios(query.trim())
        .then((next) => {
          if (!live) return;
          setResult(next);
          setTags((current) => (current.length ? current : next.specialties));
        })
        .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not search studios.'));
    }, query ? 200 : 0);
    return () => { live = false; clearTimeout(timer); };
  }, [query]);

  return (
    <div className="stack svs">
      <div className="search svx__search">
        <span className="search__icon"><Icon name="search" /></span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Repaint, head sculpt, repair…" aria-label="What do you want done?" />
      </div>
      {tags.length > 0 && (
        <div className="chips chips--tight" role="group" aria-label="Kind of work">
          {tags.map((tag) => (
            <button key={tag} type="button" className={`chip${query.toLowerCase() === tag.toLowerCase() ? ' is-on' : ''}`}
              onClick={() => setQuery(query.toLowerCase() === tag.toLowerCase() ? '' : tag)}>{tag}</button>
          ))}
        </div>
      )}
      {error && <ErrorNotice message={error} />}
      {result === null ? <SkelCards n={2} h={130} /> : result.studios.length === 0 ? (
        <p className="svx__empty">No studio offers that yet. Try another word.</p>
      ) : (
        <div className="svs-list">
          {result.studios.map((row, index) => (
            <Link key={row.store.ownerId} to={`/services/artist/${row.store.slug}`} className="svs-route" style={accentStyle(row.store.accent)}>
              {index === 0 && row.acceptingWork && <span className="svs-best">Best match</span>}
              <span className="svs-route__top">
                <StoreMark name={row.store.name} logoUrl={row.store.logoUrl} accent={row.store.accent} size={36} />
                <span className="svs-route__who"><b>{row.store.name}</b><StandingLine store={row.store} /></span>
                {row.fromMinor > 0 && <span className="svs-route__price">from <b>{formatMoney(row.fromMinor, 'INR')}</b></span>}
              </span>
              {row.portfolio.length > 0 && (
                <span className="svx-gallery">
                  {row.portfolio.map((url) => (
                    <span key={url} className="svx-gallery__pic"><Picture url={url} label="Work" className="sk-pic" /></span>
                  ))}
                </span>
              )}
              <span className="svs-tags">
                {row.services.map((service) => <span key={service.id}>{service.name}{service.days ? ` · ${service.days} days` : ''}</span>)}
                {!row.acceptingWork && <span className="svs-tags__off">Not taking work</span>}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** The ⋯ on a service's banner: apply, or carry on with an application or a store. */
function ApplyMenu({ kind, mine }: { kind: StoreKind; mine: MyServicesView | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const status: StoreStatus | null = mine?.own[kind] ?? null;

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const live = status === 'approved' || status === 'suspended';
  // A live store is run from My services, like every other job.
  const target = live ? '/services/mine' : `/services/apply/${kind}`;
  const label = status === null ? THEME[kind].apply
    : live ? 'Open in My services'
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

/** A dotted flight path over the forwarders' banner, with a plane flying it. */
function FlightArt() {
  return (
    <svg viewBox="0 0 220 120" fill="none">
      <path className="svx-art__route" d="M8 104C60 96 92 28 212 14" stroke="currentColor" strokeWidth="2" strokeDasharray="3 7" strokeLinecap="round" />
      <circle cx="8" cy="104" r="4" fill="currentColor" />
      <circle className="svx-art__ping" cx="212" cy="14" r="4" fill="currentColor" />
      <g className="svx-art__plane">
        <path d="M-7 0 7 0M2-5 7 0 2 5M-4 0-7-4M-4 0-7 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <animateMotion dur="7s" repeatCount="indefinite" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline"
          keySplines="0.45 0 0.55 1" path="M8 104C60 96 92 28 212 14" />
      </g>
    </svg>
  );
}

/** Brush strokes over the artists' banner, painted on and lifted off. */
function StudioArt() {
  return (
    <svg viewBox="0 0 220 120" fill="none">
      <path className="svx-art__stroke" pathLength={1} d="M20 90c30-30 60 20 90-10s50-50 90-30" stroke="currentColor" strokeWidth="10" strokeLinecap="round" opacity="0.5" />
      <path className="svx-art__stroke svx-art__stroke--two" pathLength={1} d="M60 110c20-14 50-6 70-20" stroke="currentColor" strokeWidth="6" strokeLinecap="round" opacity="0.35" />
      <circle className="svx-art__drop" cx="186" cy="30" r="9" fill="currentColor" opacity="0.6" />
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
      <BackLink to="/services">{STORE_KIND_LABELS[kind].many}</BackLink>
      <ServiceSection key={kind} kind={kind} mine={mine} />
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
  const [asked, setAsked] = useState<RequestRow[]>([]);
  const [assigned, setAssigned] = useState<RequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // Work handed to you, the lots and teams you are on, and what you asked for: one wait, not three.
      const [services, requests, given] = await Promise.all([
        api.myServices(),
        api.myServiceRequests().catch(() => ({ requests: [] })),
        api.assignedRequests().catch(() => ({ requests: [] })),
      ]);
      setAsked(requests.requests);
      setAssigned(given.requests);
      setMine(services);
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
        <BackLink to="/services" title="My services" />
        <EmptyState icon="◍" title="Sign in to see your services">
          <Link to="/" className="btn">Sign in</Link>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="page">
      <BackLink to="/services" title="My services" />
      <div className="page__head">
        <div>
          <p className="muted">Work handed to you: requests assigned to you, lots shops named you on, and the teams you are on.</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {assigned.some((row) => requestIsOpen(row.request)) && (
        <section className="stack" style={{ marginBottom: 22 }}>
          <h2 className="ms-section"><Icon name="check" size={15} /> Assigned to you</h2>
          {assigned.filter((row) => requestIsOpen(row.request)).map((row) => (
            <RequestRowCard key={row.request.id} request={row.request} due={row.due} side="store" actions={row.actions}
              to={`/services/store/${row.request.kind}/${row.request.ownerId}?tab=requests&r=${row.request.id}`} />
          ))}
        </section>
      )}

      {mine === null ? (
        !error && <div className="stack"><SkelInline w={70} h={14} /><SkelCards n={1} h={76} chips={0} /></div>
      ) : !enrolled(mine) && assigned.length === 0 ? (asked.length > 0 ? null :
        <EmptyState icon={<Icon name="users" size={26} />} title="Nothing handed to you yet">
          When a team adds you, or a shop names you on a lot as its supplier or handler, the work shows up here.
          To run your own business, <Link to="/open">open one</Link>.
        </EmptyState>
      ) : (
        <div className="stack ms-page">
          {groupCrew(mine.crew).map(({ role, rows }) => (
            <section key={role} className="stack ms-crew-group">
              <h2 className="ms-section">
                <Icon name={ROLE_COPY[role].icon} size={15} /> {ROLE_COPY[role].label}
              </h2>
              {rows.map((row) => <CrewCard key={`${row.role}-${row.lot.id}`} row={row} />)}
            </section>
          ))}

          {mine.stores.some((row) => !row.isOwner) && (
            <section className="stack">
              <h2 className="ms-section">Teams you’re on</h2>
              {mine.stores.filter((row) => !row.isOwner).map((row) => <StoreRowCard key={`${row.kind}-${row.ownerId}`} row={row} />)}
            </section>
          )}

          {mine.stores.some((row) => row.isOwner) && (
            <p className="faint svx-ownline">
              Your own {mine.stores.filter((row) => row.isOwner).length === 1 ? 'business is' : 'businesses are'} in the switcher under your profile picture:{' '}
              {mine.stores.filter((row) => row.isOwner).map((row, index) => (
                <span key={`${row.kind}-${row.ownerId}`}>{index > 0 && ' · '}<Link to={`/services/store/${row.kind}/${row.ownerId}`}>{row.name}</Link></span>
              ))}
            </p>
          )}

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

      {asked.length > 0 && (
        <section className="stack" style={{ marginTop: 22 }}>
          <h2 className="ms-section"><Icon name="send" size={15} /> Requests you sent</h2>
          {asked.map((row) => (
            <RequestRowCard key={row.request.id} request={row.request} due={row.due} side="customer" actions={row.actions}
              to={`/services/requests/${row.request.kind}/${row.request.ownerId}/${row.request.id}`} />
          ))}
        </section>
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
        <span><b>{row.items}</b> orders</span>
        {row.role === 'handler' && <span><b>{row.parcels}</b> customers</span>}
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
      <BackLink to="/services/mine" title="Consigned to you" />
      <div className="page__head">
        <div>
          <p className="muted">Lots a shop has named you on. Weight and orders, as loaded.</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {rows === null ? (
        <SkelCards n={2} h={120} mark={false} chips={3} />
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
                <span><b>{row.pieces}</b> orders</span>
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
      <BackLink to="/services/mine" title="To distribute" />
      <div className="page__head">
        <div>
          <p className="muted">
            Lots named to you. Counted in customers — three orders for one customer is one
            job.
          </p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {rows === null ? (
        <SkelCards n={2} h={120} mark={false} chips={3} />
      ) : rows.length === 0 ? (
        <EmptyState icon="📦" title="Nothing to hand out yet">
          When a shop names you on a lot it lands here, with the customers to pack and send.
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
                <span><b>{row.parcels}</b> customers</span>
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

  if (error) return <PageError message={error} />;
  if (!data) return <PageLoading />;

  return (
    <main className="page">
      <BackBar onBack={onBack} title={data.lot.name} />
      <div className="page__head">
        <div>
          <p className="muted">
            {data.store.name}{data.city ? ` · ${data.city}` : ''} · {data.parcels.length} customers
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
                      <ConditionTag condition={item.condition} />{item.quantity > 1 ? ` ×${item.quantity}` : ''}
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
