import type { Listing } from '../../../shared/models.js';
import { conditionTagFor, optionsOf, specFor, visibleFields, type Attributes } from '../../../shared/category-specs.js';
import { seedArt } from './seed.js';

/**
 * A test catalogue: something on the shelf for every question the sell form
 * asks.
 *
 * Every category, every kind within it, and between them every condition,
 * original-or-copy answer, size and other choice the category offers - so each
 * filter chip, badge and detail row has a listing behind it to look at. On top
 * of that, one listing for each way a listing can behave: pre-order, mixed lot,
 * import, expiring, part payment, price drop, sold out, restocked, bumped,
 * open-ended stock, dropped in a channel; and the demo account's own listings
 * in every status, so My Listings has a draft, an archived and a sold-out row.
 *
 * The answers are dealt from the spec rather than typed, so a row cannot carry
 * an option the form would refuse, and adding an option to a category puts it
 * on the shelf here the next time the fixtures top up. Ids are stable, so the
 * top-up only ever adds what is missing.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const from = (base: number, ms: number) => new Date(base + ms).toISOString();

type Variant =
  | 'pre_order' | 'bundle' | 'import' | 'expiring' | 'advance' | 'price_drop' | 'sold_out'
  | 'restocked' | 'bumped' | 'multiple' | 'last_one' | 'channel_drop' | 'draft' | 'archived';

interface Row {
  id: string;
  category: string;
  /** The `type` answer, for categories that ask one. */
  type?: string;
  title: string;
  /** Rupees; stored in paise. */
  price: number;
  /** Answers to pin rather than deal - a size the title names, a grade. */
  set?: Attributes;
  variant?: Variant;
  sellerId?: string;
}

/** Who sells each category when a row does not say. */
const SELLER: Record<string, string> = {
  'Figures': 'usr_kaiju',
  'Model kits': 'usr_tokyoline',
  'Trading cards': 'usr_tokyoline',
  'Anime merch': 'usr_tokyoline',
  'Sneakers': 'usr_sneakervault',
  'Streetwear': 'usr_courtside',
  'Bags & watches': 'usr_courtside',
  'Electronics': 'usr_gadgetgrid',
  'Beauty': 'usr_gadgetgrid',
  'Collectibles': 'usr_kaiju',
  'Books & manga': 'usr_tokyoline',
  'Games & consoles': 'usr_gadgetgrid',
  'Home & decor': 'usr_courtside',
};

