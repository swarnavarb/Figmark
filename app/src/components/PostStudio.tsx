import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import type { Post } from '@shared/models';
import {
  FLEX_MAX_HOTSPOTS, HOTSPOT_LABELS, HOTSPOT_LABEL_MAX_CHARS, HOTSPOT_STATUSES, POLL_MAX_OPTIONS, POLL_MIN_OPTIONS,
  POLL_OPTION_MAX_CHARS,
  type HotspotStatus, type PollStyle, type PostHotspot,
} from '@shared/social';
import {
  CONTEST_MAX_PRIZES, CONTEST_RULES_MAX, CONTEST_TITLE_MAX, JUDGING_LABELS, PLACE_MEDALS, PRIZE_MAX_MINOR, PRIZE_NOTE_MAX,
  type ContestJudging,
} from '@shared/play';
import { ApiRequestError, api, type FeedListing, type NewPost } from '../api';
import { formatMoney } from '../format';
import { shrink } from './PhotoManager';
import { ErrorNotice, Modal, Thumb, leadPhoto } from './ui';
import { Icon } from './Icon';
import '../styles/PostStudio.css';

/**
 * Every kind of post the + makes, in one form.
 *
 * A photo post (with its pieces tagged, which is a flex), a poll in any of its
 * four faces, a debate, a guess-the-price and a photo competition are all one
 * post underneath - words, photos, a poll - so they are one form with a mode
 * switch, not five forms that drift apart. What a shop can add - a prize, a
 * reward for voters, a stock poll, a competition - appears only when the post
 * is said as the shop, because the credit it promises is spent there.
 */

type Posted = (post: Pick<Post, 'channelId' | 'id'>) => void;

export type StudioMode = 'photo' | 'poll' | 'debate' | 'guess' | 'contest';

const MODES: { id: StudioMode; emoji: string; label: string }[] = [
  { id: 'photo', emoji: '📸', label: 'Photo' },
  { id: 'poll', emoji: '📊', label: 'Poll' },
  { id: 'debate', emoji: '⚔️', label: 'Debate' },
  { id: 'guess', emoji: '🎯', label: 'Guess' },
  { id: 'contest', emoji: '🏆', label: 'Competition' },
];

const STYLES: { id: PollStyle; label: string; line: string }[] = [
  { id: 'text', label: 'Text', line: 'Answers as bars' },
  { id: 'photo', label: 'Photos', line: 'A picture per answer' },
  { id: 'versus', label: 'Versus', line: 'Two sides, head to head' },
  { id: 'rating', label: 'Rating', line: 'One photo, out of five' },
];

const CLOSES: { hours: number; label: string }[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 0, label: 'No end' },
];
const PHASES: { hours: number; label: string }[] = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 168, label: '1 week' },
  { hours: 336, label: '2 weeks' },
];

/** A Figmark item picked to point at, as much of it as a chip needs. */
interface Picked {
  id: string;
  title: string;
}

interface Answer {
  label: string;
  photo: string | null;
  item: Picked | null;
}

const blank = (): Answer => ({ label: '', photo: null, item: null });

