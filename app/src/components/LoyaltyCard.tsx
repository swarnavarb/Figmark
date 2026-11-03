import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { REWARD_META, STAMPS, rewardWords, type CardTheme, type LoyaltyReward } from '@shared/loyalty';
import { api, type ShopLoyalty } from '../api';
import { useSession } from '../session';
import { formatMoney } from '../format';
import '../styles/LoyaltyCard.css';

/**
 * A loyalty card as a buyer holds it: the shop's colours, eight stamp spots,
 * the reward printed on the stamps that carry one, and the stamps already
 * earned punched in.
 */
export function StampCard({ name, shopName, theme, rewards, stamps, round = 1, compact = false, footer }: {
  name: string;
  shopName: string;
  theme: CardTheme;
  rewards: (LoyaltyReward | null)[];
  /** Stamps on the current round, 0 to 7. */
  stamps: number;
  round?: number;
  compact?: boolean;
  footer?: React.ReactNode;
}) {
  const money = (minor: number) => formatMoney(minor);
  return (
    <article className={`stampcard stampcard--${theme}${compact ? ' stampcard--compact' : ''}`}>
      <header className="stampcard__head">
        <span className="stampcard__brand">{shopName}</span>
        <b className="stampcard__name">{name}</b>
        {round > 1 && <span className="stampcard__round">Card {round}</span>}
      </header>
      <ol className="stampcard__grid" aria-label={`${stamps} of ${STAMPS} stamps`}>
        {Array.from({ length: STAMPS }, (_, index) => {
          const reward = rewards[index];
          const on = index < stamps;
          return (
            <li key={index} className={`lstamp${on ? ' is-on' : ''}${reward ? ' has-reward' : ''}`}
              title={reward ? `Stamp ${index + 1}: ${rewardWords(reward, money)}` : `Stamp ${index + 1}`}>
              <span className="lstamp__dot" aria-hidden="true">{on ? '✓' : reward ? REWARD_META[reward.kind].icon : index + 1}</span>
              {reward && !compact && <span className="lstamp__gift">{rewardWords(reward, money)}</span>}
            </li>
          );
        })}
      </ol>
      {footer && <footer className="stampcard__foot">{footer}</footer>}
    </article>
  );
}

/** "2 more orders to ₹50 cashback" - the line under a card. */
export function nextLine(stamps: number, next: { stamp: number; reward: LoyaltyReward } | null): string {
  if (!next) return 'Every order stamps it.';
  const away = next.stamp > stamps ? next.stamp - stamps : next.stamp + STAMPS - stamps;
  return `${away} more ${away === 1 ? 'order' : 'orders'} to ${rewardWords(next.reward, (minor) => formatMoney(minor))}`;
}

/**
 * Under an item: the shop's loyalty cards that cover it, and where this buyer
 * stands on each. Nothing at all when the shop runs none.
 */
export function LoyaltyStrip({ ownerId, listingId }: { ownerId: string; listingId?: string }) {
  const { user } = useSession();
  const [data, setData] = useState<ShopLoyalty | null>(null);
  useEffect(() => {
    let live = true;
    api.shopLoyalty(ownerId, listingId).then((body) => live && setData(body)).catch(() => undefined);
    return () => { live = false; };
  }, [ownerId, listingId, user?.id]);
  if (!data || !data.live || data.cards.length === 0) return null;
  const mine = user?.id === ownerId;
  return (
    <section className="loyaltystrip" aria-label="Loyalty cards">
      <h3 className="loyaltystrip__title"><span aria-hidden="true">🎟️</span> Loyalty {data.cards.length > 1 ? 'cards' : 'card'}</h3>
      <div className="loyaltystrip__row">
        {data.cards.map((row) => (
          <StampCard key={row.card.id} compact name={row.card.name} shopName={data.shopName ?? ''} theme={row.card.theme}
            rewards={row.card.rewards} stamps={row.stamps} round={Math.floor(row.total / STAMPS) + 1}
            footer={mine ? <span>Your buyers see this card here.</span>
              : !row.signedIn ? <span>Sign in and order - every delivered order earns a stamp.</span>
                : (
                  <span className="loyaltystrip__status">
                    <b>{row.stamps}/{STAMPS}</b> · {row.total === 0 ? 'This order would be your first stamp. ' : ''}{nextLine(row.stamps, row.next)}
                    {row.ready > 0 && <> · <Link to="/wallet?tab=loyalty">{row.ready} reward{row.ready > 1 ? 's' : ''} waiting</Link></>}
                  </span>
                )} />
        ))}
      </div>
    </section>
  );
}
