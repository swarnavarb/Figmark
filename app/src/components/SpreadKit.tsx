import { Suspense, lazy, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { driveTag, TIMING_LABELS, type ReferralTiming, type ReferralView } from '@shared/referral';
import { ApiRequestError, api, type PostCard, type ShopDrive } from '../api';
import { formatMoney } from '../format';
import { useNow } from '../clock';
import { useSession } from '../session';
import { Icon } from './Icon';
import { useShareSheet, type ShareSpec } from './ShareKit';

/*
 * Spread the word, wherever it shows: the post itself, a banner on the shop's
 * page while one runs, and the nudge a shop sees on a live drop or an item to
 * start one.
 *
 * Every link a person shares from here carries their invite and the drive, so
 * a new account made through it counts for them (see shared/referral.ts).
 */

const PostStudio = lazy(() => import('./PostStudio').then((module) => ({ default: module.PostStudio })));

/** "2d 4h", "3h 12m", "8m": what is left until a moment, ticking each minute. */
function useCountdown(iso: string): string {
  const end = Date.parse(iso);
  const now = useNow(end > Date.now() ? 60_000 : null);
  const minutes = Math.max(0, Math.ceil((end - now) / 60_000));
  if (minutes >= 48 * 60) return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/** What a drive points people at, in words. */
function targetLine(referral: ReferralView): string {
  if (referral.target.kind === 'drop') return `the ${referral.target.name} live drop`;
  if (referral.target.kind === 'listing') return referral.target.title;
  return referral.storeName;
}

/** The share sheet's spec for this person's link to a drive. */
export function driveShareSpec(referral: ReferralView, channelId: string, postId: string, body: string): ShareSpec {
  const drive = driveTag(channelId, postId);
  const page = referral.storeHandle
    ? { to: 'page' as const, handle: referral.storeHandle, drive }
    : { to: 'invite' as const };
  const link = referral.target.kind === 'listing'
    ? { to: 'item' as const, listingId: referral.target.listingId, drive }
    : page;
  const what = referral.target.kind === 'drop' ? ` - their live drop "${referral.target.name}"`
    : referral.target.kind === 'listing' ? ` - ${referral.target.title}` : '';
  return {
    kind: referral.target.kind === 'listing' ? 'item' : 'shop',
    moment: {
      headline: referral.target.kind === 'drop' ? 'Live drop - join me' : 'You need to see this shop',
      title: referral.target.kind === 'listing' ? referral.target.title : referral.storeName,
      detail: referral.target.kind === 'drop' ? `${referral.target.name} · ${referral.storeName}` : body.slice(0, 80) || null,
    },
    link,
    caption: `Check out ${referral.storeName} on Figmark${what} 🔥`,
    target: referral.target.kind === 'listing' ? referral.target.listingId : referral.storeHandle,
    storeId: null,
  };
}

/** The timer: counting to the start, then to the end. */
function DriveClock({ referral }: { referral: ReferralView }) {
  const soon = referral.phase === 'soon';
  const left = useCountdown(soon ? referral.startsAt : referral.endsAt);
  if (referral.phase === 'ended') return <span className="spread__clock is-done">Ended</span>;
  return (
    <span className={`spread__clock${soon ? ' is-soon' : ''}`} aria-live="off">
      <span className="spread__dot" aria-hidden="true" />
      {soon ? `Starts in ${left}` : `${left} left`}
    </span>
  );
}

/** The post's own face: what it pays, the timer, your link, and who is ahead. */
export function SpreadPlay({ card, disabled, onCard }: { card: PostCard; disabled: boolean; onCard: (card: PostCard) => void }) {
  const referral = card.social.referral!;
  const { user } = useSession();
  const { open, sheet } = useShareSheet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = Boolean(card.social.host);
  const ended = referral.phase === 'ended';
  const mine = referral.mine;
  const spec = () => driveShareSpec(referral, card.post.channelId, card.post.id, card.post.body);

  async function take() {
    setError(null);
    // The shop shares its own drive like anyone, but is never on its board.
    if (host || mine?.in) {
      open(spec());
      return;
    }
    setBusy(true);
    try {
      const { card: next } = await api.joinSpread(card.post.channelId, card.post.id);
      onCard(next);
      open(driveShareSpec(next.social.referral ?? referral, card.post.channelId, card.post.id, card.post.body));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not get your link.');
    } finally {
      setBusy(false);
    }
  }

  const earned = mine ? Math.min(mine.joins, referral.maxPerPerson) * referral.rewardMinor : 0;

  return (
    <section className={`spread${ended ? ' is-ended' : ''}`} aria-label="Spread the word">
      <div className="spread__head">
        <span className="spread__kicker"><Icon name="megaphone" size={13} /> Spread the word</span>
        <DriveClock referral={referral} />
      </div>
      <p className="spread__offer">
        <strong>{formatMoney(referral.rewardMinor, 'INR')}</strong>
        <span> store credit for every new buyer you bring to {targetLine(referral)}</span>
      </p>
      <p className="spread__small faint">
        {TIMING_LABELS[referral.timing]} · up to {referral.maxPerPerson} people each
        {referral.topPrizeMinor > 0 && <> · <b>+{formatMoney(referral.topPrizeMinor, 'INR')}</b> for whoever brings the most</>}
      </p>

      {!ended && !disabled && user && (
        <div className="spread__act">
          <button type="button" className="btn spread__go" disabled={busy} onClick={() => void take()}>
            <Icon name="share" size={15} /> {busy ? 'Getting your link…' : host ? 'Share it yourself' : mine?.in ? 'Share my link again' : 'Get my link'}
          </button>
          {mine?.in && (
            <span className="spread__mine">
              <Icon name="users" size={14} /> {mine.joins} joined through you{earned > 0 ? ` · ${formatMoney(earned, 'INR')} so far` : ''}
            </span>
          )}
        </div>
      )}
      {!ended && !user && <p className="faint spread__small">Sign in to get your own link.</p>}
      {!ended && disabled && user && (
        <Link className="btn btn--sm spread__go" to={`/social/p/${encodeURIComponent(card.post.channelId)}/${encodeURIComponent(card.post.id)}`}>
          <Icon name="share" size={14} /> Open it to get your link
        </Link>
      )}
      {error && <p className="spread__error" role="alert">{error}</p>}

      <div className="spread__stats">
        <span><b>{referral.joined}</b> joined</span>
        <span><b>{referral.sharers}</b> sharing</span>
      </div>

      {referral.leaders.length > 0 && !ended && (
        <ol className="spread__board" aria-label="Who has brought the most">
          {referral.leaders.map((row, index) => (
            <li key={`${row.name}-${index}`}>
              <span className="spread__rank">{index + 1}</span>
              <span className="spread__name">{row.name}</span>
              <span className="spread__count">{row.joins}</span>
            </li>
          ))}
        </ol>
      )}

      {ended && (
        referral.payouts && referral.payouts.length > 0 ? (
          <ol className="spread__board" aria-label="Who was paid">
            {referral.payouts.map((row, index) => (
              <li key={`${row.name}-${index}`}>
                <span className="spread__rank">{row.top ? '🏆' : index + 1}</span>
                <span className="spread__name">{row.name}</span>
                <span className="spread__count">{formatMoney(row.amountMinor, 'INR')}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="faint spread__small">{referral.payouts ? 'Nobody brought a verified buyer this time.' : 'Paying out…'}</p>
        )
      )}
      {mine?.paidMinor ? <p className="spread__won">🎉 You won {formatMoney(mine.paidMinor, 'INR')} store credit at {referral.storeName}.</p> : null}

      <p className="spread__rules faint">
        Counts brand-new Figmark accounts made through your link while the timer runs, once they verify their phone. Credit lands when it ends and is spent at {referral.storeName} only.
      </p>
      {referral.terms && (
        <details className="spread__terms"><summary>Prize T&amp;C</summary><p>{referral.terms}</p></details>
      )}
      {sheet}
    </section>
  );
}

/**
 * On a shop's page while it runs a Spread the word: the offer, the timer, and
 * the visitor's own link. Nothing while it runs none.
 */
export function ShopDriveBanner({ shopId, isMe }: { shopId: string; isMe: boolean }) {
  const [drive, setDrive] = useState<ShopDrive | null>(null);
  const { user } = useSession();
  const { open, sheet } = useShareSheet();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.shopSpread(shopId).then((result) => live && setDrive(result.drive)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [shopId, user?.id]);

  if (!drive) return null;
  const { referral } = drive;
  const href = `/social/p/${encodeURIComponent(drive.channelId)}/${encodeURIComponent(drive.postId)}`;

  async function take() {
    if (!drive) return;
    setError(null);
    try {
      if (!isMe && !drive.referral.mine?.in) await api.joinSpread(drive.channelId, drive.postId);
      open(driveShareSpec(drive.referral, drive.channelId, drive.postId, drive.body));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not get your link.');
    }
  }

  return (
    <aside className="spread spread--banner" aria-label="Spread the word">
      <div className="spread__head">
        <span className="spread__kicker"><Icon name="megaphone" size={13} /> Spread the word</span>
        <DriveClock referral={referral} />
      </div>
      <p className="spread__offer">
        {isMe ? 'You are paying ' : 'Bring a friend, get '}<strong>{formatMoney(referral.rewardMinor, 'INR')}</strong>
        <span> store credit {isMe ? 'for every new buyer people bring' : `for each new buyer you bring to ${targetLine(referral)}`}</span>
      </p>
      <div className="spread__act">
        {user ? (
          <button type="button" className="btn btn--sm spread__go" onClick={() => void take()}>
            <Icon name="share" size={14} /> {isMe ? 'Share the shop' : 'Get my link'}
          </button>
        ) : (
          <Link className="btn btn--sm spread__go" to="/login">Sign in for your link</Link>
        )}
        <Link className="btn btn--quiet btn--sm" to={href}>{isMe ? 'See the board' : 'How it works'}</Link>
      </div>
      {error && <p className="spread__error" role="alert">{error}</p>}
      {sheet}
    </aside>
  );
}

/** What a nudge starts a drive about. */
export type SpreadAbout =
  | { kind: 'drop'; saleId: string; name: string; timing: Exclude<ReferralTiming, 'now'> }
  | { kind: 'listing'; listingId: string; title: string };

/**
 * The nudge a shop sees on a live drop or one of its items: start a Spread the
 * word about it, already pointed at it. Opens the studio over the page.
 */
export function SpreadNudge({ storeId, storeName, about, compact = false }: {
  storeId: string;
  storeName: string;
  about: SpreadAbout;
  compact?: boolean;
}) {
  const [making, setMaking] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const line = about.kind === 'drop'
    ? about.timing === 'before' ? 'Fill the room before it starts: pay credit for every new buyer your followers bring.'
      : about.timing === 'during' ? 'Pay credit for every new buyer brought in while it runs.'
        : 'Sell what is left: pay credit for every new buyer brought in after it ends.'
    : 'Pay credit to whoever brings a new buyer to this item.';

  if (done) {
    return (
      <div className={`spread-nudge is-done${compact ? ' spread-nudge--compact' : ''}`}>
        <span aria-hidden="true">📣</span>
        <span>Spread the word is up. <Link to={done}>See it</Link></span>
      </div>
    );
  }

  return (
    <>
      <div className={`spread-nudge${compact ? ' spread-nudge--compact' : ''}`}>
        <span className="spread-nudge__emoji" aria-hidden="true">📣</span>
        <span className="spread-nudge__copy">
          <strong>Get people talking outside Figmark</strong>
          <span>{line}</span>
        </span>
        <button type="button" className="btn btn--sm spread-nudge__go" onClick={() => setMaking(true)}>Spread the word</button>
      </div>
      {making && (
        <Suspense fallback={null}>
          <PostStudio mode="spread" storeId={storeId} storeName={storeName}
            presets={{ spread: about }}
            onClose={() => setMaking(false)}
            onPosted={(post) => {
              setMaking(false);
              setDone(`/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`);
            }} />
        </Suspense>
      )}
    </>
  );
}

/**
 * Discover's "Earn store credit" row: every drive running or about to, as a
 * small card - the shop, what it pays per friend, the timer, how many joined.
 * Tapping one opens the post, where the link is.
 */
export function SpreadRow({ cards }: { cards: PostCard[] }) {
  return (
    <div className="spreadrow">
      {cards.map((card, index) => {
        const referral = card.social.referral;
        if (!referral) return null;
        const photo = card.post.photoUrls?.[0] ?? card.post.photoUrl ?? null;
        return (
          <Link key={card.post.id} to={`/social/p/${encodeURIComponent(card.post.channelId)}/${encodeURIComponent(card.post.id)}`} className="spreadcard" style={{ animationDelay: `${index * 40}ms` }}>
            <span className="spreadcard__top">
              {photo ? <img src={photo} alt="" loading="lazy" /> : <span className="spreadcard__emoji" aria-hidden="true">📣</span>}
              <DriveClock referral={referral} />
            </span>
            <span className="spreadcard__body">
              <span className="spreadcard__shop">{referral.storeName}</span>
              <span className="spreadcard__pay"><strong>{formatMoney(referral.rewardMinor, 'INR')}</strong> per friend you bring</span>
              <span className="faint">
                {referral.target.kind === 'drop' ? `⚡ ${referral.target.name}` : referral.target.kind === 'listing' ? referral.target.title : 'The whole shop'}
              </span>
              <span className="spreadcard__meta">
                {referral.joined} joined · {referral.sharers} sharing{referral.mine?.in ? ' · you’re in' : ''}
              </span>
            </span>
          </Link>
        );
      })}
    </div>
  );
}
