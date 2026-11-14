import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { CATEGORY_GROUPS, CONDITION_BUCKETS, categoriesIn } from '@shared/catalog';
import { RARITY_LABELS, type RarityTier } from '@shared/quest';
import { ApiRequestError, api } from '../api';
import { useSession } from '../session';
import { formatMoney } from '../format';
import { forgetSearch, forgetViewed, rememberSearch, useRecentSearches, type Viewed } from '../recentViews';
import { Icon } from './Icon';
import { Modal, Thumb } from './ui';
import { Select } from './Select';
import { useToast } from './Feedback';

/* ── Search, on the page itself ────────────────────────────────────────── */

/**
 * The Shop tab's search field.
 *
 * Shop is where somebody who knows what they want comes to find it, so the
 * field sits at the top of the page rather than behind an icon. Focused and
 * empty, it offers the last few searches made on this device.
 */
export function ShopSearch({ value, onSearch }: { value: string; onSearch: (term: string) => void }) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  const recent = useRecentSearches();
  useEffect(() => setText(value), [value]);
  // However the search arrived - typed here, the header's search, a tag - it is remembered.
  useEffect(() => { if (value) rememberSearch(value); }, [value]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch(text.trim());
    (document.activeElement as HTMLElement | null)?.blur();
  }

  const offerRecent = focused && !text && recent.length > 0;
  return (
    <div className="qsearch">
      <form role="search" className="qsearch__form" onSubmit={submit}>
        <span className="qsearch__icon" aria-hidden="true"><Icon name="search" size={17} /></span>
        <input type="search" enterKeyHint="search" value={text} aria-label="Search the shop"
          placeholder="Search figures, sneakers, shops…" autoComplete="off"
          onChange={(event) => setText(event.target.value)}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} />
        {text && (
          <button type="button" className="qsearch__clear" aria-label="Clear search"
            onClick={() => { setText(''); onSearch(''); }}>
            <Icon name="close" size={12} />
          </button>
        )}
      </form>
      {offerRecent && (
        // Pressed before the field loses focus, so the list is still there to be pressed.
        <div className="qsearch__recent" onMouseDown={(event) => event.preventDefault()}>
          <span className="qsearch__recentlabel">Recent</span>
          {recent.map((term) => (
            <span key={term} className="qsearch__term">
              <button type="button" onClick={() => { setText(term); onSearch(term); }}>{term}</button>
              <button type="button" className="qsearch__forget" aria-label={`Forget “${term}”`}
                onClick={() => forgetSearch(term)}><Icon name="close" size={10} /></button>
            </span>
          ))}
          <button type="button" className="qsearch__wipe" onClick={() => forgetSearch()}>Clear</button>
        </div>
      )}
    </div>
  );
}

/* ── Filters: one button, one sheet, and chips for what is on ──────────── */

export interface FilterValues {
  category: string;
  condition: string;
  type: string;
  size: string;
  authenticity: string;
  rarity: string;
  minPrice: string;
  maxPrice: string;
  minTrust: string;
  maxDays: string;
}

type Option = { value: string; label: string };

export const DAY_CHOICES: Option[] = [
  { value: '7', label: 'A week' }, { value: '14', label: '2 weeks' },
  { value: '30', label: 'A month' }, { value: '60', label: '2 months' },
];
export const TRUST_CHOICES: Option[] = [
  { value: '50', label: '50+' }, { value: '65', label: '65+' }, { value: '85', label: '85+' },
];
const PRICE_QUICK = [50_000, 200_000, 1_000_000];

/** How many of the sheet's filters are on, for the button that opens it. */
export function sheetCount(values: FilterValues): number {
  const { minPrice, maxPrice, ...rest } = values;
  return Object.values(rest).filter(Boolean).length + (minPrice || maxPrice ? 1 : 0);
}

/** Rupees typed into a box, as paise for the URL; nothing when it is not a price. */
function paiseOf(rupees: string): string {
  const value = Math.round(Number(rupees) * 100);
  return Number.isFinite(value) && value > 0 ? String(value) : '';
}
const rupeesOf = (paise: string) => (paise ? String(Math.round(Number(paise) / 100)) : '');

/** A label for the price range, as a chip shows it. */
export function priceLabel(minPrice: string, maxPrice: string): string {
  const money = (paise: string) => formatMoney(Number(paise), 'INR');
  if (minPrice && maxPrice) return `${money(minPrice)} – ${money(maxPrice)}`;
  if (maxPrice) return `Under ${money(maxPrice)}`;
  return `${money(minPrice)} and up`;
}

