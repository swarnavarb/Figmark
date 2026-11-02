import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FREIGHT_MODE_LABELS, insuranceQuote, transitLabel, type FreightMode, type StoreKind } from '@shared/service-stores';
import {
  answerFor, checkAnswers, estimate, fromPriceMinor, laneFromMinor, volumetricLabel,
  type AnswerValue, type Answers, type Dimensions, type ItemRow,
} from '@shared/service-work';
import { ApiRequestError, api, type StorePageView } from '../api';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatMoney } from '../format';
import { LaneTicket, PlanCard, StoreMark, accentStyle } from '../components/StoreKit';
import { EstimateBox, FormFields, InfoRows, PriceOptions, StandingChips } from '../components/ServiceWorkKit';
import { PageLoading } from '../components/Feedback';
import { loaders } from '../pageLoaders';
import '../styles/ServiceDetailPage.css';

/**
 * One route a forwarder runs, or one service an artist offers - everything a
 * customer needs before using it, and the form to use it.
 *
 * Every price and condition the store wrote is here: product prices, when a
 * parcel is billed by size, the cover on offer, where to send it, how to pack
 * it, the terms. The button to use it floats over the page, so it is there
 * wherever the reader stops; it opens the store's own form with a live
 * estimate from these same prices.
 */
export function ServiceDetailPage() {
  const { kind, slug, section, subjectId } = useParams<{ kind: string; slug: string; section: string; subjectId: string }>();
  const { user } = useSession();
  const [data, setData] = useState<StorePageView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [optionId, setOptionId] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== 'forwarder' && kind !== 'artist') return;
    // The store page already asked for this; the read is shared, not repeated.
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
  const warehouse = lane ? (lane.warehouse ?? store.warehouse) : null;
  const closed = store.kind === 'artist' && !store.acceptingWork;
  const title = lane ? `${lane.originCity} → ${lane.destinationCity}` : offering!.name;

  return (
    <main className="page sd-page" style={accentStyle(store.accent)}>
      <BackLink to={`/services/${store.kind}/${store.slug}`}>{store.name}</BackLink>

      <header className="sd-head">
        <Link to={`/services/${store.kind}/${store.slug}`} className="sd-head__store">
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={40} />
          <span><b>{store.name}</b><span className="sd-head__chips"><StandingChips standing={stats.standing} /></span></span>
        </Link>
        <h1>{title}</h1>
        <p className="muted">
          {lane ? <>{FREIGHT_MODE_LABELS[lane.mode as FreightMode]?.glyph} {FREIGHT_MODE_LABELS[lane.mode as FreightMode]?.label} · {transitLabel(lane)} · {lane.customsIncluded ? 'customs cleared' : 'duty at actuals'}</>
            : <>{offering!.description}{offering!.turnaroundDays ? ` · about ${offering!.turnaroundDays} days` : ''}</>}
        </p>
        {from > 0 && <span className="sd-head__from">From <b>{formatMoney(from)}</b>{lane ? <small> /kg</small> : null}</span>}
      </header>

      <div className="sd-layout">
        <div className="stack sd-main">
          {lane && <LaneTicket lane={lane} accent={store.accent} />}

          <section className="sd-sec">
            <h2>{lane ? 'Prices on this route' : 'Prices'}</h2>
            <p className="faint">{lane ? 'Pick what you are sending. The route rate applies to anything not listed.' : 'Pick the closest. The artist confirms the final price when they quote.'}</p>
            <PriceOptions options={products} picked={optionId} onPick={setOptionId}
              baseLabel={lane ? 'Everything else (route rate)' : 'Standard'} baseMinor={lane ? lane.ratePerKgMinor : offering!.priceFromMinor}
              baseBasis={lane ? 'kg' : 'flat'} />
            {lane && lane.minChargeKg > 0 && <p className="faint">Minimum billed weight: {lane.minChargeKg} kg.</p>}
          </section>

          {lane?.volumetric && (
            <section className="sd-sec">
              <h2>Volumetric weight</h2>
              <p className="sd-callout"><Icon name="box" size={16} /> {volumetricLabel(lane.volumetric)}</p>
              {lane.volumetric.note && <p className="muted">{lane.volumetric.note}</p>}
              <p className="faint">Give your box size in the form and the estimate works this out for you.</p>
            </section>
          )}

          {lane && store.insurance.length > 0 && (
            <section className="sd-sec">
              <h2>Transit cover</h2>
              <p className="faint">Optional — pick one in the form. Priced on your declared value.</p>
              <div className="sd-plans">{store.insurance.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>
            </section>
          )}

          {offering?.includes && (
            <section className="sd-sec"><h2>What is included</h2><p className="sd-text">{offering.includes}</p></section>
          )}

          {(lane?.orderInfo || offering?.orderInfo) && (
            <section className="sd-sec"><h2>{lane ? 'How to send your parcel' : 'How to send your piece'}</h2><p className="sd-text">{lane?.orderInfo ?? offering?.orderInfo}</p></section>
          )}

          {((lane?.extras?.length ?? 0) > 0 || (offering?.extras?.length ?? 0) > 0 || lane) && (
            <section className="sd-sec">
              <h2>Details</h2>
              <InfoRows rows={[
                ...(lane ? [
                  { label: 'Batteries', value: lane.batteryAllowed === false ? 'Not carried on this route' : 'Carried (declare them in the form)' },
                  { label: 'Customs', value: lane.customsIncluded ? 'Cleared by the forwarder' : 'Duty paid at actuals' },
                ] : []),
                ...(lane?.extras ?? offering?.extras ?? []),
              ]} />
            </section>
          )}

          {terms.length > 0 && (
            <section className="sd-sec">
              <h2>Terms</h2>
              {terms.map((row, index) => <p key={index} className="sd-text sd-terms">{row}</p>)}
            </section>
          )}

          <section className="sd-sec">
            <h2>What they will ask</h2>
            <ul className="sd-asks">
              {store.form.map((field) => <li key={field.id}>{field.label}{field.required ? '' : <span className="faint"> · optional</span>}</li>)}
            </ul>
          </section>
        </div>

        <aside className="sd-side stack">
          {warehouse && (
            <section className="sd-box">
              <h3><Icon name="home" size={14} /> Ship to this warehouse</h3>
              <p className="sd-text">{warehouse.address}</p>
              {warehouse.hours && <p className="faint">{warehouse.hours}</p>}
              {warehouse.contact && <p className="faint">{warehouse.contact}</p>}
              <p className="faint">Mark the parcel with your request number once you have one.</p>
            </section>
          )}
          <section className="sd-box">
            <h3>How it goes</h3>
            <ol className="sd-steps">
              <li>Tap the button below and fill in the form.</li>
              <li>{store.name} quotes the final price.</li>
              <li>Accept and pay them direct{store.takesDirect ? '' : ' — they share how'}.</li>
              <li>{lane ? 'Send the parcel; follow it to your door.' : 'Send the piece; follow it through the studio.'}</li>
              <li>Rate it when it is done.</li>
            </ol>
          </section>
        </aside>
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
            {from > 0 && <span className="sd-fab__from">from {formatMoney(from)}</span>}
          </button>
        )}
      </div>

      {open && (
        <RequestSheet data={data} laneId={lane?.id ?? null} offeringId={offering?.id ?? null}
          optionId={optionId} onOption={setOptionId} onClose={() => setOpen(false)} />
      )}
    </main>
  );
}

