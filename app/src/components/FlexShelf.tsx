import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HOTSPOT_LABELS, type PostHotspot } from '@shared/social';
import { Icon } from './Icon';

/**
 * A collection photo with its pieces tagged.
 *
 * Drawn at the photo's own shape rather than the feed's square, because the
 * tags are placed on the whole photo and a crop would move them off their
 * pieces. Tap a dot for what it is; a piece for sale opens its item.
 */
export function FlexShelf({ photos, hotspots, alt, onOpen }: {
  photos: string[];
  hotspots: PostHotspot[];
  alt: string;
  onOpen: (index: number) => void;
}) {
  const [at, setAt] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const here = hotspots.map((spot, index) => ({ spot, index })).filter(({ spot }) => spot.photo === at);
  const counts = hotspots.reduce<Record<string, number>>((all, spot) => ({ ...all, [spot.status]: (all[spot.status] ?? 0) + 1 }), {});

  return (
    <div className="flexshelf">
      <div className="flexshelf__frame">
        <img src={photos[at]} alt={alt} loading="lazy" draggable={false} onClick={() => onOpen(at)}
          role="button" tabIndex={0} aria-label={`${alt || 'Photo'} - open full screen`}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen(at); } }} />
        {here.map(({ spot, index }) => (
          <span key={index} className="flexshelf__spot" style={{ left: `${spot.x * 100}%`, top: `${spot.y * 100}%` }}>
            <button type="button" className={`hotdot hotdot--${spot.status}${open === index ? ' is-open' : ''}`}
              aria-label={`${spot.label}: ${HOTSPOT_LABELS[spot.status]}`} aria-expanded={open === index}
              onClick={() => setOpen(open === index ? null : index)}>
              <span aria-hidden="true">{index + 1}</span>
            </button>
            {open === index && (
              <span className={`flexshelf__tip${spot.x > 0.6 ? ' flexshelf__tip--left' : ''}`} role="status">
                <strong>{spot.label}</strong>
                <span className={`hotchip hotchip--${spot.status} is-on`}>{HOTSPOT_LABELS[spot.status]}</span>
                {spot.listingId && (
                  <Link to={`/listing/${encodeURIComponent(spot.listingId)}`} className="flexshelf__go">
                    {spot.status === 'for_sale' ? 'View listing' : 'See it on Figmark'} <Icon name="right" size={11} />
                  </Link>
                )}
              </span>
            )}
          </span>
        ))}
        {photos.length > 1 && <span className="carousel__count">{at + 1}/{photos.length}</span>}
      </div>
      {photos.length > 1 && (
        <div className="flexshelf__thumbs">
          {photos.map((url, index) => (
            <button key={`${url}-${index}`} type="button" className={`flexshelf__thumb${index === at ? ' is-on' : ''}`}
              aria-label={`Photo ${index + 1}`} onClick={() => { setAt(index); setOpen(null); }}>
              <img src={url} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {hotspots.length > 0 && (
        <p className="flexshelf__legend">
          <Icon name="tag" size={12} /> {hotspots.length} tagged
          {(['owned', 'wishlist', 'for_sale'] as const).filter((status) => counts[status]).map((status) => (
            <span key={status} className={`hotchip hotchip--${status} is-on`}>{counts[status]} {HOTSPOT_LABELS[status]}</span>
          ))}
        </p>
      )}
    </div>
  );
}
