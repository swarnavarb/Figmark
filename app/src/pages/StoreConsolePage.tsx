import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { StoreRight } from '@shared/models';
import {
  ARTIST_JOB_FLOW, ARTIST_JOB_LABELS, STORE_KINDS, STORE_KIND_LABELS, STORE_RIGHTS, STORE_RIGHT_LABELS,
  applicationGaps, jobDueMinor, liveLanes, livePlans, type StoreKind,
} from '@shared/service-stores';
import {
  ApiRequestError, api, type ArtistJobRow, type ForwarderLotRow, type StoreConsole, type StoreDraft, type StoreWork,
} from '../api';
import { useSession } from '../session';
import { BackLink } from '../components/ScrollManager';
import { EmptyState, ErrorNotice, Icon } from '../components/ui';
import { formatDate, formatMoney, formatWeight, timeAgo } from '../format';
import { MoneyInput, Picture, StatTile, StatusPill, StoreCover, StoreMark, accentStyle } from '../components/StoreKit';
import {
  BasicsSection, BusinessSection, CoverSection, LanesSection, MenuSection, PortfolioSection, WarehouseSection,
  type SectionProps,
} from '../components/StoreForm';
import { Timeline } from './StoreApplyPage';

/**
 * A service store, from the inside.
 *
 * Four tabs, in the order a working day needs them: what is going on, the
 * work itself, the shopfront, and the people. Each one shows only to a member
 * holding the right it needs - a packer who can press buttons should not be
 * staring at a rate card they cannot change.
 */

type Tab = 'overview' | 'work' | 'store' | 'team';

export function StoreConsolePage() {
  const { kind: rawKind, ownerId: rawOwner } = useParams<{ kind: string; ownerId?: string }>();
  const kind = (STORE_KINDS as readonly string[]).includes(rawKind ?? '') ? (rawKind as StoreKind) : null;
  const { user } = useSession();
  const ownerId = rawOwner || user?.id || '';
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab | null) ?? 'overview';

  const [console, setConsole] = useState<StoreConsole | null>(null);
  const [work, setWork] = useState<StoreWork | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!kind || !ownerId) return;
    try {
      const view = await api.storeConsole(kind, ownerId);
      setConsole(view);
      if (view.status === 'approved' && view.rights.includes('work')) setWork(await api.storeWork(kind, ownerId));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the store.');
    }
  }, [kind, ownerId]);

  useEffect(() => {
    if (user) void load();
  }, [load, user]);

  if (!kind) return <main className="page"><EmptyState icon="◌" title="No such store" /></main>;
  if (!user) return <main className="page"><EmptyState icon="◍" title="Sign in to open your store"><Link to="/" className="btn">Sign in</Link></EmptyState></main>;
  if (error && !console) {
    return (
      <main className="page">
        <BackLink to="/services/mine">← My services</BackLink>
        <EmptyState icon={<Icon name="lock" size={26} />} title="Not your store">
          {error} <Link to={`/services/apply/${kind}`}>Apply for one</Link>
        </EmptyState>
      </main>
    );
  }
  if (!console) return <main className="page"><p className="muted">Loading…</p></main>;

  const store = console.store;
  const live = console.status === 'approved';
  const tabs: { id: Tab; label: string; show: boolean; count?: number }[] = [
    { id: 'overview', label: 'Overview', show: true },
    { id: 'work', label: kind === 'forwarder' ? 'Lots' : 'Commissions', show: live && console.rights.includes('work'),
      count: kind === 'forwarder' ? work?.lots.filter((row) => row.acceptance === 'pending').length : work?.jobs.filter((row) => row.actions.length > 0).length },
    { id: 'store', label: 'Store', show: console.rights.includes('store') },
    { id: 'team', label: 'Team', show: true },
  ];
  const go = (next: Tab) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('tab', next); return copy; }, { replace: true });

  return (
    <main className="page sc-page" style={accentStyle(store.accent)}>
      <BackLink to="/services/mine">← My services</BackLink>
      <section className="sc-hero">
        <StoreCover kind={kind} coverUrl={store.coverUrl} accent={store.accent}>
          <div className="sc-hero__actions">
            {live && <Link to={`/services/${kind}/${store.directorySlug}`} className="btn btn--ghost btn--sm"><Icon name="external" size={14} /> Public page</Link>}
          </div>
        </StoreCover>
        <div className="sc-hero__id">
          <StoreMark name={store.companyName} logoUrl={store.logoUrl} accent={store.accent} size={72} />
          <div className="sc-hero__text">
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <h1>{store.companyName}</h1>
              <StatusPill status={console.status} />
            </div>
            <span className="muted">{store.tagline || STORE_KIND_LABELS[kind].store}</span>
            <span className="faint">
              {console.isOwner ? 'You own this store' : `Member · ${console.rights.map((right) => STORE_RIGHT_LABELS[right].label.toLowerCase()).join(', ')}`}
            </span>
          </div>
        </div>
      </section>

      <div className="tabs sc-tabs">
        {tabs.filter((entry) => entry.show).map((entry) => (
          <button key={entry.id} type="button" className={`tab${tab === entry.id ? ' is-on' : ''}`} onClick={() => go(entry.id)}>
            {entry.label}{entry.count ? <span className="sc-tabs__count">{entry.count}</span> : null}
          </button>
        ))}
      </div>

      {error && <ErrorNotice message={error} />}

      {tab === 'overview' && <Overview kind={kind} console={console} work={work} onGo={go} />}
      {tab === 'work' && work && (kind === 'forwarder'
        ? <ForwarderLots ownerId={ownerId} rows={work.lots} onChanged={load} />
        : <CommissionBoard ownerId={ownerId} rows={work.jobs} onChanged={load} />)}
      {tab === 'store' && <StoreEditor kind={kind} console={console} onSaved={setConsole} />}
      {tab === 'team' && <TeamPanel kind={kind} console={console} onSaved={setConsole} />}
    </main>
  );
}