/** One question with a handful of answers, as a row of buttons. "Any" clears it. */
function Choices({ label, value, options, onChange }: {
  label: string; value: string; options: readonly Option[]; onChange: (value: string) => void;
}) {
  return (
    <fieldset className="fsheet__group">
      <legend>{label}</legend>
      <div className="fsheet__choices">
        <button type="button" aria-pressed={!value} className={!value ? 'is-on' : ''} onClick={() => onChange('')}>Any</button>
        {options.map((option) => (
          <button key={option.value} type="button" aria-pressed={value === option.value}
            className={value === option.value ? 'is-on' : ''}
            onClick={() => onChange(value === option.value ? '' : option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** A longer list of answers: the platform's own picker. */
function Pick({ label, value, options, onChange, empty }: {
  label: string; value: string; options: readonly Option[]; onChange: (value: string) => void; empty: string;
}) {
  return (
    <label className="fsheet__group">
      <span className="fsheet__legend">{label}</span>
      <Select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        <option value="">{empty}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
    </label>
  );
}

/**
 * Every filter, in one sheet.
 *
 * Changes land at once - the list behind the sheet is already the answer when
 * it closes - except the price boxes, which wait for the number to be typed.
 */
export function FilterSheet({ values, set, setMany, onClose, total, more, categories, typeOptions, sizeOptions,
  authenticityOptions, rarityCounts }: {
  values: FilterValues;
  set: (key: keyof FilterValues, value: string) => void;
  setMany: (changes: Partial<FilterValues>) => void;
  onClose: () => void;
  total: number;
  /** The count is of what has loaded so far, and there is more. */
  more: boolean;
  categories: string[];
  typeOptions: Option[];
  sizeOptions: Option[];
  authenticityOptions: Option[];
  rarityCounts: Record<RarityTier, number>;
}) {
  const [low, setLow] = useState(rupeesOf(values.minPrice));
  const [high, setHigh] = useState(rupeesOf(values.maxPrice));
  useEffect(() => { setLow(rupeesOf(values.minPrice)); setHigh(rupeesOf(values.maxPrice)); }, [values.minPrice, values.maxPrice]);
  const applyPrice = () => {
    const minPrice = paiseOf(low);
    const maxPrice = paiseOf(high);
    if (minPrice !== values.minPrice || maxPrice !== values.maxPrice) setMany({ minPrice, maxPrice });
  };
  const done = () => { applyPrice(); onClose(); };
  const count = sheetCount(values);

  return (
    <Modal title="Filters" layout="panel" onClose={done}>
      <div className="fsheet">
        <fieldset className="fsheet__group">
          <legend>Price (₹)</legend>
          <div className="fsheet__price">
            <input type="number" inputMode="numeric" min="0" placeholder="Min" aria-label="Lowest price in rupees" value={low}
              onChange={(event) => setLow(event.target.value)} onBlur={applyPrice}
              onKeyDown={(event) => event.key === 'Enter' && applyPrice()} />
            <span aria-hidden="true">–</span>
            <input type="number" inputMode="numeric" min="0" placeholder="Max" aria-label="Highest price in rupees" value={high}
              onChange={(event) => setHigh(event.target.value)} onBlur={applyPrice}
              onKeyDown={(event) => event.key === 'Enter' && applyPrice()} />
          </div>
          <div className="fsheet__choices">
            {PRICE_QUICK.map((paise) => {
              const on = !values.minPrice && values.maxPrice === String(paise);
              return (
                <button key={paise} type="button" aria-pressed={on} className={on ? 'is-on' : ''}
                  onClick={() => setMany(on ? { minPrice: '', maxPrice: '' } : { minPrice: '', maxPrice: String(paise) })}>
                  Under {formatMoney(paise, 'INR')}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Choices label="Condition" value={values.condition} onChange={(value) => set('condition', value)}
          options={CONDITION_TAGS.map((tag) => ({ value: tag, label: CONDITION_BUCKETS[tag].label }))} />
        <Choices label="Original or copy" value={values.authenticity} onChange={(value) => set('authenticity', value)}
          options={authenticityOptions} />
        <Choices label="Arrives within" value={values.maxDays} onChange={(value) => set('maxDays', value)} options={DAY_CHOICES} />
        <Choices label="Shop trust score" value={values.minTrust} onChange={(value) => set('minTrust', value)} options={TRUST_CHOICES} />
        <Choices label="Rarity" value={values.rarity} onChange={(value) => set('rarity', value)}
          options={(['legendary', 'epic', 'new'] as const).map((tier) => ({
            value: tier, label: `${RARITY_LABELS[tier]} · ${rarityCounts[tier]}${more ? '+' : ''}`,
          }))} />
        {categories.length > 1 && (
          <Pick label="Category" value={values.category} onChange={(value) => set('category', value)} empty="Any category"
            options={categories.map((entry) => ({ value: entry, label: entry }))} />
        )}
        {typeOptions.length > 0 && (
          <Pick label="Type" value={values.type} onChange={(value) => set('type', value)} empty="Any type" options={typeOptions} />
        )}
        {sizeOptions.length > 0 && (
          <Pick label="Size" value={values.size} onChange={(value) => set('size', value)} empty="Any size" options={sizeOptions} />
        )}
      </div>
      <div className="fsheet__foot">
        <button type="button" className="btn btn--ghost" disabled={count === 0}
          onClick={() => setMany({
            category: '', condition: '', type: '', size: '', authenticity: '', rarity: '',
            minPrice: '', maxPrice: '', minTrust: '', maxDays: '',
          })}>
          Clear all
        </button>
        <button type="button" className="btn" onClick={done}>
          Show {total}{more ? '+' : ''} {total === 1 && !more ? 'item' : 'items'}
        </button>
      </div>
    </Modal>
  );
}

/** What is filtering the list, each with its own way off. */
export function FilterChips({ chips, onClearAll }: {
  chips: { key: string; label: ReactNode; clear: () => void }[];
  onClearAll: () => void;
}) {
  if (chips.length === 0) return null;
  return (
    <div className="fchips" aria-label="Filters on">
      {chips.map((chip) => (
        <button key={chip.key} type="button" className="fchip" onClick={chip.clear}>
          {chip.label}
          <span className="fchip__x" aria-label="Remove"><Icon name="close" size={10} /></span>
        </button>
      ))}
      {chips.length > 1 && <button type="button" className="fchips__clear" onClick={onClearAll}>Clear all</button>}
    </div>
  );
}

/* ── Save a search: tell me when a shop lists it ───────────────────────── */

const ALL_CATEGORIES = [...new Set(CATEGORY_GROUPS.flatMap((group) => categoriesIn(group.id)))];

/**
 * "Alert me" on a search.
 *
 * Kept as a want, because a want is already what the server holds a new
 * listing up against: a shop listing something that matches tells whoever is
 * looking, and a shop that can get it can offer it. So the search is honest
 * about being posted on the Wanted board rather than pretending to be private.
 */
export function AlertMe({ search, category, maxPrice, condition, seen }: {
  search: string;
  category: string;
  maxPrice: string;
  condition: string;
  /** The categories of what this search found, most common first, to guess the category from. */
  seen: string[];
}) {
  const { gate } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const guess = category || seen[0] || '';
  const [picked, setPicked] = useState(guess);
  useEffect(() => setPicked(guess), [guess]);
  const options = useMemo(() => [...new Set([...seen, ...ALL_CATEGORIES])], [seen]);
  const tooShort = search.trim().length < 3;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await api.postWant({
        title: search.trim(), details: '', category: picked,
        budgetMinor: maxPrice ? Number(maxPrice) : null, condition: condition || null,
      });
      setOpen(false);
      toast(`Saved. You'll be told when a shop lists “${search.trim()}”.`, 'ok');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'That did not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" className="btn btn--ghost btn--sm qalert" disabled={tooShort}
        title={tooShort ? 'Search for at least 3 letters first' : undefined}
        onClick={gate(() => setOpen(true), 'Sign in to be told when it is listed.')}>
        <Icon name="bell" size={14} /> Alert me
      </button>
      {open && (
        <Modal title="Tell me when it's listed" onClose={() => setOpen(false)}>
          <div className="stack" style={{ gap: 12 }}>
            <p className="faint" style={{ margin: 0 }}>
              When a shop lists <b>“{search.trim()}”</b>
              {maxPrice ? <> under <b>{formatMoney(Number(maxPrice), 'INR')}</b></> : null}, you get a notification.
            </p>
            <label className="field">
              <span>Category</span>
              <Select value={picked} onChange={(event) => setPicked(event.target.value)} aria-label="Category">
                <option value="" disabled>Pick a category</option>
                {options.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
              </Select>
            </label>
            <p className="faint" style={{ margin: 0, fontSize: 'var(--t-xs)' }}>
              This is posted as a want on the <Link to="/social?view=wanted">Wanted board</Link>, so shops can also offer
              you one. Close it there whenever you like.
            </p>
            {error && <p className="notice notice--error">{error}</p>}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" className="btn" disabled={busy || !picked} onClick={() => void save()}>
                {busy ? 'Saving…' : 'Alert me'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ── Recently viewed ───────────────────────────────────────────────────── */

/** The items opened lately on this device, to pick up where they left off. */
export function RecentRail({ items }: { items: Viewed[] }) {
  if (items.length === 0) return null;
  return (
    <section className="qrecent" aria-label="Recently viewed">
      <div className="qrecent__head">
        <h2>Recently viewed</h2>
        <button type="button" className="qrecent__clear" onClick={forgetViewed}>Clear</button>
      </div>
      <div className="qrecent__track">
        {items.map((item) => (
          <Link key={item.id} to={`/listing/${item.id}`} className="qrecent__item">
            <Thumb seed={item.id} label={item.title} photo={item.photo ? { url: item.photo } : null} className="thumb qrecent__art" />
            <span className="qrecent__title">{item.title}</span>
            <b className="qrecent__price">{formatMoney(item.priceMinor, item.currency)}</b>
          </Link>
        ))}
      </div>
    </section>
  );
}
