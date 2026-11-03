import { useState, type CSSProperties, type ReactNode } from 'react';
import { REWARD_META, STAMPS, rewardWords, type CardTheme, type LoyaltyReward } from '@shared/loyalty';
import { ApiRequestError, api, type CheckoutReward } from '../api';
import { formatMoney } from '../format';
import { InfoTip } from './InfoTip';
import '../styles/LoyaltyCard.css';

const money = (minor: number) => formatMoney(minor);

/**
 * A loyalty card as a buyer holds it: the shop's colours, eight stamp spots,
 * the reward printed on the stamps that carry one, and the stamps already
 * earned inked in. `animate` presses the stamps in one after another, the way
 * a card is shown when it is opened.
 */
export function StampCard({ name, shopName, theme, rewards, stamps, round = 1, compact = false, animate = false, footer }: {
  name: string;
  shopName: string;
  theme: CardTheme;
  rewards: (LoyaltyReward | null)[];
  /** Stamps on the current round, 0 to 7. */
  stamps: number;
  round?: number;
  compact?: boolean;
  animate?: boolean;
  footer?: ReactNode;
}) {
  const initial = (shopName.trim()[0] ?? '★').toUpperCase();
  return (
    <article className={`stampcard stampcard--${theme}${compact ? ' stampcard--compact' : ''}${animate ? ' stampcard--animate' : ''}`}
      aria-label={`${name}: ${stamps} of ${STAMPS} stamps`}>
      <header className="stampcard__head">
        <span className="stampcard__mono" aria-hidden="true">{initial}</span>
        <span className="stampcard__titles">
          <span className="stampcard__brand">{shopName}</span>
          <b className="stampcard__name">{name}</b>
        </span>
        <span className="stampcard__count">
          <b>{stamps}</b>/{STAMPS}
          {round > 1 && <small>Card {round}</small>}
        </span>
      </header>
      <ol className="stampcard__grid">
        {Array.from({ length: STAMPS }, (_, index) => {
          const reward = rewards[index];
          const on = index < stamps;
          return (
            <li key={index} className={`lstamp${on ? ' is-on' : ''}${reward ? ' has-reward' : ''}`}
              style={{ '--i': index } as CSSProperties}
              title={reward ? `Stamp ${index + 1}: ${rewardWords(reward, money)}` : `Stamp ${index + 1}`}>
              <span className="lstamp__dot" aria-hidden="true">
                {on ? '★' : reward ? REWARD_META[reward.kind].icon : index + 1}
              </span>
              {reward && !compact && <span className="lstamp__gift">{rewardWords(reward, money)}</span>}
            </li>
          );
        })}
      </ol>
      <div className="stampcard__bar" aria-hidden="true">
        <span style={{ '--fill': stamps / STAMPS } as CSSProperties} />
      </div>
      {footer && <footer className="stampcard__foot">{footer}</footer>}
    </article>
  );
}

/** "2 more items to ₹50 cashback" - the line under a card. A reward kept for later is said first. */
export function nextLine(stamps: number, next: { stamp: number; reward: LoyaltyReward } | null, waiting = 0): string {
  const held = waiting > 0 ? `${waiting} reward${waiting > 1 ? 's' : ''} saved for a later order. ` : '';
  if (!next) return `${held}Every item earns a stamp.`;
  const away = next.stamp > stamps ? next.stamp - stamps : next.stamp + STAMPS - stamps;
  return `${held}${away} more ${away === 1 ? 'item' : 'items'} to ${rewardWords(next.reward, money)}`;
}

/** Eight dots in the card's colours: a card at a glance, for a line of text. */
export function StampDots({ theme, stamps }: { theme: CardTheme; stamps: number }) {
  return (
    <span className={`stampdots stampcard--${theme}`} aria-hidden="true">
      {Array.from({ length: STAMPS }, (_, index) => <i key={index} className={index < stamps ? 'is-on' : ''} />)}
    </span>
  );
}

/** How loyalty works, in three short lines, with the rest behind an ⓘ. */
export function LoyaltyHow() {
  return (
    <ul className="loyhow">
      <li><span aria-hidden="true">★</span> 1 stamp for every item you buy</li>
      <li><span aria-hidden="true">💸</span> Cashback goes to your wallet</li>
      <li>
        <span aria-hidden="true">🏷️</span> Money off comes straight off the price
        <InfoTip label="How rewards and offers work together">
          <p>Stamps land when an order is delivered. A reward comes with the order that reaches its stamp.</p>
          <p>Rewards and offers add up - unless both give the same thing (money off, a free item or free shipping). Then you pick one at checkout, and a reward you skip waits for your next order.</p>
          <p>Store credit and refunds always work with both.</p>
        </InfoTip>
      </li>
    </ul>
  );
}

/**
 * At checkout: the loyalty rewards this order brings. A reward that clashes
 * with an offer on the order (both money, both a free item, both free
 * shipping - or one the shop keeps apart from offers) is the buyer's pick:
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
  // Money off that fits is already a line in the price above.
  const fits = loyalty.rewards.filter((row) => row.fits && !(row.reward.kind === 'percent_off' && row.offMinor > 0));
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

  const when = (row: CheckoutReward) => (row.reward.kind === 'cashback_flat' || row.reward.kind === 'cashback_percent'
    ? 'to your wallet on delivery'
    : row.offMinor > 0 ? `${money(row.offMinor)} off now` : 'with this order');

  return (
    <div className="ckloyal" aria-label="Loyalty rewards">
      {fits.map((row) => (
        <p key={`${row.cardId}:${row.stamp}`} className="ckloyal__fit">
          <span className="ckloyal__icon" aria-hidden="true">{REWARD_META[row.reward.kind].icon}</span>
          <span className="ckloyal__what">
            <b>{rewardWords(row.reward, money)}</b>
            <small>{when(row)} · stamp {row.stamp}{row.tookOverOffer ? ' · picked over the offer' : ''}</small>
          </span>
        </p>
      ))}
      {loyalty.pickedReward && (
        <button type="button" className="ckloyal__undo" disabled={busy} onClick={() => void pick('offer')}>Use the offer instead</button>
      )}
      {clashing.length > 0 && (
        <div className="ckloyal__pick">
          <span className="ckloyal__ask">
            Pick one
            <InfoTip label="Why pick one">
              <p>This offer and this reward give the same kind of thing, so only one can be used.</p>
              <p>Keep the offer and the reward waits for your next order. Take the reward and the offer comes off this one.</p>
            </InfoTip>
          </span>
          <div className="ckloyal__opts" role="radiogroup" aria-label="Offer or reward">
            <button type="button" role="radio" aria-checked="true" className="ckloyal__opt is-on" disabled={busy}>
              <span className="ckloyal__tag">Offer</span>
              <b>{offers.join(' + ') || 'Your offer'}</b>
              <small>{offerMinor > 0 ? `${money(offerMinor)} off now` : 'On this order'}</small>
            </button>
            <button type="button" role="radio" aria-checked="false" className="ckloyal__opt" disabled={busy} onClick={() => void pick('reward')}>
              <span className="ckloyal__tag ckloyal__tag--reward">Reward</span>
              <b>{clashing.map((row) => rewardWords(row.reward, money)).join(' + ')}</b>
              <small>{clashing.some((row) => row.offMinor > 0)
                ? `${money(clashing.reduce((sum, row) => sum + row.offMinor, 0))} off now`
                : `Stamp ${clashing.map((row) => row.stamp).join(' & ')}`}</small>
            </button>
          </div>
        </div>
      )}
      {problem && <p className="ckloyal__err" role="alert">{problem}</p>}
    </div>
  );
}
