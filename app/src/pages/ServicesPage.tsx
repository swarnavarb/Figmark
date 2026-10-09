import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CHECKPOINT_COUNT_LABELS, type OrderCheckpoint } from '@shared/enums';
import { countOf } from '@shared/board';
import {
  CREW_CHECKPOINTS, ENTRY_NOTE, SERVICES, SERVICE_ORDER,
  type CrewRole, type ServiceKind,
} from '@shared/services';
import type { StoreStatus } from '@shared/models';
import { STORE_KIND_LABELS, type StoreKind } from '@shared/service-stores';
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
  type ServicesHub,
} from '../api';
import { EmptyState, ErrorNotice, Icon, TrustBadge, type IconName } from '../components/ui';
import { StatusPill, StoreMark, accentStyle } from '../components/StoreKit';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';

/**
 * The trades around the trade.
 *
 * A lot of figures reaches a buyer in Kochi because different people each did
 * one job: somebody checked the pieces in Guangzhou, somebody flew the crate,
 * and somebody took delivery in Mumbai and broke it into fifteen parcels. Those
 * jobs were already in here - a forwarder directory, a packing list - but only
 * ever as something a seller reached into from their own console. The people
 * doing the work had no door of their own.
 *
 * This is that door, on the bar, next to the two it sits between: you buy, you
 * sell, and this is everyone who makes the middle of it happen. Whoever does
 * one of these jobs finds their own work first, above the directory.
 */
export function ServicesPage() {
  const { user } = useSession();
  const [hub, setHub] = useState<ServicesHub | null>(null);
  const [mine, setMine] = useState<MyServicesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .services()
      .then(setHub)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the services.'),
      );
  }, []);

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
            The people around the trade. Someone checks the goods, someone flies them, someone gets
            them to the door — and someone makes it one of a kind.
          </p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {/* Whoever provides one is here to work, not to browse. Their door goes
          above the directory rather than under it. */}
      <MyServicesStrip mine={mine} signedIn={Boolean(user)} />

      <h2 className="ms-section">Find a service</h2>
      <div className="ms-cats">
        {(hub?.categories ?? SERVICE_ORDER.map((kind) => ({ ...SERVICES[kind], count: null }))).map(
          (category) => (
            <Link key={category.kind} to={`/services/${category.kind}`} className={`ms-cat ms-cat--${category.kind}`}>
              <span className="ms-cat__glyph"><Icon name={category.icon} size={22} /></span>
              <span className="ms-cat__name">{category.plural}</span>
              <span className="ms-cat__blurb">{category.blurb}</span>
              {/* No count where there is no list: "0 suppliers" would be a
                  lie about a category that deliberately has no roster. */}
              <span className="ms-cat__count">
                {category.count !== null ? `${category.count} on Figmark` : 'Named per lot'}
              </span>
            </Link>
          ),
        )}
      </div>
    </main>
  );
}

const ROLE_COPY: Record<CrewRole, { label: string; icon: IconName }> = {
  supplier: { label: 'Supplier', icon: 'search' },
  handler: { label: 'Domestic handler', icon: 'box' },
  forwarder: { label: 'Forwarder', icon: 'plane' },
};

