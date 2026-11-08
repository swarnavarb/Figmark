import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type RouteMatch, type SearchStore, type StudioMatch } from '../api';
import { FREIGHT_MODE_LABELS } from '@shared/service-stores';
import { countryCode, countryFlag } from '@shared/countries';
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
 * keyed by (two at one index only at the end of a short Shop). A forwarder follows an imported item, an artist a loose one; if
 * none turns up for a while, whichever kind is due takes the next spot.
 */
export function placeServices(items: Placeable[], providers: Providers): Map<number, ProviderPick[]> {
  const placed = new Map<number, ProviderPick[]>();
  const queue = { forwarder: [...providers.forwarders], artist: [...providers.artists] };
  const shownKinds = new Set<'forwarder' | 'artist'>();
  let due = FIRST_AT;
  let lastAt = -1;
  let turn = 'forwarder' as 'forwarder' | 'artist';
  for (let i = 0; i < items.length; i += 1) {
    if (queue.forwarder.length === 0 && queue.artist.length === 0) break;
    // A short Shop (a new market, a test site) can end before anything was
    // due: its last spot then shows the kind not seen yet - one card if none
    // was, and the other kind too if the first is a few items back.
    const unseen = (['forwarder', 'artist'] as const).find((kind) => !shownKinds.has(kind) && queue[kind].length > 0);
    const lastCall = i === items.length - 1 && unseen !== undefined && (lastAt < 0 || i - lastAt >= 3);
    if (i < due && !lastCall) continue;
    const item = items[i]!;
    let pick: ProviderPick | undefined;
    if (item.sourcing === 'import' && queue.forwarder.length && !(lastCall && unseen === 'artist')) pick = queue.forwarder.shift();
    else if (item.condition === 'LOOSE' && queue.artist.length && !(lastCall && unseen === 'forwarder')) pick = queue.artist.shift();
    else if (i >= due + PATIENCE || lastCall) {
      const other: 'forwarder' | 'artist' = turn === 'forwarder' ? 'artist' : 'forwarder';
      const kind: 'forwarder' | 'artist' = lastCall && unseen ? unseen : queue[turn].length ? turn : other;
      pick = kind === 'forwarder' ? queue.forwarder.shift() : queue.artist.shift();
    }
    if (!pick) continue;
    const here = [pick];
    // Nothing shown at all and the Shop is over: both kinds together, so a
    // short Shop shows a forwarder and an artist rather than one at random.
    if (lastCall && placed.size === 0) {
      const second = pick.kind === 'forwarder' ? queue.artist.shift() : queue.forwarder.shift();
      if (second) here.push(second);
    }
    placed.set(i, here);
    for (const row of here) shownKinds.add(row.kind);
    lastAt = i;
    turn = pick.kind === 'forwarder' ? 'artist' : 'forwarder';
    due = i + SERVICE_GAP;
  }
  return placed;
}

/* ── The cards ────────────────────────────────────────────────────────
   Not item cards, and not each other. A forwarder is a parcel label: cream
   paper, an airmail border, the route as port codes, a postmark for its
   record and a barcode. An artist is a piece hung on a gallery wall: the
   work in a gilt frame under a spotlight, a museum placard for the name. */

export function ServiceCard({ pick }: { pick: ProviderPick }) {
  return pick.kind === 'forwarder' ? <LabelCard pick={pick} /> : <GalleryCard pick={pick} />;
}

/** A forwarder as the label on a parcel they would carry. */
function LabelCard({ pick }: { pick: ForwarderPick }) {
  const { store, lanes } = pick;
  const lane = lanes[0];
  return (
    <Link to={`/services/forwarder/${store.slug}`} className="svcard svlabel" aria-label={`${store.name}, freight forwarder`}>
      <span className="svlabel__sheet">
        <span className="svlabel__head">
          <span>Forwarder</span>
          <span className="svlabel__mode">{lane ? FREIGHT_MODE_LABELS[lane.mode].label.split(' ')[0] : 'Cargo'}</span>
        </span>
        <span className="svlabel__route">
          <span className="svlabel__port">
            <small>From</small>
            <b>{lane ? countryCode(lane.originCountry) : '··'}</b>
            <span aria-hidden="true">{lane ? countryFlag(lane.originCountry) : '📦'}</span>
          </span>
          <span className="svlabel__via" aria-hidden="true">
            <span className="svlabel__glyph">{lane ? FREIGHT_MODE_LABELS[lane.mode].glyph : '✈️'}</span>
            <span className="svlabel__dash" />
            {lane && <small>{shortDays(lane.days)}</small>}
          </span>
          <span className="svlabel__port">
            <small>To</small>
            <b>{lane ? countryCode(lane.destinationCountry) : '··'}</b>
            <span aria-hidden="true">{lane ? countryFlag(lane.destinationCountry) : '🏠'}</span>
          </span>
        </span>
        <span className="svlabel__carrier">
          <small>Carrier</small>
          <b>{store.name}</b>
          {/* The record as a postmark, over the carrier's corner like one on a real label. */}
          <span className="svlabel__stamp" aria-label={store.rating !== null ? `Rated ${store.rating.toFixed(1)}` : 'New on Figmark'}>
            <b>{store.rating !== null ? `★${store.rating.toFixed(1)}` : 'NEW'}</b>
            <small>{store.completed > 0 ? `${store.completed} sent` : 'Figmark'}</small>
          </span>
        </span>
        <span className="svlabel__rates">
          {lanes.slice(0, 2).map((row) => (
            <span key={row.id} className="svlabel__rate">
              <span>{countryCode(row.originCountry)}→{countryCode(row.destinationCountry)} {FREIGHT_MODE_LABELS[row.mode].glyph}</span>
              <b>{row.fromMinor > 0 ? `${formatMoney(row.fromMinor, 'INR')}/kg` : shortDays(row.days)}</b>
            </span>
          ))}
        </span>
        <span className="svlabel__foot">
          <span className="svlabel__barcode" aria-hidden="true" />
          <span className="svlabel__go">{lanes.length > 2 ? `${lanes.length} routes ›` : 'Routes ›'}</span>
        </span>
      </span>
    </Link>
  );
}

/** An artist as a piece of their work, hung and lit, with its placard. */
function GalleryCard({ pick }: { pick: ArtistPick }) {
  const { store } = pick;
  const [lead] = pick.portfolio;
  const line = pick.services.slice(0, 2).map((service) => service.name).join(' · ') || pick.specialties.slice(0, 2).join(' · ');
  return (
    <Link to={`/services/artist/${store.slug}`} className="svcard svart" aria-label={`${store.name}, artist`}>
      <span className="svart__wall">
        <span className="svart__lamp" aria-hidden="true" />
        <span className="svart__frame">
          <span className="svart__mat">
            {lead ? <img loading="lazy" decoding="async" src={lead} alt="" /> : <span className="svart__blank" aria-hidden="true">🎨</span>}
          </span>
        </span>
        {pick.portfolio.length > 1 && <span className="svart__count">+{pick.portfolio.length - 1} works</span>}
      </span>
      <span className="svart__placard">
        <span className="svart__kind">Artist{store.rating !== null ? ` · ★ ${store.rating.toFixed(1)}` : ' · New'}</span>
        <b className="svart__name">{store.name}</b>
        {line && <span className="svart__line">{line}</span>}
        {pick.fromMinor > 0 && <span className="svart__price">from <b>{formatMoney(pick.fromMinor, 'INR')}</b></span>}
        <span className="svart__palette" aria-hidden="true"><i /><i /><i /><i /></span>
        <span className="svart__go">Commission ›</span>
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
