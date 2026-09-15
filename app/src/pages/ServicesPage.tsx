import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CHECKPOINT_COUNT_LABELS, type OrderCheckpoint } from '@shared/enums';
import { countOf } from '@shared/board';
import {
  CREW_CHECKPOINTS, ENTRY_NOTE, SERVICES, SERVICE_ORDER,
  type ServiceKind,
} from '@shared/services';
import {
  ApiRequestError,
  api,
  type ConsignmentRow,
  type DistributionBatch,
  type DistributionRow,
  type ProviderCard,
  type ServicesHub,
} from '../api';
import { EmptyState, ErrorNotice, Icon, TrustBadge } from '../components/ui';
import { SERVICES_GLYPH } from '../components/TabBar';
import { useSession } from '../session';

/**
 * The trades around the trade.
 *
 * A batch of figures reaches a buyer in Kochi because four different people
 * each did one job: somebody checked the pieces in Guangzhou, somebody flew the
 * crate, somebody took delivery in Mumbai and broke it into fifteen parcels,
 * and somebody held the money until each one arrived. Three of those four were
 * already in here - a forwarder directory, an escrow console, a packing list -
 * but only ever as something a seller reached into from their own console. The
 * people doing the work had no door of their own.
 *
 * This is that door, on the bar, next to the two it sits between: you buy, you
 * sell, and this is everyone who makes the middle of it happen.
 */
