import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { IN_DEMAND_SCORE, popularity } from '@shared/catalog';
import { ApiRequestError, api, type DiscoverResponse, type FeedListing, type PostCard } from '../api';
import { ContentBadge, SocialPostCard } from '../components/SocialPost';
import { VoiceProvider } from '../components/SocialVoice';
import { EmptyState, ErrorNotice, Thumb, leadPhoto } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';
import '../styles/DiscoverPage.css';

/**
 * Discover: the public side of Figmark, for somebody who does not know what
 * to search for.
 *
 * Social is who you chose, in order. This is everybody, ranked: the debates
 * worth joining, the conversations that took off, the shelves people loved,
 * and the items that are scarce or wanted - leaning towards the categories
 * this person saves. One stream mixes them, so scrolling is browsing rather
 * than choosing a list first; the chips narrow it to one kind.
 */

type Lens = 'all' | 'debates' | 'threads' | 'flexes' | 'finds';

const LENSES: { id: Lens; label: string }[] = [
  { id: 'all', label: '✨ For you' },
  { id: 'debates', label: '⚔️ Debates' },
  { id: 'threads', label: '🔥 Hot debates' },
  { id: 'flexes', label: '🏆 Flexes' },
  { id: 'finds', label: '💎 Rare finds' },
];

/** An item worth surfacing, and the one word that says why. */
interface Find {
  listing: FeedListing;
  why: { kind: 'rare' | 'filling' | 'hot' | 'yours'; label: string } | null;
  score: number;
}

/** Most finds a stream carries, so it stays a stream and not the catalogue. */
const MAX_FINDS = 24;
/** Items to a rail between posts. */
const RAIL = 4;

/**
 * Rank the catalogue's most-wanted for this person.
 *
 * Scarcity first - the last one or two of something, or a group pre-order
 * past halfway - then what is in demand, with a lift for the categories they
 * save from, which is the plainest sign of what they collect.
 */
function rankFinds(listings: FeedListing[], hobbies: ReadonlySet<string>, me: string | null): Find[] {
  return listings
    .filter((listing) => listing.sellerId !== me)
    .map((listing) => {
      const left = listing.quantityMode === 'multiple' ? null : listing.quantityAvailable;
      const rare = left !== null && left > 0 && left <= 2;
      const pre = listing.preOrder;
      const filling = Boolean(pre && pre.fillThreshold > 0 && pre.filledCount / pre.fillThreshold >= 0.5
        && pre.filledCount < pre.fillThreshold);
      const hot = popularity(listing) >= IN_DEMAND_SCORE;
      const yours = hobbies.has(listing.category);
      const why: Find['why'] = rare ? { kind: 'rare', label: left === 1 ? 'Rare · last one' : `Rare · last ${left}` }
        : filling ? { kind: 'filling', label: `Pre-order ${pre!.filledCount}/${pre!.fillThreshold}` }
          : hot ? { kind: 'hot', label: 'High demand' }
            : yours ? { kind: 'yours', label: `For your ${listing.category}` }
              : null;
      const score = popularity(listing) + (yours ? 400 : 0) + (rare ? 300 : 0) + (filling ? 200 : 0);
      return { listing, why, score };
    })
    .filter((find) => find.why !== null)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FINDS);
}

type Entry =
  | { kind: 'debate' | 'thread' | 'flex'; card: PostCard }
  | { kind: 'rail'; finds: Find[] };

/**
 * The one stream: a debate, a rail of finds, a flex, a hot thread, and round
 * again, each queue giving up its next best until all are empty. A kind that
 * runs out simply drops out of the rhythm.
 */
function weave(data: DiscoverResponse, finds: Find[]): Entry[] {
  const queues = {
    debate: [...data.debates],
    flex: [...data.flexes],
    thread: [...data.threads],
    rail: [...finds],
  };
  const rhythm = ['debate', 'rail', 'flex', 'thread'] as const;
  const out: Entry[] = [];
  while (queues.debate.length || queues.flex.length || queues.thread.length || queues.rail.length) {
    for (const kind of rhythm) {
      if (kind === 'rail') {
        if (queues.rail.length) out.push({ kind, finds: queues.rail.splice(0, RAIL) });
      } else {
        const card = queues[kind].shift();
        if (card) out.push({ kind, card });
      }
    }
  }
  return out;
}

export function DiscoverPage() {
  return (
    <VoiceProvider>
      <DiscoverBody />
    </VoiceProvider>
  );
}

