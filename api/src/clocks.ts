/**
 * The clocks: work that falls due at a time rather than on a request.
 *
 * Static Web Apps' managed functions run HTTP triggers only, so on that host
 * these never fire; the same registration runs on the clock Function App (see
 * clock-host.ts and docs/AZURE.md). Each clock is also run on a read where it
 * can be (sendHeldPushesSoon, closeDuePreOrdersSoon, the power-sale console,
 * settlePlay on the social feeds), so a host without timers is slower, not
 * stuck.
 *
 * One timer every five minutes rather than one per clock every minute. Four
 * staggered minute timers woke the Function App every fifteen seconds, so a
 * Flex Consumption instance never sat idle long enough to scale to zero and
 * was billed as if always on. Five quiet minutes between runs lets it.
 */
import { app, type InvocationContext, type Timer } from '@azure/functions';
import { config } from './config.js';
import { getRepository } from './data/index.js';
import { disputeClock } from './functions/dispute-routes.js';
import { tickPowerSales } from './functions/power-sale.js';
import { closeDuePreOrders } from './functions/preorder.js';
import { settleDueGames } from './play.js';
import { sendHeldPushes } from './push.js';

/** Run one clock; a failure is logged and the rest still run. */
async function run(
  context: InvocationContext, name: string, work: () => Promise<number>, done: (count: number) => string,
): Promise<void> {
  try {
    const count = await work();
    if (count > 0) context.log(`${name}: ${done(count)}`);
  } catch (err) {
    context.error(`${name} failed`, err);
  }
}

app.timer('clock', {
  schedule: '0 */5 * * * *',
  handler: async (timer: Timer, context: InvocationContext) => {
    const repository = await getRepository();
    // Names the store, so the count alone never hides a missing
    // COSMOS_ENDPOINT behind a working-looking log line.
    const store = config.cosmos ? 'Cosmos' : 'the in-memory store';

    /* Every live sale moves to where it should be, watched or not. */
    await run(context, 'power-sale-clock', () => tickPowerSales(repository), (n) => `advanced ${n} live sale(s) on ${store}`);
    /* Notices held while their step could still be undone go out once the hold ends. */
    await run(context, 'push-clock', () => sendHeldPushes(repository), (n) => `sent ${n} held notice(s)`);
    /* Campaigns past their cutoff or the seller's decision deadline are settled. */
    await run(context, 'preorder-clock', () => closeDuePreOrders(repository), (n) => `settled ${n} pre-order(s)`);
    /* Debates, polls, guesses and competitions: results, payouts and "ending soon" reminders. */
    await run(context, 'games-clock', () => settleDueGames(repository), (n) => `settled ${n} game(s)`);

    /* Dispute deadlines and the release of money they hold: once an hour, on the first run of it. */
    if (new Date().getUTCMinutes() < 5) await disputeClock(timer, context);
  },
});
