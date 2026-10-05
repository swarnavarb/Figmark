import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ARTIST_JOB_FLOW, ARTIST_JOB_LABELS, jobDueMinor, jobIsLive, type ArtistJobAction,
} from '@shared/service-stores';
import { protectionFeeMinor } from '@shared/orders';
import { ApiRequestError, api, type OrderServicesView, type PublicStore } from '../api';
import { formatMoney, timeAgo } from '../format';
import { ErrorNotice, Icon } from './ui';
import { OfferingCard, PlanCard, Picture, StoreMark, accentStyle } from './StoreKit';

/**
 * What a buyer can add to an item, on the order itself.
 *
 * Two services, each where its decision is made. Cover is the forwarder's,
 * offered only when the shop booked one on this lot and turned it on, and
 * only until the goods leave the origin warehouse; its premium joins the
 * order's total and is paid the way the order is. A commission is the
 * artist's, paid to them on its own - held by an escrow or sent direct.
 *
 * The shop sees the same card, read-only, plus the one thing it has to act
 * on: when a commission is paid, the piece goes to the studio, not the buyer.
 */
export function OrderServices({ orderId, onChanged }: { orderId: string; onChanged: () => Promise<void> | void }) {
  const [view, setView] = useState<OrderServicesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.orderServices(orderId));
    } catch {
      setView(null);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!view) return null;
  const { insurance, commission } = view;
  const buyer = view.side === 'buyer';
  const showCover = insurance.current || (buyer && insurance.open && insurance.plans.length > 0);
  const showCommission = commission.job || (buyer && commission.artists.length > 0);
  if (!showCover && !showCommission) return null;

  const refresh = async () => { await load(); await onChanged(); };

  return (
    <section className="os" aria-label="Services for this item">
      <div className="os__head">
        <span className="os__eyebrow"><Icon name="spark" size={13} /> Services</span>
        <h2>{buyer ? 'Make this one yours' : 'Services on this order'}</h2>
      </div>
      {error && <ErrorNotice message={error} />}
      <div className="os__grid">
        {showCover && <CoverCard orderId={orderId} view={view} onChanged={refresh} onError={setError} />}
        {showCommission && <CommissionCard orderId={orderId} view={view} onChanged={refresh} onError={setError} />}
      </div>
    </section>
  );
}

/* ── Transit cover ───────────────────────────────────────────────────── */

function CoverCard({ orderId, view, onChanged, onError }: {
  orderId: string; view: OrderServicesView; onChanged: () => Promise<void>; onError: (message: string | null) => void;
}) {
  const { insurance } = view;
  const current = insurance.current;
  const [picked, setPicked] = useState<string | null>(current?.planId ?? insurance.plans[0]?.id ?? null);
  const [busy, setBusy] = useState(false);
  const buyer = view.side === 'buyer';

  async function set(planId: string | null) {
    setBusy(true);
    onError(null);
    try {
      await api.setInsurance(orderId, planId);
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`os-card os-card--cover${current ? ' is-on' : ''}`}>
      <div className="os-card__top">
        <span className="os-card__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3 4.5 6v5.6c0 4.6 3.2 8.2 7.5 9.4 4.3-1.2 7.5-4.8 7.5-9.4V6Z" />
          </svg>
        </span>
        <span>
          <span className="os-card__title">{current ? 'Insured in transit' : 'Protect it in transit'}</span>
          <span className="faint">
            {insurance.provider
              ? <>by <Link to={`/services/forwarder/${insurance.provider.slug}`}>{insurance.provider.name}</Link>, who is flying this lot</>
              : current ? `by ${current.providerName}` : ''}
          </span>
        </span>
      </div>

      {current && (
        <div className="os-cover">
          <span><b>{current.planName}</b></span>
          <span className="os-cover__figs">
            <span>Pays out up to <b>{formatMoney(current.coverMinor)}</b></span>
            <span>Premium <b>{formatMoney(current.premiumMinor)}</b> — on your order total</span>
          </span>
          {current.terms && <p className="faint">{current.terms}</p>}
        </div>
      )}

      {buyer && insurance.open && insurance.plans.length > 0 && (
        <>
          {!current && (
            <p className="os-card__lede">
              If it is lost or damaged between the warehouse and India, the forwarder pays out. The premium is added to
              this order and paid the same way — held by Buyer Protection or direct.
            </p>
          )}
          <div className="os-plans">
            {insurance.plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} premiumMinor={plan.premiumMinor} coverMinor={plan.coverMinor}
                selected={picked === plan.id} onSelect={() => setPicked(plan.id)} />
            ))}
          </div>
          <div className="os-card__acts">
            {current?.planId !== picked && picked && (
              <button type="button" className="btn" disabled={busy} onClick={() => void set(picked)}>
                {current ? 'Switch plan' : 'Add cover'} · {formatMoney(insurance.plans.find((plan) => plan.id === picked)?.premiumMinor ?? 0)}
              </button>
            )}
            {current && (
              <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void set(null)}>Remove cover</button>
            )}
          </div>
          <span className="faint">Cover can be changed until the item leaves the origin warehouse.</span>
        </>
      )}
    </article>
  );
}

