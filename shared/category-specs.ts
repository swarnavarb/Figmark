/**
 * What a seller is asked about each kind of thing.
 *
 * A pair of sneakers, a shirt and a sealed figure are described by different
 * facts. "MISB" means nothing on a hoodie, "UK 8" means nothing on a figure,
 * and "First copy" only means something where copies exist. One shared form
 * that asks everyone the same three questions gets the wrong answers to all of
 * them, so each category carries its own short list of questions here, and the
 * sell form, the buy-page filters and the badges on a card all read from it.
 *
 * What a listing stores is a flat `attributes` map of field key to chosen
 * value. It is deliberately plain strings rather than a typed union: adding an
 * option, a field or a whole category is an edit to this file and nothing
 * stored has to be migrated.
 *
 * `condition` is special. Every option carries a legacy `tag` - the four
 * grades the manifest, the lot tracker and the packing estimate already speak -
 * and the listing's own `condition` column is derived from it, so a "Deadstock"
 * pair of sneakers still counts as MISB everywhere that only knows the old
 * grades.
 */
import type { ConditionTag } from './enums.js';

export interface FieldOption {
  /** What is stored on the listing. */
  value: string;
  /** What is shown. Defaults to the value. */
  label: string;
  /** One line of help, shown under the choice when it is picked. */
  hint?: string;
  /** For `condition` options: the legacy grade this maps to. */
  tag?: ConditionTag;
  /**
   * For `authenticity` options: whether this is the real thing.
   *
   * Drives the colour of the badge and the "genuine / copies" buyer filter, so
   * a copy is never dressed in the colour of an original.
   */
  genuine?: boolean;
  /** Only offered when the listing's `type` is one of these. */
  onlyFor?: readonly string[];
}

export type FieldKind = 'choice' | 'multi' | 'text';

export interface CategoryField {
  key: string;
  label: string;
  kind: FieldKind;
  /** Asked, with no default, and a listing cannot be published without it. */
  required?: boolean;
  options?: readonly FieldOption[];
  placeholder?: string;
  hint?: string;
  /** Only asked when another field has one of these values. */
  when?: { key: string; in: readonly string[] };
  /** Long lists are a menu rather than a row of tags. */
  display?: 'tags' | 'menu';
}

export interface CategorySpec {
  name: string;
  /** One line under the category picker, so the choice explains itself. */
  blurb: string;
  fields: readonly CategoryField[];
}

/** Keys a buyer can narrow by. Anything else is displayed, not filtered. */
export const FILTERABLE_ATTRIBUTES = ['type', 'authenticity', 'size'] as const;
export type FilterableAttribute = (typeof FILTERABLE_ATTRIBUTES)[number];

/* -------------------------------------------------------------------------- */
/* Building blocks                                                            */
/* -------------------------------------------------------------------------- */

/** Plain options whose label is their value. */
const plain = (...values: string[]): FieldOption[] => values.map((value) => ({ value, label: value }));

const opt = (
  value: string,
  extra: Partial<Omit<FieldOption, 'value'>> = {},
): FieldOption => ({ value, label: extra.label ?? value, ...extra });

const genuine = (value: string, hint?: string): FieldOption => opt(value, { genuine: true, hint });
const copy = (value: string, hint?: string): FieldOption => opt(value, { genuine: false, hint });

const AUTH_HINT =
  'Say what it is. Copies are shown to buyers with their own label, never as the real thing.';

const authenticity = (options: FieldOption[], required = true): CategoryField => ({
  key: 'authenticity',
  label: 'Original or copy?',
  kind: 'choice',
  required,
  options,
  hint: AUTH_HINT,
});

const typeField = (options: string[], required = true, label = 'What kind?'): CategoryField => ({
  key: 'type',
  label,
  kind: 'choice',
  required,
  options: plain(...options),
});

const conditionField = (options: FieldOption[], hint?: string): CategoryField => ({
  key: 'condition',
  label: 'Condition',
  kind: 'choice',
  required: true,
  options,
  hint,
});

const text = (
  key: string,
  label: string,
  placeholder: string,
  when?: CategoryField['when'],
  required = false,
): CategoryField => ({ key, label, kind: 'text', placeholder, when, required });

/** Letter sizes, the way shirts and jackets are sold. */
const LETTER_SIZES = plain('XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', 'Free size');

