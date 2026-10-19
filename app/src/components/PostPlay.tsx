import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ApiRequestError, api, type PostCard } from '../api';
import { ratingOf, type PollView } from '@shared/social';
import {
  JUDGING_LABELS, PLACE_LABELS, PLACE_MEDALS, SHORTLIST_MAX, SHORTLIST_MIN, contestPhase,
  type ContestPhase, type PostContest,
} from '@shared/play';
import { formatMoney } from '../format';
import { useNow } from '../clock';
import { useSession } from '../session';
import { Icon } from './Icon';
import { Confetti } from './Confetti';
import { Modal } from './ui';
import { shrink } from './PhotoManager';
import '../styles/PostPlay.css';

/**
 * The things a post asks you to take part in: a poll in each of its four
 * faces, a competition through its phases, and a guess-the-price.
 *
 * Motion here is feedback and state, not decoration: a bar fills to say the
 * vote counted and how the room split; a podium rises once, when a
 * competition has winners; a sealed price unseals at its reveal. Each of
 * those happens once per thing, so it can afford to be felt; nothing loops.
 */

/** "in 3h", "in 2 days", for a time ahead. */
export function timeAhead(iso: string): string {
  const hours = Math.max(0, (Date.parse(iso) - Date.now()) / 3_600_000);
  if (hours < 1) return 'in under an hour';
  if (hours < 48) return `in ${Math.round(hours)}h`;
  return `in ${Math.round(hours / 24)} days`;
}

/** How long is left, said short, ticking each minute while under a day. */
function useLeft(iso: string | null): string | null {
  const end = iso ? Date.parse(iso) : 0;
  const now = useNow(iso && end > Date.now() ? 60_000 : null);
  if (!iso) return null;
  const minutes = Math.floor((end - now) / 60_000);
  if (minutes <= 0) return null;
  if (minutes < 60) return `${minutes}m left`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
  return `${Math.round(minutes / 1440)} days left`;
}

const share = (votes: number, total: number) => (total > 0 ? Math.round((votes / total) * 100) : 0);

type Vote = (optionId: string) => Promise<void>;

/** A vote button's press: busy while it is out, its error kept beside the poll. */
function useVote(vote: Vote) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function cast(optionId: string) {
    if (busy) return;
    setBusy(optionId);
    setError(null);
    try {
      await vote(optionId);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not count that vote.');
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, cast };
}

