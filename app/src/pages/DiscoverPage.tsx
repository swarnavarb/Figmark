import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { IN_DEMAND_SCORE, popularity } from '@shared/catalog';
import type { Leaderboard, SpottedItem, TopicChip, WantRow } from '@shared/feed';
import { tagSlug } from '@shared/shop-tags';
import { ApiRequestError, api, type DiscoverResponse, type FeedListing, type PostCard } from '../api';
import { ContentBadge, SocialPostCard, postHref } from '../components/SocialPost';
import { VoiceProvider } from '../components/SocialVoice';
import { FollowSuggestions } from '../components/FollowSuggestions';
import { Icon } from '../components/Icon';
import { Spinner } from '../components/Spinner';
import { useToast } from '../components/Feedback';
import { EmptyState, ErrorNotice, Thumb, leadPhoto } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';
import '../styles/DiscoverPage.css';

/**
 * Discover: the public side of Figmark, for somebody who does not know what
 * to search for.
 *
 * Social is who you chose, in order. This is everybody, ranked for whoever is
 * reading: the debates worth joining, the conversations that took off, the
 * shelves people loved, new posts on the rise, and the items that are scarce
 * or wanted - leaning towards the categories this person saves. One stream
 * mixes them, so scrolling is browsing rather than choosing a list first; the
 * chips narrow it to one kind. Between posts sit the people worth following,
 * the hunts this person could answer, and things seen in posts that can be
 * bought. It pages on as it is scrolled; a guest is asked to join instead.
 */

type Lens = 'all' | 'rising' | 'debates' | 'threads' | 'flexes' | 'finds' | 'top';

