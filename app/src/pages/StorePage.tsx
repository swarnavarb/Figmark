import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FREIGHT_MODE_LABELS, STORE_KIND_LABELS, type FreightMode, type StoreKind } from '@shared/service-stores';
import { fromPriceMinor, laneFromMinor } from '@shared/service-work';
import { ApiRequestError, api, type StorePageView } from '../api';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import {
  LaneTicket, OfferingCard, PlanCard, PortfolioGrid, StatusPill, StoreCover, StoreMark, accentStyle,
} from '../components/StoreKit';
import { StandingChips, Stars, StoreChannel } from '../components/ServiceWorkKit';
import { PageLoading } from '../components/Feedback';
import { loaders } from '../pageLoaders';
import '../styles/StorePage.css';

/**
 * A service store's own page.
 *
 * The thing a customer opens before trusting a stranger with a parcel or a
 * figure. So it leads with the proof - its level and rating, earned only from
 * work finished here - and then the offer: each route or service opens its own
 * page with every price and condition, and the form to use it. The channel is
 * where the company talks and anyone can ask.
 */

type Tab = 'offer' | 'channel' | 'reviews';

/** The detail page's code, fetched the moment a finger or pointer heads for a route. */
const warmDetail = () => { void loaders.serviceDetail().catch(() => undefined); };

