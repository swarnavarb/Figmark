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

export function haptic(): void {
  try {
    if (typeof navigator.vibrate === 'function' && /Android/.test(navigator.userAgent)) {
      navigator.vibrate(12);
      return;
    }
    if (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)) {
      iosTick();
    }
  } catch {
    // A missing tick is not worth an error.
  }
}
