import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { ApiRequestError, api, type WantCard, type WantDetail } from '../api';
import { EmptyState, ErrorNotice, Modal, PersonLink } from '../components/ui';
import { formatMoney, timeAgo } from '../format';
import { useSession } from '../session';

/**
 * What people are looking for.
 *
 * The half of a marketplace that is normally silent. Somebody who cannot find
 * what they want leaves without saying so, and takes with them the one fact a
 * seller most needs — that there was demand at all. On an import marketplace
 * that is worth more than usual: most of what gets wanted here has not been
 * bought by anybody yet, so a seller reading this board is deciding what goes
 * in the next consignment.
 *
 * Which is why an answer is not only "here is one". It is also "I can get
 * this", and on this board that is the answer that matters.
 */
const CATEGORIES = [
  'Scale figures', 'Model kits', 'Trading cards', 'Anime merch',
  'Sneakers', 'Electronics', 'Collectibles',
];

export function WantedPage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState<{ wants: WantCard[]; mine: WantCard[] } | null>(null);
  const [category, setCategory] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [openWant, setOpenWant] = useState<WantCard | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api.wants(category ? { category } : {}));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not load the board.');
    }
  }, [category]);

  useEffect(() => {
    void load();
  }, [load]);

  // A notification names one hunt. Opening the board on the right tab and
  // leaving somebody to find it would be most of the way to useless, so the
  // hunt in the URL opens itself — including a closed one, which is exactly
  // the case a stale notification points at.
  const askedFor = params.get('want');
  const askedBuyer = params.get('buyer');
  useEffect(() => {
    if (!askedFor || !askedBuyer || openWant?.id === askedFor) return;
    void api
      .want(askedFor, askedBuyer)
      .then((detail) => setOpenWant(detail.want))
      .catch(() => undefined);
  }, [askedFor, askedBuyer, openWant?.id]);

  if (error) return <ErrorNotice message={error} />;
  if (!data) return <p className="muted">Loading…</p>;

  // Yours, under the same filter as everything else — filtering to Trading
  // cards and still being shown your own hunt for a figure reads as the filter
  // being broken.
  const openMine = data.mine.filter(
    (want) => want.status === 'open' && (!category || want.category === category),
  );
  // And not a second time further down: the board is everybody else's.
  const others = data.wants.filter((want) => want.buyerId !== user?.id);

  return (
    <div className="stack">
      <div className="row row--between" style={{ alignItems: 'center' }}>
        <p className="muted" style={{ margin: 0 }}>
          Say what you are hunting for. Sellers answer with what they have, or what they can get.
        </p>
        {user && (
          <button className="btn" style={{ flex: 'none' }} onClick={() => setAsking(true)}>
            Post a want
          </button>
        )}
      </div>

      {openMine.length > 0 && (
        <section className="detail__section">
          <h3>Yours</h3>
          <div className="stack">
            {openMine.map((want) => (
              <WantRow key={want.id} want={want} onOpen={() => setOpenWant(want)} />
            ))}
          </div>
        </section>
      )}

      <div className="chips chips--tight">
        <button type="button" className={`chip${category === '' ? ' is-on' : ''}`}
          onClick={() => setCategory('')}>
          Everything
        </button>
        {CATEGORIES.map((entry) => (
          <button key={entry} type="button" className={`chip${category === entry ? ' is-on' : ''}`}
            onClick={() => setCategory(entry)}>
            {entry}
          </button>
        ))}
      </div>

      {others.length === 0 ? (
        <EmptyState title="Nobody else is hunting for anything here">
          {category
            ? 'Nothing under that category yet. Try Everything.'
            : 'Be the first — what are you looking for that nobody has listed?'}
        </EmptyState>
      ) : (
        <div className="stack">
          {others.map((want) => (
            <WantRow key={want.id} want={want} onOpen={() => setOpenWant(want)} />
          ))}
        </div>
      )}

      {asking && (
        <AskDialog
          onClose={() => setAsking(false)}
          onPosted={async () => {
            setAsking(false);
            await load();
          }}
        />
      )}

      {openWant && (
        <WantDialog
          card={openWant}
          onClose={() => {
            setOpenWant(null);
            // Or the link in the URL immediately reopens what was just closed.
            if (askedFor) {
              const next = new URLSearchParams(params);
              next.delete('want');
              next.delete('buyer');
              setParams(next, { replace: true });
            }
          }}
          onChanged={load}
        />
      )}
    </div>
  );
}

