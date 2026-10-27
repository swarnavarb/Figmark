import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Modal, type ConfirmAsk } from './ui';

/**
 * "Are you sure?" and "type a reference", asked in the app's own dialog from
 * anywhere - an event handler, a callback - with no dialog to render first.
 *
 * Replaces `window.confirm` and `window.prompt`: on a phone those are the
 * browser's own boxes, with the site's address across the top and buttons in
 * the system's words. `useConfirm` is the same question for a component that
 * renders its own; this one mounts itself and goes when answered.
 */
function mount<T>(render: (settle: (value: T) => void) => JSX.Element): Promise<T> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const settle = (value: T) => {
      root.unmount();
      host.remove();
      resolve(value);
    };
    root.render(render(settle));
  });
}

/** True for the action, false for cancel, Escape or a tap outside. */
export function confirmAsk(ask: ConfirmAsk): Promise<boolean> {
  return mount<boolean>((answer) => (
    <Modal title={ask.title} onClose={() => answer(false)}>
      <div className="confirm">
        {ask.body && <p className="confirm__body">{ask.body}</p>}
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={() => answer(false)}>Cancel</button>
          <button type="button" className={`btn${ask.danger ? ' btn--danger' : ''}`} autoFocus onClick={() => answer(true)}>
            {ask.action}
          </button>
        </div>
      </div>
    </Modal>
  ));
}

export interface TextAsk {
  title: string;
  body?: string;
  label: string;
  action: string;
  initial?: string;
  placeholder?: string;
}

function TextDialog({ ask, answer }: { ask: TextAsk; answer: (value: string | null) => void }) {
  const [value, setValue] = useState(ask.initial ?? '');
  return (
    <Modal title={ask.title} onClose={() => answer(null)}>
      <form className="confirm" onSubmit={(event) => { event.preventDefault(); answer(value.trim()); }}>
        {ask.body && <p className="confirm__body">{ask.body}</p>}
        <label className="field">
          <span>{ask.label}</span>
          <input value={value} onChange={(event) => setValue(event.target.value)} placeholder={ask.placeholder} />
        </label>
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={() => answer(null)}>Cancel</button>
          <button type="submit" className="btn">{ask.action}</button>
        </div>
      </form>
    </Modal>
  );
}

/** What was typed (possibly empty), or null when cancelled. */
export function askText(ask: TextAsk): Promise<string | null> {
  return mount<string | null>((answer) => <TextDialog ask={ask} answer={answer} />);
}

/**
 * Asked as a plain sentence: the question up to its first "?" is the title,
 * the rest the explanation, and the button is named by the verb it opens with.
 */
export function confirmSentence(sentence: string): Promise<boolean> {
  const cut = sentence.indexOf('?');
  const title = cut === -1 ? sentence : sentence.slice(0, cut + 1);
  const body = cut === -1 ? undefined : sentence.slice(cut + 1).trim() || undefined;
  const verb = /^(Delete|Remove|Expire|Replace|Put back|Leave|Close|Update)\b/.exec(title)?.[1] ?? 'OK';
  return confirmAsk({ title, body, action: verb, danger: ['Delete', 'Remove', 'Expire', 'Leave'].includes(verb) });
}
