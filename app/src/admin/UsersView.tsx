import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, admin, type AdminUserDetail, type AdminUserRow } from './api';
import { Confirm } from './Confirm';
import { formatDate, formatMoney } from '../format';

/**
 * Everyone, and what they have made.
 *
 * A list and a detail rather than a table of everything: the operator opening
 * an account is usually deciding something about that one person, and the
 * decision needs the whole of what they hold in front of it.
 */
export function UsersView() {
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await admin.users(query);
      setRows(result.users);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the accounts.');
    }
  }, [query]);

  useEffect(() => {
    void load();
  }, [load]);

  // A failure the operator can act on. Retry rather than "reload the page":
  // the usual cause is a worker that was still starting, and the second attempt
  // is the one that works.
  if (error) {
    return (
      <div className="stack">
        <p className="notice notice--error">{error}</p>
        <button className="btn" style={{ justifySelf: 'start' }} onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }
  if (!rows) return <p className="muted">Loading…</p>;

  if (openId) {
    return (
      <UserDetail
        id={openId}
        onClose={() => {
          setOpenId(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="stack">
      <label className="field">
        <span>Search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, email, phone, username or store" />
        <span className="field__hint">{rows.length} of {total} accounts</span>
      </label>

      <div className="card">
        {rows.map((row) => (
          <button key={row.id} type="button" className="userrow" onClick={() => setOpenId(row.id)}>
            <div className="userrow__main">
              <span className="userrow__name">
                {row.displayName}
                {row.username && <span className="faint"> @{row.username}</span>}
              </span>
              <span className="userrow__meta">
                {row.store ? `${row.store.name} · ` : ''}{row.email}
              </span>
            </div>
            <div className="userrow__tags">
              {row.suspended && <span className="badge badge--warn">suspended</span>}
              {!row.signInAccount && <span className="badge">no login</span>}
              {row.store && <span className="badge">store</span>}
              {row.escrowRights && (
                <span className="badge badge--ok">
                  Community manager{row.escrowRights.available === false ? ' · off' : ''}
                </span>
              )}
            </div>
          </button>
        ))}
        {rows.length === 0 && <p className="muted" style={{ padding: 16 }}>Nobody matches that.</p>}
      </div>
    </div>
  );
}

type Pending =
  | { kind: 'user'; row: AdminUserDetail }
  | { kind: 'listing' | 'lot' | 'post' | 'review'; id: string; ownerId: string; label: string };

/** One account: what they run, what they have made, and what can be done about it. */
function UserDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [alertText, setAlertText] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await admin.user(id));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load that account.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setPending(null);
      await load();
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : 'That did not work.';
      // A refusal to delete a bought item needs to be seen, not tucked under the page.
      if (err instanceof ApiRequestError && err.code === 'listing_purchased') setAlertText(message);
      else setError(message);
      setPending(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="notice notice--error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;

  const { user } = data;
  const deletable = data.blockers.length === 0;

  return (
    <div className="stack">
      <button className="btn btn--quiet" style={{ justifySelf: 'start' }} onClick={onClose}>
        ← All accounts
      </button>

      <div className="card card--pad stack">
        <div className="row row--between">
          <div>
            <h2 style={{ margin: 0 }}>{user.displayName}</h2>
            <span className="faint">
              {user.username ? `@${user.username} · ` : ''}{user.email}
              {user.phone && ` · ${user.phone}`}
            </span>
          </div>
          {user.suspended && <span className="badge badge--warn">suspended</span>}
        </div>

        <dl style={{ margin: 0 }}>
          <div className="kv"><dt>Joined</dt><dd>{formatDate(user.createdAt)}</dd></div>
          <div className="kv">
            <dt>Store</dt>
            <dd>{user.store ? `${user.store.name} (${user.store.tier}, ${user.store.followerCount} followers)` : 'None'}</dd>
          </div>
          <div className="kv">
            <dt>Orders</dt>
            <dd>{data.orders.purchases} bought · {data.orders.sales} sold</dd>
          </div>
          <div className="kv">
            <dt>Disputes lost</dt>
            <dd>{user.buyerTrust.disputesLost} as buyer · {user.sellerTrust.disputesLost} as seller</dd>
          </div>
        </dl>
      </div>

      <EscrowPanel user={user} onChanged={load} />

      <ResourceList title="Listings" empty="Nothing listed."
        items={data.listings.map((listing) => ({
          id: listing.id,
          label: `${listing.title} — ${formatMoney(listing.priceMinor, listing.currency)}`,
          meta: `${listing.status}${listing.lotId ? ' · in a lot' : ''}`,
        }))}
        onDelete={(item) => setPending({ kind: 'listing', id: item.id, ownerId: user.id, label: item.label })} />

      <ResourceList title="Lots" empty="No lots."
        items={data.lots.map((lot) => ({ id: lot.id, label: lot.name, meta: `${lot.status} · ${lot.stage}` }))}
        onDelete={(item) => setPending({ kind: 'lot', id: item.id, ownerId: user.id, label: item.label })} />

      <ResourceList title="Posts" empty="No posts."
        items={data.posts.map((post) => ({
          id: post.id,
          label: post.body || '(no text)',
          meta: `${post.kind} · ${formatDate(post.createdAt)}`,
          ownerId: post.channelId,
        }))}
        onDelete={(item) =>
          setPending({ kind: 'post', id: item.id, ownerId: item.ownerId ?? user.id, label: item.label })} />

      <ResourceList title="Reviews about them" empty="None yet."
        items={data.reviews.map((review) => ({
          id: review.id,
          label: `${review.rating}★ ${review.body || '(no text)'}`,
          meta: review.revealed ? formatDate(review.createdAt) : 'hidden — not yet revealed',
          ownerId: review.subjectId,
        }))}
        onDelete={(item) =>
          setPending({ kind: 'review', id: item.id, ownerId: item.ownerId ?? user.id, label: item.label })} />

      {error && <p className="notice notice--error">{error}</p>}

      <div className="card card--pad stack">
        <span className="card__title">Account</span>
        <p className="faint">
          Suspending stops them signing in and can be undone. Deleting cannot, and takes everything
          above with it.
        </p>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn--ghost" disabled={busy}
            onClick={() => void act(() => admin.suspend(user.id, !user.suspended))}>
            {user.suspended ? 'Lift suspension' : 'Suspend'}
          </button>
          <button className="btn btn--danger" disabled={busy || !deletable}
            onClick={() => setPending({ kind: 'user', row: data })}>
            Delete account
          </button>
        </div>
        {!deletable && (
          <p className="notice notice--warn">
            {data.blockers.join(' ')}
          </p>
        )}
      </div>

      {pending?.kind === 'user' && (
        <Confirm
          title={`Delete ${user.displayName}?`}
          confirmWord="DELETE"
          confirmLabel="Delete permanently"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void act(() => admin.deleteUser(user.id).then(onClose))}
        >
          <p>This removes the account and everything it has made:</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>{data.listings.length} listing{data.listings.length === 1 ? '' : 's'}</li>
            <li>{data.lots.length} lot{data.lots.length === 1 ? '' : 'es'}</li>
            <li>{data.posts.length} post{data.posts.length === 1 ? '' : 's'}</li>
            <li>Their email, phone and username go back into circulation</li>
          </ul>
          <p>
            Orders are kept: they are the other party's record too, and removing one side of a
            completed transaction takes the other side's history with it.
          </p>
          <p className="notice notice--warn" style={{ margin: 0 }}>This cannot be undone.</p>
        </Confirm>
      )}

      {alertText && (
        <div className="modal" role="alertdialog" aria-modal="true" aria-label="Item has been bought"
          onClick={(event) => event.target === event.currentTarget && setAlertText(null)}>
          <div className="modal__box">
            <h2 className="modal__title">This item has been bought</h2>
            <div className="modal__body"><p className="notice notice--warn">{alertText}</p></div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn btn--danger" onClick={() => setAlertText(null)}>OK</button>
            </div>
          </div>
        </div>
      )}

      {pending && pending.kind !== 'user' && (
        <Confirm
          title={`Delete this ${pending.kind}?`}
          confirmLabel="Delete"
          busy={busy}
          onCancel={() => setPending(null)}
          onConfirm={() => void act(() => admin.deleteResource(pending.kind, pending.id, pending.ownerId))}
        >
          <p style={{ overflowWrap: 'anywhere' }}>{pending.label}</p>
          <p className="notice notice--warn" style={{ margin: 0 }}>
            This cannot be undone.{pending.kind !== 'lot' && pending.kind !== 'review'
              ? ' Its photos are removed from storage too.' : ''}
          </p>
        </Confirm>
      )}
    </div>
  );
}

/**
 * Appointing a community manager.
 *
 * A community manager hears disputes - on purchases, reviews, comments,
 * posts and members - and holds payments bought with buyer protection.
 * Only the people appointed here see Services → My Job → Community Service.
 * Fees are not theirs: every fee is set centrally under Settings, and they
 * are paid a share of it after Figmark's commission.
 */
function EscrowPanel({ user, onChanged }: { user: AdminUserRow; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState(user.escrowRights?.displayName ?? '');
  const [note, setNote] = useState(user.escrowRights?.note ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function save(enabled: boolean) {
    setBusy(true);
    setError(null);
    try {
      await admin.setEscrow(user.id, { enabled, displayName: label, note });
      await onChanged();
      setConfirming(false);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card card--pad stack">
      <span className="card__title">Community manager</span>
      {user.escrowRights ? (
        <p className="faint">
          Appointed {formatDate(user.escrowRights.grantedAt)}, listed as <strong>{user.escrowRights.displayName}</strong>
          {user.escrowRights.available === false ? ' - currently not taking new disputes' : ''}. They can be picked to
          hear disputes they are not a party to, are assigned escalations by availability, and can be chosen to hold
          protected payments.
        </p>
      ) : (
        <p className="faint">
          Not a community manager. They cannot hear disputes or hold anybody's payment.
        </p>
      )}

      <label className="field">
        <span>Listed as</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)}
          placeholder={user.store?.name ?? user.displayName} />
        <span className="field__hint">The name members see when they pick a manager, and at checkout.</span>
      </label>
      <label className="field">
        <span>Note</span>
        <input value={note} onChange={(event) => setNote(event.target.value)}
          placeholder="Why this person. Operators only - members never see it." />
      </label>

      {error && <p className="notice notice--error">{error}</p>}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn" disabled={busy} onClick={() => void save(true)}>
          {user.escrowRights ? 'Update' : 'Make community manager'}
        </button>
        {user.escrowRights && (
          <button className="btn btn--quiet" disabled={busy} onClick={() => setConfirming(true)}>
            Remove
          </button>
        )}
      </div>

      {confirming && (
        <Confirm
          title="Remove them as a community manager?"
          confirmLabel="Remove"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save(false)}
        >
          <p>{user.displayName} will no longer be offered to hear new disputes or hold new payments, and loses the Community Service desk.</p>
          <p>
            Payments they are already holding stay with them. Reassign any dispute round they hold from the Disputes tab.
          </p>
        </Confirm>
      )}
    </div>
  );
}

interface ResourceItem {
  id: string;
  label: string;
  meta: string;
  ownerId?: string;
}

/** A section of things somebody made, each with a way to remove it. */
function ResourceList({ title, items, empty, onDelete }: {
  title: string;
  items: ResourceItem[];
  empty: string;
  onDelete: (item: ResourceItem) => void;
}) {
  return (
    <div className="card card--pad stack">
      <span className="card__title">{title} <span className="faint">{items.length}</span></span>
      {items.length === 0 ? (
        <p className="faint">{empty}</p>
      ) : (
        items.map((item) => (
          <div key={item.id} className="row row--between" style={{ gap: 12 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--t-sm)', overflowWrap: 'anywhere' }}>{item.label}</div>
              <span className="faint">{item.meta}</span>
            </div>
            <button className="btn btn--quiet btn--sm" onClick={() => onDelete(item)}>Delete</button>
          </div>
        ))
      )}
    </div>
  );
}
