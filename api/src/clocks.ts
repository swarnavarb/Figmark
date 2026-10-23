/**
 * The clocks: work that falls due at a time rather than on a request.
 *
 * Static Web Apps' managed functions run HTTP triggers only, so on that host
 * these never fire; the same registrations run on the clock Function App (see
 * clock-host.ts and docs/AZURE.md). Each clock is also run on a read where it
 * can be (sendHeldPushesSoon, closeDuePreOrdersSoon, the power-sale console,
 * settlePlay on the social feeds), so a host without timers is slower, not
 * stuck.
 */
import { app } from '@azure/functions';
import { config } from './config.js';
import { getRepository } from './data/index.js';
import { disputeClock } from './functions/dispute-routes.js';
import { tickPowerSales } from './functions/power-sale.js';
import { closeDuePreOrders } from './functions/preorder.js';
import { settleDueGames } from './play.js';
import { sendHeldPushes } from './push.js';

/** Every minute, every live sale moves to where it should be, watched or not. */
app.timer('power-sale-clock', {
  schedule: '0 */1 * * * *',
  handler: async (_timer, context) => {
    const touched = await tickPowerSales(await getRepository());
    // Names the store: the showcase sales are live on both, so the count alone
    // cannot tell a missing COSMOS_ENDPOINT from a working one.
    const store = config.cosmos ? 'Cosmos' : 'the in-memory store';
    if (touched > 0) context.log(`power-sale-clock: advanced ${touched} live sale(s) on ${store}`);
  },
});

/** Notices held while their step could still be undone go out once the hold ends. */
app.timer('push-clock', {
  schedule: '30 */1 * * * *',
  handler: async (_timer, context) => {
    const sent = await sendHeldPushes(await getRepository());
    if (sent > 0) context.log(`push-clock: sent ${sent} held notice(s)`);
  },
});

/** Campaigns past their cutoff or the seller's decision deadline are settled. */
app.timer('preorder-clock', {
  schedule: '15 */1 * * * *',
  handler: async (_timer, context) => {
    const settled = await closeDuePreOrders(await getRepository());
    if (settled > 0) context.log(`preorder-clock: settled ${settled} pre-order(s)`);
  },
});

/** Debates, polls, guesses and competitions: results, payouts and "ending soon" reminders. */
app.timer('games-clock', {
  schedule: '45 */1 * * * *',
  handler: async (_timer, context) => {
    const settled = await settleDueGames(await getRepository());
    if (settled > 0) context.log(`games-clock: settled ${settled} game(s)`);
  },
});

/** Dispute deadlines and the release of money they hold. */
app.timer('dispute-clock', { schedule: '0 7 * * * *', handler: disputeClock });
