import { ProBadge } from './Billing';
import { Link } from 'react-router-dom';
import { tagKey, tagSlug } from '@shared/shop-tags';
import { SHOP_NAME_MAX } from '@shared/storefront';
import type { ShopCard } from '../api';
import { Avatar } from './ui';
import { brandHueFor, formatCount } from '../format';
import '../styles/ShopCards.css';

/** A name cut to what a shop may be called now; names from before the limit end in "…". */
export const shortName = (name: string) => (name.length > SHOP_NAME_MAX ? `${name.slice(0, SHOP_NAME_MAX - 1).trimEnd()}…` : name);

/** Where a tag's own page lives: "Resin kits" → /tags/resin-kit. */
export const tagPath = (label: string) => `/tags/${encodeURIComponent(tagSlug(tagKey(label)))}`;

const DOOR_SIGN = { open: 'Open', paused: 'Paused', stopped: 'Closed' } as const;

/**
 * One shop, drawn as a little building: a cornice along the roof, the name
 * lit in neon on its signboard, a striped awning, then the shopfront - a
 * display window with the shop's face in it beside a door with an
 * open/paused/closed sign - and what it sells on a plaque by the step.
 */
export function ShopTile({ shop }: { shop: ShopCard }) {
  const to = shop.handle ? `/${shop.handle}` : '#';
  // What matched first, so a search result says why it is here.
  const tags = [...new Set([...shop.matched, ...shop.tags])].slice(0, 2);
  const region = shop.dispatchRegion ? shop.dispatchRegion.split(',')[0] : '';
  const state = shop.orderState ?? 'open';
  return (
    <Link to={to} className={`shoptile shoptile--${brandHueFor(shop.handle ?? shop.id)}`}>
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
        <span className={`shoptile__door shoptile__door--${state}`} aria-label={DOOR_SIGN[state]}>
          <span className="shoptile__doorsign">{DOOR_SIGN[state]}</span>
        </span>
      </span>
      <span className="shoptile__plaque">
        <span className="shoptile__meta">
          <b>{formatCount(shop.followerCount)}</b> follower{shop.followerCount === 1 ? '' : 's'}
          {region && <> · {region}</>}
        </span>
        {tags.length > 0 && (
          <span className="shoptile__tags">
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

/** A row of shops that scrolls sideways, under a heading. Nothing at all when empty. */
export function ShopStrip({ title, sub, shops }: { title: string; sub?: string; shops: ShopCard[] | null }) {
  if (!shops || shops.length === 0) return null;
  return (
    <section className="shopstrip" aria-label={title}>
      <header className="shopstrip__head">
        <h2 className="shopstrip__title">{title}</h2>
        {/* With nothing to add under the title, a rule runs on from it instead. */}
        {sub ? <span className="shopstrip__sub">{sub}</span> : <span className="shopstrip__rule" aria-hidden="true" />}
      </header>
      <div className="shopstrip__row">
        {shops.map((shop) => <ShopTile key={shop.id} shop={shop} />)}
      </div>
    </section>
  );
}
