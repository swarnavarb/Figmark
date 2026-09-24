import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { CONDITION_TAGS, SOURCING_LABELS, type Sourcing } from '@shared/enums';
import { CATEGORIES } from '@shared/catalog';
import type { Lot } from '@shared/models';
import type { SavedCalc } from '@shared/profit';
import type { RouteStep } from '@shared/routes';
import { fillFrom, type PostTemplate } from '@shared/templates';
import { PhotoManager } from '../components/PhotoManager';
import { ApiRequestError, api, type PhotoDraft } from '../api';
import { NewLotDialog } from '../components/LotFields';
import { EmptyState, ErrorNotice, Icon, Thumb } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';
import { TermsFields, termsBody, termsDraft } from '../components/Buy';
import { CostSheetField, type CostSheetDraft } from '../components/CostSheetField';
import { CalcIcon } from '../components/CalcIcon';
import { useGoBack } from '../components/ScrollManager';

/**
 * The template this browser used last.
 *
 * A convenience for one person at one keyboard, so it lives in their browser
 * rather than on their account: nothing else needs to know, and a shop's two
 * people may well list different things. Wrapped because storage throws in a
 * private window rather than returning null, and a listing screen that will
 * not open is a worse outcome than a dropdown that starts at the top.
 */
const LAST_TEMPLATE_KEY = 'figmark.lastTemplate';

function lastTemplate(): string | null {
  try {
    return window.localStorage.getItem(LAST_TEMPLATE_KEY);
  } catch {
    return null;
  }
}

function rememberTemplate(id: string): void {
  try {
    window.localStorage.setItem(LAST_TEMPLATE_KEY, id);
  } catch {
    /* A private window. The dropdown just starts at the top next time. */
  }
}

/**
 * How the item is being sold, which is the same question as where it is.
 *
 * Every import travels in a lot: the lot is what carries the stages a buyer
 * waits on, so an imported item outside one has no tracking to give them.
 * Anything not in a lot is stock already on the shelf.
 */
/**
 * What kind of thing is being listed.
 *
 * `waiting` is the one that was missing, and it is the common case in this
 * trade: an import sold before the run that will carry it has been opened. The
 * API has accepted it since routes landed - the form simply had no way to say
 * it, so every such item went up as a domestic sale and its buyer was shown a
 * three-step timeline for something crossing an ocean.
 */
type Shape = 'single' | 'waiting' | 'lot';

/**
 * List something.
 *
 * Deliberately one screen rather than a wizard: the whole point of the Xianyu
 * pattern is that listing is a two-minute job, not a form to be endured. The
 * live preview on the right is the same card the feed renders.
 */
const DRAFT_KEY = 'figmark:sell-draft';

type SellDraft = {
  title: string; description: string; category: string; condition: string; price: string;
  costSheet: CostSheetDraft | null; terms: ReturnType<typeof termsDraft>; bundle: boolean;
  shareToChannel: boolean; shareToFeed: boolean; preOrderMode: boolean; fillThreshold: string; cutoffDays: string;
  tags: string; calc: SavedCalc | null; quickPost: boolean; templateId: string; photos: PhotoDraft[];
  preLot: RouteStep[] | null; shape: Shape; lotId: string;
};

function readDraft(key: string): SellDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as SellDraft | null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: SellDraft) {
  try {
    sessionStorage.setItem(key, JSON.stringify(draft));
  } catch {
    /* A private window: the form just is not kept. */
  }
}

function clearDraft(key: string) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Nothing kept, nothing to clear. */
  }
}

