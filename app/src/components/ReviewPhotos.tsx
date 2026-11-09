import { useRef, useState } from 'react';
import { REVIEW_PHOTO_MAX } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { Icon } from './Icon';
import { shrink } from './PhotoManager';
import { Lightbox } from './SocialPost';

/**
 * Photos with a review - verified or left on a page.
 *
 * Every one is compressed in the browser (`shrink`, 70-90 KB) before it is
 * uploaded, and a review carries at most `REVIEW_PHOTO_MAX`. Several can be
 * picked at once; whatever would go over the limit is left out and said so.
 */
export function ReviewPhotoPicker({ value, onChange, disabled = false }: {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** Uploaded in this form, so taking one out again can throw the upload away. */
  const fresh = useRef(new Set<string>());
  const latest = useRef(value);
  latest.current = value;
  const room = REVIEW_PHOTO_MAX - value.length - busy;

  async function pick(files: File[]) {
    setError(null);
    const take = files.filter((file) => file.type.startsWith('image/')).slice(0, Math.max(0, room));
    if (files.length > take.length) setError(`Up to ${REVIEW_PHOTO_MAX} photos on a review.`);
    if (take.length === 0) return;
    setBusy((n) => n + take.length);
    for (const file of take) {
      try {
        const { url } = await api.uploadPhoto(await shrink(file));
        fresh.current.add(url);
        latest.current = [...latest.current, url].slice(0, REVIEW_PHOTO_MAX);
        onChange(latest.current);
      } catch (err) {
        setError(err instanceof ApiRequestError ? err.message : 'That photo did not upload.');
      } finally {
        setBusy((n) => n - 1);
      }
    }
  }

  function remove(url: string) {
    onChange(value.filter((each) => each !== url));
    if (fresh.current.delete(url)) void api.discardPhoto(url);
  }

  return (
    <div className="revphotos">
      {value.map((url) => (
        <figure key={url} className="revphotos__item">
          <img src={url} alt="" loading="lazy" decoding="async" />
          <button type="button" className="revphotos__drop" aria-label="Remove photo" disabled={disabled}
            onClick={() => remove(url)}>
            <Icon name="close" size={12} />
          </button>
        </figure>
      ))}
      {Array.from({ length: busy }, (_, i) => <span key={`busy-${i}`} className="revphotos__item revphotos__item--busy" aria-hidden="true" />)}
      {room > 0 && (
        <label className={`revphotos__add${disabled ? ' is-off' : ''}`}>
          <input type="file" accept="image/*" multiple disabled={disabled}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              void pick(files);
            }} />
          <Icon name="camera" size={16} />
          <span>{value.length === 0 ? 'Add photos' : `${value.length}/${REVIEW_PHOTO_MAX}`}</span>
        </label>
      )}
      {error && <span className="revphotos__error">{error}</span>}
    </div>
  );
}

/** A review's photos as a row of thumbnails; one tap opens them full screen. */
export function ReviewPhotoStrip({ photos, about }: { photos?: string[]; about?: string }) {
  const [open, setOpen] = useState<{ at: number; origin: DOMRect } | null>(null);
  if (!photos || photos.length === 0) return null;
  return (
    <div className="revphotos" role="group" aria-label="Photos with this review">
      {photos.map((url, at) => (
        <button key={url} type="button" className="revphotos__item revphotos__open" aria-label={`Open photo ${at + 1} of ${photos.length}`}
          onClick={(event) => setOpen({ at, origin: event.currentTarget.getBoundingClientRect() })}>
          <img src={url} alt="" loading="lazy" decoding="async" />
        </button>
      ))}
      {open && (
        <Lightbox photos={photos} start={open.at} origin={open.origin} about={about} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
