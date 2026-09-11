import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CONDITION_TAGS, SOURCING_LABELS, type Sourcing } from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import type { Lot } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { NewLotDialog } from '../components/LotFields';
import { EmptyState, ErrorNotice, Icon, Thumb } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';

/**
 * How the item is being sold, which is the same question as where it is.
 *
 * Every import travels in a lot: the lot is what carries the stages a buyer
 * waits on, so an imported item outside one has no tracking to give them.
 * Anything not in a lot is stock already on the shelf.
 */
type Shape = 'single' | 'lot';

/**
 * List something.
 *
 * Deliberately one screen rather than a wizard: the whole point of the Xianyu
 * pattern is that listing is a two-minute job, not a form to be endured. The
 * live preview on the right is the same card the feed renders.
 */
export function SellPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  // Which shop this goes into. The sell tab passes it when a store is open, so
  // a manager lists into the shop they were looking at rather than their own.
  const [params] = useSearchParams();
  const storeId = params.get('store') ?? undefined;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<string>(CATEGORIES[0]!);
  const [condition, setCondition] = useState<string>(CONDITION_TAGS[0]);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [bundle, setBundle] = useState(false);
  const [preOrderMode, setPreOrderMode] = useState(false);
  const [fillThreshold, setFillThreshold] = useState('20');
  const [cutoffDays, setCutoffDays] = useState('14');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [shape, setShape] = useState<Shape>('single');
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotId, setLotId] = useState('');
  const [creatingLot, setCreatingLot] = useState(false);

  // The seller's open batches, so an item can be filed as it is listed rather
  // than published first and tidied up afterwards.
  useEffect(() => {
    let cancelled = false;
    void api
      .myLots()
      .then((result) => {
        if (cancelled) return;
        const open = result.lots.map((entry) => entry.lot).filter((lot) => lot.status === 'open');
        setLots(open);
        setLotId((current) => current || (open[0]?.id ?? ''));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function lotCreated(lot: Lot) {
    setLots((current) => [lot, ...current]);
    setLotId(lot.id);
    setShape('lot');
    setCreatingLot(false);
  }

  const priceMinor = Math.round(Number(price || 0) * 100);
  // A lot listing needs a lot; there is nothing to publish into otherwise.
  const canPublish = title.trim().length > 2 && priceMinor > 0 && (shape === 'single' || lotId !== '');
  // The lot is the answer: in one means import, out of one means in hand.
  const effectiveSourcing: Sourcing = shape === 'lot' ? 'import' : 'in_hand';

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.createListing({
        title: title.trim(),
        description: description.trim(),
        category,
        condition,
        priceMinor,
        quantityAvailable: Math.max(1, Number(quantity) || 1),
        bundle,
        preOrder: preOrderMode
          ? {
              fillThreshold: Math.max(2, Number(fillThreshold) || 2),
              cutoffAt: new Date(Date.now() + (Number(cutoffDays) || 14) * 86_400_000).toISOString(),
            }
          : null,
        sourcing: effectiveSourcing,
        lotId: shape === 'lot' ? lotId : null,
        ...(storeId ? { storeId } : {}),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      navigate(`/listing/${result.listing.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not publish this listing.');
    } finally {
      setBusy(false);
    }
  }

  // Items are listed from a shop. Say so here rather than letting the form be
  // filled in and refused on publish.
  if (!storeId && user && user.sellerProfile === null) {
    return (
      <main className="page tab-view">
        <div className="page__head">
          <div>
            <h1>Sell something</h1>
            <p className="muted">Every item is listed from a storefront.</p>
          </div>
        </div>
        <EmptyState title="You need a storefront first">
          It takes a minute: a username, a name buyers follow, and a line about what you sell. Everything
          you list afterwards goes out under it.
        </EmptyState>
        <Link to="/shop" className="btn btn--lg" style={{ justifySelf: 'start', marginTop: 16 }}>
          Open a storefront
        </Link>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Sell something</h1>
          <p className="muted">Takes about a minute. You can edit or remove it afterwards.</p>
        </div>
      </div>

      {/* Verification is friction, not a wall: it gates value, not listing. */}
      {user && user.verification.governmentId !== 'verified' && (
        <p className="notice notice--info" style={{ marginBottom: 20 }}>
          Verifying your ID unlocks higher-value listings and payouts — you can do that any time.
        </p>
      )}

      <div className="detail">
        <form className="form" onSubmit={publish}>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="1/7 scale figure, sealed" required />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Condition, what's included, where it ships from…" />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
              </select>
              <span className="field__hint">
                Fixed on purpose: one catalog where three sellers type three spellings of the same
                thing is three categories with a third of the stock each.
              </span>
            </label>
            <label className="field">
              <span>Condition</span>
              <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
              </select>
            </label>
          </div>

          {/* A job lot is a different thing to buy from one named item, and the
              people who want one rarely want the other - so buyers can filter
              it out, which only works if sellers can say it. */}
          <label className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
            <input type="checkbox" checked={bundle} onChange={(e) => setBundle(e.target.checked)}
              style={{ marginTop: 3 }} />
            <span>
              <span style={{ fontSize: 'var(--t-sm)' }}>Sold as one mixed lot</span>
              <span className="field__hint" style={{ display: 'block' }}>
                An assorted bundle — a shelf clearance, a box of blind-box figures, loose parts —
                rather than a single named item.
              </span>
            </span>
          </label>

          <div className="field-row">
            <label className="field">
              <span>Price (₹)</span>
              <input type="number" min="1" step="1" value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="1450" required />
            </label>
            <label className="field">
              <span>Quantity</span>
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="resin, scale, sealed" />
            <span className="field__hint">Comma separated. Helps buyers find it in search.</span>
          </label>

          <div className="card card--pad stack">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={preOrderMode} onChange={(e) => setPreOrderMode(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>Take pre-orders</div>
                <span className="field__hint">
                  Buyers book ahead and you only commit the cash once enough units are spoken for. Nothing
                  ships until you place the order.
                </span>
              </div>
            </label>

            {preOrderMode && (
              <div className="field-row">
                <label className="field">
                  <span>Units needed</span>
                  <input type="number" min="2" value={fillThreshold} onChange={(e) => setFillThreshold(e.target.value)} />
                </label>
                <label className="field">
                  <span>Booking window (days)</span>
                  <input type="number" min="1" value={cutoffDays} onChange={(e) => setCutoffDays(e.target.value)} />
                </label>
              </div>
            )}
          </div>

          <div className="card card--pad stack">
            <div>
              <div style={{ fontWeight: 600 }}>How are you selling this?</div>
              <span className="field__hint">
                Every imported item travels in a lot — that is what produces the tracking buyers follow.
                They never see the lot itself, only the stages it moves through.
              </span>
            </div>

            <div className="seg" role="radiogroup" aria-label="How are you selling this?">
              <button type="button" role="radio" aria-checked={shape === 'single'}
                className={shape === 'single' ? 'is-on' : ''} onClick={() => setShape('single')}>
                In hand
              </button>
              <button type="button" role="radio" aria-checked={shape === 'lot'}
                className={shape === 'lot' ? 'is-on' : ''} onClick={() => setShape('lot')}>
                Import — in a lot
              </button>
            </div>

            {shape === 'single' ? (
              <p className="field__hint">
                Ships from your shelf. Buyers see <strong>{SOURCING_LABELS.in_hand}</strong> and expect it to go
                out straight away.
              </p>
            ) : (
              <label className="field">
                <span>Lot</span>
                {lots.length > 0 ? (
                  <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                    {lots.map((lot) => (
                      <option key={lot.id} value={lot.id}>
                        {lot.name}{lot.origin ? ` — ${lot.origin}` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="field__hint">
                    You have no open lots yet. Every imported item travels in one, so create a lot and this
                    item goes straight into it.
                  </span>
                )}
                <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start', marginTop: 8 }}
                  onClick={() => setCreatingLot(true)}>
                  <Icon name="plus" size={14} /> New lot
                </button>
              </label>
            )}
          </div>

          {error && <ErrorNotice message={error} />}

          <button type="submit" className="btn btn--lg" disabled={busy || !canPublish}>
            {busy ? 'Publishing…' : 'Publish listing'}
          </button>
        </form>

        <aside className="stack">
          <span className="muted">Preview</span>
          <div className="card" style={{ maxWidth: 280 }}>
            <Thumb seed={title || 'preview'} label={title || 'Your listing'}>
              <div className="thumb__badges">
                <span className="badge badge--solid">{condition}</span>
                {preOrderMode && <span className="badge badge--accent">Pre-order</span>}
              </div>
            </Thumb>
            <div className="listing__body">
              <span className="listing__title">{title || 'Your listing title'}</span>
              <span className="listing__price">{priceMinor > 0 ? formatMoney(priceMinor) : '₹—'}</span>
              <div className="listing__meta">
                <span className="badge">{SOURCING_LABELS[effectiveSourcing]}</span>
                <span className="badge">{category}</span>
              </div>
              <div className="listing__foot">
                <span className="faint">{user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'You'}</span>
              </div>
            </div>
          </div>
          <p className="faint">
            Photo upload lands with blob storage. Until then listings use a generated placeholder.
          </p>
        </aside>
      </div>

      {creatingLot && <NewLotDialog onCreated={lotCreated} onCancel={() => setCreatingLot(false)} />}
    </main>
  );
}
