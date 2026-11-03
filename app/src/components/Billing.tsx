import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  PRO_FEATURES, bandFor, bandWords, gstSplit, isProActive, platformFee,
  type FeeKind, type Pricing, type ProFeatureId,
} from '@shared/billing';
import { api, type ProStatus } from '../api';
import { useSession } from '../session';
import { formatMoney } from '../format';
import { InfoTip } from './InfoTip';
import { Modal } from './ui';

/**
 * Figmark's money, wherever it shows on a screen: the Pro badge beside a
 * store's name, the lock over a Pro tool, the corner chip for store credit,
 * the platform fee under a price, and the banner on a shop that owes fees.
 *
 * Small on purpose - it is in the main bundle. The subscribe page and the
 * fees statement are chunks of their own (pages/BillingPages.tsx).
 */

/* ── Shared reads, once per page load ────────────────────────────────────── */

let pricingRead: Promise<Pricing> | null = null;
export function usePricing(): Pricing | null {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  useEffect(() => {
    let live = true;
    pricingRead ??= api.pricing().catch((err) => { pricingRead = null; throw err; });
    pricingRead.then((value) => live && setPricing(value)).catch(() => undefined);
    return () => { live = false; };
  }, []);
  return pricing;
}

const statusReads = new Map<string, Promise<ProStatus>>();
/** Forget what was read about Pro, after buying it or redeeming a code. */
export function forgetProStatus(): void {
  statusReads.clear();
}

/**
 * Which store's Pro a screen is about: the shop being worked, whoever owns
 * it. Unset, it is the signed-in person's own.
 */
const ProOwner = createContext<string | null>(null);
export function ProOwnerProvider({ ownerId, children }: { ownerId: string | null | undefined; children: ReactNode }) {
  return <ProOwner.Provider value={ownerId ?? null}>{children}</ProOwner.Provider>;
}

/** Whether this tool is shut for the store in hand; null while it is being found out. */
export function useProLocked(feature: ProFeatureId, ownerId?: string | null): boolean | null {
  const { user } = useSession();
  const fromContext = useContext(ProOwner);
  const owner = ownerId ?? fromContext ?? user?.id ?? null;
  const [locked, setLocked] = useState<boolean | null>(null);
  useEffect(() => {
    if (!owner) {
      setLocked(null);
      return;
    }
    let live = true;
    let read = statusReads.get(owner);
    if (!read) {
      read = api.proStatus(owner);
      statusReads.set(owner, read);
      read.catch(() => statusReads.delete(owner));
    }
    // A store that cannot be read is left open: the server still refuses.
    read.then((status) => live && setLocked(status.locked[feature] ?? false)).catch(() => live && setLocked(false));
    return () => { live = false; };
  }, [owner, feature]);
  return locked;
}

/* ── The badge ───────────────────────────────────────────────────────────── */

/** PRO beside a store's name: slanted, striped, in motion. */
export function ProBadge({ size = 'sm', title = 'Pro store' }: { size?: 'sm' | 'md'; title?: string }) {
  return (
    <span className={`probadge-sport probadge-sport--${size}`} title={title} aria-label={title}>
      <span aria-hidden="true">PRO</span>
    </span>
  );
}

/* ── The lock ────────────────────────────────────────────────────────────── */

/**
 * A Pro tool, shut: only its name, an ⓘ saying what it does, and the way to
 * Pro. Open, it is the tool. While the answer is on its way, nothing - so a
 * Pro shop never sees the lock flash, nor anyone else the tool.
 */
export function ProGate({ feature, ownerId, inline = false, children }: {
  feature: ProFeatureId;
  ownerId?: string | null;
  /** A small lock in a row (a field, a chip) rather than a box in its own right. */
  inline?: boolean;
  children: ReactNode;
}) {
  const locked = useProLocked(feature, ownerId);
  if (locked === null) return null;
  if (!locked) return <>{children}</>;
  return <ProLock feature={feature} inline={inline} />;
}

