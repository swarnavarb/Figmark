import type { CSSProperties, ReactNode } from 'react';
import { BackBar } from './ScrollManager';
import { brandHueFor } from '../format';

/**
 * Every page's own skeleton: what the page will be, drawn before its data is.
 *
 * One generic placeholder (a circle, a bar, a box, four rows) stood in for
 * every page, so an order, a dispute and a store all flashed the same shape
 * and then jumped into a different one. Each shape here is built from the
 * page's own layout classes - the same paddings, cards, tabs and tiles - with
 * the words the page always says written in, and a shimmer only where the
 * data goes. So the skeleton is the page minus its data, and nothing moves
 * when the data lands.
 *
 * The shape is picked from the address (`shapeFor`), which is what lets one
 * component serve both the wait for a screen's code and the wait for its
 * data: both happen at the same address and should look the same.
 *
 * Kept free of imports from Feedback.tsx (which renders this), so the two do
 * not import each other.
 */

/** One shimmering block. */
function S({ w = '100%', h = 12, r, style, className }: {
  w?: number | string;
  h?: number | string;
  r?: number | string;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span className={`skel${className ? ` ${className}` : ''}`}
      style={{ width: w, height: h, borderRadius: r, ...style }} aria-hidden="true" />
  );
}

/** Lines of text, ragged so they read as prose. */
function Lines({ n = 3, h = 11, gap = 8, last = '62%' }: { n?: number; h?: number; gap?: number; last?: string }) {
  const widths = ['94%', '86%', '90%', '78%', '88%'];
  return (
    <span className="psk-lines" style={{ gap }} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <S key={i} h={h} w={i === n - 1 ? last : widths[i % widths.length]} />)}
    </span>
  );
}

/** The back row every inner page opens with: its arrow, and its words or their shape. */
function Back({ text }: { text?: string }) {
  return (
    <BackBar onBack={() => window.history.back()}>
      {text ?? <S w={130} h={14} />}
    </BackBar>
  );
}

/** A back row whose words are the page's title. */
function BackTitle({ title }: { title: string }) {
  return <BackBar onBack={() => window.history.back()} title={title} />;
}

/** A segmented row of tabs, with the labels the page always shows. */
function Tabs({ labels, className = 'tabs' }: { labels: string[]; className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      {labels.map((label, i) => <span key={label} className={`tab${i === 0 ? ' is-on' : ''}`}>{label}</span>)}
    </div>
  );
}

/** Number tiles: the label is known, the number is not. */
function Tiles({ labels, className = 'tiles' }: { labels: string[]; className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      {labels.map((label) => (
        <div key={label} className="tile">
          <div className="tile__value"><S w={34} h={22} style={{ margin: '0 auto' }} /></div>
          <div className="tile__label">{label}</div>
        </div>
      ))}
    </div>
  );
}

/** Rows of a list: a mark, two lines, a figure at the end. */
function Rows({ n = 4 }: { n?: number }) {
  return (
    <div className="skel-rows" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="skel-row" key={i}>
          <S w={30} h={30} r={999} />
          <span className="skel-stack"><S w="54%" h={11} /><S w="32%" h={9} /></span>
          <S w={54} h={11} />
        </div>
      ))}
    </div>
  );
}

/** A plain card of `h` pixels, or holding what it is given. */
function Card({ h, children, className = '' }: { h?: number; children?: ReactNode; className?: string }) {
  return (
    <div className={`card card--pad psk-card ${className}`} style={h ? { minHeight: h } : undefined} aria-hidden="true">
      {children}
    </div>
  );
}

/** A page title and the line under it. */
function Head({ title, sub, action }: { title: string; sub?: number; action?: ReactNode }) {
  return (
    <div className="page__head psk-head">
      <div className="psk-lines">
        <h1 style={{ margin: 0 }}>{title}</h1>
        {sub ? <Lines n={sub} /> : null}
      </div>
      {action}
    </div>
  );
}

/** A catalogue grid while it loads: the grid it is about to be. */
function Grid({ n = 4 }: { n?: number }) {
  return (
    <div className="grid" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <div className="card skel-card" key={i}>
          <S className="skel-thumb" h="" r={0} />
          <div className="skel-card__body"><S w="88%" h={12} /><S w="42%" h={15} /><S w="64%" h={10} /></div>
        </div>
      ))}
    </div>
  );
}

/** A post in a feed: who, a line, the picture. */
function Post({ media = '4 / 3' }: { media?: string }) {
  return (
    <div className="card card--pad psk-card" aria-hidden="true">
      <span className="psk-row"><S w={42} h={42} r="50%" /><span className="psk-lines" style={{ flex: 1 }}><S w="42%" /><S w="24%" h={9} /></span></span>
      <Lines n={2} />
      <S h="" r={12} style={{ aspectRatio: media }} />
    </div>
  );
}

/**
 * A store or person's page: the cover, then the real header grid (face on
 * the cover's edge, name beside it, details under), the follow row, the four
 * counts and the About panel - the classes the page itself lays out with.
 */
