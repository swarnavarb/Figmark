/**
 * Each screen's code, as the function that fetches it.
 *
 * main.tsx makes its lazy routes from these, and the two warm-ups below call
 * the same functions earlier. A module is fetched once whoever asks first, so
 * a route that renders after a warm-up finds its code already here.
 */
export const loaders = {
  feed: () => import('./pages/FeedPage'),
  discover: () => import('./pages/DiscoverPage'),
  legal: () => import('./pages/LegalPage'),
  listing: () => import('./pages/ListingPage'),
  sell: () => import('./pages/SellPage'),
  shop: () => import('./pages/ShopPage'),
  lotBoard: () => import('./pages/LotBoardPage'),
  routes: () => import('./pages/RoutesPage'),
  routeStudio: () => import('./pages/RouteStudioPage'),
  services: () => import('./pages/ServicesPage'),
  storeApply: () => import('./pages/StoreApplyPage'),
  storeConsole: () => import('./pages/StoreConsolePage'),
  store: () => import('./pages/StorePage'),
  crewLot: () => import('./pages/CrewLotPage'),
  social: () => import('./pages/SocialPage'),
  forumRoom: () => import('./components/ForumRoom'),
  messages: () => import('./pages/MessagesPage'),
  order: () => import('./pages/OrderPage'),
  dispute: () => import('./pages/DisputePage'),
  communityService: () => import('./pages/CommunityServicePage'),
  profile: () => import('./pages/ProfilePage'),
  verify: () => import('./pages/VerifyPage'),
  purchases: () => import('./pages/PurchasesPage'),
  buyerLot: () => import('./pages/BuyerLotPage'),
  refunds: () => import('./pages/MyRefundsPage'),
  disputes: () => import('./pages/MyDisputesPage'),
  quests: () => import('./pages/QuestsPage'),
  learn: () => import('./pages/LearnPage'),
  tag: () => import('./pages/TagPage'),
  profileByHandle: () => import('./pages/ProfileByHandlePage'),
  shortLink: () => import('./pages/ShortLinkPage'),
  invite: () => import('./pages/InvitePage'),
  powerSale: () => import('./components/PowerSale'),
  notFound: () => import('./pages/NotFoundPage'),
} as const;

type LoaderName = keyof typeof loaders;

/** Which screen an address opens, as far as its first segment says. Most specific first. */
const BY_PATH: [(path: string) => boolean, LoaderName][] = [
  [(path) => path === '/', 'feed'],
  [(path) => path.startsWith('/listing/'), 'listing'],
  [(path) => path.startsWith('/discover'), 'discover'],
  [(path) => path.startsWith('/social/f/'), 'forumRoom'],
  [(path) => path.startsWith('/social'), 'social'],
  [(path) => path.startsWith('/messages/'), 'messages'],
  [(path) => path === '/shop/power-sale', 'powerSale'],
  [(path) => path.startsWith('/shop'), 'shop'],
  [(path) => path.startsWith('/sell'), 'sell'],
  [(path) => path.startsWith('/lot/'), 'lotBoard'],
  [(path) => path.startsWith('/routes/studio'), 'routeStudio'],
  [(path) => path.startsWith('/order/'), 'order'],
  [(path) => path.startsWith('/dispute/'), 'dispute'],
  [(path) => path.startsWith('/disputes'), 'disputes'],
  [(path) => path.startsWith('/services/apply'), 'storeApply'],
  [(path) => path.startsWith('/services/store'), 'storeConsole'],
  [(path) => path.startsWith('/services/crew'), 'crewLot'],
  [(path) => path.startsWith('/services') || path.startsWith('/forwarders'), 'services'],
  [(path) => path.startsWith('/community-service'), 'communityService'],
  [(path) => path === '/me', 'profile'],
  [(path) => path.startsWith('/verify'), 'verify'],
  [(path) => path.startsWith('/purchases/lot/'), 'buyerLot'],
  [(path) => path.startsWith('/purchases') || path.startsWith('/cart'), 'purchases'],
  [(path) => path.startsWith('/wallet') || path.startsWith('/refunds') || path.startsWith('/buyer-settings'), 'refunds'],
  [(path) => path.startsWith('/quests'), 'quests'],
  [(path) => path.startsWith('/learn'), 'learn'],
  [(path) => path.startsWith('/legal'), 'legal'],
  [(path) => path.startsWith('/tags/'), 'tag'],
  [(path) => path.startsWith('/r/'), 'shortLink'],
  [(path) => path.startsWith('/i/') || path.startsWith('/s/'), 'invite'],
];

/**
 * Start fetching the screen an address opens, now.
 *
 * Called before the app has even asked who is signed in: the screen's code
 * used to be asked for only once that answer was back and the route drew,
 * one round trip after another. Now both travel together.
 */
export function warmPage(path: string): void {
  const found = BY_PATH.find(([matches]) => matches(path));
  if (found) void loaders[found[1]]().catch(() => undefined);
}

/** The six tabs' screens, the places a thumb goes next. */
const TAB_PAGES: LoaderName[] = ['feed', 'discover', 'shop', 'services', 'social', 'quests'];

/**
 * Fetch the tabs' screens once the phone has nothing else to do, so switching
 * tab draws the page rather than the loading mark. Skipped when the reader
 * asked to save data or the connection is too slow to spare.
 */
export function warmTabsWhenIdle(): void {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? '')) return;
  const idle = (run: () => void) =>
    typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(run, { timeout: 4000 }) : window.setTimeout(run, 1500);
  // One at a time, each in its own quiet moment, so none competes with the page.
  const queue = [...TAB_PAGES];
  const next = () => {
    const name = queue.shift();
    if (!name) return;
    void loaders[name]().catch(() => undefined).finally(() => idle(next));
  };
  idle(next);
}

/** Fetch a tab's screen the moment a finger lands on it, a beat before the tap completes. */
export function warmTab(to: string): void {
  warmPage(to);
}
