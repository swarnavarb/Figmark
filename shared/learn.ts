/**
 * The Learn guide: side tabs, each with sections, each with numbered steps.
 *
 * Written by the operators in the admin console and read by everyone. What
 * ships here is the default - the guide a fresh deployment shows until an
 * operator saves their own - and `cleanLearn` is the one gate every saved
 * version passes through, so a guide can never be stored in a shape the page
 * cannot draw.
 *
 * Text is plain, with three bits of formatting the page understands: a blank
 * line starts a new paragraph, a line starting "- " is a bullet, and
 * **double stars** make bold. Links are [text](/path) and only ever go to a
 * page inside the app or an https address.
 */

export interface LearnStep {
  title: string;
  body: string;
  /** A picture for the step: one shipped with the app, an uploaded photo, or an https link. */
  image: string | null;
  caption: string;
}

export interface LearnSection {
  id: string;
  title: string;
  body: string;
  steps: LearnStep[];
}

export interface LearnTab {
  id: string;
  title: string;
  /** One emoji or a short symbol, shown in the side rail. */
  icon: string;
  intro: string;
  sections: LearnSection[];
  /** Kept in the console but not shown to anybody, for a tab still being written. */
  hidden: boolean;
}

export interface LearnDoc {
  tabs: LearnTab[];
  updatedAt: string | null;
  updatedBy: string | null;
}

export const LEARN_LIMITS = {
  tabs: 20,
  sections: 40,
  steps: 30,
  title: 80,
  icon: 8,
  intro: 1_200,
  body: 4_000,
  caption: 200,
} as const;

