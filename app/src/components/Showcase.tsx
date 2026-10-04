import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { countryFlag } from '@shared/countries';
import { ApiRequestError, api, type DropCardData, type FillingLot } from '../api';
import { formatMoney } from '../format';
import { useSession } from '../session';
import { Svg } from './ListingBlocks';
import { Thumb } from './ui';

/**
 * The two Buy-tab shelves that sell an event, each telling its own story.
 *
 * Drops is a stage: lights round the edge, a curtain still shut, a clock
 * counting down to the first item, and a bell to be told when the curtain
 * goes up. When it does, the curtain parts and the card goes live.
 *
 * Boxes filling up is a packing line: open cartons riding a conveyor belt,
 * the shop's items dropping into them one after another, and the number of
 * people already in each on its side - the box is filling, and there is room.
 */

/* ── Shared clock ──────────────────────────────────────────────────────── */

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/** Hours, minutes, seconds until a time - zeros once it has passed. */
function parts(until: string | null, now: number) {
  const left = until ? Math.max(0, Math.floor((Date.parse(until) - now) / 1000)) : 0;
  return {
    left,
    h: String(Math.floor(left / 3600)).padStart(2, '0'),
    m: String(Math.floor((left % 3600) / 60)).padStart(2, '0'),
    s: String(left % 60).padStart(2, '0'),
  };
}

/** A wait in the fewest units that still say it: 2d 4h, 3h 12m, 4:05. */
function span(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

/* ── Drops: the stage ──────────────────────────────────────────────────── */

/** The bell: on, off, or off to a guest who is asked to sign in first. */
function useReminder(drop: DropCardData, onChange: (next: DropCardData) => void) {
  const { user, promptAuth } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rang, setRang] = useState(0);
  async function toggle() {
    if (!user) { promptAuth('Sign in to be reminded when this drop starts.'); return; }
    setBusy(true);
    setError(null);
    try {
      const { drop: next } = await api.remindDrop(drop.sellerId, drop.id, !drop.reminded);
      if (next.reminded) setRang((count) => count + 1);
      onChange(next);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not set that reminder.');
    } finally {
      setBusy(false);
    }
  }
  return { toggle, busy, error, rang };
}

function RemindButton({ drop, onChange, compact = false }: {
  drop: DropCardData;
  onChange: (next: DropCardData) => void;
  compact?: boolean;
}) {
  const { toggle, busy, error, rang } = useReminder(drop, onChange);
  return (
    <>
      <button type="button" className={`remind${drop.reminded ? ' is-on' : ''}${compact ? ' remind--sm' : ''}`}
        aria-pressed={drop.reminded} disabled={busy} onClick={(event) => { event.preventDefault(); void toggle(); }}>
        <span key={rang} className={`remind__bell${rang ? ' is-ringing' : ''}`} aria-hidden="true">🔔</span>
        {drop.reminded ? 'We will remind you' : 'Remind me'}
        {drop.reminders > 0 && <span className="remind__count">{drop.reminders}</span>}
      </button>
      {error && <span className="remind__err">{error}</span>}
    </>
  );
}

/** Three flip tiles: hours, minutes, seconds. */
function FlipClock({ until, now }: { until: string; now: number }) {
  const { h, m, s } = parts(until, now);
  return (
    <span className="flip" role="timer" aria-label={`Starts in ${Number(h)} hours ${Number(m)} minutes ${Number(s)} seconds`}>
      {[h, m, s].map((value, index) => (
        <span key={index} className="flip__unit">
          <span key={value} className="flip__tile">{value}</span>
          <span className="flip__label">{['hrs', 'min', 'sec'][index]}</span>
        </span>
      ))}
    </span>
  );
}

