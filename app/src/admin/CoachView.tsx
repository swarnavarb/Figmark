import { useEffect, useState } from 'react';
import type { StatsView } from '@shared/coach-log';
import { ApiRequestError, admin } from './api';
import { SkelFigures } from '../components/PageSkeletons';

/**
 * Whether the shop coach's tips help, by kind of tip, across every shop.
 *
 * Totals only: no shop, person or item is named or reachable from here, and a
 * kind of tip stays hidden until enough different shops are in it that no one
 * shop's figures can be read out of the total. "Orders a week" is the average
 * change in a shop's orders between the week before a tip was first seen and
 * the week after - for the tips shops acted on, and for those they did not.
 */
export function CoachView() {
  const [view, setView] = useState<StatsView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void admin.coach()
      .then(setView)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the coach results.'));
  }, []);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (!view) return <SkelFigures chart={false} />;

  const signed = (value: number | null) => (value === null ? '–' : `${value > 0 ? '+' : ''}${value}`);
  const percent = (value: number | null) => (value === null ? '–' : `${value}%`);

  return (
    <div className="stack">
      <div className="card card--pad">
        <p className="muted" style={{ margin: 0 }}>
          Each tip is given a week. Totals cover every shop since {view.since ? new Date(view.since).toLocaleDateString('en-IN') : 'the first result'};
          a kind of tip shows once {view.minShops} different shops are in it.
          {view.withheld > 0 && ` ${view.withheld} kind${view.withheld === 1 ? ' is' : 's are'} still below that.`}
        </p>
      </div>
      {view.rows.length === 0 ? (
        <div className="card card--pad">
          <p className="muted" style={{ margin: 0 }}>No kind of tip has enough shops behind it yet.</p>
        </div>
      ) : (
        <div className="card card--pad">
          <table className="devstats__table">
            <thead>
              <tr>
                <th>Tip</th>
                <th>Shops</th>
                <th>Shown</th>
                <th>Acted on</th>
                <th>Sorted if acted / skipped</th>
                <th>Orders a week if acted / skipped</th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row) => (
                <tr key={row.rule}>
                  <td>{row.label}</td>
                  <td>{row.shops}</td>
                  <td>{row.episodes}</td>
                  <td>{percent(row.pressRate)}</td>
                  <td>{percent(row.clearedIfPressed)} / {percent(row.clearedIfIgnored)}</td>
                  <td>{signed(row.liftIfPressed)} / {signed(row.liftIfIgnored)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