/** Rupees typed, as paise; null when it is not a sensible amount. */
function paise(text: string): number | null {
  const value = Number(text.replace(/[,\s₹]/g, ''));
  if (!text.trim() || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

/**
 * Photos uploaded for a post that has not been made yet.
 *
 * Whatever is still here when the studio closes without posting is thrown
 * away, so a change of mind does not leave orphans in the photo store.
 */
function useDraftPhotos() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const kept = useRef(false);
  const all = useRef(new Set<string>());

  useEffect(() => () => {
    if (!kept.current) for (const url of all.current) void api.discardPhoto(url);
  }, []);

  async function upload(file: File): Promise<string> {
    setUploading(true);
    try {
      const { url } = await api.uploadPhoto(await shrink(file));
      all.current.add(url);
      return url;
    } finally {
      setUploading(false);
    }
  }

  return {
    photos,
    setPhotos,
    uploading,
    upload,
    /** Called once the post is made: the photos it carries are its own now; the rest go. */
    keep: (used: string[]) => {
      kept.current = true;
      for (const url of all.current) if (!used.includes(url)) void api.discardPhoto(url);
    },
    discard: (url: string) => {
      all.current.delete(url);
      void api.discardPhoto(url);
    },
  };
}

/**
 * Point at an item on Figmark: search, tap, done. Anybody's item - a debate
 * is usually about two things somebody else sells.
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

/** A row of choices, one on. */
function Choice<T extends string | number>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <div className="chips chips--tight" role="radiogroup" aria-label={label}>
        {options.map((entry) => (
          <button key={String(entry.id)} type="button" role="radio" aria-checked={value === entry.id}
            className={`chip${value === entry.id ? ' is-on' : ''}`} onClick={() => onChange(entry.id)}>
            {entry.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A switch with a line under it, and what it opens when on. */
function Toggle({ on, onChange, title, line, children }: {
  on: boolean;
  onChange: (on: boolean) => void;
  title: string;
  line: string;
  children?: ReactNode;
}) {
  return (
    <div className={`pstudio__toggle${on ? ' is-on' : ''}`}>
      <label className="pstudio__toggleline">
        <input type="checkbox" checked={on} onChange={(event) => onChange(event.target.checked)} />
        <span className="pstudio__switch" aria-hidden="true" />
        <span className="pstudio__togglecopy">
          <strong>{title}</strong>
          <span>{line}</span>
        </span>
      </label>
      {on && children && <div className="pstudio__toggleopen">{children}</div>}
    </div>
  );
}

/** A rupee amount field. */
function Rupees({ label, value, onChange, placeholder = '500' }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <span className="pstudio__moneybox">
        <span aria-hidden="true">₹</span>
        <input inputMode="decimal" value={value} placeholder={placeholder}
          onChange={(event) => onChange(event.target.value.replace(/[^\d.]/g, ''))} />
      </span>
    </label>
  );
}

export function PostStudio({
  mode: start, storeId = null, storeName = null, forumId = null, figmark = false, presets = {}, onClose, onPosted,
}: {
  mode: StudioMode;
  /** Switches already on, for the shortcuts that name them: "What should we stock next?", "Debate with a prize". */
  presets?: { stock?: boolean; prize?: boolean };
  /** Said as this shop; null for the person. */
  storeId?: string | null;
  storeName?: string | null;
  /** Posting into a forum: people only, no prizes. */
  forumId?: string | null;
  /** Figmark's weekly theme challenge: a competition with no credit. */
  figmark?: boolean;
  onClose: () => void;
  onPosted: Posted;
}) {
  const asShop = Boolean(storeId) && !forumId;
  const [mode, setMode] = useState<StudioMode>(figmark ? 'contest' : start === 'contest' && !asShop ? 'photo' : start);
  const draft = useDraftPhotos();
  const { photos } = draft;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useRef<HTMLInputElement | null>(null);

  // Photo / flex
  const [at, setAt] = useState(0);
  const [spots, setSpots] = useState<PostHotspot[]>([]);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [spotLabel, setSpotLabel] = useState('');
  const [spotStatus, setSpotStatus] = useState<HotspotStatus>('owned');
  const [spotItem, setSpotItem] = useState<Picked | null>(null);

  // Polls and debates
  const [style, setStyle] = useState<PollStyle>(start === 'debate' ? 'versus' : 'text');
  const [answers, setAnswers] = useState<Answer[]>([blank(), blank()]);
  const [closes, setCloses] = useState(72);
  const [stock, setStock] = useState(Boolean(presets.stock));
  const [rewardOn, setRewardOn] = useState(false);
  const [reward, setReward] = useState('50');
  const [rewardCap, setRewardCap] = useState('50');
  const [prizeOn, setPrizeOn] = useState(Boolean(presets.prize));
  const [prize, setPrize] = useState('500');
  const [judge, setJudge] = useState<'likes' | 'store'>('likes');
  const answerFiles = useRef<HTMLInputElement | null>(null);
  const [answerAt, setAnswerAt] = useState(0);

  // Guess
  const [answerPrice, setAnswerPrice] = useState('');
  const [reveal, setReveal] = useState(72);
  const [guessItem, setGuessItem] = useState<Picked | null>(null);

  // Competition
  const [title, setTitle] = useState('');
  const [entriesHours, setEntriesHours] = useState(168);
  const [votingHours, setVotingHours] = useState(72);
  const [judging, setJudging] = useState<ContestJudging>('audience');
  const [prizes, setPrizes] = useState<{ amount: string; note: string }[]>([{ amount: '', note: '' }]);

  const voting = mode === 'poll' || mode === 'debate';
  const faceOf: PollStyle = mode === 'debate' ? 'versus' : style;

  function switchMode(next: StudioMode) {
    setMode(next);
    setError(null);
    setPending(null);
    if (next === 'debate') setAnswers((all) => [all[0] ?? blank(), all[1] ?? blank()]);
  }

  function chooseStyle(next: PollStyle) {
    setStyle(next);
    if (next === 'versus') setAnswers((all) => [all[0] ?? blank(), all[1] ?? blank()]);
  }

  async function addPhotos(list: FileList | null, max: number) {
    const picked = Array.from(list ?? []).slice(0, Math.max(0, max - photos.length));
    setError(null);
    let next = photos.length;
    try {
      for (const file of picked) {
        const url = await draft.upload(file);
        draft.setPhotos((all) => [...all, url]);
        setAt(next++);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not upload that photo.');
    }
  }

  function removePhoto(index: number) {
    draft.discard(photos[index]!);
    draft.setPhotos((all) => all.filter((_, i) => i !== index));
    setSpots((all) => all.filter((spot) => spot.photo !== index)
      .map((spot) => (spot.photo > index ? { ...spot, photo: spot.photo - 1 } : spot)));
    setAt((current) => Math.max(0, Math.min(current, photos.length - 2)));
    setPending(null);
  }

  async function answerPhoto(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const url = await draft.upload(file);
      setAnswers((all) => all.map((entry, index) => {
        if (index !== answerAt) return entry;
        if (entry.photo) draft.discard(entry.photo);
        return { ...entry, photo: url };
      }));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not upload that photo.');
    }
  }

  const setAnswer = (index: number, change: Partial<Answer>) =>
    setAnswers((all) => all.map((entry, at) => (at === index ? { ...entry, ...change } : entry)));

  function place(event: PointerEvent<HTMLDivElement>) {
    if (spots.length >= FLEX_MAX_HOTSPOTS) {
      setError(`Up to ${FLEX_MAX_HOTSPOTS} tags on one post.`);
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    setPending({ x: (event.clientX - box.left) / box.width, y: (event.clientY - box.top) / box.height });
    setSpotLabel('');
    setSpotStatus('owned');
    setSpotItem(null);
  }

  function saveSpot() {
    if (!pending || !spotLabel.trim()) return;
    setSpots((all) => [...all, { photo: at, x: pending.x, y: pending.y, label: spotLabel.trim(), status: spotStatus, listingId: spotItem?.id ?? null }]);
    setPending(null);
  }

  /** What is still missing, in a few words, or null when it can go. */
  function missing(): string | null {
    const words = text.trim();
    if (mode === 'photo') return photos.length === 0 && words.length < 2 ? 'Add a photo or say something' : null;
    if (voting) {
      if (words.length < 2) return 'Ask the question';
      if (faceOf === 'rating') return photos.length === 0 ? 'Add the photo to rate' : null;
      const filled = answers.filter((entry) => entry.label.trim());
      if (filled.length < answers.length) return 'Name every answer';
      if ((faceOf === 'photo' || faceOf === 'versus') && answers.some((entry) => !entry.photo)) return 'Add a photo to every answer';
      if (new Set(filled.map((entry) => entry.label.trim().toLowerCase())).size !== filled.length) return 'Two answers say the same thing';
      if (asShop && rewardOn && (!paise(reward) || !closes)) return closes ? 'Set the reward' : 'A rewarded poll needs an end';
      if (asShop && mode === 'debate' && prizeOn && !paise(prize)) return 'Set the prize';
      return null;
    }
    if (mode === 'guess') {
      if (words.length < 2) return 'Say what it is';
      return (paise(answerPrice) ?? 0) < 100 ? 'Set the real price' : null;
    }
    if (!title.trim()) return 'Name the competition';
    return words.length < 2 ? 'Say what to enter' : null;
  }

  async function submit() {
    const blocked = missing();
    if (blocked) {
      setError(blocked);
      return;
    }
    setBusy(true);
    setError(null);
    const words = text.trim();
    const base: NewPost = {
      body: words,
      ...(storeId ? { storeId } : {}),
      ...(forumId ? { forumId } : {}),
    };
    let body: NewPost;
    if (mode === 'photo') {
      body = { ...base, photoUrls: photos, ...(spots.length ? { flex: { hotspots: spots } } : {}) };
    } else if (voting) {
      const options = faceOf === 'rating' ? ['1', '2', '3', '4', '5']
        : answers.map((entry) => ({ label: entry.label.trim(), photoUrl: entry.photo, listingId: entry.item?.id ?? null }));
      body = {
        ...base,
        ...(faceOf === 'rating' ? { photoUrls: photos.slice(0, 1) } : {}),
        poll: {
          options,
          style: faceOf,
          closesInHours: closes || undefined,
          ...(asShop && stock && mode === 'poll' ? { stock: true } : {}),
          ...(asShop && rewardOn ? { reward: { amountMinor: paise(reward)!, maxVoters: Math.max(1, Math.round(Number(rewardCap) || 1)) } } : {}),
        },
        ...(mode === 'debate'
          ? { debate: { ...(asShop && prizeOn ? { prize: { amountMinor: paise(prize)!, judge } } : {}) } }
          : {}),
      };
    } else if (mode === 'guess') {
      body = { ...base, photoUrls: photos, guess: { answerMinor: paise(answerPrice)!, revealInHours: reveal, listingId: guessItem?.id ?? null } };
    } else {
      body = {
        ...base,
        photoUrls: photos.slice(0, 1),
        contest: {
          title: title.trim(),
          rules: words,
          entriesHours,
          votingHours,
          judging: figmark ? 'audience' : judging,
          prizes: prizes.map((entry) => ({ amountMinor: figmark ? 0 : paise(entry.amount) ?? 0, note: entry.note.trim() })),
          ...(figmark ? { host: 'figmark' as const } : {}),
        },
      };
    }
    try {
      const { post } = await api.createPost(body);
      draft.keep([...(body.photoUrls ?? []), ...answers.map((entry) => entry.photo).filter((url): url is string => Boolean(url))]);
      onPosted(post);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
      setBusy(false);
    }
  }

  const here = spots.map((spot, index) => ({ spot, index })).filter(({ spot }) => spot.photo === at);
  const maxPhotos = mode === 'photo' ? 4 : mode === 'guess' ? 4 : 1;
  const needsPostPhotos = mode === 'photo' || mode === 'guess' || mode === 'contest' || (voting && faceOf === 'rating');
  const modes = figmark ? MODES.filter((entry) => entry.id === 'contest')
    : MODES.filter((entry) => entry.id !== 'contest' || asShop);
  const heading = figmark ? '🌟 Weekly theme challenge'
    : asShop ? `Post as ${storeName ?? 'your store'}` : 'Create a post';
  const blocked = missing();

  const photoStrip = (
    <>
      {photos.length === 0 ? (
        <button type="button" className="flexup" disabled={draft.uploading} onClick={() => files.current?.click()}>
          <Icon name="camera" size={26} />
          <strong>{draft.uploading ? 'Uploading…' : mode === 'photo' ? 'Add photos' : mode === 'contest' ? 'Add a cover photo' : 'Add the photo'}</strong>
          <span className="faint">
            {mode === 'photo' ? 'Tap a piece in a photo to tag it — that makes it a collection flex.'
              : mode === 'contest' ? 'Optional. A good example of what you want to see.'
                : mode === 'guess' ? 'What people are pricing.' : 'Everybody rates this one.'}
          </span>
        </button>
      ) : (
        <>
          {mode === 'photo' ? (
            <div className="flexedit" onPointerUp={place} role="button" tabIndex={-1} aria-label="Tap where a piece is to tag it">
              <img loading="lazy" decoding="async" src={photos[at]} alt="Your photo" draggable={false} />
              {here.map(({ spot, index }) => (
                <span key={index} className={`hotdot hotdot--${spot.status}`}
                  style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }} aria-hidden="true">{index + 1}</span>
              ))}
              {pending && (
                <span className="hotdot hotdot--pending" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }} aria-hidden="true">+</span>
              )}
            </div>
          ) : (
            <div className="pstudio__cover"><img src={photos[at]} alt="" /></div>
          )}
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
            {photos.length < maxPhotos && (
              <button type="button" className="flexstrip__add" disabled={draft.uploading}
                onClick={() => files.current?.click()} aria-label="Add another photo">
                {draft.uploading ? '…' : <Icon name="plus" size={16} />}
              </button>
            )}
          </div>
          {mode === 'photo' && !pending && <p className="faint flexhint">Tap a piece in the photo to tag it.</p>}
        </>
      )}
    </>
  );

  return (
    <Modal title={heading} onClose={onClose} layout="panel">
      <div className="pstudio">
        {modes.length > 1 && (
          <div className="pstudio__modes" role="tablist" aria-label="Kind of post">
            {modes.map((entry) => (
              <button key={entry.id} type="button" role="tab" aria-selected={mode === entry.id}
                className={`pstudio__mode${mode === entry.id ? ' is-on' : ''}`} onClick={() => switchMode(entry.id)}>
                <span aria-hidden="true">{entry.emoji}</span> {entry.label}
              </button>
            ))}
          </div>
        )}

        <div className="pstudio__body" key={mode}>
          {mode === 'contest' && (
            <label className="field">
              <span>Competition name</span>
              <input value={title} maxLength={CONTEST_TITLE_MAX} onChange={(event) => setTitle(event.target.value)}
                placeholder={figmark ? 'This week: your rarest piece' : 'Best custom paint job'} />
            </label>
          )}

          <label className="field">
            <span>
              {voting ? 'The question' : mode === 'guess' ? 'What are people guessing?' : mode === 'contest' ? 'What to enter, and the rules' : 'Say something'}
              {mode === 'photo' && <span className="faint"> (optional with a photo)</span>}
            </span>
            <textarea value={text} rows={mode === 'contest' ? 3 : 2}
              maxLength={mode === 'contest' ? CONTEST_RULES_MAX : 2000}
              onChange={(event) => setText(event.target.value)}
              placeholder={voting ? (mode === 'debate' ? 'Original or reissue: which is better?' : 'Which should I paint next?')
                : mode === 'guess' ? 'What did this 1/7 scale sell for in 2019?'
                  : mode === 'contest' ? 'One photo of a figure you painted yourself. Judged on finish and creativity.'
                    : 'The grail shelf is finally complete.'} />
          </label>

          {voting && mode === 'poll' && (
            <div className="field">
              <span>How it looks</span>
              <div className="pstudio__styles" role="radiogroup" aria-label="Poll style">
                {STYLES.map((entry) => (
                  <button key={entry.id} type="button" role="radio" aria-checked={style === entry.id}
                    className={`pstudio__style pstudio__style--${entry.id}${style === entry.id ? ' is-on' : ''}`}
                    onClick={() => chooseStyle(entry.id)}>
                    <span className="pstudio__stylemark" aria-hidden="true" />
                    <strong>{entry.label}</strong>
                    <span>{entry.line}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsPostPhotos && photoStrip}
          <input ref={files} type="file" accept="image/*" multiple={maxPhotos > 1} hidden
            onChange={(event) => { void addPhotos(event.target.files, maxPhotos); event.target.value = ''; }} />

          {mode === 'photo' && pending && (
            <div className="hotform">
              <label className="field">
                <span>What is it?</span>
                <input autoFocus value={spotLabel} maxLength={HOTSPOT_LABEL_MAX_CHARS}
                  onChange={(event) => setSpotLabel(event.target.value)} placeholder="Nendoroid Frieren #2367" />
              </label>
              <div className="hotform__status" role="radiogroup" aria-label="This piece is">
                {HOTSPOT_STATUSES.map((entry) => (
                  <button key={entry} type="button" role="radio" aria-checked={spotStatus === entry}
                    className={`hotchip hotchip--${entry}${spotStatus === entry ? ' is-on' : ''}`} onClick={() => setSpotStatus(entry)}>
                    {HOTSPOT_LABELS[entry]}
                  </button>
                ))}
              </div>
              <ItemPicker value={spotItem} onChange={setSpotItem} />
              <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setPending(null)}>Cancel</button>
                <button type="button" className="btn btn--sm" disabled={!spotLabel.trim()} onClick={saveSpot}>Tag it</button>
              </div>
            </div>
          )}

          {mode === 'photo' && spots.length > 0 && (
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

          {voting && faceOf !== 'rating' && (
            <div className={`pstudio__answers pstudio__answers--${faceOf}`}>
              {answers.map((entry, index) => (
                <div key={index} className={`pstudio__answer${faceOf === 'versus' ? ` pstudio__answer--${index === 0 ? 'a' : 'b'}` : ''}`}>
                  {(faceOf === 'photo' || faceOf === 'versus') && (
                    <button type="button" className="pstudio__answerphoto" disabled={draft.uploading}
                      onClick={() => { setAnswerAt(index); answerFiles.current?.click(); }}
                      aria-label={entry.photo ? `Change the photo for answer ${index + 1}` : `Add a photo for answer ${index + 1}`}>
                      {entry.photo ? <img src={entry.photo} alt="" /> : (
                        <span className="debedit__empty"><Icon name="image" size={20} />{draft.uploading && answerAt === index ? 'Uploading…' : 'Add photo'}</span>
                      )}
                      {faceOf === 'versus' && <span className="debedit__tag">{index === 0 ? 'A' : 'B'}</span>}
                    </button>
                  )}
                  <div className="pstudio__answerrow">
                    <input value={entry.label} maxLength={POLL_OPTION_MAX_CHARS} aria-label={`Answer ${index + 1}`}
                      placeholder={faceOf === 'versus' ? (index === 0 ? 'Side A' : 'Side B') : `Answer ${index + 1}`}
                      onChange={(event) => setAnswer(index, { label: event.target.value })} />
                    {faceOf !== 'versus' && answers.length > POLL_MIN_OPTIONS && (
                      <button type="button" className="iconbtn iconbtn--sm" aria-label={`Remove answer ${index + 1}`}
                        onClick={() => {
                          if (entry.photo) draft.discard(entry.photo);
                          setAnswers((all) => all.filter((_, at) => at !== index));
                        }}>
                        <Icon name="close" size={12} />
                      </button>
                    )}
                  </div>
                  {(faceOf === 'photo' || faceOf === 'versus') && (
                    <ItemPicker value={entry.item} onChange={(item) => setAnswer(index, { item })} label="Linked item" />
                  )}
                </div>
              ))}
              {faceOf !== 'versus' && answers.length < POLL_MAX_OPTIONS && (
                <button type="button" className="pstudio__addanswer" onClick={() => setAnswers((all) => [...all, blank()])}>
                  <Icon name="plus" size={14} /> Add an answer
                </button>
              )}
              <input ref={answerFiles} type="file" accept="image/*" hidden
                onChange={(event) => { void answerPhoto(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
          )}

          {voting && (
            <Choice label="Voting closes" value={closes} onChange={setCloses}
              options={CLOSES.filter((entry) => entry.hours > 0 || !(rewardOn && asShop)).map((entry) => ({ id: entry.hours, label: entry.label }))} />
          )}

          {mode === 'debate' && (
            <p className="pstudio__note">
              <Icon name="forum" size={14} /> Comments land on the side their writer voted for, and the most-liked argument wins a badge.
            </p>
          )}

          {voting && asShop && (
            <div className="pstudio__store">
              <p className="pstudio__storehead"><Icon name="spark" size={13} /> As {storeName ?? 'your store'}</p>
              {mode === 'debate' && (
                <Toggle on={prizeOn} onChange={setPrizeOn} title="Prize for the best argument"
                  line="Store credit at your shop. Never for picking a side — that is luck.">
                  <Rupees label="Store credit" value={prize} onChange={setPrize} />
                  <Choice label="Who decides" value={judge} onChange={setJudge}
                    options={[{ id: 'likes', label: 'Most liked' }, { id: 'store', label: 'You pick' }]} />
                </Toggle>
              )}
              {mode === 'poll' && (
                <Toggle on={stock} onChange={setStock} title="Ask what to stock next"
                  line="The results show in your Store Console, beside your insights." />
              )}
              <Toggle on={rewardOn} onChange={(on) => { setRewardOn(on); if (on && !closes) setCloses(72); }}
                title="Reward the winning voters" line="Store credit for whoever picked the winner, earliest first.">
                <div className="pstudio__pair">
                  <Rupees label="Each gets" value={reward} onChange={setReward} placeholder="50" />
                  <label className="field">
                    <span>Up to</span>
                    <input inputMode="numeric" value={rewardCap} onChange={(event) => setRewardCap(event.target.value.replace(/\D/g, ''))} />
                  </label>
                </div>
                {paise(reward) && Number(rewardCap) > 0 && (
                  <p className="faint pstudio__cost">At most {formatMoney(paise(reward)! * Number(rewardCap), 'INR')} in credit, spent at your shop.</p>
                )}
              </Toggle>
            </div>
          )}

          {mode === 'guess' && (
            <>
              <div className="pstudio__pair">
                <Rupees label="The real price (kept secret)" value={answerPrice} onChange={setAnswerPrice} placeholder="4500" />
                <Choice label="Reveal in" value={reveal} onChange={setReveal}
                  options={PHASES.slice(0, 3).map((entry) => ({ id: entry.hours, label: entry.label }))} />
              </div>
              <ItemPicker value={guessItem} onChange={setGuessItem} label="The item, if it is on Figmark" />
              <p className="pstudio__note"><Icon name="lock" size={14} /> Nobody sees the price or anybody&apos;s guesses until the reveal. Closest wins a badge.</p>
            </>
          )}

          {mode === 'contest' && (
            <>
              <Choice label="Entries open for" value={entriesHours} onChange={setEntriesHours}
                options={PHASES.map((entry) => ({ id: entry.hours, label: entry.label }))} />
              {!figmark && (
                <div className="field">
                  <span>Who picks the winners</span>
                  <div className="pstudio__judging" role="radiogroup" aria-label="Who picks the winners">
                    {(['audience', 'store', 'mixed'] as const).map((entry) => (
                      <button key={entry} type="button" role="radio" aria-checked={judging === entry}
                        className={`pstudio__judge${judging === entry ? ' is-on' : ''}`} onClick={() => setJudging(entry)}>
                        <span aria-hidden="true">{entry === 'audience' ? '🗳️' : entry === 'store' ? '🏪' : '✂️'}</span>
                        <strong>{JUDGING_LABELS[entry]}</strong>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {judging !== 'store' && (
                <Choice label="Then voting runs for" value={votingHours} onChange={setVotingHours}
                  options={PHASES.slice(0, 3).map((entry) => ({ id: entry.hours, label: entry.label }))} />
              )}
              <div className="field">
                <span>Prizes</span>
                <div className="pstudio__prizes">
                  {prizes.map((entry, index) => (
                    <div key={index} className="pstudio__prize">
                      <span className="pstudio__medal" aria-hidden="true">{PLACE_MEDALS[(index + 1) as 1 | 2 | 3]}</span>
                      {!figmark && (
                        <span className="pstudio__moneybox pstudio__moneybox--sm">
                          <span aria-hidden="true">₹</span>
                          <input inputMode="decimal" value={entry.amount} placeholder="Credit" aria-label={`Store credit for place ${index + 1}`}
                            onChange={(event) => setPrizes((all) => all.map((row, at) => (at === index ? { ...row, amount: event.target.value.replace(/[^\d.]/g, '') } : row)))} />
                        </span>
                      )}
                      <input value={entry.note} maxLength={PRIZE_NOTE_MAX} aria-label={`Anything else for place ${index + 1}`}
                        placeholder={figmark ? 'A badge, and the front of Discover' : 'Anything else? Signed print…'}
                        onChange={(event) => setPrizes((all) => all.map((row, at) => (at === index ? { ...row, note: event.target.value } : row)))} />
                    </div>
                  ))}
                  {prizes.length < CONTEST_MAX_PRIZES && (
                    <button type="button" className="pstudio__addanswer" onClick={() => setPrizes((all) => [...all, { amount: '', note: '' }])}>
                      <Icon name="plus" size={14} /> Add {prizes.length === 1 ? '2nd' : '3rd'} place
                    </button>
                  )}
                </div>
                {!figmark && (
                  <span className="faint pstudio__cost">
                    Credit goes to the winners&apos; wallets, spendable at your shop only. Up to {formatMoney(PRIZE_MAX_MINOR, 'INR')} a place.
                  </span>
                )}
              </div>
              <p className="pstudio__note">
                <Icon name="users" size={14} /> One photo each, from verified phones. Copied photos are turned away. Every winner gets a badge on their page.
              </p>
            </>
          )}

          {error && <ErrorNotice message={error} />}
        </div>

        <div className="pstudio__foot">
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn pstudio__go" disabled={busy || draft.uploading}
            title={blocked ?? undefined} onClick={() => void submit()}>
            {busy ? 'Posting…' : mode === 'photo' ? (spots.length ? `Post flex · ${spots.length} tagged` : 'Post')
              : mode === 'debate' ? 'Start the debate' : mode === 'poll' ? 'Start the poll'
                : mode === 'guess' ? 'Start guessing' : 'Launch competition'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