export function ProLock({ feature, inline = false, title }: { feature: ProFeatureId; inline?: boolean; title?: string }) {
  const navigate = useNavigate();
  const meta = PRO_FEATURES.find((entry) => entry.id === feature)!;
  const name = title ?? meta.title;
  if (inline) {
    return (
      <span className="prolock prolock--inline">
        <span className="prolock__name">🔒 {name}</span>
        <InfoTip label={`What ${name} is`}>{meta.line}</InfoTip>
        <button type="button" className="prolock__go" onClick={() => navigate('/pro')}>Subscribe to Pro</button>
      </span>
    );
  }
  return (
    <section className="prolock" aria-label={`${name} - part of Pro`}>
      <div className="prolock__head">
        <span className="prolock__icon" aria-hidden="true">{meta.icon}</span>
        <h3 className="prolock__name">{name}</h3>
        <InfoTip label={`What ${name} is`}>{meta.line}</InfoTip>
        <ProBadge />
      </div>
      <button type="button" className="btn prolock__cta" onClick={() => navigate('/pro')}>
        🔒 Subscribe to Pro
      </button>
    </section>
  );
}

/* ── Store credit, in the corner ─────────────────────────────────────────── */

let creditRead: Promise<{ storeId: string; storeName: string; leftMinor: number }[]> | null = null;
let creditFor: string | null = null;

/**
 * "₹250 credit here" in a corner of a store's pages, for a buyer who has
 * credit with that store - it comes off their next order there on its own.
 * One small read per visit, whichever store pages they open.
 */
export function CreditChip({ storeId, inline = false }: { storeId: string | null | undefined; inline?: boolean }) {
  const { user } = useSession();
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!user || !storeId) {
      setLeft(0);
      return;
    }
    let live = true;
    if (!creditRead || creditFor !== user.id) {
      creditFor = user.id;
      creditRead = api.myStoreCredit().then((body) => body.credits).catch(() => []);
    }
    void creditRead.then((rows) => live && setLeft(rows.find((row) => row.storeId === storeId)?.leftMinor ?? 0));
    return () => { live = false; };
  }, [user, storeId]);
  if (left <= 0) return null;
  return (
    <Link to="/wallet" className={inline ? 'creditchip creditchip--inline' : 'creditchip'} title="Store credit here - it comes off your next order on its own">
      <span aria-hidden="true">🎟️</span> {formatMoney(left)} credit
    </Link>
  );
}

/** After a purchase spends credit, the corner reads again. */
export function forgetStoreCredit(): void {
  creditRead = null;
}

/* ── The platform fee, under a price ─────────────────────────────────────── */

/**
 * What Figmark takes from a sale at this price (or per kg), as the seller is
 * charged it: their band, with GST when it applies.
 */
export function FeeHint({ kind, priceMinor, perKg = false }: { kind: FeeKind; priceMinor?: number; perKg?: boolean }) {
  const pricing = usePricing();
  const { user } = useSession();
  if (!pricing) return null;
  const gst = pricing.gst.enabled && pricing.gst.applyTo.platform ? { rateBp: pricing.gst.rateBp, mode: pricing.gst.mode } : null;
  const gstNote = gst ? ` ${gst.mode === 'inclusive' ? 'incl.' : '+'} ${gst.rateBp / 100}% GST` : '';

  if (kind === 'forwarder' || perKg) {
    const perKgMinor = pricing.fees.forwarderPerKgMinor;
    const shown = gstSplit(gst, perKgMinor).totalMinor;
    return (
      <span className="feehint">
        Figmark fee: <b>{formatMoney(shown)} per chargeable kg</b>{gstNote}
      </span>
    );
  }
  const bands = pricing.fees[kind];
  if (!priceMinor || priceMinor <= 0) {
    return (
      <span className="feehint">
        Figmark fee: {bands.map((band, index) => (
          <span key={index}>
            {index > 0 && ' · '}
            {band.upToMinor === null ? (index === 0 ? '' : 'above that ') : `up to ${formatMoney(band.upToMinor)} `}
            <b>{bandWords(band, (minor) => formatMoney(minor))}</b>
          </span>
        ))}{gstNote}
      </span>
    );
  }
  const terms = { kind, feeBands: bands, discountBp: 0, gst, at: '' };
  const fee = platformFee(terms, { amountMinor: priceMinor });
  const band = bandFor(bands, priceMinor);
  return (
    <span className="feehint">
      Figmark fee on this sale: <b>{formatMoney(fee.totalMinor)}</b>
      {band && <> ({bandWords(band, (minor) => formatMoney(minor))}{gstNote})</>}
      {' '}· you keep <b>{formatMoney(Math.max(0, priceMinor - fee.totalMinor))}</b>
    </span>
  );
}

