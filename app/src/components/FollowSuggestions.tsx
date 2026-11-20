import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { FollowSuggestion } from '@shared/feed';
import { ApiRequestError, api } from '../api';
import { Avatar } from './ui';
import { Icon } from './Icon';
import { StoryTag, useStory } from './Story';
import '../styles/FollowSuggestions.css';

/**
 * People and shops worth following, each with the reason it is suggested.
 *
 * On Discover, between posts, and on an empty Social feed - the two places a
 * person is short of somebody to read. Following one takes it out of the row;
 * "Not now" mutes it, so it is not suggested again.
 */
export function FollowSuggestions({ title = 'People to follow', people = false, onFollowed }: {
  title?: string;
  /** People only - collectors, never shops - each on a cast headshot card. Discover's row. */
  people?: boolean;
  /** Somebody was followed: a feed showing this may want to read itself again. */
  onFollowed?: () => void;
}) {
  const [rows, setRows] = useState<FollowSuggestion[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const story = useStory('stage');

  useEffect(() => {
    let live = true;
    api.followSuggestions(people ? 'people' : undefined)
      .then((found) => live && setRows(found.suggestions))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [people]);

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
    <section ref={story.ref} className={`fsug ${story.className}`} aria-label={title}>
      {story.scene}
      <StoryTag>Chapter · The cast</StoryTag>
      <h2 className="fsug__title"><Icon name="users" size={15} /> {title}</h2>
      <div className="fsug__row story__row">
        {rows.map((row) => people ? (
          <CastCard key={row.followKey} row={row} busy={busy === row.followKey}
            onFollow={() => void follow(row)} onDismiss={() => void dismiss(row)} />
        ) : (
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

/**
 * A person, as a headshot pinned up backstage: a polaroid of them, their name
 * in print, the part they play here (collector, followers, posts), and why
 * they are suggested, in their own little quote. Shops never get one.
 */
function CastCard({ row, busy, onFollow, onDismiss }: {
  row: FollowSuggestion; busy: boolean; onFollow: () => void; onDismiss: () => void;
}) {
  const face = (
    <>
      <span className="fcast__shot">
        {row.photoUrl
          ? <img className="fcast__photo" src={row.photoUrl} alt="" loading="lazy" />
          : <Avatar name={row.name} size={64} />}
      </span>
      <strong className="fcast__name">{row.name}</strong>
      {row.handle && <span className="fcast__handle">@{row.handle}</span>}
    </>
  );
  const parts = [
    row.followerCount > 0 ? `${row.followerCount} follower${row.followerCount === 1 ? '' : 's'}` : null,
    row.postCount ? `${row.postCount} post${row.postCount === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return (
    <div className="fcast">
      <span className="fcast__tape" aria-hidden="true" />
      <button type="button" className="fcast__x" aria-label={`Not now: ${row.name}`} onClick={onDismiss}>
        <Icon name="close" size={12} />
      </button>
      {row.handle
        ? <Link to={`/${encodeURIComponent(row.handle)}`} className="fcast__who">{face}</Link>
        : <span className="fcast__who">{face}</span>}
      <span className="fcast__role">Collector</span>
      {parts.length > 0 && <span className="fcast__stats">{parts.join(' · ')}</span>}
      <q className="fcast__why">{row.reason}</q>
      <button type="button" className="fcast__follow" disabled={busy} onClick={onFollow}>
        <Icon name="plus" size={12} /> Follow
      </button>
    </div>
  );
}
