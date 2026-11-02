import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StoreKind } from '@shared/service-stores';
import { REQUEST_LABELS } from '@shared/service-work';
import { ApiRequestError, api, type RequestView, type TeamRow } from '../api';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, Icon } from '../components/ui';
import { formatMoney } from '../format';
import { StoreMark, accentStyle } from '../components/StoreKit';
import { AnswerList, RequestActions, RequestBadge, RequestLog, RequestProgress, Stars } from '../components/ServiceWorkKit';
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
  const status = REQUEST_LABELS[request.kind][request.status];
  const isLink = request.origin === 'link';
  const next = nextStep(view);

  return (
    <main className="page srq-page" style={accentStyle(store.accent)}>
      <BackLink to="/services/mine">{request.number}</BackLink>
      {params.get('sent') && request.status === 'submitted' && (
        <p className="srq-sent"><Icon name="check" size={15} /> Sent. Everyone on {store.name}’s team has been told — you will hear here when they quote.</p>
      )}
      <section className="srq-head">
        <Link to={`/services/${request.kind}/${store.slug}`} className="srq-head__store">
          <StoreMark name={store.name} logoUrl={store.logoUrl} accent={store.accent} size={44} />
          <span><b>{store.name}</b><span className="faint">{isLink ? 'Payment link' : request.kind === 'forwarder' ? 'Shipping request' : 'Commission'} · {request.number}</span></span>
        </Link>
        <h1>{isLink ? request.title : request.subject?.label}</h1>
        <div className="srq-head__status"><RequestBadge kind={request.kind} status={request.status} /><RequestProgress status={request.status} /></div>
        <div className="srq-money">
          <span><span className="faint">{request.quoteMinor !== null ? 'Price' : 'Estimate'}</span><b>{formatMoney(view.due)}</b></span>
          {request.turnaroundDays && <span><span className="faint">Time</span><b>{request.turnaroundDays} days</b></span>}
          {request.chargeableKg ? <span><span className="faint">Billed weight</span><b>{request.chargeableKg} kg</b></span> : null}
          {request.plan && <span><span className="faint">Cover</span><b>{request.plan.name}</b></span>}
        </div>
      </section>

      <div className="srq-layout">
        <div className="stack">
          <section className={`srq-next srq-next--${status.tone}`}>
            <h2>{next.title}</h2>
            {next.body && <p>{next.body}</p>}
            {request.quoteNote && request.status === 'quoted' && <blockquote>“{request.quoteNote}”</blockquote>}
            {view.payTo && request.status === 'accepted' && (
              <dl className="srq-pay">
                {view.payTo.upiId && <div><dt>UPI</dt><dd>{view.payTo.upiId}</dd></div>}
                {view.payTo.accountName && <div><dt>Name</dt><dd>{view.payTo.accountName}</dd></div>}
                {view.payTo.accountNumber && <div><dt>Account</dt><dd>{view.payTo.accountNumber}</dd></div>}
                {view.payTo.ifsc && <div><dt>IFSC</dt><dd>{view.payTo.ifsc}</dd></div>}
                {view.payTo.instructions && <div><dt>Note</dt><dd>{view.payTo.instructions}</dd></div>}
                <div><dt>Amount</dt><dd><b>{formatMoney(view.due)}</b> · quote {request.number}</dd></div>
              </dl>
            )}
            {view.sendTo?.address && ['paid', 'received'].includes(request.status) && (
              <div className="srq-address"><span className="faint">{request.kind === 'forwarder' ? 'Warehouse' : 'Studio'}</span><p>{view.sendTo.address}</p>
                {view.sendTo.contact && <span className="faint">{view.sendTo.contact}</span>}</div>
            )}
            {request.tracking && <p className="srq-track"><Icon name="truck" size={15} /> {request.tracking.courier} <b>{request.tracking.awb}</b></p>}
            <RequestActions view={view} onChanged={(changed) => setView({ ...view, ...changed })} />
            {request.review && <p className="srq-rated"><Stars value={request.review.stars} /> {request.review.text}</p>}
          </section>

          {isLink && request.description && <section className="srq-sec"><h2>What it is for</h2><p className="srq-text">{request.description}</p></section>}
          {request.fields.length > 0 && (
            <section className="srq-sec">
              <h2>What you sent</h2>
              {request.option && <p className="faint">Price picked: {request.option.name}</p>}
              <AnswerList fields={request.fields} answers={request.answers} />
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
  }
}
