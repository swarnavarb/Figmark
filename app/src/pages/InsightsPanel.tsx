import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { PHASE_LABELS, SEGMENTS, SEGMENT_LABELS } from '@shared/insights';
import {
  ApiRequestError, api, type CustomerRow, type InsightsResponse, type InterestResponse, type PartyRef,
} from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { EmptyState, ErrorNotice, PersonLink, Thumb, Tile } from '../components/ui';

/**
 * Insights (Pro): who wants what, before and after they buy.
 *
 * Analytics (free) says how the shop is doing and what is owed. This is the
 * layer underneath - who saved an item, who pressed Buy and stopped, how each
 * item turns a look into a payment, what is heating up, which customers keep
 * coming back or have gone quiet, and what the lots and packing need - so a
 * shop can act on interest instead of waiting for it.
 */

type Category = 'saved' | 'checkout' | 'funnel' | 'trending' | 'customers' | 'leads' | 'packing' | 'lots' | 'timing';

const CATEGORIES: { id: Category; icon: string; label: string }[] = [
  { id: 'saved', icon: '❤️', label: 'Saved' },
  { id: 'checkout', icon: '🛒', label: 'Stopped at Buy' },
  { id: 'funnel', icon: '📈', label: 'Funnel' },
  { id: 'trending', icon: '🔥', label: 'Trending' },
  { id: 'customers', icon: '👥', label: 'Customers' },
  { id: 'leads', icon: '💬', label: 'Worth a message' },
  { id: 'packing', icon: '📦', label: 'Packing' },
  { id: 'lots', icon: '🚚', label: 'Lots' },
  { id: 'timing', icon: '⏰', label: 'Best time' },
];

export function InsightsPanel({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<InterestResponse | null>(null);
  const [lots, setLots] = useState<InsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('saved');

  useEffect(() => {
    const shop = store.isOwner ? undefined : store.ownerId;
    void api.interest(shop)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load insights.'));
    // The lot figures are a second read; a shop without lots still gets the rest.
    void api.insights(shop).then(setLots).catch(() => setLots(null));
  }, [store.isOwner, store.ownerId]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const { summary, customers } = data;
  const wantedGone = data.trending.filter((row) => row.soldOut).length;
  const count: Record<Category, number | null> = {
    saved: summary.saves,
    checkout: summary.stalled,
    funnel: null,
    trending: data.trending.length,
    customers: customers.total,
    leads: data.leads.length,
    packing: lots ? lots.boxes.small + lots.boxes.medium + lots.boxes.large : null,
    lots: lots ? lots.perLot.length : null,
    timing: null,
  };

  return (
    <div className="stack ins">
      <section className="inshero">
        <div className="inshero__title">
          <h2>✨ Insights <span className="probadge">PRO</span></h2>
          <p>Who is looking, who is saving, who stopped just short of buying, and who to bring back.</p>
        </div>
        {(summary.stalled > 0 || customers.dormant > 0 || wantedGone > 0) && (
          <div className="inshero__alerts">
            {summary.stalled > 0 && (
              <button type="button" className="insalert insalert--cart" onClick={() => setCategory('checkout')}>
                🛒 {summary.stalled} stopped at Buy · {formatMoney(summary.stalledMinor, 'INR')} not yet ordered
              </button>
            )}
            {wantedGone > 0 && (
              <button type="button" className="insalert insalert--hot" onClick={() => setCategory('trending')}>
                🔥 {wantedGone} wanted item{wantedGone === 1 ? '' : 's'} sold out
              </button>
            )}
            {customers.dormant > 0 && (
              <button type="button" className="insalert insalert--money" onClick={() => setCategory('customers')}>
                💤 {customers.dormant} customer{customers.dormant === 1 ? '' : 's'} gone quiet
              </button>
            )}
          </div>
        )}
      </section>

      {data.expiring.length > 0 && (
        <div className="insexpire">
          <b>⏳ Ending soon, still wanted</b>
          {data.expiring.map((row) => (
            <span key={row.listingId}>
              <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
              {' '}— {row.saves} saved, {row.buyClicks} pressed Buy{row.expiresAt ? `, ends ${formatDate(row.expiresAt)}` : ''}
            </span>
          ))}
        </div>
      )}

      <div className="inscats" role="tablist" aria-label="Insight categories">
        {CATEGORIES.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={category === entry.id}
            className={`inscat${category === entry.id ? ' is-on' : ''}`} onClick={() => setCategory(entry.id)}>
            <span aria-hidden="true">{entry.icon}</span> {entry.label}
            {count[entry.id] !== null && <span className="inscat__n">{count[entry.id]}</span>}
          </button>
        ))}
      </div>

      {category === 'saved' && <Saved data={data} />}
      {category === 'checkout' && <Checkout data={data} />}
      {category === 'funnel' && <Funnel data={data} />}
      {category === 'trending' && <Trending data={data} />}
      {category === 'customers' && <Customers data={data} lots={lots} />}
      {category === 'leads' && <Leads data={data} />}
      {category === 'packing' && <Packing data={lots} />}
      {category === 'lots' && <Lots data={lots} />}
      {category === 'timing' && <Timing data={data} />}
    </div>
  );
}

