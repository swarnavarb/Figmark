import type { ReactNode } from 'react';
import { gradientFor, hueFor, initialsOf } from '../format';

/** Inline icons. Kept as a small set so no icon dependency is needed. */
export function Icon({ name, size = 16 }: { name: 'search' | 'heart' | 'plus' | 'back' | 'check'; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </>
    ),
    heart: <path d="M12 20s-7-4.5-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.5-7 9-7 9Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    back: <path d="M15 19l-7-7 7-7" />,
    check: <path d="m5 13 4 4L19 7" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={name === 'heart' ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

/**
 * Stand-in for a listing photo.
 *
 * There is no blob storage wired up yet, so rather than fake image URLs that
 * would fail to load, each listing gets a stable gradient keyed off its id with
 * its initials on top. Deterministic, so the grid looks intentional.
 */
export function Thumb({ seed, label, className = 'thumb', children }: {
  seed: string;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div className={className} style={{ background: gradientFor(seed) }}>
      <span>{initialsOf(label)}</span>
      {children}
    </div>
  );
}

export function Avatar({ name, size = 38 }: { name: string; size?: number }) {
  return (
    <div
      className="avatar"
      style={{
        width: size,
        height: size,
        background: `hsl(${hueFor(name)} 40% 34%)`,
        fontSize: size < 32 ? 11 : 13,
      }}
    >
      {initialsOf(name)}
    </div>
  );
}

/** Seller trust, shown identically wherever a seller appears. */
export function TrustBadge({ score, tier }: { score: number; tier?: string }) {
  const tone = score >= 80 ? 'ok' : score >= 50 ? 'warn' : 'danger';
  return (
    <span className={`badge badge--${tone}`} title={`Trust score ${score} of 100`}>
      ★ {score}
      {tier === 'pro' && ' · Pro'}
    </span>
  );
}

export function EmptyState({ icon = '◍', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty__icon">{icon}</div>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return <p className="notice notice--error">{message}</p>;
}

/** Live fill progress for a group-buy lot. */
export function LotMeter({ filled, threshold }: { filled: number; threshold: number }) {
  const percent = Math.min(100, Math.round((filled / Math.max(1, threshold)) * 100));
  return (
    <div className="meter" role="img" aria-label={`${percent}% filled`}>
      <div className="meter__fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
