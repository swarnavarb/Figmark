import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { MessageParty } from '@shared/models';
import { ApiRequestError, api, type Inbox, type Thread } from '../api';
import { Avatar, EmptyState, ErrorNotice, Icon } from '../components/ui';
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

  return (
    <div className="stack">
      <form
        className="card card--pad form"
        onSubmit={(event) => {
          event.preventDefault();
          const handle = to.trim().replace(/^@/, '').toLowerCase();
          if (handle) navigate(`/messages/${encodeURIComponent(handle)}`);
        }}
      >
        <label className="field">
          <span>Message someone</span>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@username" />
          <span className="field__hint">
            Anyone with a username — a person or a shop. You speak as{' '}
            {data.handles.map((party) => `@${party.handle}`).join(' or ') || 'nobody yet'}.
          </span>
        </label>
        <button type="submit" className="btn" style={{ justifySelf: 'start' }} disabled={!to.trim()}>
          Open conversation
        </button>
      </form>

      {data.threads.length === 0 ? (
        <EmptyState title="No messages yet">
          Start one above, or from any shop's page.
        </EmptyState>
      ) : (
        <div className="card">
          {data.threads.map((row) => (
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
                {/* Which of your voices this thread belongs to. Only worth
                    saying when you have more than one. */}
                {data.handles.length > 1 && (
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
  const [error, setError] = useState<string | null>(null);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

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

  // A conversation is read at the bottom.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [data?.messages.length]);

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
  if (!data) return <main className="page tab-view"><p className="muted">Loading…</p></main>;

  return (
    <main className="page tab-view">
      <Link to="/social" className="btn btn--quiet" style={{ marginBottom: 12 }}>
        <Icon name="back" size={14} /> Messages
      </Link>

      <div className="thread__head">
        <Avatar name={data.them.displayName} size={42} />
        <div style={{ minWidth: 0 }}>
          <div className="thread__name">
            {data.them.displayName}
            {data.them.isStore && <span className="badge" style={{ marginLeft: 6 }}>shop</span>}
          </div>
          <Link to={`/${data.them.handle}`} className="faint" style={{ textDecoration: 'none' }}>
            @{data.them.handle}
          </Link>
        </div>
      </div>

      {/* Whose voice you are using. Stated plainly, because writing as your shop
          and writing as yourself are different things to the person reading —
          and switchable here, since it is part of what this thread is. */}
      {data.handles.length > 1 ? (
        <label className="field" style={{ marginBottom: 12 }}>
          <span>Writing as</span>
          <select
            value={data.us.handle}
            onChange={(event) =>
              navigate(
                `/messages/${encodeURIComponent(handle!)}?as=${encodeURIComponent(event.target.value)}`,
                { replace: true },
              )
            }
          >
            {data.handles.map((party) => (
              <option key={party.handle} value={party.handle}>
                @{party.handle} — {party.isStore ? party.displayName : 'yourself'}
              </option>
            ))}
          </select>
          <span className="field__hint">
            Each voice has its own conversation with {data.them.displayName}.
          </span>
        </label>
      ) : (
        <p className="notice notice--info" style={{ marginBottom: 12 }}>
          You are writing as <strong>@{data.us.handle}</strong>
          {data.us.isStore ? ' — your shop' : ' — yourself'}.
        </p>
      )}

      <div className="thread">
        {data.messages.length === 0 ? (
          <p className="muted">Nothing yet. Say something.</p>
        ) : (
          data.messages.map((message) => {
            const mine = message.from.handle === data.us.handle;
            return (
              <div key={message.id} className={`bubble${mine ? ' bubble--mine' : ''}`}>
                <div className="bubble__body">{message.body}</div>
                <div className="bubble__meta">
                  {!mine && message.from.isStore && `${message.from.displayName} · `}
                  {timeAgo(message.createdAt)}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottom} />
      </div>

      {error && <ErrorNotice message={error} />}

      <form className="composer" onSubmit={send}>
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={`Message ${data.them.displayName}…`}
          aria-label="Message"
        />
        <button type="submit" className="btn" disabled={busy || body.trim().length === 0}>
          {busy ? '…' : 'Send'}
        </button>
      </form>
    </main>
  );
}

/** Shown on a shop or person's page: the way into a conversation with them. */
export function MessageButton({ handle, party }: { handle: string; party?: MessageParty }) {
  return (
    <Link to={`/messages/${encodeURIComponent(handle)}`} className="btn btn--ghost">
      💬 Message {party?.displayName ?? `@${handle}`}
    </Link>
  );
}
