/**
 * Email codes across free tiers: Brevo, then Mailjet, then Resend.
 *
 * The providers are stood in for by a fake fetch, so this checks the order,
 * the shared daily count, quota refusals, outages and the daily reset - not
 * the providers themselves.
 */
import assert from 'node:assert/strict';

process.env.FIGMARK_RATE_LIMITS = 'off';
process.env.EMAIL_FROM = 'codes@figmark.example';
process.env.BREVO_API_KEY = 'brevo-key';
process.env.BREVO_DAILY_LIMIT = '2';
process.env.MAILJET_API_KEY = 'mj-key';
process.env.MAILJET_SECRET_KEY = 'mj-secret';
process.env.MAILJET_DAILY_LIMIT = '2';
process.env.RESEND_API_KEY = 'resend-key';
process.env.RESEND_FROM = 'codes@mail.figmark.example';
process.env.RESEND_DAILY_LIMIT = '2';

/** What each fake provider answers next; 'ok' by default. */
const behaviour = { brevo: 'ok', mailjet: 'ok', resend: 'ok' };
const sent = [];
globalThis.fetch = async (url, init) => {
  const name = url.includes('brevo') ? 'brevo' : url.includes('mailjet') ? 'mailjet' : 'resend';
  const mode = behaviour[name];
  if (mode === 'quota') return new Response('{"message":"daily sending limit exceeded"}', { status: 402 });
  if (mode === 'down') return new Response('upstream error', { status: 503 });
  sent.push({ name, body: JSON.parse(init.body) });
  return new Response('{}', { status: 200 });
};

const dist = new URL('../api/dist/api/src/', import.meta.url);
const { sendEmail, emailUsage, EmailUnavailableError } = await import(new URL('verification/email-providers.js', dist));
const { MemoryRepository } = await import(new URL('data/memory-repository.js', dist));

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`  ok  ${name}`);
};
const message = (to) => ({ to, subject: 's', text: 't', html: '<p>h</p>' });
const day1 = new Date('2026-10-09T10:00:00Z');
const day2 = new Date('2026-10-10T00:05:00Z');

const repository = new MemoryRepository();
await repository.init();

await check('Brevo first, until its daily allowance is used', async () => {
  assert.equal(await sendEmail(repository, message('a@x.example'), day1), 'brevo');
  assert.equal(await sendEmail(repository, message('b@x.example'), day1), 'brevo');
  assert.equal(sent[0].body.sender.email, 'codes@figmark.example');
});

await check('then Mailjet', async () => {
  assert.equal(await sendEmail(repository, message('c@x.example'), day1), 'mailjet');
  assert.equal(sent.at(-1).body.Messages[0].To[0].Email, 'c@x.example');
});

await check('a quota refusal skips the provider for the rest of the day, before its count says so', async () => {
  behaviour.mailjet = 'quota';
  assert.equal(await sendEmail(repository, message('d@x.example'), day1), 'resend');
  behaviour.mailjet = 'ok';
  // Mailjet has one slot left by our count, but said it is full: still skipped.
  assert.equal(await sendEmail(repository, message('e@x.example'), day1), 'resend');
  assert.equal(sent.at(-1).body.from, 'Figmark <codes@mail.figmark.example>', "Resend's own sender");
});

await check('the refused send was not counted against the provider', async () => {
  const usage = await emailUsage(repository, day1);
  const mailjet = usage.find((entry) => entry.name === 'mailjet');
  assert.equal(mailjet.today, 1);
  assert.match(mailjet.exhaustedToday, /limit/);
});

await check('with every free tier spent, the send is refused rather than lost silently', async () => {
  await assert.rejects(sendEmail(repository, message('f@x.example'), day1), (err) => err instanceof EmailUnavailableError);
});

await check('the next day (UTC) starts again with Brevo', async () => {
  assert.equal(await sendEmail(repository, message('g@x.example'), day2), 'brevo');
  const usage = await emailUsage(repository, day2);
  assert.deepEqual(usage.map((entry) => entry.today), [1, 0, 0]);
  assert.equal(usage.find((entry) => entry.name === 'mailjet').exhaustedToday, null);
});

await check('an outage moves on for that email without taking the provider out for the day', async () => {
  behaviour.brevo = 'down';
  assert.equal(await sendEmail(repository, message('h@x.example'), day2), 'mailjet');
  behaviour.brevo = 'ok';
  assert.equal(await sendEmail(repository, message('i@x.example'), day2), 'brevo');
});

await check('monthly allowances carry across days and reset with the month', async () => {
  const usage = await emailUsage(repository, day2);
  const mailjet = usage.find((entry) => entry.name === 'mailjet');
  assert.equal(mailjet.thisMonth, 2, 'one on each day');
  assert.equal(mailjet.monthlyLimit, 6000);
  const nextMonth = await emailUsage(repository, new Date('2026-11-01T00:00:00Z'));
  assert.ok(nextMonth.every((entry) => entry.thisMonth === 0));
});

await check('parallel sends never take more than the allowance', async () => {
  const fresh = new MemoryRepository();
  await fresh.init();
  const day = new Date('2026-12-01T09:00:00Z');
  const results = await Promise.all(['1', '2', '3', '4', '5', '6'].map((n) => sendEmail(fresh, message(`${n}@p.example`), day)));
  const per = (name) => results.filter((entry) => entry === name).length;
  assert.deepEqual([per('brevo'), per('mailjet'), per('resend')], [2, 2, 2]);
});

console.log(`\n${passed} email checks passed`);
