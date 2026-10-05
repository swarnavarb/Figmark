import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Listing } from '@shared/models';
import { isExpired } from '@shared/payments';
import { UPKEEP_SHARE, type GrowthKind, type GrowthTask } from '@shared/store-growth';
import type { StoreAccess } from '@shared/stores';
import { ApiRequestError, api } from '../api';
import { formatMoney } from '../format';
import { ErrorNotice, leadPhoto } from './ui';
import { Glyph } from './Quest';
import { QuestShooter } from './QuestShooter';
import { BoardHead, InfoTip, InviteStrip, QuestHero, QuestRow, QuestTabs, useBump } from './QuestKit';
import { shopBadge, useShareSheet, type ShareSpec } from './ShareKit';
import { SkeletonText, useToast } from './Feedback';

/**
 * A shop's quest board: the only way a shop earns XP, laid out like a
 * person's so the two read as one game.
 *
 * Reviews, popularity, sales and marketing pay full XP, and their weekly and
 * monthly quests pay bump points too, because reach is the reward a shop
 * actually wants. Upkeep quests pay a token amount. The buttons to do each
 * quest are right here: a picture of the shop, of each item, an invite for
 * another seller - and Bump on every live item, spending the shop's points.
 *
 * The same board sits on the Shop's Grow tab and on the Quests page.
 */