type ProfileKind = 'shop' | 'person' | 'me' | null;

const KIND_KEY = 'figmark.pageKind:';

/**
 * Remembers, in this browser only, whether an address is a shop or a person,
 * so the next visit's loading screen is drawn as the page it will be.
 */
export function rememberPageKind(handle: string, kind: 'shop' | 'person') {
  try {
    localStorage.setItem(KIND_KEY + handle.replace(/^@/, '').toLowerCase(), kind);
  } catch {
    // Storage blocked: the neutral loading screen is drawn instead.
  }
}

function rememberedKind(handle: string): 'shop' | 'person' | null {
  try {
    const kind = localStorage.getItem(KIND_KEY + handle);
    return kind === 'shop' || kind === 'person' ? kind : null;
  } catch {
    return null;
  }
}

/**
 * A person's page, a shop's or your own, block for block as it will draw: the
 * header, the buttons, the four numbers, About, the rating slab, the level card
 * and the tabs. An address never opened before could be either, so its labels
 * are left blank rather than guessed.
 */
function Profile({ kind }: { kind: ProfileKind }) {
  const shop = kind === 'shop';
  const stats = kind === null ? null
    : shop ? ['followers', 'live', 'sold out', 'trust'] : ['followers', 'following', 'orders', 'leaderboard'];
  const tabs = shop ? ['Items', 'Feed', 'Reviews']
    : kind === 'me' ? ['📝 Posts', '🗂️ Collection', '📸 Photos', '🏆 Wins', '♥ Saved'] : ['Feed', 'Collection', 'Reviews', 'Wins'];
  return (
    <main className={`storefront${shop ? ' storefront--shop' : ' qprofile'}`} aria-hidden="true">
      {/* A shop's cover is coloured by its handle, which the address already holds. */}
      <div className={shop ? `storefront__cover storefront__cover--${brandHueFor(handleInPath())}` : 'storefront__cover pskel__cover'} />
      <div className="storefront__body">
        <header className="phead">
          <div className="phead__face"><span className="pskel__face psk-face" style={shop ? { borderRadius: 18 } : undefined} /></div>
          <div className="phead__name"><S w="72%" h={24} /><S w="48%" h={11} /></div>
          <div className="phead__details">
            <S w={130} h={10} />
            <span className="psk-row"><S w={60} h={22} r={999} /><S w={82} h={22} r={999} /><S w={72} h={22} r={999} /></span>
          </div>
        </header>
        {kind === 'me'
          ? <span className="psk-row psk-follow"><S h={44} r={999} style={{ flex: 1 }} /></span>
          : <span className="psk-row psk-follow"><S h={44} r={999} style={{ flex: 1 }} /><S h={44} r={999} style={{ flex: 1 }} /><S w={44} h={44} r="50%" /></span>}
        <div className="pstats">
          {(stats ?? ['', '', '', '']).map((label, i) => (
            <span key={label || i} className={`pstat${label === 'leaderboard' ? ' pstat--long' : ''}`}>
              <b><S w={26} h={22} style={{ margin: '0 auto' }} /></b>
              <small>{label || <S w={52} h={9} style={{ margin: '2px auto 0' }} />}</small>
            </span>
          ))}
        </div>
        <section className="ppanel">
          <h2 className="ppanel__title">About</h2>
          <Lines n={2} />
          <span className="psk-row psk-wrap"><S w={84} h={24} r={999} /><S w={64} h={24} r={999} /><S w={88} h={24} r={999} /></span>
          {/* A shop's About goes on: what it is known for, also sells, ships from, who runs it. */}
          {shop && [3, 3, 1, 1].map((chips, row) => (
            <span key={row} className="psk-row" style={{ paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <S w={72} h={9} />
              {Array.from({ length: chips }, (_, chip) => <S key={chip} w={78} h={26} r={999} />)}
            </span>
          ))}
        </section>
        <S h={76} r={16} style={{ display: 'block', margin: '14px 0' }} />
        <S h={300} r={16} style={{ display: 'block', margin: '0 0 16px' }} />
        {kind === null ? <S h={44} r={999} style={{ display: 'block', marginBottom: 14 }} /> : <Tabs labels={tabs} />}
        {shop ? <Grid n={4} /> : <Lines n={3} />}
      </div>
    </main>
  );
}

/** The handle a /:username address names, as the profile page reads it. */
function handleInPath(): string {
  const segment = window.location.pathname.split('/')[1] ?? '';
  try {
    return decodeURIComponent(segment).replace(/^@/, '').toLowerCase();
  } catch {
    return segment.toLowerCase();
  }
}

/** A big gradient hero card: an eyebrow, a title, a line, a footer. */
function Hero({ h = 150, icon = true }: { h?: number; icon?: boolean }) {
  return (
    <div className="card card--pad psk-hero" style={{ minHeight: h }} aria-hidden="true">
      <span className="psk-row" style={{ alignItems: 'flex-start' }}>
        {icon && <S w={44} h={44} r={14} />}
        <span className="psk-lines" style={{ flex: 1 }}><S w={96} h={9} /><S w="62%" h={22} /><S w="90%" /><S w="54%" /></span>
      </span>
    </div>
  );
}

/** Rows of facts: a label and a value, the way a key-value list sits. */
function Facts({ labels }: { labels: string[] }) {
  return (
    <dl className="icard__facts" aria-hidden="true">
      {labels.map((label) => <div key={label} className="icard__fact"><dt>{label}</dt><dd><S w="58%" h={14} /></dd></div>)}
    </dl>
  );
}

/** A conversation while it loads: a few bubbles each side, and the box to write in. */
function ThreadBody() {
  return (
    <main className="page social psk">
      <div className="psk-chat">
        <S w="62%" h={40} r={16} />
        <S w="48%" h={40} r={16} className="psk-chat__mine" />
        <S w="70%" h={58} r={16} />
        <S w="40%" h={40} r={16} className="psk-chat__mine" />
      </div>
      <S h={50} r={999} />
    </main>
  );
}

/* ── Parts of a page ───────────────────────────────────────────────────
 *
 * For a section of a page that is already drawn while the rest of it is
 * still on its way: the part that is missing, in its own shape, in place of
 * a spinner that said only "something" and then made the page jump.
 */

/** A line of text inside a sentence that has not arrived: "3 on Figmark". */
export function SkelInline({ w = 90, h = 10 }: { w?: number; h?: number }) {
  return <span className="skel psk-inline" style={{ width: w, height: h }} aria-hidden="true" />;
}

/** A stack of overlapping faces, as a "who is here" row draws them. */
export function SkelFaces({ n = 3, size = 30 }: { n?: number; size?: number }) {
  return (
    <span className="psk-faces" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => <S key={i} w={size} h={size} r="50%" />)}
    </span>
  );
}

