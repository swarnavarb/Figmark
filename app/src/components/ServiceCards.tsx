import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RouteMatch, type SearchStore, type StudioMatch } from '../api';
import { FREIGHT_MODE_LABELS } from '@shared/service-stores';
import { countryFlag } from '@shared/countries';
import { formatMoney } from '../format';
import { accentStyle } from './StoreKit';
import { initialsOf } from '../format';

/**
 * Forwarders and artists, shown where they are some use.
 *
 * A service card in the Shop sits beside the items it fits - a forwarder after
 * an imported item, an artist after a loose figure - rather than at random,
 * where it would read as an advert. It is the size of an item card, so the
 * grid keeps its rhythm, and says "Service" on it, so nobody takes it for one.
 *
 * Who is shown rotates: weighted by rating, work done and level, with a lift
 * for stores still waiting on their first jobs, and kept steady for the day so
 * a scroll back up finds the same card.
 */

export interface ForwarderPick {
  kind: 'forwarder';
  store: SearchStore;
  /** Their cheapest few routes. */
  lanes: RouteMatch['lane'][];
}

export interface ArtistPick {
  kind: 'artist';
  store: SearchStore;
  services: StudioMatch['services'];
  fromMinor: number;
  portfolio: string[];
  specialties: string[];
}

export type ProviderPick = ForwarderPick | ArtistPick;

export interface Providers {
  forwarders: ForwarderPick[];
  artists: ArtistPick[];
}

/** Read once a session: who offers what changes slowly, and every screen asks the same thing. */
let loading: Promise<Providers> | null = null;

function loadProviders(): Promise<Providers> {
  loading ??= Promise.all([
    api.searchRoutes({}).catch(() => ({ routes: [] as RouteMatch[] })),
    api.searchStudios('').catch(() => ({ studios: [] as StudioMatch[] })),
  ]).then(([routes, studios]) => ({
    forwarders: forwardersFrom(routes.routes),
    artists: studios.studios.filter((studio) => studio.acceptingWork).map(artistFrom),
  }));
  return loading;
}

function forwardersFrom(routes: RouteMatch[]): ForwarderPick[] {
  const byStore = new Map<string, ForwarderPick>();
  for (const route of routes) {
    const pick = byStore.get(route.store.ownerId) ?? { kind: 'forwarder' as const, store: route.store, lanes: [] };
    pick.lanes.push(route.lane);
    byStore.set(route.store.ownerId, pick);
  }
  for (const pick of byStore.values()) pick.lanes.sort((a, b) => a.fromMinor - b.fromMinor);
  return [...byStore.values()];
}

function artistFrom(studio: StudioMatch): ArtistPick {
  return {
    kind: 'artist', store: studio.store, services: studio.services, fromMinor: studio.fromMinor,
    portfolio: studio.portfolio, specialties: studio.specialties,
  };
}

/** Everybody offering a service, in today's rotation. Empty until it loads, and on any failure. */
export function useProviders(): Providers {
  const [providers, setProviders] = useState<Providers>({ forwarders: [], artists: [] });
  useEffect(() => {
    let live = true;
    void loadProviders().then((all) => live && setProviders({
      forwarders: rotate(all.forwarders),
      artists: rotate(all.artists),
    }));
    return () => { live = false; };
  }, []);
  return providers;
}

/** Studios matching some words, for search: their own answer, best first. */
export function useStudioSearch(query: string | null): ArtistPick[] | null {
  const [studios, setStudios] = useState<ArtistPick[] | null>(null);
  useEffect(() => {
    setStudios(null);
    if (!query) return;
    let live = true;
    api.searchStudios(query)
      .then((result) => live && setStudios(result.studios.filter((studio) => studio.acceptingWork).map(artistFrom)))
      .catch(() => live && setStudios([]));
    return () => { live = false; };
  }, [query]);
  return studios;
}

/* ── Rotation ─────────────────────────────────────────────────────────── */

/** How much a store has earned a place: rating, work done, level - and a lift while it is new. */
export function standingWeight(store: SearchStore): number {
  const rating = store.rating === null ? 0.6 : store.rating / 5;
  const work = Math.min(store.completed, 50) / 50;
  const newcomer = store.completed < 3 ? 0.8 : 0;
  return 1 + rating + work + store.level * 0.1 + newcomer;
}

