/**
 * A new lot half-filled while its route is written.
 *
 * "Create a new route" on the new-lot form goes to the Route Studio page
 * rather than opening it over the form, so what was typed is kept here and
 * the form starts from it when it is opened again. The Studio puts the route
 * it saved in `routeId`, and sends the seller back to `returnTo`.
 */
const KEY = 'figmark:new-lot-draft';

export interface LotDraft {
  name: string;
  originCountry: string;
  destinationCountry: string;
  forwarderName: string;
  supplierHandle: string;
  handlerHandle: string;
  routeId: string;
  /** The screen the form was on, which opens it again on the way back. */
  returnTo: string;
}

export function readLotDraft(): LotDraft | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? 'null') as LotDraft | null;
  } catch {
    return null;
  }
}

export function writeLotDraft(draft: LotDraft) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    /* A private window: the form simply starts empty again. */
  }
}

export function clearLotDraft() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* Nothing was kept. */
  }
}

/** Whether the screen at this address had a new lot open when it left for the Studio. */
export function lotDraftWaitingAt(path: string): boolean {
  const draft = readLotDraft();
  return Boolean(draft && draft.returnTo === path);
}