/** What sits under every poll: how many voted, how long it runs, and what the shop is giving. */
function PollFoot({ poll, children }: { poll: PollView; children?: ReactNode }) {
  const left = useLeft(poll.closed ? null : poll.closesAt);
  return (
    <div className="pplay__foot">
      <span>
        {poll.total} vote{poll.total === 1 ? '' : 's'}
        {poll.closed ? ' · Final results' : left ? ` · ${left}` : ''}
        {poll.switches ? ` · ${poll.switches} changed their mind` : ''}
      </span>
      {poll.reward && (
        <span className="pplay__chip pplay__chip--gold" title="Store credit for whoever picked the winner">
          🎁 {formatMoney(poll.reward.amountMinor, 'INR')} credit for the winning side
          {poll.reward.paidCount ? ` · paid ${poll.reward.paidCount}` : ` · first ${poll.reward.maxVoters}`}
        </span>
      )}
      {poll.stock && <span className="pplay__chip pplay__chip--lime">📦 Helps decide what's stocked</span>}
      {children}
    </div>
  );
}

/* ── Text ──────────────────────────────────────────────────────────────── */

function TextPoll({ poll, disabled, vote }: { poll: PollView; disabled: boolean; vote: Vote }) {
  const { busy, error, cast } = useVote(vote);
  const reveal = poll.myVote !== null || poll.closed || disabled;
  const leader = Math.max(...poll.options.map((option) => option.votes));
  return (
    <div className="poll">
      {poll.options.map((option, index) => {
        const mine = poll.myVote === option.id;
        return (
          <button key={option.id} type="button"
            className={`poll__option${reveal ? ' is-revealed' : ''}${mine ? ' is-mine' : ''}`
              + `${reveal && option.votes === leader && leader > 0 ? ' is-leading' : ''}`}
            disabled={disabled || poll.closed || busy !== null} aria-pressed={mine}
            onClick={() => void cast(option.id)}>
            <span className="poll__fill" aria-hidden="true"
              style={{ transform: `scaleX(${reveal ? share(option.votes, poll.total) / 100 : 0})`, transitionDelay: `${index * 40}ms` }} />
            <span className="poll__label">
              {mine && <Icon name="check" size={14} />}
              {option.label}
            </span>
            {reveal && <span className="poll__share">{share(option.votes, poll.total)}%</span>}
          </button>
        );
      })}
      <PollFoot poll={poll}>{poll.myVote && !poll.closed && <span className="faint">Tap another to change</span>}</PollFoot>
      {error && <p className="spost__error">{error}</p>}
    </div>
  );
}

/* ── Photos ────────────────────────────────────────────────────────────── */

function PhotoPoll({ poll, disabled, vote, label = 'Vote' }: { poll: PollView; disabled: boolean; vote: Vote; label?: string }) {
  const { busy, error, cast } = useVote(vote);
  const reveal = poll.myVote !== null || poll.closed;
  const leader = Math.max(0, ...poll.options.map((option) => option.votes));
  return (
    <div className="pplay">
      <div className={`pgrid pgrid--${Math.min(poll.options.length, 4)}`}>
        {poll.options.map((option, index) => {
          const mine = poll.myVote === option.id;
          const lead = reveal && leader > 0 && option.votes === leader;
          return (
            <div key={option.id} className={`pgrid__cell${mine ? ' is-mine' : ''}${lead ? ' is-leading' : ''}`}
              style={{ animationDelay: `${index * 40}ms` }}>
              <button type="button" className="pgrid__pick" disabled={disabled || poll.closed || busy !== null}
                aria-pressed={mine} aria-label={`${label}: ${option.label}`} onClick={() => void cast(option.id)}>
                {option.photoUrl ? <img src={option.photoUrl} alt="" loading="lazy" draggable={false} /> : <span className="pgrid__none" />}
                {reveal && <span className="pgrid__pct">{share(option.votes, poll.total)}%</span>}
                {lead && <span className="pgrid__crown" aria-hidden="true">👑</span>}
                <span className="pgrid__label">{mine && <Icon name="check" size={12} />} {option.label}</span>
                <span className="pgrid__meter" aria-hidden="true">
                  <span style={{ transform: `scaleX(${reveal ? share(option.votes, poll.total) / 100 : 0})` }} />
                </span>
              </button>
              {option.listingId && (
                <Link to={`/listing/${encodeURIComponent(option.listingId)}`} className="debate__item">
                  <Icon name="tag" size={11} /> Shop it
                </Link>
              )}
            </div>
          );
        })}
      </div>
      <PollFoot poll={poll}>{!reveal && !disabled && <span className="faint">Tap a photo to vote</span>}</PollFoot>
      {error && <p className="spost__error">{error}</p>}
    </div>
  );
}

/* ── Versus ────────────────────────────────────────────────────────────── */

/**
 * A over B: two photos side by side, each a button that votes for it, the
 * live split drawn as one bar underneath. The split stays hidden until you
 * vote, as an ordinary poll's does, so the first vote is yours rather than
 * the crowd's. The VS mark knocks once when your vote lands - feedback.
 */
function Versus({ poll, photos, listingIds, disabled, vote }: {
  poll: PollView;
  photos: (string | null)[];
  listingIds: (string | null)[];
  disabled: boolean;
  vote: Vote;
}) {
  const { busy, error, cast } = useVote(vote);
  const sides = poll.options.slice(0, 2);
  const reveal = poll.myVote !== null || poll.closed;
  const shares = sides.map((option) => (poll.total > 0 ? share(option.votes, poll.total) : 50));
  const leader = sides[0] && sides[1] && sides[1].votes > sides[0].votes ? sides[1] : sides[0];
  return (
    <div className="debate">
      <div className="debate__pair">
        {sides.map((option, index) => {
          const mine = poll.myVote === option.id;
          const listingId = listingIds[index] ?? null;
          return (
            <div key={option.id} className={`debate__side debate__side--${index === 0 ? 'a' : 'b'}${mine ? ' is-mine' : ''}`}>
              <button type="button" className="debate__pick" disabled={disabled || poll.closed || busy !== null}
                aria-pressed={mine} onClick={() => void cast(option.id)}>
                {photos[index] ? <img src={photos[index]!} alt={option.label} loading="lazy" draggable={false} /> : <span className="pgrid__none" />}
                <span className="debate__letter" aria-hidden="true">{index === 0 ? 'A' : 'B'}</span>
                {reveal && <span className="debate__pct">{shares[index]}%</span>}
                <span className="debate__label">{mine && <Icon name="check" size={12} />} {option.label}</span>
              </button>
              {listingId && (
                <Link to={`/listing/${encodeURIComponent(listingId)}`} className="debate__item">
                  <Icon name="tag" size={11} /> Shop side {index === 0 ? 'A' : 'B'}
                </Link>
              )}
            </div>
          );
        })}
        <span key={poll.myVote ?? 'none'} className={`debate__vs${poll.myVote ? ' is-knocked' : ''}`} aria-hidden="true">VS</span>
      </div>
      <div className={`debate__bar${reveal ? ' is-revealed' : ''}`} aria-hidden={!reveal}>
        <span className="debate__bar-a" style={{ transform: `scaleX(${(reveal ? shares[0]! : 50) / 100})` }} />
        <span className="debate__bar-b" style={{ transform: `scaleX(${(reveal ? shares[1]! : 50) / 100})` }} />
      </div>
      <PollFoot poll={poll}>
        {!reveal && !disabled && <span className="faint">Tap a side to vote</span>}
        {reveal && leader && (
          <Link to={`/?q=${encodeURIComponent(leader.label)}`} className="debate__cta">
            Shop {leader.label} <Icon name="right" size={12} />
          </Link>
        )}
      </PollFoot>
      {error && <p className="spost__error">{error}</p>}
    </div>
  );
}

/* ── Rating ────────────────────────────────────────────────────────────── */

function RatingPoll({ poll, disabled, vote }: { poll: PollView; disabled: boolean; vote: Vote }) {
  const { busy, error, cast } = useVote(vote);
  const [hover, setHover] = useState(0);
  const mine = poll.myVote ? Number(poll.options.find((option) => option.id === poll.myVote)?.label) : 0;
  const average = ratingOf(poll);
  const lit = hover || mine;
  const most = Math.max(1, ...poll.options.map((option) => option.votes));
  return (
    <div className="prate">
      <div className="prate__stars" role="radiogroup" aria-label="Your rating" onPointerLeave={() => setHover(0)}>
        {poll.options.map((option) => {
          const value = Number(option.label);
          return (
            <button key={option.id} type="button" role="radio" aria-checked={mine === value}
              aria-label={`${value} star${value === 1 ? '' : 's'}`}
              className={`prate__star${value <= lit ? ' is-lit' : ''}${mine === value ? ' is-mine' : ''}`}
              disabled={disabled || poll.closed || busy !== null}
              onPointerEnter={(event) => { if (event.pointerType === 'mouse') setHover(value); }}
              onClick={() => void cast(option.id)}>
              ★
            </button>
          );
        })}
        {average !== null && (mine > 0 || poll.closed) && (
          <span className="prate__avg"><strong>{average.toFixed(1)}</strong> / 5</span>
        )}
      </div>
      {(mine > 0 || poll.closed) && poll.total > 0 && (
        <div className="prate__bars" aria-label="How people rated it">
          {[...poll.options].reverse().map((option) => (
            <span key={option.id} className="prate__row">
              <span>{option.label}★</span>
              <span className="prate__track"><span style={{ transform: `scaleX(${option.votes / most})` }} /></span>
              <span className="faint">{option.votes}</span>
            </span>
          ))}
        </div>
      )}
      <PollFoot poll={poll}>{!mine && !disabled && !poll.closed && <span className="faint">Tap a star to rate</span>}</PollFoot>
      {error && <p className="spost__error">{error}</p>}
    </div>
  );
}

/**
 * A post's poll in whichever face it was made in. A debate written before
 * polls had faces is a versus poll on the post's own two photos.
 */
export function PollPlay({ card, photos, disabled, vote }: {
  card: PostCard;
  photos: string[];
  disabled: boolean;
  vote: Vote;
}) {
  const { post, social } = card;
  const poll = social.poll!;
  const style = poll.style ?? (post.debate ? 'versus' : 'text');
  return (
    <>
      {post.debate?.prize && (
        <p className="pplay__prize">
          🎁 <strong>{formatMoney(post.debate.prize.amountMinor, 'INR')}</strong> store credit from {post.debate.prize.storeName} for the best argument
          <span className="faint"> · {post.debate.prize.judge === 'store' ? 'the shop picks' : 'most liked wins'}</span>
        </p>
      )}
      {style === 'versus' ? (
        <Versus poll={poll} disabled={disabled} vote={vote}
          photos={poll.options.slice(0, 2).map((option, index) => option.photoUrl ?? photos[index] ?? null)}
          listingIds={poll.options.slice(0, 2).map((option, index) => option.listingId ?? post.debate?.listingIds[index] ?? null)} />
      ) : style === 'photo' ? (
        <PhotoPoll poll={poll} disabled={disabled} vote={vote} />
      ) : style === 'rating' ? (
        <RatingPoll poll={poll} disabled={disabled} vote={vote} />
      ) : (
        <TextPoll poll={poll} disabled={disabled} vote={vote} />
      )}
      {post.debate?.best && (
        <p className="pplay__best">
          <span aria-hidden="true">🎤</span> Best argument: <strong>{post.debate.best.name}</strong>
          {post.debate.best.side && <TeamChip poll={poll} side={post.debate.best.side} />}
        </p>
      )}
    </>
  );
}

/** Team A or Team B, for an argument in a debate. */
export function TeamChip({ poll, side }: { poll: PollView | null; side: string }) {
  const index = poll?.options.findIndex((option) => option.id === side) ?? -1;
  if (index < 0 || index > 1) return null;
  return (
    <span className={`teamchip teamchip--${index === 0 ? 'a' : 'b'}`} title={poll!.options[index]!.label}>
      Team {index === 0 ? 'A' : 'B'}
    </span>
  );
}

/* ── Competitions ──────────────────────────────────────────────────────── */

const PHASE_LABELS: Record<ContestPhase, string> = {
  entries: 'Taking entries',
  shortlisting: 'Shortlisting',
  voting: 'Voting open',
  judging: 'Judging',
  ended: 'Winners',
};

function prizeText(contest: PostContest, place: 1 | 2 | 3): string | null {
  const prize = contest.prizes.find((entry) => entry.place === place);
  if (!prize) return null;
  const parts = [prize.amountMinor > 0 ? `${formatMoney(prize.amountMinor, 'INR')} credit` : '', prize.note].filter(Boolean);
  return parts.join(' + ') || null;
}

/** Putting a photo in: one, with a line, from the camera roll. */
function EnterSheet({ card, onClose, onEntered }: { card: PostCard; onClose: () => void; onEntered: (card: PostCard) => void }) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const files = useRef<HTMLInputElement | null>(null);
  const sent = useRef(false);
  const live = useRef<string | null>(null);
  live.current = photo;
  useEffect(() => () => {
    if (!sent.current && live.current) void api.discardPhoto(live.current);
  }, []);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const { url } = await api.uploadPhoto(await shrink(file));
      if (photo) void api.discardPhoto(photo);
      setPhoto(url);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not upload that photo.');
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!photo) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.enterContest(card.post.channelId, card.post.id, photo, caption.trim());
      sent.current = true;
      onEntered(result.card);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not enter that.');
      setBusy(false);
    }
  }

  return (
    <Modal title={`Enter ${card.post.contest?.title ?? 'the competition'}`} onClose={onClose}>
      <div className="pcontest__enter">
        <button type="button" className={`pcontest__drop${photo ? ' has-photo' : ''}`} disabled={busy} onClick={() => files.current?.click()}>
          {photo ? <img src={photo} alt="Your entry" /> : (
            <span><Icon name="camera" size={26} /><strong>{busy ? 'Uploading…' : 'Choose your photo'}</strong><span className="faint">Your own, one per person.</span></span>
          )}
        </button>
        <input ref={files} type="file" accept="image/*" hidden onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
        <label className="field">
          <span>A line about it <span className="faint">(optional)</span></span>
          <input value={caption} maxLength={140} onChange={(event) => setCaption(event.target.value)} placeholder="Six weeks of weathering" />
        </label>
        {error && <p className="notice notice--error">{error}</p>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
          <button type="button" className="btn pcontest__go" disabled={!photo || busy} onClick={() => void submit()}>
            {busy && photo ? 'Entering…' : 'Enter'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** The host picks: a shortlist (2-12) or the winners (up to three, in order). */
function Picker({ card, kind, onCard }: { card: PostCard; kind: 'shortlist' | 'winners'; onCard: (card: PostCard) => void }) {
  const contest = card.post.contest!;
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const max = kind === 'winners' ? Math.min(3, contest.entries.length) : SHORTLIST_MAX;
  const ready = kind === 'winners' ? chosen.length >= 1 : chosen.length >= SHORTLIST_MIN;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      onCard((await api.judge(card.post.channelId, card.post.id, { action: kind, entryIds: chosen })).card);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not save that.');
      setBusy(false);
    }
  }

  return (
    <div className="pcontest__picker">
      <p className="pcontest__pickhead">
        {kind === 'winners' ? 'Tap the winners in order: first, then second, then third.' : `Tap ${SHORTLIST_MIN}–${SHORTLIST_MAX} entries to put to the vote.`}
      </p>
      <div className="pcontest__entries">
        {contest.entries.map((entry) => {
          const at = chosen.indexOf(entry.id);
          return (
            <button key={entry.id} type="button" className={`pcontest__entry${at >= 0 ? ' is-chosen' : ''}`}
              aria-pressed={at >= 0}
              onClick={() => setChosen((all) => (at >= 0 ? all.filter((id) => id !== entry.id) : all.length < max ? [...all, entry.id] : all))}>
              <img src={entry.photoUrl} alt={entry.caption || `Entry by ${entry.name}`} loading="lazy" />
              <span className="pcontest__by">{entry.name}</span>
              {at >= 0 && (
                <span className="pcontest__mark">{kind === 'winners' ? PLACE_MEDALS[(at + 1) as 1 | 2 | 3] : <Icon name="check" size={14} />}</span>
              )}
            </button>
          );
        })}
      </div>
      {error && <p className="spost__error">{error}</p>}
      <button type="button" className="btn pcontest__go" disabled={!ready || busy} onClick={() => void send()}>
        {busy ? 'Saving…' : kind === 'winners' ? `Announce ${chosen.length || ''} winner${chosen.length === 1 ? '' : 's'}` : `Open voting on ${chosen.length}`}
      </button>
    </div>
  );
}

/**
 * The podium: second, first, third, rising one after another - the one moment
 * in a competition worth a flourish, and it plays once, when it is first seen.
 */
function Podium({ contest, me }: { contest: PostContest; me: string | null }) {
  const winners = contest.winners ?? [];
  const order = [2, 1, 3].map((place) => winners.find((winner) => winner.place === place)).filter(Boolean) as NonNullable<PostContest['winners']>;
  const won = winners.some((winner) => winner.userId === me);
  return (
    <div className="podium">
      <Confetti run={won ? 1 : 0} />
      {order.map((winner, index) => (
        <figure key={winner.entryId} className={`podium__step podium__step--${winner.place}`} style={{ animationDelay: `${index * 90}ms` }}>
          <div className="podium__photo">
            <img src={winner.photoUrl} alt={`${PLACE_LABELS[winner.place]}: ${winner.name}`} loading="lazy" />
            <span className="podium__medal" aria-hidden="true">{PLACE_MEDALS[winner.place]}</span>
          </div>
          <figcaption>
            <strong>{winner.name}{winner.userId === me ? ' (you!)' : ''}</strong>
            {winner.votes !== null && <span className="faint">{winner.votes} vote{winner.votes === 1 ? '' : 's'}</span>}
            {prizeText(contest, winner.place) && <span className="podium__prize">{prizeText(contest, winner.place)}</span>}
          </figcaption>
          <span className="podium__block" aria-hidden="true">{winner.place}</span>
        </figure>
      ))}
    </div>
  );
}

export function ContestPlay({ card, disabled, vote, onCard }: {
  card: PostCard;
  disabled: boolean;
  vote: Vote;
  onCard: (card: PostCard) => void;
}) {
  const { user } = useSession();
  const contest = card.post.contest!;
  const phase = contestPhase(contest);
  const host = Boolean(card.social.host);
  const me = user?.id ?? null;
  const mine = contest.entries.find((entry) => entry.userId === me) ?? null;
  const [entering, setEntering] = useState(false);
  const [sending, setSending] = useState<number | null>(null);
  const until = phase === 'entries' ? contest.entriesCloseAt : phase === 'voting' ? contest.endsAt : null;
  const left = useLeft(until);

  return (
    <section className={`pcontest pcontest--${phase}${contest.host === 'figmark' ? ' pcontest--figmark' : ''}`} aria-label={contest.title}>
      <header className="pcontest__head">
        <span className="pcontest__trophy" aria-hidden="true">{contest.host === 'figmark' ? '🌟' : '🏆'}</span>
        <span className="pcontest__titles">
          <strong>{contest.title}</strong>
          <span className="faint">{contest.host === 'figmark' ? 'Figmark weekly challenge' : `Run by ${contest.hostName}`} · {JUDGING_LABELS[contest.judging]}</span>
        </span>
        <span className={`pcontest__phase pcontest__phase--${phase}`}>
          {phase !== 'ended' && <span className="pcontest__dot" aria-hidden="true" />}
          {PHASE_LABELS[phase]}{left ? ` · ${left}` : ''}
        </span>
      </header>

      {contest.prizes.length > 0 && (
        <ul className="pcontest__prizes">
          {contest.prizes.map((prize) => (
            <li key={prize.place}>
              <span aria-hidden="true">{PLACE_MEDALS[prize.place]}</span> {prizeText(contest, prize.place)}
              {host && phase === 'ended' && prize.note && contest.winners?.some((winner) => winner.place === prize.place) && (
                (contest.prizeSent ?? []).includes(prize.place) ? <span className="pplay__chip pplay__chip--lime">Sent</span> : (
                  <button type="button" className="btn btn--quiet btn--sm" disabled={sending === prize.place}
                    onClick={async () => {
                      setSending(prize.place);
                      try {
                        onCard((await api.judge(card.post.channelId, card.post.id, { action: 'sent', place: prize.place })).card);
                      } finally {
                        setSending(null);
                      }
                    }}>
                    Mark sent
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}

      {phase === 'entries' && (
        <>
          {contest.entries.length > 0 ? (
            <div className="pcontest__strip" aria-label={`${contest.entries.length} entries so far`}>
              {contest.entries.slice(-8).reverse().map((entry, index) => (
                <img key={entry.id} src={entry.photoUrl} alt={`Entry by ${entry.name}`} loading="lazy" style={{ animationDelay: `${index * 40}ms` }} />
              ))}
              <span className="pcontest__count">{contest.entries.length} {contest.entries.length === 1 ? 'entry' : 'entries'}</span>
            </div>
          ) : (
            <p className="pcontest__empty">No entries yet. Be the first.</p>
          )}
          {mine ? (
            <p className="pcontest__in"><Icon name="check" size={14} /> You're in. Voting opens {timeAhead(contest.entriesCloseAt)}.</p>
          ) : !host && !disabled && (
            <button type="button" className="btn pcontest__go pcontest__cta" onClick={() => setEntering(true)}>
              <Icon name="camera" size={16} /> Enter with a photo
            </button>
          )}
        </>
      )}

      {phase === 'voting' && card.social.poll && (
        <PhotoPoll poll={card.social.poll} disabled={disabled || host || !user} vote={vote} label="Vote for" />
      )}

      {(phase === 'shortlisting' || phase === 'judging') && (
        host ? <Picker card={card} kind={phase === 'judging' ? 'winners' : 'shortlist'} onCard={onCard} /> : (
          <p className="pcontest__empty">
            Entries are closed. {contest.hostName} is {phase === 'judging' ? 'picking the winners' : 'choosing the shortlist'}.
            {mine && ' Yours is in.'}
          </p>
        )
      )}

      {phase === 'ended' && (contest.winners?.length ? <Podium contest={contest} me={me} /> : (
        <p className="pcontest__empty">Voting has closed. The winners are being counted.</p>
      ))}

      {entering && (
        <EnterSheet card={card} onClose={() => setEntering(false)} onEntered={(next) => { setEntering(false); onCard(next); }} />
      )}
    </section>
  );
}

/* ── Guess the price ───────────────────────────────────────────────────── */

export function GuessPlay({ card, disabled, onCard }: { card: PostCard; disabled: boolean; onCard: (card: PostCard) => void }) {
  const guess = card.social.guess!;
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = useLeft(guess.revealed ? null : guess.revealAt);

  async function send() {
    const rupees = Number(amount.replace(/[^\d.]/g, ''));
    if (!rupees) return;
    setBusy(true);
    setError(null);
    try {
      const { guess: next } = await api.guessPrice(card.post.channelId, card.post.id, Math.round(rupees * 100));
      onCard({ ...card, social: { ...card.social, guess: next } });
      setAmount('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not take that guess.');
    } finally {
      setBusy(false);
    }
  }

  const off = guess.revealed && guess.mine !== null && guess.answerMinor !== null
    ? Math.abs(guess.mine - guess.answerMinor) / guess.answerMinor : null;

  return (
    <section className={`pguess${guess.revealed ? ' is-revealed' : ''}`} aria-label="Guess the price">
      <div className="pguess__price">
        <span className="pguess__kicker">{guess.revealed ? 'It was' : 'Guess the price'}</span>
        {guess.revealed && guess.answerMinor !== null ? (
          <strong className="pguess__answer">{formatMoney(guess.answerMinor, 'INR')}</strong>
        ) : (
          <strong className="pguess__sealed" aria-label="Sealed until the reveal"><Icon name="lock" size={18} /> ₹ ? ? ?</strong>
        )}
        <span className="faint">
          {guess.count} guess{guess.count === 1 ? '' : 'es'}{!guess.revealed && left ? ` · the price is out in ${left.replace(' left', '')}` : ''}
        </span>
      </div>

      {!guess.revealed && !disabled && !card.social.mine && (
        <form className="pguess__form" onSubmit={(event) => { event.preventDefault(); void send(); }}>
          <span className="pguess__box">
            <span aria-hidden="true">₹</span>
            <input inputMode="decimal" value={amount} aria-label="Your guess, in rupees"
              placeholder={guess.mine !== null ? String(guess.mine / 100) : 'Your guess'}
              onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ''))} />
          </span>
          <button type="submit" className="btn pcontest__go" disabled={busy || !amount}>{guess.mine !== null ? 'Change' : 'Guess'}</button>
        </form>
      )}
      {!guess.revealed && guess.mine !== null && (
        <p className="pcontest__in"><Icon name="check" size={14} /> Your guess: {formatMoney(guess.mine, 'INR')}</p>
      )}

      {guess.revealed && (
        <div className="pguess__result">
          {guess.winner && <p className="pplay__best"><span aria-hidden="true">🎯</span> Closest: <strong>{guess.winner.name}</strong> with {formatMoney(guess.winner.amountMinor, 'INR')}</p>}
          {off !== null && <p className="faint">You said {formatMoney(guess.mine!, 'INR')} — {off < 0.005 ? 'spot on!' : `${Math.round(off * 100)}% off`}</p>}
          {guess.closest.length > 1 && (
            <ol className="pguess__closest">
              {guess.closest.map((entry, index) => (
                <li key={`${entry.name}-${index}`}><span>{PLACE_MEDALS[(index + 1) as 1 | 2 | 3]} {entry.name}</span><span className="faint">{formatMoney(entry.amountMinor, 'INR')}</span></li>
              ))}
            </ol>
          )}
        </div>
      )}
      {guess.listingId && (
        <Link to={`/listing/${encodeURIComponent(guess.listingId)}`} className="debate__item"><Icon name="tag" size={11} /> See it on Figmark</Link>
      )}
      {error && <p className="spost__error">{error}</p>}
    </section>
  );
}
