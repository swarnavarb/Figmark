import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { contestPhase } from '@shared/play';
import { IN_DEMAND_SCORE, factsOf, popularity } from '@shared/catalog';
import { hashtagsIn, type Leaderboard, type SpottedItem, type TopicChip, type WantRow } from '@shared/feed';
import { tagKey, tagSlug } from '@shared/shop-tags';
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
import { StickerCluster } from '../components/Sticker';

/**
 * Discover: the public side of Figmark, for somebody who does not know what
 * to search for.
 *
 * Social is who you chose, in order. This is everybody, ranked for whoever is
 * reading: the debates worth joining, the conversations that took off, the
 * shelves people loved, new posts on the rise, and the items that are scarce
 * or wanted - leaning towards the categories this person saves. One endless
 * stream mixes them, ordered for whoever is reading and saying why each post is
 * there, so scrolling is browsing rather than choosing a list first; the
 * chips narrow it to one kind. Between posts sit the people worth following,
 * the hunts this person could answer, and things seen in posts that can be
 * bought. It pages on as it is scrolled, putting what this device has already
 * scrolled past behind what is new; a guest is asked to join instead.
 *
 * Above it all sits what is live: polls, guesses and competitions still open
 * that this person has not joined - the things that are over if you wait -
 * and the competitions shops are running, with what they are giving away.
 */

type Lens = 'all' | 'live' | 'contests' | 'rising' | 'debates' | 'threads' | 'flexes' | 'finds' | 'top';