const LENSES: { id: Lens; label: string }[] = [
  { id: 'all', label: '✨ For you' },
  { id: 'rising', label: '🚀 Rising' },
  { id: 'debates', label: '⚔️ Debates' },
  { id: 'threads', label: '🔥 Hot debates' },
  { id: 'flexes', label: '🏆 Flexes' },
  { id: 'finds', label: '💎 Rare finds' },
  { id: 'top', label: '🥇 This week' },
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
/** Where in the stream the other rails go, counted in entries. */
const PEOPLE_AT = 3;
const HUNTS_AT = 6;
const SPOTTED_AT = 9;

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
  | { kind: 'debate' | 'thread' | 'flex' | 'rising'; card: PostCard }
  | { kind: 'rail'; finds: Find[] }
  | { kind: 'people' }
  | { kind: 'hunts'; wants: WantRow[] }
  | { kind: 'spotted'; items: SpottedItem[] };

/** Discover's lists, merged across the pages read so far. */
interface Stream {
  debates: PostCard[];
  threads: PostCard[];
  flexes: PostCard[];
  rising: PostCard[];
}

/**
 * The one stream: a debate, a rail of finds, a flex, a hot thread, something
 * rising, and round again, each queue giving up its next best until all are
 * empty. A kind that runs out simply drops out of the rhythm. The people,
 * hunt and spotted rails go in once each, a few entries down, so the first
 * screen is still posts.
 */
function weave(data: Stream, finds: Find[], extras: { people: boolean; wants: WantRow[]; spotted: SpottedItem[] }): Entry[] {
  const queues = {
    debate: [...data.debates],
    flex: [...data.flexes],
    thread: [...data.threads],
    rising: [...data.rising],
    rail: [...finds],
  };
  const rhythm = ['debate', 'rail', 'flex', 'thread', 'rising'] as const;
  const out: Entry[] = [];
  const left = () => queues.debate.length || queues.flex.length || queues.thread.length || queues.rising.length || queues.rail.length;
  while (left()) {
    for (const kind of rhythm) {
      if (kind === 'rail') {
        if (queues.rail.length) out.push({ kind, finds: queues.rail.splice(0, RAIL) });
      } else {
        const card = queues[kind].shift();
        if (card) out.push({ kind, card });
      }
    }
  }
  const inserts: [number, Entry | null][] = [
    [SPOTTED_AT, extras.spotted.length ? { kind: 'spotted', items: extras.spotted } : null],
    [HUNTS_AT, extras.wants.length ? { kind: 'hunts', wants: extras.wants } : null],
    [PEOPLE_AT, extras.people ? { kind: 'people' } : null],
  ];
  for (const [at, entry] of inserts) if (entry) out.splice(Math.min(at, out.length), 0, entry);
  return out;
}

/** Put a later page's posts under the ones already shown, without repeating any. */
function merge(current: Stream, page: DiscoverResponse): Stream {
  const seen = new Set([...current.debates, ...current.threads, ...current.flexes, ...current.rising].map((card) => card.post.id));
  const fresh = (cards: PostCard[] | undefined) => (cards ?? []).filter((card) => !seen.has(card.post.id));
  return {
    debates: [...current.debates, ...fresh(page.debates)],
    threads: [...current.threads, ...fresh(page.threads)],
    flexes: [...current.flexes, ...fresh(page.flexes)],
    rising: [...current.rising, ...fresh(page.rising)],
  };
}

const EMPTY: Stream = { debates: [], threads: [], flexes: [], rising: [] };

export function DiscoverPage() {
  return (
    <VoiceProvider>
      <DiscoverBody />
    </VoiceProvider>
  );
}

function DiscoverBody() {
  const { user, promptAuth } = useSession();
  const toast = useToast();
  const [lens, setLens] = useState<Lens>('all');
  const [stream, setStream] = useState<Stream | null>(null);
  const [rails, setRails] = useState<{ topics: TopicChip[]; wants: WantRow[]; spotted: SpottedItem[] }>({ topics: [], wants: [], spotted: [] });
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [listings, setListings] = useState<FeedListing[] | null>(null);
  const [hobbies, setHobbies] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  /** A guest scrolled past the first page: asked to join rather than shown more. */
  const [guestWall, setGuestWall] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setGuestWall(false);
    const [community, catalogue, saved] = await Promise.allSettled([
      api.discover(),
      api.feed({ sort: 'popular' }),
      user ? api.saved() : Promise.resolve({ listings: [] }),
    ]);
    // Each half stands on its own: the community failing still leaves the finds.
    if (community.status === 'fulfilled') {
      const page = community.value;
      setStream(merge(EMPTY, page));
      setRails({ topics: page.topics ?? [], wants: page.wants ?? [], spotted: page.spotted ?? [] });
      setNext(page.next ?? null);
    } else {
      setStream(EMPTY);
      setNext(null);
      setError(community.reason instanceof ApiRequestError ? community.reason.message : 'Could not load what is happening.');
    }
    setListings(catalogue.status === 'fulfilled' ? catalogue.value.listings : []);
    if (saved.status === 'fulfilled') setHobbies(new Set(saved.value.listings.map((listing) => listing.category)));
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    if (next === null || more) return;
    // Browsing is open, but a whole evening of it is worth an account.
    if (!user) {
      setGuestWall(true);
      return;
    }
    setMore(true);
    try {
      const page = await api.discover(next);
      setStream((current) => merge(current ?? EMPTY, page));
      setNext(page.next ?? null);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load more.');
      setNext(null);
    } finally {
      setMore(false);
    }
  }, [next, more, user]);

  const finds = useMemo(
    () => (listings ? rankFinds(listings, hobbies, user?.id ?? null) : []),
    [listings, hobbies, user?.id],
  );
  const entries = useMemo(
    () => (stream ? weave(stream, finds, { people: Boolean(user), wants: rails.wants, spotted: rails.spotted }) : []),
    [stream, finds, user, rails.wants, rails.spotted],
  );
  const loading = !stream || !listings;

  const posts = (cards: PostCard[], promoted = false) => cards.map((card) => (
    <SocialPostCard key={card.post.id} card={card} promoted={promoted} />
  ));
  const paged = lens === 'all' || lens === 'rising' || lens === 'debates' || lens === 'threads' || lens === 'flexes';

  async function share() {
    const url = `${window.location.origin}/s/d`;
    try {
      if (navigator.share) await navigator.share({ title: 'Discover on Figmark', url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      }
    } catch {
      // Closing the share sheet is not a failure.
    }
  }

  return (
    <main className="page discpage">
      <header className="dischero">
        <span className="dischero__kicker">Across Figmark</span>
        <div className="dischero__top">
          <h1 className="dischero__title">Discover</h1>
          <button type="button" className="iconbtn" aria-label="Share Discover" onClick={() => void share()}>
            <Icon name="share" size={18} />
          </button>
        </div>
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
        {rails.topics.length > 0 && (
          <nav className="distopics" aria-label="Topics">
            {rails.topics.map((topic) => (
              <Link key={topic.key} to={`/tags/${encodeURIComponent(tagSlug(topic.key))}`} className="distopic">
                #{topic.label.replace(/ /g, '')}
                <span className="faint">{topic.posts}</span>
              </Link>
            ))}
          </nav>
        )}
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
        entries.length === 0 ? (
          <EmptyState title="Quiet right now">
            Nothing is trending yet. Start a debate or share your shelf with the + below, and be the first thing here.
          </EmptyState>
        ) : (
          <div className="discover__stream">
            {entries.map((entry, index) => {
              switch (entry.kind) {
                case 'rail': return <FindRail key={`r${index}`} finds={entry.finds} first={index < 2} />;
                case 'people': return <FollowSuggestions key="people" title="People to follow" />;
                case 'hunts': return <HuntRail key="hunts" wants={entry.wants} />;
                case 'spotted': return <SpottedRail key="spotted" items={entry.items} />;
                default: return (
                  <SocialPostCard key={`${entry.kind}-${entry.card.post.id}`} card={entry.card} promoted={entry.kind === 'thread'} />
                );
              }
            })}
          </div>
        )
      ) : lens === 'finds' ? (
        finds.length === 0 ? (
          <EmptyState title="No rare finds today">Nothing is running low or filling fast. Check back after the next drop.</EmptyState>
        ) : (
          <div className="discgrid">{finds.map((find) => <FindCard key={find.listing.id} find={find} />)}</div>
        )
      ) : lens === 'top' ? (
        <WeeklyBest />
      ) : (
        <div className="discover__stream">
          {lens === 'rising' && (stream.rising.length ? posts(stream.rising) : (
            <EmptyState title="Nothing rising yet">New posts that people are starting to notice show up here first.</EmptyState>
          ))}
          {lens === 'debates' && (stream.debates.length ? posts(stream.debates) : (
            <EmptyState title="No debates yet">Put two pieces side by side with the + below and let people vote.</EmptyState>
          ))}
          {lens === 'threads' && (stream.threads.length ? posts(stream.threads, true) : (
            <EmptyState title="No hot debates yet">When a conversation takes off anywhere on Figmark, it shows up here.</EmptyState>
          ))}
          {lens === 'flexes' && (stream.flexes.length ? posts(stream.flexes) : (
            <EmptyState title="No flexes yet">Share your shelf with its pieces tagged, from the + below.</EmptyState>
          ))}
        </div>
      )}

      {!loading && paged && (guestWall ? (
        <DiscoverWall onJoin={() => promptAuth('Join to keep scrolling, vote and follow.')} />
      ) : next !== null && (
        <MoreSentinel busy={more} onReach={() => void loadMore()} />
      ))}
    </main>
  );
}

