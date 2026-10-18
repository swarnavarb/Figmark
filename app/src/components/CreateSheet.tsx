import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import type { Post } from '@shared/models';
import { Preloader } from './Preloader';

/*
 * The two composers that are new to the app arrive with the first tap on
 * them, as every screen does (see main.tsx): most people who open this sheet
 * are listing something, and should not wait on a photo tagger to do it.
 */
const FlexComposer = lazy(() => import('./CreateComposers').then((module) => ({ default: module.FlexComposer })));
const DebateComposer = lazy(() => import('./CreateComposers').then((module) => ({ default: module.DebateComposer })));

type Action = 'sell' | 'iso' | 'flex' | 'debate';

const ACTIONS: { id: Action; emoji: string; title: string; line: string }[] = [
  { id: 'sell', emoji: '🛍️', title: 'List an Item for Sale', line: 'Price, condition, photos and shipping.' },
  { id: 'iso', emoji: '🎯', title: 'Post an ISO Request', line: 'Say what you are hunting for. Sellers who stock it hear about it.' },
  { id: 'flex', emoji: '📸', title: 'Share a Collection Flex', line: 'A shelf photo with every piece tagged.' },
  { id: 'debate', emoji: '⚔️', title: 'Start a Collector Poll / Debate', line: 'Two pieces side by side, and everybody votes.' },
];

/**
 * What the + in the middle of the tab bar opens: every way to put something
 * up, in one place.
 *
 * Listing and asking already had homes - the sell form and the ISO board - so
 * those two go there, with the form open. A flex and a debate are made right
 * here, over whatever page you were on, and land you on the post once it is up.
 */
export function CreateSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const [making, setMaking] = useState<'flex' | 'debate' | null>(null);
  const first = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (making) return;
    first.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [making, onClose]);

  function pick(action: Action) {
    if (action === 'flex' || action === 'debate') {
      setMaking(action);
      return;
    }
    // Closed here as well as by the move: from the page it goes to, there is no move.
    onClose();
    navigate(action === 'sell' ? '/sell' : '/social?view=wanted&ask=1');
  }

  const posted = (post: Pick<Post, 'channelId' | 'id'>) => {
    onClose();
    navigate(`/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`);
  };

  if (making) {
    return (
      <Suspense fallback={createPortal(<div className="csheet"><Preloader small /></div>, document.body)}>
        {making === 'flex'
          ? <FlexComposer onClose={onClose} onPosted={posted} />
          : <DebateComposer onClose={onClose} onPosted={posted} />}
      </Suspense>
    );
  }

  return createPortal(
    <div className="csheet" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="csheet__box" role="dialog" aria-modal="true" aria-labelledby="csheet-title">
        <span className="csheet__grip" aria-hidden="true" />
        <h2 id="csheet-title" className="csheet__title">What would you like to post?</h2>
        <div className="csheet__list">
          {ACTIONS.map((action, index) => (
            <button key={action.id} ref={index === 0 ? first : undefined} type="button"
              className={`csheet__item csheet__item--${action.id}`} onClick={() => pick(action.id)}>
              <span className="csheet__emoji" aria-hidden="true">{action.emoji}</span>
              <span className="csheet__text">
                <strong>{action.title}</strong>
                <span>{action.line}</span>
              </span>
              <svg className="csheet__chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 6 6 6-6 6" />
              </svg>
            </button>
          ))}
        </div>
        <button type="button" className="csheet__cancel" onClick={onClose}>Cancel</button>
      </div>
    </div>,
    document.body,
  );
}
