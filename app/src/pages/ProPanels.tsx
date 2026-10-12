import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type CostsResponse, type DeepResponse, type InterestResponse, type ValueLabel } from '../api';
import { formatDate, formatMoney, timeAgo } from '../format';
import { NudgeButton } from '../components/NudgeButton';
import { EmptyState, PersonLink, Thumb, Tile } from '../components/ui';
import { bookTotals } from './ProfitBook';

/**
 * The deeper Insights (Pro) views: retention and customer value, price changes, the next-lot forecast, wishlist
 * reminders, what sells together, returns, and the weekly digest.
 */

const money = (minor: number) => formatMoney(minor, 'INR');

/* ── Retention and value ─────────────────────────────────────────────────── */

const VALUE_TABS: { id: ValueLabel; label: string; hint: string }[] = [
  { id: 'vip', label: '👑 VIP', hint: 'Your top tenth by spend, still ordering.' },
  { id: 'regular', label: '🔁 Regular', hint: 'Order more than once, on their usual rhythm.' },
  { id: 'at_risk', label: '⚠️ At risk', hint: 'Regulars who have gone well past their usual gap.' },
  { id: 'one_time', label: '1️⃣ One-time', hint: 'One order, more than 30 days ago.' },
  { id: 'new', label: '🌱 New', hint: 'First order in the last 30 days.' },
];

const monthName = (month: string) =>
  new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

