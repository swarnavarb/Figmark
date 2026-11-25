import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DnaAsk, DnaCheck as Check, DnaSummary } from '@shared/dna';
import type { RegionBox } from '@shared/models';
import { ApiRequestError, api } from '../api';
import { CropPic, DnaPicker, dnaHref, priceSpan } from './DnaKit';
import { useToast } from './Feedback';
import { Icon } from './Icon';
import { useSession } from '../session';
import { useReducedMotion } from '../motion';
import '../styles/DnaCheck.css';

/**
 * The seller's quick check on their own listing's Product DNA: at most two
 * taps, asked right after it goes live and again whenever it is in doubt.
 *
 * 1. The photo shows several things: tap the one you are selling - or say
 *    they are all the same item, or that you are selling them separately.
 * 2. It landed on a product named differently, or a buyer said it is wrong:
 *    is it that product? Yes, or pick the right one (or its own).
 *
 * Nothing shows when nothing is in doubt.
 */

type Step = 'photo' | 'match' | 'done';

const stepOf = (check: Check | null): Step | null => (check?.photo ? 'photo' : check?.match ? 'match' : null);

export function DnaCheckFlow({ listingId, title, compact = false, onEdit, onSettled }: {
  listingId: string;
  title: string;
  /** Inside the "It's live!" moment: tighter, no card around it. */
  compact?: boolean;
  /** "I'm selling them separately": open the listing's editor. */
  onEdit?: () => void;
  /** Told when there is nothing (left) to ask, so a host can tidy up. */
  onSettled?: () => void;
}) {
  const toast = useToast();
  const [check, setCheck] = useState<Check | null>(null);
  const [step, setStep] = useState<Step | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [separately, setSeparately] = useState(false);
  /** How many questions there were to start with, so "2 of 2" stays true as they are answered. */
  const [total, setTotal] = useState(1);

  useEffect(() => {
    let live = true;
    api.dnaCheck(listingId).then((found) => {
      if (!live) return;
      setCheck(found);
      // A photo answer can bring a product question after it.
      setTotal(found.photo && found.match ? 2 : 1);
      const first = stepOf(found);
      setStep(first);
      if (!first) onSettled?.();
    }).catch(() => undefined);
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once per listing
  }, [listingId]);

  if (!check || !step) return null;

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const answerPhoto = (box: RegionBox | null) => run(box ? box.join(',') : 'all', async () => {
    const next = await api.dnaFocus(listingId, box);
    setCheck(next);
    if (!next.match) { finish(); return; }
    setStep('match');
  });

  const finish = () => { setStep('done'); onSettled?.(); };
  const at = step === 'photo' ? 1 : total;

  return (
    <section className={`dnac${compact ? ' dnac--compact' : ''}`} aria-live="polite">
      {step !== 'done' && (
        <p className="dnac__eyebrow">
          <Icon name="dna" size={13} /> Quick check{total > 1 ? ` · ${at} of ${total}` : ''}
        </p>
      )}

      {step === 'photo' && check.photo && (
        <>
          <h3 className="dnac__q">Which one are you selling?</h3>
          <p className="dnac__hint">Your photo shows {check.photo.boxes.length} things. Tap yours and help the community by keeping the product DNA accurate.</p>
          <div className="dnac__photo"><span className="dnac__frame">
            <img src={check.photo.url} alt={`Photo of ${title}`} />
            {check.photo.boxes.map((box, index) => (
              <button key={box.join(',')} type="button" className="dnac__box" disabled={busy !== null}
                aria-label={`Thing ${index + 1}`}
                style={{ left: `${box[0] * 100}%`, top: `${box[1] * 100}%`, width: `${box[2] * 100}%`, height: `${box[3] * 100}%` }}
                onClick={() => void answerPhoto(box)}>
                <span className="dnac__pin">{busy === box.join(',') ? '…' : index + 1}</span>
              </button>
            ))}
          </span></div>
          <div className="dnac__choices">
            <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={() => void answerPhoto(null)}>
              {busy === 'all' ? 'Saving…' : 'They are all the same item'}
            </button>
            <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null} onClick={() => setSeparately(true)}>
              I am selling them separately
            </button>
          </div>
          {separately && (
            <p className="dnac__note">
              Sell them piece by piece: edit the listing and pick <b>Multiple items individually</b>, then price each one. Each gets its own Product DNA.
              {onEdit && <> <button type="button" className="dnac__link" onClick={onEdit}>Edit the listing</button></>}
            </p>
          )}
        </>
      )}

      {step === 'match' && check.match && (
        <MatchQuestion dna={check.match.dna} reports={check.match.reports} reported={check.match.why === 'reported'}
          busy={busy} onYes={() => void run('yes', async () => { await api.dnaConfirm(listingId); finish(); })}
          onNo={() => setPicking(true)} />
      )}

      {step === 'done' && (
        <p className="dnac__done"><Icon name="check" size={15} /> All set. Buyers comparing shops will find yours.</p>
      )}

      {picking && check.match && (
        <DnaPicker title="Which product is your listing?" seed={title} current={[check.match.dna]} listingId={listingId}
          exclude={[check.match.dna.id]}
          onClose={() => setPicking(false)}
          preview={(to) => <MovePeek from={check.match!.dna} to={to} title={title} />}
          confirmLabel="Move it"
          onPick={async (to) => {
            await api.fixDna({ kind: 'listing', id: listingId, partition: '', action: 'move', to: to.id });
            setPicking(false);
            finish();
          }}
          extra={(
            <button type="button" className="dnac__newdna" onClick={() => void run('new', async () => {
              await api.fixDna({ kind: 'listing', id: listingId, partition: '', action: 'new' });
              setPicking(false);
              toast('Your listing has its own Product DNA now');
              finish();
            })}>
              <Icon name="plus" size={14} /> None of these - it is a product of its own
            </button>
          )} />
      )}
    </section>
  );
}