/**
 * How many other people are hunting for this, from the reader's side.
 *
 * The stored count includes whoever pressed the button, so a reader who is one
 * of them has to be taken out of it — "1 person looking too" when that one
 * person is you says somebody else is there when nobody is.
 */
function othersLine(seekerCount: number, joined: boolean): string {
  const others = joined ? seekerCount - 1 : seekerCount;
  if (others === 0) return joined ? 'just you so far' : 'nobody else yet';
  return `${others} other${others === 1 ? '' : 's'} looking too`;
}

/** One hunt on the board: what, how much, and how many people have answered. */
function WantRow({ want, onOpen }: { want: WantCard; onOpen: () => void }) {
  return (
    <button type="button" className="want" onClick={onOpen}>
      <div className="want__main">
        <span className="want__title">{want.title}</span>
        <span className="faint">
          {want.category}
          {want.condition ? ` · ${want.condition}` : ''} · asked {timeAgo(want.createdAt)}
        </span>
      </div>
      <div className="want__side">
        <span className="want__budget">
          {/* "Open to offers" is a real answer for a rare piece, and not the
              same as no budget at all. */}
          {want.budgetMinor === null
            ? 'Open to offers'
            : `up to ${formatMoney(want.budgetMinor, want.currency)}`}
        </span>
        <div className="row" style={{ gap: 6 }}>
          {want.seekerCount > 0 && (
            <span className="badge">+{want.seekerCount}</span>
          )}
          <span className={`badge${want.offerCount > 0 ? ' badge--accent' : ''}`}>
            {want.offerCount === 0
              ? 'no answers'
              : `${want.offerCount} ${want.offerCount === 1 ? 'answer' : 'answers'}`}
          </span>
        </div>
      </div>
    </button>
  );
}

