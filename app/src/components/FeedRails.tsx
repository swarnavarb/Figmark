import { Link } from 'react-router-dom';
import { hoursToEnd, isEndingSoon, isInDemand, popularity } from '@shared/catalog';
import { preOrderView } from '@shared/preorder';
import type { FeedListing } from '../api';
import { Fire, Rush, Svg } from './ListingBlocks';
import { Thumb, leadPhoto } from './ui';
import { EarnPill, earnOf } from './Affiliate';

/**
 * The shelves dropped in between the feed's cards: what people are looking at
 * and saving right now, what is about to stop being on sale, what pays to
 * share, and what is being pre-ordered. All are cut from the listings the feed
 * already loaded, so they cost nothing.
 */

/** A feed narrowed to one shelf, from the shelf's "View all". */
export type FeedView = 'demand' | 'ending' | 'earn' | 'preorder';

export const FEED_VIEW_TITLES: Record<FeedView, string> = {
  demand: 'In demand',
  ending: 'Ending soon',
  earn: 'Money Honey',
  preorder: 'Pre-orders',
};

export function isFeedView(value: string): value is FeedView {
  return value in FEED_VIEW_TITLES;
}

export function demandPicks<T extends FeedListing>(listings: readonly T[]): T[] {
  return listings.filter(isInDemand).sort((a, b) => popularity(b) - popularity(a));
}

export function endingPicks<T extends FeedListing>(listings: readonly T[], now: number): T[] {
  return listings
    .filter((listing) => isEndingSoon(listing, now))
    .sort((a, b) => (hoursToEnd(a, now) ?? 0) - (hoursToEnd(b, now) ?? 0));
}

/**
 * Items that pay a commission to share, quietest first: a link does the most
 * good on something nobody has found yet, and the busy ones already sell.
 */
export function earnPicks<T extends FeedListing>(listings: readonly T[]): T[] {
  return listings.filter((listing) => earnOf(listing) > 0).sort((a, b) => popularity(a) - popularity(b));
}

/** Pre-orders still taking people, the ones closing soonest first. */
export function preOrderPicks<T extends FeedListing>(listings: readonly T[]): T[] {
  return listings
    .filter((listing) => listing.preOrder && !listing.preOrder.closedAt)
    .sort((a, b) => Date.parse(a.preOrder!.cutoffAt) - Date.parse(b.preOrder!.cutoffAt));
}

const SHELF = 10;

/** Most viewed and saved, on fire: flames behind the photos and licking over their bottom edge. */
export function DemandRail({ listings }: { listings: readonly FeedListing[] }) {
  if (listings.length === 0) return null;
  return (
    <section className="rail rail--fire" aria-label="In demand">
      <Fire className="fire--back" />
      <RailHead icon="flame" title="In demand" sub="Most viewed and saved right now" view="demand" />
      <div className="rail__track">
        {listings.slice(0, SHELF).map((listing, n) => <RailItem key={listing.id} listing={listing} n={n} />)}
      </div>
      <Fire className="fire--front" />
    </section>
  );
}

/** Timers about to run out: speed streaks racing across, and lightning now and then. */
export function EndingRail({ listings, now }: { listings: readonly FeedListing[]; now: number }) {
  if (listings.length === 0) return null;
  return (
    <section className="rail rail--rush" aria-label="Ending soon">
      <Rush bolts={false} />
      <RailHead icon="bolt" title="Ending soon" sub="Grab these before the clock runs out" view="ending" />
      <div className="rail__track">
        {listings.slice(0, SHELF).map((listing, n) => {
          const hours = hoursToEnd(listing, now) ?? 0;
          return (
            <RailItem key={listing.id} listing={listing} n={n}>
              <span className={`railitem__left${hours < 24 ? ' is-hot' : ''}`}>
                <Svg name="clock" size={12} /> {timeLeft(hours)}
              </span>
            </RailItem>
          );
        })}
      </div>
      <Rush streaks={[1, 4, 7]} front />
    </section>
  );
}

/**
 * Money Honey: rupees raining down behind the photos (and a few in front),
 * a spinning coin for an icon and a glint running over each photo.
 */
const RUPEES = [
  [2, 0.9, 0], [7, 1.3, 1.1], [12, 0.8, 2.2], [17, 1.1, 0.6], [22, 1.5, 1.7], [27, 0.9, 0.3],
  [32, 1.2, 1.4], [37, 0.8, 2.5], [42, 1.4, 0.9], [47, 1, 1.9], [52, 1.2, 0.2], [57, 0.9, 1.2],
  [62, 1.3, 2.1], [67, 1, 0.5], [72, 1.4, 1.6], [77, 0.8, 2.4], [82, 1.2, 0.8], [87, 1, 1.8], [92, 1.3, 0.4], [97, 0.9, 1.5],
] as const;
const SPARKS = [[6, 30], [19, 70], [31, 20], [44, 58], [58, 26], [69, 74], [81, 38], [93, 64]] as const;

function RupeeRain({ front }: { front?: boolean }) {
  const drops = front ? RUPEES.filter((_, n) => n % 3 === 1) : RUPEES;
  return (
    <span className={`honey__rain${front ? ' honey__rain--front' : ''}`} aria-hidden="true">
      {drops.map(([left, scale, delay], n) => (
        <i key={n} className="honey__rupee"
          style={{ left: `${left}%`, ['--s' as string]: scale, animationDelay: `${-delay}s`, animationDuration: `${2.2 + (n % 4) * 0.45}s` }}>₹</i>
      ))}
    </span>
  );
}

