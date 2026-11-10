import { ProBadge } from './Billing';
import { Fragment, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { tagKey, tagSlug } from '@shared/shop-tags';
import { SHOP_NAME_MAX } from '@shared/storefront';
import { api, type ShopCard } from '../api';
import { warmPage } from '../pageLoaders';
import { Avatar } from './ui';
import { brandHueFor, formatCount } from '../format';
import '../styles/ShopCards.css';

/** A name cut to what a shop may be called now; names from before the limit end in "…". */
export const shortName = (name: string) => (name.length > SHOP_NAME_MAX ? `${name.slice(0, SHOP_NAME_MAX - 1).trimEnd()}…` : name);

/** Where a tag's own page lives: "Resin kits" → /tags/resin-kit. */
export const tagPath = (label: string) => `/tags/${encodeURIComponent(tagSlug(tagKey(label)))}`;

const DOOR_SIGN = { open: 'Open', paused: 'BRB', stopped: 'Closed' } as const;

/** How long the door takes to swing open before the shop's page shows. */
const DOOR_MS = 520;

/** Start everything the shop's page reads, so it is there when the door opens. */
function warmShop(shop: ShopCard) {
  if (!shop.handle) return;
  warmPage(`/${shop.handle}`);
  // The same reads the page makes, in the same words: the page finds them already answered.
  void api.profile(shop.handle).catch(() => undefined);
  void api.feed({ seller: shop.id }).catch(() => undefined);
  void api.shopsForYou().catch(() => undefined);
}

/** Two tags on one line: the longer they run, the smaller they are set. */
function tagSize(tags: string[]): '' | ' shoptile__tags--sm' | ' shoptile__tags--xs' | ' shoptile__tags--xxs' {
  const length = tags.join('').length;
  return length > 27 ? ' shoptile__tags--xxs' : length > 22 ? ' shoptile__tags--xs' : length > 16 ? ' shoptile__tags--sm' : '';
}

/**
 * One shop, drawn as a little building: a cornice along the roof, the name
 * lit in neon on its signboard, a striped awning, then the shopfront - a
 * display window with the shop's face in it beside a door with an
 * open/paused/closed sign - and what it sells on price tags by the step.
 *
 * A tap swings the door open and then walks in; the shop's page starts
 * loading the moment the tap lands, so it is ready by the time the door is.
 */
export function ShopTile({ shop }: { shop: ShopCard }) {
  const navigate = useNavigate();
  const [entering, setEntering] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const to = shop.handle ? `/${shop.handle}` : '#';
  // What matched first, so a search result says why it is here.
  const tags = [...new Set([...shop.matched, ...shop.tags])].slice(0, 2);
  const region = shop.dispatchRegion ? shop.dispatchRegion.split(',')[0] : '';
  const state = shop.orderState ?? 'open';

  const enter = (event: MouseEvent<HTMLAnchorElement>) => {
    // A new tab, a modified click, or no handle: the browser's own way.
    if (!shop.handle || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    if (entering) return;
    warmShop(shop);
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still) {
      navigate(to);
      return;
    }
    setEntering(true);
    timer.current = window.setTimeout(() => navigate(to), DOOR_MS);
  };

  return (
    <Link to={to} onClick={enter} onPointerEnter={() => warmPage(to)}
      className={`shoptile shoptile--${brandHueFor(shop.handle ?? shop.id)}${entering ? ' is-entering' : ''}`}>
      <span className="shoptile__roof" aria-hidden="true" />
      {/* A lit sign over the door: the name in neon, the whole width of the board. */}
      <span className="shoptile__sign">
        <span className="shoptile__name">{shortName(shop.name)}</span>
      </span>
      <span className="shoptile__awning" aria-hidden="true" />
      <span className="shoptile__front">
        <span className="shoptile__window">
          <span className="shoptile__face">
            {shop.photoUrl
              ? <img className="shoptile__photo" src={shop.photoUrl} alt="" loading="lazy" />
              : <Avatar name={shop.name} size={44} />}
          </span>
          {shop.pro && <span className="shoptile__pro"><ProBadge /></span>}
        </span>
        {/* The frame shows the lit shop inside; the leaf is the door that swings open. */}
        <span className={`shoptile__door shoptile__door--${state}`} aria-label={DOOR_SIGN[state]}>
          <span className="shoptile__leaf">
            <span className="shoptile__doorsign">{DOOR_SIGN[state]}</span>
          </span>
        </span>
      </span>
      <span className="shoptile__plaque">
        <span className="shoptile__meta">
          <b>{formatCount(shop.followerCount)}</b> follower{shop.followerCount === 1 ? '' : 's'}
          {region && <> · {region}</>}
        </span>
        {tags.length > 0 && (
          <span className={`shoptile__tags${tagSize(tags)}`}>
            {tags.map((tag) => (
              <span key={tag} className={`shoptile__tag${shop.matched.includes(tag) ? ' is-hit' : ''}`}>{tag}</span>
            ))}
          </span>
        )}
      </span>
      <span className="shoptile__step">Step inside <span aria-hidden="true">→</span></span>
    </Link>
  );
}

/**
 * The street behind the band, as a day that loops: dawn, a van on its morning
 * round, a cargo plane over the rooftops at noon, birds heading home, sunset,
 * then the city's windows and the lamps coming on under the stars and moon.
 * Every layer is drawn in CSS (ShopCards.css); this only stacks them. What
 * passes in front of the shops - the van, people - is StreetFront.
 */
const DAY_MS = 96_000;

/**
 * The street's day keeps time with the clock, not with when the band was
 * drawn: coming back to the page carries on from where the day had got to
 * instead of starting again at dawn.
 */
function StreetScene() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const band = ref.current?.closest('.shopstrip--band');
    if (!band || typeof band.getAnimations !== 'function') return;
    const at = Date.now() % DAY_MS;
    for (const animation of band.getAnimations({ subtree: true })) {
      if (animation.effect?.getTiming().duration === DAY_MS) animation.currentTime = at;
    }
  }, []);
  return (
    <div className="shopscene" ref={ref} aria-hidden="true">
      <span className="shopscene__daysky" />
      <span className="shopscene__nightsky" />
      <span className="shopscene__stars" />
      <span className="shopscene__comet" />
      <span className="shopscene__comet shopscene__comet--late" />
      <span className="shopscene__arc"><span className="shopscene__sun" /></span>
      <span className="shopscene__moon" />
      <span className="shopscene__clouds" />
      <span><span className="shopscene__plane" /></span>
      <span><span className="shopscene__birds">{[0, 1, 2, 3, 4].map((n) => <Gull key={n} />)}</span></span>
      <span className="shopscene__city" />
      <span className="shopscene__city shopscene__city--night" />
      <span className="shopscene__pave" />
      <span className="shopscene__pave shopscene__pave--night" />
    </div>
  );
}

