/**
 * A small load test for the reads every visit starts with.
 *
 *   node scripts/load-test.mjs <base-url> [requests-per-second=10] [seconds=30]
 *
 * Sends a steady rate of requests, spread over the start-of-visit reads, and
 * reports latency percentiles and errors per path. No dependencies, so it
 * runs anywhere Node does. Point it at a development deployment, never at
 * production. See docs/OPERATIONS.md.
 */
const [base, rateArg = '10', secondsArg = '30'] = process.argv.slice(2);
if (!base) {
  console.error('Usage: node scripts/load-test.mjs <base-url> [requests-per-second] [seconds]');
  process.exit(2);
}
const rate = Math.max(1, Number(rateArg));
const seconds = Math.max(1, Number(secondsArg));

const origin = base.replace(/\/+$/, '');
const paths = ['/api/bootstrap', '/api/feed?sort=newest', '/api/social/discover', '/api/showcase/drops'];

// One listing from the feed, so the detail page is in the mix too.
try {
  const feed = await (await fetch(`${origin}/api/feed?sort=newest`)).json();
  const first = feed?.listings?.[0]?.id;
  if (first) paths.push(`/api/listings/${encodeURIComponent(first)}`);
} catch {
  // The feed itself is in the mix; its failures are counted there.
}

const results = new Map(paths.map((path) => [path, { times: [], errors: 0, statuses: new Map() }]));
let inFlight = 0;
let sent = 0;

async function hit(path) {
  const row = results.get(path);
  const start = performance.now();
  inFlight += 1;
  try {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(30_000) });
    await response.arrayBuffer();
    row.statuses.set(response.status, (row.statuses.get(response.status) ?? 0) + 1);
    if (response.status >= 500 || response.status === 429) row.errors += 1;
  } catch {
    row.errors += 1;
    row.statuses.set('failed', (row.statuses.get('failed') ?? 0) + 1);
  } finally {
    row.times.push(performance.now() - start);
    inFlight -= 1;
  }
}

const total = rate * seconds;
const interval = 1000 / rate;
const started = Date.now();
await new Promise((resolve) => {
  const timer = setInterval(() => {
    if (sent >= total) {
      clearInterval(timer);
      resolve();
      return;
    }
    void hit(paths[sent % paths.length]);
    sent += 1;
  }, interval);
});
while (inFlight > 0) await new Promise((resolve) => setTimeout(resolve, 50));

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
console.log(`\n${sent} requests at ${rate}/s over ${((Date.now() - started) / 1000).toFixed(1)}s against ${origin}\n`);
console.log('path'.padEnd(40), 'n'.padStart(5), 'p50'.padStart(7), 'p95'.padStart(7), 'p99'.padStart(7), 'errors'.padStart(7), '  statuses');
let errors = 0;
for (const [path, row] of results) {
  const sorted = [...row.times].sort((a, b) => a - b);
  errors += row.errors;
  console.log(
    path.slice(0, 40).padEnd(40), String(sorted.length).padStart(5),
    `${pct(sorted, 50).toFixed(0)}ms`.padStart(7), `${pct(sorted, 95).toFixed(0)}ms`.padStart(7), `${pct(sorted, 99).toFixed(0)}ms`.padStart(7),
    String(row.errors).padStart(7), ' ', [...row.statuses].map(([status, n]) => `${status}:${n}`).join(' '),
  );
}
process.exit(errors > 0 ? 1 : 0);
