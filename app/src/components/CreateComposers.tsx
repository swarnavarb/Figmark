import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Post } from '@shared/models';
import {
  FLEX_MAX_HOTSPOTS, HOTSPOT_LABELS, HOTSPOT_LABEL_MAX_CHARS, HOTSPOT_STATUSES, POLL_OPTION_MAX_CHARS,
  type HotspotStatus, type PostHotspot,
} from '@shared/social';
import { ApiRequestError, api, type FeedListing } from '../api';
import { formatMoney } from '../format';
import { shrink } from './PhotoManager';
import { ErrorNotice, Modal, Thumb, leadPhoto } from './ui';
import { Icon } from './Icon';
import '../styles/CreateComposers.css';

/**
 * The two kinds of post the + makes on the spot: a collection flex, and an
 * A-versus-B debate. Each is an ordinary post underneath - photos, words, a
 * poll - with the one thing that makes it what it is laid over the top.
 */

type Posted = (post: Pick<Post, 'channelId' | 'id'>) => void;

/** A Figmark item picked to point at, as much of it as a chip needs. */
interface Picked {
  id: string;
  title: string;
}

/**
 * Photos uploaded for a post that has not been made yet.
 *
 * Whatever is still here when the composer closes without posting is thrown
 * away, so a change of mind does not leave orphans in the photo store.
 */
function useDraftPhotos() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const kept = useRef(false);
  const live = useRef<string[]>([]);
  live.current = photos;

  useEffect(() => () => {
    if (!kept.current) for (const url of live.current) void api.discardPhoto(url);
  }, []);

  async function upload(file: File): Promise<string> {
    setUploading(true);
    try {
      return (await api.uploadPhoto(await shrink(file))).url;
    } finally {
      setUploading(false);
    }
  }

  return {
    photos,
    setPhotos,
    uploading,
    upload,
    /** Called once the post is made: its photos are its own now. */
    keep: () => { kept.current = true; },
    discard: (url: string) => void api.discardPhoto(url),
  };
}

/**
 * Point at an item on Figmark: search, tap, done.
 *
 * Anybody's item, not only your own - a debate is usually about two things
 * somebody else sells, and a wishlist tag is by definition something you do
 * not have.
 */
