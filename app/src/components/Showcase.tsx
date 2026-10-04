import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { countryFlag } from '@shared/countries';
import { ApiRequestError, api, type DropCardData, type FillingLot } from '../api';
import { formatDate, formatMoney } from '../format';
import { useSession } from '../session';
import { Thumb } from './ui';

/**
 * The two Buy-tab shelves that sell an event, each telling its own story.
 *
 * Drops is a stage: lights round the edge, a curtain still shut, a clock
 * counting down to the first item, and a bell to be told when the curtain
 * goes up. When it does, the curtain parts and the card goes live.
 *
 * Boxes filling up is a warehouse floor: open cartons rolling in on a belt,
 * the shop's items dropping into them one by one, and the number of people
 * already in each ticking up - the box is filling, and there is room for you.
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

/** Starts its story once it is on screen, so nothing plays to an empty room. */
function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const watch = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); watch.disconnect(); }
    }, { threshold: 0.25 });
    watch.observe(node);
    return () => watch.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** A number that counts up from zero the first time it is seen. */
function CountUp({ to, run }: { to: number; run: boolean }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!run) return undefined;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || to <= 1) { setShown(to); return undefined; }
    let frame = 0;
    const start = performance.now();
    const step = (time: number) => {
      const done = Math.min(1, (time - start) / 1100);
      setShown(Math.round(to * (1 - (1 - done) ** 3)));
      if (done < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [to, run]);
  return <>{shown}</>;
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

/** One open carton on the belt: items falling in, people ticking up. */
function FillingBox({ lot, index, run }: { lot: FillingLot; index: number; run: boolean }) {
  const first = lot.listings[0];
  return (
    <article className={`fbox${run ? ' is-in' : ''}`} style={{ ['--i' as string]: index }}>
      <div className="fbox__carton" aria-hidden="true">
        <span className="fbox__flap fbox__flap--l" />
        <span className="fbox__flap fbox__flap--r" />
        <span className="fbox__drop">
          {lot.listings.slice(0, 3).map((listing, at) => (
            <Thumb key={listing.id} seed={listing.id} label={listing.title}
              photo={listing.photoUrl ? { url: listing.photoUrl } : null}
              className={`fbox__item fbox__item--${at}`} />
          ))}
        </span>
        <span className="fbox__front">
          <span className="fbox__stamp">LOT {lot.number}</span>
        </span>
      </div>
      <div className="fbox__info">
        <b className="fbox__name">{lot.name}</b>
        <span className="fbox__shop">
          {lot.shop.handle ? <Link to={`/${lot.shop.handle}`}>{lot.shop.name}</Link> : lot.shop.name}
          {lane(lot) && <> · {lane(lot)}</>}
        </span>
        <span className="fbox__people">
          <b><CountUp to={lot.people} run={run} /></b> {lot.people === 1 ? 'person is' : 'people are'} in
          {lot.people === 0 && ' — be the first'}
        </span>
        {lot.closesAround && Date.parse(lot.closesAround) > Date.now() && (
          <span className="fbox__closes">Box closes around {formatDate(lot.closesAround)}</span>
        )}
        <ul className="fbox__list">
          {lot.listings.slice(0, 3).map((listing) => (
            <li key={listing.id}>
              <Link to={`/listing/${listing.id}`}>
                <span>{listing.title}</span>
                <b>{formatMoney(listing.priceMinor, listing.currency)}</b>
              </Link>
            </li>
          ))}
        </ul>
        {first && <Link to={`/listing/${first.id}`} className="fbox__join">Join this box →</Link>}
      </div>
    </article>
  );
}

/**
 * Boxes filling up: lots still taking orders that something can be bought
 * into, busiest first. Hidden when there are none.
 */
export function FillingBoxes({ lots }: { lots: FillingLot[] }) {
  const [ref, seen] = useInView<HTMLElement>();
  if (lots.length === 0) return null;
  return (
    <section ref={ref} className={`floor${seen ? ' is-in' : ''}`} aria-label="Boxes filling up">
      <div className="floor__head">
        <h2>📦 Boxes filling up</h2>
        <span>Shared shipments still taking orders. Hop in before the box is taped shut.</span>
      </div>
      <div className="floor__row">
        {lots.map((lot, index) => <FillingBox key={lot.id} lot={lot} index={index} run={seen} />)}
      </div>
      <span className="floor__belt" aria-hidden="true" />
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
