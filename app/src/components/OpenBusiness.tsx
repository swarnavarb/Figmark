import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StoreKind } from '@shared/service-stores';
import { api, type ServiceStoreRole } from '../api';
import { useSession } from '../session';
import { Icon } from './ui';
import '../styles/OpenBusiness.css';

/**
 * The three businesses one account can open: a store that sells, a freight
 * forwarding company, an artist studio. Each card says where it stands -
 * not started, waiting on review, or live - and goes there.
 */
export function OpenBusinessChooser() {
  const { user } = useSession();
  const [own, setOwn] = useState<ServiceStoreRole[] | null>(null);

  useEffect(() => {
    if (!user) return;
    void api.myServiceStores().then((result) => setOwn(result.stores.filter((row) => row.isOwner))).catch(() => setOwn([]));
  }, [user]);

  const service = (kind: StoreKind) => own?.find((row) => row.kind === kind) ?? null;
  const hasShop = Boolean(user?.sellerProfile);
  const cards = [
    {
      id: 'store', emoji: '🛍️', title: 'Store', line: 'Sell figures, kits and collectibles — in stock or on pre-order.',
      state: hasShop ? 'Open' : null, to: '/shop', cta: hasShop ? 'Go to your storefront' : 'Open a store',
    },
    ...(['forwarder', 'artist'] as const).map((kind) => {
      const row = service(kind);
      const live = row?.live;
      return {
        id: kind,
        emoji: kind === 'forwarder' ? '✈️' : '🎨',
        title: kind === 'forwarder' ? 'Freight forwarder' : 'Artist',
        line: kind === 'forwarder'
          ? 'Ship parcels between countries: routes, prices, warehouses and cover.'
          : 'Repaints, custom sculpts and repairs: a menu, a portfolio, payment links.',
        state: row ? (live ? 'Open' : row.status === 'changes' ? 'Needs changes' : row.status === 'rejected' ? 'Not approved' : 'In review') : null,
        to: live ? `/services/store/${kind}/${row!.ownerId}` : `/services/apply/${kind}`,
        cta: live ? 'Open dashboard' : row ? 'View application' : `Open as ${kind === 'forwarder' ? 'a forwarder' : 'an artist'}`,
      };
    }),
  ];

  return (
    <div className="obz">
      {cards.map((card) => (
        <Link key={card.id} to={card.to} className={`obz-card obz-card--${card.id}`}>
          <span className="obz-card__emoji" aria-hidden="true">{card.emoji}</span>
          <span className="obz-card__body">
            <span className="obz-card__title">{card.title}{card.state && <span className="obz-card__state">{card.state}</span>}</span>
            <span className="obz-card__line">{card.line}</span>
          </span>
          <span className="obz-card__cta">{card.cta} <Icon name="right" size={14} /></span>
        </Link>
      ))}
      <p className="faint obz__note">One account can run all three. Switch between them from your profile picture.</p>
    </div>
  );
}
