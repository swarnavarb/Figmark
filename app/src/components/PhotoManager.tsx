import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { ApiRequestError, api, type PhotoDraft } from '../api';
import { Icon } from './Icon';
import { compressImage } from '../imageCompress';

/**
 * Every picture goes through here before it leaves the browser: compressed to
 * 70-90 KB, keeping the smaller of the original and the compressed one. The
 * work is in `imageCompress.ts`; the name stays because a dozen places call it.
 */
export const shrink = (file: Blob): Promise<string> => compressImage(file);

/**
 * The photos on a listing: add, delete, reorder, and pick the one that leads.
 *
 * Order is the whole feature. The first photo is what the buy page shows and
 * what somebody decides on in half a second, so "which one is first" is a
 * decision a seller makes deliberately - by dragging on a pointer, or with the
 * arrows, which are the only ones that work on a phone.
 */
export function PhotoManager({ photos, onChange, label = 'Item photos' }: {
  photos: PhotoDraft[];
  onChange: (next: PhotoDraft[]) => void;
  /** Null inside a box that already says what this is. */
  label?: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  /** Exactly one primary, always: the first unless somebody said otherwise. */
  const commit = (next: PhotoDraft[]) => {
    const chosen = next.findIndex((photo) => photo.isPrimary);
    const primary = chosen >= 0 ? chosen : 0;
    onChange(next.map((photo, index) => ({ ...photo, isPrimary: index === primary })));
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length || from === to) return;
    const next = [...photos];
    const [taken] = next.splice(from, 1);
    next.splice(to, 0, taken!);
    commit(next);
  };

  async function add(event: ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;
    setBusy(true);
    setError(null);
    const added: PhotoDraft[] = [];
    try {
      for (const file of files.slice(0, 6 - photos.length)) {
        const stored = await api.uploadPhoto(await shrink(file));
        added.push({ ...stored, isPrimary: false });
      }
      commit([...photos, ...added]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That photo did not upload.');
    } finally {
      setBusy(false);
      // Cleared so choosing the same file twice still fires a change.
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const onDrop = (event: DragEvent, index: number) => {
    event.preventDefault();
    if (dragging !== null) move(dragging, index);
    setDragging(null);
  };

  return (
    <div className="field">
      {label && <span>{label}</span>}
      <div className="photos">
        {photos.map((photo, index) => (
          <figure
            key={photo.url}
            className={`photo${photo.isPrimary ? ' is-primary' : ''}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => onDrop(event, index)}
            draggable
            onDragStart={() => setDragging(index)}
            onDragEnd={() => setDragging(null)}
          >
            <img src={photo.url} alt={`Item photo ${index + 1}`} />
            {photo.isPrimary && <figcaption>Main</figcaption>}
            <div className="photo__acts">
              <button type="button" className="iconbtn" aria-label={`Move photo ${index + 1} left`}
                disabled={index === 0} onClick={() => move(index, index - 1)}><Icon name="left" size={13} /></button>
              <button type="button" className="iconbtn" aria-label={`Make photo ${index + 1} the main one`}
                onClick={() => commit(photos.map((row, i) => ({ ...row, isPrimary: i === index })))}><Icon name="star" size={13} /></button>
              <button type="button" className="iconbtn" aria-label={`Move photo ${index + 1} right`}
                disabled={index === photos.length - 1} onClick={() => move(index, index + 1)}><Icon name="right" size={13} /></button>
              <button type="button" className="iconbtn iconbtn--danger" aria-label={`Delete photo ${index + 1}`}
                onClick={() => commit(photos.filter((_, i) => i !== index))}><Icon name="close" size={13} /></button>
            </div>
          </figure>
        ))}

        {photos.length < 6 && (
          <button type="button" className="photo photo--add" disabled={busy}
            onClick={() => fileInput.current?.click()}>
            <span aria-hidden="true">{busy ? '…' : '+'}</span>
            <span className="faint">{busy ? 'Uploading' : 'Upload'}</span>
          </button>
        )}
      </div>

      <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={(event) => void add(event)} />
      <span className="field__hint">
        Up to six. The first is what buyers see — drag it, or use the arrows.
      </span>
      {error && <span className="field__hint" style={{ color: 'var(--danger)' }}>{error}</span>}
    </div>
  );
}