/* ── The lock on a shop that owes ────────────────────────────────────────── */

/** Over a shop or a store console while its owner owes fees past their due date. */
export function FeeLockBanner({ owner }: { owner?: { feeLock?: { overdueMinor: number } | null } | null }) {
  const { user } = useSession();
  const lock = owner ? owner.feeLock : user?.feeLock;
  if (!lock) return null;
  const mine = !owner || owner === user;
  return (
    <div className="feelock" role="alert">
      <span className="feelock__icon" aria-hidden="true">⏸️</span>
      <div className="feelock__text">
        <b>Paused: {formatMoney(lock.overdueMinor)} in platform fees is overdue.</b>
        <span>Nobody can see the listings or book the services until it is paid. Pay it and everything is back at once.</span>
      </div>
      {mine && <Link to="/fees" className="btn btn--sm">Pay now</Link>}
    </div>
  );
}

/** Whether this account is Pro right now, from the session: for its own badge. */
export function useIAmPro(): boolean {
  const { user } = useSession();
  return isProActive(user?.pro ?? null);
}

/* ── Flagged for cancelling too often ────────────────────────────────────── */

/**
 * Over the shop of a seller flagged for calling off too many orders: what
 * happened, what it means (direct buying paused), and the appeal button.
 */
export function CancelFlagBanner() {
  const { user } = useSession();
  const [flag, setFlag] = useState(user?.cancelFlag ?? null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setFlag(user?.cancelFlag ?? null); }, [user?.cancelFlag]);
  if (!flag || flag.status === 'cleared') return null;

  async function send() {
    setBusy(true);
    setProblem(null);
    try {
      setFlag((await api.appealCancels(text.trim())).flag);
      setOpen(false);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cancelflag" role="alert">
      {flag.cancelled > 0 && <span className="cancelflag__meter" aria-hidden="true"><b>{Math.round(flag.ratePct)}%</b><small>cancelled</small></span>}
      <div className="cancelflag__text">
        <b>{flag.directPaused ? 'Direct buying is paused on your shop' : 'Your shop is flagged for cancellations'}</b>
        <span>
          {flag.cancelled > 0 ? `You called off ${flag.cancelled} of your last ${flag.orders} orders.` : 'The Figmark team paused it.'}
          {flag.directPaused ? ' Buyers can still order and pay through Figmark with Buyer Protection.' : ''}
          {flag.status === 'appealed' ? ' Your appeal is with the Figmark team.' : ''}
          {flag.note ? ` Figmark: “${flag.note}”` : ''}
        </span>
      </div>
      {flag.status === 'appealed'
        ? <span className="badge">Appeal sent</span>
        : <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>Appeal to admin</button>}
      {open && (
        <Modal title="Appeal to the Figmark team" onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="muted" style={{ margin: 0 }}>
              Tell us why these orders were called off - stock lost in transit, a supplier let you down, buyers asked you to.
              The team reads every appeal and can switch direct buying back on.
            </p>
            <label className="field">
              <span>What happened</span>
              <textarea rows={4} value={text} maxLength={1000} onChange={(event) => setText(event.target.value)} />
            </label>
            {problem && <p className="notice notice--error">{problem}</p>}
            <button type="button" className="btn" disabled={busy || text.trim().length < 10} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send appeal'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
