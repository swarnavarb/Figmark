import type { OrderCheckpoint } from '@shared/enums';
import { KIT_WHO_META, type KitButton } from '@shared/flows';
import { renderStepText, type RouteStep } from '@shared/routes';

/**
 * One item's buttons, from its kit.
 *
 * Two looks for the two places an item is worked: `chip`, the small toggles
 * on an order card under Items (before the lot), and `tile`, the grid on a
 * lot's item row (after it is unpacked). Same buttons, same rules - the next
 * one to press is lit, delivered asks first - wherever they are drawn,
 * including the flow builder's previews, which draw them with this.
 */
export function KitButtons({ buttons, checkpoints, look, busy = false, steps, vars, onPress, onRequestDeliver }: {
  buttons: KitButton[];
  checkpoints: Partial<Record<OrderCheckpoint, string | null>> | undefined;
  look: 'chip' | 'tile';
  busy?: boolean;
  /** The route the item rides, to say which step each tile moves it to. */
  steps?: RouteStep[];
  /** The lot's origin and destination, for any `{origin}` a step's name carries. */
  vars?: { origin?: string | null; destination?: string | null };
  onPress: (checkpoint: OrderCheckpoint, on: boolean) => void;
  /** Delivered is the one press that asks first; absent means it does not. */
  onRequestDeliver?: () => void;
}) {
  const done = (entry: KitButton) => Boolean(checkpoints?.[entry.checkpoint]);
  /** The first one not pressed yet: where the work is. */
  const next = buttons.find((entry) => !done(entry))?.checkpoint;

  return (
    <>
      {buttons.map((entry) => {
        const on = done(entry);
        const who = KIT_WHO_META[entry.who];
        const press = () => (entry.checkpoint === 'delivered' && !on && onRequestDeliver
          ? onRequestDeliver()
          : onPress(entry.checkpoint, !on));
        const title = `${who.label}: ${entry.label}. The buyer reads “${entry.step}”.${on ? ' Tap to undo.' : ''}`;

        if (look === 'chip') {
          return (
            <button key={entry.checkpoint} type="button" disabled={busy} aria-pressed={on} title={title}
              className={`orow__toggle kitbtn${on ? ' is-on' : ''}${entry.checkpoint === next ? ' is-next' : ''}`}
              onClick={press}>
              <span aria-hidden="true">{on ? '✓' : entry.icon}</span>
              <span>{entry.label}</span>
            </button>
          );
        }
        const moves = steps?.find((step) => step.trigger === entry.checkpoint);
        return (
          <button key={entry.checkpoint} type="button" disabled={busy} aria-pressed={on} title={title}
            className={`tickbtn kittile${on ? ' is-on' : ''}${entry.checkpoint === next ? ' is-next' : ''}${entry.checkpoint === 'delivered' ? ' tickbtn--delivered' : ''}`}
            onClick={press}>
            <span className="kittile__who" aria-hidden="true">{who.icon}</span>
            {entry.label}
            {moves && <span className="tickbtn__to">{renderStepText(moves.name, vars ?? {})}</span>}
          </button>
        );
      })}
    </>
  );
}
