import { useEffect, useRef, useState } from 'react';
import { ApiRequestError, api } from '../api';
import { useSession } from '../session';
import { readQrFrame, readQrPicture } from '../qr-reader';

/**
 * TEMPORARY - /verify/aadhaar-test, for trying a real Aadhaar QR end to end on the
 * development site. Not linked from anywhere. Delete this file, its route in
 * main.tsx and loader in pageLoaders.ts, and api/src/verification/aadhaar-test.ts
 * (with its route) when testing is done.
 *
 * Runs the same checks as real verification and shows everything the QR holds.
 * The server saves nothing and the account's verification does not change.
 */

interface TestResult {
  readable: boolean;
  error?: string;
  version?: string;
  signature?: { valid: boolean; signedBy: string | null; bytes: number; diagnosis: KeyDiagnosis[] };
  details?: { name: string; dob: string; gender: string; aadhaarLast4: string; generatedAt: string | null };
  address?: Record<string, string>;
  mobile?: { linked: boolean; last4OnQr: string | null; entered: string | null; enteredValid: boolean; method: 'hash' | 'last4'; matches: boolean | null };
  email?: { linked: boolean; entered: string | null; checkable: boolean; matches: boolean | null };
  photo?: { bytes: number; jp2Base64: string } | null;
  wouldVerify?: boolean;
}

interface KeyDiagnosis {
  certificate: string;
  keyBits: number;
  outcome: 'pkcs1' | 'pss' | 'none';
  hash: string | null;
  digestOf: string | null;
}

const STANDARD = 'everything before the signature (the standard)';

/** One sentence on why the signature failed, from what each key revealed. */
function diagnosisSummary(diagnosis: KeyDiagnosis[]): string {
  const made = diagnosis.find((entry) => entry.outcome !== 'none');
  if (!made) {
    return `None of our ${diagnosis.length} UIDAI certificates made this signature. It was signed by a UIDAI key we do not have, ` +
      'so we need that certificate. The QR itself is not the problem.';
  }
  if (made.outcome === 'pss') return `${made.certificate} made it, with PSS padding instead of the usual kind. Fixable on our side.`;
  if (!made.digestOf) {
    return `${made.certificate} made it (${made.hash}), but over bytes we could not identify. The scan may have misread part ` +
      'of the QR: try a sharper picture.';
  }
  if (made.digestOf === STANDARD && made.hash === 'sha256') return `${made.certificate} made it, and it checks.`;
  return `${made.certificate} made it, using ${made.hash} over ${made.digestOf}. Our checker expects SHA-256 over ${STANDARD}, ` +
    'so this is fixable on our side.';
}

const ADDRESS_LABELS: Record<string, string> = {
  careOf: 'Care of', house: 'House', street: 'Street', landmark: 'Landmark', location: 'Locality', vtc: 'Village/Town/City',
  postOffice: 'Post office', subDistrict: 'Sub-district', district: 'District', state: 'State', pincode: 'PIN code',
};

function Verdict({ ok, label }: { ok: boolean | null; label: string }) {
  const tone = ok === null ? '' : ok ? ' badge--ok' : ' badge--danger';
  return <span className={`badge${tone}`}>{ok === null ? '–' : ok ? '✓' : '✗'} {label}</span>;
}

