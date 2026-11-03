import { useCallback, useEffect, useState } from 'react';
import {
  CARD_THEMES, REWARD_KINDS, REWARD_META, STAMPS, rewardWords,
  type CardTheme, type IssuedReward, type LoyaltyCard, type LoyaltyReward, type LoyaltySettings, type RewardKind, type StampPer,
  rewardPerk,
} from '@shared/loyalty';
import { PERK_WORDS, offerLabel, offerPerk, type Perk } from '@shared/offers';
import type { Listing } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { formatMoney, timeAgo } from '../format';
import { Loading } from './Feedback';
import { Select } from './Select';
import { StampCard } from './LoyaltyCard';
import '../styles/LoyaltyManager.css';

/**
 * The shop's loyalty cards (Pro): make a card, choose which stamps carry a
 * reward and what it is, see who holds it, and hand over the rewards that
 * are not cashback.
 */

type Draft = {
  id?: string;
  name: string;
  theme: CardTheme;
  everything: boolean;
  listingIds: string[];
  minOrder: string;
  stampPer: StampPer;
  rewards: (LoyaltyReward | null)[];
  active: boolean;
};

const blank = (): Draft => ({
  name: 'Regulars card', theme: 'gold', everything: true, listingIds: [], minOrder: '0', stampPer: 'order',
  rewards: Array.from({ length: STAMPS }, (_, index) => (index === 3 ? { kind: 'cashback_flat', amountMinor: 5_000 } : index === 7 ? { kind: 'free_shipping' } : null)),
  active: true,
});

const fromCard = (card: LoyaltyCard): Draft => ({
  id: card.id, name: card.name, theme: card.theme, everything: card.listingIds === null, listingIds: card.listingIds ?? [],
  minOrder: String(card.minOrderMinor / 100), stampPer: card.stampPer ?? 'order', rewards: [...card.rewards], active: card.active,
});