const LENSES: { id: Lens; label: string }[] = [
  { id: 'all', label: '✨ For you' },
  { id: 'live', label: '🗳️ Live' },
  { id: 'contests', label: '🏆 Competitions' },
  { id: 'rising', label: '🚀 Rising' },
  { id: 'debates', label: '⚔️ Debates' },
  { id: 'threads', label: '🔥 Hot debates' },
  { id: 'flexes', label: '📸 Flexes' },
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
  | { kind: 'post'; key: string; card: PostCard }
  | { kind: 'divider'; key: string; text: string }
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

/** Posts before the first rail of finds, and between the ones after it. */
const FIRST_RAIL_AT = 4;
const RAIL_EVERY = 8;
/** Comments before a post reads as a hot thread. The server promotes on the same number. */
const HOT_THREAD = 3;

/** One card of the stream, and which time round it is: a post can come back in a later lap. */
interface FlowItem {
  key: string;
  card: PostCard;
  lap: number;
}

const flowItems = (cards: PostCard[], lap: number): FlowItem[] => cards.map((card) => ({
  key: lap ? `${lap}:${card.post.id}` : card.post.id,
  card,
  lap,
}));

/** What the divider says where the stream starts going round again. */
const lapNote = (lap: number) => (lap === 1 ? 'You are all caught up. Here are older favourites.' : 'Round again, in a new order.');

/**
 * The one stream: the server's order, with a rail of finds after the first few
 * posts and every few after that, until the finds run out; a line where the
 * stream starts going round again. The people, hunt and spotted rails go in
 * once each, a few entries down, so the first screen is still posts.
 */
function weaveFlow(items: FlowItem[], finds: Find[], extras: { people: boolean; wants: WantRow[]; spotted: SpottedItem[] }): Entry[] {
  const queue = [...finds];
  const out: Entry[] = [];
  items.forEach((item, index) => {
    if (item.lap > (items[index - 1]?.lap ?? 0)) out.push({ kind: 'divider', key: `lap${item.lap}`, text: lapNote(item.lap) });
    out.push({ kind: 'post', key: item.key, card: item.card });
    const count = index + 1;
    if ((count === FIRST_RAIL_AT || count % RAIL_EVERY === 0) && queue.length) out.push({ kind: 'rail', finds: queue.splice(0, RAIL) });
  });
  // A quiet day: few posts, but the finds are still worth a look.
  while (queue.length && items.length < FIRST_RAIL_AT) out.push({ kind: 'rail', finds: queue.splice(0, RAIL) });
  const inserts: [number, Entry | null][] = [
    [SPOTTED_AT, extras.spotted.length ? { kind: 'spotted', items: extras.spotted } : null],
    [HUNTS_AT, extras.wants.length ? { kind: 'hunts', wants: extras.wants } : null],
    [PEOPLE_AT, extras.people ? { kind: 'people' } : null],
  ];
  for (const [at, entry] of inserts) if (entry) out.splice(Math.min(at, out.length), 0, entry);
  return out;
}

/* ── what this device has already shown ──────────────────────────────────── */

const SEEN_KEY = 'figmark.discover.seen';
const SEEN_KEEP = 400;
const INTERESTS_KEY = 'figmark.discover.interests';
const INTERESTS_KEEP = 12;
/**
 * Cards drawn at first and added each time the reader nears the last one drawn.
 * A page arrives whole, but only what is about to be looked at is put on the
 * screen: the rest waits, so a long scroll never means a long list of live cards.
 */
const FIRST_SHOWN = 6;
const REVEAL = 6;
/** Cards still undrawn when the next page is fetched in the background. */
const PREFETCH_AHEAD = 12;
/** Share of a first page already scrolled past before the next page is read straight away. */
const STALE_SHARE = 0.6;

/** Posts this device scrolled past before, newest last. Storage can be blocked or empty; then nothing is remembered. */
function readSeen(): Set<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(SEEN_KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function rememberSeen(ids: string[]) {
  try {
    const kept = [...new Set([...readSeen(), ...ids])].slice(-SEEN_KEEP);
    window.localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch {
    // Private windows and blocked storage: the stream still works, it just cannot tell what is new.
  }
}

/** What is new to this device first, what it has scrolled past after - each in the server's order. */
function newFirst(items: FlowItem[], seen: ReadonlySet<string>): FlowItem[] {
  return [...items.filter((item) => !seen.has(item.card.post.id)), ...items.filter((item) => seen.has(item.card.post.id))];
}

/** The topics a post is about, as the server keys them. */
function topicsOfCard(card: PostCard): string[] {
  return [...new Set([
    ...hashtagsIn(card.post.body),
    ...(card.post.flex?.hotspots ?? []).map((spot) => tagKey(spot.label)).filter((key) => key.length >= 3),
  ])];
}

/** What a guest has opened on this device, newest first: all Discover has to go on for somebody with no account. */
function guestInterests(): string[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(INTERESTS_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((word): word is string => typeof word === 'string').slice(0, INTERESTS_KEEP) : [];
  } catch {
    return [];
  }
}

function noteInterests(topics: string[]) {
  if (!topics.length) return;
  try {
    window.localStorage.setItem(INTERESTS_KEY, JSON.stringify([...new Set([...topics, ...guestInterests()])].slice(0, INTERESTS_KEEP)));
  } catch {
    // As above.
  }
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
  const location = useLocation();
  const [lens, setLens] = useState<Lens>(location.hash === '#competitions' ? 'contests' : 'all');
  const [live, setLive] = useState<PostCard[]>([]);
  const [contests, setContests] = useState<PostCard[]>([]);
  useEffect(() => {
    if (location.hash === '#competitions') setLens('contests');
  }, [location.hash]);
  const [stream, setStream] = useState<Stream | null>(null);
  /** The endless stream, in the order the server gave it, and where to read on from. */
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [flowReady, setFlowReady] = useState(false);
  const [shown, setShown] = useState(FIRST_SHOWN);
  const [cursor, setCursor] = useState<string | null>(null);
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
    // Each part lands as soon as it is read and stands on its own: one slow or
    // failed read must not keep the others - or the page - waiting. The posts
    // are asked for apart from the lists and rails, which take longer, so they
    // are on screen before the rails are even read.
    const posts = api.discoverStream({ interests: user ? [] : guestInterests() }).then(
      async (page) => {
        // What this device already scrolled past goes behind what is new. If
        // most of a page is old news, the next one is read at once so the
        // first screen is not a repeat.
        const seen = readSeen();
        let items = flowItems(page.stream, page.lap ?? 0);
        let more = page.nextCursor ?? null;
        if (user && more && items.length && items.filter((item) => seen.has(item.card.post.id)).length / items.length >= STALE_SHARE) {
          try {
            const again = await api.discoverMore(more);
            const have = new Set(items.map((item) => item.key));
            items = [...items, ...flowItems(again.stream, again.lap ?? 0).filter((item) => !have.has(item.key))];
            more = again.nextCursor;
          } catch {
            // The first page stands on its own.
          }
        }
        setFlow(newFirst(items, seen));
        setShown(FIRST_SHOWN);
        setCursor(more);
        setFlowReady(true);
      },
      () => {
        setFlow([]);
        setCursor(null);
        setFlowReady(true);
        setError('Could not load what is happening. Please try again.');
      },
    );
    const lists = api.discoverLists().then(
      (page) => {
        setStream(merge(EMPTY, page));
        setRails({ topics: page.topics ?? [], wants: page.wants ?? [], spotted: page.spotted ?? [] });
        setLive(page.live ?? []);
        setContests(page.contests ?? []);
        setNext(page.next ?? null);
      },
      () => {
        setStream(EMPTY);
        setNext(null);
      },
    );
    const catalogue = api.feed({ sort: 'popular' }).then(
      (found) => setListings(found.listings),
      () => setListings([]),
    );
    const saved = user
      ? api.saved().then((found) => setHobbies(new Set(found.listings.map((listing) => listing.category))), () => undefined)
      : Promise.resolve();
    await Promise.all([posts, lists, catalogue, saved]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = useCallback(async () => {
    const endless = lens === 'all';
    if ((endless ? cursor === null : next === null) || more) return;
    // Browsing is open, but a whole evening of it is worth an account.
    if (!user) {
      setGuestWall(true);
      return;
    }
    setMore(true);
    try {
      if (endless) {
        // Everything on screen so far has been scrolled to the end of: it goes
        // behind what is new the next time this device opens Discover.
        rememberSeen(flow.map((item) => item.card.post.id));
        // A page that adds nothing new (all of it already shown) is not the end: read on.
        let from: string | null = cursor;
        let fresh: FlowItem[] = [];
        const have = new Set(flow.map((item) => item.key));
        for (let tries = 0; from && !fresh.length && tries < 3; tries += 1) {
          const page = await api.discoverMore(from);
          fresh = flowItems(page.stream, page.lap ?? 0).filter((item) => !have.has(item.key));
          from = page.nextCursor;
        }
        setFlow((current) => [...current, ...fresh]);
        setCursor(from);
      } else {
        const page = await api.discover(next ?? 0);
        setStream((current) => merge(current ?? EMPTY, page));
        setNext(page.next ?? null);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load more.');
      if (endless) setCursor(null);
      else setNext(null);
    } finally {
      setMore(false);
    }
  }, [lens, cursor, next, more, user, flow]);

  const finds = useMemo(
    () => rankFinds(listings ?? [], hobbies, user?.id ?? null),
    [listings, hobbies, user?.id],
  );
  // Only the first few are drawn; the rest are added as the reader nears the end of them.
  const entries = useMemo(
    () => (flowReady ? weaveFlow(flow.slice(0, shown), finds, { people: Boolean(user), wants: rails.wants, spotted: rails.spotted }) : []),
    [flowReady, flow, shown, finds, user, rails.wants, rails.spotted],
  );
  // The finds and the lists are a bonus: the stream is ready once its posts are.
  const loading = lens === 'all' ? !flowReady : !stream;
  const lists = stream ?? EMPTY;

  /** The reader is near the last card drawn: draw more, and when all are drawn, read the next page. */
  const reach = useCallback(() => {
    if (lens === 'all' && shown < flow.length) setShown((count) => Math.min(flow.length, count + REVEAL));
    else void loadMore();
  }, [lens, shown, flow.length, loadMore]);

  // Read the next page while the reader is still on the last few, so it is there when they arrive.
  useEffect(() => {
    if (lens === 'all' && user && flowReady && cursor !== null && !more && flow.length - shown <= PREFETCH_AHEAD) void loadMore();
  }, [lens, user, flowReady, cursor, more, flow.length, shown, loadMore]);
  const spots = useMemo(() => spotlight(live, contests, lists, finds), [live, contests, lists, finds]);

  const posts = (cards: PostCard[], promoted = false) => cards.map((card) => (
    <SocialPostCard key={card.post.id} card={card} promoted={promoted} />
  ));
  const openContests = contests.filter((card) => card.post.contest && contestPhase(card.post.contest) !== 'ended').length;
  const paged = lens === 'all' || lens === 'rising' || lens === 'debates' || lens === 'threads' || lens === 'flexes';
  const hasMore = lens === 'all' ? shown < flow.length || cursor !== null : next !== null;

  /** A guest has no history, so what they tap is what Discover learns from, kept on this device. */
  function noteTap(event: ReactMouseEvent) {
    if (user) return;
    const shell = (event.target as HTMLElement).closest('[data-post-id]');
    const item = flow.find((entry) => entry.card.post.id === shell?.getAttribute('data-post-id'));
    if (item) noteInterests(topicsOfCard(item.card));
  }

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
        <StickerCluster
          className="dischero__stickers"
          items={[
            { name: 'toy', size: 70, x: 34, y: 30, tilt: 8 },
            { name: 'star', size: 40, x: 0, y: 0, tilt: -12 },
            { name: 'sparkle', size: 22, x: 62, y: 90, tilt: 0 },
          ]}
        />
        <div className="dischero__top">
          <span className="dischero__kicker"><span aria-hidden="true">✦</span> Across Figmark</span>
          <button type="button" className="iconbtn dischero__share" aria-label="Share Discover" onClick={() => void share()}>
            <Icon name="share" size={18} />
          </button>
        </div>
        <h1 className="dischero__title">Discover</h1>
        <p className="dischero__sub">
          Polls to settle, competitions to win, shelves to envy and finds that will not last.
          {hobbies.size > 0 && <> Leaning towards {[...hobbies].slice(0, 3).join(', ')}.</>}
        </p>
        {(live.length > 0 || openContests > 0) && (
          <div className="dischero__stats">
            {live.length > 0 && (
              <button type="button" className="dischero__stat" onClick={() => setLens('live')}>
                <span className="dischero__pulse" aria-hidden="true" /> <strong>{live.length}</strong> live to vote on
              </button>
            )}
            {openContests > 0 && (
              <button type="button" className="dischero__stat" onClick={() => setLens('contests')}>
                🏆 <strong>{openContests}</strong> competition{openContests === 1 ? '' : 's'} open
              </button>
            )}
          </div>
        )}
        {!user && (
          <p className="dischero__guest">
            <button type="button" className="btn btn--sm" onClick={() => promptAuth('Sign in to vote, react and follow.')}>
              Sign in
            </button>
            <span>to vote, enter competitions and follow the people behind them.</span>
          </p>
        )}
      </header>

      {!loading && lens === 'all' && spots.length > 1 && <SpotlightDeck spots={spots} />}

      <nav className="dislens" aria-label="Show">
        {LENSES.map((entry) => (
          <button key={entry.id} type="button" className={`dislens__tab${lens === entry.id ? ' is-on' : ''}`}
            aria-pressed={lens === entry.id} onClick={() => setLens(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>

      {rails.topics.length > 0 && lens === 'all' && (
        <nav className="distopics" aria-label="Topics">
          {rails.topics.map((topic) => (
            <Link key={topic.key} to={`/tags/${encodeURIComponent(tagSlug(topic.key))}`} className="distopic">
              #{topic.label.replace(/ /g, '')}
              <span className="faint">{topic.posts}</span>
            </Link>
          ))}
        </nav>
      )}

      {!loading && lens === 'all' && live.length > 0 && <LiveStrip cards={live} onAll={() => setLens('live')} />}
      {!loading && lens === 'all' && contests.length > 0 && <ContestRow cards={contests} onAll={() => setLens('contests')} />}

      {error && <ErrorNotice message={error} />}

      {loading ? (
        <DiscoverSkeleton />
      ) : lens === 'all' ? (
        // The people rail is always woven in for somebody signed in, and draws
        // nothing when there is nobody to suggest: it is not content, so on
        // its own it must not stand in for the empty state.
        entries.every((entry) => entry.kind === 'people') ? (
          <>
            <EmptyState title="Quiet right now">
              Nothing is trending yet. Start a debate or share your shelf with the + below, and be the first thing here.
            </EmptyState>
            {user && <FollowSuggestions title="People to follow" />}
          </>
        ) : (
          <div className="discover__stream" onClick={noteTap}>
            {entries.map((entry, index) => {
              switch (entry.kind) {
                case 'rail': return <FindRail key={`r${index}`} finds={entry.finds} first={index < 2} />;
                case 'people': return <FollowSuggestions key="people" title="People to follow" />;
                case 'hunts': return <HuntRail key="hunts" wants={entry.wants} />;
                case 'spotted': return <SpottedRail key="spotted" items={entry.items} />;
                case 'divider': return <p key={entry.key} className="discend discend--lap">{entry.text}</p>;
                default: return (
                  <SocialPostCard key={entry.key} card={entry.card}
                    promoted={entry.card.social.commentCount >= HOT_THREAD && !entry.card.post.debate && !entry.card.post.flex} />
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
      ) : lens === 'live' ? (
        live.length === 0 ? (
          <EmptyState title="You're all caught up">
            Every open poll, guess and competition here has your vote. Start one with the + below.
          </EmptyState>
        ) : <div className="discover__stream">{posts(live)}</div>
      ) : lens === 'contests' ? (
        contests.length === 0 ? (
          <EmptyState title="No competitions running">
            Shops run photo competitions with store credit for the winners. Run one from the + below as your store.
          </EmptyState>
        ) : <div className="discover__stream" id="competitions">{posts(contests)}</div>
      ) : (
        <div className="discover__stream">
          {lens === 'rising' && (lists.rising.length ? posts(lists.rising) : (
            <EmptyState title="Nothing rising yet">New posts that people are starting to notice show up here first.</EmptyState>
          ))}
          {lens === 'debates' && (lists.debates.length ? posts(lists.debates) : (
            <EmptyState title="No debates yet">Put two pieces side by side with the + below and let people vote.</EmptyState>
          ))}
          {lens === 'threads' && (lists.threads.length ? posts(lists.threads, true) : (
            <EmptyState title="No hot debates yet">When a conversation takes off anywhere on Figmark, it shows up here.</EmptyState>
          ))}
          {lens === 'flexes' && (lists.flexes.length ? posts(lists.flexes) : (
            <EmptyState title="No flexes yet">Share your shelf with its pieces tagged, from the + below.</EmptyState>
          ))}
        </div>
      )}

      {!loading && paged && (guestWall ? (
        <DiscoverWall onJoin={() => promptAuth('Join to keep scrolling, vote and follow.')} />
      ) : hasMore ? (
        <MoreSentinel busy={more} onReach={reach} />
      ) : lens === 'all' && flow.length > 0 && (
        <p className="discend">That is everything for now. Check back soon, or start something with the + below.</p>
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
          <span className="faint">{factsOf(listing).condition}</span>
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

/** One card in the spotlight deck: a picture, what it is, and where it goes. */
interface Spot {
  id: string;
  kind: string;
  title: string;
  line: string | null;
  photo: string | null;
  emoji: string;
  href: string;
  cta: string;
  tone: string;
}

/** Most cards the deck holds: enough to keep flicking, few enough to finish. */
const SPOTS_MAX = 8;

/**
 * The deck's cards, from what the page already read: the liveliest open game,
 * a competition, the most loved shelf, the hottest debate, something rising,
 * a rare find - then round again. No request of its own.
 */
function spotlight(live: PostCard[], contests: PostCard[], stream: Stream, finds: Find[]): Spot[] {
  const post = (card: PostCard, kind: string, tone: string, cta: string, emoji: string): Spot => ({
    id: `p${card.post.id}`,
    kind,
    title: card.post.contest?.title ?? (card.post.body || 'Which one?'),
    line: closesIn(card) ?? `by ${card.post.authorName}`,
    photo: pictures(card)[0] ?? null,
    emoji,
    href: postHref(card.post),
    cta,
    tone,
  });
  const fromLive = live.map((card) => {
    const kind = liveKind(card);
    return post(card, `${kind.emoji} ${kind.label}`, kind.tone, kind.cta, kind.emoji);
  });
  const fromContests = contests.filter((card) => card.post.contest && contestPhase(card.post.contest) !== 'ended')
    .map((card) => post(card, '🏆 Competition', 'gold', 'Take a look', '🏆'));
  const fromFlexes = stream.flexes.map((card) => post(card, '📸 Shelf', 'violet', 'See the shelf', '📸'));
  const fromDebates = stream.debates.map((card) => post(card, '⚔️ Debate', 'pink', 'Pick a side', '⚔️'));
  const fromRising = stream.rising.map((card) => post(card, '🚀 Rising', 'aqua', 'Open', '🚀'));
  const fromFinds = finds.map(({ listing, why }): Spot => ({
    id: `l${listing.id}`,
    kind: `💎 ${why?.label ?? 'Find'}`,
    title: listing.title,
    line: formatMoney(listing.priceMinor, listing.currency),
    photo: leadPhoto(listing)?.url ?? null,
    emoji: '💎',
    href: `/listing/${encodeURIComponent(listing.id)}`,
    cta: 'View item',
    tone: 'coral',
  }));
  const queues = [fromLive, fromContests, fromFlexes, fromDebates, fromFinds, fromRising];
  const out: Spot[] = [];
  const seen = new Set<string>();
  while (out.length < SPOTS_MAX && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && !seen.has(next.id) && out.length < SPOTS_MAX) {
        seen.add(next.id);
        out.push(next);
      }
    }
  }
  return out;
}

/** How far a card has to be dragged before letting go sends it away. */
const FLING_PX = 70;
/** How long a sent card takes to leave, matching the CSS. */
const FLING_MS = 260;

/**
 * The spotlight: a deck of cards, the top one big, two more peeking behind.
 * Flick it either way - or tap Next - and it flies off to show the next
 * thing; the deck goes round. A small, physical way to come across something.
 */
function SpotlightDeck({ spots }: { spots: Spot[] }) {
  const [at, setAt] = useState(0);
  const [flying, setFlying] = useState<{ id: string; way: 1 | -1 } | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);

  const fling = useCallback((way: 1 | -1) => {
    if (flying) return;
    setFlying({ id: spots[at % spots.length]!.id, way });
    window.setTimeout(() => {
      setAt((value) => (value + 1) % spots.length);
      setFlying(null);
      setDrag(0);
    }, FLING_MS);
  }, [at, flying, spots]);

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (flying) return;
    start.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
    moved.current = false;
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const from = start.current;
    if (!from || from.id !== event.pointerId) return;
    const dx = event.clientX - from.x;
    if (!moved.current && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(event.clientY - from.y)) {
      moved.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (moved.current) setDrag(dx);
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (Math.abs(drag) > FLING_PX) fling(drag > 0 ? 1 : -1);
    else setDrag(0);
  };

  return (
    <section className="spotdeck" aria-roledescription="carousel" aria-label="Spotlight">
      <div className="spotdeck__head">
        <h2>✨ Spotlight</h2>
        <span className="spotdeck__count" aria-live="polite">{(at % spots.length) + 1} / {spots.length}</span>
      </div>
      <div className="spotdeck__stack" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onClickCapture={(event) => {
          // A drag that ended over the link is not a tap on it.
          if (moved.current) {
            event.preventDefault();
            event.stopPropagation();
            moved.current = false;
          }
        }}>
        {spots.map((spot, index) => {
          const depth = (index - (at % spots.length) + spots.length) % spots.length;
          const isFlying = flying?.id === spot.id;
          const top = depth === 0;
          const style = top && !isFlying && drag !== 0
            ? { transform: `translateX(${drag}px) rotate(${drag / 18}deg)`, transition: 'none' }
            : undefined;
          return (
            <Link key={spot.id} to={spot.href} tabIndex={top ? 0 : -1} aria-hidden={!top}
              className={`spotcard spotcard--${spot.tone}${isFlying ? ` is-flying is-flying--${flying!.way > 0 ? 'right' : 'left'}` : ''}`}
              data-depth={Math.min(depth, 3)} style={style} draggable={false}>
              {spot.photo
                ? <img className="spotcard__photo" src={spot.photo} alt="" loading={depth < 3 ? 'eager' : 'lazy'} draggable={false} />
                : <span className="spotcard__emoji" aria-hidden="true">{spot.emoji}</span>}
              <span className="spotcard__shade" aria-hidden="true" />
              <span className="spotcard__body">
                <span className="spotcard__kind">{spot.kind}</span>
                <span className="spotcard__title">{spot.title}</span>
                <span className="spotcard__foot">
                  {spot.line && <span className="spotcard__line">{spot.line}</span>}
                  <span className="spotcard__cta">{spot.cta} <Icon name="right" size={12} /></span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      <div className="spotdeck__controls">
        <span className="spotdeck__dots" aria-hidden="true">
          {spots.map((spot, index) => <span key={spot.id} className={index === at % spots.length ? 'is-on' : undefined} />)}
        </span>
        <button type="button" className="spotdeck__next" onClick={() => fling(-1)}>
          Next <Icon name="right" size={14} />
        </button>
      </div>
    </section>
  );
}

/** What a live card is, in a word and a colour. */
function liveKind(card: PostCard): { emoji: string; label: string; cta: string; tone: string } {
  const { post, social } = card;
  if (post.contest) return { emoji: '🏆', label: 'Competition', cta: contestPhase(post.contest) === 'entries' ? 'Enter' : 'Vote', tone: 'gold' };
  if (social.guess) return { emoji: '🎯', label: 'Guess the price', cta: 'Guess', tone: 'violet' };
  if (post.debate) return { emoji: '⚔️', label: 'Debate', cta: 'Pick a side', tone: 'pink' };
  if (social.poll?.style === 'rating') return { emoji: '⭐', label: 'Rate it', cta: 'Rate', tone: 'gold' };
  return { emoji: '📊', label: social.poll?.stock ? 'Stock poll' : 'Poll', cta: 'Vote', tone: 'aqua' };
}

/** When a live card stops taking part, said short. */
function closesIn(card: PostCard): string | null {
  const { post, social } = card;
  const at = post.contest
    ? (contestPhase(post.contest) === 'entries' ? post.contest.entriesCloseAt : post.contest.endsAt)
    : social.guess?.revealAt ?? social.poll?.closesAt ?? null;
  if (!at) return null;
  const hours = (Date.parse(at) - Date.now()) / 3_600_000;
  if (hours <= 0) return null;
  return hours < 1 ? 'Ends within the hour' : hours < 24 ? `${Math.round(hours)}h left` : `${Math.round(hours / 24)}d left`;
}

/** Up to three pictures that say what a live card is about. */
function pictures(card: PostCard): string[] {
  const { post, social } = card;
  const fromPoll = (social.poll?.options ?? []).map((option) => option.photoUrl).filter((url): url is string => Boolean(url));
  const fromContest = (post.contest?.entries ?? []).map((entry) => entry.photoUrl);
  const own = post.photoUrls?.length ? post.photoUrls : post.photoUrl ? [post.photoUrl] : [];
  return [...fromPoll, ...own, ...fromContest].slice(0, 3);
}

/**
 * Live now: open things to take part in, sideways, at the top. Each card is
 * a door to the post - voting happens there, where the result is drawn.
 */
function LiveStrip({ cards, onAll }: { cards: PostCard[]; onAll: () => void }) {
  return (
    <section className="dislive" aria-label="Live now">
      <div className="discrail__head">
        <h2><span className="dischero__pulse" aria-hidden="true" /> Live now</h2>
        <button type="button" className="discrail__all" onClick={onAll}>See all {cards.length}</button>
      </div>
      <div className="dislive__row">
        {cards.map((card, index) => {
          const kind = liveKind(card);
          const shots = pictures(card);
          const left = closesIn(card);
          const votes = card.post.contest ? card.post.contest.entries.length : card.social.guess?.count ?? card.social.poll?.total ?? 0;
          return (
            <Link key={card.post.id} to={postHref(card.post)} className={`livecard livecard--${kind.tone}`}
              style={{ animationDelay: `${index * 40}ms` }}>
              <span className={`livecard__art livecard__art--${shots.length}`}>
                {shots.length ? shots.map((url) => <img key={url} src={url} alt="" loading="lazy" />) : (
                  <span className="livecard__emoji" aria-hidden="true">{kind.emoji}</span>
                )}
              </span>
              <span className="livecard__body">
                <span className="livecard__kind">{kind.emoji} {kind.label}</span>
                <span className="livecard__q">{card.post.contest?.title ?? (card.post.body || 'Which one?')}</span>
                <span className="livecard__meta">
                  <span>{votes} {card.post.contest ? 'in' : card.social.guess ? 'guesses' : 'votes'}</span>
                  {left && <span className="livecard__left">{left}</span>}
                </span>
                <span className="livecard__cta">{kind.cta} <Icon name="right" size={12} /></span>
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/** The competitions row: what each shop is giving away, and how long is left. */
function ContestRow({ cards, onAll }: { cards: PostCard[]; onAll: () => void }) {
  return (
    <section className="dislive" aria-label="Competitions" id="competitions">
      <div className="discrail__head">
        <h2>🏆 Competitions</h2>
        <button type="button" className="discrail__all" onClick={onAll}>See all</button>
      </div>
      <div className="dislive__row">
        {cards.map((card, index) => {
          const contest = card.post.contest!;
          const phase = contestPhase(contest);
          const top = contest.prizes[0];
          const cover = card.post.photoUrl ?? contest.winners?.[0]?.photoUrl ?? contest.entries[0]?.photoUrl ?? null;
          const left = closesIn(card);
          return (
            <Link key={card.post.id} to={postHref(card.post)} className="contestcard" style={{ animationDelay: `${index * 40}ms` }}>
              <span className="contestcard__art">
                {cover ? <img src={cover} alt="" loading="lazy" /> : <span aria-hidden="true">{contest.host === 'figmark' ? '🌟' : '🏆'}</span>}
                <span className={`contestcard__phase contestcard__phase--${phase}`}>
                  {phase === 'entries' ? 'Entries open' : phase === 'voting' ? 'Voting' : phase === 'ended' ? 'Winners' : 'Judging'}
                </span>
              </span>
              <span className="contestcard__body">
                <strong>{contest.title}</strong>
                <span className="faint">{contest.host === 'figmark' ? 'Figmark weekly challenge' : contest.hostName}</span>
                {top && (
                  <span className="contestcard__prize">
                    🥇 {[top.amountMinor > 0 ? `${formatMoney(top.amountMinor, 'INR')} credit` : '', top.note].filter(Boolean).join(' + ')}
                  </span>
                )}
                <span className="livecard__meta">
                  <span>{contest.entries.length} {contest.entries.length === 1 ? 'entry' : 'entries'}</span>
                  {left && <span className="livecard__left">{left}</span>}
                </span>
              </span>
            </Link>
          );
        })}
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
  const players = board.players ?? [];
  const empty = board.shelves.length === 0 && board.debates.length === 0 && board.voices.length === 0 && players.length === 0;
  if (empty) {
    return <EmptyState title="A quiet week so far">The shelves, debates and voices people love most this week show up here.</EmptyState>;
  }
  return (
    <div className="discweek">
      {players.length > 0 && (
        <section className="discweek__block">
          <h2>🏅 Top players</h2>
          <ol className="discweek__list">
            {players.map((player, index) => {
              const row = (
                <>
                  <span className="discweek__rank">{index < 3 ? ['🥇', '🥈', '🥉'][index] : index + 1}</span>
                  <span className="discweek__name">
                    {player.name}
                    <span className="faint"> · {player.wins} win{player.wins === 1 ? '' : 's'} · {player.votes} vote{player.votes === 1 ? '' : 's'}</span>
                  </span>
                  <span className="discweek__count">{player.points} pts</span>
                </>
              );
              return (
                <li key={player.userId}>
                  {player.handle ? <Link to={`/${encodeURIComponent(player.handle)}`} className="discweek__row">{row}</Link>
                    : <span className="discweek__row">{row}</span>}
                </li>
              );
            })}
          </ol>
        </section>
      )}
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
                  <span className="discweek__count">{debate.votes} vote{debate.votes === 1 ? '' : 's'}</span>
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
                    {voice.name}<span className="faint"> · {voice.shop ? 'Shop' : 'Collector'} · {voice.posts} post{voice.posts === 1 ? '' : 's'}</span>
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
