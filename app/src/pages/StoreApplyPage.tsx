import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { STORE_KINDS, STORE_KIND_LABELS, applicationGaps, liveLanes, livePlans, liveOfferings, type StoreKind } from '@shared/service-stores';
import { ApiRequestError, api, type StoreDraft } from '../api';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatDate } from '../format';
import { LaneTicket, OfferingCard, PlanCard, PortfolioGrid, StatusPill, StoreCover, StoreMark, accentStyle } from '../components/StoreKit';
import {
  BasicsSection, BusinessSection, CoverSection, LanesSection, MenuSection, PortfolioSection, WarehouseSection,
  emptyLane, type SectionProps,
} from '../components/StoreForm';
import type { StoreReviewEvent, StoreStatus } from '@shared/models';

/**
 * Applying for a service store.
 *
 * A short wizard rather than one long form, because the forwarder's half -
 * lanes, rates, cover - is real work, and a person who has filled in their
 * name should see that they are a third of the way there rather than looking
 * at a scroll bar. Nothing is sent until the last step; the store preview
 * follows them the whole way so they can see what a shop will see.
 */

interface Step { id: string; title: string; hint: string; render: (props: SectionProps) => ReactNode }

const STEPS: Record<StoreKind, Step[]> = {
  forwarder: [
    { id: 'basics', title: 'Your company', hint: 'What shops see first.', render: (p) => <BasicsSection {...p} /> },
    { id: 'business', title: 'Business details', hint: 'For the reviewer, and for shops to reach you.', render: (p) => <BusinessSection {...p} /> },
    { id: 'lanes', title: 'Lanes & rates', hint: 'The routes you run, priced per kilo.', render: (p) => <LanesSection {...p} /> },
    { id: 'cover', title: 'Transit cover', hint: 'Insurance buyers can add to their item. Optional.', render: (p) => <CoverSection {...p} /> },
    { id: 'warehouse', title: 'Warehouse & bookings', hint: 'Where goods go, and how you take a lot.', render: (p) => <WarehouseSection {...p} /> },
  ],
  artist: [
    { id: 'basics', title: 'Your studio', hint: 'What buyers see first.', render: (p) => <BasicsSection {...p} /> },
    { id: 'business', title: 'Contact & links', hint: 'For the reviewer, and for buyers to find your work.', render: (p) => <BusinessSection {...p} /> },
    { id: 'menu', title: 'Your menu', hint: 'What you offer, and what it costs from.', render: (p) => <MenuSection {...p} /> },
    { id: 'portfolio', title: 'Portfolio & payment', hint: 'Your best work, and how buyers pay you.', render: (p) => <PortfolioSection {...p} /> },
  ],
};

function freshDraft(kind: StoreKind): StoreDraft {
  return kind === 'forwarder'
    ? { accent: 'aqua', country: 'China', lanes: [emptyLane()], insurance: [], autoAccept: true, links: [] }
    : { accent: 'pink', country: 'India', offerings: [], portfolio: [], specialties: [], acceptingWork: true, links: [] };
}

