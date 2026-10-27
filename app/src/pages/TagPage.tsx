import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiRequestError, api, type PostCard, type ShopCard } from '../api';
import { SocialPostCard } from '../components/SocialPost';
import { VoiceProvider } from '../components/SocialVoice';
import { ShopTile } from '../components/ShopCards';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice } from '../components/ui';
import { Loading } from '../components/Feedback';
import '../styles/TagPage.css';

/**
 * One tag's page: every shop that carries it, the ones most about it first.
 *
 * Reached by tapping a tag on a shop, or a #topic in a post. Read from each
 * shop's identity - its own tags and the tags on what it lists - so a shop
 * that sells resin kits turns up here whether or not it thought to say so;
 * and under the shops, the posts filed under the same topic.
 */
export function TagPage() {
  const { slug = '' } = useParams<{ slug: string }>();
  const [data, setData] = useState<{ tag: { key: string; label: string }; shops: ShopCard[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<PostCard[]>([]);

  useEffect(() => {
    setData(null);
    setError(null);
    setPosts([]);
    void api.shopsByTag(slug).then(setData).catch((err: unknown) =>
      setError(err instanceof ApiRequestError ? err.message : 'Could not load this tag.'));
    // The posts are extra: a tag with no posts is still a page of shops.
    void api.topicPosts(slug).then((found) => setPosts(found.posts)).catch(() => undefined);
  }, [slug]);

  return (
    <main className="page">
      <BackLink to="/">‹ Back</BackLink>
      {error && <ErrorNotice message={error} />}
      {!data && !error && <Loading />}
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
          {data.shops.length === 0 && posts.length === 0 ? (
            <EmptyState title="Nothing here yet">Try another tag, or search for what you are after.</EmptyState>
          ) : data.shops.length > 0 && (
            <div className="tagpage__grid">
              {data.shops.map((shop) => <ShopTile key={shop.id} shop={shop} />)}
            </div>
          )}
          {posts.length > 0 && (
            <section className="tagpage__posts">
              <h2 className="tagpage__sub">Posts about {data.tag.label}</h2>
              <VoiceProvider>
                {posts.map((card) => <SocialPostCard key={card.post.id} card={card} />)}
              </VoiceProvider>
            </section>
          )}
        </>
      )}
    </main>
  );
}
