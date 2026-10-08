import { useState } from 'react';
import { REPORT_TARGET_LABELS, type ModerationMark, type ReportTarget } from '@shared/moderation';
import { useSession } from '../session';
import { ContentMenu } from './DisputeFlows';

/**
 * The ⋮ under every review, comment and post.
 *
 * Somebody else's words: "Report now" - straight to Figmark's operators, free
 * - or "Raise a dispute", a case a community manager hears with both of you.
 * Your own words: "Ask to validate", so a genuine review can carry a mark
 * saying an operator looked.
 */
export function ReportButton({ targetType, targetId, parentId, mine, moderation, authorId, label }: {
  targetType: ReportTarget;
  targetId: string;
  /** Whose page a review is on, the listing a comment is under, `channelId:postId`, or a post's channel. */
  parentId: string;
  mine: boolean;
  moderation?: ModerationMark;
  /** Who wrote it, so they are left out of the community managers who could hear a dispute about it. */
  authorId?: string;
  /** What a dispute about it says it is about. */
  label?: string;
}) {
  const { user, gate } = useSession();
  const [sent, setSent] = useState(Boolean(moderation?.reportedByMe));
  const validated = Boolean(moderation?.validated);

  return (
    <span className="reportbtn">
      {validated && <span className="badge badge--ok" title="An operator checked this at its author's request">✓ Validated</span>}
      {/* Your own validated words need nothing more; everything else gets the menu. */}
      {!(validated && mine) && (sent && mine ? (
        <span className="faint reportbtn__sent">Validation requested</span>
      ) : user ? (
        <ContentMenu targetType={targetType} targetId={targetId} parentId={parentId} authorId={authorId}
          label={label ?? REPORT_TARGET_LABELS[targetType]} mine={mine} reported={sent} onReported={() => setSent(true)} />
      ) : (
        <button type="button" className="iconbtn cmenu__btn is-locked" aria-label="More"
          onClick={gate(() => undefined, 'Sign in to report, dispute or validate this.')}>⋮</button>
      ))}
    </span>
  );
}