const ROWS: Row[] = [
  /* Figures: six kinds, five conditions, three box states, eleven scales. */
  { id: 'lst_t_fig_1', category: 'Figures', type: 'Action figure', title: 'S.H.Figuarts Vegeta — Saiyan armour', price: 5_400, variant: 'pre_order' },
  { id: 'lst_t_fig_2', category: 'Figures', type: 'Statue / figurine', title: 'Rem 1/7 — crystal dress statue', price: 18_500 },
  { id: 'lst_t_fig_3', category: 'Figures', type: 'Nendoroid / chibi', title: 'Nendoroid Anya Forger', price: 3_900 },
  { id: 'lst_t_fig_4', category: 'Figures', type: 'Prize figure', title: 'Banpresto Luffy Gear 5 — prize figure', price: 2_200 },
  { id: 'lst_t_fig_5', category: 'Figures', type: 'Blind box / gacha', title: 'Pop Mart Labubu — sealed blind box', price: 1_800, variant: 'multiple' },
  { id: 'lst_t_fig_6', category: 'Figures', type: 'Plush', title: 'Pikachu plush — Pokémon Center Japan', price: 2_600 },
  { id: 'lst_t_fig_7', category: 'Figures', type: 'Action figure', title: 'Figma Link — Tears of the Kingdom', price: 9_200, variant: 'price_drop' },
  { id: 'lst_t_fig_8', category: 'Figures', type: 'Statue / figurine', title: 'Bootleg Zoro statue — sold as a copy', price: 1_500 },
  { id: 'lst_t_fig_9', category: 'Figures', type: 'Action figure', title: 'Marvel Legends Spider-Man 2099', price: 2_900, variant: 'bumped' },
  { id: 'lst_t_fig_10', category: 'Figures', type: 'Statue / figurine', title: 'Prime 1 Batman bust — 1/4', price: 64_000, variant: 'advance' },
  { id: 'lst_t_fig_11', category: 'Figures', type: 'Action figure', title: 'Hot Toys Iron Man Mark 85 — 1/6', price: 38_000 },
  { id: 'lst_t_fig_12', category: 'Figures', type: 'Statue / figurine', title: 'Kotobukiya ARTFX Hatsune Miku', price: 11_500 },
  { id: 'lst_t_fig_13', category: 'Figures', type: 'Action figure', title: 'Revoltech Evangelion Unit-02', price: 7_800 },
  { id: 'lst_t_fig_14', category: 'Figures', type: 'Statue / figurine', title: 'Diorama — 1/64 Initial D garage', price: 4_400 },
  { id: 'lst_t_fig_15', category: 'Figures', type: 'Action figure', title: 'Mafex Batman — Hush', price: 8_900 },
  { id: 'lst_t_fig_16', category: 'Figures', type: 'Statue / figurine', title: 'Gojo Satoru — non-scale statue', price: 6_300 },

  /* Model kits: both kinds, every Gunpla grade, all four conditions and scales. */
  { id: 'lst_t_kit_1', category: 'Model kits', type: 'Gunpla', title: 'SD Gundam Cross Silhouette — Unicorn', price: 1_200 },
  { id: 'lst_t_kit_2', category: 'Model kits', type: 'Gunpla', title: 'EG RX-78-2 — entry grade', price: 900, variant: 'multiple' },
  { id: 'lst_t_kit_3', category: 'Model kits', type: 'Gunpla', title: 'HG Gundam Calibarn — built', price: 2_400 },
  { id: 'lst_t_kit_4', category: 'Model kits', type: 'Gunpla', title: 'RG Nu Gundam — built and painted', price: 6_800 },
  { id: 'lst_t_kit_5', category: 'Model kits', type: 'Gunpla', title: 'MG Sazabi Ver.Ka', price: 9_800, variant: 'import' },
  { id: 'lst_t_kit_6', category: 'Model kits', type: 'Gunpla', title: 'PG Unleashed Strike Freedom', price: 28_000 },
  { id: 'lst_t_kit_7', category: 'Model kits', type: 'Gunpla', title: 'Third-party MG Exia — Daban copy', price: 2_100 },
  { id: 'lst_t_kit_8', category: 'Model kits', type: 'Other model kit', title: 'Tamiya 1/24 Nissan GT-R kit', price: 3_600 },

  /* Trading cards: every condition is only offered for one kind, so each gets its own. */
  { id: 'lst_t_card_1', category: 'Trading cards', type: 'Single card', title: 'Charizard ex SAR — Pokémon 151', price: 7_500 },
  { id: 'lst_t_card_2', category: 'Trading cards', type: 'Single card', title: 'Blue-Eyes White Dragon — LOB 1st', price: 12_000 },
  { id: 'lst_t_card_3', category: 'Trading cards', type: 'Single card', title: 'Luffy Leader alt art — OP-05', price: 3_200 },
  { id: 'lst_t_card_4', category: 'Trading cards', type: 'Single card', title: 'Black Lotus proxy — custom art', price: 400 },
  { id: 'lst_t_card_5', category: 'Trading cards', type: 'Single card', title: 'Goku SCR — Fusion World', price: 1_600 },
  { id: 'lst_t_card_6', category: 'Trading cards', type: 'Sealed pack / box', title: 'Pokémon Terastal Festival — sealed box', price: 6_500, variant: 'expiring' },
  { id: 'lst_t_card_7', category: 'Trading cards', type: 'Graded slab', title: 'Pikachu Illustrator promo — PSA 10', price: 85_000, set: { grade: 'PSA 10' } },
  { id: 'lst_t_card_8', category: 'Trading cards', type: 'Graded slab', title: 'Dark Magician Girl — BGS 9.5', price: 24_000, set: { grade: 'BGS 9.5' } },

  /* Anime merch: nine kinds, one of them sized. */
  { id: 'lst_t_merch_1', category: 'Anime merch', type: 'Keychain / charm', title: 'Spy x Family keychain set — 6 pieces', price: 650, variant: 'bundle' },
  { id: 'lst_t_merch_2', category: 'Anime merch', type: 'Acrylic stand', title: 'Frieren acrylic stand — Animate exclusive', price: 1_100 },
  { id: 'lst_t_merch_3', category: 'Anime merch', type: 'Poster / print', title: 'Ghibli poster — Spirited Away B2', price: 850 },
  { id: 'lst_t_merch_4', category: 'Anime merch', type: 'Badge / pin', title: 'Jujutsu Kaisen can badges — blind pack', price: 300, variant: 'multiple' },
  { id: 'lst_t_merch_5', category: 'Anime merch', type: 'Phone case', title: 'Chainsaw Man phone case — iPhone 15', price: 700 },
  { id: 'lst_t_merch_6', category: 'Anime merch', type: 'Stationery', title: 'Sanrio stationery set', price: 550 },
  { id: 'lst_t_merch_7', category: 'Anime merch', type: 'Cosplay wig / accessory', title: 'Nezuko bamboo muzzle and wig', price: 1_400 },
  { id: 'lst_t_merch_8', category: 'Anime merch', type: 'Cosplay costume', title: 'Demon Slayer Tanjiro costume — full set', price: 3_800 },
  { id: 'lst_t_merch_9', category: 'Anime merch', type: 'Other', title: 'Totoro umbrella — Donguri Republic', price: 2_300 },

  /* Sneakers: no kinds, so the rows deal conditions, copies and sizes. */
  { id: 'lst_t_snk_1', category: 'Sneakers', title: 'Jordan 1 High "Chicago Lost & Found" — UK 9', price: 32_000, set: { size: 'UK 9' } },
  { id: 'lst_t_snk_2', category: 'Sneakers', title: 'Dunk Low "Grey Fog" — UK 7', price: 11_500, set: { size: 'UK 7' } },
  { id: 'lst_t_snk_3', category: 'Sneakers', title: 'Adidas Samba OG — UK 6, women', price: 8_200, set: { size: 'UK 6', for: 'Women' } },
  { id: 'lst_t_snk_4', category: 'Sneakers', title: 'Yeezy 350 "Zebra" — UK 10', price: 6_500, set: { size: 'UK 10' } },
  { id: 'lst_t_snk_5', category: 'Sneakers', title: 'New Balance 550 — UK 8, worn', price: 4_200, set: { size: 'UK 8' } },
  { id: 'lst_t_snk_6', category: 'Sneakers', title: 'Air Force 1 — kids UK 3', price: 3_100, set: { size: 'UK 3', for: 'Kids' } },
  { id: 'lst_t_snk_7', category: 'Sneakers', title: 'Asics Gel-Kayano 14 — UK 11.5', price: 12_800, set: { size: 'UK 11.5' }, variant: 'last_one' },
  { id: 'lst_t_snk_8', category: 'Sneakers', title: 'Travis Scott Jordan 1 Low "Mocha" — UK 13', price: 95_000, set: { size: 'UK 13' } },

  /* Streetwear: six kinds; the cap has no size. */
  { id: 'lst_t_st_1', category: 'Streetwear', type: 'T-shirt', title: 'Supreme box logo tee — white', price: 9_500 },
  { id: 'lst_t_st_2', category: 'Streetwear', type: 'Hoodie / sweatshirt', title: 'Essentials hoodie — oatmeal', price: 6_800 },
  { id: 'lst_t_st_3', category: 'Streetwear', type: 'Jersey', title: 'Argentina 2022 home jersey — Messi 10', price: 3_400 },
  { id: 'lst_t_st_4', category: 'Streetwear', type: 'Jacket', title: 'Stüssy varsity jacket', price: 14_000 },
  { id: 'lst_t_st_5', category: 'Streetwear', type: 'Pants / shorts', title: 'Carhartt double knee pants', price: 5_600 },
  { id: 'lst_t_st_6', category: 'Streetwear', type: 'Cap / accessory', title: 'New Era 59FIFTY — Yankees', price: 2_900, variant: 'restocked' },
  { id: 'lst_t_st_7', category: 'Streetwear', type: 'T-shirt', title: 'Bape camo tee — oversized', price: 7_200 },
  { id: 'lst_t_st_8', category: 'Streetwear', type: 'Hoodie / sweatshirt', title: 'Corteiz hoodie — free size', price: 8_400, set: { size: 'Free size' } },

  /* Bags & watches: four kinds, five authenticity answers. */
  { id: 'lst_t_bag_1', category: 'Bags & watches', type: 'Handbag', title: 'Coach Tabby shoulder bag 26', price: 22_000, set: { dimensions: '26 × 16 × 8 cm' } },
  { id: 'lst_t_bag_2', category: 'Bags & watches', type: 'Backpack / travel bag', title: 'Anello large backpack — Japan', price: 3_900, set: { dimensions: '42 × 30 × 15 cm' } },
  { id: 'lst_t_bag_3', category: 'Bags & watches', type: 'Wallet / small leather', title: 'Card holder — leather, monogram', price: 1_800 },
  { id: 'lst_t_bag_4', category: 'Bags & watches', type: 'Watch', title: 'Casio G-Shock GA-2100 — CasiOak', price: 8_900, set: { caseSize: '45 mm', strap: 'fits up to 20 cm wrist' } },
  { id: 'lst_t_bag_5', category: 'Bags & watches', type: 'Watch', title: 'Seiko 5 Sports SRPD — automatic', price: 19_500, set: { caseSize: '42.5 mm' }, variant: 'advance' },
  { id: 'lst_t_bag_6', category: 'Bags & watches', type: 'Handbag', title: 'Unbranded quilted crossbody', price: 1_200 },

  /* Electronics: seven kinds, four conditions, four warranties. */
  { id: 'lst_t_el_1', category: 'Electronics', type: 'Earbuds', title: 'AirPods Pro 2 — USB-C', price: 19_900, set: { model: 'AirPods Pro 2, white' } },
  { id: 'lst_t_el_2', category: 'Electronics', type: 'Headphones', title: 'Sony WH-1000XM5 — open box', price: 24_500, set: { model: 'WH-1000XM5, black' } },
  { id: 'lst_t_el_3', category: 'Electronics', type: 'Smartwatch / band', title: 'Galaxy Watch 6 — refurbished', price: 14_000 },
  { id: 'lst_t_el_4', category: 'Electronics', type: 'Speaker', title: 'JBL Flip 6 — used', price: 6_200, variant: 'sold_out' },
  { id: 'lst_t_el_5', category: 'Electronics', type: 'Phone accessory', title: 'Anker MagSafe power bank 10K', price: 3_400, variant: 'multiple' },
  { id: 'lst_t_el_6', category: 'Electronics', type: 'Gaming accessory', title: '8BitDo Ultimate controller', price: 4_100 },
  { id: 'lst_t_el_7', category: 'Electronics', type: 'Other', title: 'Fujifilm Instax Mini 12', price: 6_900, variant: 'channel_drop' },

  /* Beauty: five kinds, with the three text answers filled in. */
  { id: 'lst_t_bty_1', category: 'Beauty', type: 'Skincare', title: 'COSRX snail mucin essence', price: 1_350, set: { volume: '100 ml', expiry: 'Mar 2028' } },
  { id: 'lst_t_bty_2', category: 'Beauty', type: 'Makeup', title: 'Rom&nd Juicy Lasting Tint', price: 850, set: { shade: '06 Figfig', expiry: 'Jan 2028' } },
  { id: 'lst_t_bty_3', category: 'Beauty', type: 'Fragrance', title: 'Le Labo Santal 33 — decant', price: 2_800, set: { volume: '10 ml' } },
  { id: 'lst_t_bty_4', category: 'Beauty', type: 'Hair & body', title: 'Shiseido Fino hair mask', price: 900, set: { volume: '230 g' }, variant: 'import' },
  { id: 'lst_t_bty_5', category: 'Beauty', type: 'Tools', title: 'Dyson Airwrap copy — sold as one', price: 4_500 },

  /* Collectibles: five kinds, the limited edition numbered. */
  { id: 'lst_t_col_1', category: 'Collectibles', type: 'Vintage toy', title: 'Tamagotchi — 1997 original', price: 7_800 },
  { id: 'lst_t_col_2', category: 'Collectibles', type: 'Limited edition', title: 'Bearbrick 1000% — numbered', price: 48_000, set: { edition: '212 / 500' } },
  { id: 'lst_t_col_3', category: 'Collectibles', type: 'Memorabilia / signed', title: 'Signed cricket bat — 2011 squad', price: 1_25_000 },
  { id: 'lst_t_col_4', category: 'Collectibles', type: 'Replica / prop', title: 'Mjolnir replica — 1:1', price: 9_500 },
  { id: 'lst_t_col_5', category: 'Collectibles', type: 'Other', title: 'Coin set — Japanese mint 2020', price: 3_300 },

  /* Books & manga: five kinds. Authenticity is optional here, so one row skips it. */
  { id: 'lst_t_book_1', category: 'Books & manga', type: 'Manga volume', title: 'One Piece vol. 107 — Japanese', price: 650 },
  { id: 'lst_t_book_2', category: 'Books & manga', type: 'Manga box set', title: 'Attack on Titan complete box set', price: 12_500, variant: 'pre_order' },
  { id: 'lst_t_book_3', category: 'Books & manga', type: 'Art book / guide book', title: 'The Art of Arcane', price: 4_200 },
  { id: 'lst_t_book_4', category: 'Books & manga', type: 'Light novel', title: 'Spice and Wolf vol. 1 — English', price: 900, set: { authenticity: '' } },
  { id: 'lst_t_book_5', category: 'Books & manga', type: 'Comic / graphic novel', title: 'Watchmen — absolute edition', price: 6_800 },

  /* Games & consoles: four kinds, six platforms, five regions. */
  { id: 'lst_t_game_1', category: 'Games & consoles', type: 'Console', title: 'Nintendo Switch OLED — Japanese', price: 26_000 },
  { id: 'lst_t_game_2', category: 'Games & consoles', type: 'Game', title: 'Elden Ring — PS5', price: 2_900 },
  { id: 'lst_t_game_3', category: 'Games & consoles', type: 'Controller / accessory', title: 'Xbox Elite Series 2', price: 11_000 },
  { id: 'lst_t_game_4', category: 'Games & consoles', type: 'Collector’s edition', title: 'Starfield Constellation edition', price: 22_000 },
  { id: 'lst_t_game_5', category: 'Games & consoles', type: 'Game', title: 'Retro cartridge lot — Game Boy, 10 games', price: 8_000, variant: 'bundle' },
  { id: 'lst_t_game_6', category: 'Games & consoles', type: 'Console', title: 'Anbernic RG35XX — handheld', price: 5_600 },

  /* Home & decor: six kinds, and no authenticity question at all. */
  { id: 'lst_t_home_1', category: 'Home & decor', type: 'Lamp / lighting', title: 'Moon lamp — 3D printed, 15 cm', price: 1_400, set: { dimensions: '15 cm' } },
  { id: 'lst_t_home_2', category: 'Home & decor', type: 'Wall art', title: 'Neon sign — custom anime logo', price: 4_800, set: { dimensions: '60 × 30 cm' } },
  { id: 'lst_t_home_3', category: 'Home & decor', type: 'Desk decor', title: 'Mechanical keyboard deskmat — Wave', price: 1_200 },
  { id: 'lst_t_home_4', category: 'Home & decor', type: 'Display case / storage', title: 'Acrylic display case for Nendoroids', price: 2_200, set: { dimensions: '30 × 20 × 20 cm' } },
  { id: 'lst_t_home_5', category: 'Home & decor', type: 'Bedding / cushion', title: 'Kirby cushion — 40 cm', price: 1_600 },
  { id: 'lst_t_home_6', category: 'Home & decor', type: 'Other', title: 'Ghibli soot sprite planter', price: 750 },

  /* The demo account's own listings, one in each status, for My Listings. */
  { id: 'lst_t_my_draft', category: 'Figures', type: 'Nendoroid / chibi', title: 'Nendoroid Gojo — not published yet', price: 4_100, variant: 'draft', sellerId: 'usr_demo' },
  { id: 'lst_t_my_archived', category: 'Sneakers', title: 'Converse Chuck 70 — UK 8, archived', price: 3_500, set: { size: 'UK 8' }, variant: 'archived', sellerId: 'usr_demo' },
  { id: 'lst_t_my_soldout', category: 'Trading cards', type: 'Sealed pack / box', title: 'One Piece OP-07 booster box — sold out', price: 7_200, variant: 'sold_out', sellerId: 'usr_demo' },
  { id: 'lst_t_my_preorder', category: 'Model kits', type: 'Gunpla', title: 'HG Gquuuuuux — pre-order', price: 2_600, variant: 'pre_order', sellerId: 'usr_demo' },
  { id: 'lst_t_my_active', category: 'Streetwear', type: 'Hoodie / sweatshirt', title: 'Figmark logo hoodie — M', price: 1_999, set: { size: 'M' }, variant: 'multiple', sellerId: 'usr_demo' },
];

