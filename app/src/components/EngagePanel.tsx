import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { SkelCards } from './PageSkeletons';
import { Link } from 'react-router-dom';
import type { StoreAccess } from '@shared/stores';
import { ApiRequestError, api, type PostCard } from '../api';
import { SocialPostCard, postHref } from './SocialPost';
import { EmptyState, ErrorNotice } from './ui';
import { Icon } from './Icon';
import { isOpen, waitingOnShop } from '../engage';
import type { StudioMode } from './PostStudio';
import { EngageHelp } from './EngageHelp';
import '../styles/EngagePanel.css';

import { plural } from '../format';

const PostStudio = lazy(() => import('./PostStudio').then((module) => ({ default: module.PostStudio })));

const STARTS: { id: string; emoji: string; label: string; line: string; hue: string; mode: StudioMode; presets?: { stock?: boolean; prize?: boolean } }[] = [
  { id: 'contest', emoji: '🏆', label: 'Photo competition', line: 'You set prizes; they or you pick.', hue: 'gold', mode: 'contest' },
  { id: 'guess', emoji: '🎯', label: 'Guess the price', line: 'Sealed till the reveal.', hue: 'violet', mode: 'guess' },
  { id: 'poll', emoji: '📊', label: 'Poll', line: 'Reward whoever picks the winner.', hue: 'aqua', mode: 'poll' },
  { id: 'stock', emoji: '📦', label: 'What to stock next', line: 'Voters get first dibs.', hue: 'lime', mode: 'poll', presets: { stock: true } },
  { id: 'debate', emoji: '🎤', label: 'Debate with a prize', line: 'Credit for the best argument.', hue: 'pink', mode: 'debate', presets: { prize: true } },
  { id: 'versus', emoji: '⚔️', label: 'Debate', line: 'Two sides, no prize.', hue: 'coral', mode: 'debate' },
  { id: 'question', emoji: '❓', label: 'Ask your buyers', line: 'One question, open answers.', hue: 'blue', mode: 'question' },
  { id: 'compare', emoji: '🎨', label: 'Before & after', line: 'A restore or a glow-up.', hue: 'pink', mode: 'compare' },
  { id: 'photo', emoji: '📸', label: 'Photo tag', line: 'New arrivals, every piece tagged.', hue: 'violet', mode: 'photo' },
  { id: 'spread', emoji: '📣', label: 'Spread the word', line: 'Pay credit for new people who join.', hue: 'gold', mode: 'spread' },
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
  const [helping, setHelping] = useState<(typeof STARTS)[number] | null>(null);

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
          <p className="muted">Polls, debates and competitions go to every follower and lead Discover while they are open. Spread the word pays your buyers for bringing new ones from outside Figmark. Prizes are store credit, spent only at your shop.</p>
          <p className="sengage__hint">Not sure which one to pick? Tap <span className="sengage__hinti" aria-hidden="true">i</span> on any card to see what it is and when to use it.</p>
        </div>
        <div className="sengage__starts">
          {STARTS.map((entry, index) => (
            <div key={entry.id} className="sengage__tile" style={{ animationDelay: `${index * 35}ms` }}>
              <button type="button" className={`sengage__start sengage__start--${entry.hue}`} onClick={() => setMaking(entry)}>
                <span className="sengage__emoji" aria-hidden="true">{entry.emoji}</span>
                <strong>{entry.label}</strong>
                <span className="sengage__line">{entry.line}</span>
              </button>
              <button type="button" className="sengage__info" aria-label={`What is ${entry.label} and when to use it`}
                onClick={() => setHelping(entry)}>i</button>
            </div>
          ))}
        </div>
      </section>

      {error && <ErrorNotice message={error} />}
      {!cards && !error && <SkelCards n={2} h={110} />}

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
                <div key={card.post.id} className="sengage__stockcard">
                  <Link to={postHref(card.post)} className="sengage__stocktitle"><strong>{card.post.body}</strong></Link>
                  {[...poll.options].sort((a, b) => b.votes - a.votes).map((option) => {
                    const stocked = (poll.stocked ?? []).includes(option.id);
                    return (
                      <span key={option.id} className="sengage__stockrow">
                        <span>{option.label}</span>
                        <span className="sengage__track"><span style={{ transform: `scaleX(${option.votes / most})` }} /></span>
                        <span className="faint">{option.votes}</span>
                        {stocked ? <span className="sengage__stocked">✓ Listed</span> : (
                          <Link className="btn btn--quiet btn--sm sengage__listit"
                            to={`/sell?store=${encodeURIComponent(store.ownerId)}`}
                            state={{
                              title: option.label,
                              fromPoll: { channelId: card.post.channelId, postId: card.post.id, optionId: option.id, label: option.label, voters: option.votes },
                            }}
                            title="List it - the people who voted for it get first dibs for 24 hours">
                            List it
                          </Link>
                        )}
                      </span>
                    );
                  })}
                  <span className="faint">{poll.total} vote{poll.total === 1 ? '' : 's'} · {poll.closed ? 'closed' : 'open'} · voters get first dibs on what you list</span>
                </div>
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
                  <span>{card.social.referral ? '📣' : card.post.contest ? '🏆' : card.social.guess ? '🎯' : card.post.debate ? '⚔️' : '📊'}</span>
                  <span className="sengage__donetitle">{card.post.contest?.title ?? card.post.body}</span>
                  <span className="faint">
                    {card.social.referral ? plural(card.social.referral.joined, 'new buyer')
                      : card.post.contest ? plural(card.post.contest.entries.length, 'entry', 'entries')
                      : card.social.guess ? plural(card.social.guess.count, 'guess', 'guesses') : plural(card.social.poll?.total ?? 0, 'vote')}
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

      {helping && (
        <EngageHelp id={helping.id} title={helping.label} emoji={helping.emoji} onClose={() => setHelping(null)}
          onStart={() => { const entry = helping; setHelping(null); setMaking(entry); }} />
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
