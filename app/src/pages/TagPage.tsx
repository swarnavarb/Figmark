import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiRequestError, api, type ShopCard } from '../api';
import { ShopTile } from '../components/ShopCards';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice } from '../components/ui';

/**
 * One tag's page: every shop that carries it, the ones most about it first.
 *
 * Reached by tapping a tag on a shop. Read from each shop's identity - its
 * own tags and the tags on what it lists - so a shop that sells resin kits
 * turns up here whether or not it thought to say so.
 */
export function TagPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [data, setData] = useState<{ tag: { key: string; label: string }; shops: ShopCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    void api.shopsByTag(slug).then(setData).catch((err: unknown) =>
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this tag.'));
  }, [slug]);

  return (
    <main className="page">
      <BackLink to="/">‹ Back</BackLink>
      {error && <ErrorNotice message={error} />}
      {!data && !error && <p className="muted">Loading…</p>}
      {data && (
        <>
          <div className="page__head">
            <div>
              <h1 className="tagpage__title"><span aria-hidden="true">#</span>{data.tag.label}</h1>
              <p className="muted">
                {data.shops.length === 0
                  ? 'No shop carries this tag yet.'
                  : `${data.shops.length} shop${data.shops.length === 1 ? '' : 's'} known for ${data.tag.label}.`}
              </p>
            </div>
            <Link to={`/?q=${encodeURIComponent(data.tag.label)}`} className="btn btn--quiet">See items</Link>
          </div>
          {data.shops.length === 0 ? (
            <EmptyState title="Nothing here yet">Try another tag, or search for what you are after.</EmptyState>
          ) : (
            <div className="tagpage__grid">
              {data.shops.map((shop) => <ShopTile key={shop.id} shop={shop} />)}
            </div>
          )}
        </>
      )}
    </main>
  );
}
