import { useState } from 'react';
import { ApiRequestError, api, type NudgeRequest } from '../api';

/**
 * One tap to send a buyer a friendly reminder through their bell.
 *
 * The server allows one per thing per day, so the button says so rather than
 * pretending a second tap did anything.
 */
export function NudgeButton({ request, shop, label = '🔔 Remind' }: {
  request: NudgeRequest; shop?: string; label?: string;
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [note, setNote] = useState<string | null>(null);

  async function send() {
    setState('busy');
    setNote(null);
    try {
      await api.nudge(request, shop);
      setState('sent');
    } catch (err) {
      setState('idle');
      setNote(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    }
  }

  return (
    <span className="nudge">
      <button type="button" className="btn btn--ghost btn--sm" disabled={state !== 'idle'} onClick={() => void send()}>
        {state === 'sent' ? '✓ Reminded' : state === 'busy' ? 'Sending…' : label}
      </button>
      {note && <small className="nudge__note">{note}</small>}
    </span>
  );
}
