import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { ApiRequestError, api, type PostCard } from '../api';
import { SocialPostCard, postHref } from './SocialPost';
import { EmptyState, ErrorNotice } from './ui';
import { Preloader } from './Preloader';
import { Icon } from './Icon';
import { isOpen, waitingOnShop } from '../engage';
import type { StudioMode } from './PostStudio';
import '../styles/EngagePanel.css';

const PostStudio = lazy(() => import('./PostStudio').then((module) => ({ default: module.PostStudio })));

const STARTS: { id: string; emoji: string; label: string; mode: StudioMode; presets?: { stock?: boolean; prize?: boolean } }[] = [
  { id: 'contest', emoji: '🏆', label: 'Photo competition', mode: 'contest' },
  { id: 'poll', emoji: '📊', label: 'Poll', mode: 'poll' },
  { id: 'stock', emoji: '📦', label: 'What to stock next', mode: 'poll', presets: { stock: true } },
  { id: 'debate', emoji: '🎤', label: 'Debate with a prize', mode: 'debate', presets: { prize: true } },
  { id: 'guess', emoji: '🎯', label: 'Guess the price', mode: 'guess' },
];

/**
 * The shop's Engage screen: start something people take part in, and see
 * what is waiting on the shop - a shortlist to pick, winners to name, a prize
 * to hand over - and what buyers said they want stocked.
 */
export function EngagePanel({ store }: { store: StoreAccess }) {
  const [cards, setCards] = useState<PostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState<(typeof STARTS)[number] | null>(null);

  const load = useCallback(async () => {
    try {
      setCards((await api.shopGames(store.ownerId)).posts);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load what your shop is running.');
    }
  }, [store.ownerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const waiting = (cards ?? []).filter((card) => waitingOnShop(card));
  const stock = (cards ?? []).filter((card) => card.social.poll?.stock);
  const running = (cards ?? []).filter((card) => isOpen(card) && !waitingOnShop(card) && !card.social.poll?.stock);
  const done = (cards ?? []).filter((card) => !isOpen(card) && !waitingOnShop(card) && !card.social.poll?.stock);

  return (
    <div className="sengage">
      <section className="sengage__hero">
        <div>
          <h2>Get your buyers talking</h2>
          <p className="muted">Polls, debates and competitions go to every follower and lead Discover while they are open. Prizes are store credit, spent only at your shop.</p>
        </div>
        <div className="sengage__starts">
          {STARTS.map((entry, index) => (
            <button key={entry.id} type="button" className="sengage__start" style={{ animationDelay: `${index * 40}ms` }}
              onClick={() => setMaking(entry)}>
              <span aria-hidden="true">{entry.emoji}</span> {entry.label}
            </button>
          ))}
        </div>
      </section>

      {error && <ErrorNotice message={error} />}
      {!cards && !error && <Preloader small />}

      {waiting.length > 0 && (
        <section className="sengage__block">
          <h3><span className="sengage__badge">{waiting.length}</span> Waiting on you</h3>
          {waiting.map((card) => (
            <div key={card.post.id} className="sengage__wait">
              <p className="sengage__todo"><Icon name="bell" size={14} /> {waitingOnShop(card)}</p>
              <SocialPostCard card={card} />
            </div>
          ))}
        </section>
      )}

      {stock.length > 0 && (
        <section className="sengage__block">
          <h3>📦 What buyers want you to stock</h3>
          <div className="sengage__stock">
            {stock.map((card) => {
              const poll = card.social.poll!;
              const most = Math.max(1, ...poll.options.map((option) => option.votes));
              return (
                <Link key={card.post.id} to={postHref(card.post)} className="sengage__stockcard">
                  <strong>{card.post.body}</strong>
                  {[...poll.options].sort((a, b) => b.votes - a.votes).map((option) => (
                    <span key={option.id} className="sengage__stockrow">
                      <span>{option.label}</span>
                      <span className="sengage__track"><span style={{ transform: `scaleX(${option.votes / most})` }} /></span>
                      <span className="faint">{option.votes}</span>
                    </span>
                  ))}
                  <span className="faint">{poll.total} vote{poll.total === 1 ? '' : 's'} · {poll.closed ? 'closed' : 'open'}</span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {running.length > 0 && (
        <section className="sengage__block">
          <h3>Running now</h3>
          {running.map((card) => <SocialPostCard key={card.post.id} card={card} />)}
        </section>
      )}

      {done.length > 0 && (
        <section className="sengage__block">
          <h3>Finished</h3>
          <ul className="sengage__done">
            {done.map((card) => (
              <li key={card.post.id}>
                <Link to={postHref(card.post)}>
                  <span>{card.post.contest ? '🏆' : card.social.guess ? '🎯' : card.post.debate ? '⚔️' : '📊'}</span>
                  <span className="sengage__donetitle">{card.post.contest?.title ?? card.post.body}</span>
                  <span className="faint">
                    {card.post.contest ? `${card.post.contest.entries.length} entries`
                      : card.social.guess ? `${card.social.guess.count} guesses` : `${card.social.poll?.total ?? 0} votes`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cards && cards.length === 0 && (
        <EmptyState title="Nothing running yet">Start a poll or a competition above. Your followers hear about it straight away.</EmptyState>
      )}

      {making && (
        <Suspense fallback={null}>
          <PostStudio mode={making.mode} presets={making.presets} storeId={store.ownerId} storeName={store.name}
            onClose={() => setMaking(null)} onPosted={() => { setMaking(null); void load(); }} />
        </Suspense>
      )}
    </div>
  );
}