function MatchQuestion({ dna, reports, reported, busy, onYes, onNo }: {
  dna: DnaSummary; reports: number; reported: boolean; busy: string | null; onYes: () => void; onNo: () => void;
}) {
  const span = priceSpan(dna);
  return (
    <>
      <h3 className="dnac__q">Is it this product?</h3>
      <p className="dnac__hint">
        {reported
          ? `${reports === 1 ? 'A buyer' : `${reports} buyers`} said your listing may not be this. One tap settles it.`
          : 'Does it match this listing?'}
      </p>
      <Link to={dnaHref(dna.id)} className="dnac__product">
        <span className="dnac__productpic">{dna.cover ? <CropPic src={dna.cover} box={dna.coverBox} /> : <Icon name="dna" size={18} />}</span>
        <span className="dnac__producttext">
          <b>{dna.name}</b>
          <small>{[span, `${dna.sellers} shop${dna.sellers === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small>
        </span>
        <Icon name="right" size={14} />
      </Link>
      <div className="dnac__choices">
        <button type="button" className="btn btn--sm" disabled={busy !== null} onClick={onYes}>{busy === 'yes' ? 'Saving…' : 'Yes, that is it'}</button>
        <button type="button" className="btn btn--quiet btn--sm" disabled={busy !== null} onClick={onNo}>No, it is different</button>
      </div>
    </>
  );
}

function MovePeek({ from, to, title }: { from: DnaSummary; to: DnaSummary; title: string }) {
  const span = priceSpan(to);
  return (
    <div className="dnac__peek">
      <p className="dnac__hint"><b>Your listing</b> “{title}”</p>
      <div className="dnac__peekrow"><Icon name="dna" size={14} /> Leaves <b>{from.name}</b></div>
      <div className="dnac__peekrow is-to"><Icon name="right" size={14} /> Joins <b>{to.name}</b>{span || to.sellers ? <small> · {[span, `${to.sellers} shop${to.sellers === 1 ? '' : 's'}`].filter(Boolean).join(' · ')}</small> : null}</div>
      <p className="dnac__note">Figmark will not move it back. You can change it again any time.</p>
    </div>
  );
}

const ASK_AFTER_MS = 3_500;
const ASK_AGAIN_MS = 3 * 24 * 3600_000;
const askKey = (dnaId: string) => `figmark.dnaAsk.${dnaId}`;

/**
 * On a product's page, a few seconds in: does this one listing on it really
 * match? A card rises from the bottom asking the reader to help the
 * community. "No" tells the shop and Figmark's operators; enough "yes" and
 * nobody is asked about that listing again. Signed-in readers only, never
 * about their own listings, and "Not now" keeps it away for a few days.
 */
export function DnaAskPopup({ dnaId, dnaName, cover, coverBox }: {
  dnaId: string; dnaName: string; cover: string | null; coverBox: RegionBox | null;
}) {
  const { user } = useSession();
  const toast = useToast();
  const reduced = useReducedMotion();
  const [ask, setAsk] = useState<DnaAsk | null>(null);
  const [said, setSaid] = useState<'yes' | 'no' | null>(null);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const closing = useRef<number | undefined>(undefined);

  useEffect(() => {
    setAsk(null);
    setSaid(null);
    setLeaving(false);
    if (!user) return undefined;
    try {
      const last = Number(localStorage.getItem(askKey(dnaId)) ?? 0);
      if (Date.now() - last < ASK_AGAIN_MS) return undefined;
    } catch { /* asked anyway */ }
    let live = true;
    const found = api.dnaAsk(dnaId).then((answer) => answer.ask).catch(() => null);
    const timer = window.setTimeout(() => { void found.then((next) => { if (live && next) setAsk(next); }); }, ASK_AFTER_MS);
    return () => { live = false; window.clearTimeout(timer); };
  }, [dnaId, user]);
  useEffect(() => () => window.clearTimeout(closing.current), []);

  if (!ask) return null;

  const remember = () => { try { localStorage.setItem(askKey(dnaId), String(Date.now())); } catch { /* this visit only */ } };
  const close = () => {
    remember();
    setLeaving(true);
    closing.current = window.setTimeout(() => setAsk(null), reduced ? 0 : 260);
  };
  const answer = async (right: boolean) => {
    setBusy(true);
    try {
      await api.dnaVote(ask.listingId, right);
      setSaid(right ? 'yes' : 'no');
      remember();
      closing.current = window.setTimeout(close, 3_200);
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not go through.', 'error');
    } finally {
      setBusy(false);
    }
  };
  const others = ask.yes;

  return (
    <aside className={`dnaask${leaving ? ' is-leaving' : ''}${said ? ' is-said' : ''}`} role="dialog" aria-label="Help the community">
      <div className="dnaask__card">
        <button type="button" className="dnaask__close" aria-label="Not now" onClick={close}><Icon name="close" size={14} /></button>
        {said ? (
          <div className="dnaask__thanks">
            <span className="dnaask__burst" aria-hidden="true"><Icon name="check" size={22} /></span>
            <b>{said === 'yes' ? 'Thanks - you just helped the community!' : 'Thanks for spotting it!'}</b>
            <p>{said === 'yes'
              ? `Every collector looking at ${dnaName} now sees a checked listing.`
              : 'The shop and Figmark have been asked to check it and correct it if it does not match.'}</p>
          </div>
        ) : (
          <>
            <p className="dnaask__eyebrow"><Icon name="dna" size={13} /> Help the community</p>
            <div className="dnaask__pair">
              <span className="dnaask__pic">{ask.photoUrl ? <img src={ask.photoUrl} alt="" /> : <Icon name="image" size={18} />}</span>
              <span className="dnaask__link" aria-hidden="true"><i /><b>?</b><i /></span>
              <span className="dnaask__pic is-dna">{cover ? <CropPic src={cover} box={coverBox} /> : <Icon name="dna" size={18} />}</span>
            </div>
            <h3 className="dnaask__q">Does this listing match <span>{dnaName}</span>?</h3>
            <p className="dnaask__what"><b>{ask.title}</b> · {ask.shop}</p>
            <div className="dnaask__choices">
              <button type="button" className="dnaask__btn is-yes" disabled={busy} onClick={() => void answer(true)}>
                <Icon name="check" size={15} /> Yes, it matches
              </button>
              <button type="button" className="dnaask__btn" disabled={busy} onClick={() => void answer(false)}>
                No, it doesn't
              </button>
            </div>
            <p className="dnaask__foot">
              {others > 0
                ? `${others} collector${others === 1 ? ' has' : 's have'} checked it. One more tap keeps this product page accurate.`
                : 'Be the first to check it - it keeps prices and shops accurate for everyone.'}
            </p>
          </>
        )}
      </div>
    </aside>
  );
}
