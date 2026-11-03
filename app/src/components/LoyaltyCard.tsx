import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { REWARD_META, STAMPS, rewardWords, type CardTheme, type LoyaltyReward, type StampPer } from '@shared/loyalty';
import { ApiRequestError, api, type CheckoutReward, type ShopLoyalty } from '../api';
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

/**
 * "2 more orders to ₹50 cashback" - the line under a card. A per-item card
 * counts items; a reward saved for later (the buyer kept a clashing offer) is said first.
 */
export function nextLine(
  stamps: number, next: { stamp: number; reward: LoyaltyReward } | null, per: StampPer = 'order', waiting = 0,
): string {
  const unit = (count: number) => (per === 'item' ? (count === 1 ? 'item' : 'items') : (count === 1 ? 'order' : 'orders'));
  const held = waiting > 0 ? `${waiting} reward${waiting > 1 ? 's' : ''} saved for a later order. ` : '';
  if (!next) return `${held}Every ${unit(1)} stamps it.`;
  const away = next.stamp > stamps ? next.stamp - stamps : next.stamp + STAMPS - stamps;
  return `${held}${away} more ${unit(away)} to ${rewardWords(next.reward, (minor) => formatMoney(minor))}`;
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
              : !row.signedIn ? <span>Sign in and order - every delivered {row.card.stampPer === 'item' ? 'item' : 'order'} earns a stamp.</span>
                : (
                  <span className="loyaltystrip__status">
                    <b>{row.stamps}/{STAMPS}</b> · {row.total === 0 ? 'This order would be your first stamp. ' : ''}{nextLine(row.stamps, row.next, row.card.stampPer, row.waiting)}
                    {row.ready > 0 && <> · <Link to="/wallet?tab=loyalty">{row.ready} reward{row.ready > 1 ? 's' : ''} waiting</Link></>}
                  </span>
                )} />
        ))}
      </div>
    </section>
  );
}

/**
 * At checkout: the loyalty rewards this order brings. A reward that clashes
 * with an offer on the order (both money, both a free item, both free
 * shipping - or one the shop keeps apart from offers) is the buyer's choice:
 * keep the offer, and the reward waits for a later order; or take the reward,
 * and that offer comes off this order.
 */
export function CheckoutLoyalty({ orderId, loyalty, onChanged }: {
  orderId: string;
  loyalty: { rewards: CheckoutReward[]; pickedReward: boolean };
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const money = (minor: number) => formatMoney(minor);
  const fits = loyalty.rewards.filter((row) => row.fits);
  const clashing = loyalty.rewards.filter((row) => !row.fits);
  const offers = [...new Set(clashing.flatMap((row) => row.clashWith))];
  const offerMinor = Math.max(0, ...clashing.map((row) => row.clashMinor));

  async function pick(choice: 'offer' | 'reward') {
    setBusy(true);
    setProblem(null);
    try {
      await api.loyaltyPick(orderId, choice);
      onChanged();
    } catch (err) {
      setProblem(err instanceof ApiRequestError ? err.message : 'Could not change that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ckloyal" aria-label="Loyalty rewards">
      {fits.map((row) => (
        <p key={`${row.cardId}:${row.stamp}`} className="ckloyal__fit">
          <span className="ckloyal__icon" aria-hidden="true">{REWARD_META[row.reward.kind].icon}</span>
          <span>
            <b>{rewardWords(row.reward, money)}</b> with this order
            <small> · {row.cardName}, stamp {row.stamp}{row.tookOverOffer ? ' · you took it over the offer' : ''}</small>
          </span>
        </p>
      ))}
      {loyalty.pickedReward && (
        <button type="button" className="ckloyal__undo" disabled={busy} onClick={() => void pick('offer')}>Use the offer instead</button>
      )}
      {clashing.length > 0 && (
        <div className="ckloyal__pick">
          <b className="ckloyal__ask">Pick one - these can&apos;t be used together</b>
          <div className="ckloyal__opts" role="radiogroup" aria-label="Offer or reward">
            <button type="button" role="radio" aria-checked="true" className="ckloyal__opt is-on" disabled={busy}>
              <span className="ckloyal__tag">Offer</span>
              <b>{offers.join(' + ') || 'Your offer'}</b>
              <small>{offerMinor > 0 ? `${money(offerMinor)} off now. ` : ''}The reward waits for a later order.</small>
            </button>
            <button type="button" role="radio" aria-checked="false" className="ckloyal__opt" disabled={busy} onClick={() => void pick('reward')}>
              <span className="ckloyal__tag">Reward</span>
              <b>{clashing.map((row) => rewardWords(row.reward, money)).join(' + ')}</b>
              <small>{clashing[0]!.cardName}, stamp {clashing.map((row) => row.stamp).join(' & ')}. The offer comes off this order.</small>
            </button>
          </div>
        </div>
      )}
      {problem && <p className="ckloyal__err" role="alert">{problem}</p>}
    </section>
  );
}