function DiscoverBody() {
  const { user, promptAuth } = useSession();
  const [lens, setLens] = useState<Lens>('all');
  const [data, setData] = useState<DiscoverResponse | null>(null);
  const [listings, setListings] = useState<FeedListing[] | null>(null);
  const [hobbies, setHobbies] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const [community, catalogue, saved] = await Promise.allSettled([
      api.discover(),
      api.feed({ sort: 'popular' }),
      user ? api.saved() : Promise.resolve({ listings: [] }),
    ]);
    // Each half stands on its own: the community failing still leaves the finds.
    if (community.status === 'fulfilled') setData(community.value);
    else {
      setData({ debates: [], threads: [], flexes: [] });
      setError(community.reason instanceof ApiRequestError ? community.reason.message : 'Could not load what is happening.');
    }
    setListings(catalogue.status === 'fulfilled' ? catalogue.value.listings : []);
    if (saved.status === 'fulfilled') setHobbies(new Set(saved.value.listings.map((listing) => listing.category)));
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const finds = useMemo(
    () => (listings ? rankFinds(listings, hobbies, user?.id ?? null) : []),
    [listings, hobbies, user?.id],
  );
  const stream = useMemo(() => (data ? weave(data, finds) : []), [data, finds]);
  const loading = !data || !listings;

  const posts = (cards: PostCard[], promoted = false) => cards.map((card) => (
    <SocialPostCard key={card.post.id} card={card} promoted={promoted} />
  ));

  return (
    <main className="page discpage">
      <header className="dischero">
        <span className="dischero__kicker">Across Figmark</span>
        <h1 className="dischero__title">Discover</h1>
        <p className="dischero__sub">
          Debates to settle, shelves to envy and finds that will not last.
          {hobbies.size > 0 && <> Leaning towards {[...hobbies].slice(0, 3).join(', ')}.</>}
        </p>
        <div className="chips chips--tight dischero__lenses" role="toolbar" aria-label="Show">
          {LENSES.map((entry) => (
            <button key={entry.id} type="button" className={`chip${lens === entry.id ? ' is-on' : ''}`}
              aria-pressed={lens === entry.id} onClick={() => setLens(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
        {!user && (
          <p className="dischero__guest">
            <button type="button" className="btn btn--sm" onClick={() => promptAuth('Sign in to vote, react and follow.')}>
              Sign in
            </button>
            <span className="faint">to vote on debates and follow the people behind them.</span>
          </p>
        )}
      </header>

      {error && <ErrorNotice message={error} />}

      {loading ? (
        <DiscoverSkeleton />
      ) : lens === 'all' ? (
        stream.length === 0 ? (
          <EmptyState title="Quiet right now">
            Nothing is trending yet. Start a debate or share your shelf with the + below, and be the first thing here.
          </EmptyState>
        ) : (
          <div className="discover__stream">
            {stream.map((entry, index) => entry.kind === 'rail' ? (
              <FindRail key={`r${index}`} finds={entry.finds} first={index < 2} />
            ) : (
              <SocialPostCard key={`${entry.kind}-${entry.card.post.id}`} card={entry.card} promoted={entry.kind === 'thread'} />
            ))}
          </div>
        )
      ) : lens === 'finds' ? (
        finds.length === 0 ? (
          <EmptyState title="No rare finds today">Nothing is running low or filling fast. Check back after the next drop.</EmptyState>
        ) : (
          <div className="discgrid">{finds.map((find) => <FindCard key={find.listing.id} find={find} />)}</div>
        )
      ) : (
        <div className="discover__stream">
          {lens === 'debates' && (data.debates.length ? posts(data.debates) : (
            <EmptyState title="No debates yet">Put two pieces side by side with the + below and let people vote.</EmptyState>
          ))}
          {lens === 'threads' && (data.threads.length ? posts(data.threads, true) : (
            <EmptyState title="No hot debates yet">When a conversation takes off anywhere on Figmark, it shows up here.</EmptyState>
          ))}
          {lens === 'flexes' && (data.flexes.length ? posts(data.flexes) : (
            <EmptyState title="No flexes yet">Share your shelf with its pieces tagged, from the + below.</EmptyState>
          ))}
        </div>
      )}
    </main>
  );
}

/** A row of finds between posts, sideways on a phone. */
function FindRail({ finds, first }: { finds: Find[]; first: boolean }) {
  return (
    <section className="discrail" aria-label={first ? 'High demand and rare, for you' : 'More finds'}>
      <div className="discrail__head">
        <h2>{first ? 'High demand & rare, for you' : 'More finds'}</h2>
        <Link to="/?sort=popular" className="discrail__all">See all</Link>
      </div>
      <div className="discrail__row">
        {finds.map((find) => <FindCard key={find.listing.id} find={find} />)}
      </div>
    </section>
  );
}

function FindCard({ find }: { find: Find }) {
  const { listing, why } = find;
  return (
    <Link to={`/listing/${encodeURIComponent(listing.id)}`} className="discitem">
      <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb discitem__photo">
        <ContentBadge type="sale" />
      </Thumb>
      <span className="discitem__body">
        {why && <span className={`discitem__why discitem__why--${why.kind}`}>{why.label}</span>}
        <span className="discitem__name">{listing.title}</span>
        <span className="discitem__meta">
          <strong>{formatMoney(listing.priceMinor, listing.currency)}</strong>
          <span className="faint">{listing.condition}</span>
        </span>
      </span>
    </Link>
  );
}

/** Shapes where the stream is about to be, so it does not jump in. */
function DiscoverSkeleton() {
  return (
    <div className="discover__stream" aria-hidden="true">
      {[0, 1].map((key) => (
        <div key={key} className="spost">
          <div className="spost__head">
            <span className="skel" style={{ width: 42, height: 42, borderRadius: '50%' }} />
            <span className="skel" style={{ width: '38%', height: 12 }} />
          </div>
          <span className="skel" style={{ width: '80%', height: 12 }} />
          <span className="skel" style={{ width: '100%', aspectRatio: '2 / 1', borderRadius: 12 }} />
        </div>
      ))}
    </div>
  );
}
