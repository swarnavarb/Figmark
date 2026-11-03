import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEE_KIND_LABELS, type FeeKind } from '@shared/billing';
import { ApiRequestError, api, type FeesView, type ProView } from '../api';
import { useSession } from '../session';
import { formatMoney } from '../format';
import { ErrorNotice, PageError, useConfirm } from '../components/ui';
import { PageLoading } from '../components/Feedback';
import { FeeHint, FeeLockBanner, ProBadge, forgetProStatus } from '../components/Billing';
import '../styles/BillingPages.css';

/**
 * Pro (`/pro`, from the profile menu) and the platform-fee statement
 * (`/fees`): one chunk, opened by sellers, never by somebody browsing.
 */

const date = (at: string | null | undefined) =>
  at ? new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
const monthName = (month: string) => {
  const [year, mon] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, mon - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const message = (err: unknown, fallback: string) => (err instanceof ApiRequestError ? err.message : fallback);

/* ── Pro ─────────────────────────────────────────────────────────────────── */

export function ProPage() {
  const { refresh } = useSession();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<ProView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    api.myPro().then(setView).catch((err) => setError(message(err, 'Could not load Pro.')));
  }, []);

  const apply = useCallback(async (key: string, work: () => Promise<ProView>, success: string) => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      setView(await work());
      forgetProStatus();
      await refresh();
      setDone(success);
    } catch (err) {
      setError(message(err, 'That did not go through.'));
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  if (!view && error) return <PageError message={error} />;
  if (!view) return <PageLoading />;

  const best = Math.max(...view.plans.map((plan) => plan.months));
  const perMonth = (plan: ProView['plans'][number]) => Math.round(plan.totalMinor / plan.months);
  const cheapest = Math.min(...view.plans.map(perMonth));
  const dearest = Math.max(...view.plans.map(perMonth));

  return (
    <div className="stack billpage">
      {dialog}
      <section className={`prohero${view.active ? ' is-on' : ''}`}>
        <div className="prohero__badge"><ProBadge size="md" /></div>
        <h1 className="prohero__title">Figmark Pro</h1>
        {view.active ? (
          <p className="prohero__line">
            You&apos;re Pro until <b>{date(view.until)}</b> · {view.daysLeft} days left.
            {view.discountBp > 0 && <> Your platform fee is <b>{view.discountBp / 100}% lower</b> until {date(view.discountUntil)}.</>}
          </p>
        ) : (
          <p className="prohero__line">Every Pro tool for your shop, a lower platform fee to start, free bump points, and the PRO badge beside your name.</p>
        )}
        {!view.enabled && <p className="notice notice--info">Pro tools are open to every shop right now - there is nothing to buy.</p>}
      </section>

      {error && <ErrorNotice message={error} />}
      {done && <p className="notice notice--ok" role="status">{done}</p>}

      <section className="card card--pad stack">
        <h2>What you get</h2>
        <ul className="profeats">
          {view.features.filter((feature) => feature.pro).map((feature) => (
            <li key={feature.id} className="profeat">
              <span className="profeat__icon" aria-hidden="true">{feature.icon}</span>
              <span><b>{feature.title}</b><small>{feature.line}</small></span>
            </li>
          ))}
          {view.feeDiscount.bp > 0 && (
            <li className="profeat">
              <span className="profeat__icon" aria-hidden="true">💸</span>
              <span>
                <b>{view.feeDiscount.bp / 100}% off the platform fee</b>
                <small>{view.feeDiscount.days > 0 ? `For ${view.feeDiscount.days} days after each purchase.` : 'For as long as you are Pro.'} On every sale, artist job and kg forwarded.</small>
              </span>
            </li>
          )}
          <li className="profeat">
            <span className="profeat__icon" aria-hidden="true">🚀</span>
            <span><b>Free bump points</b><small>Lift your items to the top of Discover. You have {view.bumpPoints} now.</small></span>
          </li>
          <li className="profeat">
            <span className="profeat__icon" aria-hidden="true">🏁</span>
            <span><b>The PRO badge <ProBadge /></b><small>Beside your shop&apos;s name, on every item, in Social and in search.</small></span>
          </li>
        </ul>
      </section>

      {view.enabled && (
        <section className="stack">
          <h2>{view.active ? 'Add more time' : 'Subscribe to Pro'}</h2>
          <div className="proplans">
            {view.plans.map((plan) => {
              const saving = dearest > 0 && perMonth(plan) < dearest ? Math.round((1 - perMonth(plan) / dearest) * 100) : 0;
              return (
                <article key={plan.months} className={`proplan${plan.months === best ? ' is-best' : ''}`}>
                  {plan.months === best && perMonth(plan) === cheapest && <span className="proplan__flag">Best value</span>}
                  <h3 className="proplan__months">{plan.months} months</h3>
                  <p className="proplan__price">{formatMoney(plan.totalMinor)}</p>
                  <p className="proplan__per">{formatMoney(perMonth(plan))} a month{saving > 0 && <> · <b>save {saving}%</b></>}</p>
                  {view.gst && plan.gstMinor > 0 && (
                    <p className="faint proplan__tax">
                      {view.gst.mode === 'inclusive' ? 'Includes' : 'Plus'} {view.gst.rateBp / 100}% GST ({formatMoney(plan.gstMinor)})
                    </p>
                  )}
                  {plan.bumpPoints > 0 && <p className="proplan__bumps">🚀 {plan.bumpPoints} bump points</p>}
                  <button type="button" className="btn proplan__buy" disabled={busy !== null}
                    onClick={() => void (async () => {
                      const yes = await confirm({
                        title: `Pro for ${plan.months} months`,
                        body: `${formatMoney(plan.totalMinor)} through the payment gateway.${view.active ? ' Added onto the time you have left.' : ''}`,
                        action: `Pay ${formatMoney(plan.totalMinor)}`,
                      });
                      if (yes) await apply(`buy${plan.months}`, () => api.buyPro(plan.months), `Welcome to Pro - ${plan.months} months added.`);
                    })()}>
                    {busy === `buy${plan.months}` ? 'Paying…' : view.active ? 'Add these months' : 'Subscribe'}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {view.enabled && (
        <section className="card card--pad stack">
          <h2>Have a code?</h2>
          <form className="provoucher" onSubmit={(event) => {
            event.preventDefault();
            if (!code.trim()) return;
            void apply('code', () => api.redeemPro(code), 'Code applied - Pro is on.').then(() => setCode(''));
          }}>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="PRO-XXXXXXXX" aria-label="Voucher code" autoCapitalize="characters" spellCheck={false} />
            <button className="btn btn--quiet" disabled={busy !== null || !code.trim()}>{busy === 'code' ? 'Checking…' : 'Unlock Pro'}</button>
          </form>
          {view.trialDays > 0 && !view.trialUsed && view.history.length === 0 && (
            <button type="button" className="btn btn--ghost" style={{ justifySelf: 'start' }} disabled={busy !== null}
              onClick={() => void apply('trial', api.startProTrial, `Your ${view.trialDays} free days have started.`)}>
              Try Pro free for {view.trialDays} days
            </button>
          )}
        </section>
      )}

      {view.history.length > 0 && (
        <section className="card card--pad stack">
          <h2>Your Pro</h2>
          <ul className="billrows">
            {view.history.map((grant) => (
              <li key={grant.id} className="billrow">
                <span>
                  <b>{grant.source === 'purchase' ? `${grant.months} months` : grant.source === 'voucher' ? `Code ${grant.code}` : grant.source === 'trial' ? 'Free trial' : 'From Figmark'}</b>
                  <small>{date(grant.at)} · {grant.days} days{grant.bumpPoints ? ` · ${grant.bumpPoints} bump points` : ''}{grant.gatewayRef ? ` · ${grant.gatewayRef}` : ''}</small>
                </span>
                {grant.amountMinor ? <b>{formatMoney(grant.amountMinor)}</b> : <span className="badge">Free</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="faint">
        Platform fees for your sales are on <Link to="/fees">Platform fees</Link>.
        {view.gst?.gstin && <> Figmark GSTIN {view.gst.gstin}.</>}
      </p>
    </div>
  );
}

/* ── Platform fees ───────────────────────────────────────────────────────── */

export function FeesPage() {
  const { refresh, user } = useSession();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<FeesView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  useEffect(() => {
    api.myFees().then(setView).catch((err) => setError(message(err, 'Could not load your fees.')));
  }, []);

  if (!view && error) return <PageError message={error} />;
  if (!view) return <PageLoading />;
  const s = view.statement;
  const kinds: FeeKind[] = [
    ...(user?.sellerProfile ? ['shop' as const] : []),
    ...(user?.forwarderProfile ? ['forwarder' as const] : []),
    'artist' as const,
  ];

  async function pay() {
    if (!view) return;
    const yes = await confirm({
      title: 'Pay platform fees',
      body: `${formatMoney(view.statement.owedMinor)} through the payment gateway, oldest month first.`,
      action: `Pay ${formatMoney(view.statement.owedMinor)}`,
    });
    if (!yes) return;
    setBusy(true);
    setError(null);
    try {
      const paid = await api.payFees();
      setView({ ...view, statement: paid.statement, locked: paid.locked });
      await refresh();
      setDone(`Paid - reference ${paid.settlement.gatewayRef}.${paid.locked ? '' : ' Your shop is open.'}`);
    } catch (err) {
      setError(message(err, 'The payment did not go through.'));
    } finally {
      setBusy(false);
    }
  }

  const lines = all ? s.lines : s.lines.slice(0, 12);
  return (
    <div className="stack billpage">
      {dialog}
      <header className="stack" style={{ gap: 4 }}>
        <h1>Platform fees</h1>
        <p className="muted" style={{ margin: 0 }}>
          Figmark takes a fee on each sale. Paid through the gateway, it comes out of the payment on its own. Paid to you
          directly, it is added up each month and due by day {s.graceDays + 1} of the next - past that, your listings and
          services are hidden until it is paid.
        </p>
      </header>

      {view.locked && <FeeLockBanner owner={{ feeLock: { overdueMinor: s.overdueMinor } }} />}
      {error && <ErrorNotice message={error} />}
      {done && <p className="notice notice--ok" role="status">{done}</p>}

      <section className="feetiles">
        <div className={`feetile${s.overdueMinor > 0 ? ' is-bad' : ''}`}><small>Overdue</small><b>{formatMoney(s.overdueMinor)}</b></div>
        <div className="feetile"><small>To pay</small><b>{formatMoney(s.owedMinor)}</b></div>
        <div className="feetile"><small>Next due</small><b>{s.nextDueAt ? date(s.nextDueAt) : '—'}</b></div>
        <div className="feetile">
          <small>Your rate</small>
          <b>{view.discountBp > 0 ? `${view.discountBp / 100}% off` : 'Standard'}</b>
        </div>
      </section>

      {s.owedMinor > 0 && (
        <button type="button" className="btn feepay" disabled={busy} onClick={() => void pay()}>
          {busy ? 'Paying…' : `Pay ${formatMoney(s.owedMinor)} now`}
        </button>
      )}

      <section className="card card--pad stack">
        <h2>Your rates</h2>
        {kinds.map((kind) => (
          <div key={kind} className="feerate">
            <span className="feerate__kind">{FEE_KIND_LABELS[kind]}</span>
            <FeeHint kind={kind} perKg={kind === 'forwarder'} />
          </div>
        ))}
        {!view.pro && <p className="faint" style={{ margin: 0 }}>Pro lowers the fee for a while after you subscribe. <Link to="/pro">See Pro</Link></p>}
      </section>

      {s.months.length > 0 && (
        <section className="card card--pad stack">
          <h2>By month</h2>
          <ul className="billrows">
            {s.months.map((month) => (
              <li key={month.month} className="billrow">
                <span>
                  <b>{monthName(month.month)}</b>
                  <small>
                    {month.sales} sale{month.sales === 1 ? '' : 's'}
                    {month.gatewayMinor > 0 && ` · ${formatMoney(month.gatewayMinor)} taken through the gateway`}
                    {month.gstMinor > 0 && ` · GST ${formatMoney(month.gstMinor)}`}
                    {month.directMinor > 0 && ` · due ${date(month.dueAt)}`}
                  </small>
                </span>
                <b>{formatMoney(month.directMinor)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card card--pad stack">
        <h2>Each sale</h2>
        {s.lines.length === 0 ? <p className="muted">No fees yet. They start with your first sale.</p> : (
          <ul className="billrows">
            {lines.map((line) => (
              <li key={line.id} className="billrow">
                <span>
                  <Link to={line.link}><b>{line.label}</b></Link>
                  <small>
                    {date(line.at)} · {line.kg ? `${line.kg} kg` : formatMoney(line.basisMinor)}
                    {line.gstMinor > 0 && ` · incl. GST ${formatMoney(line.gstMinor)}`}
                  </small>
                </span>
                <span className="billrow__end">
                  <b>{formatMoney(line.totalMinor)}</b>
                  <span className={`badge${line.via === 'gateway' ? ' badge--ok' : ''}`}>{line.via === 'gateway' ? 'Taken by gateway' : 'Direct'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {s.lines.length > 12 && !all && <button type="button" className="btn btn--quiet" onClick={() => setAll(true)}>Show all {s.lines.length}</button>}
      </section>

      {s.settlements.length > 0 && (
        <section className="card card--pad stack">
          <h2>Payments</h2>
          <ul className="billrows">
            {s.settlements.map((entry) => (
              <li key={entry.id} className="billrow">
                <span>
                  <b>{entry.waived ? 'Written off by Figmark' : 'Paid through the gateway'}</b>
                  <small>{date(entry.at)}{entry.gatewayRef ? ` · ${entry.gatewayRef}` : ''}{entry.note ? ` · ${entry.note}` : ''}</small>
                </span>
                <b>{formatMoney(entry.amountMinor)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
