import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { InsurancePlan } from '@shared/models';
import { FREIGHT_MODE_LABELS, insuranceQuote, laneLabel, transitLabel, type FreightMode, type StoreKind } from '@shared/service-stores';
import {
  BASIS_LABELS, answerFor, checkAnswers, estimate, fromPriceMinor, laneFromMinor, planIsFree, volumetricLabel, warehousesOf,
  type AnswerValue, type Answers, type Dimensions, type ItemRow,
} from '@shared/service-work';
import { ApiRequestError, api, type StorePageView } from '../api';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatMoney } from '../format';
import { StoreMark, accentStyle } from '../components/StoreKit';
import { EstimateBox, FormFields, InfoRows, PriceOptions, PriceRows, StandingChips, WarehouseCards } from '../components/ServiceWorkKit';
import { PageLoading } from '../components/Feedback';
import { loaders } from '../pageLoaders';
import '../styles/ServiceDetailPage.css';

/**
 * One route a forwarder runs, or one service an artist offers.
 *
 * Kept short: where to send it, what it costs, the cover and extras on offer.
 * The rest - volumetric rules, batteries, how to pack, terms - folds away
 * under one heading. The button to use it floats over the page.
 */
export function ServiceDetailPage() {
  const { kind, slug, section, subjectId } = useParams<{ kind: string; slug: string; section: string; subjectId: string }>();
  const { user } = useSession();
  const [data, setData] = useState<StorePageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (kind !== 'forwarder' && kind !== 'artist') return;
    void api.storePage(kind as StoreKind, slug ?? '').then(setData)
      .catch((err: unknown) => setError(err instanceof ApiRequestError ? err.message : 'Could not load that store.'));
    // Where the form goes next, fetched while the reader is still reading.
    void loaders.serviceRequest().catch(() => undefined);
  }, [kind, slug]);

  if (error && !data) return <main className="page"><BackLink to={`/services/${kind}`} title="Store" /><EmptyState icon="◌" title="Not found">{error}</EmptyState></main>;
  if (!data) return <PageLoading />;
  const { store, stats } = data;
  const lane = store.kind === 'forwarder' && section === 'route' ? store.lanes.find((row) => row.id === subjectId) : undefined;
  const offering = store.kind === 'artist' && section === 'service' ? store.offerings.find((row) => row.id === subjectId) : undefined;
  if (!lane && !offering) {
    return (
      <main className="page"><BackLink to={`/services/${store.kind}/${store.slug}`} title={store.name} />
        <EmptyState icon="◌" title="Not on offer any more">This route or service has been taken down. <Link to={`/services/${store.kind}/${store.slug}`}>See what {store.name} offers</Link></EmptyState>
      </main>
    );
  }
  const isTeam = (data.viewer?.rights.length ?? 0) > 0;
  const products = (lane?.products ?? offering?.products) ?? [];
  const from = lane ? laneFromMinor(lane) : fromPriceMinor(offering!.priceFromMinor, products);
  const terms = [lane?.terms ?? offering?.terms, store.terms].filter(Boolean) as string[];
  const warehouses = lane ? warehousesOf(lane, store.warehouse) : [];
  const closed = store.kind === 'artist' && !store.acceptingWork;
  const title = lane ? laneLabel(lane) : offering!.name;
  const mode = lane ? FREIGHT_MODE_LABELS[lane.mode as FreightMode] : null;
  const details = [
    ...(lane ? [
      ...(lane.volumetric ? [{ label: 'Volumetric', value: `${volumetricLabel(lane.volumetric)}${lane.volumetric.note ? `\n${lane.volumetric.note}` : ''}` }] : []),
      ...(lane.minChargeKg > 0 ? [{ label: 'Minimum', value: `${lane.minChargeKg} kg billed` }] : []),
      { label: 'Batteries', value: lane.batteryAllowed === false ? 'Not carried' : 'Carried — declare them' },
      { label: 'Customs', value: lane.customsIncluded ? 'Cleared by the forwarder' : 'Duty paid at actuals' },
    ] : []),
    ...(offering?.includes ? [{ label: 'Included', value: offering.includes }] : []),
    ...((lane?.orderInfo || offering?.orderInfo) ? [{ label: 'How to send', value: (lane?.orderInfo || offering?.orderInfo)! }] : []),
    ...(lane?.extras ?? offering?.extras ?? []),
  ];

  return (
    <main className="page sd-page" style={accentStyle(store.accent)}>
      <BackLink to={`/services/${store.kind}/${store.slug}`}>{store.name}</BackLink>

      <header className="sd-head">
        <Link to={`/services/${store.kind}/${store.slug}`} className="sd-head__store">
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={32} />
          <b>{store.name}</b>
          <span className="sd-head__chips"><StandingChips standing={stats.standing} /></span>
        </Link>
        <h1>{title}</h1>
        <p className="sd-head__line">
          {lane ? <>{mode?.glyph} {mode?.label} · {transitLabel(lane)}{lane.customsIncluded ? ' · customs cleared' : ''}</>
            : <>{offering!.description}{offering!.turnaroundDays ? ` · about ${offering!.turnaroundDays} days` : ''}</>}
          {from > 0 && <> · <span className="sd-head__from">from <b>{formatMoney(from)}</b>{lane ? '/kg' : ''}</span></>}
        </p>
      </header>

      <div className="sd-main">
        {warehouses.length > 0 && (
          <section className="sd-sec">
            <h2><Icon name="home" size={16} /> Ship to</h2>
            <WarehouseCards warehouses={warehouses} />
          </section>
        )}

        <section className="sd-sec">
          <h2>Prices</h2>
          <PriceOptions options={products}
            baseLabel={lane ? 'Everything else' : 'Standard'} baseMinor={lane ? lane.ratePerKgMinor : offering!.priceFromMinor}
            baseBasis={lane ? 'kg' : 'flat'} />
        </section>

        {lane && store.insurance.length > 0 && (
          <section className="sd-sec">
            <h2>Cover</h2>
            <PriceRows rows={store.insurance.map((plan) => ({ id: plan.id, name: plan.name, note: coverLine(plan), price: planPrice(plan) }))} />
          </section>
        )}

        {store.serviceOptions.length > 0 && (
          <section className="sd-sec">
            <h2>Extras</h2>
            <PriceRows rows={store.serviceOptions.map((row) => ({ id: row.id, name: row.name, note: row.note, price: row.priceMinor ? formatMoney(row.priceMinor) : 'Free' }))} />
          </section>
        )}

        {(details.length > 0 || terms.length > 0) && (
          <details className="sd-more">
            <summary>Details & terms</summary>
            <InfoRows rows={[...details, ...terms.map((value, index) => ({ label: index === 0 && terms.length > 1 ? 'Route terms' : 'Terms', value }))]} />
          </details>
        )}
      </div>

      <div className="sd-fab">
        {isTeam ? (
          <Link to={`/services/store/${store.kind}/${store.ownerId}?tab=store`} className="btn sd-fab__btn"><Icon name="compose" size={15} /> Edit this {lane ? 'route' : 'service'}</Link>
        ) : !user ? (
          <Link to="/" className="btn sd-fab__btn">Sign in to {lane ? 'ship' : 'request'}</Link>
        ) : closed ? (
          <span className="btn btn--ghost sd-fab__btn" aria-disabled="true">Not taking new work right now</span>
        ) : (
          <button type="button" className="btn sd-fab__btn" onClick={() => setOpen(true)}>
            <Icon name={lane ? 'plane' : 'spark'} size={15} /> {lane ? `Ship with ${store.name}` : 'Request this service'}
          </button>
        )}
      </div>

      {open && <RequestSheet data={data} laneId={lane?.id ?? null} offeringId={offering?.id ?? null} onClose={() => setOpen(false)} />}
    </main>
  );
}