export function SellPage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const goBack = useGoBack('/shop');
  // Which shop this goes into. The sell tab passes it when a store is open, so
  // a manager lists into the shop they were looking at rather than their own.
  const [params] = useSearchParams();
  const storeId = params.get('store') ?? undefined;
  // Arriving from the profit calculator's "List a new item": its selling price
  // and the costs it worked out come along.
  // A saved calculation also brings its name, where it should be shared, and
  // itself - marked with the item it became once this is published.
  const prefill = useLocation().state as {
    priceMinor?: number; costSheet?: CostSheetDraft; title?: string;
    share?: { channel: boolean; feed: boolean }; calc?: SavedCalc;
    quantity?: number; description?: string;
    /** A private deal, made from a chat: who it is for, and the chat to go back to. */
    privateDeal?: { userId: string; handle: string; displayName: string; as: string };
  } | null;
  const deal = prefill?.privateDeal ?? null;

  // What was typed here, kept against this visit - so leaving for the
  // calculator and coming back finds the form exactly as it was left.
  const location = useLocation();
  const draftKey = `${DRAFT_KEY}:${location.key}`;
  const [restored] = useState(() => readDraft(draftKey));

  const [title, setTitle] = useState(restored?.title ?? prefill?.title ?? '');
  const [description, setDescription] = useState(restored?.description ?? prefill?.description ?? '');
  const [category, setCategory] = useState<string>(restored?.category ?? CATEGORIES[0]!);
  const [condition, setCondition] = useState<string>(restored?.condition ?? CONDITION_TAGS[0]);
  const [price, setPrice] = useState(() => restored?.price ?? (prefill?.priceMinor ? String(prefill.priceMinor / 100) : ''));
  const [costSheet, setCostSheet] = useState<CostSheetDraft | null>(restored ? restored.costSheet : prefill?.costSheet ?? null);
  const [terms, setTerms] = useState(() => restored?.terms
    ?? termsDraft(prefill?.quantity ? { quantityAvailable: prefill.quantity } : undefined));
  const [bundle, setBundle] = useState(restored?.bundle ?? false);
  const [shareToChannel, setShareToChannel] = useState(restored?.shareToChannel ?? prefill?.share?.channel ?? true);
  const [shareToFeed, setShareToFeed] = useState(restored?.shareToFeed ?? prefill?.share?.feed ?? false);
  const [preOrderMode, setPreOrderMode] = useState(restored?.preOrderMode ?? false);
  const [fillThreshold, setFillThreshold] = useState(restored?.fillThreshold ?? '20');
  const [cutoffDays, setCutoffDays] = useState(restored?.cutoffDays ?? '14');
  const [tags, setTags] = useState(restored?.tags ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The saved calculation this listing is made from, marked with the item once it is published. */
  const [calc, setCalc] = useState<SavedCalc | null>(restored?.calc ?? prefill?.calc ?? null);
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);

  /* Quick Post is on by default and remembers the last template used, because
     a shop lists forty of the same kind of thing a month and typing the same
     category, tags and two lines each time is how a listing screen becomes a
     chore. Everything it fills in stays editable. */
  const [quickPost, setQuickPost] = useState(restored?.quickPost ?? true);
  const [templates, setTemplates] = useState<PostTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string>(() => restored?.templateId ?? lastTemplate() ?? '');
  const [photos, setPhotos] = useState<PhotoDraft[]>(restored?.photos ?? []);
  const [preLot, setPreLot] = useState<RouteStep[] | null>(restored?.preLot ?? null);
  const [shape, setShape] = useState<Shape>(restored?.shape ?? 'single');
  const [lots, setLots] = useState<Lot[]>([]);
  const [lotId, setLotId] = useState(restored?.lotId ?? '');

  useEffect(() => {
    writeDraft(draftKey, {
      title, description, category, condition, price, costSheet, terms, bundle, shareToChannel, shareToFeed,
      preOrderMode, fillThreshold, cutoffDays, tags, calc, quickPost, templateId, photos, preLot, shape, lotId,
    });
  }, [draftKey, title, description, category, condition, price, costSheet, terms, bundle, shareToChannel, shareToFeed,
    preOrderMode, fillThreshold, cutoffDays, tags, calc, quickPost, templateId, photos, preLot, shape, lotId]);

  useEffect(() => {
    void api.savedCalcs(storeId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [storeId]);

  /** Fill the form from a saved calculation: its name, price and costs. */
  function fillFromSaved(id: string) {
    const picked = calcs.find((entry) => entry.id === id);
    if (!picked) return;
    setCalc(picked);
    setTitle(picked.title);
    if (picked.sellingPriceMinor) setPrice(String(picked.sellingPriceMinor / 100));
    setCostSheet(picked.steps.length ? { templateId: picked.templateId, templateName: picked.templateName, steps: picked.steps } : null);
  }
  const [creatingLot, setCreatingLot] = useState(false);

  // The seller's open lots, so an item can be filed as it is listed rather
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

  useEffect(() => {
    let cancelled = false;
    void api
      .templates()
      .then((result) => {
        if (cancelled) return;
        setTemplates(result.templates);
        // The last one used, when it still exists; otherwise the first.
        const remembered = result.templates.find((row) => row.id === lastTemplate());
        const chosen = remembered ?? result.templates[0];
        // Coming back to a form already filled in: leave it as it was.
        if (chosen && !restored) {
          setTemplateId(chosen.id);
          applyTemplate(chosen);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // Once: re-applying on every render would undo edits as they were typed.
  }, []);

  /** Fill the form in from a template, leaving everything editable. */
  function applyTemplate(template: PostTemplate) {
    const fill = fillFrom(template);
    if (fill.category) setCategory(fill.category);
    if (fill.tags) setTags(fill.tags);
    if (fill.condition) setCondition(fill.condition);
    if (fill.description) setDescription(fill.description);
    setPreLot(template.preLotRoute?.steps ?? null);
    // A lot named by the template wins; otherwise the template's own answer
    // about what it lists, which is the thing a shop should not have to repeat
    // forty times a month.
    if (fill.lotId) {
      setLotId(fill.lotId);
      setShape('lot');
    } else {
      setShape(fill.sourcing === 'import' ? 'waiting' : 'single');
    }
  }

  function lotCreated(lot: Lot) {
    setLots((current) => [lot, ...current]);
    setLotId(lot.id);
    setShape('lot');
    setCreatingLot(false);
  }

  const priceMinor = Math.round(Number(price || 0) * 100);
  // A lot listing needs a lot; there is nothing to publish into otherwise.
  // A lot is bookkeeping the shop does when the lot is packed, which is
  // usually long after the item goes up. Nothing waits on it.
  const canPublish = title.trim().length > 2 && priceMinor > 0;
  // The lot is the answer: in one means import, out of one means in hand.
  const effectiveSourcing: Sourcing = shape === 'single' ? 'in_hand' : 'import';
  const chosenTemplate = templates.find((row) => row.id === templateId) ?? null;

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
        ...termsBody(terms),
        bundle,
        // A private deal is never announced: only its buyer ever sees it.
        shareToChannel: deal ? false : shareToChannel,
        shareToFeed: deal ? false : shareToFeed,
        ...(deal ? { privateFor: deal.userId } : {}),
        costSheet,
        preOrder: preOrderMode && !deal
          ? {
              fillThreshold: Math.max(2, Number(fillThreshold) || 2),
              cutoffAt: new Date(Date.now() + (Number(cutoffDays) || 14) * 86_400_000).toISOString(),
            }
          : null,
        sourcing: effectiveSourcing,
        lotId: shape === 'lot' ? lotId : null,
        ...(storeId ? { storeId } : {}),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        photos: photos.map((photo) => ({
          blobName: photo.blobName,
          url: photo.url,
          isPrimary: photo.isPrimary,
        })),
        ...(quickPost && preLot
          ? { preLotSteps: preLot.map((step) => ({ name: step.name, description: step.description })) }
          : {}),
        ...(quickPost && chosenTemplate?.lotRouteId ? { lotRouteId: chosenTemplate.lotRouteId } : {}),
      });
      // Remembered for the next item, which is the point of a template.
      if (quickPost && templateId) rememberTemplate(templateId);
      clearDraft(draftKey);
      if (calc) {
        await api.saveCalc({ ...calc, listingId: result.listing.id }, storeId).catch(() => undefined);
      }
      if (deal) {
        // The item is made; the deal card in the chat is what the buyer opens it from.
        await api.sendMessage(deal.handle, '', deal.as, { kind: 'offer', listingId: result.listing.id });
        navigate(`/messages/${encodeURIComponent(deal.handle)}?as=${encodeURIComponent(deal.as)}`, { replace: true });
        return;
      }
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
      <button type="button" className="backlink" onClick={goBack}>← Back</button>
      <div className="page__head">
        <div>
          <h1>{deal ? `🤝 Private deal for ${deal.displayName}` : 'Sell something'}</h1>
          <p className="muted">
            {deal
              ? `Only ${deal.displayName} can see and buy this. It never appears in your shop, channel or the feed - once bought it is a normal order.`
              : 'Takes about a minute. You can edit or remove it afterwards.'}
          </p>
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
          {/* First, because it fills in most of what is below it. On by
              default and remembering the last one used: a template nobody has
              to go and switch on is a template that gets used. */}
          <div className="quickpost">
            <label className="tick">
              <input type="checkbox" checked={quickPost}
                onChange={(e) => setQuickPost(e.target.checked)} />
              <span>
                Quick Post
                <span className="faint"> — fill this in from a template.</span>
              </span>
            </label>

            {quickPost && (
              templates.length === 0 ? (
                <span className="field__hint">
                  No templates yet. Make one from <Link to="/shop">Items</Link> and the next listing
                  starts half-written.
                </span>
              ) : (
                <label className="field">
                  <span>Template</span>
                  <select value={templateId} onChange={(e) => {
                    setTemplateId(e.target.value);
                    const picked = templates.find((row) => row.id === e.target.value);
                    if (picked) applyTemplate(picked);
                  }}>
                    {templates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name}</option>
                    ))}
                  </select>
                  <span className="field__hint">
                    Everything it fills in stays editable — change anything before you publish.
                  </span>
                </label>
              )
            )}
          </div>

          {calcs.length > 0 && (
            <label className="field">
              <span><CalcIcon size={15} /> From your saved items</span>
              <select value={calc?.id ?? ''} onChange={(e) => fillFromSaved(e.target.value)}>
                <option value="">Pick a saved calculation to fill this in…</option>
                {calcs.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} · {formatMoney(entry.sellingPriceMinor)}{entry.listingId ? ' (listed)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

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

          <PhotoManager photos={photos} onChange={setPhotos} />

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

          {/* Telling people is part of listing, not a second job to remember
              afterwards - which is how a shop ends up with a channel nobody
              reads because nothing is ever posted in it. */}
          {!deal && <div className="field">
            <span>Tell people</span>
            <label className="row" style={{ gap: 9, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={shareToChannel} style={{ marginTop: 3 }}
                onChange={(e) => setShareToChannel(e.target.checked)} />
              <span>
                <span style={{ fontSize: 'var(--t-sm)' }}>Post it in your channel</span>
                <span className="field__hint" style={{ display: 'block' }}>
                  Your followers see it in the room. Nobody else does.
                </span>
              </span>
            </label>
            <label className="row" style={{ gap: 9, alignItems: 'flex-start', marginTop: 8 }}>
              <input type="checkbox" checked={shareToFeed} style={{ marginTop: 3 }}
                onChange={(e) => setShareToFeed(e.target.checked)} />
              <span>
                <span style={{ fontSize: 'var(--t-sm)' }}>Post it in the feed</span>
                <span className="field__hint" style={{ display: 'block' }}>
                  Everyone who follows you sees it in their feed as well.
                </span>
              </span>
            </label>
          </div>}

          <div className="field-row">
            <label className="field">
              <span>Price (₹)</span>
              <input type="number" min="1" step="1" value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="1450" required />
            </label>
          </div>

          <div className="card card--pad">
            <TermsFields value={terms} onChange={setTerms} />
          </div>

          <label className="field">
            <span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="resin, scale, sealed" />
            <span className="field__hint">Comma separated. Helps buyers find it in search.</span>
          </label>

          {!deal && <div className="card card--pad stack">
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
          </div>}

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
              <button type="button" role="radio" aria-checked={shape === 'waiting'}
                className={shape === 'waiting' ? 'is-on' : ''} onClick={() => setShape('waiting')}>
                Import — lot later
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
            ) : shape === 'waiting' ? (
              <p className="field__hint">
                It goes up as an import with no dispatch date. When it sells it lands on your Orders
                screen waiting for a lot — file it into one there, any time.
              </p>
            ) : (
              <label className="field">
                <span>Lot</span>
                {/* Filing an item into a lot is bookkeeping done when the
                    lot is actually being packed, often weeks after the item
                    went up. Requiring it here made shops either misdescribe the
                    sourcing or not list at all, so "later" is a real answer. */}
                <select value={lotId} onChange={(e) => setLotId(e.target.value)}>
                  <option value="">File it into a lot later</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name}{lot.origin ? ` — ${lot.origin}` : ''}
                    </option>
                  ))}
                </select>
                <span className="field__hint">
                  {lotId
                    ? 'Buyers follow this lot through customs and get its dispatch estimate.'
                    : 'It goes up as an import with no dispatch date until you file it — any time, from Items.'}
                </span>
                <button type="button" className="btn btn--quiet btn--sm" style={{ justifySelf: 'start', marginTop: 8 }}
                  onClick={() => setCreatingLot(true)}>
                  + New lot
                </button>
              </label>
            )}
          </div>

          <CostSheetField value={costSheet} onChange={setCostSheet} sellingPriceMinor={priceMinor} shop={storeId} />

          {error && <ErrorNotice message={error} />}

          <button type="submit" className="btn btn--lg" disabled={busy || !canPublish}>
            {busy ? (deal ? 'Sending…' : 'Publishing…') : deal ? '🤝 Send private deal' : 'Publish listing'}
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
