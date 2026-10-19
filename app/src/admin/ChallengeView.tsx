import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { contestPhase } from '@shared/play';
import { ApiRequestError, api as marketplace, type PostCard } from '../api';
import { timeAgo } from '../format';
import { Loading } from '../components/Feedback';

const PostStudio = lazy(() => import('../components/PostStudio').then((module) => ({ default: module.PostStudio })));

const PHASE_WORDS = { entries: 'Taking entries', shortlisting: 'Shortlisting', voting: 'Voting', judging: 'Judging', ended: 'Ended' } as const;

/**
 * Figmark's weekly theme challenge: the one competition the operators run.
 * Started here rather than from the marketplace's +, which is for what people
 * and shops post. Winners get a badge; Figmark holds no prize.
 */
export function ChallengeView() {
  const [cards, setCards] = useState<PostCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  const load = useCallback(async () => {
    try {
      const found = (await marketplace.discover()).contests ?? [];
      setCards(found.filter((card) => card.post.contest?.host === 'figmark'));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the challenges.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const running = (cards ?? []).some((card) => contestPhase(card.post.contest!) !== 'ended');

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <h2 style={{ margin: 0 }}>🌟 Weekly theme challenge</h2>
        <p className="muted" style={{ margin: 0 }}>
          A theme for everyone. Entries from verified people, an audience vote, and a badge for the top three.
          It leads the competitions row on Discover while it runs.
        </p>
        {running && <p className="notice notice--info" style={{ margin: 0 }}>One is already running. Starting another runs both.</p>}
        <button type="button" className="btn" style={{ justifySelf: 'start' }} onClick={() => setMaking(true)}>
          Start a challenge
        </button>
      </div>

      {error && <p className="notice notice--error">{error}</p>}
      {!cards && !error && <Loading />}
      {cards && cards.length === 0 && <p className="muted">No challenge is running or recently finished.</p>}
      {cards && cards.length > 0 && (
        <div className="card">
          {cards.map(({ post }) => {
            const contest = post.contest!;
            return (
              <div key={post.id} className="userrow" style={{ cursor: 'default' }}>
                <div className="userrow__main">
                  <span className="userrow__name">{contest.title}</span>
                  <span className="userrow__meta">
                    Started {timeAgo(post.createdAt)} · {contest.entries.length} {contest.entries.length === 1 ? 'entry' : 'entries'}
                    {contest.winners?.length ? ` · 1st ${contest.winners[0]!.name}` : ''}
                  </span>
                </div>
                <div className="userrow__tags"><span className="badge">{PHASE_WORDS[contestPhase(contest)]}</span></div>
              </div>
            );
          })}
        </div>
      )}

      {making && (
        <Suspense fallback={null}>
          <PostStudio mode="contest" figmark onClose={() => setMaking(false)} onPosted={() => { setMaking(false); void load(); }} />
        </Suspense>
      )}
    </div>
  );
}