/** One drop, as a ticket on the stage. */
function DropTicket({ drop: initial, index }: { drop: DropCardData; index: number }) {
  const [drop, setDrop] = useState(initial);
  useEffect(() => setDrop(initial), [initial]);
  const now = useNow(true);
  const startsIn = parts(drop.startsAt, now).left;
  // The curtain goes up the second the clock runs out, without waiting for
  // the server to say so - the channel is where the first item lands.
  const live = drop.live || startsIn === 0;
  const next = parts(drop.nextAt, now);
  const currency = 'INR';

  return (
    <article className={`ticket${live ? ' is-live' : ''}`} style={{ ['--i' as string]: index }}>
      <span className="ticket__curtain ticket__curtain--l" aria-hidden="true" />
      <span className="ticket__curtain ticket__curtain--r" aria-hidden="true" />
      <div className="ticket__inner">
        <span className="ticket__top">
          {live
            ? <span className="ticket__live"><span className="ticket__dot" /> LIVE</span>
            : <span className="ticket__soon">⚡ Drop</span>}
          <span className="ticket__shop">{drop.shop.name}</span>
        </span>
        <b className="ticket__name">{drop.name}</b>
        {!live ? (
          <>
            <span className="ticket__when">Curtain up in</span>
            <FlipClock until={drop.startsAt} now={now} />
          </>
        ) : (
          <span className="ticket__when">
            Drop {Math.max(1, drop.itemsOut)}/{drop.itemCount}
            {next.left > 0 ? <> · next in <b>{span(next.left)}</b></> : ' · dropping now'}
          </span>
        )}
        <ul className="ticket__preview">
          {drop.preview.map((item, at) => (
            <li key={at} className={item.out || live ? 'is-out' : ''}>
              <span className="ticket__item">{item.out || at === 0 ? item.title : 'Mystery item'}</span>
              <span className="ticket__price">
                {formatMoney(item.priceMinor, currency)}
                {item.listPriceMinor > item.priceMinor && <s>{formatMoney(item.listPriceMinor, currency)}</s>}
              </span>
            </li>
          ))}
          {drop.itemCount > drop.preview.length && <li className="ticket__more">+{drop.itemCount - drop.preview.length} more</li>}
        </ul>
        <span className="ticket__perf" aria-hidden="true" />
        <span className="ticket__acts">
          {live
            ? <Link to={drop.channel} className="ticket__go">Jump in →</Link>
            : <RemindButton drop={drop} onChange={setDrop} />}
          {!live && <Link to={drop.channel} className="ticket__chan">Channel</Link>}
        </span>
      </div>
    </article>
  );
}

/**
 * Drops: every sale whose opening message has gone out in its channel and
 * that is not over yet. Hidden entirely when there are none.
 */
export function DropsStage() {
  const [drops, setDrops] = useState<DropCardData[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => api.drops().then((result) => alive && setDrops(result.drops)).catch(() => alive && setDrops([]));
    void load();
    // A drop announced while the tab is open appears without a reload.
    const timer = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);
  if (!drops || drops.length === 0) return null;

  return (
    <section className="stage" aria-label="Drops">
      <span className="stage__bulbs" aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => <span key={i} style={{ ['--b' as string]: i }} />)}
      </span>
      <span className="stage__spot" aria-hidden="true" />
      <div className="stage__head">
        <h2>⚡ Drops</h2>
        <span>Live sales from shops' channels. Get a reminder before the curtain goes up.</span>
      </div>
      <div className="stage__row">
        {drops.map((drop, index) => <DropTicket key={drop.id} drop={drop} index={index} />)}
      </div>
    </section>
  );
}

/**
 * The same countdown and bell on the opening message in the channel itself,
 * so whoever reads the announcement there can be reminded too.
 */
export function OpeningCard({ sellerId, saleId, startsAt, saleName, itemCount }: {
  sellerId: string;
  saleId: string;
  startsAt: string;
  saleName: string;
  itemCount: number;
}) {
  const [drop, setDrop] = useState<DropCardData | null>(null);
  useEffect(() => {
    void api.drop(sellerId, saleId).then((result) => setDrop(result.drop)).catch(() => setDrop(null));
  }, [sellerId, saleId]);
  const now = useNow(true);
  const left = parts(startsAt, now).left;
  return (
    <span className={`opening${left === 0 ? ' is-live' : ''}`}>
      <span className="opening__top">
        <b>⚡ {saleName}</b>
        <span className="faint">{itemCount} {itemCount === 1 ? 'item' : 'items'}</span>
      </span>
      {left > 0 ? (
        <>
          <span className="opening__when">First drop in</span>
          <FlipClock until={startsAt} now={now} />
          {drop && <span className="opening__acts"><RemindButton drop={drop} onChange={setDrop} compact /></span>}
        </>
      ) : (
        <span className="opening__when"><span className="ticket__dot" /> It has started — drops land right here.</span>
      )}
    </span>
  );
}

