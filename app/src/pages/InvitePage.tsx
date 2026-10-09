import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api, type InviteOpen } from '../api';
import { ShareButton, type ShareSpec } from '../components/ShareKit';
import { SkeletonText } from '../components/Feedback';
import { useSession } from '../session';

/**
 * `/i/<code>`: somebody's invite.
 *
 * Says who sent it and what Figmark is in three lines, then one door - join,
 * or open a shop when it was an invite to sell. The server keeps the invite
 * in a cookie, so signing up from here, or later from anywhere, files the new
 * account under whoever sent it.
 */
export function InvitePage() {
  const { code = '' } = useParams();
  const [params] = useSearchParams();
  const asSeller = params.get('as') === 'seller';
  const { user, promptAuth } = useSession();
  const [invite, setInvite] = useState<InviteOpen | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api.openInvite(code, null, asSeller)
      .then((result) => !cancelled && setInvite(result))
      .catch(() => !cancelled && setLost(true));
    return () => { cancelled = true; };
  }, [code, asSeller]);

  if (lost) return <Navigate to="/" replace />;
  if (!invite) return <main className="page invp"><SkeletonText lines={5} /></main>;

  const name = invite.inviter.shop?.name ?? invite.inviter.name;
  const seller = invite.asSeller;

  if (invite.self) {
    const spec: ShareSpec = seller
      ? {
          kind: 'invite_seller',
          moment: { title: 'Open your shop', detail: 'Pre-orders · tracking · Buyer Protection · affiliates', headline: 'Sell with me on Figmark' },
          link: { to: 'invite', seller: true },
          caption: 'Selling imports? Open a shop on Figmark with my invite:',
          target: code,
        }
      : {
          kind: 'invite',
          moment: { title: 'Join me on Figmark', detail: 'Pre-orders · Buyer Protection · card packs', headline: 'Come shop with me' },
          link: { to: 'invite' },
          caption: 'Join me on Figmark - pre-orders, Buyer Protection and card packs. Here is my invite:',
          target: code,
        };
    return (
      <main className="page invp">
        <section className={`invp__hero${seller ? ' invp__hero--seller' : ''}`}>
          <span className="invp__glyph" aria-hidden="true">{seller ? '🚀' : '💌'}</span>
          <h1>This is your invite link</h1>
          <p>Send it to friends{seller ? ' who sell' : ''}. Everyone who joins through it counts for your quests.</p>
          <div className="invp__acts">
            <ShareButton spec={spec} className="btn mshare__go">Share it</ShareButton>
            <Link to="/quests#invite" className="btn btn--quiet">See who joined</Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="page invp">
      <section className={`invp__hero${seller ? ' invp__hero--seller' : ''}`}>
        <span className="invp__glyph" aria-hidden="true">{seller ? '🚀' : '💌'}</span>
        <span className="invp__chip">{name} · Level {invite.inviter.levelTag.level} {invite.inviter.levelTag.title}</span>
        <h1>{seller ? `${name} invited you to sell on Figmark` : `${name} invited you to Figmark`}</h1>
        <p>
          {seller
            ? 'Run your pre-orders here: order manifests, tracking your buyers can see, Buyer Protection, and people who share your items for a commission.'
            : 'Pre-orders from import resellers, Buyer Protection on every payment, and reviews only real buyers can leave. You collect cards and level up as you shop.'}
        </p>
        <div className="invp__acts">
          {user ? (
            <Link to={seller ? '/shop' : '/'} className="btn mshare__go">{seller ? 'Open your shop' : 'Browse the drops'}</Link>
          ) : (
            <button type="button" className="btn mshare__go"
              onClick={() => promptAuth(seller ? `Create your account, then open your shop. ${name} gets the credit.` : `Join ${name} on Figmark.`)}>
              {seller ? 'Create your account' : 'Join Figmark'}
            </button>
          )}
          {invite.inviter.shop?.handle && (
            <Link to={`/${invite.inviter.shop.handle}`} className="btn btn--quiet">Visit {invite.inviter.shop.name}</Link>
          )}
        </div>
      </section>
      <ul className="invp__why">
        {(seller ? SELLER_REASONS : BUYER_REASONS).map((reason) => (
          <li key={reason.title}>
            <span className="invp__icon" aria-hidden="true">{reason.icon}</span>
            <span><b>{reason.title}</b>{reason.text}</span>
          </li>
        ))}
      </ul>
    </main>
  );
}

const BUYER_REASONS = [
  { icon: '🛡', title: 'Your money is held, not handed over', text: 'Buyer Protection pays the seller once your order arrives.' },
  { icon: '📦', title: 'Every stage, visible', text: 'Track your item from the supplier to your door, in the seller\'s own words.' },
  { icon: '🃏', title: 'Shopping that levels you up', text: 'Daily quests, card packs and stickers for being a good buyer.' },
];

const SELLER_REASONS = [
  { icon: '🚢', title: 'Pre-orders that fill themselves', text: 'Pre-orders with a fill meter buyers share to their own groups.' },
  { icon: '💸', title: 'Buyers who sell for you', text: 'Set a commission and every buyer gets a link that earns when it sells.' },
  { icon: '🚀', title: 'Growth quests with real reach', text: 'Share your shop, earn Spotlights, land at the top of the feed.' },
];

/** The invite, carried on for the shell to count; the moment hint was only for the preview. */
function inviteOnly(search: string): string {
  const code = new URLSearchParams(search).get('i');
  return code ? `?i=${encodeURIComponent(code)}` : '';
}

/** `/s/l/<id>`: a shared item, opened inside the app. */
export function SharedItem() {
  const { id = '' } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/listing/${encodeURIComponent(id)}${inviteOnly(search)}`} replace />;
}

/** `/s/p/<handle>`: a shared shop or person, opened inside the app. */
export function SharedPage() {
  const { handle = '' } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/${encodeURIComponent(handle)}${inviteOnly(search)}`} replace />;
}
