import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiRequestError, api, type ForumRow, type ShareableListing } from '../api';
import { Thumb } from './ui';
import { Icon } from './Icon';
import { Confetti } from './SocialPost';
import { VoiceAvatar, VoicePicker, useVoice } from './SocialVoice';
import { shrink } from './PhotoManager';
import {
  POLL_MAX_OPTIONS, POLL_MIN_OPTIONS, POLL_OPTION_MAX_CHARS, POST_MAX_PHOTOS, VIBES, VIBE_MAX_CHARS,
  type Vibe,
} from '@shared/social';
import { formatMoney } from '../format';
import { useSession } from '../session';

/** How long a poll runs, as offered. */
const POLL_LENGTHS: { hours: number; label: string }[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 0, label: 'No end' },
];

/** A post from the feed goes into three forums at most. */
const MAX_FORUMS = 3;

interface DraftPhoto {
  key: string;
  preview: string;
  url: string | null;
  failed: boolean;
}

/**
 * Write an update: words, photos, a poll, or a line on a colour.
 *
 * Closed it is one tap-target with the three things you might add, so the
 * feed starts with an invitation rather than a form. Open, it grows only the
 * parts you asked for. The post goes to your own profile, or a shop you run -
 * the choice only appears when there is one to make.
 */
export function Composer({ onPosted, forum = null }: {
  onPosted: () => void | Promise<void>;
  /** Writing inside a forum: always as yourself, and optionally onto your feed too. */
  forum?: { id: string; name: string } | null;
}) {
  const { user } = useSession();
  const { voice: chosen } = useVoice();
  // A forum is people only, so inside one you write as yourself whatever
  // voice the tab is in.
  const voice = forum ? { storeId: null, name: user?.displayName ?? 'Me', handle: user?.username ?? null } : chosen;
  // From the feed, a person can send a post to up to three forums they are
  // in; it goes on their feed as well, since that is where they were writing.
  const [targets, setTargets] = useState<ForumRow[]>([]);
  const target = targets[0] ?? null;
  const [joined, setJoined] = useState<ForumRow[] | null>(null);
  const [choosingForum, setChoosingForum] = useState(false);
  const [toWall, setToWall] = useState(false);
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const [poll, setPoll] = useState<string[] | null>(null);
  const [pollHours, setPollHours] = useState(24);
  const [vibe, setVibe] = useState<Vibe | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [party, setParty] = useState(0);
  // An item from the shop's own stock, with the post's words on top of it.
  const [item, setItem] = useState<ShareableListing | null>(null);
  const [stock, setStock] = useState<ShareableListing[] | null>(null);
  const [picking, setPicking] = useState(false);
  const picker = useRef<HTMLInputElement | null>(null);
  const text = useRef<HTMLTextAreaElement | null>(null);

  // A different voice has different stock, and a person has none to attach.
  // Nor does a shop have forums to post into.
  useEffect(() => {
    setTargets([]);
    setChoosingForum(false);
    setItem(null);
    setStock(null);
    setPicking(false);
  }, [voice.storeId]);

  async function openForums() {
    setChoosingForum(true);
    if (joined) return;
    try {
      setJoined((await api.forums()).forums.filter((row) => row.member));
    } catch (err) {
      setJoined([]);
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your forums.');
    }
  }

  async function openStock() {
    setPicking(true);
    if (stock || !voice.storeId) return;
    try {
      setStock((await api.shareable(voice.storeId)).listings);
    } catch (err) {
      setStock([]);
      setError(err instanceof ApiRequestError ? err.message : 'Could not load your items.');
    }
  }

  // A shop is addressed by its name; a person by their first one.
  const first = voice.storeId ? voice.name : (user?.displayName.split(' ')[0] ?? 'there');
  const uploading = photos.some((photo) => !photo.url && !photo.failed);
  const pollReady = !poll || poll.filter((option) => option.trim()).length >= POLL_MIN_OPTIONS;
  const canPost = !busy && !uploading && pollReady
    && (body.trim().length >= 2 || photos.some((photo) => photo.url) || Boolean(item))
    && (!vibe || body.trim().length <= VIBE_MAX_CHARS)
    && (!poll || body.trim().length >= 2);

  function expand(then?: () => void) {
    setOpen(true);
    window.setTimeout(() => {
      text.current?.focus();
      then?.();
    }, 0);
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    setVibe(null);
    const room = POST_MAX_PHOTOS - photos.length;
    const chosen = [...files].filter((file) => file.type.startsWith('image/')).slice(0, room);
    if (files.length > room) setError(`Up to ${POST_MAX_PHOTOS} photos on one post.`);
    const drafts = chosen.map((file) => ({
      key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
      preview: URL.createObjectURL(file),
      url: null,
      failed: false,
    }));
    setPhotos((list) => [...list, ...drafts]);
    await Promise.all(chosen.map(async (file, index) => {
      const key = drafts[index]!.key;
      try {
        const stored = await api.uploadPhoto(await shrink(file));
        setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, url: stored.url } : photo)));
      } catch (err) {
        setPhotos((list) => list.map((photo) => (photo.key === key ? { ...photo, failed: true } : photo)));
        setError(err instanceof ApiRequestError ? err.message : 'A photo would not upload.');
      }
    }));
  }

  function reset() {
    photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
    setBody('');
    setPhotos([]);
    setPoll(null);
    setVibe(null);
    setItem(null);
    setPicking(false);
    setTargets([]);
    setChoosingForum(false);
    setToWall(false);
    setOpen(false);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPost({
        body: body.trim() || (item ? `Now available: ${item.title}` : ''),
        ...(voice.storeId ? { storeId: voice.storeId } : {}),
        ...(forum ? { forumId: forum.id, toWall } : {}),
        ...(!forum && target
          ? { forumId: target.id, toWall: true, alsoForumIds: targets.slice(1).map((row) => row.id) }
          : {}),
        ...(item ? { listingId: item.id } : {}),
        photoUrls: photos.map((photo) => photo.url).filter((url): url is string => Boolean(url)),
        ...(poll ? { poll: { options: poll.map((option) => option.trim()).filter(Boolean), closesInHours: pollHours } } : {}),
        ...(vibe ? { vibe } : {}),
      });
      reset();
      setParty((count) => count + 1);
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  const tools = (
    <div className="writer__tools">
      <button type="button" className="writer__tool writer__tool--photo"
        disabled={photos.length >= POST_MAX_PHOTOS}
        onClick={() => (open ? picker.current?.click() : expand(() => picker.current?.click()))}>
        <Icon name="image" size={18} /> <span>Photo</span>
      </button>
      <button type="button" className={`writer__tool writer__tool--poll${poll ? ' is-on' : ''}`}
        onClick={() => {
          if (!open) expand();
          setVibe(null);
          setPoll(poll ? null : ['', '']);
        }}>
        <Icon name="poll" size={18} /> <span>Poll</span>
      </button>
      <button type="button" className={`writer__tool writer__tool--vibe${vibe ? ' is-on' : ''}`}
        onClick={() => {
          if (!open) expand();
          if (vibe) {
            setVibe(null);
          } else {
            setPoll(null);
            setPhotos([]);
            setVibe('hero');
          }
        }}>
        <Icon name="spark" size={18} /> <span>Colour</span>
      </button>
      {voice.storeId && (
        <button type="button" className={`writer__tool writer__tool--item${item || picking ? ' is-on' : ''}`}
          onClick={() => {
            if (!open) expand();
            setVibe(null);
            if (picking) setPicking(false);
            else void openStock();
          }}>
          <Icon name="tag" size={18} /> <span>Item</span>
        </button>
      )}
      {!forum && !voice.storeId && (
        <button type="button" className={`writer__tool writer__tool--forum${target || choosingForum ? ' is-on' : ''}`}
          onClick={() => {
            if (!open) expand();
            if (choosingForum) setChoosingForum(false);
            else void openForums();
          }}>
          <Icon name="forum" size={18} /> <span>Forum</span>
        </button>
      )}
    </div>
  );

  if (!open) {
    return (
      <div className="writer writer--closed">
        <Confetti run={party} />
        <div className="writer__prompt">
          {forum ? <VoiceAvatar voice={voice} size={44} /> : <VoicePicker size={44} />}
          <button type="button" className="writer__fake" onClick={() => expand()}>
            {forum ? `Start a conversation in ${forum.name}…` : `What's new, ${first}?`}
          </button>
        </div>
        {tools}
      </div>
    );
  }

  const left = VIBE_MAX_CHARS - body.trim().length;

  return (
    <form className="writer" onSubmit={submit}>
      <div className="writer__prompt">
        {forum ? <VoiceAvatar voice={voice} size={44} /> : <VoicePicker size={44} />}
        <div className="writer__as">
          <strong>
            {voice.name}
            {(forum ?? target) && (
              <span className="writer__in"> <Icon name="right" size={11} /> {forum ? forum.name : targets.map((row) => row.name).join(', ')}</span>
            )}
          </strong>
          <span className="faint">
            {forum
              ? (toWall ? 'In the forum, and on your feed' : 'To everyone in this forum')
              : target
                ? `In ${targets.length === 1 ? 'the forum' : `${targets.length} forums`}, and on your feed`
                : voice.storeId ? 'Posting as your storefront · tap the photo to switch' : 'To everyone following you'}
          </span>
        </div>
        <button type="button" className="iconbtn" aria-label="Close" onClick={reset}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className={vibe ? `vibe vibe--${vibe} vibe--edit` : 'writer__textwrap'}>
        <textarea ref={text} className="writer__text" value={body} rows={vibe ? 3 : 3}
          maxLength={vibe ? VIBE_MAX_CHARS : 2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder={poll
            ? 'Ask a question…'
            : vibe
              ? 'Say it big…'
              : item
                ? `Say something about ${item.title}…`
                : forum
                  ? `Say something to ${forum.name}…`
                  : `What's new, ${first}?`} />
      </div>

      {vibe && (
        <div className="writer__vibes" role="radiogroup" aria-label="Colour">
          {VIBES.map((entry) => (
            <button key={entry} type="button" role="radio" aria-checked={vibe === entry}
              aria-label={entry} className={`writer__swatch vibe--${entry}${vibe === entry ? ' is-on' : ''}`}
              onClick={() => setVibe(entry)} />
          ))}
          <span className={`faint writer__left${left < 20 ? ' is-low' : ''}`}>{left}</span>
        </div>
      )}

      {photos.length > 0 && (
        <div className="writer__photos">
          {photos.map((photo, index) => (
            <div key={photo.key} className={`writer__photo${photo.failed ? ' is-failed' : ''}`}>
              <img src={photo.preview} alt={`Attached photo ${index + 1}`} />
              {!photo.url && !photo.failed && <span className="writer__spin" aria-label="Uploading" />}
              {photo.failed && <span className="writer__failed">Failed</span>}
              <button type="button" className="writer__unphoto" aria-label="Remove photo"
                onClick={() => {
                  URL.revokeObjectURL(photo.preview);
                  setPhotos((list) => list.filter((entry) => entry.key !== photo.key));
                }}>
                <Icon name="close" size={12} />
              </button>
            </div>
          ))}
          {photos.length < POST_MAX_PHOTOS && (
            <button type="button" className="writer__addphoto" onClick={() => picker.current?.click()}
              aria-label="Add more photos">
              <Icon name="plus" size={20} />
            </button>
          )}
        </div>
      )}

      {picking && !item && (
        <div className="stockpick" role="listbox" aria-label="Pick an item to post">
          {!stock ? (
            <p className="faint">Loading your items…</p>
          ) : stock.length === 0 ? (
            <p className="faint">Nothing listed yet. List something from Sell and post it here.</p>
          ) : (
            stock.map((entry) => (
              <button key={entry.id} type="button" role="option" aria-selected={false} className="stockpick__item"
                onClick={() => {
                  setItem(entry);
                  setPicking(false);
                  setPoll(null);
                }}>
                {entry.photoUrl ? (
                  <img src={entry.photoUrl} alt="" className="stockpick__img" />
                ) : (
                  <Thumb seed={entry.id} label={entry.title} className="stockpick__img" />
                )}
                <span className="stockpick__name">{entry.title}</span>
                <span className="stockpick__price">{formatMoney(entry.priceMinor, entry.currency)}</span>
              </button>
            ))
          )}
        </div>
      )}

      {item && (
        <div className="writer__item">
          {item.photoUrl ? (
            <img src={item.photoUrl} alt="" className="writer__itemimg" />
          ) : (
            <Thumb seed={item.id} label={item.title} className="writer__itemimg" />
          )}
          <span className="writer__itembody">
            <span className="spost__itemtag">For sale</span>
            <strong>{item.title}</strong>
            <span className="spost__price">{formatMoney(item.priceMinor, item.currency)}</span>
          </span>
          <button type="button" className="iconbtn" aria-label="Remove item" onClick={() => setItem(null)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {choosingForum && (
        <div className="forumpick" role="listbox" aria-multiselectable="true" aria-label="Share into forums">
          <p className="forumpick__head">
            <span>Share into forums</span>
            <span className="faint">{targets.length}/{MAX_FORUMS} · also on your feed</span>
          </p>
          <div className="forumpick__list">
            {!joined ? (
              <p className="faint">Loading your forums…</p>
            ) : joined.length === 0 ? (
              <p className="faint">You have not joined a forum yet. Join one from Forums and post into it from here.</p>
            ) : (
              joined.map((row) => {
                const on = targets.some((entry) => entry.id === row.id);
                const full = !on && targets.length >= MAX_FORUMS;
                return (
                  <button key={row.id} type="button" role="option" aria-selected={on} disabled={full}
                    className={`forumpick__item${on ? ' is-on' : ''}`}
                    onClick={() => setTargets((all) => (on ? all.filter((entry) => entry.id !== row.id) : [...all, row]))}>
                    <span className="forumav forumav--sm" aria-hidden="true"><Icon name="forum" size={15} /></span>
                    <span className="forumpick__name">{row.name}</span>
                    <span className="forumpick__tick" aria-hidden="true">{on && <Icon name="check" size={12} />}</span>
                  </button>
                );
              })
            )}
          </div>
          <button type="button" className="btn btn--quiet btn--sm forumpick__done" onClick={() => setChoosingForum(false)}>Done</button>
        </div>
      )}

      {target && !choosingForum && (
        <div className="writer__target">
          <Icon name="forum" size={15} />
          <span>In <strong>{targets.map((row) => row.name).join(', ')}</strong> · also on your feed</span>
          <button type="button" className="iconbtn iconbtn--sm" aria-label="Post to your feed only"
            onClick={() => setTargets([])}>
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {forum && (
        <label className="writer__wall">
          <input type="checkbox" checked={toWall} onChange={(event) => setToWall(event.target.checked)} />
          <span className="writer__switch" aria-hidden="true" />
          <span>Also share on my feed <span className="faint">· shows as {voice.name} <Icon name="right" size={10} /> {forum.name}</span></span>
        </label>
      )}

      {poll && (
        <div className="writer__poll">
          {poll.map((option, index) => (
            <div key={index} className="writer__pollrow">
              <input value={option} maxLength={POLL_OPTION_MAX_CHARS}
                placeholder={`Option ${index + 1}`}
                onChange={(e) => setPoll(poll.map((entry, at) => (at === index ? e.target.value : entry)))} />
              {poll.length > POLL_MIN_OPTIONS && (
                <button type="button" className="iconbtn iconbtn--sm" aria-label={`Remove option ${index + 1}`}
                  onClick={() => setPoll(poll.filter((_, at) => at !== index))}>
                  <Icon name="close" size={12} />
                </button>
              )}
            </div>
          ))}
          <div className="writer__pollfoot">
            {poll.length < POLL_MAX_OPTIONS && (
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPoll([...poll, ''])}>
                <Icon name="plus" size={12} /> Add option
              </button>
            )}
            <label className="writer__pollfor">
              <span className="faint">Runs for</span>
              <select value={pollHours} onChange={(e) => setPollHours(Number(e.target.value))}>
                {POLL_LENGTHS.map((entry) => (
                  <option key={entry.hours} value={entry.hours}>{entry.label}</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      )}

      <input ref={picker} type="file" accept="image/*" multiple hidden
        onChange={(e) => {
          void addFiles(e.target.files);
          e.target.value = '';
        }} />

      {error && <p className="notice notice--error" onClick={() => setError(null)}>{error}</p>}

      <div className="writer__foot">
        {tools}
        <button type="submit" className="btn writer__post" disabled={!canPost}>
          {busy ? 'Posting…' : uploading ? 'Uploading…' : 'Post'} <Icon name="send" size={14} />
        </button>
      </div>
    </form>
  );
}
