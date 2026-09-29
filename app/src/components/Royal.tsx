import { useState, type ReactNode } from 'react';
import { Lightbox } from './SocialPost';

/**
 * The listing's quiet dress: hairline gold, a little ornament, photos that
 * open out of where they sit. Everything here is drawn in SVG so it stays
 * crisp at any size and takes its colour from `currentColor`.
 */

/** A hairline rule with a diamond at its centre, to part one section from the next. */
export function Ornament({ className = '' }: { className?: string }) {
  return (
    <svg className={`ornament ${className}`} viewBox="0 0 240 14" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <path className="ornament__line" d="M0 7 H104 M136 7 H240" />
      <path d="M120 1 L126 7 L120 13 L114 7 Z" fill="none" />
      <circle cx="120" cy="7" r="1.6" fill="currentColor" />
      <circle cx="108" cy="7" r="1" fill="currentColor" />
      <circle cx="132" cy="7" r="1" fill="currentColor" />
    </svg>
  );
}

/** A check that draws itself in. */
export function DrawnCheck({ size = 14 }: { size?: number }) {
  return (
    <svg className="drawn-check" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 8.5 L6.5 12 L13 4.5" fill="none" />
    </svg>
  );
}

/** A small crown, the mark of the thing being the one to watch. */
export function Crown({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinejoin="round">
      <path d="M3 8 L7.5 12 L12 5 L16.5 12 L21 8 L19 18 H5 Z" />
      <path d="M5 21 H19" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Every photo a listing has, not only the first: a framed stage, a strip of
 * thumbnails under it, and a tap on the stage opens it full screen, growing
 * out of the frame it was in.
 */
export function Gallery({ photos, title, fallback, children }: {
  photos: string[];
  title: string;
  /** What stands in when there are no photos at all. */
  fallback: ReactNode;
  /** Badges laid over the stage. */
  children?: ReactNode;
}) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<DOMRect | null>(null);

  if (photos.length === 0) return <div className="gallery"><div className="gallery__stage">{fallback}{children}</div></div>;

  return (
    <div className="gallery">
      <button type="button" className="gallery__stage" aria-label={`Open photo ${at + 1} of ${photos.length} full screen`}
        onClick={(event) => setOpen((event.currentTarget.querySelector('.gallery__img') as HTMLElement).getBoundingClientRect())}>
        {photos.map((url, index) => (
          <img key={url + index} src={url} alt={index === at ? title : ''} loading={index === 0 ? 'eager' : 'lazy'}
            className={`gallery__img${index === at ? ' is-on' : ''}`} />
        ))}
        <span className="gallery__zoom" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
            <path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7" />
          </svg>
        </span>
        {children}
      </button>

      {photos.length > 1 && (
        <div className="gallery__strip" role="tablist" aria-label="Photos">
          {photos.map((url, index) => (
            <button key={url + index} type="button" role="tab" aria-selected={index === at}
              className={`gallery__thumb${index === at ? ' is-on' : ''}`} onClick={() => setAt(index)}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}

      {open && (
        <Lightbox photos={photos} start={at} origin={open} royal title={title}
          onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