export function LoyaltyManager({ ownerId: _ownerId }: { ownerId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.myLoyaltyCards>> | null>(null);
  const [owed, setOwed] = useState<IssuedReward[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const [cards, rewards] = await Promise.all([api.myLoyaltyCards(), api.loyaltyRewardsOwed()]);
      setData(cards);
      setOwed(rewards.rewards);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your cards.');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  if (error && !data) return <p className="notice notice--error">{error}</p>;
  if (!data) return <Loading />;
  if (!data.settings.enabled) return <p className="notice">Loyalty cards are switched off on Figmark right now.</p>;
  if (draft) {
    return <CardEditor draft={draft} settings={data.settings} onCancel={() => setDraft(null)} onSaved={() => { setDraft(null); void load(); }} />;
  }
  const ready = owed.filter((entry) => entry.status === 'ready');
  const activeCount = data.cards.filter((card) => card.active).length;

  async function use(id: string) {
    try {
      await api.useLoyaltyReward(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not go through.');
    }
  }

  return (
    <div className="loyman">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div>
          <h2 style={{ margin: 0 }}>Loyalty cards</h2>
          <small className="faint">
            Every delivered order stamps the buyer&apos;s card. {STAMPS} stamps a card; a full card starts again.
            Cashback lands as store credit at once.
          </small>
        </div>
        <button type="button" className="btn" disabled={activeCount >= data.settings.maxCards && data.cards.length >= data.settings.maxCards}
          onClick={() => setDraft(blank())}>+ New card</button>
      </div>
      {error && <p className="notice notice--error">{error}</p>}

      {data.cards.length === 0 ? (
        <div className="card card--pad stack" style={{ justifyItems: 'start' }}>
          <StampCard name="Regulars card" shopName="Your shop" theme="gold" rewards={blank().rewards} stamps={2} />
          <p className="muted" style={{ margin: 0 }}>Make your first card: pick the stamps that pay out, and buyers see their progress on every item.</p>
        </div>
      ) : (
        <div className="loyman__cards">
          {data.cards.map((card) => (
            <div key={card.id} className="loyman__card">
              <StampCard name={card.name} shopName={card.listingIds ? `${card.listingIds.length} items` : 'Every item'} theme={card.theme}
                rewards={card.rewards} stamps={0} />
              <div className="loyman__meta">
                <span className={`badge${card.active ? ' badge--ok' : ''}`}>{card.active ? 'Live' : 'Paused'}</span>
                <span>{card.stampPer === 'item' ? 'A stamp per item' : 'A stamp per order'} · {data.stats[card.id]?.holders ?? 0} holders · {data.stats[card.id]?.stamps ?? 0} stamps given</span>
                {card.minOrderMinor > 0 && <span>From {formatMoney(card.minOrderMinor)}</span>}
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setDraft(fromCard(card))}>Edit</button>
                <button type="button" className="btn btn--quiet btn--sm"
                  onClick={() => window.confirm(`Delete "${card.name}"? Rewards already earned stay with the buyers.`)
                    && void api.deleteLoyaltyCard(card.id).then(load)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      <section className="card card--pad stack">
        <h3 style={{ margin: 0 }}>Rewards to hand over {ready.length > 0 && <span className="badge badge--warn">{ready.length}</span>}</h3>
        {owed.length === 0 ? <p className="muted" style={{ margin: 0 }}>Nothing earned yet.</p> : (
          <div className="loyman__owed">
            {owed.slice(0, 40).map((entry) => (
              <div key={entry.id} className="loyman__owedrow">
                <span style={{ display: 'grid' }}>
                  <b>{entry.buyerName} · {entry.status === 'credited' ? `${formatMoney(entry.valueMinor)} cashback` : rewardWords(entry.reward, (minor) => formatMoney(minor))}</b>
                  <small className="faint">{entry.cardName} · stamp {entry.stamp} · {entry.itemName} · {timeAgo(entry.at)}</small>
                </span>
                {entry.status === 'ready'
                  ? <button type="button" className="btn btn--sm" onClick={() => void use(entry.id)}>Mark given</button>
                  : <span className={`badge${entry.status === 'credited' ? ' badge--ok' : ''}`}>{entry.status === 'credited' ? 'Paid as credit' : 'Given'}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CardEditor({ draft: start, settings, onCancel, onSaved }: {
  draft: Draft; settings: LoyaltySettings; onCancel: () => void; onSaved: () => void;
}) {
  const [draft, setDraft] = useState(start);
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    // Always: the item picker needs them, and so does the clash check against the shop's offers.
    if (!listings) api.myListings().then((body) => setListings(body.listings)).catch(() => setListings([]));
  }, [listings]);
  // The offers on the items this card covers, by what they give.
  const offersByPerk = new Map<Perk, string[]>();
  for (const listing of listings ?? []) {
    if (listing.status !== 'active' || (!draft.everything && !draft.listingIds.includes(listing.id))) continue;
    for (const offer of listing.offers ?? []) {
      const perk = offerPerk(offer);
      const words = offerLabel(offer);
      const list = offersByPerk.get(perk) ?? [];
      if (!list.includes(words)) offersByPerk.set(perk, [...list, words]);
    }
  }
  const anyOffers = [...offersByPerk.values()].flat();
  const clashNote = (reward: LoyaltyReward): string | null => {
    if (anyOffers.length === 0) return null;
    if (reward.withOffers === false) return `Never with an offer. On an order with ${anyOffers.length === 1 ? anyOffers[0] : 'one of your offers'}, the buyer picks one.`;
    const perk = rewardPerk(reward.kind);
    const same = perk ? offersByPerk.get(perk) ?? [] : [];
    return same.length ? `Clashes with ${same.slice(0, 2).join(', ')}${same.length > 2 ? ` and ${same.length - 2} more` : ''} - both are ${PERK_WORDS[perk!]}. The buyer picks one at checkout.` : null;
  };
  const kinds = REWARD_KINDS.filter((kind) => settings.rewardKinds[kind]);
  const setSlot = (index: number, reward: LoyaltyReward | null) =>
    setDraft({ ...draft, rewards: draft.rewards.map((slot, at) => (at === index ? reward : slot)) });

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.saveLoyaltyCard({
        id: draft.id, name: draft.name, theme: draft.theme, active: draft.active,
        listingIds: draft.everything ? null : draft.listingIds,
        minOrderMinor: Math.round(Number(draft.minOrder || 0) * 100),
        stampPer: draft.stampPer,
        rewards: draft.rewards,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save the card.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="loyman">
      <StampCard name={draft.name || 'Your card'} shopName="Preview" theme={draft.theme} rewards={draft.rewards} stamps={3} />
      <div className="card card--pad stack">
        <label className="field">
          <span>Card name</span>
          <input value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <div className="field">
          <span>Colour</span>
          <div className="loyman__themes">
            {CARD_THEMES.map((theme) => (
              <button key={theme} type="button" aria-label={theme}
                className={`loyman__theme loyman__theme--${theme}${draft.theme === theme ? ' is-on' : ''}`}
                onClick={() => setDraft({ ...draft, theme })} />
            ))}
          </div>
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={draft.everything} onChange={(e) => setDraft({ ...draft, everything: e.target.checked })} />
          <span>Every item in the shop stamps it</span>
        </label>
        {!draft.everything && (
          !listings ? <Loading /> : (
            <div className="loyman__items">
              {listings.filter((listing) => listing.status !== 'archived').map((listing) => (
                <label key={listing.id} className="loyman__item">
                  <input type="checkbox" checked={draft.listingIds.includes(listing.id)}
                    onChange={(e) => setDraft({
                      ...draft,
                      listingIds: e.target.checked ? [...draft.listingIds, listing.id] : draft.listingIds.filter((id) => id !== listing.id),
                    })} />
                  <span>{listing.title}</span>
                </label>
              ))}
            </div>
          )
        )}
        <div className="field">
          <span>A stamp for</span>
          <div className="loyman__per" role="radiogroup" aria-label="A stamp for">
            {([['order', 'Every order', 'One stamp, however many items'], ['item', 'Every item', 'An order of 3 gives 3 stamps']] as const).map(([value, title, hint]) => (
              <button key={value} type="button" role="radio" aria-checked={draft.stampPer === value}
                className={`loyman__peropt${draft.stampPer === value ? ' is-on' : ''}`} onClick={() => setDraft({ ...draft, stampPer: value })}>
                <b>{title}</b><small>{hint}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="field" style={{ maxWidth: 220 }}>
          <span>Smallest order that stamps (₹)</span>
          <input type="number" inputMode="decimal" min={0} value={draft.minOrder} onChange={(e) => setDraft({ ...draft, minOrder: e.target.value })} />
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          <span>Live - buyers collect stamps on it</span>
        </label>
      </div>

      <div className="card card--pad stack">
        <h3 style={{ margin: 0 }}>What each stamp gives</h3>
        <p className="loyman__rule">
          Rewards work alongside your offers, except two of the same kind - cashback or money off with a money-off offer, a free
          item with buy-X-get-Y, free shipping with free shipping. Then the buyer picks one at checkout, and a reward they skip
          waits for a later order. Untick &quot;Can be used with offers&quot; to keep a reward apart from every offer. Store credit
          and refunds always work with both.
        </p>
        <div className="loyman__slots">
          {draft.rewards.map((reward, index) => {
            const allowed = settings.stampsAllowed[index] !== false;
            return (
              <div key={index} className={`loyman__slot${reward ? ' has-reward' : ''}${allowed ? '' : ' is-off'}`}>
                <span className="loyman__num">{index + 1}</span>
                <div className="loyman__inputs">
                  <Select value={reward?.kind ?? ''} disabled={!allowed} aria-label={`Stamp ${index + 1} reward`}
                    onChange={(e) => {
                      const kind = e.target.value as RewardKind | '';
                      setSlot(index, kind ? { kind, ...(kind === 'cashback_flat' ? { amountMinor: 5_000 } : kind === 'cashback_percent' || kind === 'percent_off' ? { bp: 500 } : kind === 'free_item' || kind === 'custom' ? { text: '' } : {}) } : null);
                    }}>
                    <option value="">{allowed ? 'Just a stamp' : 'Not on this stamp'}</option>
                    {kinds.map((kind) => <option key={kind} value={kind}>{REWARD_META[kind].icon} {REWARD_META[kind].label}</option>)}
                  </Select>
                  {reward?.kind === 'cashback_flat' && (
                    <input type="number" inputMode="decimal" aria-label="Cashback ₹" placeholder="₹" value={(reward.amountMinor ?? 0) / 100}
                      onChange={(e) => setSlot(index, { ...reward, amountMinor: Math.round(Number(e.target.value || 0) * 100) })} />
                  )}
                  {(reward?.kind === 'cashback_percent' || reward?.kind === 'percent_off') && (
                    <input type="number" inputMode="decimal" aria-label="Percent" placeholder="%" value={(reward.bp ?? 0) / 100}
                      onChange={(e) => setSlot(index, { ...reward, bp: Math.round(Number(e.target.value || 0) * 100) })} />
                  )}
                  {(reward?.kind === 'free_item' || reward?.kind === 'custom') && (
                    <input value={reward.text ?? ''} maxLength={60} placeholder={reward.kind === 'free_item' ? 'Sticker pack' : 'Early access to drops'}
                      onChange={(e) => setSlot(index, { ...reward, text: e.target.value })} />
                  )}
                  {reward && (
                    <label className="loyman__with">
                      <input type="checkbox" checked={reward.withOffers !== false}
                        onChange={(e) => setSlot(index, e.target.checked ? { ...reward, withOffers: undefined } : { ...reward, withOffers: false })} />
                      <span>Can be used with offers</span>
                    </label>
                  )}
                  {reward && clashNote(reward) && <small className="loyman__clash">⚠ {clashNote(reward)}</small>}
                </div>
              </div>
            );
          })}
        </div>
        <small className="faint">
          Up to {formatMoney(settings.maxFlatMinor)} or {settings.maxCashbackBp / 100}% cashback, and {settings.maxPercentOffBp / 100}% off, as Figmark allows.
        </small>
      </div>
      {error && <p className="notice notice--error">{error}</p>}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save card'}</button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
