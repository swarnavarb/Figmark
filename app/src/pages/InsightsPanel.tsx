import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { ApiRequestError, api, type InterestResponse, type PartyRef } from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { EmptyState, ErrorNotice, PersonLink, Thumb } from '../components/ui';

/**
 * Insights (Pro): who wants what, before and after they buy.
 *
 * The order book only shows what became an order. This is everything around
 * it - who saved an item, who pressed Buy and stopped at the checkout, how
 * each item turns a look into a payment, who is worth a message, and what is
 * still owed - so a shop can act on interest instead of waiting for it.
 */

type Category = 'saved' | 'checkout' | 'funnel' | 'leads' | 'collect' | 'timing';

const CATEGORIES: { id: Category; icon: string; label: string }[] = [
  { id: 'saved', icon: '❤️', label: 'Saved' },
  { id: 'checkout', icon: '🛒', label: 'Stopped at Buy' },
  { id: 'funnel', icon: '📈', label: 'Item funnel' },
  { id: 'leads', icon: '💬', label: 'Worth a message' },
  { id: 'collect', icon: '💰', label: 'To collect' },
  { id: 'timing', icon: '⏰', label: 'Best time' },
];

export function InsightsPanel({ store }: { store: StoreAccess }) {
  const [data, setData] = useState<InterestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>('saved');

  useEffect(() => {
    void api.interest(store.isOwner ? undefined : store.ownerId)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load insights.'));
  }, [store.isOwner, store.ownerId]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  const { summary } = data;
  const count: Record<Category, number | null> = {
    saved: summary.saves,
    checkout: summary.stalled,
    funnel: null,
    leads: data.leads.length,
    collect: data.toCollect.length,
    timing: null,
  };

  return (
    <div className="stack ins">
      <section className="inshero">
        <div className="inshero__title">
          <h2>✨ Insights <span className="probadge">PRO</span></h2>
          <p>Who is looking, who is saving, and who stopped just short of buying.</p>
        </div>
        <div className="insfunnel" aria-label="From a look to a payment">
          <Stage icon="👀" label="Views" value={summary.views} />
          <Stage icon="❤️" label="Saves" value={summary.saves} />
          <Stage icon="🛒" label="Pressed Buy" value={summary.buyClicks} />
          <Stage icon="📦" label="Orders" value={summary.orders}
            hint={summary.placedPercent === null ? undefined : `${summary.placedPercent}% went ahead`} />
          <Stage icon="✅" label="Paid in full" value={summary.paid} />
        </div>
        {(summary.stalled > 0 || summary.toCollectMinor > 0) && (
          <div className="inshero__alerts">
            {summary.stalled > 0 && (
              <button type="button" className="insalert insalert--cart" onClick={() => setCategory('checkout')}>
                🛒 {summary.stalled} stopped at Buy · {formatMoney(summary.stalledMinor, 'INR')} not yet ordered
              </button>
            )}
            {summary.toCollectMinor > 0 && (
              <button type="button" className="insalert insalert--money" onClick={() => setCategory('collect')}>
                💰 {formatMoney(summary.toCollectMinor, 'INR')} still to collect
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
      {category === 'leads' && <Leads data={data} />}
      {category === 'collect' && <Collect data={data} />}
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
  const top = Math.max(1, ...data.items.map((row) => row.views));
  return (
    <div className="stack">
      <p className="faint">Your most-wanted items, and how many people moved from looking to paying.</p>
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

function Collect({ data }: { data: InterestResponse }) {
  if (data.toCollect.length === 0) {
    return <EmptyState icon="💰" title="Nothing owed">Every accepted order is paid up.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">Balances on orders you have accepted, by buyer. Largest first.</p>
      <ul className="insleads">
        {data.toCollect.map((row) => (
          <li key={row.who.handle ?? row.who.name}>
            <span className="insleads__who">
              <PersonLink party={row.who} />
              <small>{row.orders} order{row.orders === 1 ? '' : 's'}</small>
            </span>
            <b className="inscollect">{formatMoney(row.outstandingMinor, row.currency)}</b>
            <MessageButton who={row.who} />
          </li>
        ))}
      </ul>
      <Link to="/shop?tab=payments" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}>Open Orders →</Link>
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
