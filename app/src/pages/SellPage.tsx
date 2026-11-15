import { FeeHint } from '../components/Billing';
import { ServiceNudge } from '../components/ServiceCards';
import { haptic } from '../haptics';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TagInput } from '../components/PageFields';
import { PageLoading } from '../components/Feedback';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { lotDraftWaitingAt } from '../lotDraft';
import { tagKey } from '@shared/shop-tags';
import { SOURCING_LABELS, type Sourcing } from '@shared/enums';
import { currentStepOf, lotOffset, renderStepText, routeOf } from '@shared/routes';
import {
  CATEGORIES, MAX_PRICE_MINOR, MIN_PRICE_MINOR, canonicalCategory, conditionTagFor, conditionValueForTag, factsOf,
  missingFields, pruneAttributes, specFor, type Attributes,
} from '@shared/catalog';
import type { SavedCalc } from '@shared/profit';
import type { RouteStep } from '@shared/routes';
import type { Lot, PreOrderFullRule, PreOrderShortRule } from '@shared/models';
import { fillFrom, type PostTemplate } from '@shared/templates';
import { PhotoManager } from '../components/PhotoManager';
import { CategoryFields } from '../components/CategoryFields';
import { ApiRequestError, api, type LotSummary, type PhotoDraft } from '../api';
import { ErrorNotice, Icon, Modal, Thumb, leadPhoto } from '../components/ui';
import { formatDate, formatMoney } from '../format';
import { useSession } from '../session';
import { useShopDays } from '../components/StepDays';
import { AdvanceStrip, DealClock, EtaFields, TermsFields, etaOf, termsBody, termsDraft, termsFromTemplate, termsProblem } from '../components/Buy';
import { DEAL_DEFAULT_HOURS } from '@shared/deals';
import {
  LBox, OptionTiles, PreOrderBox, ToggleRow, isoInDays, type Shape,
} from '../components/ListingForm';
import { RarityRibbon } from '../components/Quest';
import { CostSheetField, type CostSheetDraft } from '../components/CostSheetField';
import { BackBar, useGoBack } from '../components/ScrollManager';
import { lotLabel } from '../components/LotName';
import { NewLotForm } from './LotsPage';
import { OpenBusinessChooser } from '../components/OpenBusiness';
import { QuickFillPicker } from '../components/QuickFillPicker';
import '../styles/SellPage.css';
import { Select } from '../components/Select';

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
  title: string; description: string; category: string; attributes?: Attributes; price: string;
  costSheet: CostSheetDraft | null; terms: ReturnType<typeof termsDraft>;
  shareToChannel: boolean; shareToFeed: boolean; preOrderMode: boolean; fillThreshold: string; preOrderDays: string;
  whenShort?: PreOrderShortRule; whenFull?: PreOrderFullRule;
  tags: string; calc: SavedCalc | null; templateId: string; photos: PhotoDraft[];
  preLot: RouteStep[] | null; shape: Shape; lotId: string;
  /** The listing already made from this form, when only the step after it failed. */
  createdListingId?: string | null;
  /** When it was last written, so old visits' drafts can be let go. */
  savedAt?: number;
  /** The copy of this form kept with the shop, once it has been saved as a draft. */
  serverDraftId?: string | null;
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


const ETA_KEY = 'figmark:last-eta';

/** The delivery time this browser last listed with, to start the next listing from. */
function lastEta(): { minDays: number; maxDays: number } | null {
  try {
    const raw = JSON.parse(localStorage.getItem(ETA_KEY) ?? 'null') as { minDays?: number; maxDays?: number } | null;
    return raw && Number.isInteger(raw.minDays) && Number.isInteger(raw.maxDays) ? { minDays: raw.minDays!, maxDays: raw.maxDays! } : null;
  } catch {
    return null;
  }
}

function rememberEta(eta: { minDays: number; maxDays: number }): void {
  try {
    localStorage.setItem(ETA_KEY, JSON.stringify(eta));
  } catch {
    /* Private window: the next form starts blank, which is still correct. */
  }
}

/** Comma-typed tags as a list. */
const splitTags = (text: string) => text.split(',').map((tag) => tag.trim()).filter(Boolean);

/**
 * List something - or pick up a draft where it was left.
 *
 * `?draft=` names a draft kept with the shop: it is read before the form is
 * drawn, so every field starts from it. Each visit is its own form, so
 * "publish and list another" lands on a clean one.
 */
