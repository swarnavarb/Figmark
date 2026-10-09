import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session';

/**
 * A page that is only about somebody's own account, opened by a guest.
 *
 * The address is kept and the sign-in popup opens over it, so signing in
 * lands them right here with the page they asked for.
 */
export function GuestWall() {
  const { promptAuth } = useSession();
  useEffect(() => {
    promptAuth();
  }, [promptAuth]);

  return (
    <main className="page guestwall">
      <span className="guestwall__lock" aria-hidden="true">🔒</span>
      <h1>Sign in to see this</h1>
      <p>This page is about your own account. Sign in or create a free account, and it opens right here.</p>
      <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        <button type="button" className="btn" onClick={() => promptAuth()}>Log in or sign up</button>
        <Link to="/" className="btn btn--ghost">Keep browsing</Link>
      </div>
    </main>
  );
}