/* ── Overview ────────────────────────────────────────────────────────── */

function Overview({ kind, console, work, onGo }: { kind: StoreKind; console: StoreConsole; work: StoreWork | null; onGo: (tab: Tab) => void }) {
  const store = console.store;
  const history = store.application?.history ?? [];
  const decision = [...history].reverse().find((event) => event.status !== 'pending');

  if (console.status !== 'approved') {
    return (
      <div className="stack">
        <div className={`sc-banner sc-banner--${console.status}`}>
          <StatusPill status={console.status} />
          <p>
            {console.status === 'pending' && 'Your application is with Figmark. Nothing is public yet — you can still edit it.'}
            {console.status === 'changes' && `Figmark asked for changes: “${decision?.note ?? ''}”`}
            {console.status === 'rejected' && `Not approved: “${decision?.note ?? ''}”`}
            {console.status === 'suspended' && `Suspended: “${decision?.note ?? ''}” Your store is hidden and cannot take work.`}
          </p>
          {console.isOwner && console.status !== 'suspended' && (
            <Link to={`/services/apply/${kind}`} className="btn btn--sm">{console.status === 'pending' ? 'View application' : 'Fix and resend'}</Link>
          )}
        </div>
        <Timeline history={history} />
      </div>
    );
  }

  if (kind === 'forwarder') {
    const lots = work?.lots ?? [];
    const taken = lots.filter((row) => row.acceptance === 'accepted');
    const pending = lots.filter((row) => row.acceptance === 'pending');
    return (
      <div className="stack">
        <div className="sc-stats">
          <StatTile value={pending.length} label="Requests" tone={pending.length ? 'warn' : undefined} />
          <StatTile value={taken.filter((row) => row.lot.status !== 'closed').length} label="Lots on" tone="accent" />
          <StatTile value={formatWeight(taken.reduce((sum, row) => sum + row.weightGrams, 0))} label="Booked weight" />
          <StatTile value={formatMoney(lots.reduce((sum, row) => sum + row.premiumsMinor, 0))} label="Cover sold" tone="ok" />
        </div>
        {pending.length > 0 && (
          <button type="button" className="sc-callout" onClick={() => onGo('work')}>
            <span className="sc-callout__ping">{pending.length}</span>
            <span><b>{pending.length === 1 ? 'A shop wants' : `${pending.length} shops want`} you on a lot.</b> Accept or decline to start.</span>
            <Icon name="right" size={16} />
          </button>
        )}
        <div className="sc-glance">
          <Glance title="Lanes on sale" value={liveLanes(store).length} onClick={() => onGo('store')} />
          <Glance title="Cover plans" value={livePlans(store).length} onClick={() => onGo('store')} />
          <Glance title="Bookings" value={store.autoAccept === false ? 'You approve each' : 'Auto-accepted'} onClick={() => onGo('store')} />
          <Glance title="Team" value={`${1 + (store.team?.length ?? 0)} people`} onClick={() => onGo('team')} />
        </div>
      </div>
    );
  }

  const jobs = work?.jobs ?? [];
  const live = jobs.filter((row) => !['completed', 'declined', 'cancelled'].includes(row.job.status));
  return (
    <div className="stack">
      <div className="sc-stats">
        <StatTile value={jobs.filter((row) => row.actions.length > 0).length} label="Need you" tone={jobs.some((row) => row.actions.length) ? 'warn' : undefined} />
        <StatTile value={live.length} label="In progress" tone="accent" />
        <StatTile value={jobs.filter((row) => row.job.status === 'completed').length} label="Completed" tone="ok" />
        <StatTile value={formatMoney(jobs.filter((row) => row.job.payments.some((p) => p.confirmedAt)).reduce((sum, row) => sum + (row.job.quoteMinor ?? 0), 0))} label="Booked" />
      </div>
      <div className="sc-glance">
        <Glance title="On the menu" value={(store.offerings ?? []).filter((row) => row.active).length} onClick={() => onGo('store')} />
        <Glance title="Portfolio" value={`${(store.portfolio ?? []).length} pieces`} onClick={() => onGo('store')} />
        <Glance title="Commissions" value={store.acceptingWork === false ? 'Closed' : 'Open'} onClick={() => onGo('store')} />
        <Glance title="Team" value={`${1 + (store.team?.length ?? 0)} people`} onClick={() => onGo('team')} />
      </div>
    </div>
  );
}

