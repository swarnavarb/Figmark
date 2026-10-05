import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FREIGHT_MODE_LABELS, STORE_KIND_LABELS, type FreightMode, type StoreKind } from '@shared/service-stores';
import { ApiRequestError, api, type PublicStore } from '../api';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon, TrustBadge } from '../components/ui';
import { formatMoney } from '../format';
import {
  LaneTicket, OfferingCard, PlanCard, PortfolioGrid, StatusPill, StoreCover, StoreMark, accentStyle,
} from '../components/StoreKit';

/**
 * A service store's own page.
 *
 * The thing a shop opens before booking a forwarder on a lot, and a buyer
 * opens before trusting a stranger with their figure. So it leads with the
 * proof - work done here, years trading, registered or not - and then the
 * offer: lanes as tickets, cover as plans, or the menu under the portfolio.
 */
export function StorePage() {
  const { kind, slug } = useParams<{ kind: string; slug: string }>();
  const [data, setData] = useState<{ store: PublicStore; stats: { lotsCarried: number; commissions: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('all');

  useEffect(() => {
    if (kind !== 'forwarder' && kind !== 'artist') return;
    void api.storePage(kind as StoreKind, slug ?? '')
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load that store.'));
  }, [kind, slug]);

  if (error) {
    return <main className="page"><BackLink to={`/services/${kind}`}>← Back</BackLink><EmptyState icon="◌" title="No such store">{error}</EmptyState></main>;
  }
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>;

  const { store, stats } = data;
  const modes = [...new Set(store.lanes.map((lane) => lane.mode))];
  const lanes = store.lanes.filter((lane) => mode === 'all' || lane.mode === mode);
  const proof = store.kind === 'forwarder'
    ? [
      { value: stats.lotsCarried, label: 'lots carried here' },
      { value: store.lanes.length, label: store.lanes.length === 1 ? 'lane' : 'lanes' },
      store.capacityKg ? { value: `${(store.capacityKg / 1000).toFixed(store.capacityKg % 1000 ? 1 : 0)}t`, label: 'a month' } : null,
      store.since ? { value: new Date().getFullYear() - store.since, label: 'years trading' } : null,
    ]
    : [
      { value: stats.commissions + store.trust.completedTransactions, label: 'pieces finished' },
      { value: store.offerings.length, label: 'services' },
      store.since ? { value: new Date().getFullYear() - store.since, label: 'years painting' } : null,
    ];

  return (
    <main className="page sp-page" style={accentStyle(store.accent)}>
      <BackLink to={`/services/${store.kind}`}>← {STORE_KIND_LABELS[store.kind].many}</BackLink>

      <section className="sp-hero">
        <StoreCover kind={store.kind} coverUrl={store.coverUrl} accent={store.accent} />
        <div className="sp-hero__card">
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={84} />
          <div className="sp-hero__text">
            <span className="sp-hero__kind">{STORE_KIND_LABELS[store.kind].store}</span>
            <h1>{store.name}</h1>
            {store.tagline && <p className="sp-hero__tag">{store.tagline}</p>}
            <div className="sp-hero__chips">
              {(store.city || store.country) && <span className="sp-chip">📍 {[store.city, store.country].filter(Boolean).join(', ')}</span>}
              {store.registered && <span className="sp-chip sp-chip--ok"><Icon name="check" size={12} /> Registered business</span>}
              <span className="sp-chip sp-chip--ok"><Icon name="check" size={12} /> Approved by Figmark</span>
              {store.trust.completedTransactions > 0 && <span className="sp-chip"><TrustBadge score={store.trust.score} /> {store.trust.completedTransactions} reviewed</span>}
              {store.status && store.status !== 'approved' && <StatusPill status={store.status} />}
            </div>
          </div>
          <div className="sp-hero__cta">
            {store.handle && <Link to={`/messages/${store.handle}`} className="btn"><Icon name="message" size={14} /> Message</Link>}
            {store.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="btn btn--ghost btn--sm"><Icon name="external" size={13} /> {link.label}</a>
            ))}
          </div>
        </div>
        <div className="sp-proof">
          {proof.filter(Boolean).map((item) => (
            <span key={item!.label} className="sp-proof__cell"><b>{item!.value}</b><span>{item!.label}</span></span>
          ))}
        </div>
      </section>

      <div className="sp-layout">
        <div className="stack sp-main">
          {store.kind === 'forwarder' ? (
            <>
              <section className="stack">
                <div className="sp-sechead">
                  <h2>Lanes & rates</h2>
                  {modes.length > 1 && (
                    <div className="sp-filter" role="radiogroup" aria-label="Filter by mode">
                      <button type="button" className={mode === 'all' ? 'is-on' : ''} onClick={() => setMode('all')}>All</button>
                      {modes.map((value) => (
                        <button key={value} type="button" className={mode === value ? 'is-on' : ''} onClick={() => setMode(value)}>
                          {FREIGHT_MODE_LABELS[value as FreightMode]?.glyph} {FREIGHT_MODE_LABELS[value as FreightMode]?.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                {lanes.length === 0 ? <p className="muted">No lanes listed yet.</p>
                  : lanes.map((lane) => <LaneTicket key={lane.id} lane={lane} accent={store.accent} />)}
                <p className="faint">Rates and transit times are the forwarder’s own. Shops book a lane on a lot from the lot’s Crew screen.</p>
              </section>
              {store.insurance.length > 0 && (
                <section className="stack">
                  <h2>Transit cover</h2>
                  <p className="muted">Buyers can add one of these to their own item when their shop offers it — paid with the order.</p>
                  <div className="sp-plans">{store.insurance.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>
                </section>
              )}
            </>
          ) : (
            <>
              {store.portfolio.length > 0 && (
                <section className="stack">
                  <h2>Work</h2>
                  <PortfolioGrid pieces={store.portfolio} />
                </section>
              )}
              <section className="stack">
                <div className="sp-sechead">
                  <h2>Menu</h2>
                  <span className={`badge ${store.acceptingWork ? 'badge--ok' : 'badge--warn'}`}>
                    {store.acceptingWork ? 'Taking commissions' : 'Queue full'}
                  </span>
                </div>
                <div className="sp-menu">{store.offerings.map((offering) => <OfferingCard key={offering.id} offering={offering} />)}</div>
                <p className="faint">To commission a piece, open the order for something you bought and choose “Customise with an artist”.</p>
              </section>
            </>
          )}
        </div>

        <aside className="sp-side stack">
          <section className="sp-box">
            <h3>About</h3>
            <p className="sp-about">{store.about}</p>
            {store.specialties.length > 0 && (
              <div className="sp-tags">{store.specialties.map((tag) => <span key={tag} className="sp-chip">{tag}</span>)}</div>
            )}
          </section>
          {store.kind === 'forwarder' && store.warehouse && (
            <section className="sp-box">
              <h3>Origin warehouse</h3>
              <p className="sp-about">{store.warehouse.address}</p>
              {store.warehouse.hours && <p className="faint">{store.warehouse.hours}</p>}
              {store.warehouse.contact && <p className="faint">{store.warehouse.contact}</p>}
            </section>
          )}
          <section className="sp-box">
            <h3>{store.kind === 'forwarder' ? 'Booking' : 'How a commission works'}</h3>
            {store.kind === 'forwarder' ? (
              <ul className="sp-steps">
                <li>Shops pick this forwarder and a lane on a lot.</li>
                <li>{store.autoAccept ? 'Bookings are accepted automatically.' : 'The team accepts each booking.'}</li>
                <li>They press the buttons your route hands them — the buyer’s tracking moves.</li>
              </ul>
            ) : (
              <ul className="sp-steps">
                <li>Ask from your order, with a brief and references.</li>
                <li>The artist quotes a price and a time.</li>
                <li>Pay with Buyer Protection, or direct.</li>
                <li>The finished piece ships back to you.</li>
              </ul>
            )}
          </section>
          <section className="sp-box">
            <h3>Contact</h3>
            {store.contactEmail && <p className="faint">{store.contactEmail}</p>}
            {store.contactPhone && <p className="faint">{store.contactPhone}</p>}
            <p className="faint">{store.teamSize} {store.teamSize === 1 ? 'person' : 'people'} on the team</p>
            {store.kind === 'artist' && store.offerings.length > 0 && (
              <p className="faint">From {formatMoney(Math.min(...store.offerings.map((row) => row.priceFromMinor || Infinity)))}</p>
            )}
          </section>
        </aside>
      </div>
      {error && <ErrorNotice message={error} />}
    </main>
  );
}