export function ShopQuests({ store }: { store: StoreAccess }) {
  const toast = useToast();
  const bumpItem = useBump();
  const [data, setData] = useState<Awaited<ReturnType<typeof api.growth>> | null>(null);
  const [items, setItems] = useState<Listing[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<GrowthKind>('daily');
  const [cleared, setCleared] = useState(0);
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

  function gainedToast(gained: { bumps: number; xp: number; quests: number }) {
    const bumps = gained.bumps ? ` · +${gained.bumps} bump point${gained.bumps === 1 ? '' : 's'}` : '';
    const many = gained.quests > 1 ? `${gained.quests} quests · ` : '';
    toast(`${many}+${gained.xp} shop XP${bumps}`, 'ok');
  }

  async function claim(taskId: string | 'all') {
    setBusy(taskId);
    try {
      const result = await api.claimGrowth(store.ownerId, taskId);
      setData((current) => (current ? { ...current, ...result } : current));
      setCleared((n) => n + (result.gained.quests || 1));
      gainedToast(result.gained);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Could not collect that.', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function bump(listing: Listing) {
    setBusy(listing.id);
    try {
      const result = await bumpItem(listing);
      if (!result) return;
      setData((current) => (current ? { ...current, view: { ...current.view, bumps: result.bumps } } : current));
      toast(`${listing.title} is back at the top of the feed.`, 'ok');
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'Could not bump that.', 'error');
    } finally {
      setBusy(null);
    }
  }

  const go = (task: GrowthTask) => {
    const shop = shopSpec();
    if (task.action === 'share_shop' && shop) return <button type="button" className="btn btn--sm btn--quiet" onClick={() => open(shop)}>Share</button>;
    if (task.action === 'post') return <Link to={`/social/c/${encodeURIComponent(store.ownerId)}`} className="btn btn--sm btn--quiet">Post</Link>;
    if (task.action === 'affiliate') return <Link to="/shop?tab=items" className="btn btn--sm btn--quiet">Items</Link>;
    if (task.action === 'list') return <Link to="/sell" className="btn btn--sm btn--quiet">List</Link>;
    if (task.action === 'orders') return <Link to="/shop?tab=payments" className="btn btn--sm btn--quiet">Orders</Link>;
    if (task.action === null) return null;
    return <a href="#shop-items" className="btn btn--sm btn--quiet">Share</a>;
  };

  const ready = (kind: GrowthKind) => view.tasks.filter((task) => task.kind === kind && task.claimable).length;
  const readyAll = view.tasks.filter((task) => task.claimable).length;
  const tasks = view.tasks.filter((task) => task.kind === tab);
  const shop = shopSpec();
  const upkeep = `${Math.round(UPKEEP_SHARE * 100)}%`;

  return (
    <div className="qside">
      <QuestHero
        side="shop" eyebrow={`Shop level ${level.level}`} title={level.title} level={level.level} progress={level.progress}
        xp={level.points} toNext={level.next === null ? null : level.next - level.points} nextLevel={level.level + 1} bumps={view.bumps}
        info={(
          <>
            <b>How a shop levels</b>
            <p>A shop earns XP only from the quests it collects. Reviews, popularity, sales and marketing pay full XP; upkeep (listing, pre-orders, time open) pays {upkeep}.</p>
            <p>Low ratings take XP away: −20 for two stars, −40 for one. A lost dispute takes −80.</p>
            <p>Everybody who runs the shop plays this board together.</p>
          </>
        )}
      />

      <ul className="qareas" aria-label="Shop XP by area">
        {view.areas.map((area) => (
          <li key={area.area} className={`qareas__tile qareas__tile--${area.area}`}>
            <b>{area.xp.toLocaleString('en-IN')}</b>
            <small>{area.label}</small>
          </li>
        ))}
      </ul>

      <InviteStrip
        title="Grow"
        stats={[
          { value: view.week.sales, label: 'sales' },
          { value: view.week.goodReviews, label: 'good reviews' },
          { value: view.week.opens, label: 'link visits' },
        ]}
        actions={(
          <>
            {shop && <button type="button" className="btn btn--sm mshare__go" onClick={() => open(shop)}>Share shop</button>}
            <button type="button" className="btn btn--sm btn--quiet" onClick={() => open(sellerInvite)}>Invite a seller</button>
          </>
        )}
        info={(
          <>
            <b>Grow</b>
            <p>The numbers are this week's: sales, four- and five-star reviews, and visitors who arrived through a shared link to the shop or its items.</p>
            <p>Share the shop to WhatsApp, a story or a group - every person who opens it counts toward the marketing quests.</p>
          </>
        )}
      />

      <section className="qpanel qarcade">
        <div className="qworld" aria-hidden="true"><QuestShooter volley={cleared} /></div>
        <BoardHead info={(
          <>
            <b>Shop quests</b>
            <p>Daily quests reset at midnight, India time; weekly ones on Monday; monthly ones on the 1st.</p>
            <p>Each weekly quest pays 1 bump point and each monthly one pays 2. Upkeep pays {upkeep} of the XP and no bump points.</p>
            <p>Milestones pay once a step, then a bigger step appears. Followers, hearts and ratings only count while you keep them.</p>
          </>
        )}>
          {readyAll > 0 && (
            <button type="button" className="btn btn--sm qbtn-gold" disabled={busy === 'all'} onClick={() => void claim('all')}>
              Collect all · {readyAll}
            </button>
          )}
        </BoardHead>
        <QuestTabs tab={tab} onTab={setTab} ready={ready} />
        <ul className="qtasks">
          {tasks.map((task) => (
            <QuestRow key={task.id}
              title={task.title} blurb={task.blurb} step={task.step}
              tag={{ area: task.area, label: AREA_SHORT[task.area] }}
              progress={task.progress} goal={task.goal} count={task.id.endsWith('fill60') ? `${task.progress}%` : undefined}
              xp={task.xp} bumps={task.bumps} claimed={task.claimed} claimable={task.claimable}
              busy={busy === task.id} onClaim={() => void claim(task.id)} action={go(task)} />
          ))}
        </ul>
      </section>

      <section className="qpanel" id="shop-items">
        <div className="qpanel__head">
          <h3><Glyph name="bolt" size={15} /> Share or bump an item</h3>
          <InfoTip label="About sharing and bumping">
            <b>Share or bump</b>
            <p>Share sends a picture of the item with a link. Bump spends one of the shop's bump points to put it back at the top of the feed - the same as Bump on the item's own page.</p>
          </InfoTip>
        </div>
        {!items ? <SkeletonText lines={3} /> : items.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>Nothing live yet. List an item and it shows up here.</p>
        ) : (
          <ul className="qitems-list">
            {items.map((listing) => (
              <li key={listing.id} className="qitems-list__row">
                {leadPhoto(listing)?.url ? <img className="qitems-list__thumb" src={leadPhoto(listing)!.url} alt="" /> : <span className="qitems-list__thumb" aria-hidden="true" />}
                <span className="qitems-list__name">{listing.title}</span>
                <span className="qitems-list__btns">
                  <button type="button" className="btn btn--sm btn--quiet" onClick={() => open(itemSpec(listing))}>Share</button>
                  <button type="button" className="btn btn--sm" disabled={busy === listing.id || !store.permissions.includes('listings')}
                    onClick={() => void bump(listing)}>
                    <Glyph name="bolt" size={12} /> Bump
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="qpanel">
        <div className="qpanel__head"><h3>Where the shop's XP came from</h3></div>
        {level.breakdown.length === 0 ? (
          <p className="faint" style={{ margin: 0 }}>Nothing yet. Collect a quest to start.</p>
        ) : (
          <dl className="qbreak">
            {[...level.breakdown].sort((a, b) => Number(a.xp < 0) - Number(b.xp < 0)).map((line) => (
              <div key={line.label} className={`qbreak__row${line.xp < 0 ? ' is-loss' : ''}`}>
                <dt>{line.label}{line.detail && <small>{line.detail}</small>}</dt>
                <dd>{line.xp > 0 ? '+' : ''}{line.xp.toLocaleString('en-IN')} XP</dd>
              </div>
            ))}
            <div className="qbreak__row qbreak__total">
              <dt>Total</dt>
              <dd>{level.points.toLocaleString('en-IN')} XP</dd>
            </div>
          </dl>
        )}
      </section>
      {sheet}
    </div>
  );
}

const AREA_SHORT: Record<GrowthTask['area'], string> = {
  reviews: 'Reviews', popularity: 'Popularity', sales: 'Sales', marketing: 'Marketing', upkeep: 'Upkeep',
};