/* ── Commission ──────────────────────────────────────────────────────── */

function CommissionCard({ orderId, view, onChanged, onError }: {
  orderId: string; view: OrderServicesView; onChanged: () => Promise<void>; onError: (message: string | null) => void;
}) {
  const { commission } = view;
  const job = commission.job;
  const buyer = view.side === 'buyer';
  const [opening, setOpening] = useState(false);

  // A running or finished commission is followed to the end; one that was
  // declined or called off makes way for asking someone else.
  if (job && (jobIsLive(job) || job.status === 'completed') && !opening) {
    return <JobTracker orderId={orderId} view={view} onChanged={onChanged} onError={onError} onAgain={job.status === 'completed' && buyer ? () => setOpening(true) : undefined} />;
  }
  if (!buyer || commission.artists.length === 0) return null;
  return (
    <article className="os-card os-card--art">
      <div className="os-card__top">
        <span className="os-card__icon os-card__icon--art" aria-hidden="true"><Icon name="spark" size={20} /></span>
        <span>
          <span className="os-card__title">Customise it with an artist</span>
          <span className="faint">Repaint, custom head, a diorama base, a repair — by a studio Figmark approved.</span>
        </span>
      </div>
      {job && <p className="faint">Your last commission was {ARTIST_JOB_LABELS[job.status].label.toLowerCase()}.</p>}
      {opening
        ? <CommissionForm orderId={orderId} artists={commission.artists} onSent={async () => { setOpening(false); await onChanged(); }} onError={onError} onCancel={() => setOpening(false)} />
        : (
          <>
            <div className="os-artists">
              {commission.artists.slice(0, 3).map((artist) => (
                <span key={artist.ownerId} className="os-artist-chip" style={accentStyle(artist.accent)}>
                  <StoreMark name={artist.name} logoUrl={artist.logoUrl} accent={artist.accent} size={26} /> {artist.name}
                </span>
              ))}
            </div>
            <button type="button" className="btn btn--ghost" onClick={() => setOpening(true)}>Choose an artist <Icon name="right" size={14} /></button>
          </>
        )}
    </article>
  );
}

