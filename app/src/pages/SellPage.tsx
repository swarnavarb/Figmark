import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { EmptyState, ErrorNotice, Thumb, leadPhoto } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';
import { TermsFields, termsBody, termsDraft } from '../components/Buy';
import {
  LBox, OptionTiles, PreOrderBox, SHAPE_OPTIONS, Switch, ToggleRow, localInDays, type Shape,
} from '../components/ListingForm';
import { RarityRibbon } from '../components/Quest';
import { CostSheetField, type CostSheetDraft } from '../components/CostSheetField';
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
  costSheet: CostSheetDraft | null; terms: ReturnType<typeof termsDraft>;
  shareToChannel: boolean; shareToFeed: boolean; preOrderMode: boolean; fillThreshold: string; preOrderCloses: string;
  tags: string; calc: SavedCalc | null; quickPost: boolean; templateId: string; photos: PhotoDraft[];
  preLot: RouteStep[] | null; shape: Shape; lotId: string;
  /** The listing already made from this form, when only the step after it failed. */
  createdListingId?: string | null;
  /** When it was last written, so old visits' drafts can be let go. */
  savedAt?: number;
};

/** How many visits' drafts are kept. Each visit has its own key, and nothing else ever removed them. */
const KEEP_DRAFTS = 5;

function readDraft(key: string): SellDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) ?? 'null') as SellDraft | null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: SellDraft) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* A private window: the form just is not kept. */
  }
}

