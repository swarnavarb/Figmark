import { STEP_KINDS, type StepKind } from './buttons.js';
import type { StepAssignee } from './routes.js';

/**
 * The buttons every shop can add a step with, as the operators keep them.
 *
 * The seven checkpoints' steps come built in; the operators can say them in
 * their own words (the step's name and what its button reads), and add
 * buttons of their own - "Quality checked", "Photos sent" - that every shop
 * then finds under "+ Step", each with where it can go and who besides the
 * shop may press it.
 */
export interface ButtonLibrary {
  /** The operators' words for the built-in kinds, by kind id. */
  stock: Record<string, { name?: string; button?: string }>;
  extra: LibraryButton[];
}

/** Where a button of the operators' own can go: before the lot, after it, or either. */
export type ButtonPlace = 'pre' | 'post' | 'both';

export interface LibraryButton {
  id: string;
  icon: string;
  /** The step it adds, as the buyer reads it. */
  name: string;
  /** What the button says; the step's name when blank. */
  button: string;
  description: string;
  place: ButtonPlace;
  /** Who besides the shop may press it. */
  assignee?: StepAssignee;
}

/** The site content document the library is kept in. */
export const ROUTE_BUTTONS_ID = 'route-buttons';

export const EMPTY_BUTTON_LIBRARY: ButtonLibrary = { stock: {}, extra: [] };

/** The built-in kinds the operators may reword: the five handed out by what a step says. */
export const RENAMEABLE_KINDS = STEP_KINDS.filter((kind) => kind.trigger && kind.trigger !== 'dispatched' && kind.trigger !== 'delivered');

let current: ButtonLibrary = EMPTY_BUTTON_LIBRARY;

export function setButtonLibrary(library: ButtonLibrary | null | undefined): void {
  current = library ?? EMPTY_BUTTON_LIBRARY;
}

export function buttonLibrary(): ButtonLibrary {
  return current;
}

/** Every kind "+ Step" offers: the built-in ones in the operators' words, then theirs, then the blank two. */
export function stepKinds(library: ButtonLibrary = current): StepKind[] {
  const stock = STEP_KINDS.filter((kind) => kind.trigger).map((kind) => {
    const own = library.stock[kind.id];
    return own ? { ...kind, name: own.name?.trim() || kind.name, button: own.button?.trim() || undefined } : kind;
  });
  const extra: StepKind[] = library.extra.map((entry) => ({
    id: entry.id, icon: entry.icon || '✨', name: entry.name, description: entry.description,
    custom: true, button: entry.button || undefined, assignee: entry.assignee, place: entry.place, library: true,
  }));
  return [...stock, ...extra, ...STEP_KINDS.filter((kind) => !kind.trigger)];
}

const MAX_EXTRA = 40;
const ASSIGNEES: readonly StepAssignee[] = ['supplier', 'handler', 'forwarder'];
const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');

/** What the console sent, made safe to store, or why it cannot be. */
export function cleanButtonLibrary(input: unknown): { library: ButtonLibrary } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Send the buttons as an object.' };
  const body = input as { stock?: unknown; extra?: unknown };
  const stock: ButtonLibrary['stock'] = {};
  if (body.stock && typeof body.stock === 'object') {
    for (const kind of RENAMEABLE_KINDS) {
      const own = (body.stock as Record<string, { name?: unknown; button?: unknown }>)[kind.id];
      if (!own) continue;
      const name = text(own.name, 60);
      const button = text(own.button, 28);
      if (name || button) stock[kind.id] = { ...(name ? { name } : {}), ...(button ? { button } : {}) };
    }
  }
  if (body.extra !== undefined && !Array.isArray(body.extra)) return { error: 'extra must be a list.' };
  const list = (body.extra as unknown[] | undefined) ?? [];
  if (list.length > MAX_EXTRA) return { error: `At most ${MAX_EXTRA} buttons of your own.` };
  const extra: LibraryButton[] = [];
  const ids = new Set<string>();
  for (const entry of list) {
    const raw = (entry ?? {}) as Partial<LibraryButton>;
    const name = text(raw.name, 60);
    if (!name) return { error: 'Every new button needs the step it adds.' };
    const id = typeof raw.id === 'string' && /^[a-z0-9_-]{1,40}$/i.test(raw.id) ? raw.id : '';
    if (!id || ids.has(id)) return { error: `"${name}" needs an id of its own.` };
    ids.add(id);
    const place: ButtonPlace = raw.place === 'pre' || raw.place === 'post' ? raw.place : 'both';
    const assignee = ASSIGNEES.includes(raw.assignee as StepAssignee) ? raw.assignee : undefined;
    extra.push({
      id, name, place, icon: text(raw.icon, 8) || '✨', button: text(raw.button, 28), description: text(raw.description, 160),
      ...(assignee ? { assignee } : {}),
    });
  }
  return { library: { stock, extra } };
}