function CommissionForm({ orderId, artists, onSent, onError, onCancel }: {
  orderId: string; artists: PublicStore[]; onSent: () => Promise<void>; onError: (message: string | null) => void; onCancel: () => void;
}) {
  const [artistId, setArtistId] = useState<string | null>(artists[0]?.ownerId ?? null);
  const [offeringId, setOfferingId] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const artist = artists.find((row) => row.ownerId === artistId) ?? null;

  async function send() {
    if (!artistId) return;
    setBusy(true);
    onError(null);
    try {
      await api.commission(orderId, { artistId, offeringId, brief, refUrls: ref ? [ref] : [] });
      await onSent();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack os-form">
      <div className="os-pickrow" role="radiogroup" aria-label="Artist">
        {artists.map((row) => (
          <button key={row.ownerId} type="button" role="radio" aria-checked={row.ownerId === artistId}
            className={`os-pick${row.ownerId === artistId ? ' is-on' : ''}`} style={accentStyle(row.accent)}
            onClick={() => { setArtistId(row.ownerId); setOfferingId(null); }}>
            <StoreMark name={row.name} logoUrl={row.logoUrl} accent={row.accent} size={40} />
            <span className="os-pick__name">{row.name}</span>
            <span className="faint">{row.city}{row.tagline ? ` · ${row.tagline}` : ''}</span>
          </button>
        ))}
      </div>
      {artist && (
        <>
          {artist.portfolio.length > 0 && (
            <div className="os-strip">
              {artist.portfolio.slice(0, 5).map((piece) => <Picture key={piece.id} url={piece.url} label={piece.caption} className="sk-pic os-strip__pic" />)}
              <Link to={`/services/artist/${artist.slug}`} className="os-strip__more">See the studio <Icon name="right" size={13} /></Link>
            </div>
          )}
          <div className="os-offers">
            {artist.offerings.map((offering) => (
              <OfferingCard key={offering.id} offering={offering} picked={offeringId === offering.id}
                onPick={() => setOfferingId(offeringId === offering.id ? null : offering.id)} />
            ))}
          </div>
        </>
      )}
      <label className="field">
        <span>What you want</span>
        <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)}
          placeholder="Battle-damaged repaint in matte, like the reference — keep the base as it is." />
      </label>
      <label className="field">
        <span>Reference picture (link, optional)</span>
        <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="https://…" />
      </label>
      <div className="row">
        <button type="button" className="btn" disabled={busy || !artistId || brief.trim().length < 10} onClick={() => void send()}>
          {busy ? 'Sending…' : 'Ask for a quote'}
        </button>
        <button type="button" className="btn btn--quiet" onClick={onCancel}>Cancel</button>
      </div>
      <span className="faint">Free to ask. You pay only if you accept their quote.</span>
    </div>
  );
}

