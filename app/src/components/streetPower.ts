import { useEffect, type RefObject } from 'react';
import { reducedMotion } from '../motion';

/**
 * Keeps the lite street (streetMode.ts) light on the battery.
 *
 * - It plays for a while once it comes into view, then rests: everything stops
 *   where it is (data-resting) until the street is tapped, its row is
 *   scrolled, or it comes back into view.
 * - The slow parts of the day - the skies fading, stars, lamps, the sun and
 *   moon, the heading's colour - move on one timer a few times a second
 *   instead of on every frame; nobody can see a change that slow any faster.
 * - On a weaker phone, with data saver on, or with the battery low and not
 *   charging, the street is calmer (data-calm): people glide in one pose,
 *   the slow parts move once a second, and it rests sooner.
 *
 * Coming back to it, the day picks up where the clock has got to.
 */
const DAY_MS = 96_000;
const REST_MS = 20_000;
const CALM_REST_MS = 10_000;
const TICK_MS = 250;
const CALM_TICK_MS = 1_000;

/** The day's slow changes, stepped by the timer rather than drawn every frame. */
const SLOW = new Set([
  'scene-day', 'scene-night', 'scene-stars', 'scene-lights', 'scene-lamps',
  'scene-moon', 'scene-arc', 'scene-sun', 'scene-clouds', 'scene-ink', 'scene-ink-soft', 'van-beam',
]);
/** The day's quicker passers-by - van, plane, birds, comets - which keep moving smoothly. */
const DAILY = new Set(['street-van', 'scene-plane', 'scene-birds', 'scene-comet', 'scene-comet-late']);

type Nav = Navigator & {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
  getBattery?: () => Promise<BatteryLike>;
};
type BatteryLike = EventTarget & { level: number; charging: boolean };

/** A phone that would struggle, or a browser asking to save data. */
function lowEnd(nav: Nav): boolean {
  return (nav.deviceMemory !== undefined && nav.deviceMemory <= 2)
    || (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4)
    || nav.connection?.saveData === true;
}


/**
 * The lite street's quick loops - each stride's poses, gull wingbeats and
 * glides, the van's hubs, the neon - started from script rather than CSS.
 * The browser hands both to the graphics chip, but a looping CSS animation
 * also wakes the page each time it loops (React listens for those events),
 * and dozens of short loops would wake it constantly. These never do.
 *
 * Started under `root` (the band, or one lane when its walker is re-dressed),
 * paused if the street is resting; on a calm street people and gulls keep
 * their one pose.
 */
const LOOP = 'street-loop';
const STEP = 'step-end';
/** Eight steps a stride: out to one side, back through the middle to the other. */
const POSE_FRAMES: Record<number, [number, number][]> = {
  0: [[0, 1], [0.125, 0]],
  1: [[0, 0], [0.125, 1], [0.25, 0], [0.875, 1]],
  2: [[0, 0], [0.25, 1], [0.375, 0], [0.75, 1], [0.875, 0]],
  3: [[0, 0], [0.375, 1], [0.5, 0], [0.625, 1], [0.75, 0]],
  4: [[0, 0], [0.5, 1], [0.625, 0]],
};
const poseKeyframes = (pose: number): Keyframe[] => [
  ...(POSE_FRAMES[pose] ?? []).map(([offset, opacity]) => ({ offset, opacity, easing: STEP })),
  { offset: 1, opacity: (POSE_FRAMES[pose] ?? []).at(-1)?.[1] ?? 0 },
];
const GULL_BEAT: Record<number, [number, number]> = { 2: [1000, -170], 3: [1000, -310], 4: [880, -80], 5: [920, -400] };
const seconds = (value: string, fallback: number) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n * (value.trim().endsWith('ms') ? 1 : 1000) : fallback;
};

export function startStreetLoops(root: Element): void {
  const band = root.closest('.shopstrip--lite');
  if (!band || typeof (root as HTMLElement).animate !== 'function') return;
  if (reducedMotion()) return;
  for (const animation of root.getAnimations({ subtree: true })) if (animation.id === LOOP) animation.cancel();
  const calm = band.hasAttribute('data-calm');
  const started: Animation[] = [];
  const loop = (target: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    const animation = target.animate(keyframes, { iterations: Infinity, ...options });
    animation.id = LOOP;
    started.push(animation);
  };
  const scope = (selector: string) => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)];

  if (!calm) {
    for (const walker of scope('.walker')) {
      /* Nobody hidden on this lap (no dog today, a child out of the game):
         a loop on something not drawn cannot be handed to the graphics chip,
         so it would tick on the page every frame for nothing. */
      if (walker.getClientRects().length === 0) continue;
      const duration = walker.classList.contains('walker--dog') ? 600 : 2 * seconds(getComputedStyle(walker).getPropertyValue('--gait'), 500);
      walker.querySelectorAll(':scope > .pose').forEach((pose, n) => loop(pose, poseKeyframes(n), { duration }));
    }
    scope('.gullset').forEach((gull, at) => {
      const [duration, delay] = GULL_BEAT[at + 1] ?? [1000, 0];
      gull.querySelectorAll(':scope > .pose').forEach((pose, n) => loop(pose, poseKeyframes(n), { duration, delay }));
      loop(gull, [{ transform: 'translateY(0)' }, { transform: 'translateY(-4px)' }],
        { duration: 3200, easing: 'ease-in-out', direction: 'alternate', delay: at % 2 === 1 ? -1400 : 0 });
    });
  }
  for (const hub of scope('.van__hub')) loop(hub, [{ transform: 'rotate(0turn)' }, { transform: 'rotate(1turn)' }], { duration: 500 });
  for (const name of scope('.shoptile__name')) {
    loop(name, [
      { offset: 0, opacity: 1 }, { offset: 0.91, opacity: 1 }, { offset: 0.92, opacity: 0.72 },
      { offset: 0.93, opacity: 0.95 }, { offset: 0.94, opacity: 1 }, { offset: 1, opacity: 1 },
    ], { duration: 5500 });
  }
  if (band.hasAttribute('data-resting')) for (const animation of started) animation.pause();
}

