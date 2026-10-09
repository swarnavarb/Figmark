import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError, api, type ChannelRow, type ForumRow } from '../api';

/*
 * Sharing inside the app: the same thing, posted to your feed, a forum you
 * joined, or a shop's channel. The server decides how it reads there - a
 * forum post is always the person, a shop's own room hears the shop - so
 * this only has to say where.
 */

const postHref = (post: { channelId: string; id: string }) =>
  `/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`;

export type Destination = 'feed' | 'forum' | 'channel';

interface Speaker { storeId: string | null; name: string }

export function PostInFigmark({ text, photo, feed = true, asStore = false, store = null, onPosted }: {
  /** What the post says to start with; the sharer can change it. */
  text: string;
  /** Uploads the picture that goes with it, if there is one, and says where it went. */
  photo?: () => Promise<string | null>;
  /** Offer the sharer's own feed. Off where the feed has its own way in, like a repost. */
  feed?: boolean;
  /** Speaking as a shop: shops stay out of forums and other shops' rooms. */
  asStore?: boolean;
  /** On the feed, the shop to speak as at first - the sharer can switch to themselves. */
  store?: string | null;
  onPosted?: (where: Destination) => void;
}) {
  const [where, setWhere] = useState<Destination>(feed ? 'feed' : asStore ? 'channel' : 'forum');
  const [forums, setForums] = useState<ForumRow[] | null>(null);
  const [channels, setChannels] = useState<ChannelRow[] | null>(null);
  const [room, setRoom] = useState('');
  // Who the feed post is from: you, or a shop you post for.
  const [shops, setShops] = useState<Speaker[]>([]);
  const [speaker, setSpeaker] = useState<string | null>(store);
  const [body, setBody] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ href: string; label: string } | null>(null);

  useEffect(() => setBody(text), [text]);

  useEffect(() => {
    if (!feed) return undefined;
    let live = true;
    void api.stores()
      .then((result) => {
        if (live) setShops(result.stores.filter((row) => row.permissions.includes('posts')).map((row) => ({ storeId: row.ownerId, name: row.name })));
      })
      .catch(() => undefined);
    return () => { live = false; };
  }, [feed]);
  // A shop you no longer post for falls back to you.
  const from = shops.some((shop) => shop.storeId === speaker) ? speaker : null;

  // The rooms are only asked for once somebody picks that kind of place.
  useEffect(() => {
    if (where === 'forum' && forums === null) {
      void api.forums()
        .then((result) => setForums(result.forums.filter((row) => row.member)))
        .catch(() => setForums([]));
    }
    if (where === 'channel' && channels === null) {
      void api.channels()
        .then((result) => setChannels(result.channels.filter((row) => !asStore || row.mine)))
        .catch(() => setChannels([]));
    }
  }, [where, forums, channels, asStore]);

  const rooms = where === 'forum' ? forums : where === 'channel' ? channels : null;
  const options = where === 'forum'
    ? (forums ?? []).map((row) => ({ id: row.id, label: row.name }))
    : (channels ?? []).map((row) => ({ id: row.sellerId, label: row.mine ? `${row.name} (yours)` : row.name }));
  const picked = where === 'feed' ? 'feed' : options.some((option) => option.id === room) ? room : options[0]?.id ?? '';

  async function submit() {
    if (!picked || busy) return;
    setBusy(true);
    setError(null);
    try {
      const url = photo ? await photo() : null;
      const { post } = await api.createPost({
        body: body.trim(),
        photoUrls: url ? [url] : [],
        ...(where === 'forum' ? { forumId: picked } : where === 'channel' ? { channelId: picked } : from ? { storeId: from } : {}),
      });
      const label = where === 'feed' ? (from ? `the feed as ${shops.find((shop) => shop.storeId === from)?.name ?? 'the shop'}` : 'your feed') : options.find((option) => option.id === picked)?.label.replace(/ \(yours\)$/, '') ?? 'there';
      setPosted({ href: postHref(post), label });
      onPosted?.(where);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  if (posted) {
    return (
      <div className="pif pif--done" role="status">
        <span>Posted to {posted.label} 🎉</span>
        <Link to={posted.href} className="btn btn--sm">See the post</Link>
      </div>
    );
  }

  const places: { id: Destination; label: string }[] = [
    ...(feed ? [{ id: 'feed' as const, label: shops.length > 0 ? 'Feed' : 'My feed' }] : []),
    ...(asStore ? [] : [{ id: 'forum' as const, label: 'A forum' }]),
    { id: 'channel', label: 'A channel' },
  ];

  return (
    <div className="pif">
      <div className="pif__places" role="radiogroup" aria-label="Where to post it">
        {places.map((place) => (
          <button key={place.id} type="button" role="radio" aria-checked={where === place.id}
            className={`pif__place${where === place.id ? ' is-on' : ''}`} onClick={() => setWhere(place.id)}>
            {place.label}
          </button>
        ))}
      </div>
      {where === 'feed' && shops.length > 0 && (
        <div className="pif__as" role="radiogroup" aria-label="Post as">
          <span className="pif__aslabel">Post as</span>
          {[{ storeId: null, name: 'Me' } as Speaker, ...shops].map((option) => (
            <button key={option.storeId ?? 'me'} type="button" role="radio" aria-checked={from === option.storeId}
              className={`pif__place${from === option.storeId ? ' is-on' : ''}`} onClick={() => setSpeaker(option.storeId)}>
              {option.storeId ? option.name : 'Me'}
            </button>
          ))}
        </div>
      )}
      {where !== 'feed' && (
        rooms === null ? (
          <p className="pif__hint">Finding your {where === 'forum' ? 'forums' : 'channels'}…</p>
        ) : options.length === 0 ? (
          <p className="pif__hint">
            {where === 'forum'
              ? <>You have not joined a forum yet. <Link to="/social?view=forums">Find one</Link></>
              : <>Follow a shop to post in its channel. <Link to="/social?view=channels">See channels</Link></>}
          </p>
        ) : (
          <select className="pif__room" value={picked} aria-label={where === 'forum' ? 'Forum' : 'Channel'}
            onChange={(event) => setRoom(event.target.value)}>
            {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
          </select>
        )
      )}
      <textarea className="pif__text" rows={3} maxLength={2000} value={body}
        aria-label="What the post says" onChange={(event) => setBody(event.target.value)} />
      <button type="button" className="btn btn--block" disabled={busy || !picked || (!body.trim() && !photo)} onClick={() => void submit()}>
        {busy ? 'Posting…' : where === 'feed' ? (from ? 'Post as the shop' : 'Post to my feed') : where === 'forum' ? 'Post in the forum' : 'Post in the channel'}
      </button>
      {error && <p className="notice notice--error">{error}</p>}
    </div>
  );
}
