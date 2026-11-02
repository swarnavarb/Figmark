import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StoreKind } from '@shared/service-stores';
import { api, type ServiceStoreRole } from '../api';
import { useSession } from '../session';
import { Icon } from './ui';
import '../styles/OpenBusiness.css';

/** The Sell tab's heading before there is a business: what this screen is for, said once. */
export function OpenBusinessHead() {
  return (
    <header className="obz-head">
      <p className="obz-head__kicker">Sell on Figmark</p>
      <h1 className="obz-head__title">Open a business</h1>
      <p className="obz-head__line">Pick one to start. The same account can run the others later.</p>
    </header>
  );
}

type Card = {
  id: 'store' | StoreKind;
  emoji: string;
  title: string;
  line: string;
  points: string[];
  state: string | null;
  live: boolean;
  to: string;
  cta: string;
};

/**
 * The three businesses one account can open: a store that sells, a freight
 * forwarding company, an artist studio. Each card says what it is for in a
 * line and three points, where it stands - not started, in review, open -
 * and goes there.
 */
export function OpenBusinessChooser({ onOpenStore }: { onOpenStore?: () => void } = {}) {
  const { user } = useSession();
  const [own, setOwn] = useState<ServiceStoreRole[] | null>(null);

  useEffect(() => {
    if (!user) return;
    void api.myServiceStores().then((result) => setOwn(result.stores.filter((row) => row.isOwner))).catch(() => setOwn([]));
  }, [user]);

  const service = (kind: StoreKind) => own?.find((row) => row.kind === kind) ?? null;
  const hasShop = Boolean(user?.sellerProfile);
  const cards: Card[] = [
    {
      id: 'store', emoji: '🛍️', title: 'Store',
      line: 'Sell figures, kits and collectibles to buyers across India.',
      points: ['In stock or pre-order', 'Group lots from abroad', 'Paid straight to you'],
      state: hasShop ? 'Open' : null, live: hasShop, to: '/shop', cta: hasShop ? 'Go to your storefront' : 'Open a store',
    },
    ...(['forwarder', 'artist'] as const).map((kind): Card => {
      const row = service(kind);
      const live = Boolean(row?.live);
      const forwarder = kind === 'forwarder';
      return {
        id: kind,
        emoji: forwarder ? '✈️' : '🎨',
        title: forwarder ? 'Freight forwarder' : 'Artist',
        line: forwarder
          ? 'Ship parcels between countries for buyers and shops.'
          : 'Take repaints, custom sculpts and repairs.',
        points: forwarder
          ? ['Routes and per-kg prices', 'Billed on arrival', 'Custom quotes and cover']
          : ['A menu of services', 'Portfolio of your work', 'Payment links'],
        state: row ? (live ? 'Open' : row.status === 'changes' ? 'Needs changes' : row.status === 'rejected' ? 'Not approved' : 'In review') : null,
        live,
        to: live ? `/services/store/${kind}/${row!.ownerId}` : `/services/apply/${kind}`,
        cta: live ? 'Open dashboard' : row ? 'View application' : forwarder ? 'Apply as a forwarder' : 'Apply as an artist',
      };
    }),
  ];

  return (
    <div className="obz">
      {cards.map((card) => {
        const inner = (
          <>
            <span className="obz-card__top">
              <span className="obz-card__emoji" aria-hidden="true">{card.emoji}</span>
              <span className="obz-card__name">
                <span className="obz-card__title">{card.title}</span>
                <span className="obz-card__line">{card.line}</span>
              </span>
              {card.state && <span className={`obz-card__state${card.live ? ' is-live' : ''}`}>{card.state}</span>}
            </span>
            <span className="obz-card__points">
              {card.points.map((point) => (
                <span key={point} className="obz-card__point"><Icon name="check" size={13} />{point}</span>
              ))}
            </span>
            <span className="obz-card__cta">
              <span>{card.cta}</span>
              <span className="obz-card__go" aria-hidden="true"><Icon name="right" size={16} /></span>
            </span>
          </>
        );
        // On the Sell tab itself the store card opens the setup right there.
        return card.id === 'store' && onOpenStore && !hasShop
          ? <button key={card.id} type="button" className={`obz-card obz-card--button obz-card--${card.id}`} onClick={onOpenStore}>{inner}</button>
          : <Link key={card.id} to={card.to} className={`obz-card obz-card--${card.id}`}>{inner}</Link>;
      })}
      <p className="obz__note"><Icon name="users" size={14} /> Running more than one? Switch between them from your profile picture.</p>
    </div>
  );
}