/** Rows of a list, for a list that is loading. */
export function SkelRows({ n = 3 }: { n?: number }) {
  return <div role="status" aria-label="Loading"><Rows n={n} /></div>;
}

/**
 * Cards in a list: a mark, a name, a line or two, and a row of chips - the
 * shape lot cards, job cards and route cards all share.
 */
export function SkelCards({ n = 2, h = 110, mark = true, chips = 2 }: { n?: number; h?: number; mark?: boolean; chips?: number }) {
  return (
    <div className="stack" role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card card--pad psk-card" style={{ minHeight: h }} aria-hidden="true">
          <span className="psk-row">
            {mark && <S w={36} h={36} r={10} />}
            <span className="psk-lines" style={{ flex: 1 }}><S w="52%" h={14} /><S w="72%" h={10} /></span>
          </span>
          {chips > 0 && <span className="psk-row psk-wrap">{Array.from({ length: chips }, (_, k) => <S key={k} w={70 + (k % 3) * 18} h={24} r={999} />)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Number tiles in a grid, before their numbers are known. */
export function SkelTiles({ n = 3, cols = 3 }: { n?: number; cols?: 2 | 3 }) {
  return (
    <div className={cols === 2 ? 'psk-tiles2' : 'psk-tiles3'} role="status" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => <span key={i} className="psk-tile psk-tile--tall"><S w={26} h={24} /><S w="80%" h={9} /><S w="50%" h={9} /></span>)}
    </div>
  );
}

/** Posts in a feed: who wrote it, a line, the picture. */
export function SkelPosts({ n = 2, media = '4 / 3' }: { n?: number; media?: string }) {
  return (
    <div className="stack" role="status" aria-label="Loading posts">
      {Array.from({ length: n }, (_, i) => <Post key={i} media={media} />)}
    </div>
  );
}

/** Route cards, as the Routes list and the Studio's samples draw them: a name, a line, the three-part bar, the steps. */
export function SkelRouteCards({ n = 3 }: { n?: number }) {
  return (
    <div className="stack" role="status" aria-label="Loading routes">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="card card--pad psk-card" style={{ minHeight: 104 }} aria-hidden="true">
          <S w="54%" h={14} />
          <Lines n={2} h={10} />
          <span className="psk-row"><S w="30%" h={4} /><S w="30%" h={4} /><S w="30%" h={4} /></span>
          <S w="76%" h={9} />
        </div>
      ))}
    </div>
  );
}

/** A data panel: its period picker, four figures, and a chart. */
export function SkelFigures({ chart = true }: { chart?: boolean }) {
  return (
    <div className="stack" role="status" aria-label="Loading figures">
      <S h={40} r={12} />
      <div className="psk-tiles2">{Array.from({ length: 4 }, (_, i) => <span key={i} className="psk-tile"><S w={60} h={20} /><S w="70%" h={9} /></span>)}</div>
      {chart && <S h={160} r={16} />}
    </div>
  );
}

/** One block of a known height: a hero card, a chart, a panel. */
export function SkelBlock({ h = 120, r = 16, w }: { h?: number; r?: number; w?: number | string }) {
  return <div role="status" aria-label="Loading"><S h={h} r={r} w={w} /></div>;
}

