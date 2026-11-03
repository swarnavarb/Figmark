import { CreditChip } from '../components/Billing';
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StoreKind } from '@shared/service-stores';
import { statusLabel } from '@shared/service-work';
import { ApiRequestError, api, type RequestView, type TeamRow } from '../api';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, Icon } from '../components/ui';
import { formatMoney } from '../format';
import { StoreMark, accentStyle } from '../components/StoreKit';
import { AnswerList, BillCard, PriceRows, RequestActions, RequestBadge, RequestLog, RequestProgress, Stars, WarehouseCards, priceWord } from '../components/ServiceWorkKit';
import { PageLoading } from '../components/Feedback';
import '../styles/ServiceRequestPage.css';

type Loaded = RequestView & { store: { name: string; slug: string; accent: string | null; logoUrl: string | null }; team: TeamRow[] };

/**
 * One request, followed by the customer who sent it - or a payment link
 * somebody was sent, opened by whoever has it.
 *
 * It says, at every step, the one thing to do next: wait for a quote, accept
 * it, pay and say so, send the parcel to this address, rate it. The team's
 * side of the same request is the store dashboard.
 */
export function ServiceRequestPage() {
  const { kind, ownerId, id } = useParams<{ kind: string; ownerId: string; id: string }>();
  const [params] = useSearchParams();
  const [view, setView] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setView(await api.serviceRequest(kind as StoreKind, ownerId ?? '', id ?? ''));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load that request.');
    }
  }, [kind, ownerId, id]);
  useEffect(() => { void load(); }, [load]);

  if (error && !view) return <main className="page"><BackLink to="/services/mine" title="Requests" /><EmptyState icon="◌" title="Not found">{error}</EmptyState></main>;
  if (!view) return <PageLoading />;
  const { request, store } = view;
  const status = statusLabel(request);
  const arrival = request.billing === 'arrival';
  const payable = arrival ? request.status === 'billed' || view.coverDue > 0 : request.status === 'accepted';
  const payAmount = arrival && request.status !== 'billed' ? view.coverDue : view.due;
  const isLink = request.origin === 'link';
  const next = nextStep(view);

  return (
    <main className="page srq-page" style={accentStyle(store.accent)}>
      <CreditChip storeId={`${request.kind}:${request.ownerId}`} />
      <BackLink to="/services/mine">{request.number}</BackLink>
      {params.get('sent') && request.status === 'submitted' && (
        <p className="srq-sent"><Icon name="check" size={15} /> Sent. Everyone on {store.name}’s team has been told — you will hear here when they quote.</p>
      )}
      {params.get('sent') && request.status === 'booked' && (
        <p className="srq-sent"><Icon name="check" size={15} /> <span>Booked — no quote needed. Send your parcel to a warehouse below with <b>{request.number}</b> on the box.</span></p>
      )}
      <section className="srq-head">
        <Link to={`/services/${request.kind}/${store.slug}`} className="srq-head__store">
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={44} />
          <span><b>{store.name}</b><span className="faint">{isLink ? 'Payment link' : request.kind === 'forwarder' ? 'Shipping request' : 'Commission'} · {request.number}</span></span>
        </Link>
        <h1>{isLink ? request.title : request.subject?.label}</h1>
        <div className="srq-head__status"><RequestBadge request={request} /><RequestProgress request={request} /></div>
        <div className="srq-money">
          <span><span className="faint">{priceWord(request) === 'Quote' ? 'Price' : priceWord(request)}</span><b>{formatMoney(view.due)}</b></span>
          {request.turnaroundDays && <span><span className="faint">Time</span><b>{request.turnaroundDays} days</b></span>}
          {request.chargeableKg && (!arrival || request.bill) ? <span><span className="faint">Billed weight</span><b>{request.chargeableKg} kg</b></span> : null}
          {request.plan && <span><span className="faint">Cover</span><b>{request.plan.name}</b></span>}
        </div>
      </section>

      <div className="srq-layout">
        <div className="stack">
          <section className={`srq-next srq-next--${status.tone}`}>
            <h2>{next.title}</h2>
            {next.body && <p>{next.body}</p>}
            {request.quoteNote && request.status === 'quoted' && <blockquote>“{request.quoteNote}”</blockquote>}
            {request.bill && <BillCard bill={request.bill} />}
            {view.payTo && payable && (
              <dl className="srq-pay">
                {view.payTo.upiId && <div><dt>UPI</dt><dd>{view.payTo.upiId}</dd></div>}
                {view.payTo.accountName && <div><dt>Name</dt><dd>{view.payTo.accountName}</dd></div>}
                {view.payTo.accountNumber && <div><dt>Account</dt><dd>{view.payTo.accountNumber}</dd></div>}
                {view.payTo.ifsc && <div><dt>IFSC</dt><dd>{view.payTo.ifsc}</dd></div>}
                {view.payTo.instructions && <div><dt>Note</dt><dd>{view.payTo.instructions}</dd></div>}
                <div><dt>Amount</dt><dd><b>{formatMoney(payAmount)}</b> · {arrival && request.status !== 'billed' ? 'cover' : request.bill ? 'bill' : 'quote'} {request.number}</dd></div>
              </dl>
            )}
            {view.sendTo.length > 0 && (request.kind === 'forwarder' ? ['submitted', 'quoted', 'accepted', 'paid', 'booked', 'sent_in'] : ['paid']).includes(request.status)
              && !(arrival && request.status === 'paid') && (
              <div className="srq-sendto">
                <span className="faint">{request.kind === 'forwarder' ? `Send your parcel to${view.sendTo.length > 1 ? ' one of these' : ''}` : 'Send your piece to'}</span>
                <WarehouseCards warehouses={view.sendTo} reference={request.number} />
              </div>
            )}
            {request.inbound?.awb && ['sent_in', 'received'].includes(request.status) && (
              <p className="srq-track"><Icon name="truck" size={15} /> To the warehouse: {request.inbound.courier} <b>{request.inbound.awb}</b></p>
            )}
            {request.tracking && <p className="srq-track"><Icon name="truck" size={15} /> {request.tracking.courier} <b>{request.tracking.awb}</b></p>}
            <RequestActions view={view} onChanged={(changed) => setView({ ...view, ...changed })} />
            {request.review && <p className="srq-rated"><Stars value={request.review.stars} /> {request.review.text}</p>}
          </section>

          {isLink && request.description && <section className="srq-sec"><h2>What it is for</h2><p className="srq-text">{request.description}</p></section>}
          {(request.fields.length > 0 || request.external || (request.addons?.length ?? 0) > 0) && (
            <section className="srq-sec">
              <h2>What you sent</h2>
              {request.option && <p className="faint">Price picked: {request.option.name}</p>}
              {request.external && <p className="faint">Details went in on {store.name}’s own form.</p>}
              <AnswerList fields={request.fields} answers={request.answers} />
              {(request.addons?.length ?? 0) > 0 && (
                <PriceRows rows={request.addons!.map((row) => ({ id: row.id, name: row.name, price: row.priceMinor ? formatMoney(row.priceMinor) : 'Free' }))} />
              )}
            </section>
          )}
        </div>
        <aside className="stack">
          <section className="srq-sec">
            <h2>History</h2>
            <RequestLog request={request} />
          </section>
          <Link to={`/services/${request.kind}/${store.slug}?tab=channel`} className="btn btn--ghost"><Icon name="forum" size={14} /> {store.name}’s channel</Link>
        </aside>
      </div>
    </main>
  );
}

