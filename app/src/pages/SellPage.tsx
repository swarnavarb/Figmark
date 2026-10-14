import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { tagKey } from '@shared/shop-tags';
import { CONDITION_TAGS, SOURCING_LABELS, type Sourcing } from '@shared/enums';
import { currentStepOf, lotOffset, renderStepText, routeOf } from '@shared/routes';
import { CATEGORIES } from '@shared/catalog';
import type { SavedCalc } from '@shared/profit';
import type { RouteStep } from '@shared/routes';
import type { Lot } from '@shared/models';
import { fillFrom, type PostTemplate } from '@shared/templates';
import { PhotoManager } from '../components/PhotoManager';
import { ApiRequestError, api, type LotSummary, type PhotoDraft } from '../api';
import { EmptyState, ErrorNotice, Icon, Modal, Thumb, leadPhoto } from '../components/ui';
import { formatDate, formatMoney } from '../format';
import { useSession } from '../session';
import { AdvanceStrip, DealClock, TermsFields, termsBody, termsDraft } from '../components/Buy';
import { DEAL_DEFAULT_HOURS } from '@shared/deals';
import {
  LBox, OptionTiles, PreOrderBox, ToggleRow, isoInDays, type Shape,
} from '../components/ListingForm';
import { RarityRibbon } from '../components/Quest';
import { CostSheetField, type CostSheetDraft } from '../components/CostSheetField';
import { useGoBack } from '../components/ScrollManager';
import { lotLabel } from '../components/LotName';
import { NewLotForm } from './LotsPage';
import { SetupChecklist } from './VerifyPage';

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
  shareToChannel: boolean; shareToFeed: boolean; preOrderMode: boolean; fillThreshold: string; preOrderDays: string;
  tags: string; calc: SavedCalc | null; templateId: string; photos: PhotoDraft[];
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
    localStorage.removeItem(PENDING_KEY);
  } catch {
    /* Nothing kept, nothing to clear. */
  }
}

/**
 * A listing filled in before its seller was verified.
 *
 * Kept in this browser rather than this visit, because verifying is a trip
 * out to WhatsApp and an Aadhaar QR that can take a day: the form should be
 * waiting, as it was left, whenever they come back to publish it.
 */
const PENDING_KEY = 'figmark:sell-draft:pending';

function readPending(): SellDraft | null {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null') as SellDraft | null;
  } catch {
    return null;
  }
}

function writePending(draft: SellDraft) {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    /* A private window: nothing outlives the visit. */
  }
}

/** Where the item is, which decides whether it travels in a lot at all. */
const WHERE_OPTIONS: { id: 'in_hand' | 'import'; icon: string; title: string; note: string }[] = [
  { id: 'in_hand', icon: '🏠', title: 'In hand', note: 'On your shelf, ready to ship' },
  { id: 'import', icon: '✈️', title: 'Importing', note: 'Coming in from abroad' },
];

/** The lot picker's own choices, beside the lots themselves. */
const LOT_LATER = '';
const LOT_NEW = '__new';