/** Sample answers for the free-text questions a row does not pin. */
const TEXT: Record<string, string> = {
  grade: 'PSA 9',
  dimensions: '30 × 20 × 10 cm',
  caseSize: '40 mm',
  strap: 'fits up to 18 cm wrist',
  model: 'Black',
  volume: '50 ml',
  expiry: 'Dec 2027',
  shade: '01 Natural',
  edition: '1 / 100',
};

/** Gradients for the photos, by category, so a grid reads at a glance. */
const ART: Record<string, [string, string]> = {
  'Figures': ['#7C3AED', '#EC4899'],
  'Model kits': ['#2563EB', '#06B6D4'],
  'Trading cards': ['#F59E0B', '#EF4444'],
  'Anime merch': ['#DB2777', '#F472B6'],
  'Sneakers': ['#111827', '#6B7280'],
  'Streetwear': ['#065F46', '#10B981'],
  'Bags & watches': ['#78350F', '#D97706'],
  'Electronics': ['#1E3A8A', '#3B82F6'],
  'Beauty': ['#BE185D', '#FBCFE8'],
  'Collectibles': ['#4C1D95', '#A78BFA'],
  'Books & manga': ['#7F1D1D', '#F87171'],
  'Games & consoles': ['#14532D', '#84CC16'],
  'Home & decor': ['#92400E', '#FCD34D'],
};

