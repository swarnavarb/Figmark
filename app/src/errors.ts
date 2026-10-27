/**
 * Errors in the browser, reported to the server's log so a page that breaks
 * on somebody's phone is seen by whoever runs the site. Best effort, a few a
 * minute at most, and never anything typed into a form: the message, the
 * stack and the page's path.
 */
let sent = 0;
const MAX_PER_PAGE_LOAD = 10;

export function reportError(kind: string, error: unknown): void {
  if (sent >= MAX_PER_PAGE_LOAD) return;
  sent += 1;
  const err = error instanceof Error ? error : new Error(String(error));
  // A chunk that went missing in a deploy is handled by reloading (freshness.ts): not news.
  if (/Failed to fetch dynamically imported module|Importing a module script failed/.test(err.message)) return;
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    keepalive: true,
    body: JSON.stringify({ kind, message: err.message, stack: err.stack ?? '', url: location.pathname }),
  }).catch(() => undefined);
}

export function listenForErrors(): void {
  window.addEventListener('error', (event) => reportError('error', event.error ?? event.message));
  window.addEventListener('unhandledrejection', (event) => reportError('rejection', event.reason));
}
