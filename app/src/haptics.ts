/**
 * A small tap you feel, for the moment a gesture "catches".
 *
 * Android has the Vibration API. iPhones do not, but since iOS 18 Safari ticks
 * when a switch-style checkbox is toggled, so a hidden one is toggled instead.
 * Anywhere neither works this does nothing, which is the right fallback for a
 * nicety.
 */

let iosSwitch: HTMLLabelElement | null = null;

function iosTick(): void {
  if (!iosSwitch) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none;';
    document.body.appendChild(label);
    iosSwitch = label;
  }
  iosSwitch.click();
}

/**
 * What the tap is saying. `tap` is the light catch of a gesture; `success`
 * is the double beat of something done (an order placed, an item live);
 * `error` a longer buzz for something that did not go through.
 */
export type HapticKind = 'tap' | 'success' | 'error';

const ANDROID: Record<HapticKind, number | number[]> = {
  tap: 12,
  success: [14, 70, 22],
  error: [30, 60, 30, 60, 30],
};

export function haptic(kind: HapticKind = 'tap'): void {
  try {
    if (typeof navigator.vibrate === 'function' && /Android/.test(navigator.userAgent)) {
      navigator.vibrate(ANDROID[kind]);
      return;
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)) {
      iosTick();
      // iOS has one tick and no patterns: a second, a beat later, reads as a double.
      if (kind !== 'tap') window.setTimeout(iosTick, kind === 'success' ? 110 : 90);
    }
  } catch {
    // A missing tick is not worth an error.
  }
}
