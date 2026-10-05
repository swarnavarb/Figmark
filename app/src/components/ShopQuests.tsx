import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Listing } from '@shared/models';
import { isExpired } from '@shared/payments';
import { UPKEEP_SHARE, type GrowthKind, type GrowthTask } from '@shared/store-growth';
import type { StoreAccess } from '@shared/stores';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, leadPhoto } from './ui';
import { LevelRing, XpBar } from './Quest';
import { shopBadge, useShareSheet, type ShareSpec } from './ShareKit';
import { SkeletonText, useToast } from './Feedback';

/**
 * A shop's quest board: the only way a shop earns XP.
 *
 * Reviews, popularity, sales and marketing pay full XP, and the weekly and
 * monthly ones pay Spotlights too - an item back at the top of the feed,
 * without waiting out the bump limit, because reach is the reward a shop
 * actually wants. Upkeep quests pay a token amount. Each quest says what to do,
 * and the buttons to do it are right here: a picture of the shop, a picture of
 * each item, an invite for another seller.
 *
 * The same board sits on the Shop's Grow tab and on the Quests page, so the
 * people running a shop find it wherever they look for quests.
 */
export function ShopQuests({ store }: { store: StoreAccess }) {
  const toast = useToast();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.growth>> | null>(null);
  const [items, setItems] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<GrowthKind>('daily');
  const { open, sheet } = useShareSheet();

  const load = useCallback(() => {
    void api.growth(store.ownerId).then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your shop quests.'));
    void api.myListings()
      .then(({ listings }) => setItems(listings.filter((listing) => listing.sellerId === store.ownerId && listing.status === 'active' && !isExpired(listing))))
      .catch(() => setItems([]));
  }, [store.ownerId]);
  useEffect(load, [load]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <SkeletonText lines={6} />;
  const { view, level } = data;

  const badge = shopBadge({ storefrontName: data.name, photoUrl: data.photoUrl, level: data.levelTag }, data.name);
  const shopSpec = (): ShareSpec | null => data.handle ? {
    kind: 'shop',
    moment: {
      photo: data.photoUrl, title: data.name,
      detail: `Level ${data.levelTag.level} ${data.levelTag.title}${data.followers ? ` · ${data.followers.toLocaleString('en-IN')} followers` : ''}`,
      headline: 'Shop with us', byline: `@${data.handle} on Figmark`, badge,
    },
    link: { to: 'page', handle: data.handle },
    caption: `We're on Figmark 🏪 Follow ${data.name} for pre-orders and new drops.`,
    target: data.handle,
    storeId: store.ownerId,
  } : null;

  const itemSpec = (listing: Listing): ShareSpec => {
    const pre = listing.preOrder && listing.preOrder.fillThreshold > 0 ? listing.preOrder : null;
    const joined = pre ? Math.min(pre.fillThreshold, pre.filledCount + (pre.pledgedCount ?? 0)) : 0;
    const left = pre ? pre.fillThreshold - joined : 0;
    const price = formatMoney(listing.priceMinor, listing.currency);
    const filling = Boolean(pre && left > 0);
    return {
      kind: filling ? 'fill' : 'item',
      moment: {
        photo: leadPhoto(listing)?.url ?? null, title: listing.title,
        detail: pre ? 'Pre-order · Buyer Protection' : 'Buyer Protection on Figmark', price,
        fill: pre ? { joined, threshold: pre.fillThreshold } : null,
        headline: filling ? 'Join our pre-order' : 'New drop', byline: '', badge, seed: listing.id,
      },
      link: { to: 'item', listingId: listing.id, moment: filling ? 'fill' : undefined, own: true },
      caption: filling
        ? `${left} spot${left === 1 ? '' : 's'} left in our pre-order: ${listing.title} at ${price}. It ships when it fills 👇`
        : `New drop: ${listing.title} at ${price} 🔥`,
      target: listing.id,
      storeId: store.ownerId,
    };
  };

  const sellerInvite: ShareSpec = {
    kind: 'invite_seller',
    moment: {
      title: 'Open your shop', detail: 'Pre-orders · tracking · Buyer Protection · affiliates',
      headline: 'Sell with me on Figmark', byline: '', badge,
    },
    link: { to: 'invite', seller: true },
    caption: 'Selling imports? Run your pre-orders on Figmark - manifests, tracking your buyers can see, Buyer Protection, and affiliates who sell for you. Open a shop with my invite:',
  };

  function gainedToast(gained: { spotlights: number; xp: number; quests: number }) {
    const spots = gained.spotlights ? ` · +${gained.spotlights} Spotlight${gained.spotlights === 1 ? '' : 's'}` : '';
    const many = gained.quests > 1 ? `${gained.quests} quests · ` : '';
    toast(`${many}+${gained.xp} shop XP${spots}`, 'ok');
  }

  async function claim(taskId: string | 'all') {
    setBusy(taskId);
    try {
      const result = await api.claimGrowth(store.ownerId, taskId);
      setData((current) => (current ? { ...current, ...result } : current));
      gainedToast(result.gained);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Could not collect that.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function spotlight(listing: Listing) {
    setBusy(listing.id);
    try {
      const result = await api.spotlight(listing.id);
      setData((current) => (current ? { ...current, view: { ...current.view, spotlights: result.spotlights } } : current));
      toast(`${listing.title} is back at the top of the feed.`, 'ok');
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Could not spotlight that.', 'error');
    } finally {
      setBusy(null);
    }
  }

  const doIt = (task: GrowthTask) => {
    const shop = shopSpec();
    if (task.action === 'share_shop' && shop) return <button type="button" className="btn btn--sm btn--quiet" onClick={() => open(shop)}>Share shop</button>;
    if (task.action === 'post') return <Link to={`/social/c/${encodeURIComponent(store.ownerId)}`} className="btn btn--sm btn--quiet">Post</Link>;
    if (task.action === 'affiliate') return <Link to="/shop?tab=items" className="btn btn--sm btn--quiet">Items</Link>;
    if (task.action === 'list') return <Link to="/sell" className="btn btn--sm btn--quiet">List</Link>;
    if (task.action === 'orders') return <Link to="/shop?tab=payments" className="btn btn--sm btn--quiet">Orders</Link>;
    if (task.action === null) return null;
    return <a href="#grow-items" className="btn btn--sm btn--quiet">Share an item</a>;
  };

  const ready = (kind: GrowthKind) => view.tasks.filter((task) => task.kind === kind && task.claimable).length;
  const readyAll = view.tasks.filter((task) => task.claimable).length;
  const tasks = view.tasks.filter((task) => task.kind === tab);
  const shop = shopSpec();
  return (
    <div className="grow">
      <section className="grow__hero">
        <div className="grow__level">
          <LevelRing level={level.level} progress={level.progress} size={72} />
          <div>
            <p className="grow__eyebrow">Shop level {level.level}</p>
            <h2>{level.title}</h2>
            <p>
              {level.points.toLocaleString('en-IN')} XP
              {level.next !== null && ` · ${(level.next - level.points).toLocaleString('en-IN')} to level ${level.level + 1}`}
            </p>
            <XpBar progress={level.progress} />
          </div>
        </div>
        <div className="grow__spot" title="Spotlights to spend">
          <span><b>{view.spotlights}</b><small>Spotlights</small></span>
        </div>
      </section>

      <ul className="grow__areas" aria-label="Shop XP by area">
        {view.areas.map((area) => (
          <li key={area.area} className={`grow__area${area.area === 'upkeep' ? ' is-minor' : ''}`}>
            <b>{area.xp.toLocaleString('en-IN')}</b>
            <small>{area.label}</small>
          </li>
        ))}
      </ul>

      <div className="grow__stats">
        <span className="grow__stat"><b>{view.week.goodReviews}</b><small>good reviews this week</small></span>
        <span className="grow__stat"><b>{view.week.sales}</b><small>sales this week</small></span>
        <span className="grow__stat"><b>{view.week.opens}</b><small>visitors from links</small></span>
      </div>

      <div className="grow__share">
        {shop && <button type="button" className="btn mshare__go" onClick={() => open(shop)}>Share your shop</button>}
        <button type="button" className="btn btn--quiet" onClick={() => open(sellerInvite)}>Invite a seller</button>
        {readyAll > 0 && (
          <button type="button" className="btn qbtn-gold" disabled={busy === 'all'} onClick={() => void claim('all')}>
            Collect all · {readyAll}
          </button>
        )}
      </div>

      <div className="stack">
        <div className="tabs qtabs">
          {(['daily', 'weekly', 'monthly', 'milestone'] as const).map((kind) => (
            <button key={kind} type="button" className={`tab${tab === kind ? ' is-on' : ''}`} onClick={() => setTab(kind)}>
              {kind === 'daily' ? 'Daily' : kind === 'weekly' ? 'Weekly' : kind === 'monthly' ? 'Monthly' : 'Milestones'}
              {ready(kind) > 0 && <span className="qdot">{ready(kind)}</span>}
            </button>
          ))}
        </div>
        <ul className="grow__tasks">
          {tasks.map((task) => (
            <li key={task.id} className={`grow__task${task.claimable ? ' is-ready' : ''}${task.claimed ? ' is-claimed' : ''}`}>
              <span className="grow__body">
                <span className="grow__title">
                  <b>{task.title}</b>
                  <span className={`grow__tag grow__tag--${task.area}`}>{AREA_SHORT[task.area]}</span>
                </span>
                <small>{task.blurb}</small>
                <span className="grow__bar">
                  <span className="grow__track"><span className="grow__fill" style={{ width: `${(task.progress / task.goal) * 100}%` }} /></span>
                  <span className="grow__count">{task.id.endsWith('fill60') ? `${task.progress}%` : `${task.progress}/${task.goal}`}</span>
                </span>
                <small className="grow__pay">+{task.xp} XP{task.spotlights ? ` · +${task.spotlights} ✦` : ''}</small>
              </span>
              <span className="grow__act">
                {task.claimed ? <span className="grow__ok">✓ Collected</span>
                  : task.claimable ? (
                    <button type="button" className="btn btn--sm qbtn-gold" disabled={busy === task.id} onClick={() => void claim(task.id)}>
                      Claim
                    </button>
                  ) : doIt(task)}
              </span>
            </li>
          ))}
        </ul>
        <p className="faint qtasks__note">
          {tab === 'milestone'
            ? 'Each step pays once, then the next, bigger one appears. Followers, hearts and ratings only count while you keep them.'
            : `Reviews, popularity, sales and marketing pay full XP. Upkeep pays ${Math.round(UPKEEP_SHARE * 100)}% and no Spotlights.`}
        </p>
      </div>

      <div className="stack" id="grow-items">
        <h3 className="grow__head">Share or spotlight an item</h3>
        {!items ? <SkeletonText lines={3} /> : items.length === 0 ? (
          <p className="faint">Nothing live to share yet. List an item and it shows up here.</p>
        ) : (
          <ul className="grow__items">
            {items.map((listing) => (
              <li key={listing.id} className="grow__item">
                {leadPhoto(listing)?.url ? <img className="grow__thumb" src={leadPhoto(listing)!.url} alt="" /> : <span className="grow__thumb" aria-hidden="true" />}
                <span className="grow__name">{listing.title}</span>
                <span className="grow__btns">
                  <button type="button" className="btn btn--sm btn--quiet" onClick={() => open(itemSpec(listing))}>Share</button>
                  <button type="button" className="btn btn--sm" disabled={view.spotlights < 1 || busy === listing.id || !store.permissions.includes('listings')}
                    title={view.spotlights < 1 ? 'Finish a weekly or monthly quest to earn a Spotlight' : 'Back to the top of the feed'}
                    onClick={() => void spotlight(listing)}>
                    ✦ Spotlight
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {sheet}
    </div>
  );
}

const AREA_SHORT: Record<GrowthTask['area'], string> = {
  reviews: 'Reviews', popularity: 'Popularity', sales: 'Sales', marketing: 'Marketing', upkeep: 'Upkeep',
};