function Stage({ icon, label, value, hint }: { icon: string; label: string; value: number; hint?: string }) {
  return (
    <div className="insstage">
      <span className="insstage__icon" aria-hidden="true">{icon}</span>
      <b>{value.toLocaleString('en-IN')}</b>
      <small>{label}</small>
      {hint && <em>{hint}</em>}
    </div>
  );
}

/** A button that opens a chat with them, when they have a handle to open. */
function MessageButton({ who }: { who: PartyRef }) {
  if (!who.handle) return null;
  return (
    <Link to={`/messages/${encodeURIComponent(who.handle)}`} className="btn btn--sm insmsg">💬 Message</Link>
  );
}

const SAVE_STATE: Record<'saved' | 'checkout' | 'bought', { text: string; tone: string }> = {
  saved: { text: 'Saved', tone: 'pink' },
  checkout: { text: 'Pressed Buy', tone: 'warn' },
  bought: { text: 'Bought', tone: 'ok' },
};

function Saved({ data }: { data: InterestResponse }) {
  if (data.saved.length === 0) {
    return <EmptyState icon="❤️" title="No saves yet">When someone saves one of your items, you will see who and when here.</EmptyState>;
  }
  return (
    <div className="stack">
      {data.saved.map((item) => (
        <article key={item.listingId} className="inscard">
          <header className="inscard__head">
            <Thumb seed={item.listingId} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb insthumb" />
            <div>
              <Link to={`/listing/${item.listingId}`} className="inscard__title">{item.title}</Link>
              <small>{formatMoney(item.priceMinor, item.currency)}</small>
            </div>
            <span className="inscard__big">❤️ {item.people.length}</span>
          </header>
          <ul className="inspeople">
            {item.people.map((row) => (
              <li key={`${row.who.handle ?? row.who.name}:${row.savedAt}`}>
                <PersonLink party={row.who} />
                <span className={`badge badge--${SAVE_STATE[row.state].tone}`}>{SAVE_STATE[row.state].text}</span>
                <time className="faint" dateTime={row.savedAt}>{formatDate(row.savedAt)}</time>
                {row.state !== 'bought' && <MessageButton who={row.who} />}
              </li>
            ))}
          </ul>
        </article>
      ))}
    </div>
  );
}