/** A grid of listing cards. */
export function SkelGrid({ n = 4 }: { n?: number }) {
  return <div role="status" aria-label="Loading"><Grid n={n} /></div>;
}

/* ── The pages ─────────────────────────────────────────────────────────── */

const SHAPES = {
  /* The Buy tab, top to bottom as FeedPage draws it: the loot of the day, the
     Drops stage, the square category badges, how it is sold, the filter
     pickers, then the catalogue under its heading. Its own spacing lives in
     styles.css (.psk-feed), since FeedPage.css only arrives with the page. */
  feed: () => (
    <main className="page psk psk-feed">
      <div className="psk-feed__daily">
        <S className="psk-feed__flip" w={86} h={118} r={12} />
        <span className="psk-lines" style={{ flex: 1, maxWidth: 420 }}><S w="62%" h={10} /><S w="78%" h={18} /><S w="54%" h={10} /><S w={112} h={34} r={10} /></span>
      </div>
      <S className="psk-feed__stage" h={265} r={22} />
      <span className="psk-row psk-scroll psk-feed__zones">
        {Array.from({ length: 8 }, (_, i) => <span key={i} className="psk-feed__zone"><S w={58} h={58} r={18} /><S w={50} h={9} /></span>)}
      </span>
      <S className="psk-feed__kinds" w={340} h={44} r={14} />
      <span className="psk-row psk-scroll psk-feed__filters"><S w={110} h={34} r={999} /><S w={112} h={34} r={999} /><S w={138} h={34} r={999} /><S w={150} h={34} r={999} /><S w={112} h={34} r={999} /></span>
      <span className="psk-row psk-row--between psk-feed__head"><h2 style={{ margin: 0, fontSize: 'var(--t-md)' }}>All loot</h2><S w={54} h={10} /></span>
      <Grid n={4} />
    </main>
  ),
  discover: () => (
    <main className="page psk" style={{ maxWidth: 680, gap: 14 }}>
      <Hero h={136} icon={false} />
      <span className="psk-row psk-scroll"><S w={88} h={36} r={999} /><S w={70} h={36} r={999} /><S w={124} h={36} r={999} /><S w={84} h={36} r={999} /></span>
      <Post media="2 / 1" />
      <Post media="2 / 1" />
    </main>
  ),
  listing: () => (
    <main className="page lp psk">
      <Back />
      <div className="psk-photo">
        <span className="psk-row psk-photo__chips"><S w={44} h={22} r={999} /><S w={44} h={22} r={999} /><S w={58} h={22} r={999} /></span>
      </div>
      <span className="psk-lines"><S w="88%" h={24} /><S w="56%" h={24} /></span>
      <div className="psk-kv">{['Condition', 'Original or copy', 'What kind?', 'Scale', 'Release'].map((label) => <span key={label}><span className="muted">{label}</span><S w={70} /></span>)}</div>
    </main>
  ),
  sell: () => (
    <main className="page tab-view psk">
      <BackTitle title="List an item" />
      <S w="70%" h={11} />
      <Card h={128}><span className="psk-row"><S w={30} h={30} r={8} /><span className="psk-lines" style={{ flex: 1 }}><S w="40%" /><S w="80%" h={9} /></span></span><S w={120} h={30} r={999} /></Card>
      <Card h={200}><span className="psk-row"><S w={30} h={30} r={8} /><span className="psk-lines" style={{ flex: 1 }}><S w="30%" /><S w="50%" h={9} /></span></span><S w={82} h={82} r={12} /><Lines n={2} /></Card>
      <Card h={120}><span className="psk-row"><S w={30} h={30} r={8} /><S w="30%" /></span><S w="20%" h={10} /><S h={40} r={10} /></Card>
    </main>
  ),
  shop: () => (
    <main className="page tab-view psk">
      <Card><S w={110} h={10} /><div className="psk-tiles2">{Array.from({ length: 4 }, (_, i) => <span key={i} className="psk-tile"><S w={26} h={20} /><S w="60%" h={9} /></span>)}</div><Lines n={2} h={9} /></Card>
      <S h={48} r={12} />
      <div className="psk-tiles3">{Array.from({ length: 3 }, (_, i) => <span key={i} className="psk-tile psk-tile--tall"><S w={26} h={26} /><S w="80%" h={9} /><S w="50%" h={9} /></span>)}</div>
      <span className="psk-row psk-scroll"><S w={92} h={36} r={999} /><S w={84} h={36} r={999} /><S w={110} h={36} r={999} /><S w={80} h={36} r={999} /></span>
      <Rows n={3} />
    </main>
  ),
  lotboard: () => (
    <main className="page tab-view psk">
      <Back text="Track" />
      <span className="psk-row"><S w={80} h={24} /><S w={84} h={22} r={8} /><S w={56} h={22} r={999} /><S w={66} h={22} r={999} /></span>
      <S w={110} h={10} />
      <div className="card psk-bands">
        <span className="psk-row"><span className="psk-band__label">CHINA</span><S w={88} h={24} r={999} /><S w={110} h={24} r={999} /></span>
        <span className="psk-row psk-wrap"><span className="psk-band__label">INDIA</span><S w={110} h={24} r={999} /><S w={64} h={24} r={999} /><S w={72} h={24} r={999} /><S w={88} h={24} r={999} /><S w={86} h={24} r={999} /></span>
      </div>
      <Card h={92}><S w="46%" h={16} /><S w="54%" h={10} /><S w="26%" h={10} /></Card>
      <S h={60} r={14} />
      <Card h={150}><S w="50%" h={14} /><span className="psk-row psk-wrap"><S w={96} h={30} r={999} /><S w={110} h={30} r={999} /><S w={120} h={30} r={999} /><S w={70} h={30} r={999} /></span></Card>
    </main>
  ),
  /* One lot inside Sell → Shipments: its back row, its hero card, its four faces. */
  lotDetail: () => (
    <div className="stack psk" role="status" aria-label="Loading the lot">
      <Back text="Lot" />
      <Card h={172}>
        <span className="psk-row psk-row--between"><S w="46%" h={26} /><S w={96} h={24} r={999} /></span>
        <span className="psk-row"><S w={10} h={10} r="50%" /><S w="40%" h={14} /><S w={60} h={12} style={{ marginLeft: 'auto' }} /></span>
        <S h={6} r={999} />
        <span className="psk-row psk-row--between"><S w="44%" h={10} /><S w={90} h={30} r={10} /></span>
      </Card>
      <Tabs labels={['Customers', 'Tracking', 'Crew', 'Settings']} />
      <Card h={92}><S w="46%" h={16} /><S w="54%" h={10} /></Card>
      <Card h={92}><S w="40%" h={16} /><S w="60%" h={10} /></Card>
    </div>
  ),
  studio: () => (
    <main className="page psk">
      <Back text="New route" />
      <h1 style={{ margin: 0 }}>New route</h1>
      <S w={170} h={9} />
      <SkelRouteCards n={4} />
    </main>
  ),
  services: () => (
    <main className="page tab-view psk">
      <Head title="Services" sub={2} />
      <Card h={76}><span className="psk-row"><S w={42} h={42} r={12} /><span className="psk-lines" style={{ flex: 1 }}><S w="46%" h={16} /><S w="60%" h={10} /></span></span></Card>
      <S w={110} h={14} />
      <Hero h={170} />
      <Hero h={170} />
    </main>
  ),
  servicesMine: () => (
    <main className="page psk">
      <BackTitle title="My services" />
      <Lines n={2} />
      <S w={70} h={14} />
      <Rows n={2} />
    </main>
  ),
  directory: () => (
    <main className="page psk">
      <Back />
      <Hero h={130} />
      <span className="psk-row psk-row--between"><S w="44%" h={40} r={10} /><S w="44%" h={40} r={10} /></span>
      <span className="psk-row psk-wrap"><S w={84} h={30} r={999} /><S w={86} h={30} r={999} /><S w={100} h={30} r={999} /><S w={92} h={30} r={999} /></span>
      <Card h={120}><span className="psk-row"><S w={38} h={38} r={10} /><span className="psk-lines" style={{ flex: 1 }}><S w="50%" /><S w="70%" h={9} /></span><S w={70} /></span><S w="58%" h={14} /><S w="70%" h={9} /></Card>
      <Card h={120}><span className="psk-row"><S w={38} h={38} r={10} /><span className="psk-lines" style={{ flex: 1 }}><S w="50%" /><S w="70%" h={9} /></span><S w={70} /></span><S w="58%" h={14} /><S w="70%" h={9} /></Card>
    </main>
  ),
  store: () => (
    <main className="page psk" style={{ maxWidth: 1080 }}>
      <Back />
      <S h={120} r={18} />
      <Card h={230} className="psk-lift">
        <S w={64} h={64} r={16} />
        <S w={120} h={9} />
        <S w="70%" h={24} />
        <span className="psk-row psk-wrap"><S w={72} h={24} r={999} /><S w={92} h={24} r={999} /><S w={84} h={24} r={999} /></span>
        <span className="psk-row"><S w={92} h={40} r={10} /><S w={104} h={40} r={10} /></span>
      </Card>
      <Tabs labels={['Routes & rates', 'Channel', 'Reviews']} />
      <Rows n={2} />
    </main>
  ),
  console: () => (
    <main className="page psk" style={{ maxWidth: 1040 }}>
      <Back />
      <S h={130} r={18} />
      <span className="psk-row"><S w={72} h={72} r={18} /><span className="psk-lines" style={{ flex: 1 }}><S w="60%" h={20} /><S w="34%" h={20} r={999} /></span></span>
      <span className="psk-row psk-scroll"><S w={90} h={36} r={999} /><S w={90} h={36} r={999} /><S w={90} h={36} r={999} /><S w={90} h={36} r={999} /></span>
      <div className="psk-tiles2">{Array.from({ length: 4 }, (_, i) => <span key={i} className="psk-tile"><S w={40} h={20} /><S w="60%" h={9} /></span>)}</div>
      <Card h={140} />
    </main>
  ),
  request: () => (
    <main className="page psk" style={{ maxWidth: 1000 }}>
      <Back />
      <span className="psk-row"><S w={44} h={44} r={12} /><span className="psk-lines" style={{ flex: 1 }}><S w="64%" h={20} /><S w="30%" h={20} r={999} /></span></span>
      <S h={34} r={999} />
      <Card h={90}><S w="40%" h={10} /><S w="54%" h={24} /></Card>
      <Card h={180}><Lines n={5} /></Card>
    </main>
  ),
  serviceDetail: () => (
    <main className="page psk" style={{ maxWidth: 720 }}>
      <Back />
      <span className="psk-row"><S w={32} h={32} r={10} /><S w="40%" /></span>
      <span className="psk-lines"><S w="80%" h={24} /><S w="60%" h={11} /></span>
      <Card h={140}><S w="34%" h={14} /><Lines n={3} /></Card>
      <Card h={120}><S w="34%" h={14} /><Lines n={2} /></Card>
    </main>
  ),
  crew: () => (
    <main className="page psk" style={{ maxWidth: 960 }}>
      <Back />
      <S h={42} r={10} />
      <span className="psk-lines"><S w="60%" h={24} /><S w="80%" h={11} /></span>
      <span className="psk-row psk-wrap"><S w={80} h={24} r={999} /><S w={96} h={24} r={999} /><S w={70} h={24} r={999} /></span>
      <Card h={120}><Lines n={4} /></Card>
      <Rows n={3} />
    </main>
  ),
  apply: () => (
    <main className="page psk" style={{ maxWidth: 960 }}>
      <Back />
      <Card h={180}><S w={56} h={56} r={16} /><S w="60%" h={22} /><Lines n={2} /></Card>
      <Card h={220}><Lines n={6} /></Card>
    </main>
  ),
  open: () => (
    <main className="page psk">
      <BackTitle title="Open a business" />
      <S w="76%" h={11} />
      {Array.from({ length: 3 }, (_, i) => (
        <Card key={i} h={186}>
          <span className="psk-row" style={{ alignItems: 'flex-start' }}><S w={40} h={40} r={10} /><span className="psk-lines" style={{ flex: 1 }}><S w="34%" h={16} /><S w="84%" h={10} /><S w="60%" h={10} /></span></span>
          <span className="psk-row psk-wrap"><S w={120} h={26} r={999} /><S w={130} h={26} r={999} /><S w={110} h={26} r={999} /></span>
          <S w="44%" h={12} />
        </Card>
      ))}
    </main>
  ),
  social: () => (
    <main className="page tab-view social psk">
      <div className="psk-tiles5">{Array.from({ length: 5 }, (_, i) => <S key={i} h={58} r={14} />)}</div>
      <Card h={110}><span className="psk-row"><S w={40} h={40} r="50%" /><S h={40} r={999} style={{ flex: 1 }} /></span><span className="psk-row psk-row--between"><S w={60} /><S w={40} /><S w={60} /><S w={56} /></span></Card>
      <span className="psk-row psk-scroll"><S w={96} h={34} r={999} /><S w={150} h={34} r={999} /><S w={84} h={34} r={999} /></span>
      <Post />
    </main>
  ),
  room: () => (
    <main className="page social psk">
      <S h={56} r={14} />
      <Post />
      <Post />
    </main>
  ),
  thread: () => (
    <>
      <div className="psk-roombar"><S w={34} h={34} r="50%" /><S w={110} h={12} /></div>
      <ThreadBody />
    </>
  ),
  threadBody: () => <ThreadBody />,
  order: () => (
    <main className="page lp psk">
      <Back />
      <article className="icard" aria-hidden="true">
        <div className="icard__top">
          <span className="icard__photo"><S h="100%" w="100%" r={14} /></span>
          <div className="icard__info"><S w={80} h={9} /><S w="88%" h={16} /><S w="60%" h={16} /><S w="72%" h={10} /></div>
        </div>
        <Facts labels={['Total', 'Qty', 'Stock', 'Status']} />
        <div className="icard__foot"><span /><S w={100} h={30} r={10} /></div>
      </article>
      <Card h={70}><span className="psk-row"><S w={30} h={30} r={8} /><span className="psk-lines" style={{ flex: 1 }}><S w="30%" h={14} /><S w="56%" h={10} /></span></span></Card>
      <Card h={58}><S w="70%" /><S w={80} h={18} r={999} /></Card>
      <Card h={120}><S w="40%" h={16} /><S h={40} r={10} /></Card>
    </main>
  ),
  dispute: () => (
    <main className="page tab-view psk">
      <Back />
      <div className="page__head psk-lines">
        <S w={170} h={9} />
        <S w="88%" h={24} />
        <S w={110} h={22} r={999} />
      </div>
      <ol className="psk-steps" aria-hidden="true">
        {['Raised', 'Round 1', 'Final'].map((label) => <li key={label}><span className="psk-steps__dot" /><span>{label}</span></li>)}
      </ol>
      <Card h={190}>
        <span className="psk-row psk-row--between"><S w="34%" /><S w={60} /></span>
        <span className="psk-row psk-row--between"><S w="24%" /><S w="50%" /></span>
        <S h={84} r={12} />
      </Card>
      <Card h={110}><span className="psk-row"><S w={34} h={34} r="50%" /><span className="psk-lines" style={{ flex: 1 }}><S w="40%" /><S w="24%" h={9} /></span></span><Lines n={2} /></Card>
    </main>
  ),
  disputes: () => (
    <main className="page stack page--top psk">
      <Head title="My disputes" action={<S w={130} h={34} r={10} />} />
      <Tabs labels={['Purchases', 'Store sales', 'Community']} />
      <Rows n={3} />
    </main>
  ),
  community: () => (
    <main className="page tab-view psk">
      <BackTitle title="Community Service" />
      <S w="74%" h={11} />
      <S w={150} h={34} r={999} />
      <Card><Tiles className="tiles psk-tiles2" labels={['Need your decision', 'Open cases', 'Earned']} /><S w="50%" h={9} /></Card>
      <Tabs labels={['Waiting', 'All', 'Earnings']} />
      <Rows n={3} />
    </main>
  ),
  me: () => <Profile kind="me" />,
  profile: () => <Profile kind={rememberedKind(handleInPath())} />,
  verify: () => (
    <main className="page vfy psk">
      <h1 style={{ margin: 0 }}>Verification</h1>
      <Lines n={4} />
      <S h={52} r={12} />
      {['1. Email', '2. WhatsApp number', '3. Aadhaar (to sell)'].map((title) => (
        <Card key={title} h={96}>
          <span className="psk-row psk-row--between"><span className="card__title">{title}</span><S w={70} h={22} r={999} /></span>
          <S w="70%" h={10} />
        </Card>
      ))}
    </main>
  ),
  purchases: () => (
    <main className="page psk">
      <Hero h={150} />
      <S h={46} r={12} />
      <S h={60} r={12} />
      <S w={110} h={18} />
      <div className="psk-tiles3">{Array.from({ length: 3 }, (_, i) => <span key={i} className="psk-shelf"><S w={62} h={62} r={12} /><S w="80%" h={9} /><S w="50%" h={9} /></span>)}</div>
    </main>
  ),
  cart: () => (
    <main className="page psk">
      <Hero h={150} />
      {Array.from({ length: 2 }, (_, i) => (
        <article key={i} className="icard" aria-hidden="true">
          <div className="icard__top">
            <span className="icard__photo"><S h="100%" w="100%" r={14} /></span>
            <div className="icard__info"><S w={80} h={9} /><S w="88%" h={16} /><S w="60%" h={10} /></div>
          </div>
          <Facts labels={['Total', 'Qty', 'Stock', 'Status']} />
        </article>
      ))}
    </main>
  ),
  buyerLot: () => (
    <main className="page psk" style={{ gap: 18 }}>
      <Back text="Your lot" />
      <S h={300} r={16} />
      <Card h={200}><S w="50%" h={20} /><S w="30%" h={12} /><Lines n={3} /></Card>
    </main>
  ),
  wallet: () => (
    <main className="page stack page--top psk">
      <div className="psk-lines"><h1 style={{ margin: 0 }}>My wallet</h1><S w="70%" h={10} /></div>
      <Tabs labels={['By store', 'Loyalty cards', 'Refunds', 'Paid to you']} />
      <S h={170} r={18} />
    </main>
  ),
  quests: () => (
    <main className="page psk" style={{ maxWidth: 760 }}>
      <span className="psk-row psk-row--between"><h1 style={{ margin: 0 }}>Quests</h1><S w={92} h={32} r={10} /></span>
      <Card h={160}><span className="psk-row"><S w={72} h={72} r="50%" /><span className="psk-lines" style={{ flex: 1 }}><S w="50%" h={9} /><S w="70%" h={22} /><S w="44%" h={10} /><S h={6} r={999} /></span></span><S h={46} r={12} /></Card>
      <Card h={76}><span className="psk-row"><S w={40} h={46} r={10} /><span className="psk-lines" style={{ flex: 1 }}><S w="40%" /><S w="90%" h={16} /></span></span></Card>
      <Card h={66}><S w="60%" /><span className="psk-row" style={{ justifyContent: 'flex-end' }}><S w={84} h={28} r={10} /></span></Card>
      <Card h={140}><S w="40%" h={12} /><S h={36} r={999} /><S h={44} r={12} /></Card>
    </main>
  ),
  pro: () => (
    <div className="page psk psk-bill">
      <Card h={260} className="psk-hero"><S w={60} h={20} r={6} /><S w="80%" h={40} /><S w="70%" h={40} /><Lines n={2} /><S w={150} h={44} r={12} /></Card>
      <S h={20} />
      <S w={130} h={20} />
      {Array.from({ length: 3 }, (_, i) => <Card key={i} h={66}><span className="psk-row"><S w={20} h={14} /><S w={36} h={36} r={10} /><span className="psk-lines" style={{ flex: 1 }}><S w="80%" h={14} /><S w="40%" h={9} /></span><S w={26} h={26} r="50%" /></span></Card>)}
    </div>
  ),
  fees: () => (
    <div className="page psk psk-bill">
      <header className="stack" style={{ gap: 4 }}><h1>Platform fees</h1><Lines n={4} /></header>
      <section className="psk-tiles2" aria-hidden="true">
        {['Overdue', 'To pay', 'Next due', 'Paid so far'].map((label) => <div key={label} className="psk-tile psk-tile--fee"><span className="muted">{label}</span><S w={40} h={20} /></div>)}
      </section>
      <Card h={170}><h2 style={{ margin: 0 }}>Your rates</h2><Lines n={4} /></Card>
      <Card h={90}><h2 style={{ margin: 0 }}>Each sale</h2><S w="70%" h={10} /></Card>
    </div>
  ),
  learn: () => (
    <main className="page psk">
      <div className="psk-learn">
        <span className="psk-lines">{Array.from({ length: 4 }, (_, i) => <S key={i} w={62} h={50} r={10} />)}</span>
        <span className="psk-lines" style={{ flex: 1 }}>
          <span className="psk-row"><S w={48} h={48} r={12} /><S w="40%" h={24} /></span>
          <Lines n={6} />
          <Card h={220}><S w="40%" h={9} /><Lines n={8} h={10} /></Card>
        </span>
      </div>
    </main>
  ),
  legal: () => (
    <main className="page psk" style={{ maxWidth: 720 }}>
      <S h={52} r={12} />
      <h1 style={{ margin: 0 }}>Policies</h1>
      {Array.from({ length: 6 }, (_, i) => <span key={i} className="psk-lines"><S w="40%" h={14} /><S w="80%" h={9} /></span>)}
    </main>
  ),
  tag: () => (
    <main className="page psk">
      <Back />
      <S w="50%" h={24} />
      <Grid n={4} />
    </main>
  ),
  generic: () => (
    <main className="page pageload psk">
      <span className="pageload__head"><S w={40} h={40} r={999} /><S w="48%" h={22} r={8} /></span>
      <Lines n={2} />
      <S h={132} r={16} />
      <Rows n={4} />
    </main>
  ),
} satisfies Record<string, () => JSX.Element>;

