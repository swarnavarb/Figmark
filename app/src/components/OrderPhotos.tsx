import { useState } from 'react';
import type { OrderPhoto, PhotoAudience } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { shrink } from './PhotoManager';
import { Lightbox } from './SocialPost';
import { Icon, useConfirm } from './ui';
import '../styles/OrderPhotos.css';

const AUDIENCE_LABEL: Record<PhotoAudience, string> = { buyer: 'Customer', supplier: 'Supplier', handler: 'Handler' };

/**
 * Photos of one order on its way.
 *
 * Never the listing's: this is the piece itself, in somebody's hand. Anyone
 * working the order can add one; the seller sees them all and decides, photo
 * by photo, who else does - the buyer on their timeline, the supplier, the
 * handler. `audiences` is the choice the seller is offered: a lot with no
 * handler tagged has nobody to show the handler.
 */
export function OrderPhotos({ orderId, photos, onChange, seller = false, audiences = ['buyer', 'supplier', 'handler'], me, readOnly = false, compact = false }: {
  orderId: string;
  photos: OrderPhoto[];
  onChange: (photos: OrderPhoto[]) => void;
  /** The shop: sees every photo and sets who else does. */
  seller?: boolean;
  audiences?: readonly PhotoAudience[];
  /** The viewer, so the crew can take down their own photos. */
  me?: string;
  /** Only to look at - the buyer's timeline. */
  readOnly?: boolean;
  /** Small thumbnails and a camera-only add button, for a slim row. */
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The photo open full screen, and the thumbnail it grows out of. */
  const [open, setOpen] = useState<{ at: number; origin: DOMRect } | null>(null);
  const { confirm, dialog } = useConfirm();

  async function run(fn: () => Promise<OrderPhoto[]>) {
    setBusy(true);
    setError(null);
    try {
      onChange(await fn());
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(photo: OrderPhoto, who: PhotoAudience) {
    const next = photo.showTo.includes(who) ? photo.showTo.filter((each) => each !== who) : [...photo.showTo, who];
    void run(async () => (await api.showOrderPhoto(orderId, photo.id, next)).photos);
  }

  return (
    <div className={`ophotos${compact ? ' ophotos--compact' : ''}`}>
      {photos.map((photo) => (
        <figure key={photo.id} className="ophotos__item">
          <button type="button" className="ophotos__open" aria-label="Open photo full screen"
            onClick={(event) => setOpen({ at: photos.indexOf(photo), origin: event.currentTarget.getBoundingClientRect() })}>
            <img src={photo.url} alt="Photo of this order" loading="lazy" />
          </button>
          {seller && !compact && (
            <figcaption className="ophotos__who">
              {audiences.map((who) => (
                <button key={who} type="button" disabled={busy} aria-pressed={photo.showTo.includes(who)}
                  className={`ophotos__chip${photo.showTo.includes(who) ? ' is-on' : ''}`}
                  onClick={() => toggle(photo, who)}>
                  {AUDIENCE_LABEL[who]}
                </button>
              ))}
            </figcaption>
          )}
          {!readOnly && (seller || photo.addedBy === me) && (
            <button type="button" className="ophotos__drop" disabled={busy} aria-label="Remove photo"
              onClick={() => void (async () => {
                const yes = await confirm({
                  title: 'Delete this photo?',
                  body: 'It is deleted for good, for everyone it was shown to.',
                  action: 'Delete',
                  danger: true,
                });
                if (yes) await run(async () => (await api.removeOrderPhoto(orderId, photo.id)).photos);
              })()}>
              <Icon name="close" size={12} />
            </button>
          )}
        </figure>
      ))}
      {!readOnly && <label className={`ophotos__add${busy ? ' is-busy' : ''}`} aria-label={compact ? (busy ? 'Saving photo' : 'Add a photo') : undefined}>
        <input type="file" accept="image/*" disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void run(async () => (await api.addOrderPhoto(orderId, await shrink(file))).photos);
          }} />
        <Icon name="camera" size={16} />
        {!compact && <span>{busy ? 'Saving…' : 'Photo'}</span>}
      </label>}
      {error && <span className="ophotos__error">{error}</span>}
      {open && (
        <Lightbox photos={photos.map((photo) => photo.url)} start={open.at} origin={open.origin} royal
          onClose={() => setOpen(null)} />
      )}
      {dialog}
    </div>
  );
}
