import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { brandHueFor, gradientFor, initialsOf } from '../format';

/** Inline icons. Kept as a small set so no icon dependency is needed. */
export function Icon({ name, size = 16 }: { name: 'search' | 'heart' | 'plus' | 'back' | 'check'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    heart: <path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="M15 19l-7-7 7-7" />,
    check: <path d="m5 13 4 4L19 7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'heart' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

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
      ★ {score}
      {tier === 'pro' && ' · Pro'}
    </span>
  );
}

export function EmptyState({ icon = '◍', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return <p className="notice notice--error">{message}</p>;
}

/**
 * Live fill progress for a group-buy lot.
 *
 * The bar gets warmer as the lot fills and lights up when it is there: a run
 * at 29 of 30 should feel different from one at 3 of 30, and the number alone
 * was not carrying that. The thresholds are coarse on purpose - four states
 * rather than a continuous ramp, so the change is something you notice rather
 * than something only a colour picker could find.
 */
export function fillToneOf(percent: number): string {
  if (percent >= 100) return ' is-full';
  if (percent >= 80) return ' is-hot';
  if (percent >= 45) return ' is-warm';
  return '';
}

export function LotMeter({ filled, threshold }: { filled: number; threshold: number }) {
  const percent = Math.min(100, Math.round((filled / Math.max(1, threshold)) * 100));
  return (
    <div
      className={`meter${fillToneOf(percent)}`}
      role="img"
      aria-label={`${percent}% filled`}
    >
      {/* Scaled rather than resized: animating width relayouts the page on
          every frame, and a transform does not. */}
      <div className="meter__fill" style={{ '--fill': percent / 100 } as CSSProperties} />
    </div>
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
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
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
export function PersonLink({ party, className, children }: {
  party: { name: string; handle: string | null } | null | undefined;
  className?: string;
  children?: ReactNode;
}) {
  if (!party) return null;
  const label = children ?? party.name;
  if (!party.handle) return <span className={className}>{label}</span>;
  return (
    <Link to={`/${party.handle}`} className={className ? `${className} personlink` : 'personlink'}>
      {label}
    </Link>
  );
}