/** Comma-typed tags as a list. */
const splitTags = (text: string) => text.split(',').map((tag) => tag.trim()).filter(Boolean);

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
    /** The shop's own item a private deal starts from - sold out and expired ones too. */
    fromItem?: { id: string; title: string; priceMinor: number; state: string };
    category?: string; condition?: string; tags?: string[]; photos?: PhotoDraft[];
  } | null;
  const deal = prefill?.privateDeal ?? null;

  // What was typed here, kept against this visit - so leaving for the
  // calculator and coming back finds the form exactly as it was left.
  const location = useLocation();
  const draftKey = `${DRAFT_KEY}:${location.key}`;
  // This visit's draft; failing that, one saved while waiting on verification -
  // unless this visit came with something of its own to list.
  const [restored] = useState(() => {
    const visit = readDraft(draftKey);
    const pending = location.state ? null : readPending();
    // A fresh page load reuses the same visit key, so the newer of the two wins.
    return (pending?.savedAt ?? 0) > (visit?.savedAt ?? 0) ? pending : visit ?? pending;
  });

  const [title, setTitle] = useState(restored?.title ?? prefill?.title ?? '');
  const [description, setDescription] = useState(restored?.description ?? prefill?.description ?? '');
  const [category, setCategory] = useState<string>(restored?.category ?? prefill?.category ?? CATEGORIES[0]!);
  const [condition, setCondition] = useState<string>(restored?.condition ?? prefill?.condition ?? CONDITION_TAGS[0]);
  const [price, setPrice] = useState(() => restored?.price ?? (prefill?.priceMinor ? String(prefill.priceMinor / 100) : ''));
  const [costSheet, setCostSheet] = useState<CostSheetDraft | null>(restored ? restored.costSheet : prefill?.costSheet ?? null);
  const [terms, setTerms] = useState(() => restored?.terms ? { ...termsDraft(), ...restored.terms }
    : termsDraft(prefill?.quantity ? { quantityAvailable: prefill.quantity } : undefined));
  const [shareToChannel, setShareToChannel] = useState(restored?.shareToChannel ?? prefill?.share?.channel ?? true);
  const [shareToFeed, setShareToFeed] = useState(restored?.shareToFeed ?? prefill?.share?.feed ?? true);
  const [preOrderMode, setPreOrderMode] = useState(restored?.preOrderMode ?? false);
  const [fillThreshold, setFillThreshold] = useState(restored?.fillThreshold ?? '20');
  /** Days until bookings close - also the item's expiry, so a pre-order has one date, not two. */
  const [preOrderDays, setPreOrderDays] = useState(restored?.preOrderDays ?? '14');
  const [tags, setTags] = useState(restored?.tags ?? prefill?.tags?.join(', ') ?? '');
  /** A private deal's clock, in hours. */
  const [dealHours, setDealHours] = useState<number>(DEAL_DEFAULT_HOURS);
  const fromItem = deal ? prefill?.fromItem ?? null : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The saved calculation this listing is made from, marked with the item once it is published. */
  const [calc, setCalc] = useState<SavedCalc | null>(restored?.calc ?? prefill?.calc ?? null);
  const [calcs, setCalcs] = useState<SavedCalc[]>([]);

  /* Quick Fill starts on the last template used, because a shop lists forty of
     the same kind of thing a month and typing the same category, tags and two
     lines each time is how a listing screen becomes a chore. Everything it
     fills in stays editable, and "None" lets it go. */
  const [templates, setTemplates] = useState<PostTemplate[]>([]);
  // None when the form starts from an existing item: that item is the template.
  const [templateId, setTemplateId] = useState<string>(() => restored?.templateId ?? (prefill?.fromItem ? '' : lastTemplate() ?? ''));
  const [photos, setPhotos] = useState<PhotoDraft[]>(restored?.photos ?? prefill?.photos ?? []);
  const [preLot, setPreLot] = useState<RouteStep[] | null>(restored?.preLot ?? null);
  const [shape, setShape] = useState<Shape>(restored?.shape ?? 'single');
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [lotId, setLotId] = useState(restored?.lotId ?? '');
  /** The new-lot form, open over this one. */
  const [openingLot, setOpeningLot] = useState(false);
  /** Everything past the basics, folded until asked for. */
  const [more, setMore] = useState(() => Boolean(restored?.preOrderMode || prefill?.costSheet || prefill?.quantity));
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
    preOrderMode, fillThreshold, preOrderDays, tags, calc, templateId, photos, preLot, shape, lotId,
    createdListingId,
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!published.current && latest.current) writeDraft(draftKey, latest.current);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftKey, title, description, category, condition, price, costSheet, terms, shareToChannel, shareToFeed,
    preOrderMode, fillThreshold, preOrderDays, tags, calc, templateId, photos, preLot, shape, lotId,
    createdListingId]);
  useEffect(() => () => {
    if (!published.current && latest.current) writeDraft(draftKey, latest.current);
  }, [draftKey]);

  useEffect(() => {
    void api.savedCalcs(storeId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [storeId]);

  /** The tags this shop is known for, offered while listing. */
  const [shopTags, setShopTags] = useState<string[]>([]);
  const shopId = storeId ?? user?.id;
  useEffect(() => {
    if (!shopId) return;
    void api.shopTags(shopId).then((result) => setShopTags(result.tags)).catch(() => setShopTags([]));
  }, [shopId]);
  const typedTags = new Set(splitTags(tags).map(tagKey));
  const tagIdeas = shopTags.filter((tag) => !typedTags.has(tagKey(tag))).slice(0, 6);

  /** Fill the form from a saved calculation: its name, price and costs. */
  function fillFromSaved(id: string) {
    const picked = calcs.find((entry) => entry.id === id);
    if (!picked) return;
    setCalc(picked);
    setTitle(picked.title);
    if (picked.sellingPriceMinor) setPrice(String(picked.sellingPriceMinor / 100));
    setCostSheet(picked.steps.length ? { templateId: picked.templateId, templateName: picked.templateName, steps: picked.steps } : null);
  }

  // The seller's open lots, so an item can be filed as it is listed rather
  // than published first and tidied up afterwards.
  useEffect(() => {
    let cancelled = false;
    void api
      .myLots()
      .then((result) => {
        if (cancelled) return;
        setLots(result.lots.filter((entry) => entry.lot.status === 'open'));
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
        result.templates = result.templates.filter((row) => row.kind !== 'power');
        setTemplates(result.templates);
        // The last one used, when it still exists; otherwise the first.
        const remembered = result.templates.find((row) => row.id === lastTemplate());
        const chosen = remembered ?? result.templates[0];
        // Coming back to a form already filled in: leave it as it was.
        if (chosen && !restored && !prefill?.fromItem) {
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

  const priceMinor = Math.round(Number(price || 0) * 100);
  // A lot listing needs a lot; there is nothing to publish into otherwise.
  // A lot is bookkeeping the shop does when the lot is packed, which is
  // usually long after the item goes up. Nothing waits on it.
  const canPublish = title.trim().length > 2 && priceMinor > 0;
  // The lot is the answer: in one means import, out of one means in hand.
  const effectiveSourcing: Sourcing = shape === 'single' ? 'in_hand' : 'import';
  const chosenTemplate = templates.find((row) => row.id === templateId) ?? null;
  /** Quick Fill is on while a template is picked; its lot steps only travel then. */
  const quickFill = Boolean(chosenTemplate);
  const verified = Boolean(user?.capabilities.canSell);

  /** Where it is, as one answer: the lot picker under "Importing" says the rest. */
  const where: 'in_hand' | 'import' = shape === 'single' ? 'in_hand' : 'import';
  function pickWhere(next: 'in_hand' | 'import') {
    if (next === 'in_hand') setShape('single');
    else setShape(lotId && lots.some((entry) => entry.lot.id === lotId) ? 'lot' : 'waiting');
  }
  function pickLot(value: string) {
    if (value === LOT_NEW) { setOpeningLot(true); return; }
    setLotId(value);
    setShape(value === LOT_LATER ? 'waiting' : 'lot');
  }

  /** What is switched on under "More options", said on the fold. */
  function moreSummary(): string[] {
    const preOrdering = preOrderMode && !deal;
    return [
      preOrdering ? `Pre-order · ${fillThreshold || 2} bookings` : null,
      !preOrdering ? (terms.quantityMode === 'multiple' ? 'No fixed count' : `${Number(terms.quantity) || 0} in stock`) : null,
      terms.advance ? `${Number(terms.advancePercent) || 20}% advance` : null,
      terms.limited && !deal ? `Ends in ${terms.days} days` : null,
      terms.affiliate && !deal ? 'Affiliate commission' : null,
      !deal ? (shareToChannel || shareToFeed
        ? `Posts to ${[shareToChannel && 'channel', shareToFeed && 'feed'].filter(Boolean).join(' & ')}`
        : 'Not announced') : null,
      costSheet ? 'Cost sheet' : null,
    ].filter((text): text is string => Boolean(text));
  }

  /** Not yet verified: keep the form for later, and go and verify. */
  function saveForLater() {
    if (latest.current) writePending(latest.current);
    // Kept for later now, so this visit's own copy has nothing left to do.
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Nothing kept. */
    }
    published.current = true;
    navigate('/verify');
  }

  const closesAt = isoInDays(preOrderDays || 14);

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
        // Never a commission item, and on a clock of hours rather than days.
        ...(deal ? {
          privateFor: deal.userId,
          affiliateMinor: null, affiliateOffMinor: null,
          expiresAt: new Date(Date.now() + dealHours * 3_600_000).toISOString(),
          ...(fromItem ? { dealFromId: fromItem.id } : {}),
        } : {}),
        costSheet,
        preOrder: preOrderMode && !deal
          ? {
              fillThreshold: Math.max(2, Number(fillThreshold) || 2),
              cutoffAt: closesAt,
            }
          : null,
        sourcing: effectiveSourcing,
        lotId: shape === 'lot' && lotId ? lotId : null,
        ...(storeId ? { storeId } : {}),
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        photos: photos.map((photo) => ({
          blobName: photo.blobName,
          url: photo.url,
          isPrimary: photo.isPrimary,
        })),
        ...(quickFill && preLot
          ? { preLotSteps: preLot.map((step) => ({ name: step.name, description: step.description })) }
          : {}),
        ...(quickFill && chosenTemplate?.lotRouteId ? { lotRouteId: chosenTemplate.lotRouteId } : {}),
      })).listing.id;
      if (!createdListingId) {
        setCreatedListingId(listingId);
        // Remembered for the next item, which is the point of a template.
        if (quickFill) rememberTemplate(templateId);
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
        <SetupChecklist hasStore={false} onOpenStore={() => navigate('/shop')} />
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
          {fromItem && (
            <p className="dealfrom">
              Made from <b>{fromItem.title}</b>
              {fromItem.state !== 'live' && <span className="dealfrom__state">{fromItem.state === 'bought' ? 'sold out' : fromItem.state}</span>}
              {' '}· was {formatMoney(fromItem.priceMinor)}. Change anything below - the original stays as it is.
            </p>
          )}
        </div>
      </div>

      {/* Listing is closed until the account is verified. Say so before the
          form is filled in - and let it be filled in anyway, kept as a draft. */}
      {user && !verified && (
        <p className="notice notice--info" style={{ marginBottom: 20 }}>
          You can fill this in now - it is kept as a draft in this browser. It goes live once your email, WhatsApp
          and Aadhaar are verified. <Link to="/verify">Verify now</Link>
        </p>
      )}

      <div className="sellgrid">
        <form className="sellform" onSubmit={publish}>
          {/* Quick Fill first, because it fills in most of what is below it,
              and already on the last template used. A row of names to tap
              rather than a switch and a dropdown: one tap, and "None" to let
              it go. */}
          {verified && (templates.length > 0 || calcs.length > 0) && (
            <LBox icon="⚡" title="Quick Fill" hint="Start from a template - everything stays editable.">
              {templates.length > 0 && (
                <div className="qfill" role="radiogroup" aria-label="Quick Fill template">
                  {templates.map((template) => (
                    <button key={template.id} type="button" role="radio" aria-checked={templateId === template.id}
                      className={`qfill__chip${templateId === template.id ? ' is-on' : ''}`}
                      onClick={() => { setTemplateId(template.id); applyTemplate(template); }}>
                      {template.name}
                    </button>
                  ))}
                  <button type="button" role="radio" aria-checked={!quickFill}
                    className={`qfill__chip qfill__chip--none${quickFill ? '' : ' is-on'}`}
                    onClick={() => { setTemplateId(''); setPreLot(null); }}>
                    None
                  </button>
                </div>
              )}
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
          )}
          {verified && templates.length === 0 && calcs.length === 0 && (
            <span className="lbox__hint">
              ⚡ Listing the same kind of thing often? Save a Quick Fill template in{' '}
              <Link to="/shop?tab=items">Listings → Quick Fill</Link>.
            </span>
          )}

          <LBox icon="📸" title="Photos" hint={verified ? 'The first one leads the listing.' : undefined}>
            {verified
              ? <PhotoManager photos={photos} onChange={setPhotos} label={null} />
              : <span className="lbox__hint">Add photos once you are verified - the rest of the draft is kept.</span>}
          </LBox>

          <LBox icon="🏷️" title="The item">
            <label className="field">
              <span>Title</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="1/7 scale figure, sealed" required />
            </label>
            <div className="field-row">
              <label className="field">
                <span>Price (₹)</span>
                <input type="number" min="1" step="1" value={price} inputMode="numeric"
                  onChange={(e) => setPrice(e.target.value)} placeholder="1450" required />
              </label>
              <label className="field">
                <span>Condition</span>
                <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                  {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
                </select>
              </label>
            </div>
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
              <div className="field">
                <label htmlFor="sell-tags">Tags</label>
                <input id="sell-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="resin, sealed" />
                {/* The shop's own tags, one tap each: listings and shop speak the same words. */}
                {tagIdeas.length > 0 && (
                  <div className="taginput__ideas">
                    {tagIdeas.map((idea) => (
                      <button key={idea} type="button" className="taginput__idea"
                        onClick={() => setTags((now) => [...splitTags(now), idea].join(', '))}>+ {idea}</button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </LBox>

          {/* One question - where is it? - and the lot only for an import,
              as a choice with "later" first: filing it is bookkeeping the
              shop often does weeks after the item goes up. */}
          <LBox icon="🚚" title="Where is it?">
            <OptionTiles label="Where is it?" value={where} onChange={pickWhere} options={WHERE_OPTIONS} />
            {where === 'import' && (
              <label className="field">
                <span>Lot</span>
                <select value={shape === 'lot' ? lotId : LOT_LATER} onChange={(e) => pickLot(e.target.value)}>
                  <option value={LOT_LATER}>Add to a lot later</option>
                  {lots.map(({ lot, orderCount }) => (
                    <option key={lot.id} value={lot.id}>
                      {[lotLabel(lot),
                        lot.originCountry && lot.destinationCountry ? `${lot.originCountry} → ${lot.destinationCountry}` : lot.origin,
                        lotWhere(lot),
                        lot.estimatedDispatchAt ? `ships ${formatDate(lot.estimatedDispatchAt)}` : null,
                        `${orderCount} order${orderCount === 1 ? '' : 's'}`,
                      ].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                  {verified && <option value={LOT_NEW}>+ Open a new lot…</option>}
                </select>
                <span className="field__hint">
                  {shape === 'lot'
                    ? 'Buyers follow this lot’s tracking from the day they order.'
                    : 'Buyers see it as an import; file it into a lot whenever the shipment is packed.'}
                </span>
              </label>
            )}
          </LBox>

          {deal && <DealClock hours={dealHours} onChange={setDealHours} />}

          {/* Everything a first listing can do without: folded, with what is
              switched on said on the fold so nothing set is hidden. */}
          <button type="button" className="disclose sellmore" aria-expanded={more} onClick={() => setMore(!more)}>
            <Icon name={more ? 'down' : 'right'} size={14} />
            <span>More options</span>
            <span className="sellmore__chips">
              {moreSummary().map((text) => <span key={text} className="sellmore__chip">{text}</span>)}
            </span>
          </button>

          {more && (
            <>
              {!deal && (
                <PreOrderBox on={preOrderMode} onToggle={setPreOrderMode}
                  units={fillThreshold} onUnits={setFillThreshold}
                  closes={preOrderDays} onCloses={setPreOrderDays} />
              )}

              <TermsFields value={terms} onChange={setTerms} preOrder={preOrderMode && !deal} privateDeal={Boolean(deal)} />

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

              {verified && <CostSheetField value={costSheet} onChange={setCostSheet} sellingPriceMinor={priceMinor} shop={storeId} />}
            </>
          )}

          {error && <ErrorNotice message={error} />}

          {/* Pinned to the bottom of a phone screen, so it is never a scroll away. */}
          <div className="sellform__bar">
            {verified ? (
              <button type="submit" className="btn btn--lg btn--block sellform__go" disabled={busy || !canPublish}>
                {busy ? (deal ? 'Sending…' : 'Publishing…') : deal ? '🤝 Send private deal' : '🚀 Publish listing'}
              </button>
            ) : (
              <button type="button" className="btn btn--lg btn--block sellform__go" onClick={saveForLater}>
                Save draft and verify
              </button>
            )}
          </div>
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
            {terms.advance && <AdvanceStrip percent={Number(terms.advancePercent) || 20} />}
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

      {/* Over the listing, not instead of it: the half-filled form waits
          underneath and the new lot comes back already picked. */}
      {openingLot && (
        <Modal title="New lot" onClose={() => setOpeningLot(false)}>
          <NewLotForm bare
            onCancel={() => setOpeningLot(false)}
            onDone={(lot) => {
              setOpeningLot(false);
              setLotId(lot.id);
              void api.myLots()
                .then((result) => setLots(result.lots.filter((entry) => entry.lot.status === 'open')))
                .catch(() => undefined);
              setShape('lot');
            }} />
        </Modal>
      )}
    </main>
  );
}

/** Where a lot is, in a seller's words: still filling, or the step it is on. */
function lotWhere(lot: Lot): string {
  const route = routeOf(lot);
  const at = currentStepOf(lot);
  if (at < lotOffset(route)) return 'Filling';
  return renderStepText(route.steps[at]?.name ?? 'Filling', { origin: lot.originCountry, destination: lot.destinationCountry });
}