/** UK 3 to 13 in half sizes - the system most Indian buyers read their shoes in. */
const UK_SHOE_SIZES = (() => {
  const sizes: FieldOption[] = [];
  for (let size = 3; size <= 13; size += 0.5) {
    sizes.push({ value: `UK ${size}`, label: `UK ${size}` });
  }
  return sizes;
})();

/* -------------------------------------------------------------------------- */
/* The categories                                                             */
/* -------------------------------------------------------------------------- */

const FIGURE_TYPES = [
  'Action figure',
  'Scale figure',
  'Statue / resin',
  'Nendoroid / chibi',
  'Prize figure',
  'Blind box / gacha',
  'Plush',
];
/** The kinds of figure that come in a scale at all. */
const SCALED_FIGURES = ['Action figure', 'Scale figure', 'Statue / resin'];

export const CATEGORY_SPECS: readonly CategorySpec[] = [
  {
    name: 'Figures',
    blurb: 'Action figures, scale figures, statues, Nendoroids, prize figures, blind boxes and plush.',
    fields: [
      typeField(FIGURE_TYPES),
      conditionField(
        [
          opt('MISB', { label: 'MISB', tag: 'MISB', hint: 'Mint in sealed box - factory seal untouched.' }),
          opt('MIB', { label: 'MIB', tag: 'MIB', hint: 'Mint in box - opened, complete, looks new.' }),
          opt('BIB', { label: 'BIB', tag: 'BIB', hint: 'Box opened - in its box, with signs of handling.' }),
          opt('LOOSE_COMPLETE', {
            label: 'Loose, complete',
            tag: 'LOOSE',
            hint: 'No box, but every accessory is here.',
          }),
          opt('LOOSE', { label: 'Loose', tag: 'LOOSE', hint: 'No box. Say what is missing in the description.' }),
        ],
        'MISB is the top grade. Pick the nearest and use the description for the rest.',
      ),
      {
        key: 'box',
        label: 'Box condition',
        kind: 'choice',
        options: plain('Mint', 'Minor wear', 'Damaged'),
        when: { key: 'condition', in: ['MISB', 'MIB', 'BIB'] },
      },
      authenticity([genuine('Official'), copy('Bootleg')]),
      {
        key: 'scale',
        label: 'Scale',
        kind: 'choice',
        options: plain('1/4', '1/6', '1/7', '1/8', '1/12', 'Non-scale'),
        when: { key: 'type', in: SCALED_FIGURES },
      },
      {
        key: 'release',
        label: 'Release',
        kind: 'choice',
        options: plain('JP', 'CN', 'Global'),
      },
    ],
  },
  {
    name: 'Model kits',
    blurb: 'Gunpla and other plastic kits - sealed, unbuilt or built.',
    fields: [
      typeField(['Gunpla', 'Other model kit']),
      {
        key: 'grade',
        label: 'Gunpla grade',
        kind: 'choice',
        options: plain('SD', 'EG', 'HG', 'RG', 'MG', 'PG', 'Other'),
        when: { key: 'type', in: ['Gunpla'] },
      },
      conditionField([
        opt('SEALED', { label: 'Sealed', tag: 'MISB', hint: 'Box never opened.' }),
        opt('OPEN_UNBUILT', { label: 'Open box, unbuilt', tag: 'MIB', hint: 'Opened, parts untouched on the runners.' }),
        opt('BUILT', { label: 'Built', tag: 'LOOSE' }),
        opt('BUILT_PAINTED', { label: 'Built and painted', tag: 'LOOSE' }),
      ]),
      authenticity([genuine('Official', 'Bandai, Kotobukiya and other licensed makers.'), copy('Third-party / unofficial')]),
      {
        key: 'scale',
        label: 'Scale',
        kind: 'choice',
        options: plain('1/144', '1/100', '1/60', 'Other'),
      },
    ],
  },
  {
    name: 'Trading cards',
    blurb: 'Single cards, sealed packs and boxes, and graded slabs.',
    fields: [
      typeField(['Single card', 'Sealed pack / box', 'Graded slab']),
      {
        key: 'game',
        label: 'Game',
        kind: 'choice',
        options: plain('Pokémon', 'Yu-Gi-Oh!', 'One Piece', 'Dragon Ball', 'Magic', 'Other'),
      },
      conditionField([
        opt('SEALED', { label: 'Factory sealed', tag: 'MISB', onlyFor: ['Sealed pack / box'] }),
        opt('NM', { label: 'Near mint (NM)', tag: 'MIB', onlyFor: ['Single card'], hint: 'Looks pulled yesterday.' }),
        opt('LP', { label: 'Lightly played (LP)', tag: 'BIB', onlyFor: ['Single card'], hint: 'Faint edge or surface wear.' }),
        opt('MP', { label: 'Moderately played (MP)', tag: 'LOOSE', onlyFor: ['Single card'] }),
        opt('HP', { label: 'Heavily played (HP)', tag: 'LOOSE', onlyFor: ['Single card'] }),
        opt('DAMAGED', { label: 'Damaged', tag: 'LOOSE', onlyFor: ['Single card'] }),
        opt('GRADED', { label: 'Graded', tag: 'MIB', onlyFor: ['Graded slab'] }),
      ]),
      text('grade', 'Grade', 'e.g. PSA 10, BGS 9.5', { key: 'type', in: ['Graded slab'] }, true),
      {
        key: 'language',
        label: 'Language',
        kind: 'choice',
        options: plain('Japanese', 'English', 'Chinese', 'Other'),
      },
      authenticity([genuine('Official'), copy('Proxy / custom')]),
    ],
  },
  {
    name: 'Anime merch',
    blurb: 'Keychains, acrylic stands, posters, badges, phone cases, stationery and cosplay.',
    fields: [
      typeField([
        'Keychain / charm',
        'Acrylic stand',
        'Poster / print',
        'Badge / pin',
        'Phone case',
        'Stationery',
        'Cosplay wig / accessory',
        'Cosplay costume',
        'Other',
      ]),
      conditionField([
        opt('NEW_SEALED', { label: 'New, sealed', tag: 'MISB' }),
        opt('NEW', { label: 'New, opened', tag: 'MIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      {
        key: 'size',
        label: 'Size',
        kind: 'choice',
        required: true,
        options: LETTER_SIZES,
        when: { key: 'type', in: ['Cosplay costume'] },
      },
      authenticity([genuine('Official'), copy('Unofficial')]),
    ],
  },
  {
    name: 'Sneakers',
    blurb: 'Sneakers and shoes, with the size and whether they are the real pair.',
    fields: [
      conditionField(
        [
          opt('DEADSTOCK', { label: 'Deadstock', tag: 'MISB', hint: 'Never worn, with the original box.' }),
          opt('VNDS', { label: 'VNDS', tag: 'MIB', hint: 'Very near deadstock - tried on or worn once.' }),
          opt('USED_9', { label: 'Used 9/10', tag: 'BIB' }),
          opt('USED_8', { label: 'Used 8/10', tag: 'LOOSE' }),
          opt('USED_7', { label: 'Used 7/10 or below', tag: 'LOOSE' }),
        ],
      ),
      authenticity([
        genuine('Original'),
        copy('Batch / 1:1', 'A high-grade copy. Label it as one.'),
        copy('First copy'),
        copy('7A'),
      ]),
      {
        key: 'size',
        label: 'Size',
        kind: 'choice',
        required: true,
        options: UK_SHOE_SIZES,
        display: 'menu',
        hint: 'UK size, as printed on the tongue label. Brands run differently - note it if it matters.',
      },
      {
        key: 'for',
        label: 'For',
        kind: 'choice',
        options: plain('Men', 'Women', 'Kids'),
      },
      {
        key: 'box',
        label: 'Box',
        kind: 'choice',
        options: plain('With box', 'Without box'),
      },
    ],
  },
  {
    name: 'Streetwear',
    blurb: 'T-shirts, hoodies, jerseys, jackets, pants and caps.',
    fields: [
      typeField(['T-shirt', 'Hoodie / sweatshirt', 'Jersey', 'Jacket', 'Pants / shorts', 'Cap / accessory']),
      conditionField([
        opt('NWT', { label: 'New with tags', tag: 'MISB' }),
        opt('NWOT', { label: 'New without tags', tag: 'MIB' }),
        opt('USED_LIKE_NEW', { label: 'Used, like new', tag: 'BIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      authenticity([genuine('Original'), copy('First copy'), copy('7A')]),
      {
        key: 'size',
        label: 'Size',
        kind: 'choice',
        required: true,
        options: LETTER_SIZES,
        when: { key: 'type', in: ['T-shirt', 'Hoodie / sweatshirt', 'Jersey', 'Jacket', 'Pants / shorts'] },
        hint: 'Check the label or lay it flat and measure - say which in the description.',
      },
      {
        key: 'fit',
        label: 'Fit',
        kind: 'choice',
        options: plain('Regular', 'Oversized', 'Slim'),
        when: { key: 'type', in: ['T-shirt', 'Hoodie / sweatshirt', 'Jersey', 'Jacket', 'Pants / shorts'] },
      },
    ],
  },
  {
    name: 'Bags & watches',
    blurb: 'Handbags, backpacks, wallets and watches.',
    fields: [
      typeField(['Handbag', 'Backpack / travel bag', 'Wallet / small leather', 'Watch']),
      conditionField([
        opt('NEW_BOXED', { label: 'New, with tags or box', tag: 'MISB' }),
        opt('NEW', { label: 'New', tag: 'MIB' }),
        opt('USED_LIKE_NEW', { label: 'Used, like new', tag: 'BIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      authenticity([
        genuine('Original'),
        copy('Master / premium copy', 'The best copies - still a copy.'),
        copy('First copy'),
        copy('7A'),
        copy('Unbranded', 'No logo, no brand claimed.'),
      ]),
      {
        key: 'size',
        label: 'Size',
        kind: 'choice',
        options: plain('Small', 'Medium', 'Large'),
        when: { key: 'type', in: ['Handbag', 'Backpack / travel bag', 'Wallet / small leather'] },
      },
      text('dimensions', 'Dimensions', 'e.g. 30 × 22 × 10 cm', {
        key: 'type',
        in: ['Handbag', 'Backpack / travel bag', 'Wallet / small leather'],
      }),
      {
        key: 'movement',
        label: 'Movement',
        kind: 'choice',
        options: plain('Quartz', 'Automatic'),
        when: { key: 'type', in: ['Watch'] },
      },
      text('caseSize', 'Case size', 'e.g. 42 mm', { key: 'type', in: ['Watch'] }),
      text('strap', 'Strap / wrist size', 'e.g. fits up to 19 cm wrist', { key: 'type', in: ['Watch'] }),
      {
        key: 'included',
        label: 'Comes with',
        kind: 'multi',
        options: plain('Box', 'Dust bag', 'Papers / card'),
      },
    ],
  },
  {
    name: 'Electronics',
    blurb: 'Earbuds, headphones, smartwatches, speakers and accessories.',
    fields: [
      typeField(['Earbuds', 'Headphones', 'Smartwatch / band', 'Speaker', 'Phone accessory', 'Gaming accessory', 'Other']),
      conditionField([
        opt('SEALED', { label: 'Sealed', tag: 'MISB' }),
        opt('OPEN_BOX', { label: 'Open box', tag: 'MIB', hint: 'Opened, unused or barely used.' }),
        opt('REFURBISHED', { label: 'Refurbished', tag: 'BIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      authenticity([genuine('Original'), copy('First copy')]),
      {
        key: 'warranty',
        label: 'Warranty',
        kind: 'choice',
        options: plain('No warranty', '3 months', '6 months', '1 year or more'),
      },
      text('model', 'Model / colour', 'e.g. AirPods Pro 2, white'),
    ],
  },
  {
    name: 'Beauty',
    blurb: 'Skincare, makeup, fragrance and hair and body care.',
    fields: [
      typeField(['Skincare', 'Makeup', 'Fragrance', 'Hair & body', 'Tools']),
      conditionField([
        opt('SEALED', { label: 'Sealed', tag: 'MISB' }),
        opt('OPEN_BOX', { label: 'Box opened, unused', tag: 'MIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      authenticity([genuine('Original'), copy('First copy')]),
      text('volume', 'Size', 'e.g. 50 ml, 30 g'),
      text('expiry', 'Expiry', 'e.g. Dec 2027'),
      text('shade', 'Shade', 'e.g. 02 Rose'),
    ],
  },
  {
    name: 'Collectibles',
    blurb: 'Vintage toys, limited editions, signed pieces and replicas.',
    fields: [
      typeField(['Vintage toy', 'Limited edition', 'Memorabilia / signed', 'Replica / prop', 'Other']),
      conditionField([
        opt('SEALED', { label: 'Sealed', tag: 'MISB' }),
        opt('BOXED', { label: 'Boxed', tag: 'MIB' }),
        opt('BOX_OPENED', { label: 'Box opened', tag: 'BIB' }),
        opt('LOOSE', { label: 'Loose', tag: 'LOOSE' }),
      ]),
      authenticity([genuine('Original'), copy('Replica')]),
      text('edition', 'Edition number', 'e.g. 123 / 500', { key: 'type', in: ['Limited edition'] }),
    ],
  },
  {
    name: 'Books & manga',
    blurb: 'Manga volumes and box sets, art books, light novels and comics.',
    fields: [
      typeField(['Manga volume', 'Manga box set', 'Art book / guide book', 'Light novel', 'Comic / graphic novel']),
      conditionField([
        opt('NEW_SEALED', { label: 'New, sealed', tag: 'MISB' }),
        opt('NEW', { label: 'New', tag: 'MIB' }),
        opt('USED_LIKE_NEW', { label: 'Used, like new', tag: 'BIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      {
        key: 'language',
        label: 'Language',
        kind: 'choice',
        options: plain('Japanese', 'English', 'Chinese', 'Other'),
      },
      authenticity([genuine('Original print'), copy('Reprint / unofficial')], false),
    ],
  },
  {
    name: 'Games & consoles',
    blurb: 'Consoles, games, controllers and collector’s editions.',
    fields: [
      typeField(['Console', 'Game', 'Controller / accessory', 'Collector’s edition']),
      {
        key: 'platform',
        label: 'Platform',
        kind: 'choice',
        options: plain('Switch', 'PlayStation', 'Xbox', 'PC', 'Retro / handheld', 'Other'),
      },
      conditionField([
        opt('SEALED', { label: 'Sealed', tag: 'MISB' }),
        opt('OPEN_BOX', { label: 'Open box', tag: 'MIB' }),
        opt('USED_LIKE_NEW', { label: 'Used, like new', tag: 'BIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      authenticity([genuine('Original'), copy('First copy')]),
      {
        key: 'region',
        label: 'Region',
        kind: 'choice',
        options: plain('Region free', 'Asia', 'JP', 'US', 'EU'),
        when: { key: 'type', in: ['Game', 'Console', 'Collector’s edition'] },
      },
    ],
  },
  {
    name: 'Home & decor',
    blurb: 'Lamps, wall art, desk decor, display cases and soft furnishings.',
    fields: [
      typeField(['Lamp / lighting', 'Wall art', 'Desk decor', 'Display case / storage', 'Bedding / cushion', 'Other']),
      conditionField([
        opt('NEW_SEALED', { label: 'New, sealed', tag: 'MISB' }),
        opt('NEW', { label: 'New', tag: 'MIB' }),
        opt('USED_LIKE_NEW', { label: 'Used, like new', tag: 'BIB' }),
        opt('USED', { label: 'Used', tag: 'LOOSE' }),
      ]),
      text('dimensions', 'Size', 'e.g. 40 × 30 cm'),
    ],
  },
];

/**
 * Names that older listings carry and no seller can pick any more.
 *
 * "Scale figures" became "Figures" when action figures, statues and blind boxes
 * joined it. Listings already stored under the old name keep it, still reach
 * the same buyer-facing heading, and read as the new category everywhere.
 */
export const LEGACY_CATEGORY_ALIASES: Readonly<Record<string, string>> = {
  'Scale figures': 'Figures',
};

/** The category a stored name stands for, or undefined for one nobody has. */
export function canonicalCategory(name: string | undefined | null): string | undefined {
  if (!name) return undefined;
  const aliased = LEGACY_CATEGORY_ALIASES[name] ?? name;
  return CATEGORY_SPECS.some((spec) => spec.name === aliased) ? aliased : undefined;
}

export function specFor(category: string | undefined | null): CategorySpec | undefined {
  const name = canonicalCategory(category);
  return name ? CATEGORY_SPECS.find((spec) => spec.name === name) : undefined;
}

/* -------------------------------------------------------------------------- */
/* Reading a spec against what has been chosen so far                         */
/* -------------------------------------------------------------------------- */

export type Attributes = Record<string, string>;

/** A field's options once `onlyFor` has been applied to the chosen type. */
export function optionsOf(field: CategoryField, attributes: Attributes): readonly FieldOption[] {
  const type = attributes['type'];
  return (field.options ?? []).filter((option) => !option.onlyFor || (type !== undefined && option.onlyFor.includes(type)));
}

/** The fields worth asking right now: the ones whose condition is met. */
export function visibleFields(category: string | undefined | null, attributes: Attributes): CategoryField[] {
  const spec = specFor(category);
  if (!spec) return [];
  return spec.fields.filter((field) => {
    if (!field.when) return true;
    const current = attributes[field.when.key];
    return current !== undefined && field.when.in.includes(current);
  });
}

/** Multi-choice values are stored as one comma-separated string. */
export const splitMulti = (value: string | undefined): string[] =>
  value ? value.split(',').map((part) => part.trim()).filter(Boolean) : [];

export interface CleanedAttributes {
  attributes: Attributes;
  /** A sentence fit to show the seller, when something required is missing or wrong. */
  error?: string;
}

/**
 * What to store, from whatever was sent.
 *
 * Unknown keys are dropped, values that are not an option are refused, fields
 * that are not being asked right now are discarded (a scale left over from
 * before the seller changed the type to a plush), and required fields must be
 * present. Done here and not in the browser because the browser is only one of
 * the things that can post a listing.
 */
export function cleanAttributes(category: string, raw: unknown): CleanedAttributes {
  const spec = specFor(category);
  const input: Record<string, unknown> =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (!spec) return { attributes: {} };

  // Fields can depend on one another, so settle them in the order the spec
  // lists them: the type first, then everything that asks about it.
  const attributes: Attributes = {};
  for (const field of spec.fields) {
    if (field.when) {
      const current = attributes[field.when.key];
      if (current === undefined || !field.when.in.includes(current)) continue;
    }
    const sent = typeof input[field.key] === 'string' ? (input[field.key] as string).trim() : '';

    if (!sent) {
      if (field.required) return { attributes, error: `Choose ${field.label.toLowerCase().replace(/\?$/, '')} to publish.` };
      continue;
    }

    if (field.kind === 'text') {
      attributes[field.key] = sent.slice(0, 80);
      continue;
    }

    const allowed = optionsOf(field, attributes).map((option) => option.value);
    if (field.kind === 'multi') {
      const picked = splitMulti(sent).filter((value) => allowed.includes(value));
      if (picked.length > 0) attributes[field.key] = allowed.filter((value) => picked.includes(value)).join(', ');
      continue;
    }
    if (!allowed.includes(sent)) {
      return { attributes, error: `That is not an option for ${field.label.toLowerCase().replace(/\?$/, '')}.` };
    }
    attributes[field.key] = sent;
  }
  return { attributes };
}

/* -------------------------------------------------------------------------- */
/* Condition, in one vocabulary                                               */
/* -------------------------------------------------------------------------- */

/**
 * The legacy grade a category's own condition stands for.
 *
 * Null when nothing was chosen (or the category has no condition field), so the
 * caller can fall back to what the client sent.
 */
export function conditionTagFor(category: string, attributes: Attributes): ConditionTag | null {
  const field = specFor(category)?.fields.find((entry) => entry.key === 'condition');
  const chosen = field ? optionsOf(field, attributes).find((option) => option.value === attributes['condition']) : undefined;
  return chosen?.tag ?? null;
}

/**
 * The four grades, in words a buyer who has never heard "MIB" can use.
 *
 * Used wherever the filter or a form has no category to ask about, which is
 * the only time the raw grade is all there is.
 */
export const CONDITION_BUCKETS: Readonly<Record<ConditionTag, { label: string; hint: string }>> = {
  MISB: { label: 'Sealed or new (MISB)', hint: 'Sealed, deadstock or new with tags.' },
  MIB: { label: 'Like new (MIB)', hint: 'Opened or tried on, but looks new.' },
  BIB: { label: 'Good (BIB)', hint: 'Complete, with signs of handling.' },
  LOOSE: { label: 'Used or loose (LOOSE)', hint: 'Used, or without its packaging.' },
};

/* -------------------------------------------------------------------------- */
/* Showing a listing                                                          */
/* -------------------------------------------------------------------------- */

export interface ListingFacts {
  /** The condition in the category's own words, or the legacy grade. */
  condition: string;
  /** Present only where the category asks. `genuine` picks the badge colour. */
  authenticity: { label: string; genuine: boolean } | null;
  /** Size, when there is one: the thing a buyer checks first on clothes and shoes. */
  size: string | null;
  /** Everything else that was filled in, in the order it was asked. */
  details: { label: string; value: string }[];
}

interface FactsShape {
  category: string;
  condition: string;
  attributes?: Attributes | null;
}

/** What to print for one stored value: the option's label, or the value as typed. */
function shown(field: CategoryField, attributes: Attributes, value: string): string {
  if (field.kind === 'multi') {
    return splitMulti(value)
      .map((part) => field.options?.find((option) => option.value === part)?.label ?? part)
      .join(', ');
  }
  return optionsOf(field, attributes).find((option) => option.value === value)?.label ?? value;
}

export function factsOf(listing: FactsShape): ListingFacts {
  const attributes = listing.attributes ?? {};
  const spec = specFor(listing.category);
  const facts: ListingFacts = { condition: listing.condition, authenticity: null, size: null, details: [] };
  if (!spec) return facts;

  for (const field of visibleFields(listing.category, attributes)) {
    const value = attributes[field.key];
    if (!value) continue;
    const label = shown(field, attributes, value);
    if (field.key === 'condition') {
      facts.condition = label;
    } else if (field.key === 'authenticity') {
      const option = field.options?.find((entry) => entry.value === value);
      facts.authenticity = { label, genuine: option?.genuine === true };
    } else {
      if (field.key === 'size') facts.size = label;
      facts.details.push({ label: field.label, value: label });
    }
  }
  return facts;
}

/* -------------------------------------------------------------------------- */
/* Filters                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The options a buyer can filter one attribute by, across some categories.
 *
 * A heading covers several categories, so its size menu is the union of theirs
 * (UK sizes for sneakers, letters for shirts), de-duplicated by value and kept
 * in the order they were first seen.
 */
export function filterOptions(categories: readonly string[], key: FilterableAttribute): FieldOption[] {
  const seen = new Set<string>();
  const found: FieldOption[] = [];
  for (const category of categories) {
    const field = specFor(category)?.fields.find((entry) => entry.key === key);
    for (const option of field?.options ?? []) {
      if (seen.has(option.value)) continue;
      seen.add(option.value);
      found.push(option);
    }
  }
  return found;
}

/** Every authenticity value across every category, split by whether it is the real thing. */
export function authenticityValues(genuineOnly: boolean): string[] {
  const values = new Set<string>();
  for (const spec of CATEGORY_SPECS) {
    const field = spec.fields.find((entry) => entry.key === 'authenticity');
    for (const option of field?.options ?? []) {
      if ((option.genuine === true) === genuineOnly) values.add(option.value);
    }
  }
  return [...values];
}

/* -------------------------------------------------------------------------- */
/* Keeping answers consistent while a form is being filled in                 */
/* -------------------------------------------------------------------------- */

/**
 * The answers that still make sense after one of them changed.
 *
 * Change a Figure from "Action figure" to "Plush" and its scale stops being a
 * question; change a card from "Single card" to "Graded slab" and "Lightly
 * played" stops being an option. The form calls this after every edit so no
 * answer is left behind that the seller can no longer see, and so the thing
 * that gets published is only what was on screen.
 */
export function pruneAttributes(category: string | undefined | null, attributes: Attributes): Attributes {
  const spec = specFor(category);
  if (!spec) return {};
  const next: Attributes = {};
  for (const field of spec.fields) {
    const value = attributes[field.key];
    if (value === undefined || value === '') continue;
    if (field.when) {
      const current = next[field.when.key];
      if (current === undefined || !field.when.in.includes(current)) continue;
    }
    if (field.kind === 'choice') {
      if (!optionsOf(field, next).some((option) => option.value === value)) continue;
    } else if (field.kind === 'multi') {
      const allowed = optionsOf(field, next).map((option) => option.value);
      const kept = splitMulti(value).filter((part) => allowed.includes(part));
      if (kept.length === 0) continue;
      next[field.key] = kept.join(', ');
      continue;
    }
    next[field.key] = value;
  }
  return next;
}

/** The required questions still unanswered, in the order they are asked. */
export function missingFields(category: string | undefined | null, attributes: Attributes): CategoryField[] {
  return visibleFields(category, attributes).filter((field) => field.required && !attributes[field.key]?.trim());
}

/**
 * The category's own condition option for a legacy grade, if it has one.
 *
 * Quick Post templates remember a grade ("MISB"), not a category's wording, so
 * applying one picks the first option of the chosen category that stands for
 * that grade. Undefined when none does - the seller simply picks.
 */
export function conditionValueForTag(
  category: string | undefined | null,
  tag: string | null | undefined,
  attributes: Attributes = {},
): string | undefined {
  if (!tag) return undefined;
  const field = specFor(category)?.fields.find((entry) => entry.key === 'condition');
  return field ? optionsOf(field, attributes).find((option) => option.tag === tag)?.value : undefined;
}