/** The store's form, over the page, with the estimate kept live as it is filled. */
function RequestSheet({ data, laneId, offeringId, optionId, onOption, onClose }: {
  data: StorePageView; laneId: string | null; offeringId: string | null; optionId: string | null;
  onOption: (id: string | null) => void; onClose: () => void;
}) {
  const navigate = useNavigate();
  const { store } = data;
  const lane = store.lanes.find((row) => row.id === laneId) ?? null;
  const offering = store.offerings.find((row) => row.id === offeringId) ?? null;
  const [answers, setAnswers] = useState<Answers>({});
  const [planId, setPlanId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const products = (lane?.products ?? offering?.products) ?? [];
  const option = products.find((row) => row.id === optionId) ?? null;
  const plan = store.insurance.find((row) => row.id === planId) ?? null;

  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [onClose]);

  const items = answerFor<ItemRow[]>(store.form, answers, 'items') ?? [];
  const declared = (answerFor<number>(store.form, answers, 'declared_value') ?? 0) * 100 || items.reduce((sum, row) => sum + (row.qty || 0) * row.valueMinor, 0);
  const figures = useMemo(() => estimate({
    kind: store.kind, lane, offering, option,
    weightKg: answerFor<number>(store.form, answers, 'weight') ?? 0,
    box: answerFor<Dimensions>(store.form, answers, 'dimensions'),
    pieces: items.reduce((sum, row) => sum + (row.qty || 0), 0),
    plan, declaredMinor: declared,
  }), [store, lane, offering, option, answers, plan, declared, items]);
  const { gaps } = checkAnswers(store.form, answers);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (gaps.length > 0) { setError(`Still needed: ${gaps.join(', ')}.`); return; }
    setBusy(true);
    setError(null);
    try {
      const view = await api.submitServiceRequest(store.kind, store.ownerId, {
        subjectId: (laneId ?? offeringId)!, optionId, planId, answers,
      });
      navigate(`/services/requests/${store.kind}/${store.ownerId}/${view.request.id}?sent=1`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
      setBusy(false);
    }
  }

  const set = (id: string, value: AnswerValue) => setAnswers((current) => ({ ...current, [id]: value }));
  const note = figures.chargeable?.by === 'volumetric'
    ? `Billed on volumetric weight: ${figures.chargeable.volumetricKg} kg is more than the weight you gave.`
    : figures.chargeable?.by === 'minimum' ? `Billed at the route minimum of ${lane?.minChargeKg} kg.`
      : 'An estimate from the published prices. The team confirms the final figure in their quote.';

  return (
    <div className="sd-sheet" role="dialog" aria-modal="true" aria-label={lane ? `Ship with ${store.name}` : `Request from ${store.name}`}>
      <button type="button" className="sd-sheet__scrim" aria-label="Close" onClick={onClose} />
      <form className="sd-sheet__panel" onSubmit={(event) => void submit(event)} style={accentStyle(store.accent)}>
        <div className="sd-sheet__head">
          <span>
            <span className="faint">{store.name}</span>
            <h2>{lane ? `${lane.originCity} → ${lane.destinationCity}` : offering?.name}</h2>
          </span>
          <button type="button" className="btn btn--quiet btn--sm" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </div>
        <div className="sd-sheet__body stack">
          {products.length > 0 && (
            <div className="field"><span>{lane ? 'What are you sending?' : 'Which price fits?'}</span>
              <PriceOptions options={products} picked={optionId} onPick={onOption}
                baseLabel={lane ? 'Everything else (route rate)' : 'Standard'} baseMinor={lane ? lane.ratePerKgMinor : (offering?.priceFromMinor ?? 0)}
                baseBasis={lane ? 'kg' : 'flat'} />
            </div>
          )}
          <FormFields fields={store.form} answers={answers} onChange={set} />
          {lane && store.insurance.length > 0 && (
            <div className="field"><span>Transit cover <span className="faint">(optional)</span></span>
              <div className="sd-plans">
                <button type="button" className={`sd-noplan${planId === null ? ' is-on' : ''}`} onClick={() => setPlanId(null)} aria-pressed={planId === null}>No cover</button>
                {store.insurance.map((row) => {
                  const quote = declared > 0 ? insuranceQuote(row, declared) : null;
                  return (
                    <PlanCard key={row.id} plan={row} selected={planId === row.id} onSelect={() => setPlanId(row.id)}
                      premiumMinor={quote?.premiumMinor} coverMinor={quote?.coverMinor} />
                  );
                })}
              </div>
            </div>
          )}
          <EstimateBox estimate={figures} note={note} />
          {error && <ErrorNotice message={error} />}
        </div>
        <div className="sd-sheet__foot">
          <span className="faint">{gaps.length > 0 ? `${gaps.length} required ${gaps.length === 1 ? 'answer' : 'answers'} to go` : 'Ready to send'}</span>
          <button type="submit" className="btn" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
        </div>
      </form>
    </div>
  );
}
