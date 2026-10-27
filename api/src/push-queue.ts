import { DefaultAzureCredential } from '@azure/identity';
import { QueueClient, QueueServiceClient, StorageSharedKeyCredential } from '@azure/storage-queue';
import { config } from './config.js';

/**
 * A wake-up call for the clock app at the moment a held notice is due.
 *
 * The five-minute clock is the guarantee that a held notice reaches the phone,
 * but on its own it can be up to five minutes late when nobody is on the site.
 * So whoever holds a notice also drops a message on a Storage queue, invisible
 * until the hold ends; the clock app's queue trigger (see clocks.ts) wakes on
 * it and sends whatever is due. Costs one queue message and a few seconds of
 * an instance per due time, rather than an instance kept awake to poll.
 *
 * Off unless `PUSH_WAKE_QUEUE` names the queue. Best effort, like the timer in
 * sendHeldPushesAt: a message that cannot be queued leaves the clock and the
 * bell reads to send it, as before.
 */

/** The queue's name, or null when wake-ups are off. */
export function wakeQueueName(): string | null {
  return process.env.PUSH_WAKE_QUEUE?.trim() || null;
}

/** Storage queues hide a message for at most seven days. */
const MAX_DELAY_S = 7 * 86_400;

let client: Promise<QueueClient | null> | null = null;

function queueClient(): Promise<QueueClient | null> {
  if (!client) {
    client = (async () => {
      const name = wakeQueueName();
      const storage = config.storage;
      if (!name || !storage) return null;
      let service: QueueServiceClient;
      if (storage.connectionString) {
        service = QueueServiceClient.fromConnectionString(storage.connectionString);
      } else {
        const url = `https://${storage.account}.queue.core.windows.net`;
        service = new QueueServiceClient(
          url,
          storage.key ? new StorageSharedKeyCredential(storage.account, storage.key) : new DefaultAzureCredential(),
        );
      }
      const queue = service.getQueueClient(name);
      await queue.createIfNotExists();
      return queue;
    })().catch(() => {
      client = null;
      return null;
    });
  }
  return client;
}

/* Due times already queued by this instance, to the second: forty buyers held
   to the same moment are one wake-up, not forty. */
const queued = new Map<number, number>();

/** Ask the clock app to send held notices at `at`. Never throws. */
export async function wakeAt(at: string): Promise<void> {
  if (!wakeQueueName()) return;
  const due = Math.ceil(Date.parse(at) / 1000);
  if (!Number.isFinite(due)) return;
  const now = Date.now();
  for (const [second, until] of queued) if (until < now) queued.delete(second);
  if (queued.has(due)) return;
  queued.set(due, due * 1000 + 60_000);
  try {
    const queue = await queueClient();
    if (!queue) return;
    // One second after the hold ends, so the notice is due when it lands.
    const delay = Math.min(MAX_DELAY_S, Math.max(0, due - Math.floor(now / 1000) + 1));
    // Base64, the encoding the Functions queue trigger reads by default.
    await queue.sendMessage(Buffer.from(JSON.stringify({ at })).toString('base64'), {
      visibilityTimeout: delay,
      messageTimeToLive: delay + 3600,
    });
  } catch {
    queued.delete(due);
  }
}