export function SellPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const draftId = params.get('draft');
  const storeId = params.get('store') ?? undefined;
  const [kept, setKept] = useState<{ id: string; form: SellDraft; updatedAt: string } | null | 'missing'>(null);

  useEffect(() => {
    if (!draftId) return;
    let cancelled = false;
    setKept(null);
    void api.draft(draftId, storeId)
      .then((result) => { if (!cancelled) setKept({ id: result.draft.id, form: result.draft.form as unknown as SellDraft, updatedAt: result.draft.updatedAt }); })
      .catch(() => { if (!cancelled) setKept('missing'); });
    return () => { cancelled = true; };
  }, [draftId, storeId]);

  if (draftId && kept === null) return <PageLoading />;
  return <SellForm key={location.key} serverDraft={draftId && kept && kept !== 'missing' ? kept : null}
    draftMissing={Boolean(draftId) && kept === 'missing'} />;
}

function SellForm({ serverDraft, draftMissing }: {
  serverDraft: { id: string; form: SellDraft; updatedAt: string } | null;
  /** The link named a draft that is gone - published, or deleted on another device. */
  draftMissing: boolean;
}) {
  const { user } = useSession();
  const navigate = useNavigate();
  // Which shop this goes into. The sell tab passes it when a store is open, so
  // a manager lists into the shop they were looking at rather than their own.
  const [params] = useSearchParams();
  const storeId = params.get('store') ?? undefined;
  // A shop somebody else owns is run from My services; your own, from the Sell tab.
  const shopHome = storeId && user && storeId !== user.id ? `/services/manage/${encodeURIComponent(storeId)}` : '/shop';
  const goBack = useGoBack(shopHome);
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
    /** "List another like this": the shop's own item this new listing starts as a copy of. */
    copyOf?: { id: string; title: string };
    attributes?: Attributes;
    category?: string; condition?: string; tags?: string[]; photos?: PhotoDraft[];
    /** Stocked because a stock poll asked: its voters get first dibs. */
    fromPoll?: { channelId: string; postId: string; optionId: string | null; label: string; voters: number };
    /** "Publish and list another": the listing that just went live from the form before this one. */
    listed?: { id: string; title: string };
  } | null;
  const justListed = prefill?.listed ?? null;
  const deal = prefill?.privateDeal ?? null;
  const fromPoll = deal ? null : prefill?.fromPoll ?? null;

  // What was typed here, kept against this visit - so leaving for the
  // calculator and coming back finds the form exactly as it was left.
  const location = useLocation();
  const draftKey = `${DRAFT_KEY}:${location.key}`;
  // This visit's draft; failing that, one saved while waiting on verification -
  // unless this visit came with something of its own to list.
  const [restored] = useState(() => {
    const visit = readDraft(draftKey);
    // A draft kept with the shop, unless this visit has typed past it since.
    if (serverDraft) {
      return visit && (visit.savedAt ?? 0) > Date.parse(serverDraft.updatedAt) ? visit : { ...serverDraft.form, serverDraftId: serverDraft.id };
    }
    const pending = location.state ? null : readPending();
    // A fresh page load reuses the same visit key, so the newer of the two wins.
    return (pending?.savedAt ?? 0) > (visit?.savedAt ?? 0) ? pending : visit ?? pending;
  });

  const [title, setTitle] = useState(restored?.title ?? prefill?.title ?? '');
  const [description, setDescription] = useState(restored?.description ?? prefill?.description ?? '');
  // A draft or template may carry a category from before a rename; it is shown
  // under its current name.
  const [category, setCategory] = useState<string>(
    canonicalCategory(restored?.category ?? prefill?.category) ?? CATEGORIES[0]!);
  // What this category asks - kind, condition, original or copy, size - kept as
  // one map so a new question is an edit to the category definition and not
  // another piece of state here. A grade ("MISB") from a prefill becomes this
  // category's own wording where one stands for it.
  const [attributes, setAttributes] = useState<Attributes>(() => {
    if (restored?.attributes) return restored.attributes;
    if (prefill?.attributes) return { ...prefill.attributes };
    const condition = conditionValueForTag(
      canonicalCategory(prefill?.category) ?? CATEGORIES[0]!, prefill?.condition);
    return condition ? { condition } : {};
  });
  // Only after a first attempt to publish, so the form does not open covered in
  // red before anybody has done anything.
  const [triedPublish, setTriedPublish] = useState(false);
  const [price, setPrice] = useState(() => restored?.price ?? (prefill?.priceMinor ? String(prefill.priceMinor / 100) : ''));
  const [costSheet, setCostSheet] = useState<CostSheetDraft | null>(restored ? restored.costSheet : prefill?.costSheet ?? null);
  const [terms, setTerms] = useState(() => {
    const draft = restored?.terms ? { ...termsDraft(), ...restored.terms }
      : termsDraft(prefill?.quantity ? { quantityAvailable: prefill.quantity } : undefined);
    // A shop ships most things the same way: the last delivery time it gave is the likeliest answer.
    if (!draft.etaMin && !draft.etaMax) {
      const last = lastEta();
      if (last) return { ...draft, etaMin: String(last.minDays), etaMax: String(last.maxDays) };
    }
    return draft;
  });
  const [shareToChannel, setShareToChannel] = useState(restored?.shareToChannel ?? prefill?.share?.channel ?? true);
  const [shareToFeed, setShareToFeed] = useState(restored?.shareToFeed ?? prefill?.share?.feed ?? true);
  // The Create sheet's "Pre-order" opens this form already set to take them.
  const askedPreOrder = params.get('preorder') === '1';
  const [preOrderMode, setPreOrderMode] = useState(restored?.preOrderMode ?? askedPreOrder);
  const [whenShort, setWhenShort] = useState<PreOrderShortRule>(restored?.whenShort ?? 'cancel');
  const [whenFull, setWhenFull] = useState<PreOrderFullRule>(restored?.whenFull ?? 'keep_open');
  const [fillThreshold, setFillThreshold] = useState(restored?.fillThreshold ?? '20');
  /** Days until bookings close - also the item's expiry, so a pre-order has one date, not two. */
  const [preOrderDays, setPreOrderDays] = useState(restored?.preOrderDays ?? '14');
  const [tags, setTags] = useState(restored?.tags ?? prefill?.tags?.join(', ') ?? '');
  /** A private deal's clock, in hours. */
  const [dealHours, setDealHours] = useState<number>(DEAL_DEFAULT_HOURS);
  const fromItem = deal ? prefill?.fromItem ?? null : null;
  const copyOf = deal ? null : prefill?.copyOf ?? null;
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
  const [templateId, setTemplateId] = useState<string>(() => restored?.templateId ?? (prefill?.fromItem || prefill?.copyOf ? '' : lastTemplate() ?? ''));
  const [photos, setPhotos] = useState<PhotoDraft[]>(restored?.photos ?? prefill?.photos ?? []);
  const [preLot, setPreLot] = useState<RouteStep[] | null>(restored?.preLot ?? null);
  const [shape, setShape] = useState<Shape>(restored?.shape ?? 'single');
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [lotId, setLotId] = useState(restored?.lotId ?? '');
  /** The new-lot form, open over this one. */
  /* Open again on the way back from writing that lot's route, as it was left. */
  const [openingLot, setOpeningLot] = useState(() => lotDraftWaitingAt(`${location.pathname}${location.search}`));
  /** Everything past the basics, folded until asked for. */
  const [more, setMore] = useState(() => Boolean(restored?.preOrderMode || askedPreOrder || prefill?.costSheet || prefill?.quantity));
  /* The listing this form already made, when publishing got that far and the
     private-deal message after it did not. Publishing again then only retries
     the message, rather than making a second copy of the item. */
  const [createdListingId, setCreatedListingId] = useState<string | null>(restored?.createdListingId ?? null);
  /** This form's copy kept with the shop, once Save draft has been pressed. */
  const [serverDraftId, setServerDraftId] = useState<string | null>(restored?.serverDraftId ?? serverDraft?.id ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** The buyer's-eye card, opened over the form on a phone. */
  const [peek, setPeek] = useState(false);
  /** Which publish button was pressed: back to a fresh form, or on to the listing. */
  const another = useRef(false);

  useEffect(() => { pruneDrafts(draftKey); }, [draftKey]);

  /* Written a moment after typing stops rather than on every keystroke: the
     draft carries the photos too, and serialising all of it per character
     was work the form paid for while being typed into. Leaving the page
     writes whatever is still waiting, so nothing typed is lost - unless it
     was published, when there is nothing left to keep. */
  const latest = useRef<SellDraft | null>(null);
  const published = useRef(false);
  latest.current = {
    title, description, category, attributes, price, costSheet, terms, shareToChannel, shareToFeed,
    preOrderMode, fillThreshold, preOrderDays, whenShort, whenFull, tags, calc, templateId, photos, preLot, shape, lotId,
    createdListingId, serverDraftId,
  };
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!published.current && latest.current) writeDraft(draftKey, latest.current);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [draftKey, title, description, category, attributes, price, costSheet, terms, shareToChannel, shareToFeed,
    preOrderMode, fillThreshold, preOrderDays, whenShort, whenFull, tags, calc, templateId, photos, preLot, shape, lotId,
    createdListingId]);
  useEffect(() => () => {
    if (!published.current && latest.current) writeDraft(draftKey, latest.current);
  }, [draftKey]);

  // Saved calculations, lots and templates are a verified seller's: an
  // unverified one is not allowed to read them, so the form does not ask.
  const canSell = Boolean(user?.capabilities.canSell);
  useEffect(() => {
    if (!canSell) return;
    void api.savedCalcs(storeId).then((result) => setCalcs(result.calcs)).catch(() => setCalcs([]));
  }, [storeId, canSell]);

  /** The tags this shop is known for, offered while listing. */
  const [shopTags, setShopTags] = useState<string[]>([]);
  const shopId = storeId ?? user?.id;
  /* How long this shop's orders really take to arrive - or the market's,
     where it has no record yet - offered as the delivery time to give. */
  const shopDays = useShopDays(shopId ?? null);
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
    if (!canSell) return;
    let cancelled = false;
    void api
      .myLots(storeId)
      .then((result) => {
        if (cancelled) return;
        setLots(result.lots.filter((entry) => entry.lot.status === 'open'));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [canSell, storeId]);

  useEffect(() => {
    if (!canSell) return;
    let cancelled = false;
    void api
      .templates(storeId)
      .then((result) => {
        if (cancelled) return;
        setTemplates(result.templates);
        // The last one used, when it still exists; otherwise the first.
        const remembered = result.templates.find((row) => row.id === lastTemplate());
        const chosen = remembered ?? result.templates[0];
        // Coming back to a form already filled in: leave it as it was.
        if (chosen && !restored && !prefill?.fromItem && !prefill?.copyOf) {
          setTemplateId(chosen.id);
          applyTemplate(chosen, true);
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
    // Once (and once more if selling opens up): re-applying on every render
    // would undo edits as they were typed.
  }, [canSell]);

  /**
   * What the last template put in each field, so switching to another one
   * replaces what the first one wrote - including clearing a field the new
   * one leaves blank - without touching anything typed by hand since.
   */
  const applied = useRef<{ category: string; tags: string; attributes: string; description: string } | null>(null);

  /**
   * Fill the form in from a template, leaving everything editable.
   *
   * On the first, automatic fill, a field that arrived already filled in -
   * a private deal's description, the calculator's - is left as it came.
   */
  function applyTemplate(template: PostTemplate, initial = false) {
    const fill = fillFrom(template);
    const templateCategory = canonicalCategory(fill.category) ?? CATEGORIES[0]!;
    // The category's own answers; an older template knew only a grade, put
    // into this category's wording where one stands for it.
    const legacyCondition = conditionValueForTag(templateCategory, fill.condition);
    const answers = pruneAttributes(templateCategory, Object.keys(fill.attributes).length > 0
      ? fill.attributes
      : legacyCondition ? { condition: legacyCondition } : {});
    const next = {
      category: templateCategory,
      tags: fill.tags ?? '',
      attributes: JSON.stringify(answers),
      description: fill.description ?? '',
    };
    const before = applied.current;
    // Untouched since the last template (or, first time, never prefilled).
    const free = (field: keyof typeof next, current: string, prefilled = false) =>
      before ? current === before[field] : !prefilled;
    const categoryFree = free('category', category);
    if (categoryFree) setCategory(next.category);
    if (free('tags', tags)) setTags(next.tags);
    if (free('attributes', JSON.stringify(attributes))) {
      setAttributes(categoryFree
        ? answers
        // The shop chose another category by hand: only the answers that are
        // still questions there come across.
        : (current) => pruneAttributes(category, { ...current, ...answers }));
    }
    if (free('description', description, initial && Boolean(prefill?.description))) setDescription(next.description);
    applied.current = next;
    // Advance, expiry, shipping, offers and commission, when the template set them.
    // Stock is the item's own, so it is kept as the form has it.
    if (fill.terms && !(initial && prefill)) {
      setTerms((current) => termsFromTemplate(current, {
        ...fill.terms!, quantityMode: current.quantityMode, quantity: Number(current.quantity) || 1,
      }));
    }
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
  const etaIssue = termsProblem(terms);
  const canPublish = title.trim().length > 2 && priceMinor >= MIN_PRICE_MINOR && priceMinor <= MAX_PRICE_MINOR && !etaIssue;
  // Everything still standing between this form and a listing, said at once
  // and from the start - not one line at a time beside a button that will not press.
  const basicsNeeded = [
    title.trim().length <= 2 ? 'a title' : null,
    priceMinor < MIN_PRICE_MINOR ? (price ? `a price of at least ${formatMoney(MIN_PRICE_MINOR)}` : 'a price')
      : priceMinor > MAX_PRICE_MINOR ? `a price of at most ${formatMoney(MAX_PRICE_MINOR)}` : null,
    etaIssue ? 'a delivery time' : null,
  ].filter((text): text is string => Boolean(text));
  // The category's required questions are asked after the first press of
  // Publish, with the unanswered ones marked, rather than leaving a button
  // that will not press.
  const missing = missingFields(category, attributes);
  // The grade the rest of the app understands, derived from the category's own
  // wording ("Deadstock", "New with tags") rather than asked for twice.
  const condition = conditionTagFor(category, attributes) ?? 'LOOSE';
  const facts = factsOf({ category, condition, attributes });
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
      terms.advance ? `${Number(terms.advancePercent) || 20}% advance` : null,
      terms.limited && !deal ? `Ends in ${terms.days} ${Number(terms.days) === 1 ? 'day' : 'days'}` : null,
      terms.affiliate && !deal ? 'Affiliate commission' : null,
      !deal ? (shareToChannel || shareToFeed
        ? `Posts to ${[shareToChannel && 'channel', shareToFeed && 'feed'].filter(Boolean).join(' & ')}`
        : 'Not announced') : null,
      costSheet ? 'Cost sheet' : null,
    ].filter((text): text is string => Boolean(text));
  }

  /** Keep the form with the shop: on the Drafts shelf, on every device. */
  async function saveServerDraft(): Promise<boolean> {
    if (!latest.current) return false;
    setSavingDraft(true);
    setError(null);
    try {
      const result = await api.saveDraft(latest.current, serverDraftId, storeId);
      setServerDraftId(result.draft.id);
      setSavedNote('Draft saved. It is on your Drafts shelf, on any device.');
      return true;
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'The draft did not save.');
      return false;
    } finally {
      setSavingDraft(false);
    }
  }

  /** Not yet verified: keep the form for later, and go and verify. */
  async function saveForLater() {
    // With the shop where it can be, and in this browser either way.
    await saveServerDraft();
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
    if (!canPublish) {
      setTriedPublish(true);
      haptic('error');
      document.querySelector<HTMLElement>(title.trim().length <= 2 ? '#sell-title' : etaIssue && priceMinor >= MIN_PRICE_MINOR && priceMinor <= MAX_PRICE_MINOR ? '#sell-eta input' : '#sell-price')
        ?.focus();
      return;
    }
    if (missing.length > 0) {
      setTriedPublish(true);
      setError(`Still to answer: ${missing.map((field) => field.label.replace(/\?$/, '').toLowerCase()).join(', ')}.`);
      // Straight to the first one, rather than a list to go and look for.
      haptic('error');
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const first = document.querySelector<HTMLElement>('.attr.is-missing');
        if (!first) return;
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        first.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true });
        first.classList.remove('is-nudged');
        void first.offsetWidth;
        first.classList.add('is-nudged');
      }));
      return;
    }
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
        attributes,
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
              whenShort,
              whenFull,
            }
          : null,
        sourcing: effectiveSourcing,
        lotId: shape === 'lot' && lotId ? lotId : null,
        ...(storeId ? { storeId } : {}),
        ...(fromPoll ? { fromPoll: { channelId: fromPoll.channelId, postId: fromPoll.postId, optionId: fromPoll.optionId } } : {}),
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
      const eta = etaOf(terms);
      if (eta) rememberEta(eta);
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
        if (serverDraftId) await api.deleteDraft(serverDraftId, storeId).catch(() => undefined);
        navigate(`/messages/${encodeURIComponent(deal.handle)}?as=${encodeURIComponent(deal.as)}`, { replace: true });
        return;
      }
      published.current = true;
      clearDraft(draftKey);
      // Published, so it is no longer a draft anywhere.
      if (serverDraftId) await api.deleteDraft(serverDraftId, storeId).catch(() => undefined);
      if (another.current) {
        // A clean form for the next one, saying what just went up.
        navigate(`/sell${storeId ? `?store=${encodeURIComponent(storeId)}` : ''}`, { replace: true, state: { listed: { id: listingId, title: title.trim() } } });
        return;
      }
      navigate(`/listing/${listingId}`, { state: { published: true } });
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
            <h1>Open a business</h1>
            <p className="muted">Sell items from a store, ship parcels as a freight forwarder, or take commissions as an artist.</p>
          </div>
        </div>
        <OpenBusinessChooser />
      </main>
    );
  }

  const previewCard = (
    <div className="qloot qloot--new">
      <Thumb seed={title || 'preview'} label={title || 'Your listing'} photo={leadPhoto({ photos })}
        className="thumb qloot__art">
        <RarityRibbon tier="new" />
        <span className="qgrade">{attributes['condition'] ? facts.condition : 'Pick a condition'}</span>
        {preOrderMode && !deal && <span className="qsticker-tag">Pre-order</span>}
      </Thumb>
      {terms.advance && <AdvanceStrip percent={Number(terms.advancePercent) || 20} />}
      <div className="qloot__body">
        <span className="qloot__title">{title || 'Your listing title'}</span>
        <span className="qloot__price">{priceMinor > 0 ? formatMoney(priceMinor) : '₹—'}</span>
        <span className="qloot__meta">
          <b className={effectiveSourcing === 'in_hand' ? 'qok' : ''}>{SOURCING_LABELS[effectiveSourcing]}</b>
          {' · '}{category}
          {facts.authenticity && <>{' · '}<b className={facts.authenticity.genuine ? 'qok' : ''}>{facts.authenticity.label}</b></>}
          {facts.size && <>{' · '}{facts.size}</>}
        </span>
        <span className="qloot__foot">
          <span className="faint">just now</span>
          <span className="qcrest">{user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'You'}</span>
        </span>
      </div>
    </div>
  );

  return (
    <main className="page">
      <BackBar onBack={goBack} title={deal ? `Private deal for ${deal.displayName}` : 'List an item'} />
      <div className="page__head">
        <div>
          <p className="muted">
            {deal
              ? `Only ${deal.displayName} can see and buy this. It never appears in your shop, channel or the feed - once bought it is a normal order.`
              : 'About a minute. You can edit it any time.'}
          </p>
          {copyOf && (
            <p className="dealfrom">
              A copy of <b>{copyOf.title}</b>, photos and all. Change what differs - size, colour, price, how
              many - and publish. <Link to={`/listing/${encodeURIComponent(copyOf.id)}`}>The original</Link> stays as it is.
            </p>
          )}
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

      {justListed && (
        <p className="notice notice--ok" role="status" style={{ marginBottom: 20 }}>
          <b>{justListed.title}</b> is live. <Link to={`/listing/${encodeURIComponent(justListed.id)}`}>See it</Link> - or list the next one below.
        </p>
      )}
      {draftMissing && (
        <p className="notice notice--info" style={{ marginBottom: 20 }}>
          That draft is no longer kept - it was published or deleted. This is a fresh form.
        </p>
      )}

      {fromPoll && (
        <p className="notice notice--ok" style={{ marginBottom: 20 }}>
          🗳️ Stocking <b>{fromPoll.label}</b> from your stock poll. The {fromPoll.voters === 1 ? 'person who' : `${fromPoll.voters} people who`} voted
          for it get first dibs for 24 hours and are told the moment it is listed.
        </p>
      )}

      <div className="sellgrid">
        <form className="sellform" onSubmit={publish}>
          {/* Quick Fill first, because it fills in most of what is below it,
              and already on the last template used. A row of names to tap
              rather than a switch and a dropdown: one tap, and "None" to let
              it go. */}
          {verified && (
            <LBox icon="⚡" title="Quick fill" hint="Start from a quick fill - everything stays editable.">
              <QuickFillPicker templates={templates} value={quickFill ? templateId : ''}
                onPick={(template) => { setTemplateId(template.id); applyTemplate(template); }}
                onNone={() => { setTemplateId(''); setPreLot(null); }} />
              {calcs.length > 0 && (
                <Select value={calc?.id ?? ''} aria-label="From your saved items" onChange={(e) => fillFromSaved(e.target.value)}>
                  <option value="">🧮 Fill from a saved calculation…</option>
                  {calcs.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.title} · {formatMoney(entry.sellingPriceMinor)}{entry.listingId ? ' (listed)' : ''}
                    </option>
                  ))}
                </Select>
              )}
            </LBox>
          )}

          <LBox icon="📸" title="Photos" hint={verified ? 'The first one leads the listing.' : undefined}>
            {verified
              ? <PhotoManager photos={photos} onChange={setPhotos} label={null} />
              : <span className="lbox__hint">Add photos once you are verified - the rest of the draft is kept.</span>}
          </LBox>

          <LBox icon="🏷️" title="The item">
            <label className="field">
              <span>Title</span>
              <input id="sell-title" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder="1/7 scale figure, sealed" aria-invalid={triedPublish && title.trim().length <= 2 ? true : undefined} />
            </label>
            {/* Price and stock side by side: the two numbers every listing has.
                Stock used to sit under "More options", three taps from here. */}
            <div className="field-row sellnums">
              <label className="field">
                <span>Price (₹)</span>
                <input id="sell-price" type="number" min="1" step="1" value={price} inputMode="numeric"
                  onChange={(e) => setPrice(e.target.value)} placeholder="1450"
                  aria-invalid={triedPublish && (priceMinor < MIN_PRICE_MINOR || priceMinor > MAX_PRICE_MINOR) ? true : undefined} />
              </label>
              {!(preOrderMode && !deal) && (
                <div className="field">
                  <label htmlFor="sell-stock">In stock</label>
                  <input id="sell-stock" type="number" inputMode="numeric" min="0" step="1"
                    value={terms.quantityMode === 'multiple' ? '' : terms.quantity}
                    placeholder={terms.quantityMode === 'multiple' ? 'Not counted' : '1'}
                    disabled={terms.quantityMode === 'multiple'}
                    onChange={(e) => setTerms({ ...terms, quantity: e.target.value })} />
                  <label className="checkline">
                    <input type="checkbox" checked={terms.quantityMode === 'multiple'}
                      onChange={(e) => setTerms({ ...terms, quantityMode: e.target.checked ? 'multiple' : 'fixed' })} />
                    No fixed count
                  </label>
                </div>
              )}
            </div>
            <FeeHint kind="shop" priceMinor={priceMinor} />
            {/* What is it? Tags, not a dropdown: every category is visible at
                once, and the line under them says what lives in the one picked. */}
            <div className="field" role="group" aria-label="Category">
              <span>Category</span>
              <div className="tags">
                {CATEGORIES.map((entry) => (
                  <button key={entry} type="button" className={`tag${category === entry ? ' is-on' : ''}`}
                    aria-pressed={category === entry}
                    onClick={() => {
                      setCategory(entry);
                      setAttributes((current) => pruneAttributes(entry, current));
                    }}>
                    {entry}
                  </button>
                ))}
              </div>
              <span className="field__hint">{specFor(category)?.blurb}</span>
            </div>
            {/* The questions this category asks. A shirt has a size and a figure
                has a box grade; one shared form asked everybody the wrong things. */}
            <CategoryFields category={category} value={attributes} onChange={setAttributes}
              showMissing={triedPublish} />
            <label className="field">
              <span>Description</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3}
                placeholder="Condition, what's included…" />
            </label>
            {/* Chips, not a comma-typed line: each tag is one thing to add or
                take off, and the shop's own tags are one tap each. */}
            <TagInput value={splitTags(tags)} onChange={(next) => setTags(next.join(', '))} ideas={tagIdeas}
              hint="Words buyers search for: resin, sealed, 1/7 scale." fullHint="Six tags is the most a listing carries." />
          </LBox>

          {/* One question - where is it? - and the lot only for an import,
              as a choice with "later" first: filing it is bookkeeping the
              shop often does weeks after the item goes up. */}
          <LBox icon="🚚" title="Where is it?">
            <OptionTiles label="Where is it?" value={where} onChange={pickWhere} options={WHERE_OPTIONS} />
            {where === 'import' && (
              <label className="field">
                <span>Lot</span>
                <Select value={shape === 'lot' ? lotId : LOT_LATER} onChange={(e) => pickLot(e.target.value)}>
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
                </Select>
                <span className="field__hint">
                  {shape === 'lot'
                    ? 'Buyers follow this lot’s tracking from the day they order.'
                    : 'Buyers see it as an import; file it into a lot whenever the shipment is packed.'}
                </span>
              </label>
            )}
            {/* The seller is the one who brings an import in, so this is where a forwarder is some use. */}
            {where === 'import' && <ServiceNudge kind="forwarder" lead="Need it shipped in? Compare forwarders" />}
          </LBox>

          {/* Asked of every item, never folded away: it is what buyers ask first. */}
          <div id="sell-eta"><EtaFields value={terms} onChange={setTerms} suggest={shopDays?.delivery[effectiveSourcing] ?? null} sourcing={effectiveSourcing} /></div>

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
                  closes={preOrderDays} onCloses={setPreOrderDays}
                  whenShort={whenShort} onWhenShort={setWhenShort} whenFull={whenFull} onWhenFull={setWhenFull} />
              )}

              <TermsFields value={terms} onChange={setTerms} preOrder={preOrderMode && !deal} privateDeal={Boolean(deal)} priceMinor={priceMinor} withEta={false} withStock={false} />

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

          {savedNote && !error && <p className="notice notice--ok" role="status">{savedNote}</p>}

          {/* Pinned to the bottom of a phone screen, so it is never a scroll away. */}
          <div className="sellform__bar">
            {verified && (basicsNeeded.length > 0 || missing.length > 0) && (
              <p className={`sellform__needs${triedPublish ? ' is-shown' : ''}`} role="status">
                Still needs {[...basicsNeeded, ...missing.map((field) => field.label.replace(/\?$/, '').toLowerCase())].join(', ')}.
              </p>
            )}
            <div className="sellform__btns">
              <button type="button" className="btn btn--ghost sellform__peek" onClick={() => setPeek(true)}>Preview</button>
              {!deal && (
                <button type="button" className="btn btn--ghost" disabled={savingDraft || busy}
                  onClick={() => void saveServerDraft()}>
                  {savingDraft ? 'Saving…' : serverDraftId ? 'Save' : 'Save draft'}
                </button>
              )}
              {verified ? (
                <button type="submit" className="btn btn--lg sellform__go" disabled={busy} onClick={() => { another.current = false; }}>
                  {busy ? (deal ? 'Sending…' : 'Publishing…') : deal ? 'Send private deal' : 'Publish'}
                </button>
              ) : (
                <button type="button" className="btn btn--lg sellform__go" disabled={savingDraft} onClick={() => void saveForLater()}>
                  Save and verify
                </button>
              )}
            </div>
          </div>
          {/* Under the bar rather than in it: the bar stays one row on a phone. */}
          {verified && !deal && (
            <button type="submit" className="linkbtn sellform__again" disabled={busy} onClick={() => { another.current = true; }}>
              Publish and list another
            </button>
          )}
        </form>

        {/* The same card the Buy tab draws, so what the seller sees here is
            what a buyer will scroll past. Beside the form on a wide screen;
            behind the Preview button on a phone, where it used to sit under
            the whole form. */}
        <aside className="sellpreview">
          <span className="lbox__hint">Preview</span>
          {previewCard}
        </aside>
      </div>

      {/* Over the listing, not instead of it: the half-filled form waits
          underneath and the new lot comes back already picked. */}
      {peek && (
        <Modal title="How buyers see it" onClose={() => setPeek(false)}>
          <div className="sellpeek">{previewCard}</div>
        </Modal>
      )}
      {openingLot && (
        <Modal title="New lot" onClose={() => setOpeningLot(false)}>
          <NewLotForm bare
            onCancel={() => setOpeningLot(false)}
            onDone={(lot) => {
              setOpeningLot(false);
              setLotId(lot.id);
              void api.myLots(storeId)
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
