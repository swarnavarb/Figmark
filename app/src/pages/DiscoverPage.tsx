import {
  useCallback, useEffect, useMemo, useRef, useState, type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { contestPhase } from '@shared/play';
import { factsOf } from '@shared/catalog';
import type { FindWhy } from '@shared/discover-finds';
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

/**
 * Discover: the public side of Figmark, for somebody who does not know what
 * to search for.
 *
 * Social is who you chose, in order. This is everybody, ranked for whoever is
 * reading. One endless stream mixes the debates worth joining, the
 * conversations that took off, the shelves people loved and new posts on the
 * rise, each saying why it is there; between posts sit the finds (ranked on
 * the server over the whole catalogue), the people worth following, the hunts
 * this person could answer and things seen in posts that can be bought.
 *
 * Five lenses narrow it - For you, Live, Debates, Shelves, Finds - and a
 * category chip narrows it to one kind of thing. The week's best is one tap
 * away in the header. The lens, category and search live in the address, so
 * back and a shared link land where the reader was.
 *
 * Above the stream sits the spotlight: a deck of the liveliest things to take
 * part in right now. What it shows is held back from the top of the stream, so
 * nothing is shown twice on the first screens.
 */

type Lens = 'all' | 'live' | 'debates' | 'shelves' | 'finds' | 'week';
type IconName = Parameters<typeof Icon>[0]['name'];

const LENSES: { id: Exclude<Lens, 'week'>; label: string; icon: IconName }[] = [
  { id: 'all', label: 'For you', icon: 'spark' },
  { id: 'live', label: 'Live', icon: 'poll' },
  { id: 'debates', label: 'Debates', icon: 'forum' },
  { id: 'shelves', label: 'Shelves', icon: 'camera' },
  { id: 'finds', label: 'Finds', icon: 'tag' },
];

/** Older addresses, and the lenses folded into others. */
const LEGACY_LENS: Record<string, Lens> = {
  contests: 'live', flexes: 'shelves', top: 'week', threads: 'debates', rising: 'all',
};

function lensFrom(value: string | null, hash: string): Lens {
  if (hash === '#competitions') return 'live';
  if (!value) return 'all';
  if (LEGACY_LENS[value]) return LEGACY_LENS[value]!;
  return (['all', 'live', 'debates', 'shelves', 'finds', 'week'] as const).find((lens) => lens === value) ?? 'all';
}

/** An item worth surfacing, and the one word that says why. Ranked on the server. */
interface Find {
  listing: FeedListing;
  why: FindWhy;
}

/** Items to a rail between posts. */
const RAIL = 4;
/** Where in the stream the other rails go, counted in entries. */
const PEOPLE_AT = 3;
const HUNTS_AT = 6;
const SPOTTED_AT = 9;
/** Places at the top of the stream kept clear of what the spotlight already shows. */
const SPOTLIT_GAP = 10;

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
/** Inline topic chips; the rest are in the search panel. */
const TOPICS_INLINE = 8;
/** How often an open Discover checks for new posts at the top. */
const FRESH_EVERY_MS = 120_000;

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

/**
 * Keep what the spotlight shows out of the first places of the stream: the
 * same debate as the deck's top card and the first post read as a repeat.
 * Held posts come back just below the gap, in their order.
 */
function deferSpotlit(items: FlowItem[], spotlit: ReadonlySet<string>, gap = SPOTLIT_GAP): FlowItem[] {
  if (!spotlit.size) return items;
  const out: FlowItem[] = [];
  const held: FlowItem[] = [];
  for (const item of items) {
    if (out.length < gap && spotlit.has(item.card.post.id)) held.push(item);
    else out.push(item);
    if (out.length === gap && held.length) out.push(...held.splice(0));
  }
  return [...out, ...held];
}

/* ── what this device has already shown ──────────────────────────────────── */

const SEEN_KEY = 'figmark.discover.seen';
const SEEN_KEEP = 400;
// pageLoaders.ts (warmDiscoverReads) reads this key too, to tell whether a guest's stream address carries interests.
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

/** The keys a category answers to among a post's topics: "Trading cards" is #tradingcards, #tradingcard and #cards. */
function categoryKeys(category: string): Set<string> {
  const keys = new Set<string>();
  const add = (word: string) => {
    const key = tagKey(word);
    if (key.length < 3) return;
    keys.add(key);
    if (key.endsWith('s')) keys.add(key.slice(0, -1));
    else keys.add(`${key}s`);
  };
  add(category);
  for (const word of category.split(/[\s/&,-]+/)) if (word.length >= 4) add(word);
  return keys;
}

/** Whether a post belongs under a category chip: it sells that kind of thing, or talks about it. */
function postInCategory(card: PostCard, keys: ReadonlySet<string>): boolean {
  const title = card.listing ? tagKey(card.listing.title) : '';
  return topicsOfCard(card).some((topic) => keys.has(topic)) || [...keys].some((key) => key.length >= 4 && title.includes(key));
}

/** Whether a post matches what was typed in Discover's search. */
function postMatches(card: PostCard, words: string[]): boolean {
  const text = `${card.post.body} ${card.post.authorName} ${card.post.contest?.title ?? ''} ${card.listing?.title ?? ''}`.toLowerCase();
  const topics = topicsOfCard(card);
  return words.every((word) => text.includes(word) || topics.some((topic) => topic.includes(tagKey(word))));
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
  const [params, setParams] = useSearchParams();
  const lens = lensFrom(params.get('lens'), location.hash);
  const category = params.get('cat');
  const query = params.get('q') ?? '';
  const [searchOpen, setSearchOpen] = useState(Boolean(query));

  /** Change what the address says, without a history entry for every chip. */
  const setParam = useCallback((key: 'lens' | 'cat' | 'q', value: string | null) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value && !(key === 'lens' && value === 'all')) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);
  const setLens = useCallback((next: Lens) => {
    setParam('lens', next);
    window.scrollTo({ top: 0 });
  }, [setParam]);

  const [live, setLive] = useState<PostCard[]>([]);
  const [contests, setContests] = useState<PostCard[]>([]);
  const [stream, setStream] = useState<Stream | null>(null);
  /** The endless stream, in the order the server gave it, and where to read on from. */
  const [flow, setFlow] = useState<FlowItem[]>([]);
  const [flowReady, setFlowReady] = useState(false);
  const [shown, setShown] = useState(FIRST_SHOWN);
  const [cursor, setCursor] = useState<string | null>(null);
  const [rails, setRails] = useState<{ topics: TopicChip[]; wants: WantRow[]; spotted: SpottedItem[] }>({ topics: [], wants: [], spotted: [] });
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);
  const [finds, setFinds] = useState<Find[]>([]);
  const [leaning, setLeaning] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  /** A guest scrolled past the first page: asked to join rather than shown more. */
  const [guestWall, setGuestWall] = useState(false);
  /** Newer posts are waiting at the top. */
  const [fresh, setFresh] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setGuestWall(false);
    setFresh(false);
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
        setFinds(page.finds ?? []);
        setLeaning(page.leaning ?? []);
        setNext(page.next ?? null);
      },
      () => {
        setStream(EMPTY);
        setNext(null);
      },
    );
    await Promise.all([posts, lists]);
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Every so often, while Discover is open and visible, ask whether anything
  // new has reached the top. Nothing moves under the reader: a button says so.
  const flowIds = useMemo(() => new Set(flow.map((item) => item.card.post.id)), [flow]);
  useEffect(() => {
    if (!flowReady || lens !== 'all') return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || fresh) return;
      void api.discoverStream({ interests: user ? [] : guestInterests() }).then((page) => {
        const seen = readSeen();
        if (page.stream.some((card) => !flowIds.has(card.post.id) && !seen.has(card.post.id))) setFresh(true);
      }, () => undefined);
    }, FRESH_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [flowReady, lens, fresh, flowIds, user]);

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
        let added: FlowItem[] = [];
        const have = new Set(flow.map((item) => item.key));
        for (let tries = 0; from && !added.length && tries < 3; tries += 1) {
          const page = await api.discoverMore(from);
          added = flowItems(page.stream, page.lap ?? 0).filter((item) => !have.has(item.key));
          from = page.nextCursor;
        }
        setFlow((current) => [...current, ...added]);
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

  /* ── narrowing: category chip and search ──────────────────────────────── */

  const categories = useMemo(() => {
    // The reader's own categories first, then everything the finds are in.
    const all = new Set(finds.map((find) => find.listing.category));
    return [...new Set([...leaning, ...[...all].sort()])];
  }, [finds, leaning]);
  const catKeys = useMemo(() => (category ? categoryKeys(category) : null), [category]);
  const shownFinds = useMemo(
    () => (category ? finds.filter((find) => find.listing.category === category) : finds),
    [finds, category],
  );
  const words = useMemo(() => query.trim().toLowerCase().split(/\s+/).filter(Boolean), [query]);
  const narrow = useCallback((cards: PostCard[]) => cards.filter((card) =>
    (!category || !catKeys || postInCategory(card, catKeys)) && (!words.length || postMatches(card, words))), [category, catKeys, words]);
  const lists = stream ?? EMPTY;

  const spots = useMemo(
    () => spotlight(narrow(live), narrow(contests), { ...lists, flexes: narrow(lists.flexes), debates: narrow(lists.debates), rising: narrow(lists.rising) }, shownFinds),
    [live, contests, lists, shownFinds, narrow],
  );
  const spotlit = useMemo(() => new Set(spots.filter((spot) => spot.postId).map((spot) => spot.postId!)), [spots]);
  const narrowed = Boolean(category || words.length);
  const flowShown = useMemo(() => {
    const kept = narrowed ? flow.filter((item) => narrow([item.card]).length > 0) : flow;
    return deferSpotlit(kept, spotlit);
  }, [flow, narrowed, narrow, spotlit]);

  // Only the first few are drawn; the rest are added as the reader nears the end of them.
  const entries = useMemo(
    () => (flowReady ? weaveFlow(flowShown.slice(0, shown), shownFinds, {
      people: Boolean(user) && !narrowed,
      wants: narrowed ? [] : rails.wants,
      spotted: narrowed ? [] : rails.spotted,
    }) : []),
    [flowReady, flowShown, shown, shownFinds, user, narrowed, rails.wants, rails.spotted],
  );
  // The finds and the lists are a bonus: the stream is ready once its posts are.
  const loading = lens === 'all' ? !flowReady : !stream;

  /** The reader is near the last card drawn: draw more, and when all are drawn, read the next page. */
  const reach = useCallback(() => {
    if (lens === 'all' && shown < flowShown.length) setShown((count) => Math.min(flowShown.length, count + REVEAL));
    else void loadMore();
  }, [lens, shown, flowShown.length, loadMore]);

  // Read the next page while the reader is still on the last few, so it is there when they arrive.
  useEffect(() => {
    if (lens === 'all' && user && flowReady && cursor !== null && !more && flowShown.length - shown <= PREFETCH_AHEAD) void loadMore();
  }, [lens, user, flowReady, cursor, more, flowShown.length, shown, loadMore]);

  const posts = (cards: PostCard[], promoted = false) => cards.map((card) => (
    <SocialPostCard key={card.post.id} card={card} promoted={promoted} inDiscover />
  ));
  const openContests = contests.filter((card) => card.post.contest && contestPhase(card.post.contest) !== 'ended');
  const liveCount = live.length + openContests.filter((card) => !live.some((other) => other.post.id === card.post.id)).length;
  const paged = lens === 'all' || lens === 'debates' || lens === 'shelves';
  const hasMore = lens === 'all' ? shown < flowShown.length || cursor !== null : next !== null;
  const guestLeft = !user && lens === 'all' && cursor !== null ? Math.max(0, flowShown.length - shown) : null;

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

  function freshen() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    rememberSeen(flow.slice(0, shown).map((item) => item.card.post.id));
    setFlowReady(false);
    void load();
  }

  const showChips = (lens === 'all' || lens === 'finds') && categories.length > 1;

  return (
    <main className="page discpage">
      <header className="dischero">
        <div className="dischero__row">
          <h1 className="dischero__title">Discover</h1>
          <div className="dischero__actions">
            {liveCount > 0 && (
              <button type="button" className="dischero__stat" onClick={() => setLens('live')}>
                <span className="dischero__pulse" aria-hidden="true" /> <strong>{liveCount}</strong> live
              </button>
            )}
            <button type="button" className={`iconbtn dischero__btn${searchOpen ? ' is-on' : ''}`} aria-label="Search Discover"
              aria-expanded={searchOpen} onClick={() => {
                if (searchOpen) setParam('q', null);
                setSearchOpen(!searchOpen);
              }}>
              <Icon name={searchOpen ? 'close' : 'search'} size={18} />
            </button>
            <button type="button" className={`iconbtn dischero__btn${lens === 'week' ? ' is-on' : ''}`} aria-label="This week's best"
              aria-pressed={lens === 'week'} onClick={() => setLens(lens === 'week' ? 'all' : 'week')}>
              <Icon name="trophy" size={18} />
            </button>
          </div>
        </div>
        {!user && (
          <button type="button" className="dischero__guest" onClick={() => promptAuth('Sign in to vote, react and follow.')}>
            <span>Sign in to vote, enter competitions and follow people</span>
            <Icon name="right" size={14} />
          </button>
        )}
      </header>

      {searchOpen && (
        <SearchPanel query={query} onQuery={(value) => setParam('q', value || null)}
          topics={rails.topics} flow={flow} />
      )}

      <nav className="dislens" aria-label="Show">
        {LENSES.map((entry) => (
          <button key={entry.id} type="button" className={`dislens__tab${lens === entry.id ? ' is-on' : ''}`}
            aria-pressed={lens === entry.id} onClick={() => setLens(entry.id)}>
            <Icon name={entry.icon} size={14} /> {entry.label}
            {entry.id === 'live' && liveCount > 0 && <span className="dislens__count">{liveCount}</span>}
          </button>
        ))}
      </nav>

      {showChips && (
        <nav className="discats" aria-label="Categories">
          <button type="button" className={`discat${!category ? ' is-on' : ''}`} aria-pressed={!category} onClick={() => setParam('cat', null)}>
            All
          </button>
          {categories.map((name) => {
            const yours = leaning.includes(name);
            return (
              <button key={name} type="button" className={`discat${category === name ? ' is-on' : ''}${yours ? ' discat--yours' : ''}`}
                aria-pressed={category === name} title={yours ? 'You save from this category' : undefined}
                onClick={() => setParam('cat', category === name ? null : name)}>
                {yours && <Icon name="heart" size={11} />} {name}
              </button>
            );
          })}
        </nav>
      )}

      {error && <ErrorNotice message={error} />}

      {fresh && (
        <button type="button" className="discfresh" onClick={freshen}>
          <Icon name="up" size={14} /> New posts
        </button>
      )}

      {loading ? (
        <DiscoverSkeleton />
      ) : lens === 'all' ? (
        <>
          {spots.length > 0 && !words.length && <SpotlightDeck spots={spots} />}
          {rails.topics.length > 0 && !narrowed && (
            <nav className="distopics" aria-label="Topics">
              {rails.topics.slice(0, TOPICS_INLINE).map((topic) => (
                <Link key={topic.key} to={`/tags/${encodeURIComponent(tagSlug(topic.key))}`} className="distopic">
                  #{topic.label.replace(/ /g, '')}
                  <span className="faint">{topic.posts}</span>
                </Link>
              ))}
              {rails.topics.length > TOPICS_INLINE && (
                <button type="button" className="distopic distopic--more" onClick={() => setSearchOpen(true)}>
                  All topics
                </button>
              )}
            </nav>
          )}
          {narrowed && (
            <p className="discnarrow">
              {flowShown.length === 0 ? 'Nothing here matches yet.' : `Showing posts about ${[category, words.length ? `“${query.trim()}”` : null].filter(Boolean).join(' and ')}.`}
              <button type="button" className="discnarrow__clear" onClick={() => {
                setParam('cat', null);
                setParam('q', null);
              }}>Clear</button>
            </p>
          )}
          {/* The people rail is always woven in for somebody signed in, and draws
              nothing when there is nobody to suggest: it is not content, so on
              its own it must not stand in for the empty state. */}
          {entries.every((entry) => entry.kind === 'people') ? (
            narrowed ? null : (
              <>
                <EmptyState title="Quiet right now">
                  Nothing is trending yet. Start a debate or share your shelf with the + below, and be the first thing here.
                </EmptyState>
                {user && <FollowSuggestions title="People to follow" />}
              </>
            )
          ) : (
            <div className="discover__stream" onClick={noteTap}>
              {entries.map((entry, index) => {
                switch (entry.kind) {
                  case 'rail': return <FindRail key={`r${index}`} finds={entry.finds} first={index < 3} onAll={() => setLens('finds')} />;
                  case 'people': return <FollowSuggestions key="people" title="People to follow" />;
                  case 'hunts': return <HuntRail key="hunts" wants={entry.wants} />;
                  case 'spotted': return <SpottedRail key="spotted" items={entry.items} onAll={() => setLens('finds')} />;
                  case 'divider': return <p key={entry.key} className="discend discend--lap">{entry.text}</p>;
                  default: return (
                    <SocialPostCard key={entry.key} card={entry.card} inDiscover
                      promoted={entry.card.social.commentCount >= HOT_THREAD && !entry.card.post.debate && !entry.card.post.flex} />
                  );
                }
              })}
            </div>
          )}
        </>
      ) : lens === 'finds' ? (
        <FindsView finds={shownFinds} spotted={rails.spotted} category={category} />
      ) : lens === 'week' ? (
        <WeeklyBest />
      ) : lens === 'live' ? (
        <LiveView live={live} contests={contests} posts={posts} />
      ) : lens === 'debates' ? (
        lists.debates.length || lists.threads.length ? (
          <div className="discover__stream">
            {posts(lists.debates)}
            {lists.threads.length > 0 && (
              <>
                <h2 className="discsection"><Icon name="message" size={15} /> Conversations taking off</h2>
                {posts(lists.threads, true)}
              </>
            )}
          </div>
        ) : (
          <EmptyState title="No debates yet">Put two pieces side by side with the + below and let people vote.</EmptyState>
        )
      ) : (
        lists.flexes.length ? <div className="discover__stream">{posts(lists.flexes)}</div> : (
          <EmptyState title="No shelves yet">Share your shelf with its pieces tagged, from the + below.</EmptyState>
        )
      )}

      {!loading && paged && (guestWall ? (
        <DiscoverWall onJoin={() => promptAuth('Join to keep scrolling, vote and follow.')} />
      ) : hasMore ? (
        <>
          {guestLeft !== null && guestLeft <= REVEAL && (
            <p className="discguest">
              {guestLeft > 0 ? `${guestLeft} more post${guestLeft === 1 ? '' : 's'}, then` : 'From here,'} join free to keep scrolling.
            </p>
          )}
          <MoreSentinel busy={more} onReach={reach} />
        </>
      ) : lens === 'all' && flow.length > 0 && (
        <div className="discend">
          <p>That is everything for now. Check back soon, or start something with the + below.</p>
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => void share()}>
            <Icon name="share" size={14} /> Share Discover
          </button>
        </div>
      ))}
    </main>
  );
}

