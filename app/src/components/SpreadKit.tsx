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
  if (referral.target.kind === 'drop') {
    const name = referral.target.name;
    return /\bdrop\b/i.test(name) ? name : `the ${name} live drop`;
  }
  if (referral.target.kind === 'listing') return referral.target.title;
  return referral.storeName;
}

/** The next goal still to reach, and how far off it is, in a few words. */
function nextGoalLine(referral: ReferralView): string | null {
  const next = referral.goals.find((goal) => !goal.reached);
  if (!next) return referral.goals.length ? 'Every goal reached 🎉' : null;
  const gift = next.perk || (next.creditMinor ? `${formatMoney(next.creditMinor, 'INR')} credit each` : '');
  return `${next.at - referral.joined} more to unlock: ${gift}`;
}

/** What a drive pays, short: per friend, or its goals. */
function payShort(referral: ReferralView): { big: string; small: string } {
  if (referral.rewardMinor > 0) return { big: formatMoney(referral.rewardMinor, 'INR'), small: 'per friend you bring' };
  return { big: `${referral.goals.length} goal${referral.goals.length === 1 ? '' : 's'}`, small: 'to unlock together' };
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
      headline: referral.target.kind === 'drop' ? 'Live drop - join me'
        : referral.target.kind === 'listing' ? 'You need to see this' : 'You need to see this shop',
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

/** What a drive pays a sharer, as the big line: per friend when it does, else its first goal. */
function Offer({ referral, compact = false }: { referral: ReferralView; compact?: boolean }) {
  const first = referral.goals[0];
  if (referral.rewardMinor > 0) {
    return (
      <p className="spread__offer">
        <strong>{formatMoney(referral.rewardMinor, 'INR')}</strong>
        <span> store credit for every new buyer you bring{compact ? '' : ` to ${targetLine(referral)}`}</span>
      </p>
    );
  }
  return (
    <p className="spread__offer">
      <span>Bring new buyers to {targetLine(referral)} and unlock rewards </span><strong>together</strong>
      {first && !compact && <span className="spread__offerline"> - first at {first.at} new buyers</span>}
    </p>
  );
}

/**
 * The goals everybody is working towards, as one bar with a marker per goal
 * and a line for each saying what it unlocks. The bar fills as people join;
 * a goal passed glows. The count is everyone who joined while it runs and
 * the verified count once it is paid - goals pay on that one.
 */
export function GoalTrack({ referral }: { referral: ReferralView }) {
  if (referral.goals.length === 0) return null;
  const top = referral.goals[referral.goals.length - 1]!.at;
  const next = referral.goals.find((goal) => !goal.reached) ?? null;
  const fill = Math.min(1, referral.joined / top);
  return (
    <div className="goals">
      <div className="goals__head">
        <span className="goals__title">🎯 Goals everyone unlocks</span>
        <span className="goals__count"><b>{referral.joined}</b>{next ? ` / ${next.at}` : ''} new buyers</span>
      </div>
      <div className="goals__bar" role="progressbar" aria-valuemin={0} aria-valuemax={top} aria-valuenow={Math.min(referral.joined, top)}
        aria-label="New buyers brought so far">
        <span className="goals__fill" style={{ transform: `scaleX(${fill})` }} />
        {referral.goals.map((goal) => (
          <span key={goal.at} className={`goals__mark${goal.reached ? ' is-reached' : ''}`} style={{ left: `${(goal.at / top) * 100}%` }}>
            {goal.reached ? '✓' : goal.at}
          </span>
        ))}
      </div>
      <ul className="goals__list">
        {referral.goals.map((goal) => (
          <li key={goal.at} className={goal.reached ? 'is-reached' : ''}>
            <span className="goals__at">{goal.reached ? '🔓' : '🔒'} {goal.at}</span>
            <span className="goals__gift">
              {[goal.creditMinor ? `${formatMoney(goal.creditMinor, 'INR')} credit for everyone who brought someone` : '', goal.perk].filter(Boolean).join(' + ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
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
      <Offer referral={referral} />
      <p className="spread__small faint">
        {TIMING_LABELS[referral.timing]}{referral.rewardMinor > 0 && ` · up to ${referral.maxPerPerson} people each`}
        {referral.topPrizeMinor > 0 && <> · <b>+{formatMoney(referral.topPrizeMinor, 'INR')}</b> for whoever brings the most</>}
      </p>
      {referral.welcomeMinor > 0 && (
        <p className="spread__welcome">🎁 Friends get <b>{formatMoney(referral.welcomeMinor, 'INR')}</b> to spend at {referral.storeName} when they join</p>
      )}
      <GoalTrack referral={referral} />

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
      <Offer referral={referral} />
      {nextGoalLine(referral) && <p className="spread__small spread__next">🎯 {nextGoalLine(referral)}</p>}
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

/** The studio, opened over the page already pointed at what it is about. */
export function SpreadStudio({ storeId, storeName, about, onClose, onPosted }: {
  storeId: string;
  storeName: string;
  about: SpreadAbout;
  onClose: () => void;
  onPosted: (href: string) => void;
}) {
  return (
    <Suspense fallback={null}>
      <PostStudio mode="spread" storeId={storeId} storeName={storeName} presets={{ spread: about }}
        onClose={onClose}
        onPosted={(post) => onPosted(`/social/p/${encodeURIComponent(post.channelId)}/${encodeURIComponent(post.id)}`)} />
    </Suspense>
  );
}

/** Whether a running drive is about this drop or item, or the whole shop (which covers both). */
function covers(drive: ShopDrive, about: SpreadAbout): boolean {
  const target = drive.referral.target;
  if (target.kind === 'shop') return true;
  if (about.kind === 'drop') return target.kind === 'drop' && target.saleId === about.saleId;
  return target.kind === 'listing' && target.listingId === about.listingId;
}

/** What the nudge says, for what it is about and when. */
function pitch(about: SpreadAbout): { title: string; line: string } {
  if (about.kind === 'listing') {
    return { title: 'Get this in front of new buyers', line: 'Your buyers share their own link on WhatsApp and Instagram. You pay store credit only for brand-new buyers who join.' };
  }
  if (about.timing === 'before') {
    return { title: `Fill the room before ${about.name} starts`, line: 'Pay store credit for every new buyer your followers bring before the first item drops.' };
  }
  if (about.timing === 'during') {
    return { title: `Bring new buyers in while ${about.name} runs`, line: 'Every new buyer brought in while it is live earns whoever brought them store credit.' };
  }
  return { title: `Sell what is left of ${about.name}`, line: 'Pay store credit for new buyers brought in after the drop - they find what is still in the shop.' };
}

/**
 * The nudge a shop sees on a live drop or one of its items: start a Spread
 * the word about it, already pointed at it. Once one is running - about this,
 * or about the whole shop - it turns into the drive's live scoreboard instead.
 */
export function SpreadNudge({ storeId, storeName, about, compact = false }: {
  storeId: string;
  storeName: string;
  about: SpreadAbout;
  compact?: boolean;
}) {
  const [making, setMaking] = useState(false);
  const [running, setRunning] = useState<ShopDrive | null>(null);
  const [checked, setChecked] = useState(0);
  const { open, sheet } = useShareSheet();

  useEffect(() => {
    let live = true;
    api.shopSpread(storeId)
      .then((result) => live && setRunning((result.drives ?? []).find((drive) => covers(drive, about)) ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `about` is a fresh object each render; what it names is in the key
  }, [storeId, about.kind === 'drop' ? about.saleId : about.listingId, checked]);

  if (running) {
    const { referral } = running;
    const href = `/social/p/${encodeURIComponent(running.channelId)}/${encodeURIComponent(running.postId)}`;
    return (
      <div className={`spread-nudge spread-nudge--live${compact ? ' spread-nudge--compact' : ''}`}>
        <div className="spread-nudge__head">
          <span className="spread-nudge__badge" aria-hidden="true">📣</span>
          <span className="spread-nudge__copy">
            <span className="spread-nudge__eyebrow">Spread the word is on</span>
            <strong>{payShort(referral).big} {payShort(referral).small.replace('you bring', 'brought')} · {targetLine(referral)}</strong>
          </span>
        </div>
        <div className="spread-nudge__stats">
          <DriveClock referral={referral} />
          <span><b>{referral.joined}</b> new buyers</span>
          <span><b>{referral.sharers}</b> sharing</span>
          {referral.leaders[0] && <span>🏆 <b>{referral.leaders[0].name}</b> leads</span>}
        </div>
        <GoalTrack referral={referral} />
        <div className="spread-nudge__acts">
          <Link className="btn btn--sm spread-nudge__go" to={href}>See the board</Link>
          <button type="button" className="btn btn--quiet btn--sm"
            onClick={() => open(driveShareSpec(referral, running.channelId, running.postId, running.body))}>
            <Icon name="share" size={14} /> Share it
          </button>
        </div>
        {sheet}
      </div>
    );
  }

  const { title, line } = pitch(about);
  return (
    <>
      <div className={`spread-nudge${compact ? ' spread-nudge--compact' : ''}`}>
        <div className="spread-nudge__head">
          <span className="spread-nudge__badge" aria-hidden="true">📣</span>
          <span className="spread-nudge__copy">
            <span className="spread-nudge__eyebrow">Spread the word</span>
            <strong>{title}</strong>
          </span>
        </div>
        <p className="spread-nudge__line">{line}</p>
        <ol className="spread-nudge__steps" aria-label="How it works">
          <li><span>1</span> You set the credit</li>
          <li><span>2</span> Buyers share their link</li>
          <li><span>3</span> New buyers join, they earn</li>
        </ol>
        <button type="button" className="btn spread-nudge__go" onClick={() => setMaking(true)}>
          <Icon name="megaphone" size={15} /> Start Spread the word
        </button>
      </div>
      {making && (
        <SpreadStudio storeId={storeId} storeName={storeName} about={about}
          onClose={() => setMaking(false)}
          onPosted={() => {
            setMaking(false);
            setChecked((count) => count + 1);
          }} />
      )}
    </>
  );
}

/**
 * Discover's "Earn store credit" row: every drive running or about to, as a
 * small card - the shop, what it pays per friend, the timer, how many joined.
 * Tapping one opens the post, where the link is.
 */
export function SpreadRow({ cards, grid = false }: { cards: PostCard[]; grid?: boolean }) {
  return (
    <div className={`spreadrow${grid ? ' spreadrow--grid' : ''}`}>
      {cards.map((card, index) => {
        const referral = card.social.referral;
        if (!referral) return null;
        const photo = card.post.photoUrls?.[0] ?? card.post.photoUrl ?? null;
        return (
          <Link key={card.post.id} to={`/social/p/${encodeURIComponent(card.post.channelId)}/${encodeURIComponent(card.post.id)}`} className="spreadcard" style={{ animationDelay: `${index * 40}ms` }}>
            <span className="spreadcard__top">
              {photo ? <img src={photo} alt="" loading="lazy" /> : (
                <span className="spreadcard__art" aria-hidden="true">
                  <span className="spreadcard__emoji">📣</span>
                  <span className="spreadcard__tag">Bring a friend</span>
                </span>
              )}
              <DriveClock referral={referral} />
            </span>
            <span className="spreadcard__body">
              <span className="spreadcard__shop">{referral.storeName}</span>
              <span className="spreadcard__pay"><strong>{payShort(referral).big}</strong> {payShort(referral).small}</span>
              <span className="faint">
                {referral.target.kind === 'drop' ? `⚡ ${referral.target.name}` : referral.target.kind === 'listing' ? referral.target.title : 'The whole shop'}
              </span>
              {referral.goals.length > 0 && (
                <span className="spreadcard__goal">
                  <span className="spreadcard__bar"><span style={{ transform: `scaleX(${Math.min(1, referral.joined / referral.goals[referral.goals.length - 1]!.at)})` }} /></span>
                  <span>{nextGoalLine(referral)}</span>
                </span>
              )}
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
