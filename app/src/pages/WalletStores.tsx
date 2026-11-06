import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { creditStoreId, type StoreGift } from '@shared/billing';
import { STAMPS, rewardWords, type CardProgress } from '@shared/loyalty';
import { BADGE_META, storeCreditLeft, type Badge, type StoreCredit } from '@shared/play';
import { ApiRequestError, api, type MyRefund } from '../api';
import { formatDateOrdinal, formatMoney } from '../format';
import { EmptyState, ErrorNotice } from '../components/ui';
import { SkelCards, SkelInline } from '../components/PageSkeletons';
import { StampCard, nextLine } from '../components/LoyaltyCard';

/**
 * The wallet, store by store: everything one shop, forwarder or artist holds
 * for this person - credit kept from an order, credit given or won, loyalty
 * cashback, money still owed back - with what it adds up to, and the loyalty
 * cards they are filling there.
 */

type Kind = 'kept' | 'given' | 'won' | 'loyalty' | 'owed';
const KIND_WORDS: Record<Kind, string> = {
  kept: 'Kept from an order',
  given: 'Credit from the store',
  won: 'Won in competitions',
  loyalty: 'Loyalty cashback',
  owed: 'Still owed back to you',
};

interface Line { kind: Kind; label: string; amountMinor: number; at: string; link: string | null; note?: string }

interface StoreRow {
  id: string;
  name: string;
  /** Comes off the next order there by itself. */
  spendMinor: number;
  owedMinor: number;
  byKind: Record<Kind, number>;
  lines: Line[];
  cards: CardProgress[];
  ready: number;
  paidOut: number;
}

function emptyRow(id: string, name: string): StoreRow {
  return { id, name, spendMinor: 0, owedMinor: 0, byKind: { kept: 0, given: 0, won: 0, loyalty: 0, owed: 0 }, lines: [], cards: [], ready: 0, paidOut: 0 };
}

function buildRows(refunds: MyRefund[], credits: StoreCredit[], gifts: StoreGift[], cards: CardProgress[]): StoreRow[] {
  const rows = new Map<string, StoreRow>();
  const row = (id: string, name: string) => {
    const found = rows.get(id) ?? emptyRow(id, name);
    rows.set(id, found);
    return found;
  };
  for (const refund of refunds) {
    if (refund.leftMinor <= 0) continue;
    const target = row(refund.sellerId, refund.sellerName);
    const kind: Kind = refund.status === 'held' ? 'kept' : 'owed';
    target.byKind[kind] += refund.leftMinor;
    if (kind === 'kept') target.spendMinor += refund.leftMinor;
    else target.owedMinor += refund.leftMinor;
    target.lines.push({ kind, label: refund.itemName, amountMinor: refund.leftMinor, at: refund.createdAt, link: `/order/${refund.orderId}`, note: refund.reason ?? undefined });
  }
  for (const credit of credits) {
    const left = storeCreditLeft(credit);
    if (left <= 0) continue;
    const target = row(credit.storeId, credit.storeName);
    const kind: Kind = credit.id.startsWith('loyalty:') ? 'loyalty' : credit.given ? 'given' : 'won';
    target.byKind[kind] += left;
    target.spendMinor += left;
    target.lines.push({
      kind, label: credit.reason, amountMinor: left, at: credit.createdAt, link: credit.link,
      note: credit.spentMinor > 0 ? `${formatMoney(credit.spentMinor)} of ${formatMoney(credit.amountMinor)} spent` : undefined,
    });
  }
  for (const gift of gifts) {
    if (gift.method === 'credit') continue;
    row(creditStoreId(gift.giverKind, gift.ownerId), gift.storeName).paidOut += gift.amountMinor;
  }
  for (const card of cards) {
    const target = row(card.card.ownerId, card.shopName);
    target.cards.push(card);
    target.ready += card.rewards.filter((entry) => entry.status === 'ready').length;
  }
  for (const target of rows.values()) target.lines.sort((a, b) => b.at.localeCompare(a.at));
  return [...rows.values()].sort((a, b) => (b.spendMinor + b.owedMinor) - (a.spendMinor + a.owedMinor) || b.ready - a.ready);
}

