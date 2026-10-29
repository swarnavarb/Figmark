/**
 * One-off: marks an account's email as verified, exactly as typing back the
 * emailed code would (api/src/verification/index.ts, confirmEmail). For an
 * operator on a deployment that cannot send email yet, so their ADMIN_EMAILS
 * address can count.
 *
 *   npm run build:api
 *   COSMOS_ENDPOINT=... COSMOS_KEY=... node scripts/mark-email-verified.mjs you@example.com
 *
 * Runs against the Cosmos database the settings name, never the in-memory
 * store. The account must already exist: sign up first. Only use it on an
 * address you own - whoever holds the account it names becomes an operator
 * if the address is also in ADMIN_EMAILS.
 */
const email = process.argv[2]?.trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/mark-email-verified.mjs <email>');
  process.exit(1);
}

const base = new URL('../api/dist/', import.meta.url);
const { getRepository } = await import(new URL('api/src/data/index.js', base));

const repository = await getRepository();
const status = repository.status();
if (repository.backend !== 'cosmos' || !status.connected) {
  console.error(`Not connected to Cosmos DB (${status.detail}). Set COSMOS_ENDPOINT and COSMOS_KEY.`);
  process.exit(1);
}
console.log(`Database: ${status.database}`);

const user = await repository.getUserByIdentifier(email);
if (!user || user.email.trim().toLowerCase() !== email) {
  console.error(`No account with the email ${email}. Sign up with it first, then run this again.`);
  process.exit(1);
}

const now = new Date().toISOString();
user.challenges = { ...user.challenges, email: null };
user.verification = {
  ...user.verification,
  email: 'verified',
  proofs: { ...user.verification.proofs, email: { address: user.email, at: now } },
};
user.updatedAt = now;
await repository.updateUser(user);

console.log(`Marked ${user.email} (${user.id}) as verified.`);
