import { cleanRouteWords, setRouteWords } from '@shared/route-words';
import { api } from './api';

/**
 * The operators' short forms for route buttons ("warehouse" → "WH"), kept on
 * this device so the first screen is already drawn with them, and read again
 * in the background on every start.
 */
const KEY = 'figmark.routeWords';

export function loadRouteWords() {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept) {
      const cleaned = cleanRouteWords(JSON.parse(kept));
      if ('words' in cleaned) setRouteWords(cleaned.words);
    }
  } catch {
    /* Nothing kept, or blocked storage: the defaults until the read below lands. */
  }
  void api.routeWords().then((words) => {
    const cleaned = cleanRouteWords(words);
    if (!('words' in cleaned)) return;
    setRouteWords(cleaned.words);
    try { localStorage.setItem(KEY, JSON.stringify(cleaned.words)); } catch { /* Next start reads it again. */ }
  }).catch(() => {});
}
