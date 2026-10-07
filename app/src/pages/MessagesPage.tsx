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
import { shrink } from '../components/PhotoManager';

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
  /** Photos on their way: shown at once from the file, sent once they are up. */
  const [photos, setPhotos] = useState<DraftPhoto[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
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
  /** The list of messages, which scrolls on its own between the header and the bar. */
  const scroller = useRef<HTMLElement>(null);
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

  /** Where the reader left off: "N unread messages" is drawn above this one. */
  const [marker, setMarker] = useState<{ id: string; count: number } | null>(null);
  /** Opened at the marker rather than the end, so not pulled to the end yet. */
  const heldAtMarker = useRef(false);
  const load = useCallback(async (quiet = false) => {
    if (!handle) return;
    try {
      const fresh = await api.thread(handle, as);
      // Kept for as long as the chat is open: replying reads nothing new, and
      // the line should not vanish under somebody still catching up.
      if (fresh.firstUnreadId) setMarker({ id: fresh.firstUnreadId, count: fresh.unread ?? 0 });
      setData(fresh);
    } catch (err) {
      if (!quiet) setError(err instanceof ApiRequestError ? err.message : 'Could not open this conversation.');
    }
  }, [handle, as]);

  useEffect(() => {
    newest.current = null;
    heldAtMarker.current = false;
    setMarker(null);
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
      const height = scroller.current?.scrollHeight ?? 0;
      setData((current) => {
        if (!current) return current;
        // The page edge is inclusive, so the first message here comes back too.
        const known = new Set(current.messages.map((message) => message.id));
        const fresh = page.messages.filter((message) => !known.has(message.id));
        return { ...current, more: page.more && fresh.length > 0, messages: [...fresh, ...current.messages] };
      });
      // Hold the reader where they were rather than jumping to the top.
      requestAnimationFrame(() => {
        const list = scroller.current;
        if (list) list.scrollTop += list.scrollHeight - height;
      });
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
  // Opened with unread messages, it starts at the first of them instead, under
  // the line, so nothing new is scrolled past unseen.
  useLayoutEffect(() => {
    const last = data?.messages.at(-1)?.id ?? null;
    const list = scroller.current;
    if (list && last !== newest.current) {
      const line = !newest.current && marker ? document.getElementById('dm-unread') : null;
      // Where the line sits in the list; only worth stopping at when going to
      // the end would carry it off the top of the screen.
      const at = line ? list.scrollTop + line.getBoundingClientRect().top - list.getBoundingClientRect().top - 12 : 0;
      // Still catching up from the line, somebody else's new message waits at
      // the end rather than pulling them past what they have not read.
      const behind = heldAtMarker.current && newest.current
        && data?.messages.at(-1)?.from.handle !== data?.us.handle
        && list.scrollTop + list.clientHeight < list.scrollHeight - 240;
      if (line && at < list.scrollHeight - list.clientHeight) {
        list.scrollTo({ top: Math.max(0, at) });
        heldAtMarker.current = true;
      } else if (!behind) {
        list.scrollTo({ top: list.scrollHeight, behavior: newest.current ? 'smooth' : 'auto' });
      }
      newest.current = last;
    }
  }, [data?.messages, marker]);

  // Somebody reading the newest messages stays at them when the list
  // changes size - the keyboard coming or going, the bar growing a line, the
  // app brought back by a notification tap - rather than being left part way
  // up the conversation.
  const ready = Boolean(data);
  useEffect(() => {
    const list = scroller.current;
    if (!list) return;
    const atEnd = () => list.scrollTop + list.clientHeight >= list.scrollHeight - 240;
    // Opened at the unread line, the reader is not at the end until they get there.
    let reading = !heldAtMarker.current;
    const onScroll = () => { reading = atEnd(); };
    const settle = () => {
      if (document.visibilityState !== 'visible' || !reading) return;
      const end = () => list.scrollTo({ top: list.scrollHeight });
      window.requestAnimationFrame(end);
      window.setTimeout(end, 300);
    };
    const resized = new ResizeObserver(settle);
    resized.observe(list);
    list.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('visibilitychange', settle);
    window.addEventListener('pageshow', settle);
    return () => {
      resized.disconnect();
      list.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', settle);
      window.removeEventListener('pageshow', settle);
    };
  }, [ready]);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
  }, [body]);

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo]);

  const uploading = photos.some((photo) => !photo.name && !photo.failed);
  const sendable = photos.filter((photo) => photo.name).map((photo) => photo.name!);

  async function addPhotos(list: FileList | null) {
    if (!list) return;
    const chosen = [...list].filter((file) => file.type.startsWith('image/')).slice(0, 4 - photos.length);
    const drafts = chosen.map((file) => ({
      key: `${file.name}-${Math.random().toString(36).slice(2, 7)}`,
      preview: URL.createObjectURL(file),
      name: null as string | null,
      failed: false,
    }));
    setPhotos((all) => [...all, ...drafts]);
    await Promise.all(chosen.map(async (file, index) => {
      const key = drafts[index]!.key;
      try {
        const stored = await api.uploadChatPhoto(await shrink(file));
        setPhotos((all) => all.map((photo) => (photo.key === key ? { ...photo, name: stored.blobName } : photo)));
      } catch (err) {
        setPhotos((all) => all.map((photo) => (photo.key === key ? { ...photo, failed: true } : photo)));
        setError(err instanceof ApiRequestError ? err.message : 'A photo would not upload.');
      }
    }));
  }

  function dropPhoto(key: string) {
    setPhotos((all) => {
      const gone = all.find((photo) => photo.key === key);
      if (gone) URL.revokeObjectURL(gone.preview);
      return all.filter((photo) => photo.key !== key);
    });
  }

  async function send(event?: FormEvent) {
    event?.preventDefault();
    if (!handle || uploading || (!body.trim() && !about && sendable.length === 0)) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(handle, body.trim(), data?.us.handle, undefined, replyTo?.id, about?.id, sendable);
      setBody('');
      photos.forEach((photo) => URL.revokeObjectURL(photo.preview));
      setPhotos([]);
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
    if (marker?.id === message.id) {
      blocks.push(
        <div key="unread" id="dm-unread" className="chunread" role="separator">
          <span>{marker.count > 1 ? `${marker.count} unread messages` : 'Unread message'}</span>
        </div>,
      );
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
    <div className="social dmscreen">
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
      <main className="page social chroom dmroom" ref={scroller}>
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

      </main>

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
        {photos.length > 0 && (
          <div className="cbar__photos">
            {photos.map((photo) => (
              <span key={photo.key} className={`cbar__photo${photo.failed ? ' is-failed' : ''}${photo.name ? '' : ' is-loading'}`}>
                <img src={photo.preview} alt="" />
                <button type="button" className="cbar__photodrop" aria-label="Remove photo" onClick={() => dropPhoto(photo.key)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
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
          <input ref={fileInput} type="file" accept="image/*" multiple hidden
            onChange={(event) => { void addPhotos(event.target.files); event.target.value = ''; }} />
          <button type="button" className="cbar__attach" onClick={() => fileInput.current?.click()}
            disabled={photos.length >= 4} aria-label="Send a photo" title="Send a photo (only you two can see it)">
            <Icon name="image" size={18} />
          </button>
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
          <button type="submit" className="cbar__send" disabled={busy || uploading || (!body.trim() && !about && sendable.length === 0)} aria-label="Send">
            {busy ? <span className="writer__spin cbar__spin" /> : <Icon name="send" size={18} />}
          </button>
        </div>
      </form>
      )}
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
            // A photo with no words of its own is just the photo.
            message.photos?.length && /^Sent (a photo|\d+ photos)$/.test(message.body) ? null : (
              <p className="cmsg__body">{message.body}</p>
            )
          )}
          {message.photos && message.photos.length > 0 && (
            <div className={`cmsg__photos cmsg__photos--${Math.min(message.photos.length, 4)}`}>
              {message.photos.map((name) => (
                <img key={name} src={api.chatPhotoUrl(handle, name, thread.us.handle)} alt="Photo in this chat" loading="lazy" />
              ))}
            </div>
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

/** A chat photo being added: previewed from the file, named once it is up. */
interface DraftPhoto {
  key: string;
  preview: string;
  name: string | null;
  failed: boolean;
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
