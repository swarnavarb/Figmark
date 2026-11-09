import { ProBadge } from './Billing';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
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

const DOOR_SIGN = { open: 'Open', paused: 'Paused', stopped: 'Closed' } as const;

/** How long the door takes to swing open before the shop's page shows. */
const DOOR_MS = 520;

/** Start everything the shop's page reads, so it is there when the door opens. */
function warmShop(shop: ShopCard) {
  if (!shop.handle) return;
  warmPage(`/${shop.handle}`);
  // The same reads the page makes, in the same words: the page finds them already answered.
  void api.profile(shop.handle).catch(() => undefined);
  void api.feed({ seller: shop.id }).catch(() => undefined);
  void api.similarShops(shop.id).catch(() => undefined);
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

/** A faint storefront outline for the band's corner: a hint, not a picture. */
function ShopArt() {
  return (
    <svg className="shopstrip__art" viewBox="0 0 64 56" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 22v28h52V22" />
      <path d="M4 10h56l-3 12H7z" />
      <path d="M16 10l-2 12M26 10l-1 12M38 10l1 12M48 10l2 12" />
      <path d="M7 22c0 4 9 4 9 0 0 4 9 4 9 0 0 4 9 4 9 0 0 4 9 4 9 0 0 4 9 4 9 0 0 4 3 4 3 0" />
      <rect x="12" y="32" width="18" height="12" rx="1.5" />
      <path d="M38 50V32h12v18" />
    </svg>
  );
}

/**
 * The street behind the band, as a day that loops: dawn, a van on its morning
 * round, a cargo plane over the rooftops at noon, birds heading home, sunset,
 * then the city's windows and the lamps coming on under the stars and moon.
 * Every layer is drawn in CSS (ShopCards.css); this only stacks them.
 */
function StreetScene() {
  return (
    <div className="shopscene" aria-hidden="true">
      <span className="shopscene__daysky" />
      <span className="shopscene__nightsky" />
      <span className="shopscene__stars" />
      <span className="shopscene__comet" />
      <span className="shopscene__arc"><span className="shopscene__sun" /></span>
      <span className="shopscene__moon" />
      <span className="shopscene__clouds" />
      <span><span className="shopscene__plane" /></span>
      <span><span className="shopscene__birds"><i /><i /><i /></span></span>
      <span className="shopscene__city" />
      <span className="shopscene__city shopscene__city--night" />
      <span className="shopscene__pave" />
      <span className="shopscene__pave shopscene__pave--night" />
      <span className="shopscene__lamps" />
      <span className="shopscene__glow" />
      <span className="shopscene__road"><span className="shopscene__van" /></span>
    </div>
  );
}

/**
 * A row of shops that scrolls sideways, under a heading. Nothing at all when empty.
 * As a band, it runs edge to edge between two wavy hems, with an eyebrow over
 * the title and a faint storefront in the corner.
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
        {band ? <ShopArt />
          /* With nothing to add under the title, a rule runs on from it instead. */
          : sub ? <span className="shopstrip__sub">{sub}</span> : <span className="shopstrip__rule" aria-hidden="true" />}
      </header>
      <div className="shopstrip__row">
        {shops.map((shop) => <ShopTile key={shop.id} shop={shop} />)}
      </div>
    </section>
  );
}
