import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FEE_KIND_LABELS, type FeeKind } from '@shared/billing';
import { ApiRequestError, api, type FeesView, type ProView } from '../api';
import { useSession } from '../session';
import { formatMoney } from '../format';
import { ErrorNotice, Modal, PageError, useConfirm } from '../components/ui';
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

interface Benefit { id: string; icon: string; punch: string; title: string; benefit: string; line?: string }

/**
 * A hand-drawn underline under a word: one rough stroke, drawn in as the
 * page opens. Decoration only - the words read the same without it.
 */
function Hand({ children, tone = 'pink', thin = false }: { children: ReactNode; tone?: 'pink' | 'gold' | 'lime'; thin?: boolean }) {
  return (
    <span className={`handul handul--${tone}${thin ? ' handul--thin' : ''}`}>
      {children}
      <svg className="handul__line" viewBox="0 0 200 14" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M3 9.5C34 4.2 61 3.4 92 5.6c27 1.9 52 4.6 79 2.8 9-.6 17-1.9 26-3.6" pathLength={1} />
        {!thin && <path className="handul__echo" d="M14 12.4c38-3.1 77-3.4 116-1.5 19 .9 38 1 57-.6" pathLength={1} />}
      </svg>
    </span>
  );
}

/** A rough ring drawn round the best price. */
function Ring({ children }: { children: ReactNode }) {
  return (
    <span className="handring">
      {children}
      <svg className="handring__line" viewBox="0 0 200 80" preserveAspectRatio="none" aria-hidden="true" focusable="false">
        <path d="M164 14C128 2 58 3 24 18 2 28 4 54 30 66c34 15 106 14 142-2 22-10 26-34 6-46-16-9-48-14-82-12" pathLength={1} />
      </svg>
    </span>
  );
}