export function EarnRail({ listings }: { listings: readonly FeedListing[] }) {
  if (listings.length === 0) return null;
  return (
    <section className="rail rail--honey" aria-label="Money Honey">
      <span className="honey__lux" aria-hidden="true">
        <span className="honey__rays" />
        {SPARKS.map(([left, top], n) => (
          <i key={n} className="honey__spark" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${-(n * 0.41) % 1.8}s` }} />
        ))}
      </span>
      <RupeeRain />
      <RailHead icon="rupee" title="Money Honey" sub="Copy your affiliate link, share it, earn on every sale" view="earn" />
      <div className="rail__track">
        {listings.slice(0, SHELF).map((listing, n) => (
          <RailItem key={listing.id} listing={listing} n={n}>
            <span className="honey__glint" aria-hidden="true" />
          </RailItem>
        ))}
      </div>
      <RupeeRain front />
    </section>
  );
}

/**
 * Pre-orders as a launch: a night sky that twinkles, a rocket that crosses now
 * and then, and on each item a fuel gauge filling to how full it really is.
 */
const STARS = [
  [4, 18], [9, 62], [15, 34], [22, 80], [27, 12], [34, 48], [40, 70], [46, 24], [53, 56], [59, 8],
  [65, 40], [71, 76], [77, 20], [83, 52], [89, 30], [95, 66],
] as const;
/** Bookings drifting up: tickets, boxes and calendars, the stuff a pre-order is made of. */
const TICKETS = [[8, 'tag', 0], [24, 'box', 2.4], [41, 'calendar', 1.1], [57, 'users', 3.3], [73, 'box', 0.6], [90, 'tag', 2]] as const;

export function PreOrderRail({ listings, now }: { listings: readonly FeedListing[]; now: number }) {
  if (listings.length === 0) return null;
  return (
    <section className="rail rail--launch" aria-label="Pre-orders">
      <span className="launch__sky" aria-hidden="true">
        {STARS.map(([left, top], n) => (
          <i key={n} className="launch__star" style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${-(n * 0.53) % 3}s` }} />
        ))}
        <span className="launch__planet" />
        <i className="launch__shoot" />
        <i className="launch__shoot" />
        {TICKETS.map(([left, glyph, delay], n) => (
          <span key={n} className="launch__ticket" style={{ left: `${left}%`, animationDelay: `${-delay}s` }}>
            <Svg name={glyph} size={14} />
          </span>
        ))}
        <span className="launch__pad">{[0, 1, 2, 3, 4].map((n) => <i key={n} style={{ ['--n' as string]: n }} />)}</span>
      </span>
      <RailHead icon="rocket" title="Pre-orders" sub="Get in early. It ships once enough people join" view="preorder" />
      <div className="rail__track">
        {listings.slice(0, SHELF).map((listing, n) => {
          const view = preOrderView(listing.preOrder!);
          const percent = Math.min(100, Math.round((view.committed / Math.max(1, view.fillThreshold)) * 100));
          const days = Math.max(0, Math.ceil((Date.parse(view.cutoffAt) - now) / 86_400_000));
          return (
            <RailItem key={listing.id} listing={listing} n={n} foot={(
              <span className="launch__fuel">
                <span className="launch__count">
                  <b>{view.committed}/{view.fillThreshold}</b> in
                  <small>{view.toGo === 0 ? 'Going ahead' : days <= 1 ? 'Closes today' : `${days}d left`}</small>
                </span>
                <span className="launch__gauge" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}
                  aria-label={`${percent}% full`}>
                  <span style={{ ['--fill' as string]: `${percent}%` }} />
                </span>
              </span>
            )} />
          );
        })}
      </div>
      <span className="launch__front" aria-hidden="true">
        <span className="launch__rocket"><Svg name="rocket" size={26} /></span>
      </span>
    </section>
  );
}

function RailHead({ icon, title, sub, view }: { icon: 'flame' | 'bolt' | 'rupee' | 'rocket'; title: string; sub: string; view: FeedView }) {
  return (
    <header className="rail__head">
      <span className="rail__icon">{icon === 'rupee' ? <b className="rail__rupee">₹</b> : <Svg name={icon} size={18} />}</span>
      <span className="rail__titles">
        <h2>{title}</h2>
        <small>{sub}</small>
      </span>
      <Link className="rail__all" to={`/?view=${view}`}>View all</Link>
    </header>
  );
}

/** The whole photo and the name, nothing else. */
function RailItem({ listing, n, children, foot }: { listing: FeedListing; n: number; children?: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <Link to={`/listing/${listing.id}`} className={`railitem${listing.affiliate ? ' is-affiliate' : ''}`} style={{ ['--i' as string]: n }}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb railitem__photo">
        {earnOf(listing) > 0 && <span className="railitem__earn"><EarnPill amountMinor={earnOf(listing)} currency={listing.currency} /></span>}
        {children}
        <span className="railitem__name">{foot}<span>{listing.title}</span></span>
      </Thumb>
    </Link>
  );
}

function timeLeft(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m left`;
  if (hours < 48) return `${Math.floor(hours)}h left`;
  return `${Math.floor(hours / 24)}d left`;
}
