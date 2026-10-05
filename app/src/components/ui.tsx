import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import type { StepState } from '@shared/routes';
import { brandHueFor, gradientFor, initialsOf } from '../format';

/*
 * Icons live in their own file now, and this re-export is what keeps every
 * existing `import { Icon } from '../components/ui'` working while the set
 * grew from five glyphs to thirty-odd. One family, one stroke, one place.
 */
export { Icon } from './Icon';
import { Icon } from './Icon';
export type { IconName } from './Icon';

/**
 * Stand-in for a listing photo.
 *
 * There is no blob storage wired up yet, so rather than fake image URLs that
 * would fail to load, each listing gets a stable gradient keyed off its id with
 * its initials on top. Deterministic, so the grid looks intentional.
 */
/**
 * The picture on a listing, or a stand-in for one.
 *
 * Every screen that shows an item goes through here, which is why the photo
 * belongs here too: one place decides what an item looks like, so an item with
 * a photo has it everywhere and one without gets the same generated square it
 * always had rather than a broken image or a hole.
 */
export function Thumb({ seed, label, photo, className = 'thumb', children }: {
  seed: string;
  label: string;
  /** The listing's leading photo, when it has one. */
  photo?: { url?: string } | null;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className} style={photo?.url ? undefined : { background: gradientFor(seed) }}>
      {photo?.url ? <img className="thumb__img" src={photo.url} alt={label} loading="lazy" />
        : <span>{initialsOf(label)}</span>}
      {children}
    </div>
  );
}

/** The photo a listing leads with: the primary one, or simply the first. */
export function leadPhoto(listing: { photos?: { url?: string; isPrimary?: boolean }[] }) {
  const photos = listing.photos ?? [];
  return photos.find((photo) => photo.isPrimary) ?? photos[0] ?? null;
}

/**
 * Somebody's mark.
 *
 * One of the six brand hues rather than an arbitrary one, so a conversation
 * list reads as Figmark's colours and not as a bag of random circles. Stable
 * per name, so a person is the same colour everywhere they appear.
 */
export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <div
      className={`avatar avatar--${brandHueFor(name)}`}
      style={{ width: size, height: size, fontSize: size < 32 ? 11 : 13 }}
    >
      {initialsOf(name)}
    </div>
  );
}

/** Seller trust, shown identically wherever a seller appears. */
export function TrustBadge({ score, tier }: { score: number; tier?: string }) {
  const tone = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'danger';
  return (
    <span className={`badge badge--${tone}`} title={`Trust score ${score} of 100`}>
      <Icon name="star" size={11} /> {score}
      {tier === 'pro' && ' · Pro'}
    </span>
  );
}

/**
 * Nothing here yet.
 *
 * Takes a node rather than a character, so callers can hand it a drawn icon.
 * The default is the six-point spark the "everything" tile uses, which is the
 * nearest thing this app has to a shrug.
 */
export function EmptyState({ icon, title, children }: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon ?? <Icon name="spark" size={26} />}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return <p className="notice notice--error">{message}</p>;
}

export type { StepState };

/**
 * How one step of a journey reads, drawn the same way everywhere a journey is
 * shown - a route's own ladder, the plain line a direct-ship order gets,
 * anywhere else one is added later. A tick once it is behind you, a small
 * spinner while it is the one under way, nothing yet for what has not been
 * reached: one vocabulary, whatever shape the route behind it actually has.
 */
export function StepMark({ state, size = 11 }: { state: StepState; size?: number }) {
  if (state === 'done') return <Icon name="check" size={size} className="stepmark stepmark--done" />;
  if (state === 'current') return <span className="stepmark stepmark--current" aria-hidden="true" />;
  return null;
}

/**
 * The gap between two steps, while whatever is in it is actually moving: a
 * small wave rather than a spinner, so "in transit" reads differently from
 * "working on it" does elsewhere in the app - this one specifically means
 * something is travelling, not that a request is pending.
 */
export function WaveLoader() {
  return (
    <span className="waveloader" aria-hidden="true">
      <span /><span /><span />
    </span>
  );
}

/**
 * A single number under a word. The unit both the lot cards and packing use.
 *
 * Give it an `onClick` and it becomes the door to the rows behind the number:
 * a count is a question ("which three?") and the tile is where the finger
 * already is. Without one it stays a plain div rather than a button that goes
 * nowhere.
 */
export function Tile({ value, label, tone, onClick, open }: {
  value: string;
  label: string;
  tone?: 'blue' | 'green';
  onClick?: () => void;
  /** Whether the rows behind this number are showing. */
  open?: boolean;
}) {
  const className =
    `tile${tone ? ` tile--${tone}` : ''}${onClick ? ' tile--tap' : ''}${open ? ' is-open' : ''}`;
  const body = (
    <>
      <div className="tile__value">{value}</div>
      <div className="tile__label">{label}</div>
    </>
  );

  return onClick ? (
    <button type="button" className={className} onClick={onClick} aria-expanded={open ?? false}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  );
}