function ItemPicker({ value, onChange, label = 'Link a Figmark item' }: {
  value: Picked | null;
  onChange: (item: Picked | null) => void;
  label?: string;
}) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<FeedListing[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = window.setTimeout(() => {
      api.feed({ q: term, sort: 'popular' })
        .then((result) => live && setFound(result.listings.slice(0, 5)))
        .catch(() => live && setFound([]))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [q]);

  if (value) {
    return (
      <div className="itempick itempick--set">
        <Icon name="tag" size={13} />
        <span className="itempick__name">{value.title}</span>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange(null)}>Change</button>
      </div>
    );
  }

  return (
    <div className="itempick">
      <label className="field">
        <span>{label} <span className="faint">(optional)</span></span>
        <input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search the catalogue" />
      </label>
      {busy && <span className="faint itempick__note">Searching…</span>}
      {!busy && found?.length === 0 && <span className="faint itempick__note">Nothing listed by that name.</span>}
      {found && found.length > 0 && (
        <ul className="itempick__list">
          {found.map((listing) => (
            <li key={listing.id}>
              <button type="button" className="itempick__row" onClick={() => {
                onChange({ id: listing.id, title: listing.title });
                setQ('');
              }}>
                <Thumb seed={listing.id} label={listing.title} photo={leadPhoto(listing)} className="thumb itempick__photo" />
                <span className="itempick__name">{listing.title}</span>
                <span className="faint">{formatMoney(listing.priceMinor, listing.currency)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ── Collection flex ───────────────────────────────────────────────────── */

/** The most photos one flex can carry; each can hold its own tags. */
const FLEX_MAX_PHOTOS = 4;

/**
 * A shelf photo, and its pieces tagged.
 *
 * Tap the photo where a piece stands, name it, say whether it is in the
 * collection, on the wishlist or for sale, and optionally point it at the item
 * on Figmark. The dots are kept as fractions of the photo, so they stay on
 * their pieces at any size the post is drawn.
 */
export function FlexComposer({ onClose, onPosted }: { onClose: () => void; onPosted: Posted }) {
  const draft = useDraftPhotos();
  const { photos } = draft;
  const [at, setAt] = useState(0);
  const [spots, setSpots] = useState<PostHotspot[]>([]);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<HotspotStatus>('owned');
  const [item, setItem] = useState<Picked | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useRef<HTMLInputElement | null>(null);

  async function add(list: FileList | null) {
    const picked = Array.from(list ?? []).slice(0, FLEX_MAX_PHOTOS - photos.length);
    setError(null);
    let next = photos.length;
    try {
      for (const file of picked) {
        const url = await draft.upload(file);
        draft.setPhotos((all) => [...all, url]);
        // The photo just added is the one to tag next.
        setAt(next++);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not upload that photo.');
    }
  }

  function removePhoto(index: number) {
    draft.discard(photos[index]!);
    draft.setPhotos((all) => all.filter((_, i) => i !== index));
    // Tags on later photos move down with them; tags on this one go.
    setSpots((all) => all.filter((spot) => spot.photo !== index)
      .map((spot) => (spot.photo > index ? { ...spot, photo: spot.photo - 1 } : spot)));
    setAt((current) => Math.max(0, Math.min(current, photos.length - 2)));
    setPending(null);
  }

  function place(event: PointerEvent<HTMLDivElement>) {
    if (spots.length >= FLEX_MAX_HOTSPOTS) {
      setError(`Up to ${FLEX_MAX_HOTSPOTS} tags on one flex.`);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    setPending({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height });
    setLabel('');
    setStatus('owned');
    setItem(null);
  }

  function saveSpot() {
    if (!pending || !label.trim()) return;
    setSpots((all) => [...all, { photo: at, x: pending.x, y: pending.y, label: label.trim(), status, listingId: item?.id ?? null }]);
    setPending(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const { post } = await api.createPost({ body: caption.trim(), photoUrls: photos, flex: { hotspots: spots } });
      draft.keep();
      onPosted(post);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
      setBusy(false);
    }
  }

  const here = spots.map((spot, index) => ({ spot, index })).filter(({ spot }) => spot.photo === at);

  return (
    <Modal title="📸 Share a collection flex" onClose={onClose}>
      {photos.length === 0 ? (
        <button type="button" className="flexup" disabled={draft.uploading} onClick={() => files.current?.click()}>
          <Icon name="camera" size={26} />
          <strong>{draft.uploading ? 'Uploading…' : 'Add a photo of your shelf'}</strong>
          <span className="faint">Then tap each piece to tag it.</span>
        </button>
      ) : (
        <>
          <div className="flexedit" onPointerUp={place} role="button" tabIndex={-1}
            aria-label="Tap where a piece is to tag it">
            <img loading="lazy" decoding="async" src={photos[at]} alt="Your collection" draggable={false} />
            {here.map(({ spot, index }) => (
              <span key={index} className={`hotdot hotdot--${spot.status}`}
                style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} aria-hidden="true">
                {index + 1}
              </span>
            ))}
            {pending && (
              <span className="hotdot hotdot--pending" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }}
                aria-hidden="true">+</span>
            )}
          </div>
          <div className="flexstrip">
            {photos.map((url, index) => (
              <span key={url} className={`flexstrip__tile${index === at ? ' is-on' : ''}`}>
                <button type="button" className="flexstrip__pick" aria-label={`Photo ${index + 1}`}
                  onClick={() => { setAt(index); setPending(null); }}>
                  <img loading="lazy" decoding="async" src={url} alt="" />
                </button>
                <button type="button" className="flexstrip__remove" aria-label="Remove photo" onClick={() => removePhoto(index)}>
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
            {photos.length < FLEX_MAX_PHOTOS && (
              <button type="button" className="flexstrip__add" disabled={draft.uploading}
                onClick={() => files.current?.click()} aria-label="Add another photo">
                {draft.uploading ? '…' : <Icon name="plus" size={16} />}
              </button>
            )}
          </div>
          {!pending && <p className="faint flexhint">Tap a piece in the photo to tag it.</p>}
        </>
      )}
      <input ref={files} type="file" accept="image/*" multiple hidden
        onChange={(event) => { void add(event.target.files); event.target.value = ''; }} />

      {pending && (
        <div className="hotform">
          <label className="field">
            <span>What is it?</span>
            <input autoFocus value={label} maxLength={HOTSPOT_LABEL_MAX_CHARS}
              onChange={(event) => setLabel(event.target.value)} placeholder="Nendoroid Frieren #2367" />
          </label>
          <div className="hotform__status" role="radiogroup" aria-label="This piece is">
            {HOTSPOT_STATUSES.map((entry) => (
              <button key={entry} type="button" role="radio" aria-checked={status === entry}
                className={`hotchip hotchip--${entry}${status === entry ? ' is-on' : ''}`} onClick={() => setStatus(entry)}>
                {HOTSPOT_LABELS[entry]}
              </button>
            ))}
          </div>
          <ItemPicker value={item} onChange={setItem} />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPending(null)}>Cancel</button>
            <button type="button" className="btn btn--sm" disabled={!label.trim()} onClick={saveSpot}>Tag it</button>
          </div>
        </div>
      )}

      {spots.length > 0 && (
        <ol className="hotlist">
          {spots.map((spot, index) => (
            <li key={index} className="hotlist__row">
              <span className={`hotdot hotdot--${spot.status}`} aria-hidden="true">{index + 1}</span>
              <span className="hotlist__name">{spot.label}</span>
              <span className={`hotchip hotchip--${spot.status} is-on`}>{HOTSPOT_LABELS[spot.status]}</span>
              <button type="button" className="iconbtn" aria-label={`Remove the tag on ${spot.label}`}
                onClick={() => setSpots((all) => all.filter((_, i) => i !== index))}>
                <Icon name="close" size={13} />
              </button>
            </li>
          ))}
        </ol>
      )}

      <label className="field">
        <span>Say something <span className="faint">(optional)</span></span>
        <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={2}
          placeholder="The grail shelf is finally complete." />
      </label>

      {error && <ErrorNotice message={error} />}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy || draft.uploading || photos.length === 0}
          onClick={() => void submit()}>
          {busy ? 'Posting…' : spots.length > 0 ? `Post flex · ${spots.length} tagged` : 'Post flex'}
        </button>
      </div>
    </Modal>
  );
}

/* ── Debate ────────────────────────────────────────────────────────────── */

interface Side {
  photo: string | null;
  label: string;
  item: Picked | null;
}

const EMPTY_SIDE: Side = { photo: null, label: '', item: null };

const CLOSES: { hours: number; label: string }[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 0, label: 'Never' },
];

/**
 * Two pieces side by side and one question.
 *
 * A poll with two answers and a photo for each, which is what a collector's
 * argument usually is: this paint job or that one, the original or the
 * reissue. Each side may point at the item on Figmark, so the people who
 * voted can go and buy their side.
 */
export function DebateComposer({ onClose, onPosted }: { onClose: () => void; onPosted: Posted }) {
  const draft = useDraftPhotos();
  const [question, setQuestion] = useState('');
  const [sides, setSides] = useState<[Side, Side]>([EMPTY_SIDE, EMPTY_SIDE]);
  const [closes, setCloses] = useState(72);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = [useRef<HTMLInputElement | null>(null), useRef<HTMLInputElement | null>(null)];

  const setSide = (index: 0 | 1, change: Partial<Side>) =>
    setSides((all) => (index === 0 ? [{ ...all[0], ...change }, all[1]] : [all[0], { ...all[1], ...change }]));

  async function upload(index: 0 | 1, file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const url = await draft.upload(file);
      const old = sides[index].photo;
      if (old) draft.discard(old);
      draft.setPhotos((all) => [...all.filter((entry) => entry !== old), url]);
      setSide(index, { photo: url });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not upload that photo.');
    }
  }

  const [a, b] = sides;
  const ready = question.trim().length > 0 && a.photo && b.photo && a.label.trim() && b.label.trim()
    && a.label.trim().toLowerCase() !== b.label.trim().toLowerCase();

  async function submit() {
    if (!a.photo || !b.photo) return;
    setBusy(true);
    setError(null);
    try {
      const { post } = await api.createPost({
        body: question.trim(),
        photoUrls: [a.photo, b.photo],
        poll: { options: [a.label.trim(), b.label.trim()], closesInHours: closes || undefined },
        debate: { listingIds: [a.item?.id ?? null, b.item?.id ?? null] },
      });
      draft.keep();
      onPosted(post);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
      setBusy(false);
    }
  }

  return (
    <Modal title="⚔️ Start a debate" onClose={onClose}>
      <label className="field">
        <span>The question</span>
        <input value={question} onChange={(event) => setQuestion(event.target.value)}
          placeholder="Which paint job is cleaner?" maxLength={200} />
      </label>

      <div className="debedit">
        {([0, 1] as const).map((index) => {
          const side = sides[index];
          return (
            <div key={index} className={`debedit__side debedit__side--${index === 0 ? 'a' : 'b'}`}>
              <span className="debedit__tag">{index === 0 ? 'A' : 'B'}</span>
              <button type="button" className="debedit__photo" disabled={draft.uploading}
                onClick={() => inputs[index]!.current?.click()}
                aria-label={side.photo ? `Change photo ${index === 0 ? 'A' : 'B'}` : `Add photo ${index === 0 ? 'A' : 'B'}`}>
                {side.photo ? <img loading="lazy" decoding="async" src={side.photo} alt="" /> : (
                  <span className="debedit__empty"><Icon name="image" size={22} />{draft.uploading ? 'Uploading…' : 'Add photo'}</span>
                )}
              </button>
              <input ref={inputs[index]} type="file" accept="image/*" hidden
                onChange={(event) => { void upload(index, event.target.files?.[0]); event.target.value = ''; }} />
              <label className="field">
                <span>Side {index === 0 ? 'A' : 'B'}</span>
                <input value={side.label} maxLength={POLL_OPTION_MAX_CHARS}
                  onChange={(event) => setSide(index, { label: event.target.value })}
                  placeholder={index === 0 ? 'Original 2019 run' : '2024 reissue'} />
              </label>
              <ItemPicker value={side.item} onChange={(item) => setSide(index, { item })} label="Linked item" />
            </div>
          );
        })}
      </div>

      <div className="field">
        <span>Voting closes</span>
        <div className="chips chips--tight">
          {CLOSES.map((entry) => (
            <button key={entry.hours} type="button" className={`chip${closes === entry.hours ? ' is-on' : ''}`}
              aria-pressed={closes === entry.hours} onClick={() => setCloses(entry.hours)}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorNotice message={error} />}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12, gap: 8 }}>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy || draft.uploading || !ready} onClick={() => void submit()}>
          {busy ? 'Posting…' : 'Start the debate'}
        </button>
      </div>
    </Modal>
  );
}
