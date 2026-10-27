/**
 * The clock app's other trigger: held notices sent the moment they are due.
 *
 * Woken by the messages push-queue.ts drops on the wake queue, each invisible
 * until its notice's hold ends. Clock app only (imported by clock-host.ts):
 * Static Web Apps' managed functions take HTTP triggers alone. Registered only
 * when `PUSH_WAKE_QUEUE` names the queue, so an app not set up for it loads
 * exactly as before - a trigger with no queue to read would fail to start.
 */
import { app, type InvocationContext } from '@azure/functions';
import { getRepository } from './data/index.js';
import { sendHeldPushes } from './push.js';
import { wakeQueueName } from './push-queue.js';

if (wakeQueueName()) {
  app.storageQueue('push-wake', {
    queueName: '%PUSH_WAKE_QUEUE%',
    connection: 'PUSH_WAKE_STORAGE',
    handler: async (_message: unknown, context: InvocationContext) => {
      const sent = await sendHeldPushes(await getRepository());
      if (sent > 0) context.log(`push-wake: sent ${sent} held notice(s)`);
    },
  });
}
