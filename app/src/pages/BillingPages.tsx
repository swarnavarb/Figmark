import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FEE_KIND_LABELS, type FeeKind, type ProFeatureId, type ProVoucherPreview } from '@shared/billing';
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

interface Benefit { id: string; icon: string; title: string; say: string; more: string }

/**
 * Each Pro tool in short, simple words: what a seller gets, not how it works.
 * The longer feature copy in `PRO_FEATURES` is the fallback for a tool added
 * later and not yet written here.
 */
const SIMPLE: Partial<Record<ProFeatureId, { title: string; say: string; more: string }>> = {
  insights: {
    title: 'Insights', say: 'See which items sell best',
    more: 'See which items sell more each week, which buyers have stopped coming back, and what to buy next. Buy what sells. Stop guessing.',
  },
  coach: {
    title: 'Shop helper (AI)', say: 'Get simple tips to grow your shop',
    more: 'The helper looks at your items and orders and tells you what to do today and when to post. Figgy answers common selling questions.',
  },
  calculator: {
    title: 'Profit calculator', say: 'Find the right price fast',
    more: 'Type the price you paid abroad. See your full cost, your profit and a good selling price. It uses your own shipping and exchange rates.',
  },
  costs: {
    title: 'Cost sheets', say: 'Know your real profit',
    more: 'Add shipping, customs, packing and fees for each item. Your profit book then shows what you really earned, and which items lose money.',
  },
  customers: {
    title: 'Buyer messages', say: 'Message buyers who want your item',
    more: 'See who saved or asked for an item. When it arrives, send a message to just those people.',
  },
  powerSale: {
    title: 'Timed sales', say: 'Run a quick sale for your followers',
    more: 'Start a sale with a timer. All your followers hear about it at the same time, so items sell fast.',
  },
  loyalty: {
    title: 'Loyalty cards', say: 'Bring buyers back again',
    more: 'Buyers get a stamp for each order. Give cashback, a free item or money off on the stamps you choose.',
  },
};