/** A seed that holds for the day on this device: different people see different stores, nobody sees them shuffle. */
function daySeed(): number {
  let device = '';
  try {
    device = localStorage.getItem('fm:svc-seed') ?? '';
    if (!device) {
      device = Math.random().toString(36).slice(2);
      localStorage.setItem('fm:svc-seed', device);
    }
  } catch {
    // A private window: the day alone still keeps it steady.
  }
  const key = `${new Date().toISOString().slice(0, 10)}:${device}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function random(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A weighted shuffle: every store can come first, the better-standing more
 * often. (Each draws a key of u^(1/weight); sorting by it is a weighted draw.)
 */
export function rotate<T extends { store: SearchStore }>(picks: T[], seed = daySeed()): T[] {
  const next = random(seed);
  return picks
    .map((pick) => ({ pick, key: Math.pow(next(), 1 / standingWeight(pick.store)) }))
    .sort((a, b) => b.key - a.key)
    .map((entry) => entry.pick);
}

/* ── Placement in the Shop grid ───────────────────────────────────────── */

/** Items between service cards, at least: enough that the Shop stays a shop. */
export const SERVICE_GAP = 12;
/** The first one waits until the buyer has seen a screenful of items. */
const FIRST_AT = 5;
/** How far it looks ahead for an item it fits before settling for any spot. */
const PATIENCE = 6;

interface Placeable { sourcing: string; condition: string }

/**
 * Where service cards go in a list of items: after the item index each is
 * keyed by. A forwarder follows an imported item, an artist a loose one; if
 * none turns up for a while, whichever kind is due takes the next spot.
 */
export function placeServices(items: Placeable[], providers: Providers): Map<number, ProviderPick> {
  const placed = new Map<number, ProviderPick>();
  const queue = { forwarder: [...providers.forwarders], artist: [...providers.artists] };
  let due = FIRST_AT;
  let turn: 'forwarder' | 'artist' = 'forwarder';
  for (let i = 0; i < items.length; i += 1) {
    if (i < due) continue;
    if (queue.forwarder.length === 0 && queue.artist.length === 0) break;
    const item = items[i]!;
    let pick: ProviderPick | undefined;
    if (item.sourcing === 'import' && queue.forwarder.length) pick = queue.forwarder.shift();
    else if (item.condition === 'LOOSE' && queue.artist.length) pick = queue.artist.shift();
    else if (i >= due + PATIENCE) {
      const kind = queue[turn].length ? turn : turn === 'forwarder' ? 'artist' : 'forwarder';
      pick = queue[kind].shift();
    }
    if (!pick) continue;
    placed.set(i, pick);
    turn = pick.kind === 'forwarder' ? 'artist' : 'forwarder';
    due = i + SERVICE_GAP;
  }
  return placed;
}

/* ── The card ─────────────────────────────────────────────────────────── */

export function ServiceCard({ pick }: { pick: ProviderPick }) {
  const { store } = pick;
  return (
    <Link to={`/services/${pick.kind}/${store.slug}`} className={`svcard svcard--${pick.kind}`} style={accentStyle(store.accent)}>
      {pick.kind === 'forwarder' ? <RouteArt pick={pick} /> : <WorkArt pick={pick} />}
      <span className="svcard__tag">{pick.kind === 'forwarder' ? '📦 Forwarder' : '🎨 Artist'}</span>
      <span className="svcard__body">
        <span className="svcard__who">
          <span className="svcard__mark" aria-hidden="true">
            {store.logoUrl ? <img loading="lazy" decoding="async" src={store.logoUrl} alt="" /> : initialsOf(store.name)}
          </span>
          <b>{store.name}</b>
        </span>
        <span className="svcard__standing">
          {store.rating !== null ? <>★ {store.rating.toFixed(1)}</> : 'New'}
          {store.completed > 0 && <> · {store.completed} done</>}
        </span>
        {pick.kind === 'forwarder' ? (
          <span className="svcard__lines">
            {pick.lanes.slice(0, 2).map((lane) => (
              <span key={lane.id} className="svcard__line">
                {countryFlag(lane.originCountry)}→{countryFlag(lane.destinationCountry)}
                {' '}{FREIGHT_MODE_LABELS[lane.mode].glyph}
                {/* The price before the days: on a long sea route it is the days that get cut, not the price. */}
                {lane.fromMinor > 0 && <b> {formatMoney(lane.fromMinor, 'INR')}/kg</b>}
                {' · '}{shortDays(lane.days)}
              </span>
            ))}
          </span>
        ) : (
          <span className="svcard__lines">
            <span className="svcard__line">{pick.services.slice(0, 2).map((service) => service.name).join(' · ') || pick.specialties.slice(0, 2).join(' · ')}</span>
            {pick.fromMinor > 0 && <span className="svcard__line">from <b>{formatMoney(pick.fromMinor, 'INR')}</b></span>}
          </span>
        )}
        <span className="svcard__more">
          {pick.kind === 'forwarder'
            ? `${moreOf(pick.lanes.length - 2, 'route')}More ›`
            : `${moreOf(pick.services.length - 2, 'service')}More ›`}
        </span>
      </span>
    </Link>
  );
}

/** "7–10 days" as "7–10d": a line on a half-width card has no room to spare. */
function shortDays(days: string): string {
  return days.replace(/\s*days?\b/i, 'd');
}

function moreOf(count: number, noun: string): string {
  return count > 0 ? `+${count} ${noun}${count === 1 ? '' : 's'} · ` : '';
}

/** A forwarder's picture is its best route: two flags and the path between them. */
function RouteArt({ pick }: { pick: ForwarderPick }) {
  const lane = pick.lanes[0];
  return (
    <span className="svcard__art svcard__art--route" aria-hidden="true">
      <svg className="svcard__path" viewBox="0 0 120 60" preserveAspectRatio="none">
        <path d="M14 44 C 40 6, 80 6, 106 44" pathLength={100} />
      </svg>
      <span className="svcard__flag">{lane ? countryFlag(lane.originCountry) : '📦'}</span>
      <span className="svcard__plane">{lane ? FREIGHT_MODE_LABELS[lane.mode].glyph : '✈️'}</span>
      <span className="svcard__flag">{lane ? countryFlag(lane.destinationCountry) : '🏠'}</span>
      {lane && <span className="svcard__days">{lane.days}</span>}
    </span>
  );
}

/** An artist's picture is their work: the lead piece, with up to two more beside it. */
function WorkArt({ pick }: { pick: ArtistPick }) {
  const [lead, ...rest] = pick.portfolio;
  if (!lead) {
    return (
      <span className="svcard__art svcard__art--blank" aria-hidden="true">
        <span>🎨</span>
      </span>
    );
  }
  return (
    <span className={`svcard__art svcard__art--work${rest.length ? ' has-side' : ''}`} aria-hidden="true">
      <img className="svcard__lead" loading="lazy" decoding="async" src={lead} alt="" />
      {rest.length > 0 && (
        <span className="svcard__side">
          {rest.slice(0, 2).map((url) => <img key={url} loading="lazy" decoding="async" src={url} alt="" />)}
        </span>
      )}
    </span>
  );
}

/** A row of service cards, for search: "custom paint" brings up the studios that do it. */
export function ServiceStrip({ title, sub, picks }: { title: string; sub?: string; picks: ProviderPick[] | null }) {
  if (!picks || picks.length === 0) return null;
  return (
    <section className="svstrip" aria-label={title}>
      <div className="svstrip__head">
        <h2>{title}</h2>
        {sub && <span className="faint">{sub}</span>}
      </div>
      <div className="svstrip__row">
        {picks.slice(0, 8).map((pick) => <ServiceCard key={`${pick.kind}:${pick.store.ownerId}`} pick={pick} />)}
      </div>
    </section>
  );
}

/** Searches that are really asking for a person, not an item. */
const ARTIST_WORDS = /\b(custom|customi[sz]e|repaint|paint|painting|restor|repair|fix|kitbash|commission|sculpt|weather|artist)/i;
const FORWARDER_WORDS = /\b(forward|forwarder|shipping|ship from|import|cargo|freight|courier)/i;

export function searchWants(query: string): 'artist' | 'forwarder' | null {
  if (ARTIST_WORDS.test(query)) return 'artist';
  if (FORWARDER_WORDS.test(query)) return 'forwarder';
  return null;
}

/**
 * One line pointing at the people who can help with this item, where it
 * helps: studios under a loose figure, forwarders on the Sell form for an
 * import. Says nothing when there is nobody to point at.
 */
export function ServiceNudge({ kind, lead, to }: { kind: 'forwarder' | 'artist'; lead: string; to?: string }) {
  const { forwarders, artists } = useProviders();
  const picks: ProviderPick[] = kind === 'forwarder' ? forwarders : artists;
  if (picks.length === 0) return null;
  const cheapest = kind === 'forwarder'
    ? Math.min(...forwarders.flatMap((pick) => pick.lanes.map((lane) => lane.fromMinor)).filter((value) => value > 0))
    : Math.min(...artists.map((pick) => pick.fromMinor).filter((value) => value > 0));
  const faces = picks.slice(0, 3);
  return (
    <Link to={to ?? `/services/${kind}`} className={`svnudge svnudge--${kind}`}>
      <span className="svnudge__faces" aria-hidden="true">
        {faces.map((pick) => (
          <span key={pick.store.ownerId} className="svcard__mark" style={accentStyle(pick.store.accent)}>
            {pick.store.logoUrl ? <img loading="lazy" decoding="async" src={pick.store.logoUrl} alt="" /> : initialsOf(pick.store.name)}
          </span>
        ))}
      </span>
      <span className="svnudge__text">
        <b>{lead}</b>
        <span>
          {picks.length} {kind === 'forwarder' ? (picks.length === 1 ? 'forwarder' : 'forwarders') : (picks.length === 1 ? 'studio' : 'studios')} on Figmark
          {Number.isFinite(cheapest) && <> · from {formatMoney(cheapest, 'INR')}{kind === 'forwarder' ? '/kg' : ''}</>}
        </span>
      </span>
      <span className="svnudge__go" aria-hidden="true">›</span>
    </Link>
  );
}
