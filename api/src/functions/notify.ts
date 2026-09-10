import { randomUUID } from 'node:crypto';
import type { Notification, NotificationKind } from '../../../shared/models.js';
import type { getRepository } from '../data/index.js';

/**
 * Telling somebody something happened.
 *
 * One helper because every caller has the same three obligations and they are
 * easy to forget one at a time: never tell somebody about their own action,
 * never let a failed notification undo the thing it was about, and always
 * carry somewhere to go.
 *
 * That last one is the rule that makes the bell worth having. A row that says
 * "your order changed" and leaves the reader to find which order is an
 * interruption; one that opens the order is a message.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export interface NoticeDraft {
  kind: NotificationKind;
  title: string;
  body: string;
  /** Where tapping it goes, as an in-app route. */
  link: string;
}

/**
 * Write one notice to each person, minus whoever caused it.
 *
 * Failures are swallowed per person. A notification that could not be written
 * must never roll back the payment, dispute or answer it was reporting - the
 * thing that happened has happened, and the worst case here is somebody has to
 * look for themselves.
 */
export async function notify(
  repository: Repo,
  audience: readonly (string | null | undefined)[],
  draft: NoticeDraft,
  options: { except?: string } = {},
): Promise<void> {
  const now = new Date().toISOString();
  const people = new Set(
    audience.filter((id): id is string => Boolean(id) && id !== options.except),
  );

  await Promise.all(
    [...people].map(async (userId) => {
      try {
        const notice: Notification = {
          id: `ntf_${randomUUID().slice(0, 12)}`,
          userId,
          kind: draft.kind,
          title: draft.title,
          body: draft.body,
          link: draft.link,
          readAt: null,
          createdAt: now,
          updatedAt: now,
        };
        await repository.saveNotification(notice);
      } catch {
        // One person's missing notice is not a reason to fail the thing it was
        // about, which is already done.
      }
    }),
  );
}