function Rows({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', gap: '6px 12px', margin: 0 }}>
      {rows.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt className="faint">{label}</dt>
          <dd style={{ margin: 0, overflowWrap: 'anywhere' }}>{value || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AadhaarTestPage() {
  const { user } = useSession();
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [email, setEmail] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TestResult | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (!scanning) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 2560 }, height: { ideal: 1440 } } });
        const video = videoRef.current;
        if (!video || stopped) return;
        video.srcObject = stream;
        await video.play();
        let attempt = 0;
        while (!stopped) {
          if (video.videoWidth > 0) {
            const text = await readQrFrame(video, attempt);
            attempt += 1;
            if (text) {
              setQr(text);
              setScanning(false);
              return;
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      } catch {
        setError('Could not open the camera. Upload a photo or screenshot of the QR instead.');
        setScanning(false);
      }
    })();
    return () => {
      stopped = true;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [scanning]);

  async function fromFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const text = await readQrPicture(file);
      if (text) setQr(text);
      else setError('No QR code found in that picture. Crop it to the QR and make sure it is sharp, then try again.');
    } catch {
      setError('That file could not be read as a picture.');
    }
  }

  async function check(text: string) {
    setBusy(true);
    setError(null);
    setResult(null);
    setPhotoFailed(false);
    try {
      setResult(await api.testAadhaar<TestResult>(text, phone, email));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'The check failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setQr(null);
    setPasted('');
    setResult(null);
    setError(null);
  }

  return (
    <main className="page stack" style={{ maxWidth: 640 }}>
      <h1 style={{ marginBottom: 0 }}>Aadhaar QR test</h1>
      <p className="notice notice--warn" style={{ margin: 0 }}>
        Test page on the development site. It runs the same checks as real verification and shows everything in the QR.
        Nothing is saved, and your account's verification does not change.
      </p>

      <section className="card card--pad stack">
        <label className="field">
          <span>Phone number to match</span>
          <input value={phone} inputMode="tel" onChange={(event) => setPhone(event.target.value)} placeholder="+91 98765 43210" />
        </label>
        <label className="field">
          <span>Email to match (optional)</span>
          <input value={email} type="email" onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
        </label>

        {qr ? (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
            <span className="badge badge--ok">QR read ({qr.length} digits)</span>
            <button type="button" className="btn" disabled={busy} onClick={() => void check(qr)}>{busy ? 'Checking…' : 'Check QR'}</button>
            <button type="button" className="btn btn--quiet" disabled={busy} onClick={reset}>Scan another</button>
          </div>
        ) : (
          <>
            <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <button type="button" className="btn" disabled={scanning} onClick={() => setScanning(true)}>Scan with camera</button>
              <label className="btn btn--ghost">
                Upload QR picture
                <input type="file" accept="image/*" hidden onChange={(event) => void fromFile(event.target.files?.[0])} />
              </label>
            </div>
            {scanning && (
              <div className="vfy__camera">
                <video ref={videoRef} playsInline muted />
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => setScanning(false)}>Stop</button>
              </div>
            )}
            <details className="faint">
              <summary>Have the QR's text from another scanner app?</summary>
              <textarea className="vfy__paste" value={pasted} onChange={(event) => setPasted(event.target.value)}
                placeholder="A long number, thousands of digits" rows={3} />
              <button type="button" className="btn btn--sm" disabled={busy || pasted.trim().length < 100}
                onClick={() => { setQr(pasted.trim()); void check(pasted.trim()); }}>
                Check this
              </button>
            </details>
          </>
        )}
        {error && <p className="notice notice--error" style={{ margin: 0 }}>{error}</p>}
      </section>

      {result && !result.readable && <p className="notice notice--error">{result.error}</p>}

      {result?.readable && result.signature && result.details && result.mobile && result.email && (
        <>
          <p className={`notice ${result.wouldVerify ? 'notice--ok' : 'notice--error'}`} style={{ margin: 0 }}>
            {result.wouldVerify
              ? (result.mobile.method === 'last4'
                ? '✓ Genuine UIDAI QR, and its mobile ends in the same 4 digits as this number. Newer QRs carry only those 4 digits, not the full number.'
                : '✓ Real verification would pass: genuine UIDAI QR, and its mobile is this number.')
              : '✗ Real verification would not pass. See below for which check failed.'}
          </p>

          <section className="card card--pad stack">
            <span className="card__title">Checks</span>
            <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <Verdict ok={result.signature.valid} label="Signed by UIDAI" />
              <Verdict ok={result.mobile.linked} label="Mobile linked" />
              <Verdict ok={result.mobile.matches} label={result.mobile.method === 'last4' ? 'Mobile last 4 match' : 'Mobile matches'} />
              {result.email.checkable && <Verdict ok={result.email.matches} label="Email matches" />}
            </div>
            <Rows rows={[
              ['Signature', result.signature.valid ? `Valid, by ${result.signature.signedBy}` : 'Not signed by any UIDAI key we hold, or altered'],
              ['QR format', result.version === 'V1' ? 'Legacy (no version marker; carries full mobile and email hashes)' : `${result.version} (2022 onwards; mobile's last 4 digits only, no hashes)`],
              ['Mobile entered', result.mobile.entered ?? (result.mobile.enteredValid ? '—' : 'Not a valid Indian mobile')],
              ['Mobile on QR', result.mobile.linked ? (result.mobile.last4OnQr ? `ends ${result.mobile.last4OnQr}` : 'linked (checked by full-number hash)') : 'none linked'],
              ['Email on QR', result.email.linked ? (result.email.checkable ? 'linked' : 'linked (this format cannot check it)') : 'none linked'],
              ['Email entered', result.email.entered],
              ['QR generated', result.details.generatedAt],
            ]} />
          </section>

          {!result.signature.valid && (
            <section className="card card--pad stack">
              <span className="card__title">Why the signature failed</span>
              <p className="notice notice--info" style={{ margin: 0 }}>{diagnosisSummary(result.signature.diagnosis)}</p>
              <Rows rows={[
                ['Signature size', `${result.signature.bytes} bytes`],
                ...result.signature.diagnosis.map((entry): [string, string] => [
                  entry.certificate,
                  entry.outcome === 'none'
                    ? `not this key (${entry.keyBits}-bit)`
                    : entry.outcome === 'pss'
                      ? 'made it (PSS padding)'
                      : `made it: ${entry.hash} over ${entry.digestOf ?? 'unidentified bytes'}`,
                ]),
              ]} />
            </section>
          )}

          <section className="card card--pad stack">
            <span className="card__title">Details</span>
            <div className="row" style={{ gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              {result.photo && !photoFailed ? (
                <img src={`data:image/jp2;base64,${result.photo.jp2Base64}`} alt="Photo from the QR" width={96}
                  style={{ borderRadius: 8 }} onError={() => setPhotoFailed(true)} />
              ) : result.photo ? (
                <p className="faint" style={{ margin: 0, maxWidth: 140 }}>
                  Photo present ({result.photo.bytes} bytes, JPEG 2000). Only Safari can show this format.
                </p>
              ) : null}
              <div style={{ flex: 1, minWidth: 220 }}>
                <Rows rows={[
                  ['Name', result.details.name],
                  ['Date of birth', result.details.dob],
                  ['Gender', result.details.gender],
                  ['Aadhaar', `XXXX XXXX ${result.details.aadhaarLast4}`],
                  ['QR generated', result.details.generatedAt],
                ]} />
              </div>
            </div>
          </section>

          <section className="card card--pad stack">
            <span className="card__title">Address</span>
            <Rows rows={Object.entries(ADDRESS_LABELS).map(([key, label]) => [label, result.address?.[key]])} />
          </section>
        </>
      )}
    </main>
  );
}
