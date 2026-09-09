import { useEffect, useState, type ReactNode } from 'react';

/**
 * The dialog in front of anything irreversible.
 *
 * Two things make it worth more than a `confirm()`. It names what will actually
 * happen — the counts, not "this item" — because an operator about to delete an
 * account should be reading the size of it as they decide. And a destructive
 * confirmation is typed rather than clicked: a button you can hit by reflex is
 * not a confirmation, it is a second click in the same place.
 */
export function Confirm({ title, children, confirmWord, confirmLabel, onConfirm, onCancel, busy }: {
  title: string;
  children: ReactNode;
  /** When set, the operator must type this word before the action unlocks. */
  confirmWord?: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [typed, setTyped] = useState('');

  // Escape cancels, because the safe way out of a destructive dialog should be
  // the one people reach for without thinking.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const unlocked = !confirmWord || typed.trim().toUpperCase() === confirmWord.toUpperCase();

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}
      onClick={(event) => event.target === event.currentTarget && onCancel()}>
      <div className="modal__box">
        <h2 className="modal__title">{title}</h2>
        <div className="modal__body">{children}</div>

        {confirmWord && (
          <label className="field">
            <span>Type <code>{confirmWord}</code> to confirm</span>
            <input value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus
              autoCapitalize="characters" autoCorrect="off" spellCheck={false} />
          </label>
        )}

        <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
          <button type="button" className="btn btn--danger" disabled={!unlocked || busy}
            onClick={() => void onConfirm()}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