function JobTracker({ orderId, view, onChanged, onError, onAgain }: {
  orderId: string; view: OrderServicesView; onChanged: () => Promise<void>; onError: (message: string | null) => void; onAgain?: () => void;
}) {
  const { commission } = view;
  const job = commission.job!;
  const buyer = view.side === 'buyer';
  const [method, setMethod] = useState<'protected' | 'direct'>(commission.artistPayment ? 'direct' : 'protected');
  const [escrowId, setEscrowId] = useState<string | null>(commission.escrows[0]?.id ?? null);
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const label = ARTIST_JOB_LABELS[job.status];
  const at = ARTIST_JOB_FLOW.indexOf(job.status);
  const escrow = commission.escrows.find((row) => row.id === escrowId) ?? null;
  const fee = escrow && job.quoteMinor ? protectionFeeMinor(job.quoteMinor, escrow.feeBasisPoints) : 0;
  const claimed = job.payments.some((payment) => !payment.confirmedAt);

  async function act(action: ArtistJobAction) {
    setBusy(true);
    onError(null);
    try {
      await api.commissionAct(orderId, {
        action,
        method: action === 'pay' ? method : undefined,
        escrowAgentId: action === 'pay' && method === 'protected' ? escrowId ?? undefined : undefined,
        reference: action === 'pay' && method === 'direct' ? reference : undefined,
      });
      await onChanged();
    } catch (err) {
      onError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="os-card os-card--art is-on">
      <div className="os-card__top">
        {commission.artist
          ? <StoreMark name={commission.artist.name} logoUrl={commission.artist.logoUrl} accent={commission.artist.accent} size={42} />
          : <span className="os-card__icon os-card__icon--art"><Icon name="spark" size={20} /></span>}
        <span>
          <span className="os-card__title">{job.offeringName}</span>
          <span className="faint">
            by {commission.artist ? <Link to={`/services/artist/${commission.artist.slug}`}>{job.artistName}</Link> : job.artistName}
          </span>
        </span>
        <span className={`badge badge--${label.tone === 'quiet' ? 'quiet' : label.tone} os-card__badge`}>{label.label}</span>
      </div>

      <ol className="os-flow" aria-label="Commission progress">
        {ARTIST_JOB_FLOW.slice(1).map((step, index) => (
          <li key={step} className={index + 1 <= at ? 'is-on' : ''} title={ARTIST_JOB_LABELS[step].label} />
        ))}
      </ol>

      <blockquote className="os-brief">{job.brief}</blockquote>

      {job.quoteMinor !== null && (
        <div className="os-quote">
          <span className="os-quote__price">{formatMoney(job.quoteMinor)}</span>
          <span className="faint">{job.turnaroundDays ? `about ${job.turnaroundDays} days` : ''}</span>
          {job.quoteNote && <p>“{job.quoteNote}”</p>}
        </div>
      )}

      {job.photos.length > 0 && (
        <div className="os-strip">{job.photos.map((url) => <Picture key={url} url={url} label="Finished piece" className="sk-pic os-strip__pic" />)}</div>
      )}
      {job.shipment && (
        <p className="os-ship"><Icon name="truck" size={14} /> {[job.shipment.courier, job.shipment.awb && `AWB ${job.shipment.awb}`].filter(Boolean).join(' · ')}</p>
      )}

      {/* The shop's one job here: once it is paid for, the piece goes to the studio. */}
      {!buyer && commission.studioAddress && ['paid', 'working'].includes(job.status) && (
        <div className="os-studio">
          <b>Send this item to the artist, not the buyer</b>
          <span>{commission.studioAddress}</span>
        </div>
      )}

      {buyer && commission.actions.includes('pay') && job.quoteMinor !== null && (
        <div className="os-pay">
          <div className="seg" role="radiogroup" aria-label="How to pay">
            <button type="button" role="radio" aria-checked={method === 'protected'} className={method === 'protected' ? 'is-on' : ''}
              onClick={() => setMethod('protected')} disabled={commission.escrows.length === 0}>🔒 With protection</button>
            <button type="button" role="radio" aria-checked={method === 'direct'} className={method === 'direct' ? 'is-on' : ''}
              onClick={() => setMethod('direct')} disabled={!commission.artistPayment}>↗ Direct to the artist</button>
          </div>
          {method === 'protected' ? (
            <>
              <p className="faint">Buyer Protection holds the money until you mark the finished piece received.</p>
              <div className="os-escrows">
                {commission.escrows.map((row) => (
                  <button key={row.id} type="button" className={`os-escrow${row.id === escrowId ? ' is-on' : ''}`} onClick={() => setEscrowId(row.id)}>
                    <b>{row.name}</b><span className="faint">{(row.feeBasisPoints / 100).toFixed(1)}% fee</span>
                  </button>
                ))}
              </div>
              <div className="os-total"><span>Total</span><b>{formatMoney(job.quoteMinor + fee)}</b></div>
            </>
          ) : commission.artistPayment && (
            <>
              <div className="os-payto">
                {commission.artistPayment.upiId && <span>UPI <b className="mono">{commission.artistPayment.upiId}</b></span>}
                {commission.artistPayment.accountName && <span>{commission.artistPayment.accountName}</span>}
                {commission.artistPayment.instructions && <span className="faint">{commission.artistPayment.instructions}</span>}
              </div>
              <label className="field"><span>Payment reference</span>
                <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="UPI transaction ID" /></label>
              <div className="os-total"><span>Send</span><b>{formatMoney(job.quoteMinor)}</b></div>
            </>
          )}
          <button type="button" className="btn btn--block" disabled={busy || (method === 'protected' && !escrowId)} onClick={() => void act('pay')}>
            {method === 'protected' ? `Pay ${formatMoney(job.quoteMinor + fee)}` : 'I have sent it'}
          </button>
        </div>
      )}
      {buyer && claimed && job.status === 'accepted' && (
        <p className="notice notice--info">You said you sent {formatMoney(jobDueMinor(job))}. Waiting for the artist to confirm it arrived.</p>
      )}
      {job.method === 'protected' && job.heldMinor > 0 && !job.releasedAt && (
        <p className="notice notice--info">🔒 {job.escrowName} is holding {formatMoney(job.heldMinor)} until you mark it received.</p>
      )}

      {buyer && (
        <div className="os-card__acts">
          {commission.actions.includes('accept') && <button type="button" className="btn" disabled={busy} onClick={() => void act('accept')}>Accept the quote</button>}
          {commission.actions.includes('complete') && <button type="button" className="btn" disabled={busy} onClick={() => void act('complete')}><Icon name="check" size={14} /> I have it — all done</button>}
          {commission.actions.includes('cancel') && !claimed && <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => void act('cancel')}>Cancel the commission</button>}
          {onAgain && <button type="button" className="btn btn--ghost" onClick={onAgain}>Commission something else</button>}
        </div>
      )}

      <details className="os-log">
        <summary>History</summary>
        <ol>
          {[...job.history].reverse().map((event, index) => (
            <li key={`${event.at}-${index}`}><span>{event.note}</span><span className="faint">{timeAgo(event.at)}</span></li>
          ))}
        </ol>
      </details>
    </article>
  );
}