/** A gull, seen from the front: two wings that beat about the body. */
function Gull() {
  return (
    <svg className="gull" viewBox="0 0 24 12" aria-hidden="true">
      <path className="gull__wing gull__wing--l" d="M12 6C9 1.5 5 .5 1 2.5c3.5 0 6.5 1.5 9.6 5z" />
      <path className="gull__wing gull__wing--r" d="M12 6c3-4.5 7-5.5 11-3.5-3.5 0-6.5 1.5-9.6 5z" />
      <ellipse className="gull__body" cx="12" cy="6.6" rx="2.2" ry="1.5" />
    </svg>
  );
}

type Look = 'bag' | 'parcel' | 'stroll' | 'kid' | 'runner' | 'chaser';

/**
 * Somebody on the pavement, jointed so they walk: each leg swings from the hip
 * and each arm from the shoulder, and a bag hangs from the hand, swinging back
 * against the arm so it keeps hanging straight down. Faces right.
 */
function Person({ look }: { look: Look }) {
  const leg = (side: 'back' | 'front') => (
    <g className={`shopper__leg shopper__leg--${side}`}>
      <rect className="shopper__pants" x="13.2" y="33" width="4.8" height="24" rx="2.4" />
      <path className="shopper__shoe" d="M12.6 55.5h6.2c2.6 0 3.8 1.2 3.8 2.6 0 .8-.6 1.4-1.4 1.4h-8.6z" />
    </g>
  );
  const arm = (side: 'back' | 'front', hand?: ReactNode) => (
    <g className={`shopper__arm shopper__arm--${side}`}>
      <rect className="shopper__sleeve" x="13.6" y="16.5" width="4" height="16" rx="2" />
      <circle className="shopper__skin" cx="15.6" cy="33.2" r="2" />
      {hand}
    </g>
  );
  return (
    <svg className={`shopper shopper--${look}`} viewBox="0 0 32 64" aria-hidden="true">
      {leg('back')}
      {arm('back')}
      <rect className="shopper__shirt" x="10.4" y="15" width="10.4" height="21" rx="4.6" />
      <rect className="shopper__skin" x="13.9" y="11" width="3.4" height="5" />
      <path className="shopper__locks" d="M10 8.6a5.6 5.6 0 0 1 11.2 0v9.6c-1.4 1-2.8.6-3.4-.4V10h-4.4v7.8c-.6 1-2 1.4-3.4.4z" />
      <circle className="shopper__skin" cx="15.6" cy="8.6" r="5.6" />
      <path className="shopper__hair" d="M10.1 8.4a5.6 5.6 0 0 1 11-1.6c-2.4.3-5.6-.2-7.4-1.8-.6 1.6-1.8 2.8-3.6 3.4z" />
      {leg('front')}
      <path className="shopper__skirt" d="M10.8 32.4h9.6l3.2 12.6H7.6z" />
      {look === 'parcel' && (
        <g className="shopper__box">
          <rect x="18.5" y="19" width="12.5" height="11" rx="1.2" />
          <path d="M24.7 19v11" />
        </g>
      )}
      {arm('front', look === 'bag' ? (
        <g className="shopper__hang">
          <path className="shopper__handle" d="M13.4 37.6c0-3.6 4.4-3.6 4.4 0" />
          <rect className="shopper__bag" x="11" y="37" width="9.2" height="10.5" rx="1.4" />
        </g>
      ) : undefined)}
    </svg>
  );
}

