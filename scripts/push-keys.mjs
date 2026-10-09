/**
 * Prints a fresh key pair for Web Push.
 *
 * Run once per deployment and set both as application settings (see
 * docs/PUSH.md). The public half is handed to every browser; the private half
 * signs every push and must never leave the server. Changing them later
 * silently cuts off every device that already turned notifications on, until
 * each turns them on again.
 */
import { createRequire } from 'node:module';

const require = createRequire(new URL('../api/package.json', import.meta.url));
const webpush = require('web-push');
const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`WEB_PUSH_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_PRIVATE_KEY=${privateKey}`);
console.log('WEB_PUSH_SUBJECT=mailto:you@example.com   # an address the push services can reach you at');