/** Saying what you are after. */
function AskDialog({ onClose, onPosted }: { onClose: () => void; onPosted: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [budget, setBudget] = useState('');
  const [condition, setCondition] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.postWant({
        title: title.trim(),
        details: details.trim(),
        category,
        budgetMinor: budget.trim() ? Math.round(Number(budget) * 100) : null,
        condition: condition || null,
      });
      await onPosted();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not post that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="What are you looking for?" onClose={onClose}>
      <label className="field">
        <span>The item</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="1/7 scale Rem, Furyu — any colourway" />
      </label>

      <div className="field-row">
        <label className="field">
          <span>Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Condition</span>
          <select value={condition} onChange={(e) => setCondition(e.target.value)}>
            <option value="">Any</option>
            {CONDITION_TAGS.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        </label>
      </div>

      <label className="field">
        <span>Budget</span>
        <input value={budget} onChange={(e) => setBudget(e.target.value)}
          inputMode="decimal" placeholder="Leave blank to hear offers" />
        <span className="field__hint">
          Optional. For something rare, "what will you take" is a real answer.
        </span>
      </label>

      <label className="field">
        <span>Anything else</span>
        <textarea value={details} onChange={(e) => setDetails(e.target.value)} rows={3}
          placeholder="Box condition, how soon you need it, what you have already tried." />
      </label>

      {error && <ErrorNotice message={error} />}

      <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
        <button type="button" className="btn btn--quiet" onClick={onClose}>Cancel</button>
        <button type="button" className="btn" disabled={busy || title.trim().length < 3}
          onClick={() => void submit()}>
          {busy ? 'Posting…' : 'Post it'}
        </button>
      </div>
    </Modal>
  );
}

/** One hunt, everything said about it, and a way to answer. */
function WantDialog({ card, onClose, onChanged }: {
  card: WantCard;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const { user } = useSession();
  const [data, setData] = useState<WantDetail | null>(null);
  const [message, setMessage] = useState('');
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const detail = await api.want(card.id, card.buyerId);
      setData(detail);
      setMessage(detail.yours?.message ?? '');
      setPrice(detail.yours?.priceMinor ? String(detail.yours.priceMinor / 100) : '');
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not open that.');
    }
  }, [card.id, card.buyerId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function answer() {
    setBusy(true);
    setError(null);
    try {
      await api.offerOnWant(card.id, card.buyerId, {
        message: message.trim(),
        priceMinor: price.trim() ? Math.round(Number(price) * 100) : null,
      });
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  async function joinIn() {
    setBusy(true);
    setError(null);
    try {
      await api.alsoMe(card.id, card.buyerId);
      await load();
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not do that.');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setBusy(true);
    try {
      await api.closeWant(card.id, card.buyerId);
      await onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not close that.');
      setBusy(false);
    }
  }

  return (
    <Modal title={card.title} onClose={onClose}>
      <p className="faint" style={{ marginTop: 0 }}>
        <PersonLink party={card.buyer} /> · {card.category}
        {card.condition ? ` · ${card.condition}` : ''} · {timeAgo(card.createdAt)}
      </p>

      <div className="kv">
        <dt>Budget</dt>
        <dd>{card.budgetMinor === null ? 'Open to offers' : formatMoney(card.budgetMinor, card.currency)}</dd>
      </div>
      {card.details && <p className="muted">{card.details}</p>}

      {/* Under the post, and the count beside it: how many people want the same
          thing is the number a seller is actually deciding on. */}
      {data && !data.mine && card.status === 'open' && (
        <div className="alsome">
          <button type="button" className={`btn${data.joined ? ' btn--quiet' : ''}`}
            disabled={busy || !user} onClick={() => void joinIn()}>
            {data.joined ? '✓ You are in' : '+Me'}
          </button>
          {/* Counted from where the reader stands. "1 person looking too" when
              that one person is you reads as somebody else being there. */}
          <span className="alsome__count">{othersLine(data.seekerCount, data.joined)}</span>
        </div>
      )}
      {data?.mine && (
        <div className="alsome">
          <span className="faint">Your want.</span>
          <span className="alsome__count">{othersLine(data.seekerCount, false)}</span>
        </div>
      )}

      {!data ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <section className="detail__section">
            <h3>Answers {data.offers.length > 0 && <span className="faint">({data.offers.length})</span>}</h3>
            {data.offers.length === 0 ? (
              <p className="faint">Nobody has answered yet.</p>
            ) : (
              <div className="stack">
                {data.offers.map((offer) => (
                  <article key={offer.id} className="card card--pad stack">
                    <div className="row row--between">
                      <PersonLink party={offer.seller} />
                      <span className="faint">{timeAgo(offer.createdAt)}</span>
                    </div>
                    <p className="muted" style={{ margin: 0 }}>{offer.message}</p>
                    {offer.priceMinor !== null && (
                      <div className="kv">
                        <dt>Their price</dt>
                        <dd>{formatMoney(offer.priceMinor, card.currency)}</dd>
                      </div>
                    )}
                    {/* An answer with nothing attached is the one that matters
                        here: most of what is wanted has not been bought yet. */}
                    {offer.listing && (
                      <a className="btn btn--quiet btn--sm" style={{ justifySelf: 'start' }}
                        href={`/listing/${offer.listing.id}`}>
                        {offer.listing.title} · {formatMoney(offer.listing.priceMinor, offer.listing.currency)}
                      </a>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>

          {data.mine ? (
            card.status === 'open' && (
              <button className="btn btn--quiet" style={{ justifySelf: 'start' }}
                disabled={busy} onClick={() => void close()}>
                {busy ? 'Closing…' : 'I have found it — close this'}
              </button>
            )
          ) : user ? (
            <section className="detail__section">
              <h3>{data.yours ? 'Your answer' : 'Answer this'}</h3>
              <label className="field">
                <span>What you have, or what you can get</span>
                <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3}
                  placeholder="I can add this to the October Guangzhou run — about three weeks." />
              </label>
              <label className="field">
                <span>Your price</span>
                <input value={price} onChange={(e) => setPrice(e.target.value)}
                  inputMode="decimal" placeholder="Optional" />
              </label>
              {error && <ErrorNotice message={error} />}
              <button className="btn" style={{ justifySelf: 'start' }}
                disabled={busy || message.trim().length < 4} onClick={() => void answer()}>
                {busy ? 'Sending…' : data.yours ? 'Update your answer' : 'Send it'}
              </button>
            </section>
          ) : (
            <p className="faint">Sign in to answer this.</p>
          )}
        </>
      )}
    </Modal>
  );
}