/** A dog on a lead, trotting to the right; the lead runs up to the walker's hand. */
function Dog() {
  return (
    <svg className="dog" viewBox="0 0 34 22" aria-hidden="true">
      <path className="dog__lead" d="M27 8Q8 9-11-9.5" />
      <path className="dog__tail" d="M7 9Q3 7 2 2" />
      <g className="dog__legs dog__legs--a"><rect x="8" y="13" width="2.8" height="8.6" rx="1.4" /><rect x="23" y="13" width="2.8" height="8.6" rx="1.4" /></g>
      <g className="dog__legs dog__legs--b"><rect x="11" y="13" width="2.8" height="8.6" rx="1.4" /><rect x="26" y="13" width="2.8" height="8.6" rx="1.4" /></g>
      <rect className="dog__coat" x="5" y="7" width="24" height="9" rx="4.5" />
      <circle className="dog__coat" cx="28.4" cy="6.4" r="4.4" />
      <ellipse className="dog__coat" cx="32" cy="8" rx="2.4" ry="1.9" />
      <path className="dog__ear" d="M25.2 3.4l-1.4 6.2 3-1.4z" />
      <circle cx="33.8" cy="7.4" r=".9" fill="#1E1A22" />
      <circle cx="29.6" cy="5.4" r=".7" fill="#1E1A22" />
    </svg>
  );
}

const pick = (list: readonly string[]): string => list[Math.floor(Math.random() * list.length)] ?? list[0] ?? "";
const SHIRTS = ['#E0573E', '#3E7FD6', '#2FA37A', '#F2B03C', '#9B5DE5', '#E85D9A', '#2BB3B1', '#D9822B', '#5B6CFF', '#C94C6B'];
const PANTS = ['#2F3350', '#3A3046', '#4A3C2E', '#20434F', '#55505C', '#3E5A8A'];
const SKINS = ['#F0C6A0', '#E3B18A', '#C68B62', '#9A6644', '#6E4630'];
const HAIRS = ['#1E1A22', '#4A2E1E', '#6B4A2E', '#8A4A22', '#C99A4B', '#2B2230', '#9C9AA2'];
const COATS = ['#C9883F', '#2B2230', '#F1E6D2', '#8A5A36', '#A8A2AA'];

/**
 * Somebody new each time a lane comes round: man or woman, their own clothes,
 * pace, direction and pause before they appear, with a bag, a dog or neither.
 */
