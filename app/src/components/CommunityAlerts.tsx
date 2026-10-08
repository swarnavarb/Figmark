import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type CommunityNotice, type CommunityStanding } from '../api';
import { formatDateOrdinal } from '../format';

/**
 * What community managers' final decisions put in front of everybody.
 *
 * A warning in the feed or a forum, for as many days as the manager set; and
 * an alert on a store's or person's page, once Figmark has approved it. Both
 * link to the dispute behind them, so a reader can see why.
 */

/** The highlighted warnings at the top of the feed (no forum) or of one forum. */
export function CommunityNotices({ forumId = null }: { forumId?: string | null }) {
  const [notices, setNotices] = useState<CommunityNotice[]>([]);

  useEffect(() => {
    let live = true;
    api.communityNotices(forumId).then((body) => live && setNotices(body.notices)).catch(() => undefined);
    return () => { live = false; };
  }, [forumId]);

  if (notices.length === 0) return null;
  return (
    <section className="cnotices" aria-label="Community warnings">
      {notices.map((notice) => (
        <article key={notice.id} className="cnotice" role="note">
          <span className="cnotice__tag">⚠️ Community warning</span>
          <p className="cnotice__body"><b>{notice.targetName}</b> · {notice.message}</p>
          <span className="cnotice__meta">
            From community manager {notice.managerName} · until {formatDateOrdinal(notice.until)}
          </span>
        </article>
      ))}
    </section>
  );
}

/** The alert on someone's page, and their "dispute lost" flags. */
export function CommunityAlertBanner({ userId }: { userId: string }) {
  const [standing, setStanding] = useState<CommunityStanding | null>(null);

  useEffect(() => {
    let live = true;
    api.communityStanding(userId).then((body) => live && setStanding(body)).catch(() => undefined);
    return () => { live = false; };
  }, [userId]);

  if (!standing || (!standing.alert && standing.flags.length === 0)) return null;
  return (
    <aside className="calert" role="alert">
      {standing.alert && (
        <p className="calert__line">
          <b>⚠️ Community alert:</b> {standing.alert.message}{' '}
          <span className="calert__meta">until {formatDateOrdinal(standing.alert.until)}</span>
        </p>
      )}
      {standing.flags.length > 0 && (
        <p className="calert__line calert__meta">
          🚩 {standing.flags.length} dispute{standing.flags.length === 1 ? '' : 's'} lost and flagged by a community manager
          {standing.flags[0] && <> · latest: “{standing.flags[0].message}” · <Link to={`/dispute/${standing.flags[0].disputeId}`}>why</Link></>}
        </p>
      )}
    </aside>
  );
}
