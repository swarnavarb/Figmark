import { useEffect, useState } from 'react';
import {
  BROWSER_LABELS, PLATFORM_GROUP_LABELS, percent,
  type DeviceFigures, type PlatformFigures,
} from '@shared/devices';
import { ApiRequestError, admin } from './api';

/**
 * How people use Figmark: on what, in which browser, how many put it on their
 * home screen, and how many get notifications.
 *
 * Counted by person, from what each signed-in copy of the site reports about
 * itself once a day. Somebody who has not signed in since this existed is not
 * in here yet, which is why the totals say how many people they cover.
 */
export function DevicesView() {
  const [figures, setFigures] = useState<DeviceFigures | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void admin.devices()
      .then(setFigures)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the figures.'));
  }, []);

  if (error) return <p className="notice notice--error">{error}</p>;
  if (!figures) return <p className="muted">Loading…</p>;
  if (figures.people === 0) {
    return (
      <div className="card card--pad">
        <p className="muted" style={{ margin: 0 }}>
          Nobody has reported a device yet. Figures appear once people sign in on the new version.
        </p>
      </div>
    );
  }

  const phones = figures.platforms.filter((row) => row.group === 'ios' || row.group === 'android');
  const maxBrowser = Math.max(...figures.browsers.map((row) => row.people), 1);

  return (
    <div className="stack">
      {phones.length > 0 && (
        <div className="card card--pad stack">
          {phones.map((row) => (
            <p key={row.group} className="devstats__headline">
              <strong>{percent(row.installed, row.people)}</strong> of {PLATFORM_GROUP_LABELS[row.group]} users
              added Figmark to their home screen
              <span className="faint"> · {row.installed} of {row.people}</span>
            </p>
          ))}
        </div>
      )}

      <div className="devstats__tiles">
        <Tile label="People counted" value={String(figures.people)} hint="signed in since this was added" />
        <Tile label="On the home screen" value={percent(figures.installed, figures.people)} hint={people(figures.installed)} />
        <Tile label="Notifications on" value={percent(figures.pushOn, figures.people)} hint={people(figures.pushOn)} />
        <Tile label="Active, last 7 days" value={percent(figures.active7d, figures.people)} hint={people(figures.active7d)} />
      </div>

      <div className="card card--pad stack">
        <h2>By device</h2>
        <div className="table-scroll">
          <table className="devstats__table">
            <thead>
              <tr>
                <th scope="col">Device</th>
                <th scope="col" className="num">People</th>
                <th scope="col">Home screen</th>
                <th scope="col">Notifications on</th>
                <th scope="col" className="num">Active 7 days</th>
              </tr>
            </thead>
            <tbody>
              {figures.platforms.map((row) => <PlatformRow key={row.group} row={row} />)}
            </tbody>
          </table>
        </div>
        <p className="field__hint">
          A person on two kinds of device counts once in each row. On a computer, "home screen" means installed as an app.
        </p>
      </div>

      <div className="card card--pad stack">
        <h2>By browser</h2>
        <div className="table-scroll">
          <table className="devstats__table">
            <thead>
              <tr>
                <th scope="col">Browser</th>
                <th scope="col">Device</th>
                <th scope="col">People</th>
              </tr>
            </thead>
            <tbody>
              {figures.browsers.map((row) => (
                <tr key={`${row.group}:${row.browser}`}>
                  <td>{BROWSER_LABELS[row.browser]}</td>
                  <td className="faint">{PLATFORM_GROUP_LABELS[row.group]}</td>
                  <td><Meter value={row.people} max={maxBrowser} label={String(row.people)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field__hint">Used in a browser tab. Home-screen copies are counted under Home screen above.</p>
      </div>
    </div>
  );
}

const people = (count: number) => `${count} ${count === 1 ? 'person' : 'people'}`;

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="card card--pad devstats__tile">
      <span className="faint">{label}</span>
      <strong className="devstats__value">{value}</strong>
      <span className="faint">{hint}</span>
    </div>
  );
}

function PlatformRow({ row }: { row: PlatformFigures }) {
  return (
    <tr>
      <th scope="row">{PLATFORM_GROUP_LABELS[row.group]}</th>
      <td className="num">{row.people}</td>
      <td><Meter value={row.installed} max={row.people} label={`${percent(row.installed, row.people)} · ${row.installed}`} /></td>
      <td><Meter value={row.pushOn} max={row.people} label={`${percent(row.pushOn, row.people)} · ${row.pushOn}`} /></td>
      <td className="num">{row.active7d}</td>
    </tr>
  );
}

/** A thin bar with its number beside it, never instead of it. */
function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const share = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <span className="devstats__meter" title={`${value} of ${max}`}>
      <span className="devstats__track" aria-hidden="true">
        <span className="devstats__fill" style={{ width: `${share}%` }} />
      </span>
      <span className="devstats__label">{label}</span>
    </span>
  );
}
