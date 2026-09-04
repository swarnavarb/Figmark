import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { labelFor } from '@shared/fulfilment';
import { api, type ActivityResponse } from '../api';
import { Avatar, EmptyState, ErrorNotice, Thumb, TrustBadge } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

type Tab = 'listings' | 'purchases' | 'following';

/**
 * One profile, both sides of the account.
 *
 * "My Listings" and "My Purchases" sit side by side as tabs rather than behind
 * a buyer/seller mode switch - the account is both at once, so the UI should
 * not ask which one you are.
 */
export function ProfilePage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tab = (params.get('tab') as Tab) || 'listings';
  const setTab = (next: Tab) => setParams({ tab: next }, { replace: true });

  useEffect(() => {
    let cancelled = false;
    void api
      .activity()
      .then((result) => !cancelled && setData(result))
      .catch((err: Error) => !cancelled && setError(err.message));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return <main className="page"><p className="muted">Signed out.</p></main>;

  const verified = user.verification.governmentId === 'verified';

  return (
    <main className="page">
      <div className="card card--pad" style={{ marginBottom: 24 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 16 }}>
          <Avatar name={user.displayName} size={58} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h1>{user.displayName}</h1>
            <p className="muted">
              {user.sellerProfile?.storefrontName ?? 'No storefront yet'}
              {user.sellerProfile && ` · ${user.sellerProfile.dispatchRegion}`}
            </p>
            <div className="badges" style={{ marginTop: 8 }}>
              {user.capabilities.canBuy && <span className="badge badge--ok">Can buy</span>}
              {user.capabilities.canSell && <span className="badge badge--ok">Can sell</span>}
              {user.capabilities.canForward && <span className="badge badge--accent">Forwarder</span>}
              {user.capabilities.isAdmin && <span className="badge badge--accent">Admin</span>}
              {!verified && <span className="badge badge--warn">ID not verified</span>}
            </div>
          </div>
          <div className="stack" style={{ gap: 6, minWidth: 150 }}>
            <div className="row row--between">
              <span className="muted">As buyer</span>
              <TrustBadge score={user.buyerTrust.score} />
            </div>
            <div className="row row--between">
              <span className="muted">As seller</span>
              <TrustBadge score={user.sellerTrust.score} />
            </div>
            {user.sellerProfile && (
              <div className="row row--between">
                <span className="muted">Followers</span>
                <span style={{ fontWeight: 600 }}>{user.sellerProfile.followerCount}</span>
              </div>
            )}
          </div>
        </div>

        {!verified && (
          <p className="notice notice--info" style={{ marginTop: 16 }}>
            Verify your government ID and payout account to raise your seller tier, lift lot caps and enable
            high-value listings. You can keep buying and selling meanwhile.
          </p>
        )}
      </div>

      <div className="tabs">
        {(['listings', 'purchases', 'following'] as Tab[]).map((entry) => (
          <button key={entry} className={`tab${tab === entry ? ' is-on' : ''}`} onClick={() => setTab(entry)}>
            {entry === 'listings' ? 'My listings' : entry === 'purchases' ? 'My purchases' : 'Following'}
            {data && (
              <span className="faint" style={{ marginLeft: 6 }}>
                {entry === 'listings' ? data.listings.length : entry === 'purchases' ? data.orders.length : data.following.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <ErrorNotice message={error} />}
      {!data ? (
        <p className="muted">Loading…</p>
      ) : tab === 'listings' ? (
        data.listings.length === 0 ? (
          <EmptyState icon="✦" title="You haven't listed anything yet">
            <Link to="/sell" className="btn" style={{ marginTop: 10 }}>List your first item</Link>
          </EmptyState>
        ) : (
          <div className="grid">
            {data.listings.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="card card--link">
                <Thumb seed={listing.id} label={listing.title}>
                  <div className="thumb__badges">
                    <span className="badge badge--solid">{listing.condition}</span>
                    <span className={`badge badge--${listing.status === 'active' ? 'ok' : 'warn'}`}>{listing.status}</span>
                  </div>
                </Thumb>
                <div className="listing__body">
                  <span className="listing__title">{listing.title}</span>
                  <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
                  <span className="faint">{listing.viewCount} views · {listing.likeCount} saved</span>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : tab === 'purchases' ? (
        data.orders.length === 0 ? (
          <EmptyState icon="◫" title="No purchases yet">Anything you buy shows up here with its tracking.</EmptyState>
        ) : (
          <div className="card table-scroll">
            <table className="table">
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Total</th><th>Tracking</th><th>Payment</th><th>Escrow</th><th>Ordered</th></tr>
              </thead>
              <tbody>
                {data.orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <Link to={`/order/${order.id}`} style={{ color: 'var(--accent)', fontWeight: 550 }}>
                        {order.itemName}
                      </Link>
                    </td>
                    <td>{order.quantity}</td>
                    <td>{formatMoney(order.unitPriceMinor * order.quantity, order.currency)}</td>
                    <td><span className="badge">{labelFor(order.stage)}</span></td>
                    <td>
                      <span className={`badge badge--${order.paymentStatus === 'paid' ? 'ok' : 'warn'}`}>
                        {order.paymentStatus.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td><span className={`badge badge--${order.escrow.state === 'held' ? 'ok' : ''}`}>{order.escrow.state}</span></td>
                    <td className="faint">{timeAgo(order.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : data.following.length === 0 ? (
        <EmptyState icon="☆" title="Not following anyone yet">
          Follow sellers and their listings surface first in your feed.
        </EmptyState>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {data.following.map((seller) => (
            <article key={seller.id} className="card card--pad row">
              <Avatar name={seller.storefrontName} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="card__title">{seller.storefrontName}</div>
                <span className="faint">{seller.dispatchRegion} · {seller.followerCount} followers</span>
              </div>
              <TrustBadge score={seller.trustScore} tier={seller.tier} />
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
