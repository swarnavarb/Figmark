import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { directPaused } from '../../../shared/billing.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { audited } from '../audit.js';
import { loadPricing } from '../billing.js';
import { cancelReport, decideFlag, statsFor } from '../cancel-watch.js';
import { tooFast } from '../rate-limit.js';
import { error, handler, json } from './http.js';

/**
 * Sellers who cancel too often:
 *
 * - `GET /api/me/cancels` - the seller's own rate, the limit, and any flag.
 * - `POST /api/me/cancels/appeal` - asking the operators to lift the pause.
 * - `GET /api/ops/cancels`, `POST /api/ops/cancels/{id}/decide` - the console.
 */

const anon = { authLevel: 'anonymous' } as const;

async function readBody<T>(request: HttpRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

async function mine(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const [account, stats, pricing] = await Promise.all([
    repository.getUserById(user.id), statsFor(repository, user.id), loadPricing(repository),
  ]);
  return json(200, {
    stats,
    limit: pricing.cancels,
    flag: account?.cancelFlag ?? null,
    directPaused: directPaused(account?.cancelFlag),
  });
}

async function appeal(request: HttpRequest, _context: InvocationContext) {
  const user = await (await getAuthService()).requireAuth(request);
  const repository = await getRepository();
  const slow = await tooFast(user.id, 'billing');
  if (slow) return slow;
  const input = await readBody<{ text?: unknown }>(request);
  const text = typeof input?.text === 'string' ? input.text.trim().slice(0, 1_000) : '';
  if (text.length < 10) return error(400, 'too_short', 'Say what happened, in a sentence or two.');
  const account = await repository.getUserById(user.id);
  const flag = account?.cancelFlag;
  if (!account || !flag || flag.status === 'cleared') return error(409, 'not_flagged', 'There is nothing to appeal.');
  if (flag.status === 'appealed') return error(409, 'already_appealed', 'Your appeal is with the Figmark team already.');
  const at = new Date().toISOString();
  const next = { ...flag, status: 'appealed' as const, appeal: { text, at } };
  await repository.updateUser({ ...account, cancelFlag: next });
  // Lands at the top of the console's Cancellations list, appeals first.
  return json(200, { flag: next });
}

async function operator(request: HttpRequest) {
  return (await getAuthService()).requireCapability(request, ['admin']);
}

async function opsList(request: HttpRequest, _context: InvocationContext) {
  await operator(request);
  const repository = await getRepository();
  const [rows, pricing] = await Promise.all([cancelReport(repository), loadPricing(repository)]);
  return json(200, { rows, limit: pricing.cancels });
}

async function opsDecide(request: HttpRequest, _context: InvocationContext) {
  const user = await operator(request);
  const repository = await getRepository();
  const seller = await repository.getUserById(request.params.id ?? '');
  if (!seller) return error(404, 'not_found', 'No such seller.');
  const input = await readBody<{ decision?: unknown; note?: unknown }>(request);
  const decision = input?.decision;
  if (decision !== 'clear' && decision !== 'keep' && decision !== 'pause') return error(400, 'invalid_request', 'Clear, keep or pause.');
  const note = typeof input?.note === 'string' && input.note.trim() ? input.note.trim().slice(0, 300) : null;
  const flag = await decideFlag(repository, seller, decision, user.displayName ?? user.email, note);
  return json(200, { flag });
}

export const myCancelsRoute = handler(mine);
export const cancelAppealRoute = handler(appeal);
export const opsCancelsRoute = handler(opsList);
export const opsCancelDecideRoute = audited('cancels.decide', handler(opsDecide));

app.http('my-cancels', { ...anon, methods: ['GET'], route: 'me/cancels', handler: myCancelsRoute });
app.http('my-cancels-appeal', { ...anon, methods: ['POST'], route: 'me/cancels/appeal', handler: cancelAppealRoute });
app.http('ops-cancels', { ...anon, methods: ['GET'], route: 'ops/cancels', handler: opsCancelsRoute });
app.http('ops-cancels-decide', { ...anon, methods: ['POST'], route: 'ops/cancels/{id}/decide', handler: opsCancelDecideRoute });
