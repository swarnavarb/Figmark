
import { useEffect, useState, type ReactNode } from 'react';
import { listingRarity, RARITY_LABELS } from '@shared/quest';
import { sourcingOf } from '@shared/fulfilment';
import { SOURCING_LABELS } from '@shared/enums';
import { isMultiple } from '@shared/payments';
import type { Listing } from '@shared/models';
import { formatMoney } from '../format';
import { Lightbox } from './SocialPost';

/**
 * The listing, laid out in the Buy tab's colours: every fact in a block of
 * its own, a strip that says plainly what is running out, and photos that
 * open out of where they sit. Icons are drawn in SVG so they take the text
 * colour and stay sharp at any size.
 */

export type Glyph = 'clock' | 'flame' | 'box' | 'views' | 'open' | 'heart' | 'spark' | 'coin' | 'home' | 'ship' | 'users' | 'tag' | 'bolt' | 'shield' | 'calendar';

const PATHS: Record<Glyph, string> = {
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  flame: 'M12 22c4 0 7-2.7 7-6.8C19 10 14 8 14 3c-3 1.5-5 4.5-5 7-1-.5-2-1.8-2-3.2C5.6 8.3 5 10.6 5 12.5 5 18.6 8 22 12 22Z',
  box: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9',
  views: 'M3 20h18M6 16v-4M10 16V8M14 16v-6M18 16V5',
  open: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  heart: 'M12 20.4s-7.6-4.6-7.6-10.2A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.6 2.8c0 5.6-7.6 10.2-7.6 10.2Z',
  spark: 'M12 2v5M12 17v5M2 12h5M17 12h5M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3',
  coin: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15 9h-4.5a1.75 1.75 0 0 0 0 3.5h3a1.75 1.75 0 0 1 0 3.5H9M12 7v2M12 16v2',
  home: 'M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-9Z',
  ship: 'M3 17l1.5 3h15L21 17M5 17V11l7-3 7 3v6M12 8V3M9 5h6',
  users: 'M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9ZM7.5 7.5h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
  shield: 'M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
};

