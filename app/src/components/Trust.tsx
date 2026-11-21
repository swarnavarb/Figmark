import { Link } from 'react-router-dom';
import { useSession } from '../session';
import { LevelChip } from './ui';
import '../styles/Trust.css';

/**
 * The pieces that tell a newcomer this is a real place to spend money: who
 * runs it, how a payment is kept safe, and how a seller earned their mark.
 */

/** Where the guide explains the three ways to pay, Buyer Protection among them. */
export const PROTECTION_HELP = '/learn?tab=buy#buying';
/** Where a buyer writes to a person. The same address the push service signs with. */
export const SUPPORT_EMAIL = 'support@figmark.in';

export function ShieldCheck({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z" />
      <path d="m8.8 12.2 2.2 2.2 4.3-4.6" />
    </svg>
  );
}

/**
 * What a card says under a shop's name. A checked identity is the fact a
 * buyer can lean on, so it wins; a level is shown only once it is a real
 * track record, because "Lv 1 · New Shop" on every card reads as "nobody
 * here has sold anything".
 */
export function SellerBadge({ seller }: { seller: { tier?: string | null; level?: { level: number; title: string; shop?: boolean } } }) {
  if (seller.tier === 'verified' || seller.tier === 'pro') {
    return (
      <span className="sbadge" title={seller.tier === 'pro' ? 'Registered business, deposit held' : 'ID, phone and bank checked'}>
        <ShieldCheck size={12} /> Verified seller
      </span>
    );
  }
  if (seller.level && seller.level.level >= 3) return <LevelChip tag={seller.level} />;
  return null;
}

/** Beside every Buy: what keeps the money safe, and where to read how. */
export function ProtectedNote() {
  return (
    <p className="protnote">
      <span className="protnote__mark"><ShieldCheck size={16} /></span>
      <span>
        <b>Pay with Buyer Protection</b> and your money is held until you confirm the item arrived.{' '}
        <Link to={PROTECTION_HELP}>How it works</Link>
      </span>
    </p>
  );
}

/**
 * For someone who has never been here: what Figmark is, before anything
 * asks them to flip, collect or jump in.
 */
export function WelcomePanel() {
  const { user, promptAuth } = useSession();
  if (user) return null;
  return (
    <section className="fmintro" aria-labelledby="fmintro-title">
      <div className="fmintro__copy">
        <h2 id="fmintro-title" className="fmintro__title">Pre-order imports from sellers you can check.</h2>
        <p className="fmintro__lede">
          Figmark is a marketplace for import resellers in India. Join a pre-order, follow every stage until it
          reaches you, and pay with Buyer Protection so the money is held until the item arrives.
        </p>
        <div className="fmintro__acts">
          <button type="button" className="btn" onClick={() => promptAuth(undefined, 'signup')}>Create a free account</button>
          <Link to={PROTECTION_HELP} className="btn btn--ghost">How buying works</Link>
        </div>
      </div>
      <ul className="fmintro__points">
        <li>
          <span className="fmintro__icon"><ShieldCheck size={18} /></span>
          <span><b>Buyer Protection</b>Your payment is held until you confirm delivery. Disputes are reviewed by someone who is neither buyer nor seller.</span>
        </li>
        <li>
          <span className="fmintro__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="12" r="2.5" /><path d="M14 10h4M14 14h3" /></svg></span>
          <span><b>Sellers verify their ID</b>Every shop confirms its identity, phone and email before it can sell.</span>
        </li>
        <li>
          <span className="fmintro__icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z" /></svg></span>
          <span><b>Reviews from real orders</b>Only a buyer whose order was completed can review a shop.</span>
        </li>
      </ul>
    </section>
  );
}

/** The bottom of every marketplace page: who runs this, and how to reach them. */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="sitefoot">
      <div className="sitefoot__inner">
        <div className="sitefoot__brand">
          <Link to="/" className="brand" aria-label="Figmark home">
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__name">Figmark</span>
          </Link>
          <p>A marketplace for import resellers in India: pre-orders, tracked lots and Buyer Protection.</p>
        </div>
        <nav className="sitefoot__cols" aria-label="Footer">
          <div>
            <h2>Buying</h2>
            <Link to={PROTECTION_HELP}>Buyer Protection</Link>
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
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            <Link to="/learn">Guide</Link>
            <Link to="/legal/grievance">Grievance Officer</Link>
          </div>
          <div>
            <h2>Legal</h2>
            <Link to="/legal/terms">Terms of Use</Link>
            <Link to="/legal/privacy">Privacy Policy</Link>
            <Link to="/legal">All policies</Link>
          </div>
        </nav>
      </div>
      <p className="sitefoot__base">© {year} Figmark. Made in India.</p>
    </footer>
  );
}
