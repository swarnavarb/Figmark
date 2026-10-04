import { randomUUID } from 'node:crypto';
import { UNDO_WINDOW_MS, isPendingUndo } from '../../../shared/fulfilment.js';
import type { StageEvent } from '../../../shared/models.js';
import type { getRepository } from '../data/index.js';

/**
 * Taking a step forward back.
 *
 * Every move of a lot, move of an item and button press is tagged with an id
 * and a deadline three minutes out. Until then it is in effect but shown on no
 * timeline, and its notice waits; undoing it inside the window reverses it and
 * removes every trace. After the window it is history like anything else, and
 * the way back is an ordinary step the other way.
 */
type Repo = Awaited<ReturnType<typeof getRepository>>;

export interface UndoTag {
  undoId: string;
  undoUntil: string;
}

/**
 * The window, in milliseconds. Three minutes, unless FIGMARK_UNDO_WINDOW_MS
 * says otherwise - which the API's own checks set to 0, so the hundreds of
 * them written before undo existed read every step at once, as they expect.
 */
function windowMs(): number {
  const set = Number(process.env.FIGMARK_UNDO_WINDOW_MS);
  return Number.isFinite(set) && process.env.FIGMARK_UNDO_WINDOW_MS !== undefined ? set : UNDO_WINDOW_MS;
}

/** A fresh tag for an action made at `now`. */
export function undoTag(now: string): UndoTag {
  return {
    undoId: `und_${randomUUID().slice(0, 12)}`,
    undoUntil: new Date(Date.parse(now) + windowMs()).toISOString(),
  };
}

/** True while `undoId` is on this history and still inside its window. */
export function canUndo(history: readonly StageEvent[], undoId: string): boolean {
  return history.some((event) => event.undoId === undoId && isPendingUndo(event));
}

/** The history with every event of that action taken out. */
export function withoutUndo(history: readonly StageEvent[], undoId: string): StageEvent[] {
  return history.filter((event) => event.undoId !== undoId);
}

/** Said when the window has closed, or the action was never undoable. */
export const UNDO_EXPIRED = 'Too late to undo - the 3 minutes are up and buyers can see it now. Move it back as a normal step instead.';

/** Take back the notices an undone action had queued. */
export async function withdrawNotices(repository: Repo, userIds: readonly string[], undoId: string): Promise<void> {
  const now = new Date().toISOString();
  await Promise.all([...new Set(userIds)].map(async (userId) => {
    try {
      const rows = await repository.listNotifications(userId, 50);
      await Promise.all(rows.filter((row) => row.undoId === undoId && !row.withdrawn)
        .map((row) => repository.saveNotification({ ...row, withdrawn: true, updatedAt: now })));
    } catch {
      // A notice that could not be withdrawn still shows a step that was
      // undone; the timeline, which is the record, is already right.
    }
  }));
}