export type PageShape = keyof typeof SHAPES;

/**
 * Which page an address opens, as a skeleton shape. Read in the order the
 * app's own routes are matched (main.tsx), most specific first.
 */
export function shapeFor(pathname: string): PageShape {
  const path = pathname.replace(/\/+$/, '') || '/';
  const rules: [RegExp, PageShape][] = [
    [/^\/$/, 'feed'],
    [/^\/discover$/, 'discover'],
    [/^\/(listing|s\/l)\//, 'listing'],
    [/^\/sell$/, 'sell'],
    [/^\/shop(\/power-sale)?$/, 'shop'],
    [/^\/lot\//, 'lotboard'],
    [/^\/routes\/studio\//, 'studio'],
    [/^\/services$/, 'services'],
    [/^\/services\/mine(\/(forwarder|handler))?$/, 'servicesMine'],
    [/^\/services\/apply\//, 'apply'],
    [/^\/services\/store\//, 'console'],
    [/^\/services\/crew\//, 'crew'],
    [/^\/services\/(requests|quotes)\//, 'request'],
    [/^\/services\/[^/]+\/[^/]+\/[^/]+\/[^/]+$/, 'serviceDetail'],
    [/^\/services\/[^/]+\/[^/]+$/, 'store'],
    [/^\/services\/[^/]+$/, 'directory'],
    [/^\/open$/, 'open'],
    [/^\/social$/, 'social'],
    [/^\/social\/(c|f|p)\//, 'room'],
    [/^\/messages\//, 'thread'],
    [/^\/order\//, 'order'],
    [/^\/dispute\//, 'dispute'],
    [/^\/disputes$/, 'disputes'],
    [/^\/community-service$/, 'community'],
    [/^\/me$/, 'me'],
    [/^\/verify$/, 'verify'],
    [/^\/purchases\/lot\//, 'buyerLot'],
    [/^\/purchases$/, 'purchases'],
    [/^\/cart$/, 'cart'],
    [/^\/(wallet|refunds)$/, 'wallet'],
    [/^\/quests$/, 'quests'],
    [/^\/pro$/, 'pro'],
    [/^\/fees$/, 'fees'],
    [/^\/learn/, 'learn'],
    [/^\/legal/, 'legal'],
    [/^\/tags\//, 'tag'],
    // A bare handle: a person or a shop, whose page opens on its cover.
    [/^\/[^/]+$/, 'profile'],
  ];
  return rules.find(([pattern]) => pattern.test(path))?.[1] ?? 'generic';
}

/** The skeleton of one page. */
export function PageSkeleton({ shape }: { shape: PageShape }) {
  return SHAPES[shape]();
}