export function ProPage() {
  const { refresh } = useSession();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<ProView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [openBenefit, setOpenBenefit] = useState<string | null>(null);

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

  const benefits: Benefit[] = [
    {
      id: 'bumps', icon: '🚀', punch: 'Jump to the top of Discover', title: 'Free bump points',
      benefit: `Every plan comes with bump points. Spend one to lift an item to the top of Discover, where buyers look first. You have ${view.bumpPoints} now.`,
    },
    ...view.features.filter((feature) => feature.pro).map((feature) => ({
      id: feature.id, icon: feature.icon, punch: feature.punch, title: feature.title, benefit: feature.benefit, line: feature.line,
    })),
    {
      id: 'badge', icon: '🏁', punch: 'Look the part everywhere', title: 'The PRO badge',
      benefit: 'A slanted gold PRO beside your shop\'s name on every item, in Social, in search and on your shop page. Buyers see a shop that takes selling seriously.',
    },
  ];
  const open = benefits.find((entry) => entry.id === openBenefit) ?? null;

  return (
    <div className="stack billpage">
      {dialog}
      <section className={`gohero${view.active ? ' is-on' : ''}`}>
        <span className="gohero__lines" aria-hidden="true" />
        <div className="gohero__top">
          <ProBadge size="md" />
          {view.active && <span className="gohero__live">● Live · {view.daysLeft} days left</span>}
        </div>
        <h1 className="gohero__title">
          {view.active ? <>You&apos;re <Hand tone="lime">Pro.</Hand></> : <>Go <Hand>Pro.</Hand><br />Sell faster.</>}
        </h1>
        <p className="gohero__line">
          {view.active
            ? <>Pro until <b>{date(view.until)}</b>. Every tool is <Hand tone="gold" thin>switched on</Hand>.</>
            : <>Every Pro tool, <Hand tone="gold" thin>free bumps</Hand> and the badge. From <b>{formatMoney(cheapest)}</b> a month.</>}
        </p>
        {!view.active && view.enabled && <a className="gohero__cta" href="#plans">Pick a plan <span aria-hidden="true">→</span></a>}
        {!view.enabled && <p className="notice notice--info">Pro tools are open to every shop right now - there is nothing to buy.</p>}
      </section>

      <div className="goticker" aria-hidden="true">
        <span>{[...benefits, ...benefits].map((entry, index) => <b key={index}>{entry.icon} {entry.title}</b>)}</span>
      </div>

      {error && <ErrorNotice message={error} />}
      {done && <p className="notice notice--ok" role="status">{done}</p>}

      <section className="stack">
        <h2 className="gohead"><Hand thin>What you get</Hand></h2>
        <ol className="gobens">
          {benefits.map((entry, index) => (
            <li key={entry.id} style={{ ['--i' as string]: index }}>
              <button type="button" className="goben" onClick={() => setOpenBenefit(entry.id)} aria-haspopup="dialog">
                <span className="goben__num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                <span className="goben__icon" aria-hidden="true">{entry.icon}</span>
                <span className="goben__text">
                  <b className="goben__punch">{entry.punch}</b>
                  <small>{entry.title}</small>
                </span>
                <span className="goben__go" aria-hidden="true">+</span>
              </button>
            </li>
          ))}
        </ol>
      </section>

      {open && (
        <Modal title={open.title} onClose={() => setOpenBenefit(null)}>
          <div className="gopop">
            <span className="gopop__icon" aria-hidden="true">{open.icon}</span>
            <p className="gopop__punch"><Hand>{open.punch}</Hand></p>
            <p className="gopop__body">{open.benefit}</p>
            {open.line && <p className="gopop__line">{open.line}</p>}
            {view.enabled && !view.active && (
              <a className="btn gopop__cta" href="#plans" onClick={() => setOpenBenefit(null)}>Get it with Pro</a>
            )}
          </div>
        </Modal>
      )}

      {view.enabled && (
        <section className="stack" id="plans">
          <h2 className="gohead"><Hand thin>{view.active ? 'Add more time' : 'Pick your plan'}</Hand></h2>
          <div className="goplans">
            {view.plans.map((plan) => {
              const saving = dearest > 0 && perMonth(plan) < dearest ? Math.round((1 - perMonth(plan) / dearest) * 100) : 0;
              const top = plan.months === best && perMonth(plan) === cheapest;
              return (
                <article key={plan.months} className={`goplan${top ? ' is-best' : ''}`}>
                  {top && <span className="goplan__flag">Best value</span>}
                  <span className="goplan__months" aria-hidden="true">{plan.months}</span>
                  <h3 className="goplan__label">{plan.months} months</h3>
                  <p className="goplan__price">{top ? <Ring>{formatMoney(plan.totalMinor)}</Ring> : formatMoney(plan.totalMinor)}</p>
                  <p className="goplan__per">{formatMoney(perMonth(plan))}/month{saving > 0 && <> · <b>save {saving}%</b></>}</p>
                  {view.gst && plan.gstMinor > 0 && (
                    <p className="faint goplan__tax">
                      {view.gst.mode === 'inclusive' ? 'Includes' : 'Plus'} {view.gst.rateBp / 100}% GST ({formatMoney(plan.gstMinor)})
                    </p>
                  )}
                  {plan.bumpPoints > 0 && <p className="goplan__bumps">🚀 {plan.bumpPoints} bump points</p>}
                  <button type="button" className="goplan__buy" disabled={busy !== null}
                    onClick={() => void (async () => {
                      const yes = await confirm({
                        title: `Pro for ${plan.months} months`,
                        body: `${formatMoney(plan.totalMinor)} through the payment gateway.${view.active ? ' Added onto the time you have left.' : ''}`,
                        action: `Pay ${formatMoney(plan.totalMinor)}`,
                      });
                      if (yes) await apply(`buy${plan.months}`, () => api.buyPro(plan.months), `Welcome to Pro - ${plan.months} months added.`);
                    })()}>
                    {busy === `buy${plan.months}` ? 'Paying…' : view.active ? 'Add these months' : 'Go Pro'} <span aria-hidden="true">→</span>
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {view.enabled && (
        <section className="goticket stack">
          <h2 className="gohead"><Hand thin>Have a code?</Hand></h2>
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
          <small>Paid so far</small>
          <b>{formatMoney(s.settlements.reduce((sum, row) => sum + (row.waived ? 0 : row.amountMinor), 0))}</b>
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
                  <span className={`badge${line.reversalOf ? ' badge--ok' : line.via === 'gateway' ? ' badge--ok' : ''}`}>
                    {line.reversalOf ? 'Taken off this month' : line.via === 'gateway' ? 'Taken by gateway' : 'Direct'}
                  </span>
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
