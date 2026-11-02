import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { FREIGHT_MODE_LABELS, STORE_KIND_LABELS, laneLabel, transitLabel, type FreightMode, type StoreKind } from '@shared/service-stores';
import { fromPriceMinor, laneFromMinor } from '@shared/service-work';
import { ApiRequestError, api, type StorePageView } from '../api';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { PortfolioGrid, StatusPill, StoreCover, StoreMark, accentStyle } from '../components/StoreKit';
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
  const freeCover = store.insurance.some((plan) => !plan.premiumBasisPoints && !plan.minPremiumMinor);
  const door = store.serviceOptions.some((row) => /door/i.test(row.name));
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
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={64} />
          <div className="sp-hero__text">
            <span className="sp-hero__kind">{STORE_KIND_LABELS[store.kind].store}</span>
            <h1>{store.name}</h1>
            {store.tagline && <p className="sp-hero__tag">{store.tagline}</p>}
            <div className="sp-hero__chips">
              <StandingChips standing={stats.standing} followers={followers} />
              {(store.city || store.country) && <span className="sp-chip">📍 {[store.city, store.country].filter(Boolean).join(', ')}</span>}
              {store.registered && <span className="sp-chip sp-chip--ok"><Icon name="check" size={12} /> Registered business</span>}
              {freeCover && <span className="sp-chip sp-chip--ok">🛡️ Free cover</span>}
              {door && <span className="sp-chip">🚚 Door-to-door</span>}
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
            {store.handle && !isTeam && <Link to={`/messages/${store.handle}`} className="btn btn--ghost"><Icon name="message" size={14} /> Message</Link>}
            {store.links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="btn btn--ghost btn--sm sp-hero__link" title={link.label} aria-label={link.label}>
                <Icon name="external" size={14} /> <span>{link.label}</span>
              </a>
            ))}
          </div>
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
                {lanes.length === 0 ? <p className="muted">No routes listed yet.</p> : (
                  <div className="sp-rows">
                    {lanes.map((lane) => {
                      const from = laneFromMinor(lane);
                      const how = FREIGHT_MODE_LABELS[lane.mode as FreightMode];
                      return (
                        <Link key={lane.id} to={`/services/forwarder/${store.slug}/route/${lane.id}`} className="sp-row"
                          onPointerEnter={warmDetail} onTouchStart={warmDetail} onFocus={warmDetail}>
                          <span className="sp-row__glyph" aria-hidden="true">{how?.glyph}</span>
                          <span className="sp-row__body">
                            <b>{laneLabel(lane)}</b>
                            <span className="faint">{how?.label} · {transitLabel(lane)}{lane.note ? ` · ${lane.note}` : ''}</span>
                            {(lane.batteryAllowed === false || !lane.customsIncluded) && (
                              <span className="sp-row__tags">
                                {lane.batteryAllowed === false && <span>No batteries</span>}
                                {!lane.customsIncluded && <span>Duty at actuals</span>}
                              </span>
                            )}
                          </span>
                          {from > 0 && <span className="sp-row__price">from <b>{formatMoney(from)}</b>/kg</span>}
                          <Icon name="right" size={14} />
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              {store.portfolio.length > 0 && <PortfolioGrid pieces={store.portfolio} strip />}
              <section className="stack">
                {!store.acceptingWork && <span className="badge badge--warn">Queue full — not taking new work</span>}
                <div className="sp-rows">
                  {store.offerings.map((offering) => {
                    const from = fromPriceMinor(offering.priceFromMinor, offering.products);
                    return (
                      <Link key={offering.id} to={`/services/artist/${store.slug}/service/${offering.id}`} className="sp-row"
                        onPointerEnter={warmDetail} onTouchStart={warmDetail} onFocus={warmDetail}>
                        <span className="sp-row__body">
                          <b>{offering.name}</b>
                          <span className="faint">{offering.turnaroundDays ? `About ${offering.turnaroundDays} days` : offering.description}</span>
                        </span>
                        {from > 0 && <span className="sp-row__price">from <b>{formatMoney(from)}</b></span>}
                        <Icon name="right" size={14} />
                      </Link>
                    );
                  })}
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
        </aside>
      </div>
    </main>
  );
}
