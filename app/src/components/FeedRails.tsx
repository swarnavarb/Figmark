import { Link } from 'react-router-dom';
import { hoursToEnd, isEndingSoon, isInDemand, popularity } from '@shared/catalog';
import type { FeedListing } from '../api';
import { Fire, Svg } from './ListingBlocks';
import { Thumb, leadPhoto } from './ui';

/**
 * The two shelves dropped in between the feed's cards: what people are
 * looking at and saving right now, and what is about to stop being on sale.
 * Both are cut from the listings the feed already loaded, so they cost nothing.
 */

/** A feed narrowed to one shelf, from the shelf's "View all". */
export type FeedView = 'demand' | 'ending';

export const FEED_VIEW_TITLES: Record<FeedView, string> = {
  demand: 'In demand',
  ending: 'Ending soon',
};

export function isFeedView(value: string): value is FeedView {
  return value === 'demand' || value === 'ending';
}

export function demandPicks<T extends FeedListing>(listings: readonly T[]): T[] {
  return listings.filter(isInDemand).sort((a, b) => popularity(b) - popularity(a));
}

export function endingPicks<T extends FeedListing>(listings: readonly T[], now: number): T[] {
  return listings
    .filter((listing) => isEndingSoon(listing, now))
    .sort((a, b) => (hoursToEnd(a, now) ?? 0) - (hoursToEnd(b, now) ?? 0));
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

/** Timers about to run out, with speed streaks racing across behind them. */
export function EndingRail({ listings, now }: { listings: readonly FeedListing[]; now: number }) {
  if (listings.length === 0) return null;
  return (
    <section className="rail rail--rush" aria-label="Ending soon">
      <span className="rush" aria-hidden="true">
        {Array.from({ length: 9 }, (_, n) => <i key={n} className="rush__streak" style={{ ['--n' as string]: n }} />)}
      </span>
      <RailHead icon="bolt" title="Ending soon" sub="Grab these before the clock runs out" view="ending" />
      <div className="rail__track">
        {listings.slice(0, SHELF).map((listing, n) => {
          const hours = hoursToEnd(listing, now) ?? 0;
          return (
            <RailItem key={listing.id} listing={listing} n={n}>
              <span className={`railitem__left${hours < 24 ? ' is-hot' : ''}`}>
                <Svg name="clock" size={12} /> {timeLeft(hours)}
              </span>
              {/* How much of the last week is left, draining as it goes. */}
              <span className="railitem__drain" style={{ ['--left' as string]: Math.min(1, hours / 168) }} />
            </RailItem>
          );
        })}
      </div>
      <span className="rush rush--front" aria-hidden="true">
        {[1, 4, 7].map((n) => <i key={n} className="rush__streak" style={{ ['--n' as string]: n }} />)}
      </span>
    </section>
  );
}

function RailHead({ icon, title, sub, view }: { icon: 'flame' | 'bolt'; title: string; sub: string; view: FeedView }) {
  return (
    <header className="rail__head">
      <span className="rail__icon"><Svg name={icon} size={18} /></span>
      <span className="rail__titles">
        <h2>{title}</h2>
        <small>{sub}</small>
      </span>
      <Link className="rail__all" to={`/?view=${view}`}>View all</Link>
    </header>
  );
}

/** The whole photo and the name, nothing else. */
function RailItem({ listing, n, children }: { listing: FeedListing; n: number; children?: React.ReactNode }) {
  return (
    <Link to={`/listing/${listing.id}`} className="railitem" style={{ ['--i' as string]: n }}>
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb railitem__photo">
        {children}
        <span className="railitem__name">{listing.title}</span>
      </Thumb>
    </Link>
  );
}

function timeLeft(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m left`;
  if (hours < 48) return `${Math.floor(hours)}h left`;
  return `${Math.floor(hours / 24)}d left`;
}
