import { useState } from 'react';
import { ApiRequestError, admin, type PhotoScan } from './api';
import { Confirm } from './Confirm';
import { timeAgo } from '../format';

const size = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

/**
 * Stored photos that nothing uses any more.
 *
 * Deleting a listing, a post or an account does not delete its photos, on
 * purpose: the same photo can be showing on an order, a collection card or a
 * post that shared the item. So they pile up, and this is where they are
 * cleared. A scan reads every record and lists the photos none of them mention;
 * deleting looks again first, so it never acts on a stale list.
 *
 * Runs only when asked. Nothing here is scheduled.
 */
export function PhotosView() {
  const [grace, setGrace] = useState('24');
  const [scan, setScan] = useState<PhotoScan | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const hours = Math.max(1, Math.round(Number(grace)) || 24);

  async function run() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setScan(await admin.scanPhotos(hours));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'The scan did not finish.');
    } finally {
      setBusy(false);
    }
  }

  async function clean() {
    setBusy(true);
    setError(null);
    try {
      const result = await admin.cleanupPhotos(hours);
      setConfirming(false);
      setDone(`Deleted ${result.deleted} photo${result.deleted === 1 ? '' : 's'}, freeing ${size(result.bytes)}.`
        + (result.failed ? ` ${result.failed} could not be deleted.` : ''));
      setScan(await admin.scanPhotos(hours));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not delete them.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <div className="card card--pad stack">
        <h2>Unused photos</h2>
        <p className="field__hint">
          Looks through every record for the photos nothing mentions any more — left behind by deleted
          listings, posts and accounts, and by uploads that were never saved. It reads the whole database,
          so it can take a minute on a big one. Nothing is deleted until you confirm.
        </p>
        <label className="field">
          <span>Leave photos alone if uploaded in the last (hours)</span>
          <input type="number" inputMode="numeric" min={1} value={grace}
            onChange={(event) => setGrace(event.target.value)} style={{ maxWidth: 140 }} />
        </label>
        <p className="field__hint">
          A photo uploaded a moment ago has no record yet — it is waiting to be saved. This keeps those safe.
        </p>
        <div className="row">
          <button className="btn" disabled={busy} onClick={() => void run()}>
            {busy && !confirming ? 'Scanning…' : scan ? 'Scan again' : 'Scan for unused photos'}
          </button>
        </div>
        {error && <p className="notice notice--error">{error}</p>}
        {done && <p className="notice notice--info">{done}</p>}
      </div>

      {scan && (
        <div className="card card--pad stack">
          {scan.storage.backend === 'memory' && (
            <p className="notice notice--info">
              Photos are in memory, not Azure Blob Storage, so this only covers what this server holds since it started.
            </p>
          )}
          <p style={{ margin: 0 }}>
            <strong>{scan.stored}</strong> stored · <strong>{scan.inUse}</strong> in use ·{' '}
            <strong>{scan.tooNew}</strong> too new to judge ·{' '}
            <strong>{scan.unusedCount}</strong> unused ({size(scan.unusedBytes)})
          </p>

          {scan.unusedCount === 0 ? (
            <p className="muted" style={{ margin: 0 }}>Nothing to clear.</p>
          ) : (
            <>
              <div className="row">
                <button className="btn btn--danger" disabled={busy} onClick={() => setConfirming(true)}>
                  Delete {scan.unusedCount} unused photo{scan.unusedCount === 1 ? '' : 's'}
                </button>
              </div>
              <table className="table">
                <thead>
                  <tr><th>Photo</th><th>Where</th><th>Size</th><th>Uploaded</th></tr>
                </thead>
                <tbody>
                  {scan.unused.map((blob) => (
                    <tr key={`${blob.scope}:${blob.name}`}>
                      <td><code>{blob.name}</code></td>
                      <td>{blob.scope === 'private' ? 'Chat (private)' : 'Public'}</td>
                      <td>{size(blob.size)}</td>
                      <td>{timeAgo(blob.uploadedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {scan.unusedCount > scan.unused.length && (
                <p className="field__hint">Showing the oldest {scan.unused.length} of {scan.unusedCount}.</p>
              )}
            </>
          )}
        </div>
      )}

      {confirming && scan && (
        <Confirm title="Delete unused photos" confirmWord="DELETE" confirmLabel={`Delete ${scan.unusedCount}`}
          busy={busy} onConfirm={clean} onCancel={() => setConfirming(false)}>
          <p>
            This permanently deletes {scan.unusedCount} photo{scan.unusedCount === 1 ? '' : 's'} ({size(scan.unusedBytes)})
            that no record mentions. The scan runs again first, so anything used since is kept. This cannot be undone.
          </p>
        </Confirm>
      )}
    </div>
  );
}