function dressLane(lane: HTMLElement, restart: boolean) {
  const kind = lane.dataset.roam;
  lane.querySelectorAll<SVGElement>('.shopper').forEach(person => {
    person.classList.toggle('shopper--her', Math.random() < 0.5);
    person.style.setProperty('--shirt', pick(SHIRTS));
    person.style.setProperty('--skirt', pick(SHIRTS));
    person.style.setProperty('--pants', pick(PANTS));
    person.style.setProperty('--skin', pick(SKINS));
    person.style.setProperty('--hair', pick(HAIRS));
  });
  lane.querySelector<SVGElement>('.dog')?.style.setProperty('--coat', pick(COATS));
  if (kind === 'chase') {
    const style = Math.random();
    lane.classList.toggle('no-ball', style > 0.6);
    lane.classList.toggle('solo', style > 0.4 && style <= 0.6);
  }
  if (kind === 'bag') {
    const roll = Math.random();
    lane.classList.toggle('is-dog', roll < 0.35);
    lane.classList.toggle('no-bag', roll > 0.75);
  }
  if (!restart) return;
  const chase = kind === 'chase';
  const speed = chase ? 70 + Math.random() * 40 : 28 + Math.random() * 20;
  const width = lane.parentElement?.offsetWidth ?? 1200;
  const left = Math.random() < 0.5;
  lane.style.animation = 'none';
  void lane.offsetWidth;
  lane.style.animation = '';
  lane.style.animationName = chase ? (left ? 'street-chase' : 'street-chase-r') : left ? 'street-left' : 'street-right';
  lane.style.animationDuration = chase ? `${(width + 160) / speed / 0.4}s` : `${(width + 120) / speed}s`;
  lane.style.animationDelay = `${(chase ? 4 + Math.random() * 14 : 0.5 + Math.random() * 7).toFixed(2)}s`;
  lane.style.animationFillMode = 'backwards';
  const adult = lane.querySelector<SVGElement>('.shopper');
  if (adult && kind !== 'parcel' && !chase) adult.style.setProperty('--gait', `${(20 / speed).toFixed(3)}s`);
}

/** The van, side on, facing right: cargo box, cab, wheels that turn, lamps for the drive home. */
function Van() {
  const wheel = (cx: number) => (
    <g className="van__wheel" key={cx}>
      <circle cx={cx} cy="70" r="11" fill="#26222C" />
      <circle cx={cx} cy="70" r="5.2" fill="#B9B2BE" />
      <path d={`M${cx - 5} 70h10M${cx} 65v10`} stroke="#7C7584" strokeWidth="1.6" />
    </g>
  );
  return (
    <svg className="shopfront__van" viewBox="0 0 184 84" aria-hidden="true">
      <defs>
        <linearGradient id="van-glow">
          <stop offset="0" stopColor="#FFE7A0" stopOpacity=".9" />
          <stop offset=".35" stopColor="#FFE7A0" stopOpacity=".35" />
          <stop offset="1" stopColor="#FFE7A0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="van__beam" d="M178 58l-2 4 96 20V46z" />
      <ellipse cx="92" cy="81" rx="84" ry="3.6" fill="rgba(30, 20, 30, 0.22)" />
      <rect x="4" y="8" width="114" height="60" rx="6" fill="#F4EDE0" />
      <rect x="4" y="8" width="114" height="6" rx="3" fill="#FFFFFF" opacity=".55" />
      <rect x="4" y="46" width="114" height="6" fill="#E0573E" />
      <rect x="40" y="20" width="26" height="18" rx="2" fill="#C9A36A" />
      <path d="M53 20v18M40 26h26" stroke="#8A6A3C" strokeWidth="1.2" />
      <path d="M118 22h26c4.6 0 7.6 1.8 10 5.4l13.4 20.6c4.8 1 8.6 4.4 8.6 9.4V64c0 3-1.8 4.6-4.6 4.6H118z" fill="#E0573E" />
      <path d="M136 27h8.4c2.6 0 4.2 1 5.6 3.2l10.6 16.4H136z" fill="#BFE3F5" />
      <path d="M140 29l6 0-8 15" stroke="#FFFFFF" strokeWidth="1.4" opacity=".6" />
      <path d="M131 25v41" stroke="#B8422E" strokeWidth="1.4" />
      <rect x="124" y="50" width="5" height="1.8" rx=".9" fill="#B8422E" />
      <rect className="van__lamp" x="172" y="54" width="6" height="4.4" rx="1.4" />
      <rect x="112" y="64" width="68" height="5" rx="2.4" fill="#3A3440" />
      <rect x="0" y="62" width="10" height="5" rx="2" fill="#3A3440" />
      <circle cx="34" cy="70" r="13.4" fill="#3A3440" />
      <circle cx="148" cy="70" r="13.4" fill="#3A3440" />
      {wheel(34)}
      {wheel(148)}
    </svg>
  );
}

