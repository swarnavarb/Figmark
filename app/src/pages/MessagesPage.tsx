import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Message, MessageDeal } from '@shared/models';
import { REACTIONS, REACTION_META, type ReactionKind } from '@shared/social';
import type { SavedCalc } from '@shared/profit';
import { ApiRequestError, api, type Inbox, type Thread } from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon, LevelChip, useConfirm } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { DealCard, DealForm, DealPicker, ItemRefCard, useMakeDeal } from '../components/PrivateDeal';
import { formatMoney } from '../format';
import { timeAgo } from '../format';
import { VoicePicker, VoiceScope } from '../components/SocialVoice';
import { RoomBar, useLongPress } from '../components/SocialChrome';
import { useGoBack } from '../components/ScrollManager';

/**
 * The inbox.
 *
 * Rows are threads, not people, because the same person reaches you differently
 * depending on which of your handles they wrote to: a question to your shop is
 * not the same conversation as a message to you. Each row says which of your
 * voices it belongs to, so the two never blur together.
 */
export function MessagesView() {
  const navigate = useNavigate();
  const [data, setData] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [composing, setComposing] = useState(false);
  /** Which inbox is showing: a handle, or '' for everything. */
  const [box, setBox] = useState('');
  const [query, setQuery] = useState('');

  useEffect(() => {
    void api
      .inbox()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your messages.'),
      );
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <SkeletonRows count={4} />;

  // Threads addressed to you and threads addressed to your shop are two
  // inboxes, not one list with a label on each row: a shop's messages are work
  // and yours are not, and they get read at different times.
  const needle = query.trim().toLowerCase();
  const threads = data.threads
    .filter((row) => !box || row.us.handle === box)
    .filter((row) => !needle || row.them.displayName.toLowerCase().includes(needle)
      || row.them.handle.includes(needle) || row.lastMessage.toLowerCase().includes(needle));
  const unreadIn = (handle: string) =>
    data.threads.reduce((sum, row) => (row.us.handle === handle ? sum + row.unread : sum), 0);
  const voice = data.handles.find((party) => party.handle === box);
  const totalUnread = data.threads.reduce((sum, row) => sum + row.unread, 0);

  const start = (event: FormEvent) => {
    event.preventDefault();
    const handle = to.trim().replace(/^@/, '').toLowerCase();
    // Opening from inside one inbox writes from that voice.
    if (handle) navigate(`/messages/${encodeURIComponent(handle)}${box ? `?as=${encodeURIComponent(box)}` : ''}`);
  };

  return (
    <div className="chlist inbox">
      {/* The inboxes, and writing to somebody new as a pen at the end of the
          row - a handle is all it needs, so it opens as one field. */}
      <div className="inbox__boxes" role="tablist" aria-label="Inbox">
        {data.handles.length > 1 && (
          <>
            <button type="button" role="tab" aria-selected={box === ''} className={`chip${box === '' ? ' is-on' : ''}`}
              onClick={() => setBox('')}>
              All{totalUnread > 0 && <span className="chip__count">{totalUnread}</span>}
            </button>
            {data.handles.map((party) => {
              const unread = unreadIn(party.handle);
              return (
                <button key={party.handle} type="button" role="tab" aria-selected={box === party.handle}
                  className={`chip${box === party.handle ? ' is-on' : ''}`} onClick={() => setBox(party.handle)}>
                  {party.isStore ? party.displayName : 'You'}
                  {unread > 0 && <span className="chip__count">{unread}</span>}
                </button>
              );
            })}
          </>
        )}
        <button type="button" className={`inbox__compose${composing ? ' is-on' : ''}`} aria-label="New message"
          aria-expanded={composing} title="New message" disabled={data.handles.length === 0}
          onClick={() => setComposing((now) => !now)}>
          <Icon name="compose" size={17} />
        </button>
      </div>
      {composing && (
        <form className="inbox__new" onSubmit={start}>
          <span className="inbox__newicon" aria-hidden="true">@</span>
          <input autoFocus value={to} onChange={(e) => setTo(e.target.value)} placeholder="username"
            aria-label="Message someone by username" />
          <button type="submit" className="inbox__go" disabled={!to.trim()} aria-label="Open conversation">
            <Icon name="send" size={15} />
          </button>
        </form>
      )}
      {data.handles.length === 0 && (
        <p className="faint">Pick a username in <Link to="/me?tab=settings">your settings</Link> before messaging anyone.</p>
      )}

      {data.threads.length > 3 && (
        <label className="chlist__search">
          <Icon name="search" size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations" aria-label="Search conversations" />
        </label>
      )}

      {threads.length === 0 ? (
        <EmptyState icon={<Icon name="mail" size={26} />}
          title={needle ? 'No conversation matches' : voice ? `Nothing for ${voice.isStore ? voice.displayName : 'you'} yet` : 'No messages yet'}>
          {needle ? 'Try another name.' : 'Tap the pen to write to someone, or message a shop from its page.'}
        </EmptyState>
      ) : (
        <div className="chrows">
          {threads.map((row) => (
            <Link key={row.threadId}
              to={`/messages/${encodeURIComponent(row.them.handle)}?as=${encodeURIComponent(row.us.handle)}`}
              className={`chrow${row.unread > 0 ? ' is-unread' : ''}`}>
              <span className={`chrow__ring${row.unread > 0 ? ' is-lit' : ''}`}>
                <Avatar name={row.them.displayName} size={48} />
              </span>
              <span className="chrow__body">
                <span className="chrow__top">
                  <span className="chrow__name">
                    {row.them.displayName}
                    <LevelChip tag={row.them.level} inline />
                    {row.them.isStore && <span className="chrow__tier">SHOP</span>}
                  </span>
                  <span className="chrow__time">{timeAgo(row.lastAt)}</span>
                </span>
                <span className="chrow__bottom">
                  <span className="chrow__last">
                    {row.lastFromUs && <strong>You: </strong>}
                    {row.lastMessage}
                  </span>
                  {row.muted && <span className="chrow__muted" aria-label="Muted"><Icon name="bell" size={12} /></span>}
                  {row.unread > 0 && <span className="chrow__badge">{row.unread > 9 ? '9+' : row.unread}</span>}
                </span>
                {/* Which of your voices this thread belongs to - said only in
                    the combined view, where the rows are mixed together. */}
                {box === '' && data.handles.length > 1 && (
                  <span className="chrow__to">to @{row.us.handle}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One conversation.
 *
 * Laid out like a channel room - the same bar at the top, the same bubbles,
 * days and runs, the same bar to write from - because a conversation with a
 * shop and a shop's channel are the same kind of talking, and a gesture
 * learned in one should work in the other: hold a message to reply to it or
 * react, double-tap to love it.
 *
 * The handle you are speaking as is in the URL, because it is part of which
 * conversation this is rather than a preference.
 */
export function ThreadPage() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const as = params.get('as') ?? undefined;
  const back = useGoBack('/social?view=messages');

  const [data, setData] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Arriving from a saved calculation's "Private deal": the form opens with it.
  // Watched by the navigation's key, because "Private deal" pressed while this
  // very chat is open lands on the same page rather than a fresh one.
  const location = useLocation();
  // The buyer's ask-for-a-deal form. A shop makes its deal on the full listing form instead.
  // `?ask=<what>` opens it prefilled; an item's Message button uses `?about=<item>` instead.
  const askFor = params.get('ask');
  const [asking, setAsking] = useState(askFor !== null);
  const makeDeal = useMakeDeal();
  const us = data?.us;
  const them = data?.them;
  useEffect(() => {
    const dealCalc = (location.state as { dealCalc?: SavedCalc } | null)?.dealCalc;
    if (!dealCalc || !us?.isStore || !them) return;
    // Spent here, so coming back from the form is the chat rather than the form again.
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
    makeDeal(us, them, { calc: dealCalc });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, us?.handle, them?.handle]);
  const input = useRef<HTMLTextAreaElement>(null);
  const newest = useRef<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [older, setOlder] = useState(false);
  /** The shop's deal picker, open on nothing in particular or on one item. */
  const [picker, setPicker] = useState<{ focus: string | null } | null>(null);
  // Arriving from an item's Message button: `?about=<item>` rides on the next message.
  const aboutId = params.get('about');
  const [about, setAbout] = useState<AboutItem | null>(null);
  useEffect(() => {
    if (!aboutId) { setAbout(null); return; }
    let cancelled = false;
    void api.listing(aboutId).then(({ listing }) => {
      if (cancelled) return;
      const photo = listing.photos.find((row) => row.isPrimary) ?? listing.photos[0];
      setAbout({
        id: listing.id, title: listing.title, photo: photo?.url || null,
        priceMinor: listing.priceMinor, currency: listing.currency, condition: listing.condition,
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [aboutId]);
  const dropAbout = () => {
    setAbout(null);
    const next = new URLSearchParams(params);
    next.delete('about');
    navigate(`${location.pathname}${next.size ? `?${next}` : ''}`, { replace: true });
  };
  const { confirm, dialog } = useConfirm();

  const load = useCallback(async (quiet = false) => {
    if (!handle) return;
    try {
      setData(await api.thread(handle, as));
    } catch (err) {
      if (!quiet) setError(err instanceof ApiRequestError ? err.message : 'Could not open this conversation.');
    }
  }, [handle, as]);

  useEffect(() => {
    newest.current = null;
    void load();
  }, [load]);

  // Live while it is on screen, like a room - asking only for what arrived
  // since the newest message here, rather than the whole conversation again.
  const latest = data?.messages.at(-1)?.createdAt;
  useEffect(() => {
    if (!handle || !data) return;
    const tick = window.setInterval(async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const fresh = await api.thread(handle, as, latest ? { since: latest } : {});
        if (fresh.messages.length === 0) return;
        setData((current) => {
          if (!current) return fresh;
          const known = new Set(current.messages.map((message) => message.id));
          return { ...current, messages: [...current.messages, ...fresh.messages.filter((message) => !known.has(message.id))] };
        });
      } catch {
        // A missed refresh is caught by the next one.
      }
    }, 10_000);
    return () => window.clearInterval(tick);
  }, [handle, as, latest, Boolean(data)]);

  /** The page before the first message here, kept in place on screen. */
  async function loadOlder() {
    const first = data?.messages[0];
    if (!handle || !first) return;
    setOlder(true);
    try {
      const page = await api.thread(handle, as, { before: first.createdAt });
      const height = document.documentElement.scrollHeight;
      setData((current) => {
        if (!current) return current;
        // The page edge is inclusive, so the first message here comes back too.
        const known = new Set(current.messages.map((message) => message.id));
        const fresh = page.messages.filter((message) => !known.has(message.id));
        return { ...current, more: page.more && fresh.length > 0, messages: [...fresh, ...current.messages] };
      });
      // Hold the reader where they were rather than jumping to the top.
      requestAnimationFrame(() => window.scrollBy(0, document.documentElement.scrollHeight - height));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load earlier messages.');
    } finally {
      setOlder(false);
    }
  }

  async function toggleMute() {
    if (!handle || !data) return;
    setMenu(false);
    try {
      const { muted } = await api.muteThread(handle, !data.muted, data.us.handle);
      setData((current) => current && { ...current, muted });
      setNotice(muted ? 'Muted. It stays here without counting as unread.' : 'Unmuted.');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change that.');
    }
  }

  async function toggleBlock() {
    if (!handle || !data) return;
    setMenu(false);
    if (!data.blocked && !(await confirm({
      title: `Block @${data.them.handle}?`,
      body: 'Neither of you can write to the other until you unblock. The conversation leaves your inbox.',
      action: 'Block', danger: true,
    }))) return;
    try {
      const { blocked } = await api.blockHandle(handle, !data.blocked);
      setData((current) => current && { ...current, blocked });
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not change that.');
    }
  }

  // A conversation is read at the bottom - and taken there again when
  // something new arrives at the end. Earlier pages land at the top and do not.
  useLayoutEffect(() => {
    const last = data?.messages.at(-1)?.id ?? null;
    if (last !== newest.current) {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: newest.current ? 'smooth' : 'auto' });
      newest.current = last;
    }
  }, [data?.messages]);

  // Somebody reading the newest messages stays at them when the page lays
  // itself out again - brought back by a notification tap, or the keyboard
  // going away - rather than being left part way up the conversation.
  useEffect(() => {
    const atEnd = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
    let reading = true;
    const onScroll = () => { reading = atEnd(); };
    const settle = () => {
      if (document.visibilityState !== 'visible' || !reading) return;
      const end = () => window.scrollTo({ top: document.documentElement.scrollHeight });
      window.requestAnimationFrame(end);
      window.setTimeout(end, 300);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', settle);
    window.addEventListener('pageshow', settle);
    window.visualViewport?.addEventListener('resize', settle);
    return () => {
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', settle);
      window.removeEventListener('pageshow', settle);
      window.visualViewport?.removeEventListener('resize', settle);
    };
  }, []);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
  }, [body]);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!handle || (!body.trim() && !about)) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(handle, body.trim(), data?.us.handle, undefined, replyTo?.id, about?.id);
      setBody('');
      setReplyTo(null);
      if (about) dropAbout();
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  const patch = (id: string, change: Partial<Message>) =>
    setData((current) => current && {
      ...current,
      messages: current.messages.map((message) => (message.id === id ? { ...message, ...change } : message)),
    });

  const jump = (id: string) => {
    const node = document.getElementById(`dm-${id}`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    node.classList.remove('is-flash');
    void node.offsetWidth;
    node.classList.add('is-flash');
  };

  if (error && !data) {
    return (
      <div className="social">
        <RoomBar tone="chat" onBack={back} avatar={<Avatar name={handle ?? '?'} size={34} />} title={`@${handle}`} />
        <main className="page social"><ErrorNotice message={error} /></main>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="social">
        <RoomBar tone="chat" onBack={back} avatar={<span className="skel" style={{ width: 34, height: 34, borderRadius: '50%' }} />}
          title={<span className="skel" style={{ width: 110, height: 12 }} />} />
        <main className="page social"><SkeletonRows count={5} /></main>
      </div>
    );
  }

  const blocks: ReactNode[] = [];
  let lastDay = '';
  data.messages.forEach((message, index) => {
    const day = dayOf(message.createdAt);
    if (day !== lastDay) {
      blocks.push(<div key={`day-${message.id}`} className="chday"><span>{day}</span></div>);
      lastDay = day;
    }
    const previous = data.messages[index - 1];
    // A run is consecutive messages from the same voice inside five minutes.
    const startsRun = !previous || previous.from.handle !== message.from.handle
      || dayOf(previous.createdAt) !== day || gapTooBig(previous.createdAt, message.createdAt);
    blocks.push(
      <DirectMessage key={message.id} message={message} thread={data} startsRun={startsRun}
        onReply={() => setReplyTo(message)} onJump={jump} onNotice={setNotice}
        onDeal={(deal) => makeDeal(data.us, data.them, { from: deal })}
        onDealFrom={(listingId) => setPicker({ focus: listingId })}
        onReactions={(reactions) => patch(message.id, { reactions })}
        handle={handle!} />,
    );
  });

  const dealable = data.us.isStore !== data.them.isStore;

  return (
    <div className="social">
      <RoomBar tone="chat" onBack={back}
        avatar={<Avatar name={data.them.displayName} size={34} />}
        title={<>{data.them.displayName}<LevelChip tag={data.them.level} inline />{data.them.isStore && <span className="roombar__tier">SHOP</span>}</>}
        sub={<>@{data.them.handle} · you as @{data.us.handle}</>}
        action={(
          <span className="dmactions">
            <Link to={`/${data.them.handle}`} className="roombar__btn">
              <Icon name={data.them.isStore ? 'tag' : 'users'} size={13} /> {data.them.isStore ? 'Shop' : 'Profile'}
            </Link>
            <span className="spost__menuwrap">
              <button type="button" className="iconbtn" aria-label="Conversation options" aria-expanded={menu}
                onClick={() => setMenu(!menu)}>
                <Icon name="more" size={18} />
              </button>
              {menu && (
                <span className="spost__menu" role="menu" onMouseLeave={() => setMenu(false)}>
                  <button type="button" role="menuitem" onClick={() => void toggleMute()}>
                    <Icon name="bell" size={15} /> {data.muted ? 'Unmute' : 'Mute'}
                  </button>
                  <button type="button" role="menuitem" className={data.blocked ? undefined : 'is-danger'}
                    onClick={() => void toggleBlock()}>
                    <Icon name="lock" size={15} /> {data.blocked ? 'Unblock' : `Block @${data.them.handle}`}
                  </button>
                </span>
              )}
            </span>
          </span>
        )} />

      {dialog}
      <main className="page social chroom dmroom">
        <div className="chthread">
          {data.more && (
            <button type="button" className="chmore" disabled={older} onClick={() => void loadOlder()}>
              {older ? 'Loading…' : 'Load earlier messages'}
            </button>
          )}
          {data.messages.length === 0 ? (
            <EmptyState icon={<Icon name="message" size={26} />} title="Say hello">
              Start the conversation with {data.them.displayName}.
            </EmptyState>
          ) : blocks}
        </div>

        {notice && <p className="chtoast" role="status" onAnimationEnd={() => setNotice(null)}>{notice}</p>}

        {picker && data.us.isStore && (
          <DealPicker us={data.us} them={data.them} focus={picker.focus} onClose={() => setPicker(null)} />
        )}

        {asking && !data.us.isStore && data.them.isStore && (
          <DealForm us={data.us} them={data.them} initialTitle={askFor ?? ''} onClose={() => setAsking(false)}
            onSent={() => { setAsking(false); void load(); }} />
        )}

        {data.blocked ? (
          <div className="cbar cbar--blocked">
            {error && <p className="notice notice--error" onClick={() => setError(null)}>{error}</p>}
            <p>You blocked @{data.them.handle}. Neither of you can write here.</p>
            <button type="button" className="followbtn" onClick={() => void toggleBlock()}>Unblock</button>
          </div>
        ) : (
        <form className="cbar" onSubmit={(event) => void send(event)}>
          {error && <p className="notice notice--error" onClick={() => setError(null)}>{error}</p>}
          {about && (
            <div className="cbar__about">
              <span className="cbar__aboutitem">
                {about.photo
                  ? <img src={about.photo} alt="" />
                  : <span className="cbar__aboutblank" aria-hidden="true"><Icon name="tag" size={16} /></span>}
                <span className="cbar__aboutbody">
                  <small>Asking about</small>
                  <b>{about.title}</b>
                  <span>{formatMoney(about.priceMinor, about.currency)} · {about.condition}</span>
                </span>
                <button type="button" className="iconbtn" aria-label="Not about this item" onClick={dropAbout}>
                  <Icon name="close" size={13} />
                </button>
              </span>
              {/* The questions everybody asks, a tap away. Each one fills the
                  box rather than sending, so it can be changed first. */}
              <span className="cbar__prompts">
                {aboutPrompts(about).map((line) => (
                  <button key={line} type="button" className="cbar__prompt"
                    onClick={() => { setBody(line); input.current?.focus(); }}>{line}</button>
                ))}
              </span>
            </div>
          )}
          {replyTo && (
            <div className="cbar__reply">
              <span className="cbar__replybody">
                <strong>Replying to {replyTo.from.handle === data.us.handle ? 'yourself' : replyTo.from.displayName}</strong>
                <span>{replyTo.body}</span>
              </span>
              <button type="button" className="iconbtn" aria-label="Cancel reply" onClick={() => setReplyTo(null)}>
                <Icon name="close" size={13} />
              </button>
            </div>
          )}
          <div className="cbar__row">
            {/* Whose voice you are writing in, switched from where you write.
                Each voice is its own conversation, so switching opens that one. */}
            {data.handles.length > 1 && (
              <VoiceScope
                voice={{ storeId: data.us.isStore ? data.us.handle : null, name: data.us.displayName, handle: data.us.handle }}
                voices={data.handles.map((party) => ({
                  storeId: party.isStore ? party.handle : null, name: party.displayName, handle: party.handle,
                }))}
                choose={(storeId) => {
                  const party = data.handles.find((entry) => (storeId ? entry.handle === storeId : !entry.isStore));
                  if (party && party.handle !== data.us.handle) {
                    navigate(`/messages/${encodeURIComponent(handle!)}?as=${encodeURIComponent(party.handle)}`, { replace: true });
                  }
                }}>
                <VoicePicker size={36} title="Write as" />
              </VoiceScope>
            )}
            {dealable && (
              <button type="button" className="cbar__attach" onClick={() => (data.us.isStore ? setPicker({ focus: null }) : setAsking(true))}
                aria-label={data.us.isStore ? 'Make a private deal' : 'Ask for a private deal'}
                title={data.us.isStore ? 'Make a private deal' : 'Ask for a private deal'}>
                🤝
              </button>
            )}
            <textarea ref={input} className="cbar__input" rows={1} value={body} maxLength={4000}
              placeholder={replyTo ? 'Write a reply…' : about ? 'Ask a question or name your price…' : `Message ${data.them.displayName}…`} aria-label="Message"
              onChange={(event) => setBody(event.target.value)}
              onKeyDown={(event) => {
                // Enter sends, shift-enter makes a line: the bargain every messenger makes.
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
                if (event.key === 'Escape') setReplyTo(null);
              }} />
            <button type="submit" className="cbar__send" disabled={busy || (!body.trim() && !about)} aria-label="Send">
              {busy ? <span className="writer__spin cbar__spin" /> : <Icon name="send" size={18} />}
            </button>
          </div>
        </form>
        )}
      </main>
    </div>
  );
}

/** One message in a conversation: hold it for the rest. */
function DirectMessage({ message, thread, handle, startsRun, onReply, onJump, onNotice, onDeal, onDealFrom, onReactions }: {
  message: Message;
  thread: Thread;
  handle: string;
  startsRun: boolean;
  onReply: () => void;
  onJump: (id: string) => void;
  onNotice: (text: string) => void;
  onDeal: (deal: MessageDeal) => void;
  onDealFrom: (listingId: string) => void;
  onReactions: (reactions: NonNullable<Message['reactions']>) => void;
}) {
  const mine = message.from.handle === thread.us.handle;
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const press = useLongPress(() => {
    setOpen(true);
    setPicking(false);
  });

  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);

  const reactions = message.reactions ?? [];
  const minekind = reactions.find((entry) => entry.handle === thread.us.handle)?.kind ?? null;
  const tally = REACTIONS.map((kind) => ({ kind, count: reactions.filter((entry) => entry.kind === kind).length }))
    .filter((entry) => entry.count > 0);

  async function react(kind: ReactionKind) {
    const before = reactions;
    const others = before.filter((entry) => entry.handle !== thread.us.handle);
    onReactions(minekind === kind ? others : [...others, { handle: thread.us.handle, kind }]);
    setOpen(false);
    setPicking(false);
    try {
      onReactions((await api.reactToMessage(handle, message.id, kind, thread.us.handle)).reactions);
    } catch (err) {
      onReactions(before);
      onNotice(err instanceof ApiRequestError ? err.message : 'Could not react.');
    }
  }

  async function copy() {
    setOpen(false);
    try {
      await navigator.clipboard.writeText(message.body);
      onNotice('Copied');
    } catch {
      onNotice('Could not copy');
    }
  }

  return (
    <div id={`dm-${message.id}`} ref={box}
      className={`cmsg cmsg--${mine ? 'mine' : 'visitor'}${startsRun ? ' is-first' : ''}${open ? ' is-open' : ''}`}>
      {!mine && (
        <span className="cmsg__avatar">{startsRun ? <Avatar name={message.from.displayName} size={32} /> : null}</span>
      )}
      <div className="cmsg__col">
        {startsRun && !mine && message.from.isStore && (
          <span className="cmsg__who">{message.from.displayName}<span className="cmsg__role">Shop</span></span>
        )}
        <div className="cmsg__bubble" role="button" tabIndex={0} aria-expanded={open}
          aria-label="Message. Press and hold for actions" {...press}
          onDoubleClick={() => void react('love')}
          onKeyDown={(event) => (event.key === 'Enter' || event.key === 'ContextMenu') && setOpen(!open)}>
          {message.replyTo && (
            <button type="button" className="cmsg__quote" onClick={() => onJump(message.replyTo!.id)}>
              <strong>{message.replyTo.name}</strong>
              <span>{message.replyTo.body}</span>
            </button>
          )}
          {message.item && <ItemRefCard message={message} mine={mine} us={thread.us} onDealFrom={onDealFrom} />}
          {message.deal ? (
            <DealCard message={message} mine={mine} us={thread.us} onAnswer={onDeal} />
          ) : message.item && message.body === `About ${message.item.title}` ? null : (
            <p className="cmsg__body">{message.body}</p>
          )}
          <span className="cmsg__time">
            {timeAgo(message.createdAt)}
            {mine && <span className="cmsg__read" aria-label={message.readAt ? 'Read' : 'Sent'}>{message.readAt ? ' ✓✓' : ' ✓'}</span>}
          </span>
        </div>

        {tally.length > 0 && (
          <div className="cmsg__reactions">
            {tally.map((entry) => (
              <button key={entry.kind} type="button" className={`cmsg__chip${minekind === entry.kind ? ' is-mine' : ''}`}
                aria-label={`${REACTION_META[entry.kind].label}, ${entry.count}`} onClick={() => void react(entry.kind)}>
                {REACTION_META[entry.kind].emoji}{entry.count > 1 ? ` ${entry.count}` : ''}
              </button>
            ))}
          </div>
        )}

        {open && (
          <div className="cmsg__actions">
            {picking ? (
              <span className="cmsg__picker">
                {REACTIONS.map((kind, index) => (
                  <button key={kind} type="button" aria-label={REACTION_META[kind].label}
                    style={{ animationDelay: `${index * 25}ms` }} onClick={() => void react(kind)}>
                    {REACTION_META[kind].emoji}
                  </button>
                ))}
              </span>
            ) : (
              <>
                <button type="button" onClick={() => setPicking(true)}><Icon name="smile" size={14} /> React</button>
                <button type="button" onClick={() => { onReply(); setOpen(false); }}><Icon name="back" size={14} /> Reply</button>
                <button type="button" onClick={() => void copy()}><Icon name="copy" size={14} /> Copy</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** The item a message is about to be about, before it is sent. */
interface AboutItem {
  id: string;
  title: string;
  photo: string | null;
  priceMinor: number;
  currency: string;
  condition: string;
}

/** What people ask about an item, ready to tap - the bargain priced off this item. */
function aboutPrompts(item: AboutItem): string[] {
  // Ten percent off, rounded to a tidy figure: a first offer, not an insult.
  const step = item.priceMinor >= 100_000 ? 10_000 : item.priceMinor >= 10_000 ? 1_000 : 100;
  const offer = Math.max(step, Math.round((item.priceMinor * 0.9) / step) * step);
  return [
    'Is this still available?',
    `Would you take ${formatMoney(offer, item.currency)}?`,
    'Can you share more photos?',
    'When can it ship?',
  ];
}

function dayOf(iso: string): string {
  const day = new Date(iso);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(day, new Date())) return 'Today';
  if (same(day, new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** Five minutes. Long enough to be the same thought, short enough to be one. */
const RUN_GAP_MS = 5 * 60 * 1000;

function gapTooBig(earlier: string, later: string): boolean {
  return new Date(later).getTime() - new Date(earlier).getTime() > RUN_GAP_MS;
}