/**
 * Searching Discover: topics to open, and the words to look for in posts here
 * (the stream narrows as you type), in the topic's own page, or in the shop.
 */
function SearchPanel({ query, onQuery, topics, flow }: {
  query: string;
  onQuery: (value: string) => void;
  topics: TopicChip[];
  flow: FlowItem[];
}) {
  const [draft, setDraft] = useState(query);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (draft !== query) onQuery(draft.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draft, query, onQuery]);
  const term = tagKey(draft.trim());
  // Topics people post under, and any more seen in the posts already read.
  const known = useMemo(() => {
    const byKey = new Map(topics.map((topic) => [topic.key, { key: topic.key, label: topic.label.replace(/ /g, ''), posts: topic.posts }]));
    for (const item of flow) {
      for (const key of topicsOfCard(item.card)) {
        if (!byKey.has(key)) byKey.set(key, { key, label: key, posts: 0 });
      }
    }
    return [...byKey.values()];
  }, [topics, flow]);
  const matching = term ? known.filter((topic) => topic.key.includes(term)) : known;
  return (
    <section className="discsearch" aria-label="Search Discover">
      <label className="discsearch__field">
        <Icon name="search" size={16} />
        <input type="search" value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus
          placeholder="Search posts and topics" aria-label="Search posts and topics" enterKeyHint="search" />
      </label>
      {matching.length > 0 && (
        <div className="discsearch__topics">
          {matching.slice(0, 24).map((topic) => (
            <Link key={topic.key} to={`/tags/${encodeURIComponent(tagSlug(topic.key))}`} className="distopic">
              #{topic.label}{topic.posts > 0 && <span className="faint">{topic.posts}</span>}
            </Link>
          ))}
        </div>
      )}
      {term && (
        <div className="discsearch__go">
          {!known.some((topic) => topic.key === term) && (
            <Link to={`/tags/${encodeURIComponent(tagSlug(term))}`} className="discsearch__link">
              <Icon name="forum" size={14} /> Posts tagged #{term}
            </Link>
          )}
          <Link to={`/?q=${encodeURIComponent(draft.trim())}`} className="discsearch__link">
            <Icon name="tag" size={14} /> Search the shop for “{draft.trim()}”
          </Link>
        </div>
      )}
    </section>
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

/** Where a guest's scrolling stops: laid over the last posts, faded, so it is clear what waits. */
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
function FindRail({ finds, first, onAll }: { finds: Find[]; first: boolean; onAll: () => void }) {
  return (
    <section className="discrail" aria-label={first ? 'Worth a look, for you' : 'More finds'}>
      <div className="discrail__head">
        <h2>{first ? 'Worth a look, for you' : 'More finds'}</h2>
        <button type="button" className="discrail__all" onClick={onAll}>See all</button>
      </div>
      <div className="discrail__row">
        {finds.map((find) => <FindCard key={find.listing.id} find={find} />)}
      </div>
    </section>
  );
}

/** A picture for an item card: its photo, or the category's mark when it has none. */
function ItemArt({ seed, title, category, photo, badge }: {
  seed: string; title: string; category: string | null; photo: { url?: string; thumbUrl?: string } | null; badge: 'sale' | 'iso';
}) {
  if (photo?.url) {
    return (
      <Thumb seed={seed} label={title} photo={photo} className="thumb discitem__photo">
        <ContentBadge type={badge} />
      </Thumb>
    );
  }
  return (
    <span className="discitem__photo discitem__photo--blank">
      <ContentBadge type={badge} />
      <Icon name={badge === 'iso' ? 'target' : 'tag'} size={26} />
      {category && <span className="discitem__cat">{category}</span>}
    </span>
  );
}

function FindCard({ find }: { find: Find }) {
  const { listing, why } = find;
  const { user, promptAuth } = useSession();
  const [saved, setSaved] = useState(listing.liked);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const was = Math.max(0, ...(listing.priceHistory ?? []).map((entry) => entry.priceMinor));
  async function save(event: ReactMouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (!user) {
      promptAuth('Sign in to save items.');
      return;
    }
    if (busy) return;
    setBusy(true);
    const before = saved;
    setSaved(!before);
    try {
      const { liked } = await api.like(listing.id);
      setSaved(liked);
      if (liked) toast('Saved');
    } catch {
      setSaved(before);
      toast('Could not save that');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Link to={`/listing/${encodeURIComponent(listing.id)}`} className="discitem">
      <span className="discitem__art">
        <ItemArt seed={listing.id} title={listing.title} category={listing.category} photo={leadPhoto(listing)} badge="sale" />
        <button type="button" className={`discitem__save${saved ? ' is-on' : ''}`} onClick={(event) => void save(event)}
          aria-label={saved ? `Saved: ${listing.title}` : `Save ${listing.title}`} aria-pressed={saved}>
          <Icon name="heart" size={15} />
        </button>
      </span>
      <span className="discitem__body">
        <span className={`discitem__why discitem__why--${why.kind}`}>{why.label}</span>
        <span className="discitem__name">{listing.title}</span>
        <span className="discitem__meta">
          <strong>{formatMoney(listing.priceMinor, listing.currency)}</strong>
          {was > listing.priceMinor
            ? <s className="faint">{formatMoney(was, listing.currency)}</s>
            : <span className="faint">{factsOf(listing).condition}</span>}
        </span>
      </span>
    </Link>
  );
}

/** The Finds lens: things seen in posts first, then the catalogue's finds. */
function FindsView({ finds, spotted, category }: { finds: Find[]; spotted: SpottedItem[]; category: string | null }) {
  if (finds.length === 0 && spotted.length === 0) {
    return (
      <EmptyState title={category ? `Nothing in ${category} right now` : 'No finds today'}>
        Nothing is running low, dropping in price or filling fast. Check back after the next drop.
      </EmptyState>
    );
  }
  return (
    <div className="discover__stream">
      {spotted.length > 0 && !category && <SpottedRail items={spotted} />}
      {finds.length > 0 && (
        <section className="discrail">
          <div className="discrail__head"><h2>{category ? `Finds in ${category}` : 'Low stock, price drops & in demand'}</h2></div>
          <div className="discgrid">{finds.map((find) => <FindCard key={find.listing.id} find={find} />)}</div>
        </section>
      )}
    </div>
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
            <ItemArt seed={want.id} title={want.title} category={null} photo={want.photoUrl ? { url: want.photoUrl } : null} badge="iso" />
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

/** A name, cut to the first word: "Karan Malhotra" is Karan on a small label. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Things seen on somebody's shelf or in a debate, that can be bought now. */
function SpottedRail({ items, onAll }: { items: SpottedItem[]; onAll?: () => void }) {
  return (
    <section className="discrail" aria-label="Spotted in posts, buyable now">
      <div className="discrail__head">
        <h2>Spotted in posts</h2>
        {onAll && <button type="button" className="discrail__all" onClick={onAll}>See all</button>}
      </div>
      <div className="discrail__row">
        {items.map((item) => (
          <Link key={item.listingId} className="discitem" to={`/listing/${encodeURIComponent(item.listingId)}`}>
            <ItemArt seed={item.listingId} title={item.title} category={null} photo={item.photoUrl ? { url: item.photoUrl } : null} badge="sale" />
            <span className="discitem__body">
              <span className="discitem__why discitem__why--hot" title={`${item.how === 'debate' ? 'In a debate by' : 'On the shelf of'} ${item.spottedBy}`}>
                {item.how === 'debate' ? `In ${firstName(item.spottedBy)}’s debate` : `On ${firstName(item.spottedBy)}’s shelf`}
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

/* ── the spotlight ───────────────────────────────────────────────────────── */

/** One card in the spotlight deck: a picture, what it is, and where it goes. */
interface Spot {
  id: string;
  /** The post behind it, so the stream can hold it back from the top. */
  postId: string | null;
  kind: string;
  icon: IconName;
  title: string;
  /** Who, what it costs, or what it gives away. */
  line: string | null;
  /** How many have joined in, said short. */
  count: string | null;
  /** When it stops taking part, and whether that is soon. */
  left: { text: string; soon: boolean } | null;
  photo: string | null;
  href: string;
  cta: string;
  tone: string;
}

/** Most cards the deck holds: enough to keep flicking, few enough to finish. */
const SPOTS_MAX = 8;
/** Hours before closing that a card says so in the hot colour. */
const SOON_HOURS = 6;

/**
 * The deck's cards, from what the page already read: the liveliest open game
 * (closing soonest first), a competition, the most loved shelf, the hottest
 * debate, a find, something rising - then round again. No request of its own.
 */
function spotlight(live: PostCard[], contests: PostCard[], stream: Stream, finds: Find[]): Spot[] {
  const post = (card: PostCard, kind: string, icon: IconName, tone: string, cta: string, line: string | null = null): Spot => ({
    id: `p${card.post.id}`,
    postId: card.post.id,
    kind,
    icon,
    title: card.post.contest?.title ?? (card.post.body || 'Which one?'),
    line: line ?? `by ${card.post.authorName}`,
    count: countOf(card),
    left: closing(card),
    photo: pictures(card)[0] ?? null,
    href: postHref(card.post),
    cta,
    tone,
  });
  const soonest = [...live].sort((a, b) => (closesAt(a) ?? Infinity) - (closesAt(b) ?? Infinity));
  const fromLive = soonest.map((card) => {
    const kind = liveKind(card);
    return post(card, kind.label, kind.icon, kind.tone, kind.cta);
  });
  const fromContests = contests.filter((card) => card.post.contest && contestPhase(card.post.contest) !== 'ended')
    .map((card) => post(card, 'Competition', 'trophy', 'gold', contestPhase(card.post.contest!) === 'entries' ? 'Enter' : 'Vote', prizeOf(card)));
  const fromFlexes = stream.flexes.map((card) => post(card, 'Shelf', 'camera', 'violet', 'See the shelf'));
  const fromDebates = stream.debates.map((card) => post(card, 'Debate', 'forum', 'pink', 'Pick a side'));
  const fromRising = stream.rising.map((card) => post(card, 'Rising', 'rising', 'aqua', 'Open'));
  const fromFinds = finds.map(({ listing, why }): Spot => ({
    id: `l${listing.id}`,
    postId: null,
    kind: why.label,
    icon: 'tag',
    title: listing.title,
    line: formatMoney(listing.priceMinor, listing.currency),
    count: null,
    left: null,
    photo: leadPhoto(listing)?.url ?? null,
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
 * Flick it left for the next, right for the one before - or use the arrows,
 * the dots or the arrow keys. A small, physical way to come across something.
 */
function SpotlightDeck({ spots }: { spots: Spot[] }) {
  const [at, setAt] = useState(0);
  const [flying, setFlying] = useState<{ id: string; way: 1 | -1 } | null>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const moved = useRef(false);
  const count = spots.length;
  const current = ((at % count) + count) % count;

  // A narrower deck (a category picked, a search typed) starts again from the top.
  useEffect(() => {
    setAt(0);
  }, [count]);

  /** Send the top card away: left shows the next, right the one before. */
  const fling = useCallback((way: 1 | -1) => {
    if (flying || count < 2) return;
    setFlying({ id: spots[current]!.id, way });
    window.setTimeout(() => {
      setAt((value) => value + (way < 0 ? 1 : -1));
      setFlying(null);
      setDrag(0);
    }, FLING_MS);
  }, [current, count, flying, spots]);

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
  const onKey = (event: ReactKeyboardEvent) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      fling(-1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      fling(1);
    }
  };

  return (
    <section className="spotdeck" aria-roledescription="carousel" aria-label="Spotlight" onKeyDown={onKey}>
      <div className="spotdeck__head">
        <h2><Icon name="spark" size={15} /> Spotlight</h2>
        <span className="spotdeck__count" aria-live="polite">{current + 1} of {count}</span>
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
          const depth = (index - current + count) % count;
          const isFlying = flying?.id === spot.id;
          const top = depth === 0;
          const style = top && !isFlying && drag !== 0
            ? { transform: `translateX(${drag}px) rotate(${drag / 18}deg)`, transition: 'none' }
            : undefined;
          return (
            <Link key={spot.id} to={spot.href} tabIndex={top ? 0 : -1} aria-hidden={!top}
              aria-roledescription="slide" aria-label={top ? `${spot.kind}: ${spot.title}, ${current + 1} of ${count}` : undefined}
              className={`spotcard spotcard--${spot.tone}${isFlying ? ` is-flying is-flying--${flying!.way > 0 ? 'right' : 'left'}` : ''}`}
              data-depth={Math.min(depth, 3)} style={style} draggable={false}>
              {spot.photo
                ? <img className="spotcard__photo" src={spot.photo} alt="" loading={depth < 3 ? 'eager' : 'lazy'} draggable={false} />
                : <span className="spotcard__mark" aria-hidden="true"><Icon name={spot.icon} size={64} /></span>}
              <span className="spotcard__shade" aria-hidden="true" />
              <span className="spotcard__top">
                <span className="spotcard__kind"><Icon name={spot.icon} size={12} /> {spot.kind}</span>
                {spot.left && <span className={`spotcard__left${spot.left.soon ? ' is-soon' : ''}`}>{spot.left.text}</span>}
              </span>
              <span className="spotcard__body">
                <span className="spotcard__title">{spot.title}</span>
                <span className="spotcard__foot">
                  <span className="spotcard__line">
                    {[spot.line, spot.count].filter(Boolean).join(' · ')}
                  </span>
                  <span className="spotcard__cta">{spot.cta} <Icon name="right" size={12} /></span>
                </span>
              </span>
            </Link>
          );
        })}
      </div>
      {count > 1 && (
        <div className="spotdeck__controls">
          <button type="button" className="spotdeck__arrow" aria-label="Previous" onClick={() => fling(1)}>
            <Icon name="left" size={16} />
          </button>
          <span className="spotdeck__dots">
            {spots.map((spot, index) => (
              <button key={spot.id} type="button" className={index === current ? 'is-on' : undefined}
                aria-label={`Show ${index + 1}: ${spot.kind}`} aria-current={index === current}
                onClick={() => setAt(index)} />
            ))}
          </span>
          <button type="button" className="spotdeck__arrow" aria-label="Next" onClick={() => fling(-1)}>
            <Icon name="right" size={16} />
          </button>
        </div>
      )}
    </section>
  );
}

/** What a live card is, in a word, a mark and a colour. */
function liveKind(card: PostCard): { icon: IconName; label: string; cta: string; tone: string } {
  const { post, social } = card;
  if (post.contest) return { icon: 'trophy', label: 'Competition', cta: contestPhase(post.contest) === 'entries' ? 'Enter' : 'Vote', tone: 'gold' };
  if (social.guess) return { icon: 'target', label: 'Guess the price', cta: 'Guess', tone: 'violet' };
  if (post.debate) return { icon: 'forum', label: 'Debate', cta: 'Pick a side', tone: 'pink' };
  if (social.poll?.style === 'rating') return { icon: 'star', label: 'Rate it', cta: 'Rate', tone: 'gold' };
  return { icon: 'poll', label: social.poll?.stock ? 'Stock poll' : 'Poll', cta: 'Vote', tone: 'aqua' };
}

/** When a live card stops taking part, as a time. */
function closesAt(card: PostCard): number | null {
  const { post, social } = card;
  const at = post.contest
    ? (contestPhase(post.contest) === 'entries' ? post.contest.entriesCloseAt : post.contest.endsAt)
    : social.guess?.revealAt ?? social.poll?.closesAt ?? null;
  if (!at) return null;
  const time = Date.parse(at);
  return time > Date.now() ? time : null;
}

/** When a live card stops taking part, said short, and whether that is soon. */
function closing(card: PostCard): { text: string; soon: boolean } | null {
  const at = closesAt(card);
  if (at === null) return null;
  const hours = (at - Date.now()) / 3_600_000;
  const text = hours < 1 ? 'Ends within the hour' : hours < 24 ? `${Math.round(hours)}h left` : `${Math.round(hours / 24)}d left`;
  return { text, soon: hours < SOON_HOURS };
}

/** How many have joined in, said short. */
function countOf(card: PostCard): string | null {
  if (card.post.contest) {
    const entries = card.post.contest.entries.length;
    return `${entries} ${entries === 1 ? 'entry' : 'entries'}`;
  }
  if (card.social.guess) return `${card.social.guess.count} guess${card.social.guess.count === 1 ? '' : 'es'}`;
  if (card.social.poll) return `${card.social.poll.total} vote${card.social.poll.total === 1 ? '' : 's'}`;
  const reactions = card.social.reactions.total;
  return reactions ? `${reactions} reaction${reactions === 1 ? '' : 's'}` : null;
}

/** What a competition gives its winner, said short. */
function prizeOf(card: PostCard): string | null {
  const top = card.post.contest?.prizes[0];
  if (!top) return null;
  const prize = [top.amountMinor > 0 ? `${formatMoney(top.amountMinor, 'INR')} credit` : '', top.note].filter(Boolean).join(' + ');
  return prize ? `Win ${prize}` : null;
}

/** Up to three pictures that say what a live card is about. */
function pictures(card: PostCard): string[] {
  const { post, social } = card;
  const fromPoll = (social.poll?.options ?? []).map((option) => option.photoUrl).filter((url): url is string => Boolean(url));
  const fromContest = (post.contest?.entries ?? []).map((entry) => entry.photoUrl);
  const own = post.photoUrls?.length ? post.photoUrls : post.photoUrl ? [post.photoUrl] : [];
  return [...fromPoll, ...own, ...fromContest].slice(0, 3);
}

/* ── the Live lens ───────────────────────────────────────────────────────── */

/**
 * Everything open to take part in: what closes within the day first, then the
 * competitions shops are running, then every other open poll, guess and
 * debate, and last the competitions that just finished.
 */
function LiveView({ live, contests, posts }: {
  live: PostCard[];
  contests: PostCard[];
  posts: (cards: PostCard[]) => ReactNode;
}) {
  const now = Date.now();
  const soonCut = now + 24 * 3_600_000;
  const open = contests.filter((card) => card.post.contest && contestPhase(card.post.contest) !== 'ended');
  const ended = contests.filter((card) => card.post.contest && contestPhase(card.post.contest) === 'ended');
  const all = [...new Map([...live, ...open].map((card) => [card.post.id, card])).values()];
  const soon = all.filter((card) => (closesAt(card) ?? Infinity) < soonCut)
    .sort((a, b) => (closesAt(a) ?? 0) - (closesAt(b) ?? 0));
  const soonIds = new Set(soon.map((card) => card.post.id));
  const competitions = open.filter((card) => !soonIds.has(card.post.id));
  const rest = live.filter((card) => !soonIds.has(card.post.id) && !card.post.contest);
  if (all.length === 0 && ended.length === 0) {
    return (
      <EmptyState title="You're all caught up">
        Every open poll, guess and competition here has your vote. Start one with the + below.
      </EmptyState>
    );
  }
  return (
    <div className="discover__stream">
      {soon.length > 0 && (
        <>
          <h2 className="discsection discsection--soon"><span className="dischero__pulse" aria-hidden="true" /> Closing soon</h2>
          {posts(soon)}
        </>
      )}
      {competitions.length > 0 && (
        <>
          <h2 className="discsection" id="competitions"><Icon name="trophy" size={15} /> Competitions</h2>
          <ContestRow cards={competitions} />
        </>
      )}
      {rest.length > 0 && (
        <>
          <h2 className="discsection"><Icon name="poll" size={15} /> Open to vote</h2>
          {posts(rest)}
        </>
      )}
      {ended.length > 0 && (
        <>
          <h2 className="discsection"><Icon name="check" size={15} /> Just finished</h2>
          <ContestRow cards={ended} />
        </>
      )}
    </div>
  );
}

/** The competitions row: what each shop is giving away, and how long is left. */
function ContestRow({ cards }: { cards: PostCard[] }) {
  return (
    <div className="dislive__row">
      {cards.map((card, index) => {
        const contest = card.post.contest!;
        const phase = contestPhase(contest);
        const top = contest.prizes[0];
        const cover = card.post.photoUrl ?? contest.winners?.[0]?.photoUrl ?? contest.entries[0]?.photoUrl ?? null;
        const left = closing(card);
        return (
          <Link key={card.post.id} to={postHref(card.post)} className="contestcard" style={{ animationDelay: `${index * 40}ms` }}>
            <span className="contestcard__art">
              {cover ? <img src={cover} alt="" loading="lazy" /> : <Icon name={contest.host === 'figmark' ? 'star' : 'trophy'} size={40} />}
              <span className={`contestcard__phase contestcard__phase--${phase}`}>
                {phase === 'entries' ? 'Entries open' : phase === 'voting' ? 'Voting' : phase === 'ended' ? 'Winners' : 'Judging'}
              </span>
            </span>
            <span className="contestcard__body">
              <strong>{contest.title}</strong>
              <span className="faint">{contest.host === 'figmark' ? 'Figmark weekly challenge' : contest.hostName}</span>
              {top && (
                <span className="contestcard__prize">
                  <Icon name="trophy" size={12} /> {[top.amountMinor > 0 ? `${formatMoney(top.amountMinor, 'INR')} credit` : '', top.note].filter(Boolean).join(' + ')}
                </span>
              )}
              <span className="livecard__meta">
                <span>{contest.entries.length} {contest.entries.length === 1 ? 'entry' : 'entries'}</span>
                {left && <span className={`livecard__left${left.soon ? ' is-soon' : ''}`}>{left.text}</span>}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}

/* ── the week's best ─────────────────────────────────────────────────────── */

/** A place on a board: the first three marked, the rest numbered. */
function Rank({ at }: { at: number }) {
  return <span className={`discweek__rank${at < 3 ? ` discweek__rank--${at + 1}` : ''}`}>{at + 1}</span>;
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
      <h2 className="discsection"><Icon name="trophy" size={15} /> This week’s best</h2>
      {players.length > 0 && (
        <section className="discweek__block">
          <h2><Icon name="star" size={16} /> Top players</h2>
          <ol className="discweek__list">
            {players.map((player, index) => {
              const row = (
                <>
                  <Rank at={index} />
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
          <h2><Icon name="camera" size={16} /> Most loved shelves</h2>
          <ol className="discweek__list">
            {board.shelves.map((shelf, index) => (
              <li key={shelf.postId}>
                <Link to={postHref({ channelId: shelf.channelId, id: shelf.postId })} className="discweek__row">
                  <Rank at={index} />
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
          <h2><Icon name="forum" size={16} /> Most argued debates</h2>
          <ol className="discweek__list">
            {board.debates.map((debate, index) => (
              <li key={debate.postId}>
                <Link to={postHref({ channelId: debate.channelId, id: debate.postId })} className="discweek__row">
                  <Rank at={index} />
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
          <h2><Icon name="megaphone" size={16} /> Voices of the week</h2>
          <ol className="discweek__list">
            {board.voices.map((voice, index) => {
              const row = (
                <>
                  <Rank at={index} />
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