/**
 * A modal dialog.
 *
 * Escape closes it and so does the backdrop, because the way out of a dialog
 * should be the thing people reach for without thinking. Used for choices worth
 * interrupting the page for — picking who holds your money is one.
 */
export function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Rendered at the top of the document rather than where it was written.
  //
  // A dialog has to sit above everything, and `position: fixed` cannot do that
  // from inside a stacking context - which `.tab-view` creates, because it is
  // animated. So the modal was fixed to its tab rather than to the window, and
  // the header and tab bar drew over the top of it however high its z-index
  // went. A portal is the fix that keeps working when somebody animates
  // something else later.
  return createPortal(
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}
      onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal__box">
        <div className="row row--between" style={{ marginBottom: 10 }}>
          <h2 className="modal__title" style={{ margin: 0 }}>{title}</h2>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close">
            <Icon name="close" size={14} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/** What a confirmation asks, and what its two buttons say. */
export interface ConfirmAsk {
  title: string;
  body?: ReactNode;
  /** The button that does it. */
  action: string;
  /** Red, for something that cannot be undone. */
  danger?: boolean;
}

/**
 * "Are you sure?", drawn by the app rather than the browser.
 *
 * `window.confirm` on a phone is the browser's own box - the site's address
 * across the top, buttons in the system's words, nothing of the app around
 * it. This is the same question in the app's own dialog. `confirm(...)`
 * resolves true for the action, false for cancel, Escape or a tap outside;
 * render `dialog` anywhere in the component.
 */
export function useConfirm() {
  const [asking, setAsking] = useState<ConfirmAsk | null>(null);
  const settle = useRef<((yes: boolean) => void) | null>(null);

  const confirm = useCallback((ask: ConfirmAsk) => new Promise<boolean>((resolve) => {
    settle.current?.(false);
    settle.current = resolve;
    setAsking(ask);
  }), []);

  const answer = useCallback((yes: boolean) => {
    settle.current?.(yes);
    settle.current = null;
    setAsking(null);
  }, []);

  // Leaving with the question open answers it "no", so nothing waits forever.
  useEffect(() => () => settle.current?.(false), []);

  const dialog = asking ? (
    <Modal title={asking.title} onClose={() => answer(false)}>
      <div className="confirm">
        {asking.body && <p className="confirm__body">{asking.body}</p>}
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={() => answer(false)}>Cancel</button>
          <button type="button" className={`btn${asking.danger ? ' btn--danger' : ''}`} autoFocus
            onClick={() => answer(true)}>
            {asking.action}
          </button>
        </div>
      </div>
    </Modal>
  ) : null;

  return { confirm, dialog };
}

/**
 * Somebody's name, as a link to their page.
 *
 * Every reference to a person or a shop is an address, and the one place that
 * decides what happens when there is no address to give. Accounts that predate
 * handles have none, and catalog fixtures were never sign-in accounts at all —
 * those render as plain text rather than as a link to a 404.
 *
 * Which page it opens is decided by whoever built the reference, not here: a
 * seller's name carries the shop's handle, a buyer's carries the person's.
 */
type Tag = { level: number; title: string; shop?: boolean };

export function PersonLink({ party, className, children, bare }: {
  party: { name: string; handle: string | null; level?: Tag } | null | undefined;
  className?: string;
  children?: ReactNode;
  /** Leave the level tagline off, where the name sits inside something that already shows it. */
  bare?: boolean;
}) {
  if (!party) return null;
  const label = children ?? party.name;
  const name = party.handle
    ? <Link to={`/${party.handle}`} className={className ? `${className} personlink` : 'personlink'}>{label}</Link>
    : <span className={className}>{label}</span>;
  if (bare || !party.level) return name;
  // The level reads as a tagline under the name.
  return <span className="pname">{name}<LevelChip tag={party.level} /></span>;
}

/**
 * A level as a tagline: "LV 5 · Collector", the same for buyers and shops,
 * with a Shop mark on a shop. `inline` sits it beside a name on one line.
 */
export function LevelChip({ tag, inline = false }: { tag: Tag | null | undefined; inline?: boolean }) {
  if (!tag) return null;
  return (
    <span className={`lvtag lvtag--l${levelRung(tag.level)}${inline ? ' lvtag--inline' : ''}`} title={`Level ${tag.level} · ${tag.title}`}>
      <span className="lvtag__lv">Lv {tag.level}</span>
      <span className="lvtag__title">{tag.title}</span>
      {tag.shop && <span className="lvtag__shop">Shop</span>}
    </span>
  );
}

/** Which colour a level wears: its own up to ten, then one per titled band. */
function levelRung(level: number): number {
  if (level >= 50) return 50;
  if (level >= 30) return 30;
  if (level >= 20) return 20;
  if (level >= 15) return 15;
  return Math.min(Math.max(Math.floor(level), 1), 10);
}