export function StorePage() {
  const { kind, slug } = useParams<{ kind: string; slug: string }>();
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'offer';
  const [data, setData] = useState<StorePageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<string>('all');
  const [following, setFollowing] = useState(false);
  const [followers, setFollowers] = useState(0);

  useEffect(() => {
    if (kind !== 'forwarder' && kind !== 'artist') return;
    void api.storePage(kind as StoreKind, slug ?? '')
      .then((view) => { setData(view); setFollowing(Boolean(view.viewer?.following)); setFollowers(view.stats.followers); })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load that store.'));
  }, [kind, slug]);

  if (error && !data) {
    return <main className="page"><BackLink to={`/services/${kind}`} title="Store" /><EmptyState icon="◌" title="No such store">{error}</EmptyState></main>;
  }
  if (!data) return <PageLoading />;

  const { store, stats } = data;
  const isTeam = (data.viewer?.rights.length ?? 0) > 0;
  const go = (next: Tab) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('tab', next); return copy; }, { replace: true });
  const modes = [...new Set(store.lanes.map((lane) => lane.mode))];
  const lanes = store.lanes.filter((lane) => mode === 'all' || lane.mode === mode);
  const proof = store.kind === 'forwarder'
    ? [
      { value: stats.standing.completed, label: 'shipments delivered' },
      { value: store.lanes.length, label: store.lanes.length === 1 ? 'route' : 'routes' },
      store.capacityKg ? { value: `${(store.capacityKg / 1000).toFixed(store.capacityKg % 1000 ? 1 : 0)}t`, label: 'a month' } : null,
      store.since ? { value: new Date().getFullYear() - store.since, label: 'years trading' } : null,
    ]
    : [
      { value: stats.standing.completed + store.trust.completedTransactions, label: 'pieces finished' },
      { value: store.offerings.length, label: 'services' },
      store.since ? { value: new Date().getFullYear() - store.since, label: 'years painting' } : null,
    ];

  async function toggleFollow() {
    if (!data) return;
    const next = !following;
    setFollowing(next);
    setFollowers((count) => count + (next ? 1 : -1));
    try {
      const answer = await api.followStore(data.store.kind, data.store.ownerId, next);
      setFollowing(answer.following);
      setFollowers(answer.followers);
    } catch (err) {
      setFollowing(!next);
      setFollowers((count) => count + (next ? -1 : 1));
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    }
  }

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'offer', label: store.kind === 'forwarder' ? 'Routes & rates' : 'Menu' },
    { id: 'channel', label: 'Channel' },
    { id: 'reviews', label: 'Reviews', count: stats.standing.reviews },
  ];

  return (
    <main className="page sp-page" style={accentStyle(store.accent)}>
      <BackLink to={`/services/${store.kind}`}>{store.name}</BackLink>

      <section className="sp-hero">
        <StoreCover kind={store.kind} coverUrl={store.coverUrl} accent={store.accent} />
        <div className="sp-hero__card">
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={84} />
          <div className="sp-hero__text">
            <span className="sp-hero__kind">{STORE_KIND_LABELS[store.kind].store}</span>
            <h1>{store.name}</h1>
            {store.tagline && <p className="sp-hero__tag">{store.tagline}</p>}
            <div className="sp-hero__chips">
              <StandingChips standing={stats.standing} followers={followers} />
              {(store.city || store.country) && <span className="sp-chip">📍 {[store.city, store.country].filter(Boolean).join(', ')}</span>}
              {store.registered && <span className="sp-chip sp-chip--ok"><Icon name="check" size={12} /> Registered business</span>}
              {store.status && store.status !== 'approved' && <StatusPill status={store.status} />}
            </div>
          </div>
          <div className="sp-hero__cta">
            {isTeam ? (
              <Link to={`/services/store/${store.kind}/${store.ownerId}`} className="btn"><Icon name="grip" size={14} /> Open dashboard</Link>
            ) : user ? (
              <button type="button" className={`btn${following ? ' btn--ghost' : ''}`} onClick={() => void toggleFollow()} aria-pressed={following}>
                {following ? <><Icon name="check" size={14} /> Following</> : <><Icon name="plus" size={14} /> Follow</>}
              </button>
            ) : null}
            <button type="button" className="btn btn--ghost" onClick={() => go('channel')}><Icon name="forum" size={14} /> Channel</button>
            {store.handle && !isTeam && <Link to={`/messages/${store.handle}`} className="btn btn--ghost btn--sm"><Icon name="message" size={14} /> Message</Link>}
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

      <div className="tabs sp-tabs" role="tablist">
        {tabs.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={`tab${tab === entry.id ? ' is-on' : ''}`} onClick={() => go(entry.id)}>
            {entry.label}{entry.count ? <span className="sp-tabs__count">{entry.count}</span> : null}
          </button>
        ))}
      </div>
      {error && <ErrorNotice message={error} />}

      <div className="sp-layout">
        <div className="stack sp-main">
          {tab === 'offer' && (store.kind === 'forwarder' ? (
            <>
              <section className="stack">
                <div className="sp-sechead">
                  <h2>Routes & rates</h2>
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
                {lanes.length === 0 ? <p className="muted">No routes listed yet.</p> : lanes.map((lane) => {
                  const from = laneFromMinor(lane);
                  return (
                    <Link key={lane.id} to={`/services/forwarder/${store.slug}/route/${lane.id}`} className="sp-offer-link"
                      onPointerEnter={warmDetail} onTouchStart={warmDetail} onFocus={warmDetail}>
                      <LaneTicket lane={lane} accent={store.accent} />
                      <span className="sp-offer-link__more">
                        {from > 0 && <span>From <b>{formatMoney(from)}</b>/kg</span>}
                        {(lane.products?.length ?? 0) > 0 && <span>{lane.products!.length} product prices</span>}
                        {lane.volumetric && <span>Volumetric ÷{lane.volumetric.divisor}</span>}
                        {lane.batteryAllowed === false && <span>No batteries</span>}
                        <span className="sp-offer-link__go">Details & ship <Icon name="right" size={13} /></span>
                      </span>
                    </Link>
                  );
                })}
                <p className="faint">Rates and transit times are the forwarder’s own. Open a route for every price, its warehouse and the form to ship with them.</p>
              </section>
              {store.insurance.length > 0 && (
                <section className="stack">
                  <h2>Transit cover</h2>
                  <p className="muted">Add one when you ship — priced on what your parcel is worth.</p>
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
                <div className="sp-menu">
                  {store.offerings.map((offering) => (
                    <Link key={offering.id} to={`/services/artist/${store.slug}/service/${offering.id}`} className="sp-offer-link sp-offer-link--card"
                      onPointerEnter={warmDetail} onTouchStart={warmDetail} onFocus={warmDetail}>
                      <OfferingCard offering={{ ...offering, priceFromMinor: fromPriceMinor(offering.priceFromMinor, offering.products) }} />
                      <span className="sp-offer-link__more">
                        {(offering.products?.length ?? 0) > 0 && <span>{offering.products!.length} prices</span>}
                        <span className="sp-offer-link__go">Details & request <Icon name="right" size={13} /></span>
                      </span>
                    </Link>
                  ))}
                </div>
              </section>
            </>
          ))}

          {tab === 'channel' && (
            <section className="stack">
              <div className="sp-sechead"><h2>Channel</h2><span className="faint">Updates from {store.name}, and questions from anyone.</span></div>
              <StoreChannel kind={store.kind} ownerId={store.ownerId} storeName={store.name}
                accentLogo={<StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={22} />} />
            </section>
          )}

          {tab === 'reviews' && (
            <section className="stack">
              <div className="sp-sechead">
                <h2>Reviews</h2>
                {stats.standing.rating !== null && (
                  <span className="sp-rating"><Stars value={stats.standing.rating} size={16} /> <b>{stats.standing.rating.toFixed(1)}</b> <span className="faint">from {stats.standing.reviews}</span></span>
                )}
              </div>
              {stats.reviews.length === 0 ? (
                <EmptyState icon={<Icon name="star" size={24} />} title="No reviews yet">Every finished job can be rated by the customer who asked for it.</EmptyState>
              ) : stats.reviews.map((review, index) => (
                <article key={`${review.at}-${index}`} className="sp-review">
                  <span className="sp-review__head"><Stars value={review.stars} size={13} /> <b>{review.by}</b>
                    {review.subject && <span className="faint">· {review.subject}</span>}<span className="faint">· {timeAgo(review.at)}</span></span>
                  {review.text && <p>{review.text}</p>}
                </article>
              ))}
            </section>
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
          <section className="sp-box">
            <h3>Level {stats.standing.level} · {stats.standing.title}</h3>
            <span className="sp-level"><span style={{ width: `${stats.standing.next ? Math.min(100, (stats.standing.points / stats.standing.next) * 100) : 100}%` }} /></span>
            <p className="faint">
              {stats.standing.next ? `${stats.standing.points} of ${stats.standing.next} points to the next level.` : 'The top level.'} Points come only from
              work finished here and the ratings customers left.
            </p>
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
            <h3>{store.kind === 'forwarder' ? 'How shipping works' : 'How a commission works'}</h3>
            {store.kind === 'forwarder' ? (
              <ul className="sp-steps">
                <li>Pick a route and send the form — tracking ID, weight, what is inside.</li>
                <li>The team quotes; accept and pay them direct.</li>
                <li>Send the parcel to their warehouse. Follow it to your door.</li>
                <li>Rate the shipment when it lands.</li>
              </ul>
            ) : (
              <ul className="sp-steps">
                <li>Pick a service and send a brief with references.</li>
                <li>The artist quotes a price and a time.</li>
                <li>Pay direct, send the piece, follow it in the studio.</li>
                <li>It ships back to you — rate the work.</li>
              </ul>
            )}
          </section>
          <section className="sp-box">
            <h3>Contact</h3>
            {store.contactEmail && <p className="faint">{store.contactEmail}</p>}
            {store.contactPhone && <p className="faint">{store.contactPhone}</p>}
            <p className="faint">{store.teamSize} {store.teamSize === 1 ? 'person' : 'people'} on the team</p>
            {store.kind === 'artist' && store.offerings.length > 0 && (
              <p className="faint">From {formatMoney(Math.min(...store.offerings.map((row) => fromPriceMinor(row.priceFromMinor, row.products) || Infinity)))}</p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}
