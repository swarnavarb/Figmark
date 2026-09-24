import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MessageDeal, MessageParty } from '@shared/models';
import { ApiRequestError, api, type Inbox, type Thread } from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon } from '../components/ui';
import { SkeletonRows } from '../components/Feedback';
import { DealCard, DealForm } from '../components/PrivateDeal';
import { timeAgo } from '../format';

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
  /** Which inbox is showing: a handle, or '' for everything. */
  const [box, setBox] = useState('');
  const [composing, setComposing] = useState(false);

  useEffect(() => {
    void api
      .inbox()
      .then(setData)
      .catch((err: unknown) =>
        setError(err instanceof ApiRequestError ? err.message : 'Could not load your messages.'),
      );
  }, []);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  // Threads addressed to you and threads addressed to your shop are two
  // inboxes, not one list with a label on each row: a shop's messages are work
  // and yours are not, and they get read at different times.
  const threads = box ? data.threads.filter((row) => row.us.handle === box) : data.threads;
  const unreadIn = (handle: string) =>
    data.threads.reduce((sum, row) => (row.us.handle === handle ? sum + row.unread : sum), 0);
  const voice = data.handles.find((party) => party.handle === box);

  return (
    <div className="stack">
      {/* Only worth showing when there is more than one voice to separate. */}
      {data.handles.length > 1 && (
        <div className="pills pills--sm">
          <button type="button" className={`pill${box === '' ? ' is-on' : ''}`}
            aria-pressed={box === ''} onClick={() => setBox('')}>
            <span className="pill__label">All</span>
          </button>
          {data.handles.map((party) => {
            const unread = unreadIn(party.handle);
            return (
              <button
                key={party.handle}
                type="button"
                className={`pill${box === party.handle ? ' is-on' : ''}`}
                aria-pressed={box === party.handle}
                onClick={() => setBox(party.handle)}
              >
                <span className="pill__label">
                  {party.isStore ? party.displayName : 'You'}
                  {unread > 0 && <span className="badge badge--accent" style={{ marginLeft: 6 }}>{unread}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {/* The inbox is the content here, so the way to start a new conversation
          is a button until it is wanted: on a phone this form was pushing every
          thread below the fold. */}
      {!composing ? (
        <button type="button" className="btn btn--ghost btn--sm" style={{ justifySelf: 'start' }}
          onClick={() => setComposing(true)}>
          <Icon name="plus" size={14} /> New message
        </button>
      ) : (
        <form
          className="card card--pad form"
          onSubmit={(event) => {
            event.preventDefault();
            const handle = to.trim().replace(/^@/, '').toLowerCase();
            // Opening from inside one inbox writes from that voice.
            if (handle) navigate(`/messages/${encodeURIComponent(handle)}${box ? `?as=${encodeURIComponent(box)}` : ''}`);
          }}
        >
          <label className="field">
            <span>Message someone</span>
            <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@username" autoFocus />
            <span className="field__hint">
              {data.handles.length === 0 ? (
                <>Pick a username in <Link to="/me?tab=settings">your settings</Link> before messaging anyone.</>
              ) : box ? (
                <>Anyone with a username. This one goes out as <code>@{box}</code>.</>
              ) : (
                <>
                  Anyone with a username — a person or a shop. You speak as{' '}
                  {data.handles.map((party) => `@${party.handle}`).join(' or ')}.
                </>
              )}
            </span>
          </label>
          <div className="row">
            <button type="submit" className="btn" disabled={!to.trim()}>Open conversation</button>
            <button type="button" className="btn btn--quiet" onClick={() => setComposing(false)}>Cancel</button>
          </div>
        </form>
      )}

      {threads.length === 0 ? (
        <EmptyState title={voice ? `Nothing for ${voice.isStore ? voice.displayName : 'you'} yet` : 'No messages yet'}>
          Start one above, or from any shop's page.
        </EmptyState>
      ) : (
        <div className="card">
          {threads.map((row) => (
            <Link
              key={row.threadId}
              to={`/messages/${encodeURIComponent(row.them.handle)}?as=${encodeURIComponent(row.us.handle)}`}
              className="channel"
            >
              <Avatar name={row.them.displayName} size={46} />
              <div className="channel__body">
                <div className="channel__top">
                  <span className="channel__name">
                    {row.them.displayName}
                    {row.them.isStore && <span className="badge" style={{ marginLeft: 6 }}>shop</span>}
                  </span>
                  <span className="faint">{timeAgo(row.lastAt)}</span>
                </div>
                <span className="channel__last">
                  {row.lastFromUs && 'You: '}
                  {row.lastMessage}
                </span>
                {/* Which of your voices this thread belongs to - said only in
                    the combined view, where the rows are mixed together. */}
                {box === '' && data.handles.length > 1 && (
                  <span className="faint">to @{row.us.handle}</span>
                )}
              </div>
              {row.unread > 0 && <span className="badge badge--accent">{row.unread}</span>}
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
 * Its own route so a thread can be linked to and the back button behaves. The
 * handle you are speaking as is in the URL, because it is part of which
 * conversation this is rather than a preference.
 */
export function ThreadPage() {
  const { handle } = useParams<{ handle: string }>();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const as = params.get('as') ?? undefined;

  const [data, setData] = useState<Thread | null>(null);
  // Only used by the list pane, which exists from 960px up. Fetched
  // unconditionally because the breakpoint is a CSS fact, not a React one,
  // and a resize must not have to trigger a request.
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  // The private deal form: open, and the buyer's ask it answers, if any.
  const [dealing, setDealing] = useState<{ from: MessageDeal | null } | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!handle) return;
    try {
      setData(await api.thread(handle, as));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not open this conversation.');
    }
  }, [handle, as]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void api.inbox().then(setInbox).catch(() => setInbox(null));
  }, [data?.messages.length]);

  // A conversation is read at the bottom.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

  /*
   * The composer grows with what is in it, up to a point.
   *
   * Height is set from scrollHeight rather than animated, because the value
   * is not known until the text has laid out. The CSS transition on
   * max-height is what makes the change read as growth rather than a jump.
   */
  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 132)}px`;
  }, [body]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!handle) return;
    setBusy(true);
    setError(null);
    try {
      await api.sendMessage(handle, body.trim(), data?.us.handle);
      setBody('');
      await load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <main className="page tab-view"><ErrorNotice message={error} /></main>;
  if (!data) {
    return (
      <main className="page tab-view">
        <SkeletonRows count={5} />
      </main>
    );
  }

  const shownAs = data.us.handle;

  return (
    /*
     * The conversation owns the screen.
     *
     * It used to be a 58vh scroll well inside the same centred 1180px page as
     * every other screen, under a back link, a header and a voice picker, with
     * the composer loose in the document flow. That is a transcript on a page.
     * This is three rows on the viewport: a header that stays, a body that
     * scrolls, and a composer pinned above the keyboard and the home
     * indicator. dvh rather than vh, because vh is exactly the number that is
     * wrong while an iOS address bar is on screen.
     */
    <main className="chat">
      {/* The conversation list, on a screen wide enough to hold both. Below
          960px it is not rendered at all rather than hidden, because the
          inbox is already its own route there and a duplicate list would be
          two places showing the same thing. */}
      <aside className="chat__list" aria-label="Conversations">
        {(inbox?.threads ?? []).map((row) => (
          <Link
            key={`${row.them.handle}-${row.us.handle}`}
            to={`/messages/${encodeURIComponent(row.them.handle)}?as=${encodeURIComponent(row.us.handle)}`}
            className={`chat__conv${row.them.handle === data.them.handle ? ' is-on' : ''}`}
          >
            <Avatar name={row.them.displayName} size={32} />
            <span className="chat__conv-body">
              <span className="chat__conv-name">{row.them.displayName}</span>
              <span className="chat__conv-last">{row.lastMessage}</span>
            </span>
            {row.unread > 0 && <span className="badge badge--hot">{row.unread}</span>}
          </Link>
        ))}
      </aside>

      <header className="chat__head">
        <Link to="/social" className="chat__back" aria-label="Back to messages">
          <Icon name="back" size={18} />
        </Link>
        <Avatar name={data.them.displayName} size={36} />
        <div className="chat__who">
          <span className="chat__name">
            {data.them.displayName}
            {data.them.isStore && <span className="badge badge--accent">shop</span>}
          </span>
          <Link to={`/${data.them.handle}`} className="chat__handle">@{data.them.handle}</Link>
        </div>

        {/* Whose voice you are using. It belongs in the header rather than in
            a field above the transcript: it labels the conversation, it is not
            a thing you fill in before writing. */}
        {data.handles.length > 1 ? (
          <label className="chat__as">
            <span className="chat__as-label">as</span>
            <select
              value={shownAs}
              aria-label="Writing as"
              onChange={(event) =>
                navigate(
                  `/messages/${encodeURIComponent(handle!)}?as=${encodeURIComponent(event.target.value)}`,
                  { replace: true },
                )
              }
            >
              {data.handles.map((party) => (
                <option key={party.handle} value={party.handle}>@{party.handle}</option>
              ))}
            </select>
          </label>
        ) : (
          <span className="chat__as chat__as--fixed">as @{data.us.handle}</span>
        )}
      </header>

      <div className="chat__body">
        {data.messages.length === 0 ? (
          <EmptyState icon={<Icon name="message" size={26} />} title="No messages yet">
            Say something to {data.them.displayName}.
          </EmptyState>
        ) : (
          data.messages.map((message, index) => {
            const mine = message.from.handle === data.us.handle;
            const previous = data.messages[index - 1];
            const next = data.messages[index + 1];
            // A run is consecutive messages from the same voice inside five
            // minutes. Only the last of a run carries the timestamp, and only
            // the first gets the wide corner, so a burst reads as one turn in
            // the conversation instead of five separate events.
            const startsRun = !previous || previous.from.handle !== message.from.handle
              || gapTooBig(previous.createdAt, message.createdAt);
            const endsRun = !next || next.from.handle !== message.from.handle
              || gapTooBig(message.createdAt, next.createdAt);
            return (
              <div
                key={message.id}
                className={[
                  'bubble',
                  mine ? 'bubble--mine' : '',
                  startsRun ? 'is-first' : '',
                  endsRun ? 'is-last' : '',
                ].filter(Boolean).join(' ')}
              >
                {startsRun && !mine && message.from.isStore && (
                  <div className="bubble__from">{message.from.displayName}</div>
                )}
                {message.deal ? (
                  <DealCard message={message} mine={mine} us={data.us} onAnswer={(deal) => setDealing({ from: deal })} />
                ) : (
                  <div className="bubble__body">{message.body}</div>
                )}
                {endsRun && <div className="bubble__meta">{timeAgo(message.createdAt)}</div>}
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      {error && <div className="chat__error"><ErrorNotice message={error} /></div>}

      {dealing && (
        <DealForm us={data.us} them={data.them} from={dealing.from} onClose={() => setDealing(null)}
          onSent={() => { setDealing(null); void load(); }} />
      )}

      <form className={`composer${data.us.isStore !== data.them.isStore ? ' composer--deal' : ''}`} onSubmit={send}>
        {data.us.isStore !== data.them.isStore && (
          <button type="button" className="composer__deal" onClick={() => setDealing({ from: null })}
            aria-label={data.us.isStore ? 'Make a private deal' : 'Ask for a private deal'}
            title={data.us.isStore ? 'Make a private deal' : 'Ask for a private deal'}>
            {data.us.isStore ? '🔒' : '🤝'}
          </button>
        )}
        <textarea
          ref={input}
          value={body}
          rows={1}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, shift-enter makes a line. The same bargain every
            // messenger makes, and the reason the control is a textarea at all.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              if (body.trim()) void send(event);
            }
          }}
          placeholder={`Message ${data.them.displayName}`}
          aria-label="Message"
        />
        <button type="submit" className="composer__send" disabled={busy || body.trim().length === 0}
          aria-label="Send">
          <Icon name="send" size={17} />
        </button>
      </form>
    </main>
  );
}

/** Five minutes. Long enough to be the same thought, short enough to be one. */
const RUN_GAP_MS = 5 * 60 * 1000;

function gapTooBig(earlier: string, later: string): boolean {
  return new Date(later).getTime() - new Date(earlier).getTime() > RUN_GAP_MS;
}

/** Shown on a shop or person's page: the way into a conversation with them. */
export function MessageButton({ handle, party }: { handle: string; party?: MessageParty }) {
  return (
    <Link to={`/messages/${encodeURIComponent(handle)}`} className="btn btn--ghost">
      <Icon name="message" size={15} /> Message {party?.displayName ?? `@${handle}`}
    </Link>
  );
}
