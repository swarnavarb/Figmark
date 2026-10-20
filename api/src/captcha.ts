import { config } from './config.js';

/**
 * Cloudflare Turnstile: whether a sign-up came from a person.
 *
 * Only when configured; with no keys every sign-up passes, as before. A
 * failure to reach Cloudflare refuses rather than waves through - accounts
 * by the hundred are exactly what this is here to stop.
 */
export async function captchaPasses(token: string | undefined, ip: string): Promise<boolean> {
  const captcha = config.captcha;
  if (!captcha) return true;
  if (!token || token.length > 2048) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret: captcha.secretKey, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