export function Svg({ name, size = 18 }: { name: Glyph; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Now, once a second, for a clock that is actually counting. */
function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The countdown as its own boxes: days, hours, minutes, seconds. */
function Countdown({ until, now }: { until: number; now: number }) {
  const left = Math.max(0, until - now);
  const s = Math.floor(left / 1000);
  const parts: [string, number][] = [['d', Math.floor(s / 86400)], ['h', Math.floor(s / 3600) % 24], ['m', Math.floor(s / 60) % 60], ['s', s % 60]];
  const shown = parts[0]![1] > 0 ? parts : parts.slice(1);
  return (
    <span className="lpclock" role="timer" aria-live="off">
      {shown.map(([unit, value]) => (
        <span key={unit} className="lpclock__cell">
          <b key={value} className="lpclock__num">{pad(value)}</b>
          <small>{unit}</small>
        </span>
      ))}
    </span>
  );
}

/**
 * What is running out, and only what really is: the clock the seller set,
 * how few are left, how many already went, and how many people are looking.
 * Nothing is made up - a listing with no timer and plenty of stock gets a
 * quieter strip, or none.
 */
export function Urgency({ listing, compact }: { listing: Listing; compact?: boolean }) {
  const until = listing.expiresAt ? Date.parse(listing.expiresAt) : null;
  const now = useNow(until !== null && until > Date.now());
  const rarity = listingRarity(listing, now);
  const left = isMultiple(listing) ? null : listing.quantityAvailable;
  const sold = listing.soldCount ?? 0;
  const facts: { icon: Glyph; text: string }[] = [];
  if (left !== null && left > 0 && left <= 5) facts.push({ icon: 'box', text: left === 1 ? 'Last one left' : `Only ${left} left` });
  if (sold > 0) facts.push({ icon: 'flame', text: `${sold} sold` });
  if (listing.likeCount > 0) facts.push({ icon: 'heart', text: `${listing.likeCount} saved it` });
  if (listing.viewCount > 0) facts.push({ icon: 'views', text: `${listing.viewCount} views` });
  if (rarity.priceDropPercent) facts.push({ icon: 'tag', text: `${rarity.priceDropPercent}% off` });

  const ticking = until !== null && until > now;
  if (!ticking && facts.length === 0) return null;
  const hot = ticking && until - now < 24 * 3_600_000;

  return (
    <div className={`urgency${hot ? ' urgency--hot' : ''}${compact ? ' urgency--compact' : ''}`}>
      {ticking ? (
        <div className="urgency__clock">
          <span className="urgency__pulse"><Svg name="clock" size={20} /></span>
          <span className="urgency__label">{hot ? 'Ending soon' : 'Offer ends in'}</span>
          <Countdown until={until} now={now} />
        </div>
      ) : (
        <div className="urgency__clock">
          <span className="urgency__pulse"><Svg name="flame" size={20} /></span>
          <span className="urgency__label">In demand right now</span>
        </div>
      )}
      {facts.length > 0 && (
        <div className="urgency__facts">
          {facts.map((fact) => (
            <span key={fact.text} className="urgency__fact"><Svg name={fact.icon} size={14} /> {fact.text}</span>
          ))}
        </div>
      )}
    </div>
  );
}

/** One fact, one coloured block. */
function Tile({ tone, icon, label, value, note, i }: {
  tone: string; icon: Glyph; label: string; value: ReactNode; note?: ReactNode; i: number;
}) {
  return (
    <div className={`dtile dtile--${tone}`} style={{ ['--i' as string]: i }}>
      <span className="dtile__icon"><Svg name={icon} size={18} /></span>
      <span className="dtile__label">{label}</span>
      <b className="dtile__value">{value}</b>
      {note && <span className="dtile__note">{note}</span>}
    </div>
  );
}

/**
 * Everything worth knowing before buying, each in a block of its own: how
 * rare it is, its condition, whether it is here or coming, stock, the booking
 * amount, a pre-order, a drop.
 */
export function DetailBlocks({ listing }: { listing: Listing }) {
  const rarity = listingRarity(listing);
  const sourcing = sourcingOf(listing);
  const tiles: Omit<Parameters<typeof Tile>[0], 'i'>[] = [];

  if (rarity.tier) {
    tiles.push({
      tone: `rarity-${rarity.tier}`, icon: rarity.tier === 'new' ? 'spark' : 'flame', label: 'Rarity',
      value: RARITY_LABELS[rarity.tier], note: rarity.reasons.slice(0, 2).join(' · ') || undefined,
    });
  }
  tiles.push({ tone: 'cool', icon: 'shield', label: 'Condition', value: listing.condition });
  tiles.push({
    tone: sourcing === 'in_hand' ? 'play' : 'blue', icon: sourcing === 'in_hand' ? 'home' : 'ship', label: 'Sourcing',
    value: SOURCING_LABELS[sourcing],
    note: sourcing === 'in_hand' ? 'Ships straight from the seller' : 'Imported in a shipment lot',
  });
  tiles.push({
    tone: 'sea', icon: 'box', label: 'Stock',
    value: isMultiple(listing) ? 'Made to order' : listing.quantityAvailable > 0 ? `${listing.quantityAvailable} available` : 'Sold out',
    note: listing.soldCount ? `${listing.soldCount} sold so far` : undefined,
  });
  if (listing.advancePercent) {
    const now = Math.round(listing.priceMinor * listing.advancePercent / 100);
    tiles.push({
      tone: 'warm', icon: 'coin', label: 'Booking amount', value: `${listing.advancePercent}% · ${formatMoney(now, listing.currency)}`,
      note: `Pay this now, ${formatMoney(listing.priceMinor - now, listing.currency)} later`,
    });
  }
  if (listing.preOrder) {
    tiles.push({
      tone: 'hero', icon: 'users', label: 'Pre-order', value: `${listing.preOrder.filledCount + (listing.preOrder.pledgedCount ?? 0)} of ${listing.preOrder.fillThreshold} joined`,
      note: 'Ordered once enough people join',
    });
  }
  if (listing.channelDrop) tiles.push({ tone: 'warm', icon: 'bolt', label: 'Drop', value: 'Exclusive channel drop' });
  if (listing.expiresAt) {
    tiles.push({
      tone: 'blue', icon: 'calendar', label: 'Available until',
      value: new Date(listing.expiresAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }),
    });
  }
  tiles.push({ tone: 'cool', icon: 'tag', label: 'Category', value: listing.category });

  return (
    <div className="dtiles">
      {tiles.map((tile, i) => <Tile key={tile.label} {...tile} i={i} />)}
    </div>
  );
}

/**
 * Every photo a listing has, not only the first: a framed stage, a strip of
 * thumbnails under it, and a tap on the stage opens it full screen, growing
 * out of the frame it was in.
 */
export function Gallery({ photos, title, fallback, children }: {
  photos: string[];
  title: string;
  /** What stands in when there are no photos at all. */
  fallback: ReactNode;
  /** Badges laid over the stage. */
  children?: ReactNode;
}) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<DOMRect | null>(null);

  if (photos.length === 0) return <div className="gallery"><div className="gallery__stage">{fallback}{children}</div></div>;

  return (
    <div className="gallery">
      <button type="button" className="gallery__stage" aria-label={`Open photo ${at + 1} of ${photos.length} full screen`}
        onClick={(event) => setOpen((event.currentTarget.querySelector('.gallery__img') as HTMLElement).getBoundingClientRect())}>
        {photos.map((url, index) => (
          <img key={url + index} src={url} alt={index === at ? title : ''} loading={index === 0 ? 'eager' : 'lazy'}
            className={`gallery__img${index === at ? ' is-on' : ''}`} />
        ))}
        <span className="gallery__zoom" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </span>
        {children}
      </button>

      {photos.length > 1 && (
        <div className="gallery__strip" role="tablist" aria-label="Photos">
          {photos.map((url, index) => (
            <button key={url + index} type="button" role="tab" aria-selected={index === at}
              className={`gallery__thumb${index === at ? ' is-on' : ''}`} onClick={() => setAt(index)}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <Lightbox photos={photos} start={at} origin={open} royal title={title}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

/** Five stars, drawn, filled to the rating (out of five) to the half star. */
export function StarRow({ value, size = 16 }: { value: number; size?: number }) {
  const stars = Math.round(value * 2) / 2;
  return (
    <span className="starrow" aria-label={`${value.toFixed(1)} out of 5`}>
      {[0, 1, 2, 3, 4].map((n) => {
        const fill = Math.max(0, Math.min(1, stars - n));
        return (
          <svg key={n} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
            <defs>
              <linearGradient id={`sr-${n}-${fill}`}>
                <stop offset={`${fill * 100}%`} stopColor="#FBBF24" />
                <stop offset={`${fill * 100}%`} stopColor="rgba(255,255,255,0.14)" />
              </linearGradient>
            </defs>
            <path fill={`url(#sr-${n}-${fill})`} d="m12 2.6 2.9 6 6.5.8-4.8 4.5 1.2 6.5L12 17.2l-5.8 3.2 1.2-6.5-4.8-4.5 6.5-.8Z" />
          </svg>
        );
      })}
    </span>
  );
}

/**
 * A shop's awning: striped, scalloped along its hem, in the shop's own hue.
 * It drops in and settles, the way a canopy is pulled down in the morning.
 */
export function Canopy({ stripes = 12 }: { stripes?: number }) {
  const w = 100 / stripes;
  return (
    <svg className="canopy" viewBox="0 0 100 16" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <clipPath id="canopy-hem">
          <path d={`M0 0H100V11${Array.from({ length: stripes }, (_, n) => {
            const x = 100 - n * w;
            return `Q${x - w / 2} 17 ${x - w} 11`;
          }).join('')}Z`} />
        </clipPath>
      </defs>
      <g clipPath="url(#canopy-hem)">
        {Array.from({ length: stripes }, (_, n) => (
          <rect key={n} x={n * w} y="0" width={w + 0.05} height="16" className={n % 2 ? 'canopy__light' : 'canopy__hue'} />
        ))}
      </g>
    </svg>
  );
}
