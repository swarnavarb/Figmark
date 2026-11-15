import type { PollStyle, PostHotspot } from '@shared/social';
import { FlexShelf } from './FlexShelf';
import { PLACE_MEDALS } from '@shared/play';
import { formatMoney } from '../format';
import type { StudioMode } from './PostStudio';

/** What the studio has so far, as the preview needs it. */
export interface PreviewDraft {
  mode: StudioMode;
  author: string;
  asStore: boolean;
  text: string;
  photos: string[];
  /** Photo tags: pieces tagged on the photos. */
  spots?: PostHotspot[];
  /** Polls and debates. */
  style?: PollStyle;
  answers?: { label: string; photo: string | null }[];
  closesLabel?: string | null;
  /** Before & after. */
  compareLabels?: [string, string];
  /** Competitions. */
  title?: string;
  prizes?: { amountMinor: number; note: string }[];
  /** Any prize line, ready to read: "₹500 credit for the best argument". */
  prizeLine?: string | null;
  terms?: string | null;
  revealLabel?: string | null;
  blur?: string | null;
}

const KIND: Record<StudioMode, { emoji: string; label: string }> = {
  photo: { emoji: '📸', label: 'Photo tag' },
  compare: { emoji: '🎨', label: 'Before & after' },
  question: { emoji: '❓', label: 'Question' },
  poll: { emoji: '📊', label: 'Poll' },
  debate: { emoji: '⚔️', label: 'Debate' },
  guess: { emoji: '🎯', label: 'Guess the price' },
  contest: { emoji: '🏆', label: 'Competition' },
  spread: { emoji: '📣', label: 'Spread the word' },
};

/**
 * The post as it will look in the feed, drawn from the studio's draft. Not
 * the feed's own card - that needs a saved post - but the same parts in the
 * same order, so what you see is what people get.
 */