function planPrice(plan: InsurancePlan): string {
  if (planIsFree(plan)) return 'Free';
  const percent = `${(plan.premiumBasisPoints / 100).toFixed(plan.premiumBasisPoints % 100 ? 1 : 0)}% of value`;
  return plan.minPremiumMinor ? `${percent}, min ${formatMoney(plan.minPremiumMinor)}` : percent;
}

function coverLine(plan: InsurancePlan): string {
  return `Covers ${plan.coverPercent}%${plan.maxCoverMinor ? `, up to ${formatMoney(plan.maxCoverMinor)}` : ''}`;
}

/** The order form, over the page: where to send it, the store's questions, extras and cover, and the estimate. */
function RequestSheet({ data, laneId, offeringId, onClose }: {
  data: StorePageView; laneId: string | null; offeringId: string | null; onClose: () => void;
}) {
  const navigate = useNavigate();
  const { store } = data;
  const lane = store.lanes.find((row) => row.id === laneId) ?? null;
  const offering = store.offerings.find((row) => row.id === offeringId) ?? null;
  const [answers, setAnswers] = useState<Answers>({});
  const [optionId, setOptionId] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(() => store.insurance.find(planIsFree)?.id ?? null);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const external = Boolean(store.formUrl);
  const products = (lane?.products ?? offering?.products) ?? [];
  const option = products.find((row) => row.id === optionId) ?? null;
  const plan = store.insurance.find((row) => row.id === planId) ?? null;
  const warehouses = lane ? warehousesOf(lane, store.warehouse) : [];
  const form = external ? [] : store.form;

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [onClose]);

  const items = answerFor<ItemRow[]>(form, answers, 'items') ?? [];
  const declared = (answerFor<number>(form, answers, 'declared_value') ?? 0) * 100 || items.reduce((sum, row) => sum + (row.qty || 0) * row.valueMinor, 0);
  const addons = store.serviceOptions.filter((row) => addonIds.includes(row.id));
  const figures = useMemo(() => estimate({
    kind: store.kind, lane, offering, option,
    weightKg: answerFor<number>(form, answers, 'weight') ?? 0,
    box: answerFor<Dimensions>(form, answers, 'dimensions'),
    pieces: items.reduce((sum, row) => sum + (row.qty || 0), 0),
    plan, declaredMinor: declared, addons,
  }), [store, lane, offering, option, answers, plan, declared, items, addons, form]);
  const { gaps } = checkAnswers(form, answers);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (gaps.length > 0) { setError(`Still needed: ${gaps.join(', ')}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const view = await api.submitServiceRequest(store.kind, store.ownerId, {
        subjectId: (laneId ?? offeringId)!, optionId, planId, answers, addonIds, external,
      });
      navigate(`/services/requests/${store.kind}/${store.ownerId}/${view.request.id}?sent=1`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
      setBusy(false);
    }
  }

  const set = (id: string, value: AnswerValue) => setAnswers((current) => ({ ...current, [id]: value }));
  const toggle = (id: string) => setAddonIds((current) => (current.includes(id) ? current.filter((row) => row !== id) : [...current, id]));
  const note = figures.chargeable?.by === 'volumetric'
    ? `Billed on volumetric weight: ${figures.chargeable.volumetricKg} kg.`
    : figures.chargeable?.by === 'minimum' ? `Billed at the route minimum of ${lane?.minChargeKg} kg.`
      : 'The team confirms the final price in their quote.';
  let step = 0;

  return (
    <div className="sd-sheet" role="dialog" aria-modal="true" aria-label={lane ? `Ship with ${store.name}` : `Request from ${store.name}`}>
      <button type="button" className="sd-sheet__scrim" aria-label="Close" onClick={onClose} />
      <form className="sd-sheet__panel" onSubmit={(event) => void submit(event)} style={accentStyle(store.accent)}>
        <div className="sd-sheet__head">
          <span>
            <span className="faint">{store.name}</span>
            <h2>{lane ? laneLabel(lane) : offering?.name}</h2>
          </span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="sd-sheet__body stack">
          {warehouses.length > 0 && (
            <section className="sd-step">
              <h3><span className="sd-step__n">{++step}</span> Send your parcel to {warehouses.length > 1 ? 'one of these' : 'this address'}</h3>
              <WarehouseCards warehouses={warehouses} />
              <p className="faint">You get a request number once you send this — write it on the box.</p>
            </section>
          )}

          <section className="sd-step">
            <h3><span className="sd-step__n">{++step}</span> {external ? `Fill in ${store.name}’s form` : 'Your details'}</h3>
            {products.length > 0 && (
              <label className="field"><span>{lane ? 'What are you sending?' : 'Which one?'}</span>
                <select value={optionId ?? ''} onChange={(event) => setOptionId(event.target.value || null)}>
                  <option value="">{lane ? `Everything else — ${formatMoney(lane.ratePerKgMinor)}/kg` : `Standard — ${formatMoney(offering?.priceFromMinor ?? 0)}`}</option>
                  {products.map((row) => <option key={row.id} value={row.id}>{row.name} — {formatMoney(row.priceMinor)} {BASIS_LABELS[row.basis]}</option>)}
                </select>
              </label>
            )}
            {external ? (
              <div className="sd-extform">
                <p>{store.name} collects {lane ? "shipment" : "order"} details on their own form. Fill it in, then send this so the request is tracked here.</p>
                <a href={store.formUrl!} target="_blank" rel="noreferrer" className="btn btn--ghost"><Icon name="external" size={14} /> Open their form</a>
              </div>
            ) : <FormFields fields={form} answers={answers} onChange={set} />}
          </section>

          {(store.serviceOptions.length > 0 || (lane && store.insurance.length > 0)) && (
            <section className="sd-step">
              <h3><span className="sd-step__n">{++step}</span> Extras & cover</h3>
              <div className="sd-picks">
                {store.serviceOptions.map((row) => (
                  <label key={row.id} className={`sd-pick${addonIds.includes(row.id) ? ' is-on' : ''}`}>
                    <input type="checkbox" checked={addonIds.includes(row.id)} onChange={() => toggle(row.id)} />
                    <span>{row.name}{row.note && <small>{row.note}</small>}</span>
                    <b>{row.priceMinor ? formatMoney(row.priceMinor) : 'Free'}</b>
                  </label>
                ))}
                {lane && store.insurance.length > 0 && (
                  <>
                    {!store.insurance.some(planIsFree) && (
                      <label className={`sd-pick${planId === null ? ' is-on' : ''}`}>
                        <input type="radio" name="cover" checked={planId === null} onChange={() => setPlanId(null)} />
                        <span>No cover</span><b />
                      </label>
                    )}
                    {store.insurance.map((row) => {
                      const quote = !planIsFree(row) && declared > 0 ? insuranceQuote(row, declared) : null;
                      return (
                        <label key={row.id} className={`sd-pick${planId === row.id ? ' is-on' : ''}`}>
                          <input type="radio" name="cover" checked={planId === row.id} onChange={() => setPlanId(row.id)} />
                          <span>{row.name}<small>{coverLine(row)}</small></span>
                          <b>{quote ? formatMoney(quote.premiumMinor) : planPrice(row)}</b>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            </section>
          )}

          {!external && <EstimateBox estimate={figures} note={note} />}
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="sd-sheet__foot">
          <span className="faint">{gaps.length > 0 ? `${gaps.length} required ${gaps.length === 1 ? 'answer' : 'answers'} to go` : external ? 'Filled in their form?' : 'Ready to send'}</span>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Sending…' : external ? 'Done — send request' : 'Send request'}</button>
        </div>
      </form>
    </div>
  );
}