const loopsIn = (band: Element) => band.getAnimations({ subtree: true }).filter((animation) => animation.id === LOOP);

const nameOf = (animation: Animation) => (animation as CSSAnimation).animationName ?? '';

export function useStreetPower(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const found = ref.current;
    if (!enabled || !found || typeof found.getAnimations !== 'function') return undefined;
    const band: HTMLElement = found;
    if (reducedMotion()) return undefined;

    const nav = navigator as Nav;
    let calm = lowEnd(nav);
    let battery: BatteryLike | null = null;
    let onScreen = false;
    let awake = false;
    let restTimer: number | null = null;
    let ticker: number | null = null;
    let slow: Animation[] = [];

    const clock = () => Date.now() % DAY_MS;
    const setCalm = (next: boolean) => {
      calm = next;
      band.toggleAttribute('data-calm', calm);
      startStreetLoops(band);
      if (awake) wake();
    };

    /* The slow parts are held by script from here on (CSS play-state no
       longer moves them), and set to the clock on each tick. */
    const tick = () => {
      const at = clock();
      for (const animation of slow) animation.currentTime = at;
    };
    const stopTicking = () => {
      if (ticker !== null) window.clearInterval(ticker);
      ticker = null;
    };

    const rest = () => {
      awake = false;
      stopTicking();
      if (restTimer !== null) window.clearTimeout(restTimer);
      restTimer = null;
      band.setAttribute('data-resting', '');
      for (const animation of loopsIn(band)) animation.pause();
    };

    function wake() {
      if (!onScreen) return;
      awake = true;
      band.removeAttribute('data-resting');
      for (const animation of loopsIn(band)) animation.play();
      // Found afresh each time: a new shop brings a new lamp.
      const all = band.getAnimations({ subtree: true });
      slow = all.filter((animation) => SLOW.has(nameOf(animation)));
      for (const animation of slow) animation.pause();
      const at = clock();
      for (const animation of all) {
        if (DAILY.has(nameOf(animation))) animation.currentTime = at;
      }
      tick();
      stopTicking();
      ticker = window.setInterval(tick, calm ? CALM_TICK_MS : TICK_MS);
      if (restTimer !== null) window.clearTimeout(restTimer);
      restTimer = window.setTimeout(rest, calm ? CALM_REST_MS : REST_MS);
    }

    band.toggleAttribute('data-calm', calm);
    band.setAttribute('data-resting', '');
    startStreetLoops(band);

    const watcher = new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last) return;
      const was = onScreen;
      onScreen = last.isIntersecting;
      if (onScreen && !was) wake();
      if (!onScreen && was) rest();
    });
    watcher.observe(band);

    const nudge = () => { if (onScreen) wake(); };
    const row = band.querySelector('.shopstrip__row');
    band.addEventListener('pointerdown', nudge, { passive: true });
    row?.addEventListener('scroll', nudge, { passive: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') nudge();
      else rest();
    };
    document.addEventListener('visibilitychange', onVisible);

    // A low battery that is not charging: calmer until it is charged again.
    const onBattery = () => {
      if (battery) setCalm(lowEnd(nav) || (battery.level <= 0.2 && !battery.charging));
    };
    let gone = false;
    void nav.getBattery?.().then((reading) => {
      if (gone) return;
      battery = reading;
      battery.addEventListener('levelchange', onBattery);
      battery.addEventListener('chargingchange', onBattery);
      onBattery();
    }).catch(() => undefined);

    return () => {
      gone = true;
      rest();
      watcher.disconnect();
      band.removeEventListener('pointerdown', nudge);
      row?.removeEventListener('scroll', nudge);
      document.removeEventListener('visibilitychange', onVisible);
      battery?.removeEventListener('levelchange', onBattery);
      battery?.removeEventListener('chargingchange', onBattery);
      for (const animation of slow) animation.play();
      for (const animation of loopsIn(band)) animation.cancel();
    };
  }, [ref, enabled]);
}
