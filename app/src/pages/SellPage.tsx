import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CONDITION_TAGS } from '@shared/enums';
import { ApiRequestError, api } from '../api';
import { ErrorNotice, Thumb } from '../components/ui';
import { formatMoney } from '../format';
import { useSession } from '../session';

const CATEGORIES = [
  'Scale figures', 'Model kits', 'Trading cards', 'Anime merch',
  'Sneakers', 'Electronics', 'Collectibles',
];

/**
 * List something.
 *
 * Deliberately one screen rather than a wizard: the whole point of the Xianyu
 * pattern is that listing is a two-minute job, not a form to be endured. The
 * live preview on the right is the same card the feed renders.
 */
export function SellPage() {
  const { user } = useSession();
  const navigate = useNavigate();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]!);
  const [condition, setCondition] = useState<string>(CONDITION_TAGS[0]);
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [lotMode, setLotMode] = useState(false);
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceMinor = Math.round(Number(price || 0) * 100);
  const canPublish = title.trim().length > 2 && priceMinor > 0;

  async function publish(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api.createListing({
        title: title.trim(),
        description: description.trim(),
        category,
        condition,
        priceMinor,
        quantityAvailable: Math.max(1, Number(quantity) || 1),
        lotMode,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      });
      navigate(`/listing/${result.listing.id}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not publish this listing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <div className="page__head">
        <div>
          <h1>Sell something</h1>
          <p className="muted">Takes about a minute. You can edit or remove it afterwards.</p>
        </div>
      </div>

      {/* The verification nudge from the spec: friction, not a wall. */}
      {user && user.sellerProfile === null && (
        <p className="notice notice--info" style={{ marginBottom: 20 }}>
          This will be your first listing, so a storefront gets created for you. Verifying your ID unlocks
          higher-value listings and payouts — you can do that any time.
        </p>
      )}

      <div className="detail">
        <form className="form" onSubmit={publish}>
          <label className="field">
            <span>Title</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="1/7 scale figure, sealed" required />
          </label>

          <label className="field">
            <span>Description</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Condition, what's included, where it ships from…" />
          </label>

          <div className="field-row">
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((entry) => <option key={entry}>{entry}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Condition</span>
              <select value={condition} onChange={(e) => setCondition(e.target.value)}>
                {CONDITION_TAGS.map((tag) => <option key={tag}>{tag}</option>)}
              </select>
            </label>
          </div>

          <div className="field-row">
            <label className="field">
              <span>Price (₹)</span>
              <input type="number" min="1" step="1" value={price}
                onChange={(e) => setPrice(e.target.value)} placeholder="1450" required />
            </label>
            <label className="field">
              <span>Quantity</span>
              <input type="number" min="1" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </label>
          </div>

          <label className="field">
            <span>Tags</span>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="resin, scale, sealed" />
            <span className="field__hint">Comma separated. Helps buyers find it in search.</span>
          </label>

          <div className="card card--pad">
            <label className="row" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={lotMode} onChange={(e) => setLotMode(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
              <div>
                <div style={{ fontWeight: 600 }}>Run this as a group buy</div>
                <span className="field__hint">
                  Buyers pre-book, and you place the order once enough units are committed. You'll set the
                  threshold, cutoff and forwarder on the lot afterwards.
                </span>
              </div>
            </label>
          </div>

          {error && <ErrorNotice message={error} />}

          <button type="submit" className="btn btn--lg" disabled={busy || !canPublish}>
            {busy ? 'Publishing…' : 'Publish listing'}
          </button>
        </form>

        <aside className="stack">
          <span className="muted">Preview</span>
          <div className="card" style={{ maxWidth: 280 }}>
            <Thumb seed={title || 'preview'} label={title || 'Your listing'}>
              <div className="thumb__badges">
                <span className="badge badge--solid">{condition}</span>
                {lotMode && <span className="badge badge--accent">Group buy</span>}
              </div>
            </Thumb>
            <div className="listing__body">
              <span className="listing__title">{title || 'Your listing title'}</span>
              <span className="listing__price">{priceMinor > 0 ? formatMoney(priceMinor) : '₹—'}</span>
              <div className="listing__foot">
                <span className="faint">{user?.sellerProfile?.storefrontName ?? user?.displayName ?? 'You'}</span>
                <span className="badge">{category}</span>
              </div>
            </div>
          </div>
          <p className="faint">
            Photo upload lands with blob storage. Until then listings use a generated placeholder.
          </p>
        </aside>
      </div>
    </main>
  );
}
