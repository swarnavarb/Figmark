import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';

/**
 * `/r/<code>`: somebody's short affiliate link.
 *
 * The server remembers who sent this person - on their account if they are
 * signed in, in a cookie if not - and says which item it was. Then the item
 * opens at its own address, so there is nothing left in the bar to trim.
 */
export function ShortLinkPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.openShortLink(code)
      .then(({ listingId }) => !cancelled && navigate(`/listing/${encodeURIComponent(listingId)}`, { replace: true }))
      .catch(() => !cancelled && setLost(true));
    return () => {
      cancelled = true;
    };
  }, [code, navigate]);

  if (lost) {
    return (
      <main className="page guestwall">
        <span className="guestwall__lock" aria-hidden="true">🔗</span>
        <h1>That link does not lead anywhere</h1>
        <p>It may have been mistyped, or the item is gone.</p>
        <Link to="/" className="btn">Browse everything</Link>
      </main>
    );
  }
  return <main className="page"><p className="muted">Opening…</p></main>;
}
