import { useSyncExternalStore } from 'react';

/**
 * One clock for the whole page, per tick length.
 *
 * Every countdown used to run its own interval, so a feed with twenty drops on
 * it woke twenty times a second, each at its own moment. Now every reader of a
 * one-second clock shares one interval and re-renders on the same tick, and the
 * clock stops while the tab is hidden: a countdown nobody can see has nothing
 * to show. Coming back, it reads the time at once rather than at the next tick.
 */

interface Ticker {
  now: number;
  timer: number | undefined;
  readers: Set<() => void>;
}

const tickers = new Map<number, Ticker>();

const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';

function tick(ticker: Ticker) {
  ticker.now = Date.now();
  lastRead = ticker.now;
  ticker.readers.forEach((reader) => reader());
}

function arm(ms: number, ticker: Ticker) {
  window.clearInterval(ticker.timer);
  ticker.timer = visible() ? window.setInterval(() => tick(ticker), ms) : undefined;
}

let watching = false;
function watchVisibility() {
  if (watching || typeof document === 'undefined') return;
  watching = true;
  document.addEventListener('visibilitychange', () => {
    for (const [ms, ticker] of tickers) {
      if (ticker.readers.size === 0) continue;
      if (visible()) tick(ticker);
      arm(ms, ticker);
    }
  });
}

function tickerFor(ms: number): Ticker {
  let ticker = tickers.get(ms);
  if (!ticker) {
    ticker = { now: Date.now(), timer: undefined, readers: new Set() };
    tickers.set(ms, ticker);
  }
  return ticker;
}

function subscribe(ms: number, reader: () => void): () => void {
  watchVisibility();
  const ticker = tickerFor(ms);
  ticker.readers.add(reader);
  if (ticker.readers.size === 1) {
    ticker.now = Date.now();
    lastRead = ticker.now;
    arm(ms, ticker);
  }
  return () => {
    ticker.readers.delete(reader);
    if (ticker.readers.size === 0) {
      window.clearInterval(ticker.timer);
      tickers.delete(ms);
    }
  };
}

const stop = () => undefined;
const still = () => stop;

/** The last time any clock read: what a stopped clock answers, the same on every render. */
let lastRead = Date.now();

/**
 * The time now, re-read every `ms` while the page is on screen. Null stops it
 * - a clock that has run out, or one not shown yet.
 */
const subscribers = new Map<number, (reader: () => void) => () => void>();
/** One subscribe function per tick length, so a re-render does not re-subscribe. */
function subscriberFor(ms: number) {
  let found = subscribers.get(ms);
  if (!found) {
    found = (reader) => subscribe(ms, reader);
    subscribers.set(ms, found);
  }
  return found;
}

export function useNow(ms: number | null): number {
  return useSyncExternalStore(
    ms === null ? still : subscriberFor(ms),
    () => (ms === null ? lastRead : tickers.get(ms)?.now ?? lastRead),
    () => Date.now(),
  );
}