export function ProPage() {
  const { refresh } = useSession();
  const { confirm, dialog } = useConfirm();
  const [view, setView] = useState<ProView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | null>(null);
  /** The coupon shown in the popup, read but not yet used. */
  const [coupon, setCoupon] = useState<ProVoucherPreview | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [openBenefit, setOpenBenefit] = useState<string | null>(null);

  useEffect(() => {
    api.myPro().then(setView).catch((err) => setError(message(err, 'Could not load Pro.')));
  }, []);

  const apply = useCallback(async (key: string, work: () => Promise<ProView>, success: string): Promise<boolean> => {
    setBusy(key);
    setError(null);
    setDone(null);
    try {
      setView(await work());
      forgetProStatus();
      await refresh();
      setDone(success);
      return true;
    } catch (err) {
      setError(message(err, 'That did not work. Please try again.'));
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  async function claim() {
    const typed = code.trim();
    if (!typed) return;
    setBusy('claim');
    setCodeError(null);
    setDone(null);
    try {
      setCoupon((await api.checkProCode(typed)).voucher);
    } catch (err) {
      setCodeError(message(err, 'We could not check that code. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  async function useCoupon() {
    if (!coupon) return;
    setBusy('code');
    setCodeError(null);
    setDone(null);
    try {
      setView(await api.redeemPro(coupon.code));
      forgetProStatus();
      await refresh();
      setDone(`Coupon applied. ${coupon.days} days of Pro added.`);
      setCoupon(null);
      setCode('');
    } catch (err) {
      setCoupon(null);
      setCodeError(message(err, 'That coupon did not work. Please try again.'));
    } finally {
      setBusy(null);
    }
  }

  if (!view && error) return <PageError message={error} />;
  if (!view) return <PageLoading />;

  const longest = Math.max(...view.plans.map((plan) => plan.months));
  const perMonth = (plan: ProView['plans'][number]) => Math.round(plan.totalMinor / plan.months);
  const cheapest = view.plans.length ? Math.min(...view.plans.map(perMonth)) : 0;
  const dearest = view.plans.length ? Math.max(...view.plans.map(perMonth)) : 0;
  const canTry = view.enabled && view.trialDays > 0 && !view.trialUsed && view.history.length === 0;

  const benefits: Benefit[] = [
    ...view.features.filter((feature) => feature.pro).map((feature) => {
      const simple = SIMPLE[feature.id];
      return { id: feature.id, icon: feature.icon, title: simple?.title ?? feature.title, say: simple?.say ?? feature.punch, more: simple?.more ?? feature.benefit };
    }),
    {
      id: 'bumps', icon: '🚀', title: 'Bump points', say: 'Move your items to the top',
      more: `Plans come with bump points. Use one to move an item to the top of Discover, where buyers look first. You have ${view.bumpPoints} now.`,
    },
    {
      id: 'badge', icon: '🏅', title: 'PRO badge', say: 'Show buyers your shop is serious',
      more: 'A gold PRO sign next to your shop name, on your items, in search and on your shop page.',
    },
  ];
  const open = benefits.find((entry) => entry.id === openBenefit) ?? null;

  return (
    <div className="stack billpage propage">
      {dialog}

      <section className={`prohero${view.active ? ' is-on' : ''}`}>
        <div className="prohero__top">
          <ProBadge size="md" />
          {view.active && <span className="prohero__live">Active</span>}
        </div>
        {view.active ? (
          <>
            <h1 className="prohero__title">You have Pro</h1>
            <p className="prohero__line">
              All Pro tools are on. Your Pro ends on <b>{date(view.until)}</b>.
            </p>
            <div className="prometer" aria-label={`${view.daysLeft} days left`}>
              <b>{view.daysLeft}</b>
              <span>{view.daysLeft === 1 ? 'day left' : 'days left'}</span>
            </div>
          </>
        ) : (
          <>
            <h1 className="prohero__title">Sell more with Pro</h1>
            <p className="prohero__line">
              Pro gives your shop extra tools to sell faster and earn more.
              {view.enabled && view.plans.length > 0 && <> Plans start at <b>{formatMoney(cheapest)}</b> a month.</>}
            </p>
            {view.enabled && (
              <div className="prohero__actions">
                {view.plans.length > 0 && <a className="btn prohero__cta" href="#plans">See plans</a>}
                {canTry && (
                  <button type="button" className="btn btn--ghost" disabled={busy !== null}
                    onClick={() => void apply('trial', api.startProTrial, `Your ${view.trialDays} free days have started.`)}>
                    {busy === 'trial' ? 'Starting…' : `Try free for ${view.trialDays} days`}
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {!view.enabled && <p className="notice notice--info">Right now, all Pro tools are free for every shop. You do not need to buy anything.</p>}
      </section>

      {error && <ErrorNotice message={error} />}
      {done && <p className="notice notice--ok" role="status">{done}</p>}

      <section className="stack">
        <div className="prohead">
          <h2>What you get</h2>
          <p>Tap any item to learn more.</p>
        </div>
        <ul className="probens">
          {benefits.map((entry) => (
            <li key={entry.id}>
              <button type="button" className="proben" onClick={() => setOpenBenefit(entry.id)} aria-haspopup="dialog">
                <span className="proben__icon" aria-hidden="true">{entry.icon}</span>
                <span className="proben__text">
                  <b>{entry.say}</b>
                  <small>{entry.title}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {open && (
        <Modal title={open.title} onClose={() => setOpenBenefit(null)}>
          <div className="propop">
            <span className="propop__icon" aria-hidden="true">{open.icon}</span>
            <p className="propop__say">{open.say}</p>
            <p className="propop__more">{open.more}</p>
            {view.enabled && !view.active && view.plans.length > 0 && (
              <a className="btn" href="#plans" onClick={() => setOpenBenefit(null)}>See plans</a>
            )}
          </div>
        </Modal>
      )}

      {view.enabled && view.plans.length > 0 && (
        <section className="stack" id="plans">
          <div className="prohead">
            <h2>{view.active ? 'Add more time' : 'Choose a plan'}</h2>
            <p>{view.active ? 'New months are added after your current Pro ends.' : 'Pay once. No auto-renew. Pro simply stops at the end.'}</p>
          </div>
          <div className="proplans">
            {view.plans.map((plan) => {
              const saving = dearest > 0 && perMonth(plan) < dearest ? Math.round((1 - perMonth(plan) / dearest) * 100) : 0;
              const best = plan.months === longest && perMonth(plan) === cheapest && view.plans.length > 1;
              return (
                <article key={plan.months} className={`proplan${best ? ' is-best' : ''}`}>
                  {best && <span className="proplan__flag">Best value</span>}
                  <h3 className="proplan__months">{plan.months} months</h3>
                  <p className="proplan__price">{formatMoney(plan.totalMinor)}</p>
                  <p className="proplan__per">
                    {formatMoney(perMonth(plan))} a month{saving > 0 && <> · <b>you save {saving}%</b></>}
                  </p>
                  <ul className="proplan__list">
                    <li>All Pro tools</li>
                    <li>PRO badge</li>
                    {plan.bumpPoints > 0 && <li>{plan.bumpPoints} bump points free</li>}
                  </ul>
                  {view.gst && plan.gstMinor > 0 && (
                    <p className="faint proplan__tax">
                      {view.gst.mode === 'inclusive' ? 'Includes' : 'Plus'} {view.gst.rateBp / 100}% GST ({formatMoney(plan.gstMinor)})
                    </p>
                  )}
                  <button type="button" className={`btn${best ? '' : ' btn--ghost'} proplan__buy`} disabled={busy !== null}
                    onClick={() => void (async () => {
                      const yes = await confirm({
                        title: `Buy Pro for ${plan.months} months`,
                        body: `You will pay ${formatMoney(plan.totalMinor)} through the payment gateway.${view.active ? ' The months are added to the Pro you have now.' : ''}`,
                        action: `Pay ${formatMoney(plan.totalMinor)}`,
                      });
                      if (yes) await apply(`buy${plan.months}`, () => api.buyPro(plan.months), `Done! ${plan.months} months of Pro added.`);
                    })()}>
                    {busy === `buy${plan.months}` ? 'Paying…' : `Buy ${plan.months} months`}
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {view.enabled && (
        <section className="procoupon">
          <div className="procoupon__head">
            <span className="procoupon__icon" aria-hidden="true">🎟️</span>
            <div>
              <h2>Have a coupon?</h2>
              <p>Type your code and press Claim. We will show you what it gives before you use it.</p>
            </div>
          </div>
          <form className="procoupon__form" onSubmit={(event) => {
            event.preventDefault();
            void claim();
          }}>
            <input value={code} onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeError(null); }}
              placeholder="Enter coupon code" aria-label="Coupon code" aria-invalid={codeError ? true : undefined}
              autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={32} />
            <button className="btn" disabled={busy !== null || !code.trim()}>{busy === 'claim' ? 'Checking…' : 'Claim'}</button>
          </form>
          {codeError && <p className="procoupon__error" role="alert">{codeError}</p>}
        </section>
      )}

      {coupon && (
        <Modal title="Your coupon" onClose={() => busy !== 'code' && setCoupon(null)}>
          <div className="procode">
            <span className="procode__chip">🎟️ {coupon.code}</span>
            <p className="procode__title">{coupon.title}</p>
            {coupon.details && <p className="procode__details">{coupon.details}</p>}
            <dl className="procode__facts">
              <div><dt>You get</dt><dd>{coupon.days} {coupon.days === 1 ? 'day' : 'days'} of Pro</dd></div>
              {coupon.expiresAt && <div><dt>Use it by</dt><dd>{date(coupon.expiresAt)}</dd></div>}
            </dl>
            {view.active && <p className="faint procode__note">These days are added to the Pro you have now.</p>}
            <div className="procode__actions">
              <button type="button" className="btn" disabled={busy !== null} onClick={() => void useCoupon()}>
                {busy === 'code' ? 'Applying…' : 'Apply coupon'}
              </button>
              <button type="button" className="btn btn--quiet" disabled={busy === 'code'} onClick={() => setCoupon(null)}>Not now</button>
            </div>
          </div>
        </Modal>
      )}

      {view.enabled && (
        <section className="stack">
          <div className="prohead"><h2>Good to know</h2></div>
          <dl className="profaq">
            <div><dt>How do I pay?</dt><dd>You pay once, through the payment gateway. We never take money again on our own.</dd></div>
            <div><dt>What happens when Pro ends?</dt><dd>Your shop and items stay. Only the Pro tools stop, until you get Pro again.</dd></div>
            <div><dt>I already have Pro. Can I add more?</dt><dd>Yes. New months or coupon days are added after your current Pro ends.</dd></div>
          </dl>
        </section>
      )}

      {view.history.length > 0 && (
        <section className="card card--pad stack">
          <h2>Your Pro history</h2>
          <ul className="billrows">
            {view.history.map((grant) => (
              <li key={grant.id} className="billrow">
                <span>
                  <b>{grant.source === 'purchase' ? `Bought ${grant.months} months` : grant.source === 'voucher' ? `Coupon ${grant.code}` : grant.source === 'trial' ? 'Free trial' : 'Gift from Figmark'}</b>
                  <small>{date(grant.at)} · {grant.days} days{grant.bumpPoints ? ` · ${grant.bumpPoints} bump points` : ''}{grant.gatewayRef ? ` · ${grant.gatewayRef}` : ''}</small>
                </span>
                {grant.amountMinor ? <b>{formatMoney(grant.amountMinor)}</b> : <span className="badge">Free</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="faint">
        See the fees on your sales on <Link to="/fees">Platform fees</Link>.
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
