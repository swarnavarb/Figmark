import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiRequestError, api, type ChannelThread, type PostCard } from '../api';
import { EmptyState, ErrorNotice } from './ui';
import { Icon } from './Icon';
import { SocialPostCard } from './SocialPost';
import { Composer } from './SocialComposer';
import { PersonVoice } from './SocialVoice';
import { RoomBar } from './SocialChrome';
import { useGoBack } from './ScrollManager';
import { markSeen } from './Channels';

/**
 * A forum, read as a feed with a subject.
 *
 * Somebody posts, everybody engages: the same cards as the feed, with
 * reactions, comments and polls, rather than a chat. A chat is for a shop
 * talking to its customers; a forum is people comparing notes, and notes are
 * read back later, which a chat is bad at.
 *
 * Always as yourself. Shops have channels, not seats in a forum.
 */
export function ForumRoom() {
  return (
    <PersonVoice>
      <Forum />
    </PersonVoice>
  );
}

type Order = 'latest' | 'top';

const score = (card: PostCard) => card.social.reactions.total + 2 * card.social.commentCount;

function Forum() {
  const { id } = useParams<{ id: string }>();
  const back = useGoBack('/social?view=forums');
  const [data, setData] = useState<ChannelThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order>('latest');
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setData(await api.channelThread(id));
      markSeen(id);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not open this forum.');
    }
  }, [id]);

  useEffect(() => {
    setData(null);
    void load();
  }, [load]);

  async function join() {
    if (!id || !data) return;
    setJoining(true);
    try {
      const { forum } = await api.joinForum(id);
      setData((current) => current && {
        ...current,
        channel: { ...current.channel, member: forum.member, memberCount: forum.memberCount },
      });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not join.');
    } finally {
      setJoining(false);
    }
  }

  const channel = data?.channel;
  const member = Boolean(channel?.member);
  const posts = [...(data?.posts ?? [])];
  if (order === 'top') posts.sort((a, b) => score(b) - score(a));

  return (
    <div className="social">
      <RoomBar tone="forum" onBack={back} reveal
        avatar={<span className="forumav" aria-hidden="true"><Icon name="forum" size={18} /></span>}
        title={channel?.name ?? <span className="skel" style={{ width: 120, height: 12 }} />}
        sub={channel && <>{channel.memberCount ?? 0} members · {channel.postCount ?? posts.length} posts</>}
        action={channel && (
          <button type="button" className={`roombar__btn${member ? ' is-on' : ''}`} disabled={joining}
            onClick={() => void join()}>
            {member ? <><Icon name="check" size={13} /> Joined</> : <><Icon name="plus" size={13} /> Join</>}
          </button>
        )} />

      <main className="page social forumroom">
        {error && <ErrorNotice message={error} />}

        {channel && (
          <header className="forumhero">
            <span className="forumhero__stripes" aria-hidden="true" />
            <button type="button" className="chhero__back" aria-label="Back" onClick={back}>
              <Icon name="back" size={18} />
            </button>
            <span className="forumhero__kicker"><Icon name="forum" size={13} /> Forum</span>
            <h1 className="forumhero__name">{channel.name}</h1>
            {channel.description && <p className="forumhero__desc">{channel.description}</p>}
            <p className="forumhero__stats">
              <strong>{channel.memberCount ?? 0}</strong> members · <strong>{channel.postCount ?? posts.length}</strong> posts
            </p>
            <button type="button" className={`forumhero__join${member ? ' is-on' : ''}`} disabled={joining} onClick={() => void join()}>
              {member ? <><Icon name="check" size={15} /> Joined</> : <><Icon name="plus" size={15} /> Join to post</>}
            </button>
          </header>
        )}

        <div className="feed">
          {member && channel && (
            <Composer forum={{ id: channel.id, name: channel.name }} onPosted={load} />
          )}

          {data && posts.length > 1 && (
            <div className="streams" role="tablist" aria-label="Order">
              {([['latest', 'Latest', 'spark'], ['top', 'Top', 'bolt']] as const).map(([key, label, icon]) => (
                <button key={key} type="button" role="tab" aria-selected={order === key}
                  className={`streams__tab${order === key ? ' is-on' : ''}`} onClick={() => setOrder(key)}>
                  <Icon name={icon} size={15} /> {label}
                </button>
              ))}
            </div>
          )}

          {!data && !error && (
            <div className="spost" aria-hidden="true">
              <span className="skel" style={{ width: '40%', height: 12 }} />
              <span className="skel" style={{ width: '90%', height: 12 }} />
            </div>
          )}

          {data && posts.length === 0 && (
            <EmptyState title="Nobody has posted yet">
              {member ? 'Start the first conversation here.' : 'Join, and start the first conversation.'}
            </EmptyState>
          )}

          {posts.map((card) => (
            <SocialPostCard key={card.post.id} card={card} inForum
              onRemoved={(postId) => setData((current) => current && {
                ...current,
                posts: current.posts.filter((entry) => entry.post.id !== postId),
              })} />
          ))}
        </div>
      </main>
    </div>
  );
}
