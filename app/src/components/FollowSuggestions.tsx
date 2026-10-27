import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FollowSuggestion } from '@shared/feed';
import { ApiRequestError, api } from '../api';
import { Avatar } from './ui';
import { Icon } from './Icon';
import '../styles/FollowSuggestions.css';

/**
 * People and shops worth following, each with the reason it is suggested.
 *
 * On Discover, between posts, and on an empty Social feed - the two places a
 * person is short of somebody to read. Following one takes it out of the row;
 * "Not now" mutes it, so it is not suggested again.
 */
export function FollowSuggestions({ title = 'People to follow', onFollowed }: {
  title?: string;
  /** Somebody was followed: a feed showing this may want to read itself again. */
  onFollowed?: () => void;
}) {
  const [rows, setRows] = useState<FollowSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.followSuggestions()
      .then((found) => live && setRows(found.suggestions))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, []);

  if (!rows || rows.length === 0) return null;

  async function follow(row: FollowSuggestion) {
    setBusy(row.followKey);
    setError(null);
    try {
      const { following } = await api.follow(row.followKey);
      if (following) {
        setRows((all) => all?.filter((entry) => entry.followKey !== row.followKey) ?? null);
        onFollowed?.();
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not follow.');
    } finally {
      setBusy(null);
    }
  }

  async function dismiss(row: FollowSuggestion) {
    setRows((all) => all?.filter((entry) => entry.followKey !== row.followKey) ?? null);
    try {
      await api.muteFeed(row.id, true);
    } catch {
      // Only a suggestion: if it comes back next time, nothing is lost.
    }
  }

  return (
    <section className="fsug" aria-label={title}>
      <h2 className="fsug__title"><Icon name="users" size={15} /> {title}</h2>
      <div className="fsug__row">
        {rows.map((row) => (
          <div key={row.followKey} className="fsug__card">
            <button type="button" className="fsug__x" aria-label={`Not now: ${row.name}`} onClick={() => void dismiss(row)}>
              <Icon name="close" size={12} />
            </button>
            <Who row={row} />
            <button type="button" className="btn btn--sm fsug__follow" disabled={busy === row.followKey}
              onClick={() => void follow(row)}>
              <Icon name="plus" size={12} /> Follow
            </button>
          </div>
        ))}
      </div>
      {error && <p className="spost__error" role="alert">{error}</p>}
    </section>
  );
}

/** The face, name and reason - opening their page when they have an address. */
function Who({ row }: { row: FollowSuggestion }) {
  const inside = (
    <>
      {row.photoUrl
        ? <img className="fsug__photo" src={row.photoUrl} alt="" loading="lazy" />
        : <Avatar name={row.name} size={52} />}
      <strong className="fsug__name">{row.name}</strong>
      <span className="fsug__kind">{row.shop ? 'Shop' : 'Collector'}{row.followerCount > 0 && ` · ${row.followerCount} followers`}</span>
      <span className="fsug__why">{row.reason}</span>
    </>
  );
  return row.handle
    ? <Link to={`/${encodeURIComponent(row.handle)}`} className="fsug__who">{inside}</Link>
    : <span className="fsug__who">{inside}</span>;
}