export function Loyalty({ deep }: { deep: DeepResponse }) {
  const [tab, setTab] = useState<ValueLabel>('vip');
  const { cohorts, value } = deep;
  if (cohorts.length === 0) {
    return <EmptyState icon="🔁" title="No customers yet">Once people order, you will see who comes back here.</EmptyState>;
  }
  const rows = value.rows.filter((row) => row.label === tab);
  const entry = VALUE_TABS.find((row) => row.id === tab)!;
  return (
    <div className="stack">
      <section className="card card--pad stack">
        <div>
          <h2>Who comes back</h2>
          <span className="field__hint">Of the people who first ordered in each month, the share who ordered again 1, 2 and 3 months later.</span>
        </div>
        <div className="coh__table" role="table">
          <div className="coh__tr coh__tr--head" role="row">
            <span role="columnheader">First order</span><span role="columnheader">People</span>
            <span role="columnheader">+1 mo</span><span role="columnheader">+2 mo</span><span role="columnheader">+3 mo</span>
          </div>
          {cohorts.map((row) => (
            <div key={row.month} className="coh__tr" role="row">
              <span role="cell">{monthName(row.month)}</span>
              <span role="cell">{row.size}</span>
              {row.back.map((share, at) => (
                <span key={at} role="cell" className="coh__cell"
                  style={share === null ? undefined : { background: `rgba(52, 211, 153, ${0.08 + (share / 100) * 0.6})` }}>
                  {share === null ? '·' : `${share}%`}
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="card card--pad stack">
        <div>
          <h2>What each customer is worth</h2>
          <span className="field__hint">Average lifetime spend {money(value.averageMinor)}.</span>
        </div>
        <div className="inssegs" role="tablist" aria-label="Customer value">
          {VALUE_TABS.map((row) => (
            <button key={row.id} type="button" role="tab" aria-selected={tab === row.id}
              className={`inscat${tab === row.id ? ' is-on' : ''}`} onClick={() => setTab(row.id)}>
              {row.label} <span className="inscat__n">{value.counts[row.id]}</span>
            </button>
          ))}
        </div>
        <p className="faint">{entry.hint}</p>
        {rows.length === 0 ? <p className="muted">Nobody here.</p> : (
          <ul className="insleads">
            {rows.map((row) => (
              <li key={row.who.handle ?? row.who.name}>
                <span className="insleads__who">
                  <PersonLink party={row.who} />
                  <small>{row.orders} order{row.orders === 1 ? '' : 's'} · last {timeAgo(row.lastAt)}</small>
                </span>
                <b className="inscollect">{money(row.spentMinor)}</b>
                {row.who.handle && <Link to={`/messages/${encodeURIComponent(row.who.handle)}`} className="btn btn--sm insmsg">💬 Message</Link>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Price changes ───────────────────────────────────────────────────────── */

export function Pricing({ deep }: { deep: DeepResponse }) {
  if (deep.pricing.length === 0) {
    return (
      <EmptyState icon="🏷️" title="No price changes yet">
        When you change an item's price, you will see how saves and sales moved at each price here.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <p className="faint">Each price an item has had, and how it sold while it was at that price.</p>
      {deep.pricing.map((item) => {
        const best = Math.max(...item.periods.map((period) => period.perWeek));
        return (
          <article key={item.listingId} className="inscard">
            <header className="inscard__head">
              <Thumb seed={item.listingId} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb insthumb" />
              <div><Link to={`/listing/${item.listingId}`} className="inscard__title">{item.title}</Link></div>
            </header>
            <div className="insprices">
              {item.periods.map((period, at) => {
                const previous = item.periods[at - 1];
                const move = previous ? (period.priceMinor > previous.priceMinor ? '▲' : '▼') : '';
                return (
                  <div key={period.from} className={`insprices__row${best > 0 && period.perWeek === best ? ' is-best' : ''}`}>
                    <b>{move} {formatMoney(period.priceMinor, item.currency)}</b>
                    <small>from {formatDate(period.from)} · {period.days}d</small>
                    <span>❤️ {period.saves}</span>
                    <span>🛒 {period.units}</span>
                    <span className="badge">{period.perWeek}/wk</span>
                  </div>
                );
              })}
            </div>
          </article>
        );
      })}
    </div>
  );
}

/* ── Forecast ────────────────────────────────────────────────────────────── */

export function Forecast({ deep }: { deep: DeepResponse }) {
  const { rows, cycleDays, conversionPercent } = deep.forecast;
  if (rows.length === 0) {
    return <EmptyState icon="🔮" title="Not enough to go on yet">Once items sell or get saved, a suggested quantity for the next lot shows here.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">
        How many to bring in the next lot: the last 4 weeks' sales carried over your usual {cycleDays}-day gap between lots,
        plus {conversionPercent}% of the people who saved it and have not bought (your save-to-order rate), plus pledges.
      </p>
      <ul className="insleads">
        {rows.map((row) => (
          <li key={row.listingId}>
            <span className="insleads__who">
              <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
              <small>
                {row.perWeek}/wk · {row.waiting} waiting{row.pledged ? ` · ${row.pledged} pledged` : ''}
                {row.inStock !== null ? ` · ${row.inStock} in stock` : ''}
              </small>
            </span>
            <b className="inscollect">≈ {row.next}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Wishlist reminders ──────────────────────────────────────────────────── */

export function Reminders({ deep, shop }: { deep: DeepResponse; shop?: string }) {
  if (deep.reminders.length === 0) {
    return (
      <EmptyState icon="🔔" title="Nobody to remind">
        People who saved an item that has since come back in stock or dropped in price show up here.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      <p className="faint">Saved it, never bought it - and it is back, or cheaper now. One reminder a day at most.</p>
      <ul className="insleads">
        {deep.reminders.map((row) => (
          <li key={`${row.buyerId}:${row.listingId}`}>
            <span className="insleads__who">
              <PersonLink party={row.who} />
              <small>
                <Link to={`/listing/${row.listingId}`}>{row.title}</Link> · saved {timeAgo(row.savedAt)}
              </small>
            </span>
            <span className="insleads__tags">
              {row.reason === 'cheaper' ? (
                <span className="badge badge--ok">{formatMoney(row.wasMinor, row.currency)} → {formatMoney(row.nowMinor, row.currency)}</span>
              ) : <span className="badge badge--aqua">Back in stock</span>}
            </span>
            <NudgeButton request={{ kind: 'saved', listingId: row.listingId, buyerId: row.buyerId }} shop={shop} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Bought together ─────────────────────────────────────────────────────── */

export function Bundles({ deep }: { deep: DeepResponse }) {
  if (deep.bundles.length === 0) {
    return <EmptyState icon="🧺" title="No pairs yet">Items two or more people bought within a week of each other show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      <p className="faint">Bought by the same person within a week. Worth offering as a set, or listing side by side.</p>
      {deep.bundles.map((pair) => (
        <article key={pair.items.map((item) => item.listingId).join('|')} className="inscard insbundle">
          {pair.items.map((item, at) => (
            <span key={item.listingId} className="insbundle__item">
              {at > 0 && <b className="insbundle__plus" aria-hidden="true">+</b>}
              <Thumb seed={item.listingId} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb insthumb" />
              <Link to={`/listing/${item.listingId}`}>{item.title}</Link>
            </span>
          ))}
          <span className="badge badge--accent">{pair.count} people</span>
        </article>
      ))}
    </div>
  );
}

/* ── Returns and cancellations ───────────────────────────────────────────── */

export function Returns({ deep }: { deep: DeepResponse }) {
  const { overall, items, categories } = deep.returns;
  if (overall.orders === 0) {
    return <EmptyState icon="↩️" title="No orders yet">Cancellations and disputes by item show up here.</EmptyState>;
  }
  return (
    <div className="stack">
      <div className="tiles">
        <Tile value={`${overall.ratePercent}%`} label="Problem rate" />
        <Tile value={String(overall.cancelled)} label="Cancelled or refunded" tone="blue" />
        <Tile value={String(overall.disputed)} label="Disputed" tone="green" />
      </div>
      <section className="card card--pad stack">
        <h2>By category</h2>
        {categories.map((row) => (
          <div key={row.category} className="insbar">
            <span>{row.category}</span>
            <span className="insbar__track">
              <span className={`insbar__fill insbar__fill--${row.ratePercent >= 20 ? 'warn' : 'violet'}`} style={{ width: `${Math.max(row.ratePercent ? 3 : 0, row.ratePercent)}%` }} />
            </span>
            <b>{row.ratePercent}%</b>
          </div>
        ))}
      </section>
      <section className="card card--pad stack">
        <div>
          <h2>Items with problems</h2>
          <span className="field__hint">A high rate usually means the photos or description promise something the item is not.</span>
        </div>
        {items.length === 0 ? <p className="muted">No item has been cancelled or disputed.</p> : (
          <ul className="insleads">
            {items.map((row) => (
              <li key={row.listingId}>
                <span className="insleads__who">
                  <Link to={`/listing/${row.listingId}`}>{row.title}</Link>
                  <small>{row.orders} orders · {row.cancelled} cancelled · {row.disputed} disputed</small>
                </span>
                <span className={`badge badge--${row.ratePercent >= 20 ? 'danger' : 'warn'}`}>{row.ratePercent}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/* ── Weekly digest ───────────────────────────────────────────────────────── */

/** Monday of this week, for the digest's heading. */
function weekStart(): Date {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date;
}

/**
 * The week in one card: what went well, what needs watching, and the three
 * things most worth doing - so a shop that opens Insights once a week still
 * catches what matters.
 */
export function Digest({ data, deep, costs }: { data: InterestResponse; deep: DeepResponse | null; costs: CostsResponse | null }) {
  const { week } = data;
  const wins: string[] = [];
  const risks: string[] = [];
  const actions: string[] = [];

  if (week.now.revenueMinor > week.before.revenueMinor) {
    wins.push(`Orders worth ${money(week.now.revenueMinor)}, up from ${money(week.before.revenueMinor)}`);
  } else if (week.now.revenueMinor < week.before.revenueMinor) {
    risks.push(`Orders worth ${money(week.now.revenueMinor)}, down from ${money(week.before.revenueMinor)}`);
  }
  const top = data.trending[0];
  if (top) wins.push(`${top.title} is your hottest item`);
  if (data.customers.newcomers > 0) wins.push(`${data.customers.newcomers} new customer${data.customers.newcomers === 1 ? '' : 's'} this month`);
  const profit = costs ? bookTotals(costs.rows).profitMinor : 0;
  if (profit > 0) wins.push(`${money(profit)} profit on costed items so far`);

  const soldOut = data.trending.filter((row) => row.soldOut).length;
  if (soldOut) risks.push(`${soldOut} wanted item${soldOut === 1 ? ' is' : 's are'} sold out`);
  const atRisk = deep?.value.counts.at_risk ?? 0;
  if (atRisk) risks.push(`${atRisk} regular${atRisk === 1 ? ' is' : 's are'} overdue for an order`);
  const badReturns = deep?.returns.items.filter((row) => row.ratePercent >= 20).length ?? 0;
  if (badReturns) risks.push(`${badReturns} item${badReturns === 1 ? ' has' : 's have'} a high cancel rate`);

  if (data.summary.stalled) actions.push(`Nudge ${data.summary.stalled} ${data.summary.stalled === 1 ? 'person' : 'people'} who stopped at Buy`);
  if (deep?.reminders.length) actions.push(`Remind ${deep.reminders.length} who saved something now back or cheaper`);
  const nextBuy = deep?.forecast.rows[0];
  if (nextBuy) actions.push(`Plan about ${nextBuy.next} of ${nextBuy.title} for the next lot`);
  const uncosted = costs?.sheets.filter((row) => !row.sheet && row.sold > 0).length ?? 0;
  if (uncosted) actions.push(`Add costs to ${uncosted} item${uncosted === 1 ? '' : 's'} that sold, to see real profit`);

  const monday = weekStart();
  return (
    <section className="card card--pad stack insdigest">
      <div>
        <h2>🗞️ Weekly digest</h2>
        <span className="field__hint">Week of {monday.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · last 7 days against the 7 before</span>
      </div>
      <div className="insdigest__cols">
        <div>
          <b className="insdigest__head insdigest__head--ok">Wins</b>
          {wins.length ? <ul>{wins.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="faint">A quiet week.</p>}
        </div>
        <div>
          <b className="insdigest__head insdigest__head--warn">Watch</b>
          {risks.length ? <ul>{risks.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ul> : <p className="faint">Nothing worrying.</p>}
        </div>
        <div>
          <b className="insdigest__head insdigest__head--violet">Do next</b>
          {actions.length ? <ol>{actions.slice(0, 3).map((line) => <li key={line}>{line}</li>)}</ol> : <p className="faint">All caught up.</p>}
        </div>
      </div>
    </section>
  );
}
