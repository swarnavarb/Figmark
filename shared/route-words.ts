import { COUNTRIES, countryFlag } from './countries.js';

/**
 * How route words are said on a button.
 *
 * A step is written once for every lot ("Received at {origin} warehouse"),
 * and its button sits on a small pill on a phone. So on a button the country
 * is its flag, and the long words people in the trade shorten anyway are
 * shortened: "Received at 🇨🇳 WH". The list of short forms is the operators'
 * to keep, from the console, so the whole marketplace says them one way.
 */
export interface RouteWordRule {
  /** The word or phrase as written in a step, matched whole and in any case. */
  from: string;
  /** What a button says instead. */
  to: string;
}

export interface RouteWords {
  terms: RouteWordRule[];
  /** A country on a button is its flag rather than its name. */
  flags: boolean;
}

export const DEFAULT_ROUTE_WORDS: RouteWords = {
  flags: true,
  terms: [
    { from: 'warehouse', to: 'WH' },
    { from: 'freight forwarder', to: 'forwarder' },
  ],
};

/** The site content document the operators' list is kept in. */
export const ROUTE_WORDS_ID = 'route-words';

let current: RouteWords = DEFAULT_ROUTE_WORDS;

/** The list in force here: set once it is read from the server, the defaults until then. */
export function routeWords(): RouteWords {
  return current;
}

export function setRouteWords(words: RouteWords | null | undefined): void {
  current = words ?? DEFAULT_ROUTE_WORDS;
}

/** At most this many short forms, each this long: a glossary, not a rewrite engine. */
const MAX_TERMS = 60;
const MAX_LENGTH = 40;

/** What the console sent, made safe to store, or why it cannot be. */
export function cleanRouteWords(input: unknown): { words: RouteWords } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'Send the short forms as an object.' };
  const body = input as { terms?: unknown; flags?: unknown };
  if (!Array.isArray(body.terms)) return { error: 'terms must be a list.' };
  if (body.terms.length > MAX_TERMS) return { error: `At most ${MAX_TERMS} short forms.` };
  const terms: RouteWordRule[] = [];
  const seen = new Set<string>();
  for (const entry of body.terms) {
    const from = typeof (entry as RouteWordRule)?.from === 'string' ? (entry as RouteWordRule).from.trim() : '';
    const to = typeof (entry as RouteWordRule)?.to === 'string' ? (entry as RouteWordRule).to.trim() : '';
    if (!from && !to) continue;
    if (!from || !to) return { error: 'Every short form needs both the word and what it becomes.' };
    if (from.length > MAX_LENGTH || to.length > MAX_LENGTH) return { error: `Keep each word under ${MAX_LENGTH} characters.` };
    if (/[{}]/.test(from) || /[{}]/.test(to)) return { error: 'Curly braces are for {origin} and {dest} only.' };
    const key = from.toLowerCase();
    if (seen.has(key)) return { error: `"${from}" is listed twice.` };
    seen.add(key);
    terms.push({ from, to });
  }
  return { words: { terms, flags: body.flags !== false } };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The short forms applied, longest first so "freight forwarder" wins over "forwarder". */
export function shortenWords(text: string, words: RouteWords = current): string {
  let out = text;
  for (const rule of [...words.terms].sort((a, b) => b.from.length - a.from.length)) {
    out = out.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${escape(rule.from)}(?=$|[^\\p{L}\\p{N}])`, 'giu'), `$1${rule.to}`);
  }
  return out;
}

/**
 * A button's words: the lot's countries as flags (or the plain word "origin"
 * where no country is set yet), then the short forms.
 */
export function renderButtonText(
  text: string,
  vars: { origin?: string | null; destination?: string | null } = {},
  words: RouteWords = current,
): string {
  const place = (country: string | null | undefined, word: string) => {
    const name = country?.trim();
    if (!name) return word;
    return words.flags && COUNTRIES.includes(name) ? countryFlag(name) : name;
  };
  const filled = text
    .replace(/(?:\bthe\s+)?'?\{origin\}'?/gi, place(vars.origin, 'origin'))
    .replace(/(?:\bthe\s+)?'?\{dest(?:ination|\.)?\}'?/gi, place(vars.destination, 'destination'));
  return shortenWords(filled, words).replace(/\s+/g, ' ').trim();
}