function Glance({ title, value, onClick }: { title: string; value: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="sc-glance__cell" onClick={onClick}>
      <span className="faint">{title}</span>
      <b>{value}</b>
    </button>
  );
}

/* ── Forwarder: lots ─────────────────────────────────────────────────── */

function ForwarderLots({ ownerId, rows, onChanged }: { ownerId: string; rows: ForwarderLotRow[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = rows.filter((row) => row.acceptance === 'pending');
  const taken = rows.filter((row) => row.acceptance === 'accepted');
  const declined = rows.filter((row) => row.acceptance === 'declined');

  async function respond(row: ForwarderLotRow, accept: boolean) {
    setBusy(row.lot.id);
    setError(null);
    try {
      await api.respondToLot(ownerId, { sellerId: row.lot.sellerId, lotId: row.lot.id, accept });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(null);
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState icon={<Icon name="plane" size={26} />} title="No lots yet">
        When a shop books you on a lot it lands here, with its weight and the lane it picked.
      </EmptyState>
    );
  }

  return (
    <div className="stack">
      {error && <ErrorNotice message={error} />}
      {pending.length > 0 && <h3 className="sc-sub">Waiting for your answer</h3>}
      {pending.map((row) => (
        <article key={row.lot.id} className="sc-lot sc-lot--pending">
          <LotHead row={row} />
          <div className="sc-lot__acts">
            <button type="button" className="btn" disabled={busy === row.lot.id} onClick={() => void respond(row, true)}>
              <Icon name="check" size={14} /> Accept lot
            </button>
            <button type="button" className="btn btn--ghost" disabled={busy === row.lot.id} onClick={() => void respond(row, false)}>Decline</button>
          </div>
        </article>
      ))}
      {taken.length > 0 && <h3 className="sc-sub">On the move</h3>}
      {taken.map((row) => (
        <Link key={row.lot.id} to={`/services/crew/${row.lot.sellerId}/${row.lot.id}?role=forwarder`} className="sc-lot sc-lot--tap">
          <LotHead row={row} />
          <span className="sc-lot__go">Work this lot <Icon name="right" size={14} /></span>
        </Link>
      ))}
      {declined.length > 0 && (
        <details className="sc-declined">
          <summary>{declined.length} declined</summary>
          {declined.map((row) => <div key={row.lot.id} className="sc-lot sc-lot--off"><LotHead row={row} /></div>)}
        </details>
      )}
    </div>
  );
}

function LotHead({ row }: { row: ForwarderLotRow }) {
  const progress = row.lot.steps > 1 ? Math.max(0, row.lot.stepIndex) / (row.lot.steps - 1) : 0;
  return (
    <>
      <span className="sc-lot__top">
        <span className="sc-lot__name">{row.lot.name} <span className="faint">{row.lot.number}</span></span>
        <span className="faint">{row.store.name}</span>
      </span>
      {row.laneLabel && <span className="sc-lot__lane"><Icon name="plane" size={13} /> {row.laneLabel}</span>}
      <span className="ms-crew__bar" aria-hidden="true"><span style={{ width: `${Math.round(progress * 100)}%` }} /></span>
      <span className="sc-lot__stats">
        <span><b>{row.pieces}</b> pieces</span>
        <span><b>{formatWeight(row.weightGrams)}</b></span>
        <span className={row.covered ? 'sc-lot__cov' : ''}>🛡 <b>{row.covered}</b> insured{row.premiumsMinor ? ` · ${formatMoney(row.premiumsMinor)}` : ''}</span>
        <span className="faint">{row.lot.step}</span>
      </span>
    </>
  );
}

/* ── Artist: commissions ─────────────────────────────────────────────── */

function CommissionBoard({ ownerId, rows, onChanged }: { ownerId: string; rows: ArtistJobRow[]; onChanged: () => Promise<void> }) {
  const groups: { title: string; rows: ArtistJobRow[] }[] = [
    { title: 'Needs you', rows: rows.filter((row) => row.actions.length > 0) },
    { title: 'Waiting on the buyer', rows: rows.filter((row) => row.actions.length === 0 && ['quoted', 'accepted', 'shipped', 'ready'].includes(row.job.status)) },
    { title: 'Finished', rows: rows.filter((row) => ['completed', 'declined', 'cancelled'].includes(row.job.status)) },
  ];
  if (rows.length === 0) {
    return (
      <EmptyState icon={<Icon name="spark" size={26} />} title="No commissions yet">
        Buyers commission you from an order. Each one lands here to quote.
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      {groups.filter((group) => group.rows.length > 0).map((group) => (
        <section key={group.title} className="stack">
          <h3 className="sc-sub">{group.title} <span className="faint">{group.rows.length}</span></h3>
          {group.rows.map((row) => <JobCard key={row.orderId} ownerId={ownerId} row={row} onChanged={onChanged} />)}
        </section>
      ))}
    </div>
  );
}

function JobProgress({ status }: { status: string }) {
  const at = ARTIST_JOB_FLOW.indexOf(status as typeof ARTIST_JOB_FLOW[number]);
  return (
    <span className="sc-flow" aria-hidden="true">
      {ARTIST_JOB_FLOW.map((step, index) => <span key={step} className={index <= at ? 'is-on' : ''} />)}
    </span>
  );
}

function JobCard({ ownerId, row, onChanged }: { ownerId: string; row: ArtistJobRow; onChanged: () => Promise<void> }) {
  const { job } = row;
  const [open, setOpen] = useState(row.actions.length > 0);
  const [quote, setQuote] = useState(job.quoteMinor ?? 0);
  const [days, setDays] = useState(String(job.turnaroundDays ?? ''));
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState('');
  const [courier, setCourier] = useState('');
  const [awb, setAwb] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = ARTIST_JOB_LABELS[job.status];

  async function act(event: FormEvent | null, action: ArtistJobRow['actions'][number]) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.artistAct(ownerId, row.orderId, {
        action, quoteMinor: quote, days: Number(days) || undefined, note: note || undefined,
        photos: photo ? [photo] : undefined, courier, awb,
      });
      setNote('');
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className={`sc-job sc-job--${label.tone}`}>
      <button type="button" className="sc-job__head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="sc-job__title">
          <span className="sc-job__item">{row.item.name}</span>
          <span className="faint">{job.offeringName} · for {row.buyer.name}{row.shop ? ` · bought from ${row.shop.name}` : ''}</span>
        </span>
        <span className={`badge badge--${label.tone === 'quiet' ? 'quiet' : label.tone}`}>{label.label}</span>
      </button>
      <JobProgress status={job.status} />
      {open && (
        <div className="sc-job__body stack">
          <blockquote className="sc-job__brief">{job.brief}</blockquote>
          {job.refUrls.length > 0 && (
            <div className="sc-job__refs">
              {job.refUrls.map((url) => <a key={url} href={url} target="_blank" rel="noreferrer"><Icon name="image" size={14} /> Reference</a>)}
            </div>
          )}
          <div className="sc-job__facts">
            {job.quoteMinor !== null && <span>Quote <b>{formatMoney(job.quoteMinor)}</b>{job.turnaroundDays ? ` · ${job.turnaroundDays} days` : ''}</span>}
            {job.method && <span>{job.method === 'protected' ? `🔒 Held by Figmark${job.managerName ? ` · ${job.managerName}` : ''}` : '↗ Paid direct'} · {formatMoney(jobDueMinor(job))}</span>}
            {job.payments.some((payment) => !payment.confirmedAt) && (
              <span className="sc-job__claim">Buyer says they paid {formatMoney(job.payments.find((p) => !p.confirmedAt)!.amountMinor)}
                {job.payments.find((p) => !p.confirmedAt)!.reference ? ` · ref ${job.payments.find((p) => !p.confirmedAt)!.reference}` : ''}</span>
            )}
          </div>

          {row.actions.includes('quote') && (
            <form className="sc-job__form" onSubmit={(event) => void act(event, 'quote')}>
              <label className="field"><span>Your price</span><MoneyInput label="Quote" value={quote} onChange={setQuote} /></label>
              <label className="field"><span>Days</span><input inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value)} /></label>
              <label className="field sc-job__wide"><span>Note to the buyer</span>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Includes priming and gloss coat. Ship it to me once paid." /></label>
              <div className="row sc-job__wide">
                <button type="submit" className="btn" disabled={busy || !quote}>{job.status === 'quoted' ? 'Update quote' : 'Send quote'}</button>
                {row.actions.includes('decline') && (
                  <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void act(null, 'decline')}>Decline</button>
                )}
              </div>
            </form>
          )}
          {row.actions.includes('confirm_payment') && (
            <button type="button" className="btn" disabled={busy} onClick={() => void act(null, 'confirm_payment')}>
              <Icon name="check" size={14} /> The money arrived
            </button>
          )}
          {row.actions.includes('start') && (
            <button type="button" className="btn" disabled={busy} onClick={() => void act(null, 'start')}>Piece is here — start work</button>
          )}
          {row.actions.includes('ready') && (
            <div className="sc-job__form">
              <label className="field sc-job__wide"><span>Photo of the finished piece (link)</span>
                <input value={photo} onChange={(e) => setPhoto(e.target.value)} placeholder="https://…" /></label>
              <button type="button" className="btn sc-job__wide" disabled={busy} onClick={() => void act(null, 'ready')}>Mark finished</button>
            </div>
          )}
          {row.actions.includes('ship') && (
            <div className="sc-job__form">
              <label className="field"><span>Courier</span><input value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="Delhivery" /></label>
              <label className="field"><span>AWB</span><input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="1234567890" /></label>
              <button type="button" className="btn sc-job__wide" disabled={busy} onClick={() => void act(null, 'ship')}>Shipped back to the buyer</button>
            </div>
          )}
          {job.photos.length > 0 && (
            <div className="sc-job__photos">{job.photos.map((url) => <Picture key={url} url={url} label="Finished" className="sk-pic" />)}</div>
          )}
          {error && <ErrorNotice message={error} />}
          <ol className="sc-job__log">
            {[...job.history].reverse().map((event, index) => (
              <li key={`${event.at}-${index}`}><span>{event.note}</span><span className="faint">{timeAgo(event.at)}</span></li>
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

/* ── Store editor ────────────────────────────────────────────────────── */

const SECTIONS: Record<StoreKind, { id: string; label: string; render: (props: SectionProps) => ReactNode }[]> = {
  forwarder: [
    { id: 'lanes', label: 'Lanes & rates', render: (p) => <LanesSection {...p} /> },
    { id: 'cover', label: 'Transit cover', render: (p) => <CoverSection {...p} /> },
    { id: 'warehouse', label: 'Warehouse & bookings', render: (p) => <WarehouseSection {...p} /> },
    { id: 'basics', label: 'Look & about', render: (p) => <BasicsSection {...p} /> },
    { id: 'business', label: 'Contact & links', render: (p) => <BusinessSection {...p} /> },
  ],
  artist: [
    { id: 'menu', label: 'Menu', render: (p) => <MenuSection {...p} /> },
    { id: 'portfolio', label: 'Portfolio & payment', render: (p) => <PortfolioSection {...p} /> },
    { id: 'basics', label: 'Look & about', render: (p) => <BasicsSection {...p} /> },
    { id: 'business', label: 'Contact & links', render: (p) => <BusinessSection {...p} /> },
  ],
};

function StoreEditor({ kind, console, onSaved }: { kind: StoreKind; console: StoreConsole; onSaved: (next: StoreConsole) => void }) {
  const [section, setSection] = useState(SECTIONS[kind][0]!.id);
  const [draft, setDraft] = useState<StoreDraft>({ ...console.store });
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<StoreDraft>) => { setDraft((current) => ({ ...current, ...patch })); setDirty(true); setSaved(false); };
  const gaps = applicationGaps(kind, draft);
  const current = SECTIONS[kind].find((entry) => entry.id === section)!;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const next = await api.saveStore(kind, console.ownerId, draft);
      onSaved(next);
      setDraft({ ...next.store });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sc-editor">
      <nav className="sc-editor__nav" aria-label="Store sections">
        {SECTIONS[kind].map((entry) => (
          <button key={entry.id} type="button" className={`sc-editor__link${entry.id === section ? ' is-on' : ''}`} onClick={() => setSection(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>
      <section className="sa-card">
        <div className="sa-card__head"><h2>{current.label}</h2>
          {console.status === 'approved' && <span className="muted">Changes go live the moment you save.</span>}
        </div>
        {current.render({ kind, draft, set })}
        {error && <ErrorNotice message={error} />}
        {console.status === 'approved' && gaps.length > 0 && <p className="faint">A live store still needs: {gaps.join(', ')}.</p>}
        <div className="sc-savebar">
          <span className="faint">{saved ? '✓ Saved' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
          <button type="button" className="btn" disabled={busy || !dirty} onClick={() => void save()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </section>
    </div>
  );
}

/* ── Team ────────────────────────────────────────────────────────────── */

function TeamPanel({ kind, console, onSaved }: { kind: StoreKind; console: StoreConsole; onSaved: (next: StoreConsole) => void }) {
  const [identifier, setIdentifier] = useState('');
  const [rights, setRights] = useState<StoreRight[]>(['work']);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manages = console.rights.includes('team');
  const team = console.store.team ?? [];

  async function run(body: Parameters<typeof api.storeTeam>[2]) {
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.storeTeam(kind, console.ownerId, body));
      setIdentifier('');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="sc-people">
        <div className="sc-person">
          <StoreMark name={console.ownerName} accent={console.store.accent} size={40} />
          <span className="sc-person__body">
            <b>{console.ownerName}</b>
            <span className="faint">Owner · everything</span>
          </span>
        </div>
        {team.map((member) => (
          <div key={member.userId} className="sc-person">
            <StoreMark name={member.displayName} accent={console.store.accent} size={40} />
            <span className="sc-person__body">
              <b>{member.displayName}</b>
              <span className="sc-person__rights">
                {member.rights.map((right) => <span key={right} className="ms-btnchip">{STORE_RIGHT_LABELS[right].label}</span>)}
              </span>
              <span className="faint">Added {formatDate(member.addedAt)}</span>
            </span>
            {manages && (
              <button type="button" className="btn btn--quiet btn--sm" disabled={busy} onClick={() => void run({ remove: member.userId })}>Remove</button>
            )}
          </div>
        ))}
      </div>
      {manages ? (
        <form className="sa-card stack" onSubmit={(event) => { event.preventDefault(); void run({ identifier, rights }); }}>
          <div className="sa-card__head">
            <h2>Add someone</h2>
            <span className="muted">They get this store under My services, with only what you tick.</span>
          </div>
          <label className="field"><span>Their @handle, email or phone</span>
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="@chen_ops" /></label>
          <div className="sc-rights">
            {STORE_RIGHTS.map((right) => (
              <label key={right} className={`sc-right${rights.includes(right) ? ' is-on' : ''}`}>
                <input type="checkbox" checked={rights.includes(right)}
                  onChange={(e) => setRights(e.target.checked ? [...rights, right] : rights.filter((row) => row !== right))} />
                <span><b>{STORE_RIGHT_LABELS[right].label}</b><span className="faint">{STORE_RIGHT_LABELS[right].hint}</span></span>
              </label>
            ))}
          </div>
          {error && <ErrorNotice message={error} />}
          <button type="submit" className="btn" disabled={busy || !identifier.trim() || rights.length === 0}>Add to the team</button>
        </form>
      ) : (
        <p className="faint">Only someone who can manage people adds or removes members.</p>
      )}
    </div>
  );
}
