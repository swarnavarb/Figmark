import type { ReactNode } from 'react';

/**
 * A small celebration, for things worth one. Respects reduced motion by not happening.
 *
 * Its own module so the quest toast, which every screen carries, does not
 * pull the whole social post card into the first script the app loads.
 */
export function Confetti({ run }: { run: number }): ReactNode {
  const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (run === 0 || reduce) return null;
  const pieces = Array.from({ length: 18 }, (_, index) => index);
  return (
    <span key={run} className="confetti" aria-hidden="true">
      {pieces.map((index) => (
        <span key={index} className={`confetti__bit confetti__bit--${index % 6}`}
          style={{ left: `${(index * 53) % 100}%`, animationDelay: `${(index % 6) * 40}ms` }} />
      ))}
    </span>
  );
}
