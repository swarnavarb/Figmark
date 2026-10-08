import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { BUYER_DISPUTE_REASONS, DISPUTE_REASON_LABELS, SELLER_DISPUTE_REASONS } from '@shared/enums';
import { REASON_MIN, type ReportTarget } from '@shared/moderation';
import { ApiRequestError, api, type DisputeTarget, type EvidenceDraft, type ManagerOption } from '../api';
import { formatMoney } from '../format';
import { useToast } from './Feedback';
import { Modal } from './LotFields';
import { shrink } from './PhotoManager';

/**
 * The two ways to object to something, and the pieces both share.
 *
 * "Report now" is free and goes straight to Figmark's operators. "Raise a
 * dispute" opens a case with a community manager: the person raising it says
 * what happened, attaches screenshots, picks a manager and pays the fee
 * through the gateway, and the case lands in My Disputes as a three-way
 * thread. A purchase still held under buyer protection is the exception: its
 * holder hears it, and the protection fee already paid for that.
 */

/** Screenshots, uploaded the moment they are picked so the dispute carries their address. */
export function ScreenshotPicker({ value, onChange, max = 6 }: {
  value: EvidenceDraft[];
  onChange: (next: EvidenceDraft[]) => void;
  max?: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    try {
      const added: EvidenceDraft[] = [];
      for (const file of [...files].slice(0, max - value.length)) {
        const { url } = await api.uploadPhoto(await shrink(file));
        added.push({ url, caption: '' });
      }
      onChange([...value, ...added]);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That screenshot did not upload.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shots">
      {value.length > 0 && (
        <div className="shots__grid">
          {value.map((item, index) => (
            <figure key={item.url} className="shots__item">
              <img src={item.url} alt={item.caption || `Screenshot ${index + 1}`} />
              <input value={item.caption} placeholder="What it shows" maxLength={200}
                onChange={(e) => onChange(value.map((entry, i) => (i === index ? { ...entry, caption: e.target.value } : entry)))} />
              <button type="button" className="btn btn--quiet btn--sm"
                onClick={() => onChange(value.filter((_, i) => i !== index))}>Remove</button>
            </figure>
          ))}
        </div>
      )}
      {value.length < max && (
        <label className={`proofpick__add${busy ? ' is-busy' : ''}`}>
          <input type="file" accept="image/*" multiple disabled={busy}
            onChange={(event) => void pick(event.target.files)} />
          <span>{busy ? 'Uploading…' : '📎 Attach screenshots'}</span>
        </label>
      )}
      {error && <span className="field__hint" style={{ color: 'var(--danger-text)' }}>{error}</span>}
    </div>
  );
}

/** Report now: free, to Figmark's operators. For your own words, a request to validate them instead. */
export function ReportModal({ targetType, targetId, parentId, kind, onClose, onSent }: {
  targetType: ReportTarget;
  targetId: string;
  parentId: string;
  kind: 'report' | 'validate';
  onClose: () => void;
  onSent?: () => void;
}) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      await api.report({ targetType, targetId, parentId, reason: reason.trim() });
      toast(kind === 'validate' ? 'Sent to Figmark for validation' : 'Reported to Figmark', 'ok');
      onSent?.();
      onClose();
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not send.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <Modal title={kind === 'validate' ? 'Ask Figmark to validate this' : 'Report this'} onClose={onClose}>
      <div className="stack">
        <p className="faint" style={{ margin: 0 }}>
          {kind === 'validate'
            ? 'An operator will check what you wrote against the trade or listing it is about. If it holds up, it shows a ✓ Validated mark.'
            : 'Free, and straight to Figmark: tell us what is wrong - untrue, abusive, spam, or not about a real trade - and an operator decides whether it stays up. To have a community manager hear both sides instead, raise a dispute.'}
        </p>
        <label className="field">
          <span>{kind === 'validate' ? 'What should we check?' : 'What is wrong with it?'}</span>
          <textarea rows={4} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
            placeholder={kind === 'validate' ? 'e.g. The item arrived damaged - photos are on the order.' : 'e.g. This person never bought from us.'} />
        </label>
        <button type="button" className="btn btn--block" disabled={busy || reason.trim().length < REASON_MIN}
          onClick={() => void send()}>
          {busy ? 'Sending…' : kind === 'validate' ? 'Send for validation' : 'Report now'}
        </button>
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * The popup behind every "Raise a dispute".
 *
 * One form for anything: what happened, screenshots, the manager to hear it,
 * and the fee. On a purchase still held under protection there is no picker
 * and nothing to pay - the holder hears it - but the reason is one of the
 * structured ones, because that decides what happens to the held money.
 */
export function RaiseDisputeModal({ target, onClose, protectedOrder, side, orderSubject }: {
  target: DisputeTarget;
  onClose: () => void;
  /** On an order: the particular rejected payment or refund being disputed. */
  orderSubject?: string;
  /** A purchase whose protection is still holding the payment. */
  protectedOrder?: boolean;
  /** For a purchase: which end of it the raiser is. */
  side?: 'buyer' | 'seller';
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [shots, setShots] = useState<EvidenceDraft[]>([]);
  const [managers, setManagers] = useState<ManagerOption[] | null>(null);
  const [fee, setFee] = useState<{ feeMinor: number; currency: string } | null>(null);
  const [managerId, setManagerId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const free = Boolean(protectedOrder);
  // Anything about a purchase still under protection is a protection claim:
  // free, heard by the manager holding the money, and it freezes the payment.
  // It picks a structured reason, because that decides where the money goes.
  const claim = free;

  useEffect(() => {
    if (free) return;
    api.communityManagers(target.againstId)
      .then((body) => {
        setManagers(body.managers);
        setFee({ feeMinor: body.feeMinor, currency: body.currency });
      })
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load the community managers.'));
  }, [free, target.againstId]);

  const reasons = side === 'seller' ? SELLER_DISPUTE_REASONS : BUYER_DISPUTE_REASONS;
  const ready = reason.trim().length >= REASON_MIN && (free ? (!claim || Boolean(reasonCode)) : Boolean(managerId));

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const evidence = shots.filter((shot) => shot.url);
      let id: string;
      if (target.type === 'order') {
        id = claim
          ? (await api.openDispute(target.id, { reasonCode, reason: reason.trim(), evidence })).dispute.id
          : (await api.flagDispute(target.id, { subject: orderSubject, reason: reason.trim(), managerId: free ? undefined : managerId, evidence })).dispute.id;
      } else {
        id = (await api.raiseCommunityDispute({
          subject: { type: target.type, id: target.id, parentId: target.parentId },
          reason: reason.trim(), managerId, evidence,
        })).dispute.id;
      }
      toast(free ? 'Dispute raised with the community manager holding your payment' : 'Paid and raised - it is in My Disputes', 'ok');
      onClose();
      navigate(`/dispute/${id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not raise that.');
    } finally {
      setBusy(false);
    }
  }

  return createPortal(
    <Modal title="Raise a dispute" onClose={onClose}>
      <div className="stack">
        <p className="raise__about"><span className="faint">About</span> {target.label}</p>

        {claim && (
          <label className="field">
            <span>What went wrong</span>
            <select value={reasonCode} onChange={(e) => setReasonCode(e.target.value)}>
              <option value="">Pick one…</option>
              {reasons.map((code) => <option key={code} value={code}>{DISPUTE_REASON_LABELS[code]}</option>)}
            </select>
          </label>
        )}

        <label className="field">
          <span>What happened</span>
          <textarea rows={4} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)}
            placeholder="Say it the way you would to someone deciding it: what, when, and what you want done." />
        </label>

        <div className="field">
          <span>Screenshots</span>
          <ScreenshotPicker value={shots} onChange={setShots} />
        </div>

        {free ? (
          <p className="notice notice--info" style={{ margin: 0 }}>
            This purchase is under buyer protection, so the community manager holding the payment hears it, and there
            is nothing to pay - the protection fee covered it. The payment stays held until the result is final.
          </p>
        ) : (
          <>
            <div className="field">
              <span>Community manager</span>
              {managers === null ? <p className="faint">Loading…</p> : managers.length === 0 ? (
                <p className="faint">No community manager is taking new disputes right now. Try again soon.</p>
              ) : (
                <div className="raise__managers" role="radiogroup" aria-label="Community manager">
                  {managers.map((manager) => (
                    <label key={manager.id} className={`raise__manager${managerId === manager.id ? ' is-on' : ''}`}>
                      <input type="radio" name="manager" value={manager.id} checked={managerId === manager.id}
                        onChange={() => setManagerId(manager.id)} />
                      <b>{manager.name}</b>
                      <span className="faint">{manager.openCases} open case{manager.openCases === 1 ? '' : 's'}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {fee && (
              <div className="raise__pay">
                <div className="kv"><dt>Dispute fee</dt><dd>{formatMoney(fee.feeMinor, fee.currency)}</dd></div>
                <p className="faint" style={{ margin: 0 }}>
                  Paid through the payment gateway, never to a person. It is not refunded, whatever the result. If you
                  are not happy with the decision you can escalate it twice, each time to another manager, for the
                  escalation fee.
                </p>
              </div>
            )}
          </>
        )}

        {error && <p className="notice notice--warn" style={{ margin: 0 }}>{error}</p>}
        <button type="button" className="btn btn--block" disabled={busy || !ready} onClick={() => void submit()}>
          {busy ? 'Raising…' : free ? 'Raise dispute' : fee ? `Pay ${formatMoney(fee.feeMinor, fee.currency)} and raise` : 'Raise dispute'}
        </button>
      </div>
    </Modal>,
    document.body,
  );
}

/**
 * The ⋯ on a review, comment or post: "Report now" and "Raise a dispute".
 * On your own words, the one thing you can ask for is validation.
 */
export function ContentMenu({ targetType, targetId, parentId, authorId, label, mine, reported, onReported }: {
  targetType: ReportTarget;
  targetId: string;
  parentId: string;
  authorId?: string;
  /** What the dispute popup says it is about. */
  label: string;
  mine: boolean;
  /** This viewer already has an open report on it. */
  reported?: boolean;
  onReported?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const [open, setOpen] = useState<'report' | 'validate' | 'dispute' | null>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLSpanElement>(null);

  // Fixed to the viewport, not the comment: the ⋮ often sits at a thread's
  // left edge, and a neighbouring comment would otherwise paint over it.
  function toggle() {
    if (!menu && button.current) {
      const rect = button.current.getBoundingClientRect();
      const width = 200;
      const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
      const below = window.innerHeight - rect.bottom > 120;
      setPlace(below ? { left, top: rect.bottom + 4 } : { left, bottom: window.innerHeight - rect.top + 4 });
    }
    setMenu(!menu);
  }

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event) => {
      if (event.type === 'scroll' || !(event.target instanceof Node)
        || !(list.current?.contains(event.target) || button.current?.contains(event.target))) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [menu]);

  return (
    <span className="cmenu">
      <button ref={button} type="button" className="iconbtn cmenu__btn" aria-label="More" aria-haspopup="menu" aria-expanded={menu}
        onClick={toggle}>
        ⋮
      </button>
      {menu && createPortal(
        <span ref={list} className="cmenu__list" role="menu" style={place}>
          {mine ? (
            <button type="button" role="menuitem" onClick={() => { setMenu(false); setOpen('validate'); }}>✅ Ask to validate</button>
          ) : (
            <>
              <button type="button" role="menuitem" disabled={reported}
                onClick={() => { setMenu(false); setOpen('report'); }}>
                ⚠️ {reported ? 'Reported · under review' : 'Report now'}
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setOpen('dispute'); }}>⚖️ Raise a dispute</button>
            </>
          )}
        </span>,
        document.body,
      )}
      {(open === 'report' || open === 'validate') && (
        <ReportModal targetType={targetType} targetId={targetId} parentId={parentId} kind={open}
          onClose={() => setOpen(null)} onSent={onReported} />
      )}
      {open === 'dispute' && (
        <RaiseDisputeModal onClose={() => setOpen(null)}
          target={{ type: targetType, id: targetId, parentId, againstId: authorId, label }} />
      )}
    </span>
  );
}
