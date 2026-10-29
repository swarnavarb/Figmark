import { useId, useState } from 'react';
import { ApiRequestError, api } from '../api';
import { shrink } from './PhotoManager';
import { Icon } from './ui';
import '../styles/PageFields.css';

/**
 * One page picture - a shop's or a person's: uploaded from the device, never
 * typed as a link.
 *
 * Shrunk on the phone first, so a 12 MB camera photo goes up as a few hundred
 * kilobytes, and shown back as it will look on the page.
 */
export function PictureField({ label, hint, value, onChange, shape }: {
  label: string;
  hint: string;
  value: string;
  onChange: (url: string) => void;
  shape: 'square' | 'wide' | 'qr';
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      onChange((await api.uploadStorefrontPhoto(await shrink(file))).url);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That photo did not upload. Try another.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span>{label}</span>
      <div className={`sfpic sfpic--${shape}`}>
        {value
          ? <img loading="lazy" decoding="async" className="sfpic__img" src={value} alt={label} />
          : <span className="sfpic__empty" aria-hidden="true"><Icon name="camera" size={20} /></span>}
        <div className="sfpic__acts">
          <label className={`btn btn--quiet btn--sm sfpic__pick${busy ? ' is-busy' : ''}`}>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={busy}
              onChange={(event) => { void pick(event.target.files?.[0]); event.target.value = ''; }} />
            {busy ? 'Uploading…' : value ? 'Change' : 'Upload photo'}
          </label>
          {value && !busy && (
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => onChange('')}>Remove</button>
          )}
        </div>
      </div>
      {error ? <span className="field__hint" style={{ color: 'var(--danger-text)' }}>{error}</span>
        : <span className="field__hint">{hint}</span>}
    </div>
  );
}

/**
 * Tags as pills: typing a comma (or Enter) turns what was typed into one.
 *
 * Backspace in the empty box takes the last one back off; suggestions below
 * add with a tap. Six at most, 24 characters each - the rule the server keeps.
 */
export function TagInput({ value, onChange, ideas = [], hint, fullHint }: {
  value: string[];
  onChange: (tags: string[]) => void;
  ideas?: string[];
  /** What the tags are for, ahead of how many are left. */
  hint: string;
  /** Shown once six are in. */
  fullHint: string;
}) {
  const labelId = useId();
  const [text, setText] = useState('');
  const full = value.length >= 6;
  const has = (tag: string) => value.some((row) => row.toLowerCase() === tag.toLowerCase());

  const add = (raw: string[]) => {
    const next = [...value];
    for (const piece of raw) {
      const tag = piece.trim().slice(0, 24);
      if (tag && next.length < 6 && !next.some((row) => row.toLowerCase() === tag.toLowerCase())) next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
  };

  const type = (input: string) => {
    if (!input.includes(',')) return setText(input);
    const parts = input.split(',');
    add(parts.slice(0, -1));
    setText(parts[parts.length - 1]!.trimStart());
  };

  const suggestions = ideas.filter((idea) => !has(idea)).slice(0, 8);

  return (
    <div className="field">
      <span id={labelId}>Tags</span>
      <div className="taginput" onClick={(event) => event.currentTarget.querySelector('input')?.focus()}>
        {value.map((tag) => (
          <span key={tag} className="taginput__tag">
            {tag}
            <button type="button" className="taginput__x" aria-label={`Remove ${tag}`}
              onClick={(event) => { event.stopPropagation(); onChange(value.filter((row) => row !== tag)); }}>
              ×
            </button>
          </span>
        ))}
        {!full && (
          <input className="taginput__box" value={text} aria-labelledby={labelId}
            placeholder={value.length === 0 ? 'Type a tag, then a comma' : 'Add another'}
            onChange={(event) => type(event.target.value)}
            onBlur={() => { if (text.trim()) { add([text]); setText(''); } }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                if (text.trim()) { add([text]); setText(''); }
              } else if (event.key === 'Backspace' && !text && value.length > 0) {
                onChange(value.slice(0, -1));
              }
            }} />
        )}
      </div>
      <span className="field__hint">
        {full ? fullHint : `${hint} ${6 - value.length} left.`}
      </span>
      {!full && suggestions.length > 0 && (
        <div className="taginput__ideas" aria-label="Suggested tags">
          {suggestions.map((idea) => (
            <button key={idea} type="button" className="taginput__idea" onClick={() => add([idea])}>+ {idea}</button>
          ))}
        </div>
      )}
    </div>
  );
}
