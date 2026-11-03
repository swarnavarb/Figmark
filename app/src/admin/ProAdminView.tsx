import { useCallback, useEffect, useState } from 'react';
import type { ProVoucher } from '@shared/billing';
import { ApiRequestError, admin } from './api';
import { formatMoney, timeAgo } from '../format';
import { Loading } from '../components/Feedback';

const message = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

/**
 * Pro codes and Pro given by hand. A code gives days of Pro to each account
 * that redeems it, up to its uses; a batch makes single-use codes to hand out.
 * Prices and what Pro includes are under Pricing.
 */
export function ProAdminView() {
  const [vouchers, setVouchers] = useState<ProVoucher[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<ProVoucher[]>([]);
  const [form, setForm] = useState({ days: '30', count: '1', maxUses: '1', expiresAt: '', prefix: 'PRO', code: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState({ userId: '', days: '30' });
  const [granted, setGranted] = useState<string | null>(null);

  const load = useCallback(() => admin.vouchers().then((body) => setVouchers(body.vouchers))
    .catch((err) => setError(message(err, 'Could not load the codes.'))), []);
  useEffect(() => { void load(); }, [load]);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      const body = await admin.makeVouchers({
        days: Number(form.days), count: Number(form.count) || 1, maxUses: Number(form.maxUses) || 1,
        expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59+05:30`).toISOString() : null,
        prefix: form.prefix, code: form.code || undefined, note: form.note,
      });
      setMade(body.vouchers);
      await load();
    } catch (err) {
      setError(message(err, 'Could not make the codes.'));
    } finally {
      setBusy(false);
    }
  }

  async function give() {
    setBusy(true);
    setError(null);
    setGranted(null);
    try {
      const body = await admin.grantPro(grant.userId.trim(), Number(grant.days));
      setGranted(`Pro until ${body.pro.until ? new Date(body.pro.until).toLocaleDateString('en-IN') : '—'}.`);
    } catch (err) {
      setError(message(err, 'Could not give Pro.'));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });
  return (
    <div className="stack">
      {error && <p className="notice notice--error">{error}</p>}
      <div className="card card--pad stack">
        <h2>Make codes</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ maxWidth: 120 }}><span>Days of Pro</span><input type="number" value={form.days} onChange={set('days')} /></label>
          <label className="field" style={{ maxWidth: 120 }}><span>How many codes</span><input type="number" value={form.count} onChange={set('count')} /></label>
          <label className="field" style={{ maxWidth: 140 }}><span>Uses per code</span><input type="number" value={form.maxUses} onChange={set('maxUses')} /></label>
          <label className="field" style={{ maxWidth: 180 }}><span>Expires (optional)</span><input type="date" value={form.expiresAt} onChange={set('expiresAt')} /></label>
        </div>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <label className="field" style={{ maxWidth: 140 }}><span>Prefix</span><input value={form.prefix} onChange={set('prefix')} /></label>
          <label className="field" style={{ maxWidth: 200 }}>
            <span>Or one named code</span><input value={form.code} placeholder="LAUNCH30" onChange={set('code')} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 200 }}><span>Note</span><input value={form.note} placeholder="Diwali campaign" onChange={set('note')} /></label>
        </div>
        <button type="button" className="btn" style={{ justifySelf: 'start' }} disabled={busy || !(Number(form.days) > 0)} onClick={() => void make()}>
          {busy ? 'Making…' : 'Make codes'}
        </button>
        {made.length > 0 && (
          <div className="notice notice--ok">
            <b>New codes</b>
            <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap' }}>{made.map((voucher) => voucher.code).join('\n')}</pre>
          </div>
        )}
      </div>

      <div className="card card--pad stack">
        <h2>Give Pro to an account</h2>
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label className="field" style={{ minWidth: 260 }}><span>Account id</span>
            <input value={grant.userId} placeholder="From People and stores" onChange={(e) => setGrant({ ...grant, userId: e.target.value })} /></label>
          <label className="field" style={{ maxWidth: 140 }}><span>Days (negative takes away)</span>
            <input type="number" value={grant.days} onChange={(e) => setGrant({ ...grant, days: e.target.value })} /></label>
          <button type="button" className="btn btn--ghost" disabled={busy || !grant.userId.trim()} onClick={() => void give()}>Give</button>
        </div>
        {granted && <p className="notice notice--ok">{granted}</p>}
      </div>

      <div className="card">
        {!vouchers ? <Loading /> : vouchers.length === 0 ? <p className="muted card--pad">No codes yet.</p> : vouchers.map((voucher) => (
          <div key={voucher.code} className="userrow" style={{ cursor: 'default' }}>
            <div className="userrow__main">
              <span className="userrow__name"><code>{voucher.code}</code> · {voucher.days} days</span>
              <span className="userrow__meta">
                Used {voucher.redeemed.length} of {voucher.maxUses}
                {voucher.expiresAt ? ` · expires ${new Date(voucher.expiresAt).toLocaleDateString('en-IN')}` : ''}
                {voucher.note ? ` · ${voucher.note}` : ''} · made {timeAgo(voucher.createdAt)} by {voucher.createdBy}
                {voucher.redeemed.length > 0 && ` · by ${voucher.redeemed.slice(-3).map((entry) => entry.name).join(', ')}`}
              </span>
            </div>
            <div className="userrow__tags">
              {voucher.disabled && <span className="badge badge--danger">Off</span>}
              <button type="button" className="btn btn--quiet btn--sm" onClick={() => void admin.toggleVoucher(voucher.code).then(load)}>
                {voucher.disabled ? 'Switch on' : 'Switch off'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Every account with platform fees: what it owes, what is overdue, and whether it is locked. */
export function FeesAdminView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof admin.fees>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = useCallback(() => admin.fees().then(setData).catch((err) => setError(message(err, 'Could not load the fees.'))), []);
  useEffect(() => { void load(); }, [load]);

  async function act(userId: string, work: () => Promise<unknown>) {
    setBusy(userId);
    setError(null);
    try {
      await work();
      await load();
    } catch (err) {
      setError(message(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <Loading />;
  const owed = data?.accounts.reduce((sum, row) => sum + row.owedMinor, 0) ?? 0;
  const overdue = data?.accounts.reduce((sum, row) => sum + row.overdueMinor, 0) ?? 0;
  return (
    <div className="stack">
      {error && <p className="notice notice--error">{error}</p>}
      {data && (
        <>
          <div className="card card--pad">
            <div className="row" style={{ flexWrap: 'wrap', gap: 24 }}>
              <div><div className="faint">Owed on direct sales</div><b>{formatMoney(owed)}</b></div>
              <div><div className="faint">Overdue</div><b>{formatMoney(overdue)}</b></div>
              <div><div className="faint">Locked accounts</div><b>{data.accounts.filter((row) => row.locked).length}</b></div>
            </div>
            <p className="field__hint" style={{ margin: '8px 0 0' }}>Worked out when each seller last opened their fees or paid, and every night.</p>
          </div>
          <div className="card">
            {data.accounts.length === 0 ? <p className="muted card--pad">No platform fees yet.</p> : data.accounts.map((row) => (
              <div key={row.userId} className="userrow" style={{ cursor: 'default' }}>
                <div className="userrow__main">
                  <span className="userrow__name">{row.name} · owes {formatMoney(row.owedMinor)}</span>
                  <span className="userrow__meta">
                    {row.overdueMinor > 0 ? `${formatMoney(row.overdueMinor)} overdue · ` : ''}
                    {row.nextDueAt ? `next due ${new Date(row.nextDueAt).toLocaleDateString('en-IN')} · ` : ''}checked {timeAgo(row.checkedAt)}
                  </span>
                </div>
                <div className="userrow__tags">
                  {row.locked && <span className="badge badge--danger">Locked</span>}
                  <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                    onClick={() => void act(row.userId, () => admin.refreshFees(row.userId))}>Recheck</button>
                  {row.owedMinor > 0 && (
                    <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                      onClick={() => {
                        const note = window.prompt(`Write off ${formatMoney(row.owedMinor)} for ${row.name}? Say why:`);
                        if (note !== null) void act(row.userId, () => admin.waiveFees(row.userId, { note }));
                      }}>Write off</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Every seller with sales and how many of their orders they called off. Over
 * the limit, a seller is flagged (and, if the pricing says so, paid only
 * through the gateway) until an operator clears them. Appeals first.
 */
export function CancelsAdminView() {
  const [data, setData] = useState<Awaited<ReturnType<typeof admin.cancels>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<'flagged' | 'all'>('flagged');
  const load = useCallback(() => admin.cancels().then(setData).catch((err) => setError(message(err, 'Could not load cancellations.'))), []);
  useEffect(() => { void load(); }, [load]);

  async function decide(userId: string, decision: 'clear' | 'keep' | 'pause', ask: string) {
    const note = window.prompt(ask);
    if (note === null) return;
    setBusy(userId);
    setError(null);
    try {
      await admin.decideCancel(userId, decision, note.trim() || undefined);
      await load();
    } catch (err) {
      setError(message(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }

  if (!data && !error) return <Loading />;
  const rows = (data?.rows ?? []).filter((row) => filter === 'all' || row.over || (row.flag && row.flag.status !== 'cleared'));
  const open = (data?.rows ?? []).filter((row) => row.flag && row.flag.status !== 'cleared');
  return (
    <div className="stack">
      {error && <p className="notice notice--error">{error}</p>}
      {data && (
        <>
          <div className="card card--pad">
            <div className="row" style={{ flexWrap: 'wrap', gap: 24 }}>
              <div><div className="faint">Limit</div><b>{data.limit.maxPct}% over {data.limit.windowDays} days</b></div>
              <div><div className="faint">Flagged</div><b>{open.length}</b></div>
              <div><div className="faint">Appeals waiting</div><b>{open.filter((row) => row.flag?.status === 'appealed').length}</b></div>
              <div><div className="faint">Direct buying</div><b>{data.limit.pauseDirect ? 'Paused when flagged' : 'Left on'}</b></div>
            </div>
            <p className="field__hint" style={{ margin: '8px 0 0' }}>
              A seller is counted from {data.limit.minOrders} orders. The limit and the pause are set under Pricing.
            </p>
          </div>
          <div className="tabs">
            <button type="button" className={`tab${filter === 'flagged' ? ' is-on' : ''}`} onClick={() => setFilter('flagged')}>Flagged &amp; over the limit</button>
            <button type="button" className={`tab${filter === 'all' ? ' is-on' : ''}`} onClick={() => setFilter('all')}>Every seller</button>
          </div>
          <div className="card">
            {rows.length === 0 ? <p className="muted card--pad">Nobody is over the limit.</p> : rows.map((row) => {
              const flag = row.flag;
              const flagged = flag && flag.status !== 'cleared';
              return (
                <div key={row.userId} className="userrow" style={{ cursor: 'default', alignItems: 'flex-start' }}>
                  <div className="userrow__main">
                    <span className="userrow__name">
                      {row.name} · <span className={row.over ? 'cancelrate is-over' : 'cancelrate'}>{row.ratePct}%</span> cancelled
                    </span>
                    <span className="userrow__meta">
                      {row.cancelled} of {row.orders} orders in {data.limit.windowDays} days
                      {flag ? ` · flagged ${timeAgo(flag.at)}` : ''}
                      {flag?.decidedBy ? ` · last decided by ${flag.decidedBy}` : ''}
                    </span>
                    {flag?.appeal && flag.status === 'appealed' && (
                      <blockquote className="cancelappeal">“{flag.appeal.text}”<small> - {timeAgo(flag.appeal.at)}</small></blockquote>
                    )}
                  </div>
                  <div className="userrow__tags">
                    {flag?.status === 'appealed' && <span className="badge badge--warn">Appeal</span>}
                    {flagged && flag.directPaused && <span className="badge badge--danger">Direct paused</span>}
                    {flag?.status === 'cleared' && <span className="badge badge--ok">Cleared</span>}
                    {flagged && (
                      <button type="button" className="btn btn--sm" disabled={busy !== null}
                        onClick={() => void decide(row.userId, 'clear', `Clear ${row.name} and switch direct buying back on? A note for them (optional):`)}>
                        Clear
                      </button>
                    )}
                    {flag?.status === 'appealed' && (
                      <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                        onClick={() => void decide(row.userId, 'keep', `Turn down ${row.name}'s appeal? Tell them why:`)}>
                        Turn down
                      </button>
                    )}
                    {!flagged && (
                      <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null}
                        onClick={() => void decide(row.userId, 'pause', `Pause direct buying for ${row.name}? Tell them why:`)}>
                        Pause direct
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
