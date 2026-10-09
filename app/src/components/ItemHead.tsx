import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Thumb } from './ui';

/**
 * The item at the top of an order card: picture, name, a meta line, and the
 * price or state on the right. One component, so an order on the Orders
 * screen and the same order inside its lot can never look different.
 */
export function ItemHead({ id, name, photoUrl, to, state, badges, meta, side }: {
  id: string;
  name: string;
  photoUrl?: string | null;
  to: string;
  state?: unknown;
  badges?: ReactNode;
  meta?: ReactNode;
  side?: ReactNode;
}) {
  return (
    <div className="ocard__head">
      <Link to={to} state={state} className="ocard__thumb" tabIndex={-1} aria-hidden="true">
        <Thumb seed={id} label={name} photo={photoUrl ? { url: photoUrl } : null} className="thumb ocard__img" />
      </Link>
      <div className="ocard__title">
        <Link to={to} state={state} className="ocard__name">{name}</Link>
        {badges}
        {meta && <div className="ocard__meta">{meta}</div>}
      </div>
      {side && <div className="ocard__price">{side}</div>}
    </div>
  );
}