/** Drop all but the newest few drafts, keeping the one this visit is using. */
function pruneDrafts(current: string) {
  try {
    const drafts: { key: string; at: number }[] = [];
    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (!key?.startsWith(`${DRAFT_KEY}:`) || key === current) continue;
      drafts.push({ key, at: readDraft(key)?.savedAt ?? 0 });
    }
    drafts.sort((a, b) => b.at - a.at)
      .slice(KEEP_DRAFTS - 1)
      .forEach(({ key }) => sessionStorage.removeItem(key));
  } catch {
    /* Storage unavailable: there is nothing kept to prune. */
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
  const [shareToChannel, setShareToChannel] = useState(restored?.shareToChannel ?? prefill?.share?.channel ?? true);
  const [shareToFeed, setShareToFeed] = useState(restored?.shareToFeed ?? prefill?.share?.feed ?? true);
  const [preOrderMode, setPreOrderMode] = useState(restored?.preOrderMode ?? false);
  const [fillThreshold, setFillThreshold] = useState(restored?.fillThreshold ?? '20');
  /** When bookings close - also the item's expiry, so a pre-order has one date, not two. */
  const [preOrderCloses, setPreOrderCloses] = useState(restored?.preOrderCloses ?? localInDays(14));
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
  /* The listing this form already made, when publishing got that far and the
     private-deal message after it did not. Publishing again then only retries
     the message, rather than making a second copy of the item. */
  const [createdListingId, setCreatedListingId] = useState<string | null>(restored?.createdListingId ?? null);

  useEffect(() => { pruneDrafts(draftKey); }, [draftKey]);

  /* Written a moment after typing stops rather than on every keystroke: the
     draft carries the photos too, and serialising all of it per character
     was work the form paid for while being typed into. Leaving the page
     writes whatever is still waiting, so nothing typed is lost - unless it
     was published, when there is nothing left to keep. */
  const latest = useRef<SellDraft | null>(null);
  const published = useRef(false);
  latest.current = {
    title, description, category, condition, price, costSheet, terms, shareToChannel, shareToFeed,
    preOrderMode, fillThreshold, preOrderCloses, tags, calc, quickPost, templateId, photos, preLot, shape, lotId,
    createdListingId,
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!published.current && latest.current) writeDraft(draftKey, latest.current);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftKey, title, description, category, condition, price, costSheet, terms, shareToChannel, shareToFeed,
    preOrderMode, fillThreshold, preOrderCloses, tags, calc, quickPost, templateId, photos, preLot, shape, lotId,
    createdListingId]);
  useEffect(() => () => {
    if (!published.current && latest.current) writeDraft(draftKey, latest.current);
  }, [draftKey]);

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
          applyTemplate(chosen, true);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // Once: re-applying on every render would undo edits as they were typed.
  }, []);

  /**
   * What the last template put in each field, so switching to another one
   * replaces what the first one wrote - including clearing a field the new
   * one leaves blank - without touching anything typed by hand since.
   */
  const applied = useRef<{ category: string; tags: string; condition: string; description: string } | null>(null);

  /**
   * Fill the form in from a template, leaving everything editable.
   *
   * On the first, automatic fill, a field that arrived already filled in -
   * a private deal's description, the calculator's - is left as it came.
   */
  function applyTemplate(template: PostTemplate, initial = false) {
    const fill = fillFrom(template);
    const next = {
      category: fill.category || CATEGORIES[0]!,
      tags: fill.tags ?? '',
      condition: fill.condition || CONDITION_TAGS[0],
      description: fill.description ?? '',
    };
    const before = applied.current;
    // Untouched since the last template (or, first time, never prefilled).
    const free = (field: keyof typeof next, current: string, prefilled = false) =>
      before ? current === before[field] : !prefilled;
    if (free('category', category)) setCategory(next.category);
    if (free('tags', tags)) setTags(next.tags);
    if (free('condition', condition)) setCondition(next.condition);
    if (free('description', description, initial && Boolean(prefill?.description))) setDescription(next.description);
    applied.current = next;
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

  const closesAt = new Date(preOrderCloses || localInDays(14)).toISOString();

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Made already, on an earlier try whose deal message failed: only the
      // message is still owed, and a second listing would be a duplicate.
      const listingId = createdListingId ?? (await api.createListing({
        title: title.trim(),
        description: description.trim(),
        category,
        condition,
        priceMinor,
        // A pre-order has no fixed count, and its bookings-close date is
        // the date it comes down.
        ...(preOrderMode && !deal
          ? { ...termsBody({ ...terms, quantityMode: 'multiple' }), expiresAt: closesAt }
          : termsBody(terms)),
        bundle: false,
        // A private deal is never announced: only its buyer ever sees it.
        shareToChannel: deal ? false : shareToChannel,
        shareToFeed: deal ? false : shareToFeed,
        ...(deal ? { privateFor: deal.userId } : {}),
        costSheet,
        preOrder: preOrderMode && !deal
          ? {
              fillThreshold: Math.max(2, Number(fillThreshold) || 2),
              cutoffAt: closesAt,
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
      })).listing.id;
      if (!createdListingId) {
        setCreatedListingId(listingId);
        // Remembered for the next item, which is the point of a template.
        if (quickPost && templateId) rememberTemplate(templateId);
        if (calc) {
          await api.saveCalc({ ...calc, listingId }, storeId).catch(() => undefined);
        }
      }
      if (deal) {
        // The item is made; the deal card in the chat is what the buyer opens it from.
        try {
          await api.sendMessage(deal.handle, '', deal.as, { kind: 'offer', listingId });
        } catch (err) {
          setError(`The item is made, but the deal was not sent to ${deal.displayName}: ${
            err instanceof ApiRequestError ? err.message : 'the message did not go through'
          }. Send it again - the item will not be made twice.`);
          return;
        }
        published.current = true;
        clearDraft(draftKey);
        navigate(`/messages/${encodeURIComponent(deal.handle)}?as=${encodeURIComponent(deal.as)}`, { replace: true });
        return;
      }
      published.current = true;
      clearDraft(draftKey);
      navigate(`/listing/${listingId}`);
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
          <h1>{deal ? `🤝 Private deal for ${deal.displayName}` : 'List an item'}</h1>
          <p className="muted">
            {deal
              ? `Only ${deal.displayName} can see and buy this. It never appears in your shop, channel or the feed - once bought it is a normal order.`
              : 'About a minute. You can edit it any time.'}
          </p>
        </div>
      </div>

      {/* Verification is friction, not a wall: it gates value, not listing. */}
      {user && user.verification.governmentId !== 'verified' && (
        <p className="notice notice--info" style={{ marginBottom: 20 }}>
          Verifying your ID unlocks higher-value listings and payouts — you can do that any time.
        </p>
      )}

      <div className="sellgrid">
        <form className="sellform" onSubmit={publish}>
          {/* First, because it fills in most of what is below it. On by
              default and remembering the last one used: a template nobody has
              to go and switch on is a template that gets used. */}
          <LBox icon="⚡" title="Quick Post" hint="Fill this in from a template."
            right={<Switch checked={quickPost} onChange={setQuickPost} label="Quick Post" />}>
            {quickPost && (templates.length === 0 ? (
              <span className="lbox__hint">
                No templates yet — make one in <Link to="/shop?tab=items">Items → Templates</Link>.
              </span>
            ) : (
              <select value={templateId} aria-label="Template" onChange={(e) => {
                setTemplateId(e.target.value);
                const picked = templates.find((row) => row.id === e.target.value);
                if (picked) applyTemplate(picked);
              }}>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>{template.name}</option>
                ))}
              </select>
            ))}
            {calcs.length > 0 && (
              <select value={calc?.id ?? ''} aria-label="From your saved items" onChange={(e) => fillFromSaved(e.target.value)}>
                <option value="">🧮 Fill from a saved calculation…</option>
                {calcs.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.title} · {formatMoney(entry.sellingPriceMinor)}{entry.listingId ? ' (listed)' : ''}
                  </option>
                ))}
              </select>
            )}
          </LBox>

          <LBox icon="📸" title="Photos" hint="The first one leads the listing.">
            <PhotoManager photos={photos} onChange={setPhotos} label={null} />
          </LBox>

          <LBox icon="🏷️" title="The item">
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="1/7 scale figure, sealed" required />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="Condition, what's included…" />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Category</span>
                <select value={category} onChange={(e) => setCategory(e.target.value)}>
                  {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
                </select>
              </label>
              <label className="field">
                <span>Condition</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
                </select>
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Price (₹)</span>
                <input type="number" min="1" step="1" value={price} inputMode="numeric"
                  onChange={(e) => setPrice(e.target.value)} placeholder="1450" required />
              </label>
              <label className="field">
                <span>Tags</span>
                <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="resin, sealed" />
              </label>
            </div>
          </LBox>

          <LBox icon="🚚" title="Ships from">
            <OptionTiles label="How are you selling this?" value={shape} onChange={setShape} options={SHAPE_OPTIONS} />
            {shape === 'lot' && (
              <div className="row" style={{ gap: 8 }}>
                <select value={lotId} onChange={(e) => setLotId(e.target.value)} aria-label="Lot" style={{ flex: 1 }}>
                  <option value="">File it into a lot later</option>
                  {lots.map((lot) => (
                    <option key={lot.id} value={lot.id}>
                      {lot.name}{lot.origin ? ` — ${lot.origin}` : ''}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setCreatingLot(true)}>
                  + New lot
                </button>
              </div>
            )}
          </LBox>

          {!deal && (
            <PreOrderBox on={preOrderMode} onToggle={setPreOrderMode}
              units={fillThreshold} onUnits={setFillThreshold}
              closes={preOrderCloses} onCloses={setPreOrderCloses} />
          )}

          <TermsFields value={terms} onChange={setTerms} preOrder={preOrderMode && !deal} />

          {/* Telling people is part of listing, not a second job to remember
              afterwards. Both on unless the seller says otherwise. */}
          {!deal && (
            <LBox icon="📣" title="Tell people">
              <ToggleRow icon="💬" title="Post in your channel" hint="Your followers see it in the room."
                checked={shareToChannel} onChange={setShareToChannel} />
              <ToggleRow icon="🌐" title="Post in the feed" hint="Everyone who follows you sees it."
                checked={shareToFeed} onChange={setShareToFeed} />
            </LBox>
          )}

          <CostSheetField value={costSheet} onChange={setCostSheet} sellingPriceMinor={priceMinor} shop={storeId} />

          {error && <ErrorNotice message={error} />}

          <button type="submit" className="btn btn--lg btn--block sellform__go" disabled={busy || !canPublish}>
            {busy ? (deal ? 'Sending…' : 'Publishing…') : deal ? '🤝 Send private deal' : '🚀 Publish listing'}
          </button>
        </form>

        {/* The same card the Buy tab draws, so what the seller sees here is
            what a buyer will scroll past. */}
        <aside className="sellpreview">
          <span className="lbox__hint">Preview</span>
          <div className="qloot qloot--new">
            <Thumb seed={title || 'preview'} label={title || 'Your listing'} photo={leadPhoto({ photos })}
              className="thumb qloot__art">
              <RarityRibbon tier="new" />
              <span className="qgrade">{condition}</span>
              {preOrderMode && !deal && <span className="qsticker-tag">Pre-order</span>}
            </Thumb>
            <div className="qloot__body">
              <span className="qloot__title">{title || 'Your listing title'}</span>
              <span className="qloot__price">{priceMinor > 0 ? formatMoney(priceMinor) : '₹—'}</span>
              <span className="qloot__meta">
                <b className={effectiveSourcing === 'in_hand' ? 'qok' : ''}>{SOURCING_LABELS[effectiveSourcing]}</b>
                {' · '}{category}
              </span>
              <span className="qloot__foot">
                <span className="faint">just now</span>
                <span className="qcrest">{user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'You'}</span>
              </span>
            </div>
          </div>
        </aside>
      </div>

      {creatingLot && <NewLotDialog onCreated={lotCreated} onCancel={() => setCreatingLot(false)} />}
    </main>
  );
}
