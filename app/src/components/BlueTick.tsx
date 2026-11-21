import { useToast } from './Feedback';

/**
 * The tick itself, as a button: inside a card that is a link, a tap shows
 * what it means instead of opening the card.
 */
export function BlueTick({ size = 20, label, note }: { size?: number; label: string; note: string }) {
  const toast = useToast();
  return (
    <button type="button" className="vtick" title={label} aria-label={`${label}. Tap for details.`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        toast(note, 'ok');
      }}>
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
        <path fill="#1D9BF0" d="m12 1.6 2.6 1.9 3.2-.1 1 3 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3-3.2-.1L12 22.4l-2.6-1.9-3.2.1-1-3-2.6-1.9 1-3.1-1-3.1 2.6-1.9 1-3 3.2.1Z" />
        <path fill="none" stroke="#fff" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" d="m7.8 12.2 2.9 2.9 5.5-5.6" />
      </svg>
    </button>
  );
}
