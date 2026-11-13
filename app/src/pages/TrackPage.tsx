import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiRequestError, api, type PublicTracking } from '../api';
import { formatDate } from '../format';
import '../styles/TrackPage.css';

/**
 * One order's journey, for whoever was sent the link.
 *
 * No account, no sign-in wall: the person reading this is a buyer's family
 * member, or a buyer who never installed anything. It answers the only two
 * questions they have - where is it, and when does it get here.
 */
export function TrackPage() {
  const { token = '' } = useParams();
  const [data, setData] = useState<PublicTracking | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.publicTracking(token)
      .then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load this tracking.'));
  }, [token]);

  if (error) {
    return (
      <main className="page trackpage">
        <h1>Tracking not found</h1>
        <p className="muted">{error} Ask whoever sent it for a new link.</p>
      </main>
    );
  }
  if (!data) return <main className="page trackpage"><p className="muted">Loading…</p></main>;

  const now = data.steps[data.at] ?? 'On its way';
  return (
    <main className="page trackpage">
      <header className="trackpage__head">
        {data.photo && <img className="trackpage__photo" src={data.photo.thumbUrl ?? data.photo.url} alt="" />}
        <div>
          <h1>{data.itemName}{data.quantity > 1 ? ` ×${data.quantity}` : ''}</h1>
          {data.shop && (
            <p className="muted">
              from {data.shop.handle ? <Link to={`/${data.shop.handle}`}>{data.shop.name}</Link> : data.shop.name}
            </p>
          )}
        </div>
      </header>

      <section className={`trackpage__now trackpage__now--${data.status}`} aria-live="polite">
        <span className="trackpage__label">
          {data.status === 'delivered' ? 'Delivered' : data.status === 'cancelled' ? 'Cancelled' : 'Now'}
        </span>
        <b>{data.status === 'cancelled' ? 'This order was cancelled.' : now}</b>
        {data.status === 'moving' && data.etaDays !== null && (
          <span>About {data.etaDays} {data.etaDays === 1 ? 'day' : 'days'} to go</span>
        )}
      </section>

      {data.status !== 'cancelled' && (
        <ol className="trackpage__steps">
          {data.steps.map((step, index) => (
            <li key={`${index}-${step}`} className={index < data.at ? 'is-done' : index === data.at ? 'is-now' : ''}
              aria-current={index === data.at ? 'step' : undefined}>
              <span className="trackpage__dot" aria-hidden="true">{index < data.at || (index === data.at && data.status === 'delivered') ? '✓' : ''}</span>
              {step}
            </li>
          ))}
        </ol>
      )}

      {data.updates.length > 0 && (
        <section className="trackpage__log">
          <h2>Latest updates</h2>
          <ul>
            {data.updates.map((update, index) => (
              <li key={`${update.at}-${index}`}><time dateTime={update.at}>{formatDate(update.at)}</time> {update.text}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="faint trackpage__foot">Shared from Figmark. Only the journey is shown here - no names, addresses or prices.</p>
    </main>
  );
}
