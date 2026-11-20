import { TIMED_CHOICES } from '@shared/timed';

/**
 * How long to keep something: a hunt on the Wanted board, a follow on a
 * product. Up to three months; when the time is up it is deleted.
 */
export function TimedPicker({ days, onChange, label }: {
  days: number;
  onChange: (days: number) => void;
  label: string;
}) {
  return (
    <div className="seg seg--timed" role="group" aria-label={label}>
      {TIMED_CHOICES.map((choice) => (
        <button key={choice.days} type="button" className={choice.days === days ? 'is-on' : undefined}
          aria-pressed={choice.days === days} onClick={() => onChange(choice.days)}>
          {choice.label}
        </button>
      ))}
    </div>
  );
}