export function StoreApplyPage() {
  const { kind: raw } = useParams<{ kind: string }>();
  const kind = (STORE_KINDS as readonly string[]).includes(raw ?? '') ? (raw as StoreKind) : null;
  const { user } = useSession();
  const navigate = useNavigate();

  const [draft, setDraft] = useState<StoreDraft | null>(null);
  const [status, setStatus] = useState<StoreStatus | null>(null);
  const [history, setHistory] = useState<StoreReviewEvent[]>([]);
  const [at, setAt] = useState(0);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!kind || !user) return;
    let cancelled = false;
    void api.storeConsole(kind, user.id)
      .then((console) => {
        if (cancelled) return;
        setDraft({ ...console.store });
        setStatus(console.status);
        setHistory(console.store.application?.history ?? []);
      })
      .catch(() => !cancelled && setDraft(freshDraft(kind)));
    return () => { cancelled = true; };
  }, [kind, user]);

  const gaps = useMemo(() => (kind && draft ? applicationGaps(kind, draft) : []), [kind, draft]);

  if (!kind) {
    return <main className="page"><EmptyState icon="◌" title="No such store"><Link to="/services/mine">Back</Link></EmptyState></main>;
  }
  if (!user) {
    return <main className="page"><EmptyState icon="◍" title="Sign in to apply"><Link to="/" className="btn">Sign in</Link></EmptyState></main>;
  }
  if (!draft) return <main className="page"><p className="muted">Loading…</p></main>;

  if (status === 'approved' || status === 'suspended') {
    return (
      <main className="page">
        <EmptyState icon={<Icon name="check" size={26} />} title="Your store is open">
          <Link to={`/services/store/${kind}/${user.id}`} className="btn">Open the console</Link>
        </EmptyState>
      </main>
    );
  }

  const steps = STEPS[kind];
  const set = (patch: Partial<StoreDraft>) => setDraft((current) => ({ ...current!, ...patch }));
  const reviewing = at >= steps.length;
  const lastDecision = [...history].reverse().find((event) => event.status !== 'pending');

  async function submit() {
    if (!kind || !draft) return;
    setBusy(true);
    setError(null);
    try {
      await api.applyStore(kind, draft);
      setStatus('pending');
      setEditing(false);
      setHistory((current) => [...current, { at: new Date().toISOString(), by: user!.id, status: 'pending', note: status ? 'Sent back for review.' : 'Application sent.' }]);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not send.');
    } finally {
      setBusy(false);
    }
  }

  /* Sent and waiting: the receipt, not the form. */
  if (status === 'pending' && !editing) {
    return (
      <main className="page sa-page" style={accentStyle(draft.accent)}>
        <BackLink to="/services/mine">← My services</BackLink>
        <section className="sa-sent">
          <span className="sa-sent__seal" aria-hidden="true"><Icon name="send" size={26} /></span>
          <h1>Application sent</h1>
          <p className="muted">
            Figmark reads every {STORE_KIND_LABELS[kind].store.toLowerCase()} application by hand — usually within two
            working days. You will get a notification the moment it is decided.
          </p>
          <StatusPill status="pending" />
        </section>
        <Timeline history={history} />
        <div className="sa-sent__preview">
          <MiniStore kind={kind} draft={draft} />
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 18 }}>
          <button type="button" className="btn btn--ghost" onClick={() => { setEditing(true); setAt(0); }}>Edit application</button>
          <Link to="/services/mine" className="btn btn--quiet">Back to My services</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="page sa-page" style={accentStyle(draft.accent)}>
      <BackLink to="/services/mine">← My services</BackLink>
      <header className="sa-head">
        <span className="sa-head__eyebrow">{status ? 'Your application' : 'Apply'} · {STORE_KIND_LABELS[kind].store}</span>
        <h1>{kind === 'forwarder' ? 'Open your forwarding store' : 'Open your artist studio'}</h1>
        <p className="muted">
          {kind === 'forwarder'
            ? 'Shops book you on their lots, your team presses the buttons their route hands you, and their buyers can add your transit cover.'
            : 'Buyers commission you on pieces they bought here. You quote, they pay held or direct, and you ship the finished piece back.'}
        </p>
      </header>

      {lastDecision && (status === 'changes' || status === 'rejected') && (
        <div className={`sa-decision sa-decision--${status}`}>
          <StatusPill status={status} />
          <p>“{lastDecision.note}”</p>
          <span className="faint">Figmark · {formatDate(lastDecision.at)}</span>
        </div>
      )}

      <ol className="sa-steps" aria-label="Steps">
        {[...steps, { id: 'review', title: 'Review & send', hint: '' }].map((step, index) => (
          <li key={step.id}>
            <button type="button" className={`sa-step${index === at ? ' is-on' : ''}${index < at ? ' is-done' : ''}`}
              onClick={() => setAt(index)} aria-current={index === at ? 'step' : undefined}>
              <span className="sa-step__dot">{index < at ? <Icon name="check" size={12} /> : index + 1}</span>
              <span className="sa-step__title">{step.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className="sa-card">
        {!reviewing ? (
          <>
            <div className="sa-card__head">
              <h2>{steps[at]!.title}</h2>
              <span className="muted">{steps[at]!.hint}</span>
            </div>
            {steps[at]!.render({ kind, draft, set })}
          </>
        ) : (
          <>
            <div className="sa-card__head">
              <h2>Review & send</h2>
              <span className="muted">This is your store as shops and buyers will see it once it is approved.</span>
            </div>
            <MiniStore kind={kind} draft={draft} />
            {gaps.length > 0 ? (
              <div className="sa-gaps">
                <b>Before you can send it:</b>
                <ul>{gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
              </div>
            ) : (
              <div className="sa-ready"><Icon name="check" size={16} /> Everything a reviewer needs is here.</div>
            )}
          </>
        )}
        {error && <ErrorNotice message={error} />}
        <div className="sa-nav">
          <button type="button" className="btn btn--quiet" disabled={at === 0} onClick={() => setAt(at - 1)}>
            <Icon name="left" size={14} /> Back
          </button>
          <span className="sa-progress" aria-hidden="true">
            <span style={{ width: `${(Math.min(at, steps.length) / steps.length) * 100}%` }} />
          </span>
          {reviewing ? (
            <button type="button" className="btn btn--lg" disabled={busy || gaps.length > 0} onClick={() => void submit()}>
              {busy ? 'Sending…' : status ? 'Send for review again' : 'Send application'}
            </button>
          ) : (
            <button type="button" className="btn" onClick={() => setAt(at + 1)}>
              Next <Icon name="right" size={14} />
            </button>
          )}
        </div>
      </section>
      {status === 'pending' && (
        <p className="faint" style={{ textAlign: 'center', marginTop: 12 }}>
          Editing keeps your place in the queue. <button type="button" className="btn btn--quiet btn--sm" onClick={() => navigate(0)}>Discard changes</button>
        </p>
      )}
    </main>
  );
}

/** The store, compressed: hero, a few lanes or offerings, the cover. */
function MiniStore({ kind, draft }: { kind: StoreKind; draft: StoreDraft }) {
  const name = draft.companyName?.trim() || 'Your store';
  const lanes = liveLanes({ lanes: draft.lanes ?? [] }).filter((lane) => lane.originCity && lane.destinationCity);
  const plans = livePlans({ insurance: draft.insurance ?? [] });
  const offerings = liveOfferings({ offerings: draft.offerings ?? [] }).filter((row) => row.name);
  return (
    <div className="sa-mini" style={accentStyle(draft.accent)}>
      <StoreCover kind={kind} coverUrl={draft.coverUrl} accent={draft.accent} />
      <div className="sa-mini__id">
        <StoreMark name={name} logoUrl={draft.logoUrl} accent={draft.accent} size={64} />
        <div>
          <div className="sa-mini__name">{name}</div>
          <div className="muted">{draft.tagline}</div>
          <div className="faint">{[draft.city, draft.country].filter(Boolean).join(', ')}{draft.since ? ` · since ${draft.since}` : ''}</div>
        </div>
      </div>
      {draft.description && <p className="sa-mini__about">{draft.description}</p>}
      {kind === 'forwarder' ? (
        <div className="stack">
          {lanes.slice(0, 3).map((lane) => <LaneTicket key={lane.id} lane={lane} accent={draft.accent} />)}
          {plans.length > 0 && <div className="sa-mini__plans">{plans.map((plan) => <PlanCard key={plan.id} plan={plan} />)}</div>}
        </div>
      ) : (
        <div className="stack">
          <PortfolioGrid pieces={(draft.portfolio ?? []).slice(0, 5)} />
          <div className="sa-mini__menu">{offerings.slice(0, 4).map((row) => <OfferingCard key={row.id} offering={row} />)}</div>
        </div>
      )}
    </div>
  );
}

export function Timeline({ history }: { history: StoreReviewEvent[] }) {
  if (history.length === 0) return null;
  return (
    <ol className="sa-timeline">
      {history.map((event, index) => (
        <li key={`${event.at}-${index}`} className={`sa-timeline__row sa-timeline__row--${event.status}`}>
          <span className="sa-timeline__dot" aria-hidden="true" />
          <span className="sa-timeline__body">
            <StatusPill status={event.status} />
            <span>{event.note}</span>
            <span className="faint">{formatDate(event.at)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}