/**
 * The pavement in front of the shops: people walking by both ways, a parent
 * with a skipping child, two children chasing a ball, and the van - out on its
 * round in the morning, home with its lights on at night. Over the row, never
 * in the way of a tap. It knows its own width so everybody walks at a
 * person's pace however wide the street (--street-w).
 */
function StreetFront() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const street = ref.current;
    if (!street || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => street.style.setProperty('--street-w', String(Math.round(street.offsetWidth)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(street);
    street.querySelectorAll<HTMLElement>('[data-roam]').forEach(lane => dressLane(lane, false));
    const onLap = (event: AnimationEvent) => {
      const lane = event.target as HTMLElement;
      if (lane.dataset?.roam && event.animationName.startsWith('street-')) dressLane(lane, true);
    };
    street.addEventListener('animationiteration', onLap);
    return () => { observer.disconnect(); street.removeEventListener('animationiteration', onLap); };
  }, []);
  return (
    <div className="shopfront" ref={ref} aria-hidden="true">
      <span className="shopfront__lane shopfront__lane--parcel" data-roam="parcel"><Person look="parcel" /></span>
      <span className="shopfront__lane shopfront__lane--bag" data-roam="bag"><Person look="bag" /><Dog /></span>
      <span className="shopfront__lane shopfront__lane--dog is-dog" data-roam="dog"><Person look="stroll" /><Dog /></span>
      <span className="shopfront__lane shopfront__lane--stroll" data-roam="stroll"><Person look="stroll" /><Person look="kid" /></span>
      <span className="shopfront__lane shopfront__lane--chase" data-roam="chase">
        <Person look="chaser" />
        <Person look="runner" />
        <span className="shopfront__ball" />
      </span>
      <Van />
    </div>
  );
}

/**
 * A row of shops that scrolls sideways, under a heading. Nothing at all when empty.
 * As a band, it runs edge to edge between two wavy hems, with an eyebrow over
 * the title, on a street that lives through a day.
 */
export function ShopStrip({ title, sub, eyebrow, band = false, shops }: {
  title: string;
  sub?: string;
  /** A small spaced-out line over the title. */
  eyebrow?: string;
  band?: boolean;
  shops: ShopCard[] | null;
}) {
  if (!shops || shops.length === 0) return null;
  return (
    <section className={`shopstrip${band ? ' shopstrip--band' : ''}`} aria-label={title}>
      {band && <StreetScene />}
      <header className="shopstrip__head">
        <span className="shopstrip__words">
          {eyebrow && <span className="shopstrip__eyebrow">{eyebrow}</span>}
          <h2 className="shopstrip__title">{title}</h2>
        </span>
        {band ? null
          /* With nothing to add under the title, a rule runs on from it instead. */
          : sub ? <span className="shopstrip__sub">{sub}</span> : <span className="shopstrip__rule" aria-hidden="true" />}
      </header>
      <div className="shopstrip__row">
        {shops.map((shop, n) => band ? (
          /* On the street, a lamp stands in every other gap between shops. */
          <Fragment key={shop.id}>
            <ShopTile shop={shop} />
            {n % 2 === 0 ? <span className="shopstrip__lamp" aria-hidden="true"><i /></span>
              : <span className="shopstrip__gap" aria-hidden="true"><i /></span>}
          </Fragment>
        ) : <ShopTile key={shop.id} shop={shop} />)}
      </div>
      {band && <StreetFront />}
    </section>
  );
}

/**
 * Shops for you: the shops this buyer's likes, purchases and follows point to,
 * on the street band. One section, drawn the same on the Shop tab and at the
 * foot of every shop's page - change it here and both change.
 */
export function useShopsForYou(): ShopCard[] | null {
  const [shops, setShops] = useState<ShopCard[] | null>(null);
  useEffect(() => {
    let live = true;
    void api.shopsForYou().then((result) => { if (live) setShops(result.shops); }).catch(() => { if (live) setShops([]); });
    return () => { live = false; };
  }, []);
  return shops;
}

/** The band itself. On a shop's own page, that shop is left off its own street. */
export function ShopsForYou({ shops, skip }: { shops: ShopCard[] | null; skip?: string }) {
  const shown = skip && shops ? shops.filter((shop) => shop.id !== skip) : shops;
  return <ShopStrip band eyebrow="Handpicked" title="Shops for you" shops={shown} />;
}