export function ServicesPage() {
  const [hub, setHub] = useState<ServicesHub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .services()
      .then(setHub)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load the services.'),
      );
  }, []);

  return (
    <main className="page tab-view">
      <div className="page__head">
        <div>
          <h1>Services</h1>
          <p className="muted">
            The people around the trade. Someone checks the goods, someone flies them, someone gets
            them to the door, someone holds the money.
          </p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {/* Whoever provides one is here to work, not to browse. Their door goes
          above the directory rather than under it. */}
      <Link to="/services/mine" className="myservice">
        <svg className="myservice__glyph" viewBox="0 0 24 24" width="24" height="24" fill="none"
          stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
          aria-hidden="true">
          {SERVICES_GLYPH}
        </svg>
        <span className="myservice__body">
          <span className="myservice__title">My service</span>
          <span className="faint">
            {hub === null
              ? 'Loading…'
              : hub.mine.length === 0
                ? 'Offer one — freight forwarding, or handling in India.'
                : hub.mine.map((kind) => SERVICES[kind].label).join(' · ')}
          </span>
        </span>
        <span className="myservice__go" aria-hidden="true">→</span>
      </Link>

      <div className="stack">
        {(hub?.categories ?? SERVICE_ORDER.map((kind) => ({ ...SERVICES[kind], count: null }))).map(
          (category) => (
            <Link key={category.kind} to={`/services/${category.kind}`} className="svc">
              <span className="svc__glyph"><Icon name={category.icon} size={22} /></span>
              <span className="svc__body">
                <span className="svc__top">
                  <span className="svc__name">{category.plural}</span>
                  {/* No count where there is no list: "0 exporters" would be a
                      lie about a category that deliberately has no roster. */}
                  {category.count !== null ? (
                    <span className="badge">{category.count}</span>
                  ) : (
                    <span className="badge badge--quiet">Private</span>
                  )}
                </span>
                <span className="faint">{category.blurb}</span>
              </span>
            </Link>
          ),
        )}
      </div>
    </main>
  );
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
      <Link to="/services" className="backlink">← Services</Link>
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
          {meta.plural} are named by a shop on one batch, so nobody is on offer here. If a shop has
          named you, the batch is waiting under My service.
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
                    {provider.handle ? (
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

/* ── My service ─────────────────────────────────────────────────────────── */

/** Where somebody who does one of these jobs goes to do it. */
export function MyServicesPage() {
  const { user } = useSession();
  const [hub, setHub] = useState<ServicesHub | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offering, setOffering] = useState<'forwarder' | 'handler' | null>(null);

  const load = useCallback(async () => {
    try {
      setHub(await api.services());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your services.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) {
    return (
      <main className="page">
        <EmptyState icon="◍" title="Sign in to offer a service">
          <Link to="/" className="btn">Sign in</Link>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="page">
      <Link to="/services" className="backlink">← Services</Link>
      <div className="page__head">
        <div>
          <h1>My service</h1>
          <p className="muted">
            What you do for other people’s batches, and the screen for doing it.
          </p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {hub === null ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="stack">
          {hub.mine.length === 0 ? (
            <EmptyState icon="◍" title="You don’t provide one yet">
              Freight forwarding and domestic handling are open to anyone — put yourself on the list
              and shops can name you on a batch. Escrow is granted by Figmark, and an exporter is
              named by a shop on one run.
            </EmptyState>
          ) : (
            hub.mine.map((kind) => (
              <Link key={kind} to={SERVICES[kind].console} className="svc">
                <span className="svc__glyph"><Icon name={SERVICES[kind].icon} size={22} /></span>
                <span className="svc__body">
                  <span className="svc__top">
                    <span className="svc__name">{SERVICES[kind].label}</span>
                    <span className="badge badge--ok">Yours</span>
                  </span>
                  <span className="faint">{SERVICES[kind].blurb}</span>
                </span>
              </Link>
            ))
          )}

          {/* Both open lists, in one form. Escrow and exporter are deliberately
              not here: neither is something you can sign up for. */}
          <div className="card card--pad stack">
            <div>
              <h2>Offer a service</h2>
              <span className="field__hint">
                You can be listed for both. A handler can stay off the public list and still be
                named by the shops that already know you.
              </span>
            </div>
            <div className="seg" role="radiogroup" aria-label="Which service">
              <button type="button" role="radio" aria-checked={offering === 'forwarder'}
                className={offering === 'forwarder' ? 'is-on' : ''}
                onClick={() => setOffering(offering === 'forwarder' ? null : 'forwarder')}>
                Freight forwarding
              </button>
              <button type="button" role="radio" aria-checked={offering === 'handler'}
                className={offering === 'handler' ? 'is-on' : ''}
                onClick={() => setOffering(offering === 'handler' ? null : 'handler')}>
                Domestic handling
              </button>
            </div>

            {offering && (
              <OfferForm
                kind={offering}
                onSaved={() => {
                  setOffering(null);
                  void load();
                }}
              />
            )}
          </div>
        </div>
      )}
    </main>
  );
}

/** The one form both open services share. */
function OfferForm({ kind, onSaved }: { kind: 'forwarder' | 'handler'; onSaved: () => void }) {
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
        kind,
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
        <span>{kind === 'forwarder' ? 'Routes' : 'Cities you cover'}</span>
        <input value={places} onChange={(e) => setPlaces(e.target.value)}
          placeholder={kind === 'forwarder' ? 'Guangzhou → Mumbai, Yiwu → Delhi' : 'Mumbai, Pune'} />
        <span className="field__hint">Comma separated.</span>
      </label>
      <label className="field">
        <span>What you do</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
          placeholder={kind === 'forwarder'
            ? 'Consolidated air freight, customs at both ends.'
            : 'Take delivery, break the crate down, book the courier same day.'} />
      </label>
      <label className="field">
        <span>Contact</span>
        <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
          placeholder="+91…" />
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
      <Link to="/services/mine" className="backlink">← My service</Link>
      <div className="page__head">
        <div>
          <h1>Consigned to you</h1>
          <p className="muted">Batches a shop has named you on. Weight and pieces, as loaded.</p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="✈" title="Nothing consigned yet">
          When a shop picks you on a batch it turns up here, with what it weighs.
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

/** The batches this handler has to get out, counted in parcels. */
export function DistributionPage() {
  const [rows, setRows] = useState<DistributionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await api.distribution()).batches);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your batches.');
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
      <Link to="/services/mine" className="backlink">← My service</Link>
      <div className="page__head">
        <div>
          <h1>To distribute</h1>
          <p className="muted">
            Batches named to you. Counted in parcels, not pieces — three items for one buyer is one
            job.
          </p>
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon="📦" title="Nothing to hand out yet">
          When a shop names you on a batch it lands here, with the parcels to make up.
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
 * One batch as parcels to send.
 *
 * The mirror image of the exporter's packing list. Theirs is pieces and never
 * customers, because they pack a crate; a handler's entire job is which box
 * goes to which person, so they get the names and a phone number - and still no
 * prices, which stay between the shop and its buyer.
 */
function DistributionDetail({ lotId, onBack }: { lotId: string; onBack: () => void }) {
  const [data, setData] = useState<DistributionBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.distributionBatch(lotId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load that batch.');
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
