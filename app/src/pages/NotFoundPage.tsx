import { Link, useLocation } from 'react-router-dom';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, Icon } from '../components/ui';

/**
 * An address the app has no screen for.
 *
 * It used to send you to the catalogue without a word, so a mistyped or broken
 * link looked like it had worked and you were left wondering where the thing
 * you followed it for had gone.
 */
export function NotFoundPage() {
  const { pathname } = useLocation();
  return (
    <main className="page">
      <BackLink to="/" title="Page not found" />
      <EmptyState icon={<Icon name="search" size={26} />} title="Nothing lives at this address">
        <span className="notfound__path">{pathname}</span> may have moved, or the link was cut short.
      </EmptyState>
      <div className="notfound__go">
        <Link to="/" className="btn">Go to the catalogue</Link>
        <Link to="/discover" className="btn btn--ghost">Discover</Link>
      </div>
    </main>
  );
}