/** The top of the Services tab: your own work, or the invitation to do some. */
function MyServicesStrip({ mine, signedIn }: { mine: MyServicesView | null; signedIn: boolean }) {
  const roles = mine ? mine.stores.length + new Set(mine.crew.map((row) => `${row.role}`)).size : 0;
  if (!signedIn || (mine && roles === 0 && !mine.communityManager)) {
    return (
      <Link to="/services/mine" className="ms-invite">
        <span className="ms-invite__glow" aria-hidden="true" />
        <span className="ms-invite__eyebrow">My services</span>
        <span className="ms-invite__title">Run a service store on Figmark</span>
        <span className="ms-invite__line">
          Fly lots for shops as a freight forwarder, or take commissions as an artist. Apply once —
          we review it and open your store.
        </span>
        <span className="ms-invite__chips">
          <span className="ms-chip ms-chip--aqua"><Icon name="plane" size={14} /> Forwarding company</span>
          <span className="ms-chip ms-chip--pink"><Icon name="spark" size={14} /> Artist studio</span>
        </span>
      </Link>
    );
  }
  const waiting = (mine?.stores ?? []).reduce((sum, row) => sum + row.waiting, 0)
    + (mine?.crew ?? []).reduce((sum, row) => sum + (row.toPress > 0 ? 1 : 0), 0);
  return (
    <section className="ms-strip" aria-label="My services">
      <Link to="/services/mine" className="ms-strip__head">
        <span>
          <span className="ms-strip__title">My services</span>
          <span className="faint">
            {mine === null ? 'Loading…' : waiting > 0 ? `${waiting} waiting on you` : 'All caught up'}
          </span>
        </span>
        <span className="ms-strip__go">Open <Icon name="right" size={14} /></span>
      </Link>
      <div className="ms-strip__row">
        {(mine?.stores ?? []).map((row) => (
          <Link key={`${row.kind}-${row.ownerId}`} to={`/services/store/${row.kind}/${row.ownerId}`} className="ms-tile" style={accentStyle(row.accent)}>
            <StoreMark name={row.name} logoUrl={row.logoUrl} accent={row.accent} size={36} />
            <span className="ms-tile__name">{row.name}</span>
            <span className="ms-tile__meta">{STORE_KIND_LABELS[row.kind].store}</span>
            {row.status === 'approved'
              ? row.waiting > 0 && <span className="ms-tile__ping">{row.waiting}</span>
              : <StatusPill status={row.status} />}
          </Link>
        ))}
        {groupCrew(mine?.crew ?? []).map(({ role, rows }) => (
          <Link key={role} to="/services/mine" className="ms-tile">
            <span className="ms-tile__icon"><Icon name={ROLE_COPY[role].icon} size={18} /></span>
            <span className="ms-tile__name">{ROLE_COPY[role].label}</span>
            <span className="ms-tile__meta">{rows.length} {rows.length === 1 ? 'lot' : 'lots'}</span>
            {rows.some((row) => row.toPress > 0) && <span className="ms-tile__ping">{rows.filter((row) => row.toPress > 0).length}</span>}
          </Link>
        ))}
        {mine?.communityManager && (
          <Link to="/community-service" className="ms-tile">
            <span className="ms-tile__icon"><Icon name="users" size={18} /></span>
            <span className="ms-tile__name">Community Service</span>
            <span className="ms-tile__meta">My job · disputes</span>
          </Link>
        )}
      </div>
    </section>
  );
}

function groupCrew(rows: CrewRow[]): { role: CrewRole; rows: CrewRow[] }[] {
  const order: CrewRole[] = ['supplier', 'forwarder', 'handler'];
  return order.map((role) => ({ role, rows: rows.filter((row) => row.role === role) })).filter((group) => group.rows.length > 0);
}

/* ── One category ───────────────────────────────────────────────────────── */

/**
 * Everyone who offers one service.
 *
 * The text comes from the shared register rather than the response, so the
 * private category can explain itself without asking the API for a list it is
 * never going to hand over.
 */