/* ── Boxes filling up: the warehouse floor ─────────────────────────────── */

function lane(lot: FillingLot): string | null {
  if (!lot.originCountry && !lot.destinationCountry) return null;
  return `${countryFlag(lot.originCountry) || '?'} → ${countryFlag(lot.destinationCountry) || '?'}`;
}

/** Specks of dust rising off the floor: [left %, delay s]. */
const DUST = [[5, 0], [14, 1.8], [26, 0.7], [37, 2.6], [49, 1.2], [61, 3.1], [72, 0.3], [84, 2.1], [95, 1.5]] as const;
/** How often the next item drops into every box. */
const DROP_EVERY = 2600;

/**
 * Boxes filling up: lots still taking orders that something can be bought
 * into, busiest first, riding a conveyor belt. Every couple of seconds the
 * next of each lot's items drops into its box, the box bumps, and a +1 pops
 * out of it. Hidden when there are none.
 */
export function FillingBoxes({ lots }: { lots: FillingLot[] }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (lots.length === 0 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setTick((n) => n + 1), DROP_EVERY);
    return () => window.clearInterval(timer);
  }, [lots.length]);
  if (lots.length === 0) return null;
  // Enough boxes to cover a wide screen, then the lot again so the loop has no seam.
  let line = lots;
  while (line.length < 6) line = [...line, ...lots];
  const loop = [...line, ...line];
  return (
    <section className="rail rail--belt" aria-label="Boxes filling up">
      <span className="belt__bg" aria-hidden="true">
        <i className="belt__beam" /><i className="belt__beam" />
        {DUST.map(([left, delay], n) => (
          <i key={n} className="belt__dust" style={{ left: `${left}%`, animationDelay: `${-delay}s` }} />
        ))}
      </span>
      <header className="rail__head">
        <span className="rail__icon"><Svg name="box" size={18} /></span>
        <span className="rail__titles">
          <h2>Boxes filling up</h2>
          <small>Shared shipments still taking orders. Hop in before the box is taped shut</small>
        </span>
      </header>
      <div className="belt">
        <div className="belt__run" style={{ ['--n' as string]: line.length }}>
          {loop.map((lot, n) => {
            const echo = n >= lots.length;
            const item = lot.listings.length ? lot.listings[(tick + n) % lot.listings.length] : null;
            const first = lot.listings[0];
            return (
              <Link key={n} to={first ? `/listing/${first.id}` : `/${lot.shop.handle ?? ''}`} className={`crate${echo ? ' is-echo' : ''}`}
                aria-hidden={echo || undefined} tabIndex={echo ? -1 : undefined}
                aria-label={echo ? undefined : `${lot.name}, ${lot.people} ${lot.people === 1 ? 'person' : 'people'} in`}>
                <span key={tick} className="crate__carton" style={{ ['--d' as string]: `${(n % 6) * 0.22}s` }}>
                  {item && (
                    <Thumb seed={item.id} label={item.title} photo={item.photoUrl ? { url: item.photoUrl } : null}
                      className="thumb crate__drop" />
                  )}
                  <span className="crate__box">
                    <span className="crate__stamp">LOT {lot.number}</span>
                    <span className="crate__label"><b>{lot.people}</b><small>{lot.people === 1 ? 'person in' : 'people in'}</small></span>
                    <span className="crate__plus">+1</span>
                  </span>
                </span>
                <span className="crate__name">{lot.name}</span>
                <span className="crate__shop">{lot.shop.name}{lane(lot) && ` · ${lane(lot)}`}</span>
              </Link>
            );
          })}
        </div>
        <span className="belt__floor" aria-hidden="true" />
      </div>
    </section>
  );
}

/** The lots, loaded once for the feed. */
export function useFillingLots(): FillingLot[] {
  const [lots, setLots] = useState<FillingLot[]>([]);
  useEffect(() => {
    void api.fillingLots().then((result) => setLots(result.lots)).catch(() => setLots([]));
  }, []);
  return lots;
}
