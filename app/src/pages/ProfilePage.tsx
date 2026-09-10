import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { labelFor } from '@shared/fulfilment';
import { actionsFor } from '@shared/orders';
import { checkUsername, suggestUsername, USERNAME_PROBLEMS } from '@shared/handles';
import { ApiRequestError, api, type ActivityResponse } from '../api';
import { Avatar, EmptyState, ErrorNotice, Thumb, TrustBadge } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

type Tab = 'listings' | 'purchases' | 'sales' | 'following' | 'settings';

const TAB_LABELS: Record<Tab, string> = {
  listings: 'My listings',
  purchases: 'My purchases',
  sales: 'My sales',
  following: 'Following',
  settings: 'Settings',
};

/**
 * The orders waiting on this person, either way round.
 *
 * Read from the shared rules rather than re-derived, so this can never point at
 * something the server would refuse. Disputing is left out on purpose: it is
 * always available on a held payment, and a standing option is not a task.
 */
function waitingOn(data: ActivityResponse, userId: string) {
  return [...data.orders, ...data.sales].filter((order) => {
    // An open dispute is waiting on somebody whichever side they are, so it
    // counts whether or not there is an order action behind it.
    if (order.escrow.state === 'disputed') return true;
    return actionsFor(order, userId).some((action) => action === 'pay' || action === 'confirm');
  });
}

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
            {/* Two addresses, said plainly, because they are two parties: the
                person, and the shop they run. */}
            <p className="muted">
              {user.username ? (
                <Link to={`/${user.username}`} style={{ color: 'inherit' }}>@{user.username}</Link>
              ) : (
                <button type="button" className="linklike" onClick={() => setTab('settings')}>
                  Pick a username
                </button>
              )}
              {user.sellerProfile?.username && (
                <>
                  {' · shop '}
                  <Link to={`/${user.sellerProfile.username}`} style={{ color: 'inherit' }}>
                    @{user.sellerProfile.username}
                  </Link>
                </>
              )}
            </p>
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

      {/* Something with money on it and a person waiting. Above the tabs,
          because it is the reason to have opened this page at all. */}
      {data && waitingOn(data, user.id).length > 0 && (
        <div className="card card--pad stack" style={{ marginBottom: 18, borderColor: 'var(--accent-line)' }}>
          <span className="card__title">Waiting on you</span>
          {waitingOn(data, user.id).map((order) => (
            <Link key={order.id} to={`/order/${order.id}`} className="row row--between"
              style={{ color: 'inherit', textDecoration: 'none' }}>
              <span>{order.itemName}</span>
              <span className="badge badge--accent">
                {order.escrow.state === 'disputed' ? 'disputed'
                  : order.paymentStatus === 'unpaid' ? 'pay'
                  : 'confirm delivery'}
              </span>
            </Link>
          ))}
        </div>
      )}

      <div className="tabs">
        {(['listings', 'purchases', 'sales', 'following', 'settings'] as Tab[]).map((entry) => (
          <button key={entry} className={`tab${tab === entry ? ' is-on' : ''}`} onClick={() => setTab(entry)}>
            {TAB_LABELS[entry]}
            {data && entry !== 'settings' && (
              <span className="faint" style={{ marginLeft: 6 }}>
                {entry === 'listings' ? data.listings.length
                  : entry === 'purchases' ? data.orders.length
                  : entry === 'sales' ? data.sales.length
                  : data.following.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && <ErrorNotice message={error} />}
      {tab === 'settings' ? (
        <>
          <UsernameSettings />
          <MyPageSettings />
        </>
      ) : !data ? (
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
      ) : tab === 'purchases' || tab === 'sales' ? (
        (tab === 'sales' ? data.sales : data.orders).length === 0 ? (
          <EmptyState icon="◫" title={tab === 'sales' ? 'No sales yet' : 'No purchases yet'}>
            {tab === 'sales'
              ? 'Orders placed with you show up here, with anything needing an answer.'
              : 'Anything you buy shows up here with its tracking.'}
          </EmptyState>
        ) : (
          <div className="card table-scroll">
            <table className="table">
              <thead>
                <tr><th>Item</th><th>Qty</th><th>Total</th><th>Tracking</th><th>Payment</th><th>Escrow</th><th>Ordered</th></tr>
              </thead>
              <tbody>
                {(tab === 'sales' ? data.sales : data.orders).map((order) => (
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

/**
 * Your own page, as distinct from your shop's.
 *
 * A buyer is somebody a seller decides whether to deal with, so the page at
 * `/<your username>` is worth as much care as a storefront — and gets the same
 * three controls. Kept apart from the shop's on purpose: an account can be
 * both, and they are two different faces.
 */
function MyPageSettings() {
  const { user, refresh } = useSession();
  const [bio, setBio] = useState(user?.bio ?? '');
  const [coverUrl, setCoverUrl] = useState(user?.coverUrl ?? '');
  const [tags, setTags] = useState((user?.tags ?? []).join(', '));
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function save() {
    setBusy(true);
    setError(null);
    setFlash(null);
    try {
      await api.saveProfile({
        bio: bio.trim(),
        coverUrl: coverUrl.trim(),
        tags: tags.split(',').map((tag: string) => tag.trim()).filter(Boolean),
      });
      await refresh();
      setFlash('Saved.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--pad form" style={{ marginBottom: 16 }}>
      <h2 style={{ margin: 0 }}>Your page</h2>
      <p className="faint" style={{ marginTop: 0 }}>
        What a seller sees when they look you up before shipping to you.
        {user.username && (
          <> It is at <Link to={`/${user.username}`}>/{user.username}</Link>.</>
        )}
      </p>

      <label className="field">
        <span>Banner</span>
        <input value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)}
          placeholder="https://…" inputMode="url" />
      </label>

      <label className="field">
        <span>About you</span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3}
          placeholder="What you collect, what you are hunting for." />
      </label>

      <label className="field">
        <span>Chips</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)}
          placeholder="Gunpla, Mumbai, pays fast" />
        <span className="field__hint">Up to six, separated by commas.</span>
      </label>

      {flash && <p className="notice notice--ok">{flash}</p>}
      {error && <ErrorNotice message={error} />}

      <button className="btn" style={{ justifySelf: 'start' }} disabled={busy} onClick={() => void save()}>
        {busy ? 'Saving…' : 'Save your page'}
      </button>
    </div>
  );
}

/**
 * The username on your own profile.
 *
 * Its own thing, and not the shop's: an account is addressed at `/username`
 * and messaged at `@username`, and running a shop gives that shop a second
 * address rather than replacing this one. Accounts made before handles existed
 * have none, so this is also where the gap gets closed.
 */
function UsernameSettings() {
  const { user, refresh } = useSession();
  const [draft, setDraft] = useState(user?.username ?? '');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  // The same rules the server enforces, checked while it is being typed.
  const problem = checkUsername(draft);
  const suggestion = suggestUsername(user.displayName);
  const unchanged = draft.trim().toLowerCase() === (user.username ?? '');

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setFlash(null);
    setError(null);
    try {
      const result = await api.setUsername(draft.trim().toLowerCase());
      await refresh();
      setFlash(`You are @${result.username}.`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that username.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack" style={{ maxWidth: 560 }}>
      <form className="card card--pad form" onSubmit={save}>
        <label className="field">
          <span>Your username</span>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value.toLowerCase())}
            placeholder={suggestion}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <span className="field__hint">
            {problem ? (
              USERNAME_PROBLEMS[problem]
            ) : (
              <>Your page is <code>/{draft.trim()}</code> and people message you at <code>@{draft.trim()}</code>.</>
            )}
          </span>
        </label>

        {flash && <p className="notice notice--ok">{flash}</p>}
        {error && <ErrorNotice message={error} />}

        <button type="submit" className="btn" style={{ justifySelf: 'start' }}
          disabled={busy || problem !== null || unchanged}>
          {busy ? 'Saving…' : user.username ? 'Change username' : 'Claim username'}
        </button>
      </form>

      <div className="card card--pad stack">
        <span className="card__title">Your addresses</span>
        <div className="kv">
          <dt>You</dt>
          <dd>{user.username ? <Link to={`/${user.username}`}>@{user.username}</Link> : 'Not picked yet'}</dd>
        </div>
        <div className="kv">
          <dt>Your shop</dt>
          <dd>
            {user.sellerProfile?.username ? (
              <Link to={`/${user.sellerProfile.username}`}>@{user.sellerProfile.username}</Link>
            ) : user.sellerProfile ? (
              <Link to="/shop">Set one in the storefront editor</Link>
            ) : (
              <Link to="/shop">No storefront yet</Link>
            )}
          </dd>
        </div>
        <p className="faint">
          Two separate addresses, and messages to each are separate conversations — so a question for the
          shop does not land in the same thread as a message to you.
        </p>
      </div>
    </div>
  );
}
