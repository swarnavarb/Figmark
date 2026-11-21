import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { LevelChip } from './ui';
import { BlueTick } from './BlueTick';
import '../styles/Trust.css';

/**
 * The pieces that tell a newcomer this is a real place to spend money: who
 * runs it, how a payment is kept safe, and how a seller earned their mark.
 */

/** Where the guide explains the three ways to pay, Buyer Protection among them. */
export const PROTECTION_HELP = '/learn?tab=buy#buying';
/** Where a buyer writes to a person. The same address the push service signs with. */
export const SUPPORT_EMAIL = 'support@figmark.in';

/** Buyer Protection is not live yet: everywhere it is promised, it says so. */
export const UPCOMING = '(Upcoming)';

export function ShieldCheck({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </svg>
  );
}

const TICK_NOTES: Record<string, { label: string; note: string }> = {
  verified: { label: 'Verified seller', note: 'Verified seller: ID, phone and bank have been checked.' },
  pro: { label: 'Verified business', note: 'Verified business: a registered business, with a deposit held.' },
};

/**
 * The blue tick beside a shop's name, for a shop whose identity has been
 * checked. Nothing otherwise. A tap says what it stands for.
 */
export function SellerTick({ tier, size = 16 }: { tier?: string | null; size?: number }) {
  const what = tier ? TICK_NOTES[tier] : undefined;
  if (!what) return null;
  return <BlueTick size={size} label={what.label} note={what.note} />;
}

/**
 * The tagline under a shop's name on a card: its level, once that is a real
 * track record. "Lv 1 · New Shop" on every card read as "nobody here has
 * sold anything", so below level 3 there is none.
 */
export function SellerLevel({ seller }: { seller: { level?: { level: number; title: string; shop?: boolean } } }) {
  if (seller.level && seller.level.level >= 3) return <LevelChip tag={seller.level} />;
  return null;
}

/** Beside every Buy: what will keep the money safe, and where to read how. */
export function ProtectedNote() {
  return (
    <p className="protnote">
      <span className="protnote__mark"><ShieldCheck size={16} /></span>
      <span>
        <b>Pay with Buyer Protection {UPCOMING}</b> and your money is held until you confirm the item arrived.{' '}
        <Link to={PROTECTION_HELP}>How it works</Link>
      </span>
    </p>
  );
}

/**
 * For someone who has never been here: what Figmark is, in one line, and
 * the one way in.
 */
export function WelcomePanel() {
  const { user, promptAuth } = useSession();
  if (user) return null;
  return (
    <section className="fmintro" aria-labelledby="fmintro-title">
      <div className="fmintro__copy">
        <h2 id="fmintro-title" className="fmintro__title">Pre-order imports from sellers you can check.</h2>
        <p className="fmintro__line">
          Verified import sellers, every stage tracked, reviews only from real orders, and Buyer Protection {UPCOMING}.
        </p>
      </div>
      {/* "Log in", as in the header, but a newcomer is the one reading this: it opens on sign-up. */}
      <button type="button" className="btn fmintro__cta" onClick={() => promptAuth(undefined, 'signup')}>Log in</button>
    </section>
  );
}

/** The bottom of every marketplace page: who runs this, and how to reach them. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="sitefoot">
      <div className="sitefoot__glow" aria-hidden="true" />
      <div className="sitefoot__inner">
        <div className="sitefoot__brand">
          <Link to="/" className="brand" aria-label="Figmark home">
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__name">Figmark</span>
          </Link>
          <p className="sitefoot__tag">Import pre-orders, bought together, from sellers you can check.</p>
          <ul className="sitefoot__seals">
            <li><ShieldCheck size={14} /> Verified sellers</li>
            <li><ShieldCheck size={14} /> Reviews from real orders</li>
            <li><ShieldCheck size={14} /> Buyer Protection <em>{UPCOMING}</em></li>
          </ul>
          <a className="sitefoot__mail" href={`mailto:${SUPPORT_EMAIL}`}>
            <span>Questions? Write to us</span>
            <b>{SUPPORT_EMAIL}</b>
          </a>
        </div>
        <nav className="sitefoot__cols" aria-label="Footer">
          <div>
            <h2>Buying</h2>
            <Link to={PROTECTION_HELP}>Buyer Protection {UPCOMING}</Link>
            <Link to="/learn?tab=buy#safety">Buying safely</Link>
            <Link to="/legal/refunds">Refunds</Link>
            <Link to="/legal/shipping">Shipping</Link>
          </div>
          <div>
            <h2>Selling</h2>
            <Link to="/learn?tab=sell">Start selling</Link>
            <Link to="/legal/prohibited">Prohibited items</Link>
            <Link to="/services">Forwarders and services</Link>
          </div>
          <div>
            <h2>Help</h2>
            <Link to="/learn">Guide</Link>
            <Link to="/legal/grievance">Grievance Officer</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
          </div>
          <div>
            <h2>Legal</h2>
            <Link to="/legal/terms">Terms of Use</Link>
            <Link to="/legal/privacy">Privacy Policy</Link>
            <Link to="/legal">All policies</Link>
          </div>
        </nav>
      </div>
      <div className="sitefoot__base">
        <span>© {year} Figmark</span>
        <span className="sitefoot__dot" aria-hidden="true" />
        <span>Made in India</span>
      </div>
    </footer>
  );
}