export function ServiceDirectoryPage() {
  const { kind } = useParams<{ kind: string }>();
  const meta = kind && kind in SERVICES ? SERVICES[kind as ServiceKind] : null;

  const [providers, setProviders] = useState<ProviderCard[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!meta?.browsable) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void api
        .serviceDirectory(meta.kind, query || undefined)
        .then((result) => !cancelled && setProviders(result.providers))
        .catch((err: unknown) => {
          if (!cancelled) {
            setError(err instanceof ApiRequestError ? err.message : 'Could not load that list.');
          }
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [meta, query]);

  if (!meta) {
    return (
      <main className="page">
        <EmptyState icon="◌" title="No such service">
          <Link to="/services">Back to services</Link>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="page">
      <BackLink to="/services">← Services</BackLink>
      <div className="page__head">
        <div>
          <h1>{meta.plural}</h1>
          <p className="muted">{meta.detail}</p>
        </div>
      </div>

      <div className="note-row" style={{ marginBottom: 16 }}>
        <div style={{ minWidth: 0 }}>
          <span className="card__title"><Icon name={meta.icon} size={15} /> How you become one</span>
          <span className="faint">{ENTRY_NOTE[meta.entry]}</span>
        </div>
      </div>

      {!meta.browsable ? (
        <EmptyState icon="🔒" title="There is no list">
          {meta.plural} are named by a shop on one lot, so nobody is on offer here. If a shop has
          named you, the lot is waiting under My services.
        </EmptyState>
      ) : (
        <>
          <div className="search" style={{ maxWidth: 380, marginBottom: 18 }}>
            <span className="search__icon"><Icon name="search" /></span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={
                meta.kind === 'forwarder'
                  ? 'Filter by route — Guangzhou, Mumbai…'
                  : meta.kind === 'handler'
                    ? 'Filter by city or name…'
                    : meta.kind === 'artist'
                      ? 'Filter by style — repaint, sculpt…'
                      : 'Filter by name…'
              }
              aria-label={`Filter ${meta.plural}`}
            />
          </div>

          {error && <ErrorNotice message={error} />}

          {providers === null ? (
            <p className="muted">Loading…</p>
          ) : providers.length === 0 ? (
            <EmptyState icon={<Icon name={meta.icon} size={26} />} title="Nobody here yet">
              {query ? 'Try a different city or name.' : ENTRY_NOTE[meta.entry]}
            </EmptyState>
          ) : (
            <div className="stack">
              {providers.map((provider) => (
                <article key={provider.userId} className="provider">
                  <div className="provider__top">
                    {provider.slug && (meta.kind === 'forwarder' || meta.kind === 'artist') ? (
                      <Link to={`/services/${meta.kind}/${provider.slug}`} className="provider__name provider__name--store">
                        <StoreMark name={provider.name} logoUrl={provider.logoUrl} accent={provider.accent} size={34} />
                        <span>{provider.name}{provider.tagline && <span className="faint provider__tag">{provider.tagline}</span>}</span>
                      </Link>
                    ) : provider.handle ? (
                      <Link to={`/${provider.handle}`} className="provider__name">{provider.name}</Link>
                    ) : (
                      <span className="provider__name">{provider.name}</span>
                    )}
                    {provider.trustScore !== null && (
                      <span className="provider__trust">
                        <TrustBadge score={provider.trustScore} />
                        {/* The count behind the score, so a new entry reads as
                            new rather than as bad. */}
                        <span className="faint">{provider.completed ?? 0} done</span>
                      </span>
                    )}
                  </div>
                  <span className="faint">{provider.line}</span>
                  {provider.description && <p className="provider__note">{provider.description}</p>}
                  <div className="provider__foot">
                    {provider.contact && <span className="faint">{provider.contact}</span>}
                    {provider.handle && (
                      <Link to={`/messages/${provider.handle}`} className="btn btn--quiet btn--sm">
                        Message
                      </Link>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

/* ── My services ────────────────────────────────────────────────────── */

/**
 * Everything this person does for somebody else, on one screen.
 *
 * Three ways in, and they are genuinely different: a store you applied for
 * and run with a team; a lot a shop named you on, with the buttons its route
 * handed you; and the open handler list. Each gets its own block, busiest
 * first, and the invitation to open a store sits under the work rather than
 * over it.
 */
export function MyServicesPage() {
  const { user } = useSession();
  const [mine, setMine] = useState<MyServicesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offering, setOffering] = useState(false);

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
        <EmptyState icon="◍" title="Sign in to offer a service">
          <Link to="/" className="btn">Sign in</Link>
        </EmptyState>
      </main>
    );
  }

  const owned = (kind: StoreKind) => mine?.stores.find((row) => row.kind === kind && row.isOwner) ?? null;

  return (
    <main className="page">
      <BackLink to="/services">← Services</BackLink>
      <div className="page__head">
        <div>
          <h1>My services</h1>
          <p className="muted">The stores you run, and the lots other shops have handed you.</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {mine === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="stack ms-page">
          {mine.stores.length > 0 && (
            <section className="stack">
              <h2 className="ms-section">Your stores</h2>
              {mine.stores.map((row) => <StoreRowCard key={`${row.kind}-${row.ownerId}`} row={row} />)}
            </section>
          )}

          {mine.crew.length > 0 && (
            <section className="stack">
              <h2 className="ms-section">Lots you work on</h2>
              {groupCrew(mine.crew).map(({ role, rows }) => (
                <div key={role} className="stack ms-crew-group">
                  <span className="ms-role">
                    <Icon name={ROLE_COPY[role].icon} size={14} /> {ROLE_COPY[role].label}
                  </span>
                  {rows.map((row) => <CrewCard key={`${row.role}-${row.lot.id}`} row={row} />)}
                </div>
              ))}
            </section>
          )}

          <section className="stack">
            <h2 className="ms-section">Open a service store</h2>
            <div className="ms-apply">
              <ApplyCard kind="forwarder" row={owned('forwarder')} status={mine.own.forwarder} />
              <ApplyCard kind="artist" row={owned('artist')} status={mine.own.artist} />
            </div>
          </section>

          <section className="card card--pad stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <h3>Domestic handling</h3>
                <span className="field__hint">
                  {mine.handler
                    ? 'You are on the handler list. Shops name you on a lot and it appears above.'
                    : 'Take delivery in India and get parcels out. Open to anyone — no store needed.'}
                </span>
              </div>
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOffering(!offering)}>
                {offering ? 'Close' : mine.handler ? 'Edit' : 'List me'}
              </button>
            </div>
            {offering && <OfferForm onSaved={() => { setOffering(false); void load(); }} />}
          </section>

          {/* Only for the people Figmark has appointed community managers. */}
          {mine.communityManager && (
            <>
              <h2 className="ms-section">My job</h2>
              <Link to="/community-service" className="svc">
                <span className="svc__glyph"><Icon name="users" size={22} /></span>
                <span className="svc__body">
                  <span className="svc__name">Community Service</span>
                  <span className="faint">Disputes waiting on your decision, and what you have earned.</span>
                </span>
              </Link>
            </>
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

const APPLY_COPY: Record<StoreKind, { title: string; line: string; points: string[]; icon: IconName; accent: string }> = {
  forwarder: {
    title: 'Forwarding company',
    line: 'Fly or ship lots for shops, sell transit cover to their buyers.',
    points: ['Priced lanes shops book on a lot', 'Transit insurance buyers can add', 'Your team works the lots'],
    icon: 'plane',
    accent: 'aqua',
  },
  artist: {
    title: 'Artist studio',
    line: 'Take commissions on what people bought — repaints, customs, repairs.',
    points: ['A menu with your prices', 'A portfolio on your store page', 'Paid held or direct, per job'],
    icon: 'spark',
    accent: 'pink',
  },
};

function ApplyCard({ kind, row, status }: { kind: StoreKind; row: MyStoreRow | null; status: StoreStatus | null }) {
  const copy = APPLY_COPY[kind];
  const target = status === 'approved' || status === 'suspended'
    ? `/services/store/${kind}/${row?.ownerId ?? ''}` : `/services/apply/${kind}`;
  const action = status === null ? 'Apply' : status === 'approved' ? 'Open console'
    : status === 'pending' ? 'View application' : status === 'changes' ? 'Fix and resend'
      : status === 'rejected' ? 'Edit and reapply' : 'View store';
  return (
    <Link to={target} className={`ms-applycard ms-applycard--${kind}`} style={accentStyle(copy.accent)}>
      <span className="ms-applycard__icon"><Icon name={copy.icon} size={22} /></span>
      <span className="ms-applycard__title">{copy.title}</span>
      <span className="ms-applycard__line">{copy.line}</span>
      <ul className="ms-applycard__points">
        {copy.points.map((point) => <li key={point}>{point}</li>)}
      </ul>
      <span className="ms-applycard__foot">
        {status ? <StatusPill status={status} /> : <span className="faint">Reviewed by Figmark</span>}
        <span className="ms-applycard__cta">{action} <Icon name="right" size={14} /></span>
      </span>
    </Link>
  );
}

/** The open handler list: the one service you sign yourself up for. */
function OfferForm({ onSaved }: { onSaved: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [description, setDescription] = useState('');
  const [places, setPlaces] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [listed, setListed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.offerService({
        kind: 'handler',
        companyName: companyName.trim() || undefined,
        description: description.trim() || undefined,
        places: places.split(',').map((part) => part.trim()).filter(Boolean),
        contactPhone: contactPhone.trim() || undefined,
        listed,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      {error && <ErrorNotice message={error} />}
      <label className="field">
        <span>Trading name</span>
        <input value={companyName} onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Bombay Parcel Works" />
      </label>
      <label className="field">
        <span>Cities you cover</span>
        <input value={places} onChange={(e) => setPlaces(e.target.value)} placeholder="Mumbai, Pune" />
        <span className="field__hint">Comma separated.</span>
      </label>
      <label className="field">
        <span>What you do</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          placeholder="Take delivery, break the crate down, book the courier same day." />
      </label>
      <label className="field">
        <span>Contact</span>
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+91…" />
      </label>
      <label className="tick">
        <input type="checkbox" checked={listed} onChange={(e) => setListed(e.target.checked)} />
        <span>
          List me publicly
          <span className="faint">
            {' '}— off means shops can still name you, you just aren’t on the directory.
          </span>
        </span>
      </label>
      <button type="submit" className="btn" disabled={busy}>
        {busy ? 'Saving…' : 'Save'}
      </button>
    </form>
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
