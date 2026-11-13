import type { Notification } from '../../shared/models.js';
import { config } from './config.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

/**
 * Shipment news on WhatsApp, where these buyers actually read it.
 *
 * Buyers here check WhatsApp many times a day and the app rarely, so a lot
 * clearing customs told only in the bell is told to nobody. This sends the
 * same notice to the buyer's verified WhatsApp number.
 *
 * WhatsApp only lets a business start a conversation with a template Meta has
 * approved, so this needs one: WHATSAPP_UPDATES_TEMPLATE names it, with two
 * body variables - {{1}} the notice's title ("Your item from Shop: Customs
 * cleared") and {{2}} a link to the order. Without the template, or without
 * the WhatsApp Cloud API keys, nothing is sent and nothing else changes.
 *
 * It rides the held-notice clock (push.ts), so a move the seller undoes inside
 * its three minutes never reaches WhatsApp either.
 */

/** The kinds of notice that go to WhatsApp: the journey, not the chatter. */
const SENT_KINDS = new Set<Notification['kind']>(['lot_moved']);

function settings() {
  const whatsapp = config.verification.whatsapp;
  const template = process.env.WHATSAPP_UPDATES_TEMPLATE?.trim();
  const origin = config.publicOrigins?.[0] ?? process.env.SITE_ORIGIN?.trim() ?? null;
  if (!whatsapp?.accessToken || !whatsapp.phoneNumberId || !template || !origin) return null;
  return {
    token: whatsapp.accessToken,
    phoneNumberId: whatsapp.phoneNumberId,
    template,
    language: process.env.WHATSAPP_UPDATES_LANG?.trim() || 'en',
    origin: origin.replace(/\/$/, ''),
  };
}

export function whatsappUpdatesEnabled(): boolean {
  return settings() !== null;
}

/** The message body Meta is sent, kept apart so a test can read it without a network. */
export function whatsappUpdateBody(to: string, notice: Pick<Notification, 'title' | 'link'>, template: string, language: string, origin: string) {
  return {
    messaging_product: 'whatsapp',
    to: to.replace(/\D/g, ''),
    type: 'template',
    template: {
      name: template,
      language: { code: language },
      components: [{
        type: 'body',
        parameters: [
          { type: 'text', text: notice.title.slice(0, 200) },
          { type: 'text', text: `${origin}${notice.link}` },
        ],
      }],
    },
  };
}

/** Send one notice to its person's WhatsApp, when it is that kind of news and they have a verified number. Never throws. */
export async function whatsappNotice(repository: Repo, notice: Notification): Promise<boolean> {
  if (!SENT_KINDS.has(notice.kind)) return false;
  const on = settings();
  if (!on) return false;
  try {
    const user = await repository.getUserById(notice.userId);
    const number = user?.verification?.proofs?.phone?.number;
    if (!user || !number || user.notificationPrefs?.whatsappUpdatesOff) return false;
    const response = await fetch(`https://graph.facebook.com/v21.0/${on.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${on.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(whatsappUpdateBody(number, notice, on.template, on.language, on.origin)),
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