export function PostPreview({ draft }: { draft: PreviewDraft }) {
  const kind = KIND[draft.mode];
  const initials = draft.author.split(/\s+/).map((word) => word[0] ?? '').join('').slice(0, 2).toUpperCase() || '?';
  const answers = (draft.answers ?? []).map((entry, index) => ({ ...entry, label: entry.label.trim() || `Answer ${index + 1}` }));
  const voting = draft.mode === 'poll' || draft.mode === 'debate';
  const face = draft.mode === 'debate' ? 'versus' : draft.style ?? 'text';
  const lead = draft.photos[0] ?? null;

  return (
    <article className={`ppreview ppreview--${draft.mode}`} aria-label="Preview of your post">
      <header className="ppreview__head">
        <span className={`ppreview__face${draft.asStore ? ' is-store' : ''}`} aria-hidden="true">{initials}</span>
        <span className="ppreview__who">
          <strong>{draft.author}</strong>
          <span className="faint">just now</span>
        </span>
        <span className="ppreview__kind"><span aria-hidden="true">{kind.emoji}</span> {kind.label}</span>
      </header>

      {draft.mode === 'contest' && (
        <h4 className="ppreview__title">{draft.title?.trim() || 'Your competition'}</h4>
      )}
      {draft.text.trim()
        ? <p className="ppreview__body">{draft.text.trim()}</p>
        : <p className="ppreview__body ppreview__body--empty">What you write shows here.</p>}

      <div className={draft.blur ? 'ppreview__blurred' : undefined}>
        {draft.mode === 'compare' && (
          <div className="ppreview__compare">
            {[0, 1].map((side) => (
              <figure key={side}>
                {draft.photos[side] ? <img src={draft.photos[side]} alt="" /> : <span className="ppreview__hole" />}
                <figcaption>{draft.compareLabels?.[side] || (side === 0 ? 'Before' : 'After')}</figcaption>
              </figure>
            ))}
            <span className="ppreview__divider" aria-hidden="true" />
          </div>
        )}

        {draft.mode === 'photo' && lead && (draft.spots?.length ?? 0) > 0 && (
          <FlexShelf photos={draft.photos} hotspots={draft.spots!} alt="Your photo" onOpen={() => {}} />
        )}

        {((draft.mode === 'photo' && !draft.spots?.length) || draft.mode === 'question' || draft.mode === 'contest' || draft.mode === 'spread' || (voting && face === 'rating')) && lead && (
          <div className={`ppreview__photos ppreview__photos--${Math.min(draft.photos.length, 4)}`}>
            {draft.photos.slice(0, draft.mode === 'photo' || draft.mode === 'question' ? 4 : 1).map((url) => <img key={url} src={url} alt="" />)}
          </div>
        )}

        {draft.mode === 'guess' && (
          <div className="ppreview__guess">
            {lead && <img src={lead} alt="" />}
            <span className="ppreview__sealed">₹ ? ? ?</span>
            <span className="faint">{draft.revealLabel ? `The price is out in ${draft.revealLabel}` : 'Sealed until the reveal'}</span>
          </div>
        )}

        {voting && face === 'versus' && (
          <div className="ppreview__versus">
            {answers.slice(0, 2).map((entry, index) => (
              <span key={index} className={`ppreview__side ppreview__side--${index === 0 ? 'a' : 'b'}`}>
                {entry.photo ? <img src={entry.photo} alt="" /> : <span className="ppreview__hole" />}
                <strong>{entry.label}</strong>
              </span>
            ))}
            <span className="ppreview__vs" aria-hidden="true">VS</span>
          </div>
        )}
        {voting && face === 'photo' && (
          <div className="ppreview__photoopts">
            {answers.map((entry, index) => (
              <span key={index}>
                {entry.photo ? <img src={entry.photo} alt="" /> : <span className="ppreview__hole" />}
                <strong>{entry.label}</strong>
              </span>
            ))}
          </div>
        )}
        {voting && face === 'text' && (
          <ul className="ppreview__options">
            {answers.map((entry, index) => (
              <li key={index} style={{ animationDelay: `${index * 50}ms` }}><span>{entry.label}</span><span className="faint">0%</span></li>
            ))}
          </ul>
        )}
        {voting && face === 'rating' && <p className="ppreview__stars" aria-label="Rate out of five">☆☆☆☆☆</p>}
      </div>

      {draft.mode === 'contest' && (draft.prizes ?? []).some((prize) => prize.amountMinor > 0 || prize.note.trim()) && (
        <ul className="ppreview__prizes">
          {(draft.prizes ?? []).map((prize, index) => (prize.amountMinor > 0 || prize.note.trim()) && (
            <li key={index}>
              <span aria-hidden="true">{PLACE_MEDALS[(index + 1) as 1 | 2 | 3]}</span>
              {[prize.amountMinor > 0 ? `${formatMoney(prize.amountMinor, 'INR')} credit` : '', prize.note.trim()].filter(Boolean).join(' + ')}
            </li>
          ))}
        </ul>
      )}

      {draft.mode === 'spread' && (
        <p className="ppreview__spread"><span aria-hidden="true">📣</span> Get my link · a timer · who has brought the most</p>
      )}
      {draft.prizeLine && <p className="ppreview__prize">{draft.mode === 'spread' ? '' : '🎁 '}{draft.prizeLine}</p>}
      {draft.terms && (
        <details className="pterms" open>
          <summary>Prize T&amp;C</summary>
          <p>{draft.terms}</p>
        </details>
      )}

      <footer className="ppreview__foot">
        {voting && <span>0 votes{draft.closesLabel ? ` · closes in ${draft.closesLabel}` : ''}</span>}
        {draft.mode === 'question' && <span>Answers land in the comments</span>}
        {draft.blur && <span>Blurred until tapped</span>}
        <span className="ppreview__acts" aria-hidden="true">♡ 💬 ↗</span>
      </footer>
    </article>
  );
}
