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
      {people ? (
        <div className="fcast__stage">
          {/* The front curtain: down until the band is first seen, then it
              rises and rolls up under the heading, where it stays. */}
          <span className="fcast__curtain" aria-hidden="true"><i><b /></i></span>
          <div className="fsug__row story__row">
            {rows.map((row) => (
              <CastCard key={row.followKey} row={row} busy={busy === row.followKey} onFollow={() => void follow(row)} />
            ))}
          </div>
        </div>
      ) : (
      <div className="fsug__row story__row">
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
      )}
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
 * A person, as one of the cast: a lamp hangs over each card from the rig and
 * its beam falls through the card onto them - their face lit in a pool of
 * light on a velvet ground. Below, their name on the playbill, star billing,
 * their numbers, and why they are suggested. Shops never get one.
 */
function CastCard({ row, busy, onFollow }: { row: FollowSuggestion; busy: boolean; onFollow: () => void }) {
  const face = (
    <>
      <span className="fcast__spot">
        {row.photoUrl
          ? <img className="fcast__photo" src={row.photoUrl} alt="" loading="lazy" />
          : <Avatar name={row.name} size={64} />}
      </span>
      <strong className="fcast__name">{row.name}</strong>
      {row.handle && <span className="fcast__handle">@{row.handle}</span>}
    </>
  );
  const stats = [
    row.followerCount > 0 ? { n: row.followerCount, label: row.followerCount === 1 ? 'follower' : 'followers' } : null,
    row.postCount ? { n: row.postCount, label: row.postCount === 1 ? 'post' : 'posts' } : null,
  ].filter((stat): stat is { n: number; label: string } => stat !== null);
  return (
    <div className="fcast">
      <span className="fcast__lamp" aria-hidden="true"><i /></span>
      <span className="fcast__beam" aria-hidden="true" />
      {row.handle
        ? <Link to={`/${encodeURIComponent(row.handle)}`} className="fcast__who">{face}</Link>
        : <span className="fcast__who">{face}</span>}
      <span className="fcast__bill">Collector</span>
      {stats.length > 0 && (
        <span className="fcast__stats">
          {stats.map((stat) => <span key={stat.label}><b>{stat.n}</b> {stat.label}</span>)}
        </span>
      )}
      <q className="fcast__why">{row.reason}</q>
      <button type="button" className="fcast__follow" disabled={busy} onClick={onFollow}>
        <Icon name="plus" size={12} /> Follow
      </button>
    </div>
  );
}
