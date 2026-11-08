/**
 * A spinner on the button you just pressed, while it works.
 *
 * Most buttons in the app are `disabled={busy}` while their request is out,
 * and on a slow connection a greyed-out button reads as a frozen one. Rather
 * than thread a busy prop through three hundred buttons, this watches the
 * one that was pressed: if it turns disabled within a moment of the press,
 * it is the one doing the work, so it gets `data-working` (styles.css draws
 * the spinner) until it is enabled again. Buttons disabled for any other
 * reason were never pressed, so they never spin.
 *
 * A button that stays disabled for good after its press (a step that is now
 * done) stops spinning after a while rather than spinning forever.
 */

const GIVE_UP_MS = 20_000;

let watching: { button: HTMLButtonElement; observer: MutationObserver; timer: number } | null = null;

function stop(): void {
  if (!watching) return;
  watching.observer.disconnect();
  window.clearTimeout(watching.timer);
  watching.button.removeAttribute('data-working');
  watching = null;
}

function watch(button: HTMLButtonElement): void {
  stop();
  const observer = new MutationObserver(() => {
    if (!button.isConnected) {
      stop();
      return;
    }
    if (button.disabled) button.setAttribute('data-working', '');
    else stop();
  });
  observer.observe(button, { attributes: true, attributeFilter: ['disabled'] });
  watching = { button, observer, timer: window.setTimeout(stop, GIVE_UP_MS) };
  // Most presses that do nothing slow never disable the button at all: let go
  // of those quickly so the observer is not left hanging on every tap.
  window.setTimeout(() => {
    if (watching?.button === button && !button.disabled) stop();
  }, 600);
}

export function listenForPresses(): void {
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target.closest('button.btn') : null;
    if (target instanceof HTMLButtonElement && !target.disabled) watch(target);
  }, true);
}