/** A picture the guide may show: one of the app's own, an uploaded photo, or https. */
export function learnImageOk(url: string): boolean {
  return /^\/learn\/[\w.-]+\.(png|jpe?g|webp|gif|svg)$/i.test(url)
    || /^\/api\/photos\/[\w.-]+$/.test(url)
    || /^https:\/\/[^\s"'<>]+$/.test(url);
}

function slug(text: string, fallback: string): string {
  const made = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return made || fallback;
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';
}

/**
 * A guide as it may be stored, or the reason it may not.
 *
 * Unknown fields are dropped, lengths are capped, ids are made unique, and a
 * picture that is not one of the allowed kinds is refused outright rather than
 * silently removed - an operator who pasted the wrong link should be told.
 */
export function cleanLearn(input: unknown): { doc: Omit<LearnDoc, 'updatedAt' | 'updatedBy'> } | { error: string } {
  const raw = (input ?? {}) as { tabs?: unknown };
  if (!Array.isArray(raw.tabs)) return { error: 'The guide needs a list of tabs.' };
  if (raw.tabs.length === 0) return { error: 'Keep at least one tab.' };
  if (raw.tabs.length > LEARN_LIMITS.tabs) return { error: `At most ${LEARN_LIMITS.tabs} tabs.` };

  const tabIds = new Set<string>();
  const tabs: LearnTab[] = [];
  for (const [tabIndex, entry] of raw.tabs.entries()) {
    const tab = (entry ?? {}) as Record<string, unknown>;
    const title = text(tab.title, LEARN_LIMITS.title);
    if (!title) return { error: `Tab ${tabIndex + 1} needs a title.` };
    let id = slug(text(tab.id, 40) || title, `tab-${tabIndex + 1}`);
    while (tabIds.has(id)) id = `${id}-${tabIndex + 1}`;
    tabIds.add(id);

    const rawSections = Array.isArray(tab.sections) ? tab.sections : [];
    if (rawSections.length > LEARN_LIMITS.sections) return { error: `"${title}" has more than ${LEARN_LIMITS.sections} sections.` };
    const sectionIds = new Set<string>();
    const sections: LearnSection[] = [];
    for (const [sectionIndex, sectionEntry] of rawSections.entries()) {
      const section = (sectionEntry ?? {}) as Record<string, unknown>;
      const sectionTitle = text(section.title, LEARN_LIMITS.title);
      if (!sectionTitle) return { error: `Section ${sectionIndex + 1} in "${title}" needs a title.` };
      let sectionId = slug(text(section.id, 40) || sectionTitle, `section-${sectionIndex + 1}`);
      while (sectionIds.has(sectionId)) sectionId = `${sectionId}-${sectionIndex + 1}`;
      sectionIds.add(sectionId);

      const rawSteps = Array.isArray(section.steps) ? section.steps : [];
      if (rawSteps.length > LEARN_LIMITS.steps) return { error: `"${sectionTitle}" has more than ${LEARN_LIMITS.steps} steps.` };
      const steps: LearnStep[] = [];
      for (const [stepIndex, stepEntry] of rawSteps.entries()) {
        const step = (stepEntry ?? {}) as Record<string, unknown>;
        const stepTitle = text(step.title, LEARN_LIMITS.title);
        if (!stepTitle) return { error: `Step ${stepIndex + 1} in "${sectionTitle}" needs a title.` };
        const image = text(step.image, 500) || null;
        if (image && !learnImageOk(image)) {
          return { error: `The picture for "${stepTitle}" must be an uploaded photo or an https link.` };
        }
        steps.push({ title: stepTitle, body: text(step.body, LEARN_LIMITS.body), image, caption: text(step.caption, LEARN_LIMITS.caption) });
      }
      sections.push({ id: sectionId, title: sectionTitle, body: text(section.body, LEARN_LIMITS.body), steps });
    }

    tabs.push({
      id,
      title,
      icon: text(tab.icon, LEARN_LIMITS.icon) || '📘',
      intro: text(tab.intro, LEARN_LIMITS.intro),
      sections,
      hidden: tab.hidden === true,
    });
  }
  if (tabs.every((tab) => tab.hidden)) return { error: 'At least one tab has to be visible.' };
  return { doc: { tabs } };
}

/* -------------------------------------------------------------------------- */
/* The guide that ships                                                       */
/* -------------------------------------------------------------------------- */

const step = (title: string, body: string, image: string | null = null, caption = ''): LearnStep => ({ title, body, image, caption });

const BUY: LearnTab = {
  id: 'buy',
  title: 'Buy',
  icon: '🛍️',
  hidden: false,
  intro:
    'Everything about finding something you want and getting it home: browsing, pre-orders, paying safely, tracking, and what to do if something goes wrong. Work through it top to bottom the first time, or jump to a section.',
  sections: [
    {
      id: 'at-a-glance',
      title: 'The Buy tab at a glance',
      body: 'The Buy tab is the whole catalogue in one place - figures, kits, cards, sneakers, electronics and more, from every shop on Figmark. There are two designs: **Quest**, with rarity labels and daily rewards, and **Classic**, a plain grid. Both show exactly the same items.',
      steps: [
        step('Open Buy', 'Tap **Buy** in the bar at the bottom of the screen. It is also where the app opens.', '/learn/buy-feed.jpg', 'The Buy tab in the Quest design.'),
        step('Pick a design', 'Use the **Quest | Classic** switch at the top. Your choice is remembered on this device, and switching never loses your search or filters.'),
        step('Search', 'Type in the search bar at the very top - a name, a series, a brand. Extra words narrow the results.'),
        step('Choose a zone', 'Tap a round badge - **Everything**, **Figures**, **Model kits**, **Cards**, **Sneakers** and more - to see only that kind of thing.', '/learn/buy-filters.jpg', 'Zones, how it is sold, rarity and the filters.'),
        step('Filter', 'The first row of chips is **how it is sold**: All, Pre-orders, Mixed lots or In hand. Below that you can sort (newest, price) and filter by price, condition and type. Tap **Clear** to start again.'),
      ],
    },
    {
      id: 'reading-a-card',
      title: 'Reading a listing card',
      body: 'Each card tells you enough to decide whether to tap it:\n\n- **Rarity ribbon** at the top: Legendary, Epic or New (see the next section).\n- **Condition stamp** at the bottom left: MISB (mint in sealed box), MIB (mint in box), BIB (box in box, opened), LOOSE, and so on.\n- **Chest** at the top right: saves the item to your wishlist.\n- **Price**, and a struck-through old price when it has dropped.\n- **In hand** (ships from the seller now) or **Import** (comes in a shipment), the category, and how many are left.\n- **LV bar** on a pre-order: how many places are taken out of how many are needed.\n- **Countdown** when the seller set an end time - it turns red in the last day.\n- **Crest** next to the shop name: bronze, silver or gold for the shop\'s trust score.',
      steps: [
        step('Look closer', 'Tap anywhere on a card to open the full listing with photos, description, the seller and questions from other buyers.', '/learn/buy-cards.jpg', 'Legendary, Epic and plain cards side by side.'),
      ],
    },
    {
      id: 'rarity',
      title: 'Legendary, Epic and New',
      body: 'Rarity is worked out from real demand - sales, saves, views and how full a pre-order is. Sellers cannot choose it, and it changes as things sell.\n\n- **Legendary**: selling hard or heavily saved, a pre-order that is 90% full, or a timed item in its last six hours that people want.\n- **Epic**: strong demand, a pre-order past 60%, or real interest with under three days left.\n- **New**: listed, or back in stock, in the last three days.\n\n**Timers matter.** The closer an item is to its end time, the more the same interest counts, so a timed drop climbs from plain to Epic to Legendary as it runs out. Items ending soonest are also collected in the **Ending soon** row. Use the Legendary, Epic and New chips to see only those.',
      steps: [],
    },
    {
      id: 'save-and-loot',
      title: 'Saving, and the daily Loot',
      body: 'Two small habits that pay off.',
      steps: [
        step('Save with the heart', 'Tap the heart on any card or **Save** on a listing. Saved items are easy to find again, sellers see the interest, and each save earns a little XP.'),
        step('Reveal the Loot of the day', 'At the top of the Buy tab is a face-down card. Tap **Reveal now** once a day: it turns over to show one of the rarest items in the catalogue, and gives you a free collectible card.', '/learn/buy-reveal.jpg', 'A revealed card. The same card however many times you tap.'),
        step('Do today\'s quests', 'Under the Loot is a short list of today\'s quests - check in, reveal, and two more that change daily. Finished ones can be claimed for XP. See **Quests, XP and levels** below.'),
      ],
    },
    {
      id: 'buying',
      title: 'Buying an item, step by step',
      body: 'Nothing is charged until you choose how to pay, and you always see the total first.',
      steps: [
        step('Open the listing', 'Check the photos, the condition, how many are left, whether it is **In hand** or an **Import**, and any end time. Read the questions other buyers asked.', '/learn/buy-listing.jpg', 'A listing, with the Buy button and the seller\'s record.'),
        step('Check the seller', 'The seller card shows their trust score, on-time dispatch rate and followers. Tap their name to see reviews from earlier buyers.'),
        step('Tap Buy now', 'On a pre-order the button says **Book a place** instead. This opens checkout - it does not charge you.'),
        step('Full or advance', 'If the seller accepts an advance you can pay a percentage now and the rest later from **My Purchases**, with the same payment method.'),
        step('Choose how to pay', '- **Buy directly from the seller**: you pay them yourself (UPI, bank transfer - whatever they list). Nothing is held, so anything that goes wrong is between the two of you.\n- **Add buyer protection**: the payment is held by an approved escrow until you confirm the item arrived, and settled by Figmark if you disagree. A small fee is added.\n- **Book**: reserve it now and pay the moment the seller confirms it is available. Booking is not payment.', '/learn/buy-checkout.jpg', 'The three ways to pay, with the total for each.'),
        step('Pay and show it went through', 'Pay using the details shown, then enter the payment reference and, if you like, a screenshot of the confirmation. The seller confirms the money arrived before the order moves on.'),
        step('Done', 'Your order is in **My Purchases** (profile menu). You will get a notification at every step.'),
      ],
    },
    {
      id: 'pre-orders',
      title: 'Pre-orders',
      body: 'A pre-order is a group buy: the seller only orders the item from abroad once enough people want it. That is how rare imports become affordable.',
      steps: [
        step('Read the bar', 'The LV bar and the pre-order panel on the listing show how many places are taken out of the goal, who is in, and when it closes.', '/learn/buy-preorder.jpg', 'A pre-order panel with its fill bar and the people in it.'),
        step('Book or pledge', '**Book a place** pays (or books) a unit now. **+ I\'m in** is a free pledge: you are counted, and only asked to pay - within a day - once the pre-order fills.'),
        step('Bring people in', 'Tap **Bring someone in** to copy a link. The fuller it gets, the sooner it goes ahead.'),
        step('When it fills', 'The seller places the order, pledges are called in for payment, and you can follow the shipment in My Purchases.'),
        step('If it closes short', 'Nothing is lost: bookings are refunded in full and pledges were never charged.'),
      ],
    },
    {
      id: 'tracking',
      title: 'After you buy: tracking and receiving',
      body: 'Every order has its own page with a timeline from the seller, through any warehouse and forwarder, to your door.',
      steps: [
        step('Open My Purchases', 'Profile icon → **My Purchases**. Orders are grouped by shop, with what you owe and what to do next.', '/learn/buy-purchases.jpg', 'My Purchases, grouped by shop.'),
        step('Follow the timeline', 'Open an order to see each stage as it happens, the tracking number once it ships, and any notes from the seller. An imported item travels in a lot; once the lot lands it is unpacked and your item is sent to you on its own, with its own dispatch and delivery.', '/learn/buy-tracking.jpg', 'An order\'s tracking timeline.'),
        step('Pay the balance', 'If you paid an advance, pay the rest from the order or from My Purchases when the seller asks for it.'),
        step('Confirm it arrived', 'When the parcel is in your hands, confirm it on the order - the same step however you paid. Paid directly, tap **I received it**: the money is already with the seller, so this just closes the delivery. With buyer protection the button reads **Yes, it arrived - release the payment**, because confirming is what releases the held money; if you do nothing and raise no dispute, it releases on its own 10 days after your item is dispatched (the order page shows the date).'),
      ],
    },
    {
      id: 'reviews-disputes',
      title: 'Reviews, refunds and disputes',
      body: 'Reviews are two-sided and blind: you rate the seller, the seller rates you, and neither sees the other\'s until both are written (or the window closes). Your rating as a buyer shows on your profile, so paying on time and being easy to deal with matters.',
      steps: [
        step('Review the seller', 'After the order completes, the order page asks for a rating and a few words. Mention how the item compared with the listing, the packing and the speed.'),
        step('Refunds', 'If an order is cancelled after you paid, the seller refunds you and asks for your refund details once. Keep them current in **My refunds** → details.'),
        step('Open a dispute', 'If something is wrong - not as described, damaged, never arrived - open a dispute from the order before the protection window closes. Explain what happened and attach photos.'),
        step('Dispute a review or comment', 'Every review and comment has a **Dispute** button: tell Figmark if it is untrue, abusive or not about a real trade, and an operator decides whether it stays. On your own review or comment the same button reads **Ask to validate** - an operator checks it, and if it holds up it shows a ✓ Validated mark.'),
        step('Settle it', 'The seller can reply and either side can offer a refund amount the other accepts in one tap. If you cannot agree, escalate it and Figmark decides.'),
      ],
    },
    {
      id: 'collection',
      title: 'Your collection',
      body: 'Things delivered to you can go on your profile as cards - a shelf of everything you have collected through Figmark.',
      steps: [
        step('Add a delivered item', 'Profile → **Collection** tab. Delivered orders wait under **Ready to add**; tap **Add**.', '/learn/buy-collection.jpg', 'A collection with cards on shelves.'),
        step('Name it', 'Type a name under the picture. Long names are shortened with "…" so every card stays the same size.'),
        step('Group into shelves', 'Tap **+ Shelves** to make shelves (by series, shop, year - anything), then move a card with the ⋯ menu under it.'),
        step('Show it off', 'Tap a card to see all its photos full screen - swipe between them - with the name and the day it was delivered.'),
      ],
    },
    {
      id: 'quests',
      title: 'Quests, XP and levels',
      body: 'Figmark rewards being a good member of the market. You earn XP for orders, received items, reviews, pre-orders, saves, check-ins and quests; low ratings from sellers and lost disputes take XP away. XP raises your level, each level gives a card pack, and stickers (bronze, silver, gold) show on your profile.\n\n- **Daily** quests change every day, **weekly** every Monday, **monthly** on the 1st.\n- **Milestones** repeat with bigger goals: 1 order, then 5, 10, 25...\n- Everything is on the [Quests page](/quests), including exactly where your XP came from.',
      steps: [
        step('Open Quests', 'Tap the level chip at the top of the Buy tab, or profile icon → **Quests & rewards**.', '/learn/buy-quests.jpg', 'Your level, streak, packs and quests.'),
      ],
    },
    {
      id: 'safety',
      title: 'Tips for buying safely',
      body: '- Prefer **buyer protection** for expensive items or sellers you do not know.\n- Check the seller\'s reviews and on-time rate before paying.\n- Keep every payment reference and screenshot - add them at checkout.\n- Ask questions on the listing before you buy; the answers stay public.\n- Never pay outside the payment details shown for the order.\n- Confirm delivery only once the item is actually in your hands.',
      steps: [],
    },
  ],
};

const SELL: LearnTab = {
  id: 'sell',
  title: 'Sell',
  icon: '📦',
  hidden: false,
  intro: 'Opening a shop, listing items, running pre-orders and shipping lots. A full step-by-step guide is on its way; here is the short version.',
  sections: [
    {
      id: 'overview',
      title: 'Selling on Figmark',
      body: '- Any account can sell: tap **Sell** and set up your storefront.\n- List an item with photos, condition, price and quantity, and optionally an end time or an advance percentage.\n- Turn on **pre-order** to only buy stock once enough people commit.\n- Group imported items into **lots** and move them through the shipping steps; buyers see the tracking automatically.\n- Add your payment details so buyers can pay you directly.',
      steps: [],
    },
  ],
};

const SERVICES: LearnTab = {
  id: 'services',
  title: 'Services',
  icon: '🧭',
  hidden: false,
  intro: 'Forwarders, handlers, packers and escrows - the people who move things between countries and keep payments safe. A full guide is on its way.',
  sections: [
    {
      id: 'overview',
      title: 'What Services are for',
      body: '- **Forwarders** consolidate shipments abroad and send them on.\n- **Handlers** receive lots in India and get parcels to buyers.\n- **Escrows** hold payments for buyer protection.\n- Browse them in the **Services** tab and see their routes, trust and reviews.',
      steps: [],
    },
  ],
};

const SOCIAL: LearnTab = {
  id: 'social',
  title: 'Social',
  icon: '💬',
  hidden: false,
  intro: 'Forums, shop channels, messages and Wanted (ISO) requests. A full guide is on its way.',
  sections: [
    {
      id: 'overview',
      title: 'Talking to the community',
      body: '- **Forums** are open rooms for everyone - share hauls, ask questions.\n- **Shop channels** are for a shop\'s followers: drops, restocks and sales.\n- **Messages** are private chats with a person or a shop.\n- **Wanted (ISO)**: post what you are hunting for and let sellers come to you.',
      steps: [],
    },
  ],
};

export const DEFAULT_LEARN: LearnDoc = { tabs: [BUY, SELL, SERVICES, SOCIAL], updatedAt: null, updatedBy: null };
