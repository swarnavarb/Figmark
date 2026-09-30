import { useEffect, useState } from 'react';

/**
 * Which look the tracking screens use.
 *
 * `quest` is the game board: levels, XP and badges for the same steps.
 * `classic` is the plain ladder it replaced, kept whole so the switch is one
 * tap for a person and one constant for the shop - change the default below
 * to put every screen back on the classic look.
 */
export type TrackStyle = 'quest' | 'classic';

export const DEFAULT_TRACK_STYLE: TrackStyle = 'quest';

const KEY = 'figmark.trackStyle';
const EVENT = 'figmark:track-style';

function read(): TrackStyle {
  try {
    const stored = window.localStorage.getItem(KEY);
    return stored === 'quest' || stored === 'classic' ? stored : DEFAULT_TRACK_STYLE;
  } catch {
    return DEFAULT_TRACK_STYLE;
  }
}

/** The viewer's choice, remembered on this device, shared by every tracking card on screen. */
export function useTrackStyle(): [TrackStyle, (next: TrackStyle) => void] {
  const [style, setStyle] = useState<TrackStyle>(read);

  useEffect(() => {
    const sync = () => setStyle(read());
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  function change(next: TrackStyle) {
    try { window.localStorage.setItem(KEY, next); } catch { /* private mode: this session only */ }
    setStyle(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return [style, change];
}