function Checkout({ data }: { data: InterestResponse }) {
  if (data.checkout.length === 0) {
    return (
      <EmptyState icon="🛒" title="Nobody stopped at Buy">
        Everyone who pressed Buy went on to pay or book. Anyone who stops at the checkout shows up here.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <p className="faint">
        These buyers pressed Buy but did not pay, pay an advance or book, so no order reached you. A friendly
        message often gets them over the line.
      </p>
      {data.checkout.map((row) => (
        <article key={row.orderId} className="inscard inscard--cart">
          <header className="inscard__head">
            <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
            <div>
              <PersonLink party={row.who} className="inscard__title" />
              <small>
                <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · {formatMoney(row.amountMinor, row.currency)}
              </small>
            </div>
            <MessageButton who={row.who} />
          </header>
          <div className="inscard__facts">
            <span>🕐 Pressed Buy {timeAgo(row.firstAt)}</span>
            {row.clicks > 1 && <span>🔁 {row.clicks} times, last {timeAgo(row.lastAt)}</span>}
            {!row.stillForSale && <span className="badge badge--warn">No longer for sale</span>}
            {row.boughtElsewhere && <span className="badge badge--ok">Bought it in another order</span>}
          </div>
        </article>
      ))}
    </div>
  );
}

function Funnel({ data }: { data: InterestResponse }) {
  if (data.items.length === 0) {
    return <EmptyState icon="📈" title="No activity yet">Views, saves and orders on your items show up here.</EmptyState>;
  }
  const { summary } = data;
  const top = Math.max(1, ...data.items.map((row) => row.views));
  return (
    <div className="stack">
      <article className="inscard">
        <header className="inscard__head inscard__head--plain">
          <div>
            <span className="inscard__title">Your whole shop</span>
            <small>From a look to a payment, across every item.</small>
          </div>
        </header>
        <div className="insfunnel" aria-label="From a look to a payment">
          <Stage icon="👀" label="Views" value={summary.views} />
          <Stage icon="❤️" label="Saves" value={summary.saves} />
          <Stage icon="🛒" label="Pressed Buy" value={summary.buyClicks} />
          <Stage icon="📦" label="Orders" value={summary.orders}
            hint={summary.placedPercent === null ? undefined : `${summary.placedPercent}% went ahead`} />
          <Stage icon="✅" label="Paid in full" value={summary.paid} />
        </div>
      </article>
      <p className="faint">Item by item, most-wanted first.</p>
      {data.items.map((row) => {
        const rate = row.buyClicks ? Math.round((row.orders / row.buyClicks) * 100) : null;
        return (
          <article key={row.listingId} className="inscard">
            <header className="inscard__head">
              <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
              <div>
                <Link to={`/listing/${row.listingId}`} className="inscard__title">{row.title}</Link>
                <small>
                  {row.live ? '🟢 On sale' : '⚪ Off sale'}
                  {row.revenueMinor > 0 && <> · {formatMoney(row.revenueMinor, row.currency)} received</>}
                </small>
              </div>
              {rate !== null && (
                <span className="inscard__big" title="Of people who pressed Buy, how many placed the order">
                  {rate}%<small>went ahead</small>
                </span>
              )}
            </header>
            <div className="insbars">
              <Bar label="👀 Views" value={row.views} max={top} tone="aqua" />
              <Bar label="❤️ Saves" value={row.saves} max={top} tone="pink" />
              <Bar label="🛒 Pressed Buy" value={row.buyClicks} max={top} tone="warn" />
              <Bar label="📦 Orders" value={row.orders} max={top} tone="violet" />
              <Bar label="✅ Paid" value={row.paid} max={top} tone="ok" />
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Bar({ label, value, max, tone }: { label: string; value: number; max: number; tone: string }) {
  const width = value > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0;
  return (
    <div className="insbar">
      <span>{label}</span>
      <span className="insbar__track"><span className={`insbar__fill insbar__fill--${tone}`} style={{ width: `${width}%` }} /></span>
      <b>{value}</b>
    </div>
  );
}

function Leads({ data }: { data: InterestResponse }) {
  if (data.leads.length === 0) {
    return <EmptyState icon="💬" title="No one waiting on you">People who saved or pressed Buy but never ordered from you show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">Interested in your shop, never ordered. Most promising first.</p>
      <ul className="insleads">
        {data.leads.map((row) => (
          <li key={row.who.handle ?? row.who.name}>
            <span className="insleads__who"><PersonLink party={row.who} /><small>active {timeAgo(row.lastAt)}</small></span>
            <span className="insleads__tags">
              {row.saves > 0 && <span className="badge badge--pink">❤️ {row.saves} saved</span>}
              {row.checkouts > 0 && <span className="badge badge--warn">🛒 {row.checkouts} at Buy</span>}
            </span>
            <MessageButton who={row.who} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** When buyers act, in the viewer's own clock - the time to post and to follow up. */
function Timing({ data }: { data: InterestResponse }) {
  const { hours, days, total } = useMemo(() => {
    const hourCounts = Array.from({ length: 24 }, () => 0);
    const dayCounts = Array.from({ length: 7 }, () => 0);
    for (const at of data.activity) {
      const date = new Date(at);
      if (Number.isNaN(date.getTime())) continue;
      hourCounts[date.getHours()]! += 1;
      dayCounts[date.getDay()]! += 1;
    }
    return { hours: hourCounts, days: dayCounts, total: data.activity.length };
  }, [data.activity]);

  if (total === 0) {
    return <EmptyState icon="⏰" title="Not enough activity yet">Once people save and buy, the busiest hours show up here.</EmptyState>;
  }
  const peakHour = hours.indexOf(Math.max(...hours));
  const peakDay = days.indexOf(Math.max(...days));
  const maxHour = Math.max(1, ...hours);
  const maxDay = Math.max(1, ...days);
  const hourLabel = (hour: number) => `${hour % 12 || 12}${hour < 12 ? 'am' : 'pm'}`;

  return (
    <div className="stack">
      <div className="inspeak">
        <span>🔥 Busiest hour <b>{hourLabel(peakHour)}–{hourLabel((peakHour + 1) % 24)}</b></span>
        <span>📅 Busiest day <b>{DAYS[peakDay]}</b></span>
      </div>
      <p className="faint">Saves, Buy presses and orders by hour of day. Post new items just before the peak.</p>
      <div className="inshours" role="img" aria-label={`Busiest at ${hourLabel(peakHour)}`}>
        {hours.map((value, hour) => (
          <span key={hour} className={`inshours__col${hour === peakHour ? ' is-peak' : ''}`}
            title={`${hourLabel(hour)}: ${value}`}>
            <span style={{ height: `${Math.round((value / maxHour) * 100)}%` }} />
            <small>{hour % 3 === 0 ? hourLabel(hour) : ''}</small>
          </span>
        ))}
      </div>
      <div className="insbars">
        {days.map((value, day) => (
          <Bar key={day} label={DAYS[day]!} value={value} max={maxDay} tone={day === peakDay ? 'pink' : 'violet'} />
        ))}
      </div>
    </div>
  );
}

const TREND: Record<'new' | 'up' | 'steady' | 'down', { text: string; tone: string }> = {
  new: { text: '✨ New this week', tone: 'pink' },
  up: { text: '▲ Rising', tone: 'ok' },
  steady: { text: '■ Steady', tone: 'purple' },
  down: { text: '▼ Cooling', tone: 'warn' },
};

/** What people are going for this week, and what gets looks but no takers. */
function Trending({ data }: { data: InterestResponse }) {
  if (data.trending.length === 0 && data.overlooked.length === 0) {
    return <EmptyState icon="🔥" title="Nothing heating up yet">Items people save, press Buy on and order this week show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      {data.trending.length > 0 && (
        <>
          <p className="faint">Saves, Buy presses and orders in the last 7 days, against the 7 before. Hottest first.</p>
          {data.trending.map((row) => (
            <article key={row.listingId} className={`inscard${row.soldOut ? ' inscard--cart' : ''}`}>
              <header className="inscard__head">
                <Thumb seed={row.listingId} label={row.title} photo={row.photo ? { url: row.photo } : null} className="thumb insthumb" />
                <div>
                  <Link to={`/listing/${row.listingId}`} className="inscard__title">{row.title}</Link>
                  <small>
                    {[row.saves && `❤️ ${row.saves} saved`, row.buys && `🛒 ${row.buys} at Buy`, row.orders && `📦 ${row.orders} ordered`]
                      .filter(Boolean).join(' · ')}
                  </small>
                </div>
                <span className={`badge badge--${TREND[row.trend].tone}`}>{TREND[row.trend].text}</span>
              </header>
              {row.soldOut && (
                <div className="inscard__facts">
                  <span className="badge badge--warn">Sold out or ended — still wanted</span>
                  <span>Restock or relist it while people are looking.</span>
                </div>
              )}
            </article>
          ))}
        </>
      )}
      {data.overlooked.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>👀 Getting looks, no takers</h2>
            <span className="field__hint">Plenty of views, nobody saving or pressing Buy. Try a new price, photo or title.</span>
          </div>
          {data.overlooked.map((row) => (
            <div key={row.listingId} className="ins__row">
              <Link to={`/listing/${row.listingId}`} className="ins__name">{row.title}</Link>
              <span className="badge">{row.views} views</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type Segment = 'top' | 'returning' | 'new' | 'dormant';

const SEGMENT_TABS: { id: Segment; label: string; hint: string }[] = [
  { id: 'top', label: '🏆 Top spenders', hint: 'By what they have ordered from you.' },
  { id: 'returning', label: '🔁 Returning', hint: 'Ordered more than once. Your regulars.' },
  { id: 'new', label: '🌱 New', hint: 'First order in the last 30 days. A thank-you goes a long way.' },
  { id: 'dormant', label: '💤 Gone quiet', hint: 'Bought before, nothing in the last 60 days. Worth a hello.' },
];

/** Customers as relationships: regulars, newcomers, and the ones drifting away. */
function Customers({ data, lots }: { data: InterestResponse; lots: InsightsResponse | null }) {
  const [segment, setSegment] = useState<Segment>('top');
  const { customers } = data;
  if (customers.total === 0) {
    return <EmptyState icon="👥" title="No customers yet">Once people order, you will see who keeps coming back here.</EmptyState>;
  }
  const rows: Record<Segment, CustomerRow[]> = {
    top: customers.top,
    returning: customers.returningList,
    new: customers.newList,
    dormant: customers.dormantList,
  };
  const tab = SEGMENT_TABS.find((entry) => entry.id === segment)!;
  return (
    <div className="stack">
      <div className="tiles">
        <Tile value={String(customers.total)} label="Customers" />
        <Tile value={customers.repeatPercent === null ? '—' : `${customers.repeatPercent}%`} label="Come back" tone="green" />
        <Tile value={formatMoney(customers.avgOrderMinor, 'INR')} label="Average order" tone="blue" />
      </div>
      <div className="inssegs" role="tablist" aria-label="Customer groups">
        {SEGMENT_TABS.map((entry) => (
          <button key={entry.id} type="button" role="tab" aria-selected={segment === entry.id}
            className={`inscat${segment === entry.id ? ' is-on' : ''}`} onClick={() => setSegment(entry.id)}>
            {entry.label}
            <span className="inscat__n">
              {{ top: customers.total, returning: customers.returning, new: customers.newcomers, dormant: customers.dormant }[entry.id]}
            </span>
          </button>
        ))}
      </div>
      <p className="faint">{tab.hint}</p>
      {rows[segment].length === 0 ? (
        <p className="muted">Nobody here yet.</p>
      ) : (
        <ul className="insleads">
          {rows[segment].map((row) => (
            <li key={row.who.handle ?? row.who.name}>
              <span className="insleads__who">
                <PersonLink party={row.who} />
                <small>
                  {row.orders} order{row.orders === 1 ? '' : 's'} · last {timeAgo(row.lastAt)}
                  {segment !== 'new' && !row.returning && ' · one-time'}
                </small>
              </span>
              <b className="inscollect">{formatMoney(row.spentMinor, 'INR')}</b>
              <MessageButton who={row.who} />
            </li>
          ))}
        </ul>
      )}

      {lots && lots.cohorts.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>New against returning, lot by lot</h2>
            <span className="field__hint">Customers in each lot, and whether you had seen them before.</span>
          </div>
          <div className="legs">
            {lots.cohorts.map((row, index) => (
              <div key={`${row.lotName}:${index}`} className="coh">
                <span className="coh__name">{row.lotName}</span>
                <span className="coh__count">{row.newCount} new · {row.returningCount} back</span>
                <span className="coh__track">
                  <span className="coh__new" style={{ flexGrow: row.newCount }} />
                  <span className="coh__old" style={{ flexGrow: row.returningCount }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Boxes each open lot still needs, and who to pack together. */
function Packing({ data }: { data: InsightsResponse | null }) {
  if (!data || (data.boxes.byLot.length === 0 && data.bulk.length === 0)) {
    return (
      <EmptyState icon="📦" title="Nothing to pack">
        Once orders are filed into a lot, the boxes each lot needs show up here - one parcel per customer, sized off what is in it.
      </EmptyState>
    );
  }
  const { boxes, bulk } = data;
  return (
    <div className="stack">
      {boxes.byLot.length > 0 && (
        <>
          <div className="tiles">
            <Tile value={String(boxes.small)} label="Small" />
            <Tile value={String(boxes.medium)} label="Medium" tone="blue" />
            <Tile value={String(boxes.large)} label="Large" tone="green" />
          </div>
          <p className="faint">One parcel per customer per lot. A customer drops out once theirs is packed.</p>
          {boxes.byLot.map((row) => (
            <article key={row.lotId} className="inscard">
              <header className="inscard__head inscard__head--plain">
                <div>
                  <span className="inscard__title">{row.lotName}</span>
                  <small>{row.total} box{row.total === 1 ? '' : 'es'} to pack</small>
                </div>
              </header>
              <div className="insboxes">
                <span><b>{row.small}</b> small</span>
                <span><b>{row.medium}</b> medium</span>
                <span><b>{row.large}</b> large</span>
              </div>
            </article>
          ))}
        </>
      )}
      {bulk.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Worth packing together</h2>
            <span className="field__hint">Several items in one lot, going to one person — one parcel, not three.</span>
          </div>
          {bulk.map((row) => (
            <div key={`${row.buyerId}:${row.lotName}`} className="ins__row">
              <span style={{ minWidth: 0 }}>
                <PersonLink party={row.who} />
                <span className="faint"> · {row.lotName}</span>
              </span>
              <span className="badge">{row.count} items</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A stretch of time in the unit that suits it. */
function days(value: number): string {
  if (value >= 1) return `${value.toFixed(1)}d`;
  const hours = value * 24;
  return hours >= 1 ? `${Math.round(hours)}h` : 'same day';
}

/** Where each consignment is, where time goes, and how sales and pre-orders did. */
function Lots({ data }: { data: InsightsResponse | null }) {
  if (!data || (data.perLot.length === 0 && data.preOrders.length === 0 && data.powerSales.runs === 0)) {
    return (
      <EmptyState icon="🚚" title="No lots moving yet">
        Open a lot and file some orders into it. These figures are counted off the checkpoints you tick.
      </EmptyState>
    );
  }
  const { headline, timings, perLot, preOrders } = data;
  const sales = data.powerSales;
  // Bars are drawn against the slowest leg, so the one to fix fills the row.
  const measured = SEGMENTS.filter((segment) => timings[segment] !== null);
  const slowest = Math.max(0.1, ...measured.map((segment) => timings[segment]!));
  return (
    <div className="stack">
      <div className="tiles">
        <Tile value={formatMoney(headline.valueInFlightMinor)} label="Value moving" />
        <Tile value={String(headline.openLots)} label="Lots open" tone="blue" />
        <Tile value={String(data.repeat)} label="Bought across lots" tone="green" />
      </div>

      {measured.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Time in each stage</h2>
            <span className="field__hint">Average days, across every order you have moved. The long one is where to push.</span>
          </div>
          <div className="legs">
            {measured.map((segment) => (
              <div key={segment} className="leg">
                <span className="leg__label">{SEGMENT_LABELS[segment]}</span>
                <span className="leg__days">{days(timings[segment]!)}</span>
                <span className="leg__track">
                  <span className="leg__fill" style={{ width: `${Math.max(3, (timings[segment]! / slowest) * 100)}%` }} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {perLot.length > 0 && (
        <div className="card card--pad stack">
          <div>
            <h2>Lot by lot</h2>
            <span className="field__hint">Where each consignment actually is, and what is riding on it.</span>
          </div>
          {perLot.map((row) => (
            <div key={row.lotId} className="ins__lot">
              <div className="ins__row">
                <span className="ins__name">{row.lotName}</span>
                <span className="badge">{row.progress}%</span>
              </div>
              <span className="faint">{PHASE_LABELS[row.phase]}</span>
              <span className="ins__track"><span className="ins__fill" style={{ width: `${row.progress}%` }} /></span>
              <div className="ins__meta">
                <span>{formatMoney(row.valueMinor)}</span>
                <span className="faint">
                  {row.customers} customer{row.customers === 1 ? '' : 's'} · {row.orders} order{row.orders === 1 ? '' : 's'}
                </span>
                {row.unpaidMinor > 0 && <span className="ins__owed">{formatMoney(row.unpaidMinor)} unpaid</span>}
                {row.doorToDoor !== null && <span className="faint">{days(row.doorToDoor)} door to door</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      {(sales.runs > 0 || preOrders.length > 0) && (
        <div className="card card--pad stack">
          <div>
            <h2>Sales and pre-orders</h2>
            <span className="field__hint">What the channel did, and which pre-orders got there.</span>
          </div>
          {sales.runs > 0 && (
            <div className="tiles">
              <Tile value={String(sales.posted)} label="Items dropped" />
              <Tile value={String(sales.inWindow)} label="In the window" tone="blue" />
              <Tile value={String(sales.handedOver)} label="Moved to the shop" tone="green" />
            </div>
          )}
          {preOrders.map((row) => {
            const percent = Math.min(100, Math.round(((row.booked + row.pledged) / Math.max(1, row.threshold)) * 100));
            return (
              <div key={row.listingId} className="ins__lot">
                <div className="ins__row">
                  <Link to={`/listing/${row.listingId}`} className="ins__name">{row.title}</Link>
                  <span className={`badge${row.filled ? ' badge--ok' : row.closedShort ? ' badge--warn' : ''}`}>
                    {row.filled ? 'Filled' : row.closedShort ? 'Closed short' : `${percent}%`}
                  </span>
                </div>
                <span className="ins__track"><span className="ins__fill" style={{ width: `${percent}%` }} /></span>
                <span className="faint">
                  {row.booked} paid{row.pledged > 0 && ` · ${row.pledged} pledged`} of {row.threshold} needed
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
