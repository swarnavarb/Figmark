import { useEffect, useState } from 'react';
import type { FoundThing } from '../photoThings';
import { haptic } from '../haptics';

/**
 * "Scan with AI": the closer reading of a photo the phone's own detector
 * could not make sense of - boxes packed edge to edge, a crowded shelf - by a
 * vision model through the person's own free Puter account. The same button
 * on the sell form and in photo search, so a photo reads the same in both.
 */
export function AiScan({ photoUrl, onFound, hint }: {
  photoUrl: string;
  /** Every item the AI found, each with its box and a name. */
  onFound: (things: FoundThing[]) => void;
  /** What to say beside the button, or the default. */
  hint?: string;
}) {
  const [state, setState] = useState<{ photoUrl: string; busy: boolean; note: string | null; done: number | null }>({ photoUrl, busy: false, note: null, done: null });
  const now = state.photoUrl === photoUrl ? state : { photoUrl, busy: false, note: null, done: null };

  // Puter's script is fetched before the tap, so the tap opens its sign-in window straight away.
  useEffect(() => {
    const idle = window.setTimeout(() => { void import('../puterVision').then((module) => module.warmPuter()); }, 1500);
    return () => window.clearTimeout(idle);
  }, []);

  const scan = () => {
    if (now.busy) return;
    haptic('tap');
    setState({ photoUrl, busy: true, note: null, done: null });
    void import('../puterVision')
      .then((module) => module.scanWithAI(photoUrl))
      .then((things) => {
        onFound(things);
        setState({ photoUrl, busy: false, note: null, done: things.length });
      })
      .catch((error: Error) => setState({ photoUrl, busy: false, note: error.message, done: null }));
  };

  return (
    <div className="aiscan">
      <button type="button" className="btn btn--quiet btn--sm aiscan__go" onClick={scan} disabled={now.busy} aria-busy={now.busy}>
        {now.busy ? <><span className="pcs-spin" aria-hidden="true" /> Scanning with AI…</> : <>✨ {now.done != null ? 'Scan again with AI' : 'Scan with AI'}</>}
      </button>
      <span className="aiscan__hint">
        {now.note
          ?? (now.done != null
            ? `The AI found ${now.done} ${now.done === 1 ? 'item' : 'items'}.`
            : hint ?? 'Missed some? A closer look by AI, free with a Puter account.')}
      </span>
    </div>
  );
}