/**
 * The bottom of the stream: reaching it reads the next page. A button too,
 * for whoever scrolls with a keyboard or has the observer turned off.
 */
function MoreSentinel({ busy, onReach }: { busy: boolean; onReach: () => void }) {
  const mark = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const element = mark.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const watcher = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) onReach();
    }, { rootMargin: '600px 0px' });
    watcher.observe(element);
    return () => watcher.disconnect();
  }, [onReach]);
  return (
    <button ref={mark} type="button" className="chmore" disabled={busy} onClick={onReach}>
      {busy ? <><Spinner size={14} label="Loading" /> More</> : 'More'}
    </button>
  );
}

/** Where a guest's scrolling stops: what an account gets them, and the way in. */
function DiscoverWall({ onJoin }: { onJoin: () => void }) {
  return (
    <section className="discwall">
      <h2>There is plenty more</h2>
      <p>Join Figmark to keep scrolling, vote on debates, save posts and follow the collectors and shops behind them.</p>
      <button type="button" className="btn" onClick={onJoin}>Join free</button>
    </section>
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

/**
 * Hunts somebody could answer: what this shop sells, what this collector
 * collects. A shop answers with an offer; a collector can join the hunt.
 */
function HuntRail({ wants }: { wants: WantRow[] }) {
  return (
    <section className="discrail" aria-label="People are hunting">
      <div className="discrail__head">
        <h2>People are hunting</h2>
        <Link to="/social?view=wanted" className="discrail__all">See all</Link>
      </div>
      <div className="discrail__row">
        {wants.map((want) => (
          <Link key={want.id} className="discitem"
            to={`/social?view=wanted&want=${encodeURIComponent(want.id)}&buyer=${encodeURIComponent(want.buyerId)}`}>
            <Thumb seed={want.id} label={want.title} photo={want.photoUrl ? { url: want.photoUrl } : null} className="thumb discitem__photo">
              <ContentBadge type="iso" />
            </Thumb>
            <span className="discitem__body">
              {want.why && <span className="discitem__why discitem__why--yours">{want.why}</span>}
              <span className="discitem__name">{want.title}</span>
              <span className="discitem__meta">
                <strong>{want.budgetMinor !== null ? `≤ ${formatMoney(want.budgetMinor, want.currency)}` : 'Open budget'}</strong>
                <span className="faint">{want.buyerName}</span>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** Things seen on somebody's shelf or in a debate, that can be bought now. */
function SpottedRail({ items }: { items: SpottedItem[] }) {
  return (
    <section className="discrail" aria-label="Spotted and buyable">
      <div className="discrail__head">
        <h2>Spotted &amp; buyable</h2>
      </div>
      <div className="discrail__row">
        {items.map((item) => (
          <Link key={item.listingId} className="discitem" to={`/listing/${encodeURIComponent(item.listingId)}`}>
            <Thumb seed={item.listingId} label={item.title} photo={item.photoUrl ? { url: item.photoUrl } : null} className="thumb discitem__photo">
              <ContentBadge type="sale" />
            </Thumb>
            <span className="discitem__body">
              <span className="discitem__why discitem__why--hot">
                {item.how === 'debate' ? 'In a debate by' : 'On the shelf of'} {item.spottedBy}
              </span>
              <span className="discitem__name">{item.title}</span>
              <span className="discitem__meta">
                <strong>{formatMoney(item.priceMinor, item.currency)}</strong>
              </span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** The week's best: the most loved shelves, the most argued debates, the loudest voices. */
function WeeklyBest() {
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.weeklyBest()
      .then((found) => live && setBoard(found))
      .catch((err: unknown) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load this week.'));
    return () => {
      live = false;
    };
  }, []);
  if (error) return <ErrorNotice message={error} />;
  if (!board) return <DiscoverSkeleton />;
  const empty = board.shelves.length === 0 && board.debates.length === 0 && board.voices.length === 0;
  if (empty) {
    return <EmptyState title="A quiet week so far">The shelves, debates and voices people love most this week show up here.</EmptyState>;
  }
  return (
    <div className="discweek">
      {board.shelves.length > 0 && (
        <section className="discweek__block">
          <h2><Icon name="trophy" size={16} /> Most loved shelves</h2>
          <ol className="discweek__list">
            {board.shelves.map((shelf, index) => (
              <li key={shelf.postId}>
                <Link to={postHref({ channelId: shelf.channelId, id: shelf.postId })} className="discweek__row">
                  <span className="discweek__rank">{index + 1}</span>
                  <Thumb seed={shelf.postId} label={shelf.name} photo={shelf.photoUrl ? { url: shelf.photoUrl } : null} className="thumb discweek__photo" />
                  <span className="discweek__name">{shelf.name}</span>
                  <span className="discweek__count">♥ {shelf.reactions}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      {board.debates.length > 0 && (
        <section className="discweek__block">
          <h2>⚔️ Most argued debates</h2>
          <ol className="discweek__list">
            {board.debates.map((debate, index) => (
              <li key={debate.postId}>
                <Link to={postHref({ channelId: debate.channelId, id: debate.postId })} className="discweek__row">
                  <span className="discweek__rank">{index + 1}</span>
                  <span className="discweek__name">
                    {debate.question || 'Which one?'}
                    <span className="faint">{debate.leading ? ` · ${debate.leading} leads` : ' · level'}</span>
                  </span>
                  <span className="discweek__count">{debate.votes} votes</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
      {board.voices.length > 0 && (
        <section className="discweek__block">
          <h2>📣 Voices of the week</h2>
          <ol className="discweek__list">
            {board.voices.map((voice, index) => {
              const row = (
                <>
                  <span className="discweek__rank">{index + 1}</span>
                  <span className="discweek__name">
                    {voice.name}<span className="faint"> · {voice.shop ? 'Shop' : 'Collector'} · {voice.posts} posts</span>
                  </span>
                  <span className="discweek__count">♥ {voice.reactions}</span>
                </>
              );
              return (
                <li key={voice.id}>
                  {voice.handle
                    ? <Link to={`/${encodeURIComponent(voice.handle)}`} className="discweek__row">{row}</Link>
                    : <span className="discweek__row">{row}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
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
