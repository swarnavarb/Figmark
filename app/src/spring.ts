/**
 * A spring, for motion that has to carry a finger's speed.
 *
 * CSS transitions and the --spring-* tokens cover motion that starts from
 * rest. A fling does not: it lets go already moving, and a fixed curve
 * would start it from a standstill again. This simulates a damped spring
 * from where the thing is, at the speed it was let go, and returns Web
 * Animations keyframes, so once started it plays off the main thread like
 * any other animation.
 *
 * Tuned the way Apple tunes springs: `duration` is how long it takes to look
 * finished (seconds), `bounce` how far it overshoots (0 none, 0.3 playful).
 */
export interface SpringOptions {
  duration?: number;
  bounce?: number;
}

export function springKeyframes(
  from: number,
  to: number,
  /** Starting speed in units per second (degrees/s for a rotation, px/s for a move). */
  velocity: number,
  format: (value: number) => string,
  { duration = 0.5, bounce = 0.2 }: SpringOptions = {},
): { keyframes: Keyframe[]; ms: number } {
  const span = to - from;
  if (span === 0) return { keyframes: [{ transform: format(to) }, { transform: format(to) }], ms: 1 };
  const omega = (2 * Math.PI) / duration;
  const zeta = 1 - Math.min(Math.max(bounce, 0), 0.95);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  // The start speed as a share of the distance, so the curve below runs 0 → 1.
  const v0 = velocity / span;
  const at = (t: number) => {
    const decay = Math.exp(-zeta * omega * t);
    return 1 - decay * (Math.cos(damped * t) + ((zeta * omega - v0) / damped) * Math.sin(damped * t));
  };

  const keyframes: Keyframe[] = [];
  const step = 1 / 60;
  let t = 0;
  let calm = 0;
  for (; t < 4; t += step) {
    const progress = at(t);
    keyframes.push({ transform: format(from + span * progress) });
    // Done once it has stayed within a hair of the end for a few frames.
    calm = Math.abs(1 - progress) * Math.abs(span) < 0.5 ? calm + 1 : 0;
    if (calm > 4) break;
  }
  keyframes.push({ transform: format(to) });
  return { keyframes, ms: Math.max(1, Math.round(t * 1000)) };
}

/**
 * Speed of a pointer along one axis, in units per millisecond, smoothed so one
 * jittery sample cannot decide a gesture. Reads 0 if the finger stopped before
 * letting go.
 */
export class Velocity {
  private last = 0;
  private lastT = 0;
  private v = 0;

  reset(value: number, time: number): void {
    this.last = value;
    this.lastT = time;
    this.v = 0;
  }

  track(value: number, time: number): void {
    const dt = time - this.lastT;
    if (dt <= 0) return;
    this.v = 0.7 * ((value - this.last) / dt) + 0.3 * this.v;
    this.last = value;
    this.lastT = time;
  }

  /** Per millisecond; 0 when the last move is older than 80ms. */
  at(time: number): number {
    return time - this.lastT > 80 ? 0 : this.v;
  }
}
