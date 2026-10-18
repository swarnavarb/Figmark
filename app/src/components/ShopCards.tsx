import { Link } from 'react-router-dom';
import { tagKey, tagSlug } from '@shared/shop-tags';
import type { ShopCard } from '../api';
import { Avatar } from './ui';
import '../styles/ShopCards.css';

/** Where a tag's own page lives: "Resin kits" → /tags/resin-kit. */
export const tagPath = (label: string) => `/tags/${encodeURIComponent(tagSlug(tagKey(label)))}`;

/** One shop: picture, name, and the tags that say what it is about. */
export function ShopTile({ shop }: { shop: ShopCard }) {
  const to = shop.handle ? `/${shop.handle}` : '#';
  // What matched first, so a search result says why it is here.
  const tags = [...new Set([...shop.matched, ...shop.tags])].slice(0, 3);
  return (
    <Link to={to} className="shoptile">
      {shop.photoUrl
        ? <img className="shoptile__photo" src={shop.photoUrl} alt="" loading="lazy" />
        : <Avatar name={shop.name} size={44} />}
      <span className="shoptile__name">{shop.name}</span>
      <span className="shoptile__meta">
        {shop.followerCount} follower{shop.followerCount === 1 ? '' : 's'}
        {shop.dispatchRegion ? ` · ${shop.dispatchRegion.split(',')[0]}` : ''}
      </span>
      {tags.length > 0 && (
        <span className="shoptile__tags">
          {tags.map((tag) => (
            <span key={tag} className={`shoptile__tag${shop.matched.includes(tag) ? ' is-hit' : ''}`}>{tag}</span>
          ))}
        </span>
      )}
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
        {sub && <span className="shopstrip__sub">{sub}</span>}
      </header>
      <div className="shopstrip__row">
        {shops.map((shop) => <ShopTile key={shop.id} shop={shop} />)}
      </div>
    </section>
  );
}
