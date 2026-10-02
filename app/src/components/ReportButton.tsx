import { useState } from 'react';
import { REASON_MIN, type ModerationMark, type ReportTarget } from '@shared/moderation';
import { ApiRequestError, api } from '../api';
import { useSession } from '../session';
import { useToast } from './Feedback';
import { Modal } from './LotFields';

/**
 * The one button under every review and comment.
 *
 * Somebody else's words: "Dispute" - tell Figmark it is false, abusive, or not
 * about a real trade. Your own words: "Ask to validate" - put them up for the
 * same check, so a genuine review can carry a mark saying an operator looked.
 * Either way it opens the same short form and lands in the same queue.
 */
export function ReportButton({ targetType, targetId, parentId, mine, moderation }: {
  targetType: ReportTarget;
  targetId: string;
  /** Whose page a review is on, the listing a comment is under, or `channelId:postId`. */
  parentId: string;
  mine: boolean;
  moderation?: ModerationMark;
}) {
  const { user, gate } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(Boolean(moderation?.reportedByMe));

  const validated = Boolean(moderation?.validated);
  const kind = mine ? 'validate' : 'dispute';

  async function send() {
    setBusy(true);
    try {
      await api.report({ targetType, targetId, parentId, reason: reason.trim() });
      setSent(true);
      setOpen(false);
      toast(kind === 'validate' ? 'Sent to Figmark for validation' : 'Dispute sent to Figmark', 'ok');
    } catch (err) {
      toast(err instanceof ApiRequestError ? err.message : 'That did not send.', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="reportbtn">
      {validated && <span className="badge badge--ok" title="An operator checked this at its author's request">✓ Validated</span>}
      {/* Your own validated words need nothing more; everything else gets the button. */}
      {!(validated && mine) && (sent ? (
        <span className="faint reportbtn__sent">{kind === 'validate' ? 'Validation requested' : 'Disputed · under review'}</span>
      ) : (
        <button type="button" className={`btn btn--quiet btn--sm reportbtn__go${user ? '' : ' is-locked'}`}
          onClick={gate(() => setOpen(true), 'Sign in to report or validate this.')}>
          {kind === 'validate' ? '✅ Ask to validate' : '⚠️ Dispute'}
        </button>
      ))}

      {open && (
        <Modal title={kind === 'validate' ? 'Ask Figmark to validate this' : 'Dispute this'} onClose={() => setOpen(false)}>
          <div className="stack">
            <p className="faint" style={{ margin: 0 }}>
              {kind === 'validate'
                ? 'An operator will check what you wrote against the trade or listing it is about. If it holds up, it shows a ✓ Validated mark.'
                : 'Tell us what is wrong - untrue, abusive, spam, or not about a real trade. An operator will look at it and decide whether it stays up.'}
            </p>
            <label className="field">
              <span>{kind === 'validate' ? 'What should we check?' : 'Why are you disputing it?'}</span>
              <textarea rows={4} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)}
                placeholder={kind === 'validate' ? 'e.g. The item arrived damaged - photos are on the order.' : 'e.g. This person never bought from us.'} />
            </label>
            <button type="button" className="btn btn--block" disabled={busy || reason.trim().length < REASON_MIN}
              onClick={() => void send()}>
              {busy ? 'Sending…' : kind === 'validate' ? 'Send for validation' : 'Send dispute'}
            </button>
          </div>
        </Modal>
      )}
    </span>
  );
}