/** The one thing the customer should do, or wait for, now. */
function nextStep(view: RequestView): { title: string; body?: string } {
  const { request } = view;
  const goods = request.kind === 'forwarder' ? 'parcel' : 'piece';
  if (request.billing === 'arrival') {
    const cover = view.coverDue > 0 ? ` Pay ${formatMoney(view.coverDue)} for the cover first.` : request.coverPayment && !request.coverPayment.confirmedAt ? ' Cover payment sent — they will confirm it.' : '';
    switch (request.status) {
      case 'booked': return { title: 'Send your parcel to the warehouse', body: `Write ${request.number} on the box, then tell them it is on its way. You pay once it is weighed at the destination.${cover}` };
      case 'sent_in': return { title: 'On its way to the warehouse', body: `They will tell you when it arrives.${cover}` };
      case 'received': return { title: 'At the origin warehouse', body: `It flies out with the next batch.${cover}` };
      case 'in_progress': return { title: 'In transit', body: 'They weigh it when it lands and send you the bill with a photo of the scale.' };
      case 'billed': return request.payment && !request.payment.confirmedAt
        ? { title: 'Payment sent — waiting for them to confirm', body: `You said you paid ${formatMoney(request.payment.amountMinor)}${request.payment.reference ? ` (ref ${request.payment.reference})` : ''}.` }
        : { title: `Arrived — pay ${formatMoney(view.due)} to get it delivered`, body: 'Check the weight, the photo and where it is delivered below — change the address now if it needs to go somewhere else. Questions? Ask in their channel before paying.' };
      case 'paid': return { title: 'Paid — delivering soon', body: 'They hand it to a courier next and send you the tracking number.' };
      default: break;
    }
  }
  switch (request.status) {
    case 'submitted': return { title: 'Waiting for a quote', body: 'The team checks your details and replies with the final price.' };
    case 'quoted': return { title: request.customerId ? 'Your quote is ready' : 'Pay for this', body: `${formatMoney(view.due)}${request.turnaroundDays ? ` · about ${request.turnaroundDays} days` : ''}. Accept to go ahead.` };
    case 'accepted': return request.payment && !request.payment.confirmedAt
      ? { title: 'Payment sent — waiting for them to confirm', body: `You said you paid ${formatMoney(request.payment.amountMinor)}${request.payment.reference ? ` (ref ${request.payment.reference})` : ''}.` }
      : { title: 'Pay them direct', body: view.payTo ? 'Pay to the details below, then tell them with the reference.' : 'They will send payment details in their channel or by message.' };
    case 'paid': return { title: `Send your ${goods}`, body: request.kind === 'forwarder' ? `Write ${request.number} on the parcel.` : `Pack it well and put ${request.number} inside the box.` };
    case 'received': return { title: request.kind === 'forwarder' ? 'At the warehouse' : 'Arrived at the studio' };
    case 'in_progress': return { title: request.kind === 'forwarder' ? 'On its way to India' : 'Being worked on' };
    case 'shipped': return { title: 'On its way to you', body: 'Tell them once you have it.' };
    case 'delivered': return request.review ? { title: 'Done — thank you for rating it' } : { title: 'Done. How was it?', body: 'Your rating is what this store’s level is made of.' };
    case 'declined': return { title: 'They could not take this one' };
    case 'cancelled': return { title: 'Cancelled' };
    default: return { title: statusLabel(request).label };
  }
}