/**
 * Every row's answers, dealt in turn.
 *
 * Each choice question keeps its own counter per category (and per kind, where
 * the options depend on the kind), so successive rows walk through the
 * options and the category's rows between them show every one. Fields are
 * settled in spec order, so a question that depends on another - a scale on a
 * statue, a size on a costume - is asked only once its condition is met.
 */
function dealAttributes(rows: Row[]): Map<string, Attributes> {
  const turns = new Map<string, number>();
  const dealt = new Map<string, Attributes>();
  for (const row of rows) {
    const attributes: Attributes = row.type ? { type: row.type } : {};
    const spec = specFor(row.category);
    for (const field of spec?.fields ?? []) {
      if (field.key === 'type' || !visibleFields(row.category, attributes).includes(field)) continue;
      const pinned = row.set?.[field.key];
      if (pinned !== undefined) {
        if (pinned) attributes[field.key] = pinned;
        continue;
      }
      if (field.kind === 'text') {
        if (field.required) attributes[field.key] = TEXT[field.key] ?? '—';
        continue;
      }
      const options = optionsOf(field, attributes);
      if (options.length === 0) continue;
      const counter = `${row.category}:${field.key}:${options.map((option) => option.value).join('|')}`;
      const turn = turns.get(counter) ?? 0;
      turns.set(counter, turn + 1);
      attributes[field.key] = field.kind === 'multi'
        ? options.slice(0, (turn % options.length) + 1).map((option) => option.value).join(', ')
        : options[turn % options.length]!.value;
    }
    dealt.set(row.id, attributes);
  }
  return dealt;
}

