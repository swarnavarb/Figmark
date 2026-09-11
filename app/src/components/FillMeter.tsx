import type { ReactNode } from 'react';
import type { PreOrderMember, PreOrderView } from '../api';
import { daysUntil, formatDate, hueFor, initialsOf } from '../format';

/**
 * The fill meter, as a group rather than a progress bar.
 *
 * A bar that says 65% is a status indicator. What moves a group-buy is three
 * different things: how many people are already in (so it looks like something
 * that might happen), how many more it needs (so there is something to do), and
 * that joining does not cost anything yet (so the first click is cheap).
 *
 * Hence two layers on one track. Solid is money somebody has paid; hatched is a
 * place somebody said they would take if enough others did. They are never
 * added together and presented as sales - the legend under the bar always says
 * which is which, because a seller reading "18 of 20" and finding fourteen
 * payments is the kind of surprise that ends a marketplace.
 */

export function FillMeter({ view, height = 8 }: { view: PreOrderView; height?: number }) {
  const { fillThreshold, filledCount, committed, state } = view;
  const pct = (units: number) => Math.min(100, Math.round((units / Math.max(1, fillThreshold)) * 100));
  const dead = state === 'closed';

  return (
    <div
      className="meter meter--social"
      style={{ height }}
      role="img"
      aria-label={
        dead
          ? `Closed at ${committed} of ${fillThreshold}`
          : `${filledCount} booked and ${view.pledgedCount} pledged of ${fillThreshold}`
      }
    >
      <i className={`meter__fill meter__fill--pledged${dead ? ' is-dead' : ''}`} style={{ width: `${pct(committed)}%` }} />
      <i
        className={`meter__fill meter__fill--booked${dead ? ' is-dead' : state === 'going' ? ' is-done' : ''}`}
        style={{ width: `${pct(filledCount)}%` }}
      />
    </div>
  );
}

/**
 * The gap, which is the only number on the card that asks for anything.
 *
 * "7 to go" is a request. "65%" is a status bar. The wording shifts with the
 * state rather than counting down against a clock: a real shortfall and a real
 * cutoff are reason enough, and manufactured urgency would cost more trust than
 * the extra unit is worth.
 */
export function FillGap({ view }: { view: PreOrderView }) {
  if (view.state === 'closed') {
    return <span className="gap gap--dead">{view.committed} of {view.fillThreshold}</span>;
  }
  // "Filled" for both of the states that met the threshold. Which of the two it
  // is - enough paid, or enough promised and being called in - is said by the
  // badge beside it and by the legend below, and saying it three times reads as
  // three different facts.
  if (view.state === 'going' || view.state === 'called') {
    return <span className="gap gap--ok">Filled</span>;
  }
  return (
    <span className={`gap${view.state === 'nearly' ? ' gap--warn' : ''}`}>
      {view.toGo} to go
    </span>
  );
}

/**
 * What the two layers mean, spelled out under every bar.
 *
 * Not a tooltip and not a legend somewhere else on the page: the whole design
 * rests on nobody mistaking a pledge for a sale, and a distinction you have to
 * hover to learn is one most people never learn.
 */
export function FillKey({ view }: { view: PreOrderView }) {
  const days = daysUntil(view.cutoffAt);
  return (
    <div className="fillkey">
      <span><u className="fillkey__booked" />{view.filledCount} booked</span>
      {view.pledgedCount > 0 && (
        <span><u className="fillkey__pledged" />{view.pledgedCount} in if it fills</span>
      )}
      {view.state === 'closed' ? (
        <span>closed {view.fillThreshold - view.committed} short</span>
      ) : view.state === 'going' || view.state === 'called' ? (
        <span>the seller orders now</span>
      ) : (
        <span>{days > 1 ? `closes in ${days} days` : `closes ${formatDate(view.cutoffAt)}`}</span>
      )}
    </div>
  );
}

/**
 * Who is already in it.
 *
 * Faces rather than a number because a group you can see is a group you can
 * imagine joining. Everybody here chose to be named; the rest are counted in
 * the "+n" and nowhere else.
 */
export function FacePile({ people, unlisted, max = 5 }: {
  people: PreOrderMember[];
  unlisted: number;
  max?: number;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length + unlisted;
  if (shown.length === 0 && rest === 0) return null;

  return (
    <div className="pile">
      {shown.map((person, index) => (
        <b
          key={`${person.ref.name}-${index}`}
          className={person.booked ? undefined : 'pile__soft'}
          style={{ background: `hsl(${hueFor(person.ref.name)} 40% 34%)` }}
          title={`${person.ref.name} · ${person.booked ? 'booked' : 'in if it fills'}`}
        >
          {initialsOf(person.ref.name)}
        </b>
      ))}
      {rest > 0 && <b className="pile__more">+{rest}</b>}
    </div>
  );
}

/**
 * The whole block as a feed card shows it: who, how far, what it means.
 *
 * One component so the card, the listing page and anywhere this gets shared all
 * draw the same thing. A meter that looks different in two places is two
 * meters, and people only learn to read one.
 */
export function FillBlock({ view, people = [], unlisted = 0, children }: {
  view: PreOrderView;
  people?: PreOrderMember[];
  unlisted?: number;
  children?: ReactNode;
}) {
  return (
    <div className="fillblock">
      <div className="fillblock__head">
        <FacePile people={people} unlisted={unlisted} />
        <FillGap view={view} />
      </div>
      <FillMeter view={view} />
      <FillKey view={view} />
      {children}
    </div>
  );
}
