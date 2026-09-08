import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { checkUsername, USERNAME_PROBLEMS } from '@shared/handles';
import { ApiRequestError, api, type PublicProfile } from '../api';
import { Avatar, EmptyState, ErrorNotice, Thumb } from '../components/ui';
import { formatMoney } from '../format';
import { MessageButton } from './MessagesPage';

/**
 * Whatever lives at `/<username>`.
 *
 * People and shops share one namespace, so this is one page: the server says
 * which it was and the page renders accordingly. A shop gets its shelf, a
 * person gets their name — and either way there is a way to say something to
 * them, because a username is an address.
 */
export function ProfileByHandlePage() {
  const { username } = useParams<{ username: string }>();
  const [data, setData] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    // A path that could never be a username is a wrong turn, not a lookup.
    const problem = checkUsername(username);
    if (problem) {
      setError(`There is no page at /${username}. ${USERNAME_PROBLEMS[problem]}`);
      return;
    }
    setError(null);
    setData(null);
    void api
      .profile(username)
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not open that page.'),
      );
  }, [username]);

  if (error) {
    return (
      <main className="page tab-view">
        <ErrorNotice message={error} />
        <Link to="/" className="btn btn--ghost" style={{ marginTop: 14, justifySelf: 'start' }}>
          Back to the feed
        </Link>
      </main>
    );
  }
  if (!data) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  return (
    <main className="page tab-view">
      <header className="profilehead">
        {data.photoUrl ? (
          <img className="profilehead__photo" src={data.photoUrl} alt="" />
        ) : (
          <Avatar name={data.displayName} size={72} />
        )}
        <div className="profilehead__who">
          <h1 className="profilehead__name">{data.displayName}</h1>
          <p className="faint">
            @{data.handle}
            {data.isStore && <span className="badge" style={{ marginLeft: 8 }}>shop</span>}
          </p>
          {data.isStore && (
            <p className="faint">
              {data.followerCount} {data.followerCount === 1 ? 'follower' : 'followers'}
              {data.dispatchRegion && ` · ships from ${data.dispatchRegion}`}
              {data.tier && ` · ${data.tier}`}
            </p>
          )}
        </div>
      </header>

      {data.bio && <p className="profilehead__bio">{data.bio}</p>}

      <div className="row" style={{ marginBottom: 18 }}>
        <MessageButton handle={data.handle} />
        {data.link && (
          <a className="btn btn--quiet" href={withScheme(data.link)} target="_blank" rel="noreferrer noopener">
            {data.link.replace(/^https?:\/\//, '')}
          </a>
        )}
        {/* The person behind a shop is a separate address, and worth reaching
            when the shop's own voice is not who you want. */}
        {data.isStore && data.ownerHandle && (
          <Link to={`/${data.ownerHandle}`} className="btn btn--quiet">@{data.ownerHandle}</Link>
        )}
      </div>

      {data.isStore ? (
        data.listings.length === 0 ? (
          <EmptyState title="Nothing listed yet">
            This shop has not put anything up. Following it puts new items on your feed.
          </EmptyState>
        ) : (
          <div className="grid">
            {data.listings.map((listing) => (
              <Link key={listing.id} to={`/listing/${listing.id}`} className="card card--link">
                <Thumb seed={listing.id} label={listing.title}>
                  <div className="thumb__badges">
                    <span className="badge badge--solid">{listing.condition}</span>
                  </div>
                </Thumb>
                <div className="listing__body">
                  <span className="listing__title">{listing.title}</span>
                  <span className="listing__price">{formatMoney(listing.priceMinor, listing.currency)}</span>
                  <div className="listing__meta">
                    <span className="faint">♥ {listing.likeCount}</span>
                    <span className="faint">{listing.quantityAvailable} left</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      ) : (
        <EmptyState title="A person, not a shop">
          {data.displayName} buys here. Open a storefront under a username to sell from one.
        </EmptyState>
      )}
    </main>
  );
}

/** Links are stored as typed, so give a bare domain a scheme before opening it. */
function withScheme(link: string) {
  return /^https?:\/\//i.test(link) ? link : `https://${link}`;
}