function describe(row: Row, attributes: Attributes): string {
  const facts = visibleFields(row.category, attributes)
    .filter((field) => attributes[field.key])
    .map((field) => {
      const option = field.options?.find((one) => one.value === attributes[field.key]);
      return `${field.label}: ${option?.label ?? attributes[field.key]}`;
    });
  return `Test listing for ${row.category}${row.type ? ` › ${row.type}` : ''}. ${facts.join(' · ')}.`;
}

export function seedTestListings(base = Date.now()): Listing[] {
  const dealt = dealAttributes(ROWS);
  return ROWS.map((row, index): Listing => {
    const attributes = dealt.get(row.id)!;
    const variant = row.variant;
    const priceMinor = row.price * 100;
    const created = from(base, -((index % 20) + 1) * DAY);
    const [art1, art2] = ART[row.category] ?? ['#334155', '#94A3B8'];
    const import_ = variant === 'import' || variant === 'pre_order';
    const quantity = variant === 'sold_out' ? 0 : variant === 'last_one' || variant === 'bundle' ? 1 : 3 + (index % 7);
    return {
      id: row.id,
      sellerId: row.sellerId ?? SELLER[row.category] ?? 'usr_tokyoline',
      title: row.title,
      description: describe(row, attributes),
      category: row.category,
      condition: conditionTagFor(row.category, attributes) ?? 'MIB',
      attributes,
      status: variant === 'draft' ? 'draft' : variant === 'archived' ? 'archived' : variant === 'sold_out' ? 'sold_out' : 'active',
      priceMinor,
      currency: 'INR',
      quantityAvailable: quantity,
      ...(variant === 'multiple' ? { quantityMode: 'multiple' as const } : {}),
      ...(variant === 'expiring' ? { expiresAt: from(base, 5 * HOUR) } : {}),
      ...(variant === 'advance' ? { advancePercent: 30 } : {}),
      preOrder: variant === 'pre_order'
        ? { fillThreshold: 10, filledCount: 0, pledgedCount: 0, cutoffAt: from(base, 21 * DAY) }
        : null,
      lotId: null,
      sourcing: import_ ? 'import' : 'in_hand',
      bundle: variant === 'bundle',
      ...(variant === 'channel_drop' ? { channelDrop: true } : {}),
      photos: [
        { blobName: `${row.id}_1`, url: seedArt([row.title.split(' — ')[0]!.slice(0, 22), art1, art2], index * 2), imageHash: null, isPrimary: true },
        { blobName: `${row.id}_2`, url: seedArt([row.category, art2, art1], index * 2 + 1), imageHash: null, isPrimary: false },
      ],
      tags: ['test', row.category.toLowerCase(), ...(row.type ? [row.type.toLowerCase()] : []), ...(variant ? [variant.replace('_', '-')] : [])],
      likeCount: (index * 7) % 40,
      viewCount: 20 + ((index * 37) % 400),
      soldCount: variant === 'sold_out' ? 4 : index % 4,
      ...(variant === 'price_drop'
        ? { priceHistory: [{ priceMinor: Math.round(priceMinor * 1.25), at: created }, { priceMinor, at: from(base, -1 * DAY) }] }
        : {}),
      ...(variant === 'restocked' ? { restockedAt: from(base, -2 * HOUR) } : {}),
      bumpedAt: variant === 'bumped' ? from(base, -30 * 60_000) : null,
      createdAt: created,
      updatedAt: created,
    };
  });
}