export function WalletStores({ refunds }: { refunds: MyRefund[] }) {
  const [data, setData] = useState<{ credits: StoreCredit[]; badges: Badge[]; gifts: StoreGift[]; cards: CardProgress[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    Promise.all([api.myRewards(), api.giftsReceived().catch(() => ({ gifts: [] })), api.myLoyalty().catch(() => ({ cards: [] }))])
      .then(([rewards, gifts, loyalty]) => live && setData({ ...rewards, gifts: gifts.gifts, cards: loyalty.cards }))
      .catch((err) => live && setError(err instanceof ApiRequestError ? err.message : 'Could not load your wallet.'));
    return () => { live = false; };
  }, []);
  const rows = useMemo(() => (data ? buildRows(refunds, data.credits, data.gifts, data.cards) : []), [data, refunds]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <WalletSkeleton />;
  const spend = rows.reduce((sum, entry) => sum + entry.spendMinor, 0);
  const owed = rows.reduce((sum, entry) => sum + entry.owedMinor, 0);
  const ready = rows.reduce((sum, entry) => sum + entry.ready, 0);

  return (
    <div className="wlt">
      <section className="whero">
        <div className="whero__main">
          <small>Ready to spend at your stores</small>
          <b>{formatMoney(spend)}</b>
          <span>It comes off your next order at each store by itself.</span>
        </div>
        <dl className="whero__side">
          <div><dt>Owed back</dt><dd>{formatMoney(owed)}</dd></div>
          <div><dt>Stores</dt><dd>{rows.filter((entry) => entry.spendMinor + entry.owedMinor > 0).length}</dd></div>
          <div><dt>Rewards</dt><dd>{ready}</dd></div>
        </dl>
      </section>

      {rows.length === 0 ? (
        <EmptyState icon="👛" title="Nothing here yet">
          Credit a store keeps or gives you, cashback from loyalty cards and money owed back all show here, store by store.
        </EmptyState>
      ) : (
        <div className="wstores">
          {rows.map((entry) => {
            const total = entry.spendMinor + entry.owedMinor;
            const isOpen = open === entry.id;
            return (
              <article key={entry.id} className={`wstore${isOpen ? ' is-open' : ''}`}>
                <button type="button" className="wstore__head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : entry.id)}>
                  <span className="wstore__mark" aria-hidden="true">{entry.name.slice(0, 1).toUpperCase()}</span>
                  <span className="wstore__who">
                    <b>{entry.name}</b>
                    <small>
                      {entry.spendMinor > 0 ? `${formatMoney(entry.spendMinor)} to spend` : 'No credit to spend'}
                      {entry.owedMinor > 0 ? ` · ${formatMoney(entry.owedMinor)} owed back` : ''}
                      {entry.cards.length > 0 ? ` · ${entry.cards.length} loyalty card${entry.cards.length > 1 ? 's' : ''}` : ''}
                    </small>
                  </span>
                  <span className="wstore__total">{formatMoney(total)}</span>
                </button>
                {total > 0 && (
                  <div className="wstore__bar" aria-hidden="true">
                    {(Object.keys(KIND_WORDS) as Kind[]).filter((kind) => entry.byKind[kind] > 0).map((kind) => (
                      <span key={kind} className={`wstore__seg wstore__seg--${kind}`} style={{ flexGrow: entry.byKind[kind] }} />
                    ))}
                  </div>
                )}
                <ul className="wstore__legend">
                  {(Object.keys(KIND_WORDS) as Kind[]).filter((kind) => entry.byKind[kind] > 0).map((kind) => (
                    <li key={kind}><i className={`wstore__dot wstore__seg--${kind}`} />{KIND_WORDS[kind]} <b>{formatMoney(entry.byKind[kind])}</b></li>
                  ))}
                  {entry.ready > 0 && <li><i className="wstore__dot wstore__seg--reward" />Rewards waiting <b>{entry.ready}</b></li>}
                  {entry.paidOut > 0 && <li className="faint">Paid to you directly: {formatMoney(entry.paidOut)}</li>}
                </ul>
                {isOpen && (
                  <div className="wstore__more">
                    {entry.lines.length > 0 && (
                      <ul className="wstore__lines">
                        {entry.lines.map((line, index) => (
                          <li key={index}>
                            <span>
                              <i className={`wstore__dot wstore__seg--${line.kind}`} />
                              {line.link ? <Link to={line.link}>{line.label}</Link> : line.label}
                              <small className="faint"> · {KIND_WORDS[line.kind]} · {formatDateOrdinal(line.at)}{line.note ? ` · ${line.note}` : ''}</small>
                            </span>
                            <b>{formatMoney(line.amountMinor)}</b>
                          </li>
                        ))}
                      </ul>
                    )}
                    {entry.cards.map((card) => (
                      <StampCard key={card.card.id} compact name={card.card.name} shopName={card.shopName} theme={card.card.theme}
                        rewards={card.card.rewards} stamps={card.stamps} round={card.round}
                        footer={<span>{nextLine(card.stamps, card.next, card.waiting)}</span>} />
                    ))}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {data.badges.length > 0 && (
        <section className="stack">
          <h2 style={{ margin: 0, fontSize: 'var(--t-md)' }}>Badges</h2>
          <div className="wallet-badges">
            {data.badges.map((badge) => (
              <Link key={badge.id} to={badge.link} className="wallet-badge">
                <span className="wallet-badge__emoji" aria-hidden="true">{BADGE_META[badge.kind].emoji}</span>
                <span>
                  <strong>{BADGE_META[badge.kind].label}</strong>
                  <span className="faint">{badge.detail}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/** Every loyalty card this person is filling, and the rewards it earned them. */
export function LoyaltyTab() {
  const [cards, setCards] = useState<CardProgress[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.myLoyalty().then((body) => setCards(body.cards))
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load your loyalty cards.'));
  }, []);
  if (error) return <ErrorNotice message={error} />;
  if (!cards) return <SkelCards n={2} h={120} />;
  if (cards.length === 0) {
    return (
      <EmptyState icon="🎟️" title="No loyalty cards yet">
        Shops with a loyalty card show it under their items. Every delivered order (or item, if the shop says so) earns a stamp - fill the card for cashback, free items and more.
      </EmptyState>
    );
  }
  const money = (minor: number) => formatMoney(minor);
  return (
    <div className="wloyal">
      {cards.map((card) => {
        const ready = card.rewards.filter((entry) => entry.status === 'ready');
        return (
          <section key={card.card.id} className="wloyal__card">
            <StampCard name={card.card.name} shopName={card.shopName} theme={card.card.theme} rewards={card.card.rewards}
              stamps={card.stamps} round={card.round}
              footer={<span>{nextLine(card.stamps, card.next, card.waiting)}</span>} />
            {card.rewards.length > 0 && (
              <ul className="wloyal__rewards">
                {[...card.rewards].reverse().map((entry) => (
                  <li key={entry.id} className={`wloyal__reward is-${entry.status}`}>
                    <span>
                      <b>{entry.status === 'credited' ? `${formatMoney(entry.valueMinor)} cashback` : rewardWords(entry.reward, money)}</b>
                      <small className="faint"> · stamp {entry.stamp} · {entry.itemName}</small>
                    </span>
                    <span className={`badge${entry.status === 'ready' ? ' badge--warn' : ' badge--ok'}`}>
                      {entry.status === 'credited' ? 'Added as store credit' : entry.status === 'ready' ? 'Ready - mention it on your next order' : 'Used'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {ready.length > 0 && <p className="faint" style={{ margin: 0 }}>The shop marks a reward used when they hand it over.</p>}
            {card.waiting > 0 && <p className="faint" style={{ margin: 0 }}>{card.waiting} reward{card.waiting > 1 ? 's' : ''} saved for a later order - you kept an offer that clashed with {card.waiting > 1 ? 'them' : 'it'}.</p>}
          </section>
        );
      })}
    </div>
  );
}

/**
 * The wallet before its figures arrive: the same orange card with its own
 * words, and a shimmer where each amount goes.
 */
export function WalletSkeleton() {
  return (
    <div className="wlt" role="status" aria-label="Loading your wallet">
      <section className="whero" aria-hidden="true">
        <div className="whero__main">
          <small>Ready to spend at your stores</small>
          <b><SkelInline w={90} h={30} /></b>
          <span>It comes off your next order at each store by itself.</span>
        </div>
        <dl className="whero__side">
          {['Owed back', 'Stores', 'Rewards'].map((label) => <div key={label}><dt>{label}</dt><dd><SkelInline w={34} h={16} /></dd></div>)}
        </dl>
      </section>
    </div>
  );
}
