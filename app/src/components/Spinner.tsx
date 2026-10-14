/**
 * A ring turning in place: the button it sits in has been pressed and the
 * work is under way. It fades in after a beat, so a save that lands at once
 * never flickers one.
 */
export function Spinner({ size = 18, label = 'Working…' }: { size?: number; label?: string }) {
  return (
    <span className="spinner" role="status" aria-label={label} style={{ width: size, height: size }}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle className="spinner__track" cx="12" cy="12" r="9.5" />
        <circle className="spinner__arc" cx="12" cy="12" r="9.5" />
      </svg>
    </span>
  );
}
