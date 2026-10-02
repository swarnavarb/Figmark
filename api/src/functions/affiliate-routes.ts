import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import { affiliateCommissionMinor, affiliateStatus, affiliateUnitMinor } from '../../../shared/affiliate.js';
import type { Order } from '../../../shared/models.js';
import { rupees } from '../../../shared/payments.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { notify } from './notify.js';

/**
 * GET /api/me/affiliate - every commission this person's links have earned.
 *
 * Read from the orders themselves, so whether a commission is pending,
 * earned or void is always what happened to the sale and never a copy that
 * could fall behind it.
 */
async function myAffiliate(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const account = await repository.getUserById(user.id);
  const ids = account?.affiliateOrderIds ?? [];

  const orders = (await Promise.all(ids.map((id) => repository.getOrder(id))))
    .filter((order): order is Order => Boolean(order && order.affiliate?.referrerId === user.id));
  const sellers = await repository.listUsersByIds([...new Set(orders.map((order) => order.sellerId))]);
  const shopName = new Map(sellers.map((seller) => [seller.id, seller.sellerProfile?.storefrontName ?? seller.displayName]));

  const earnings = orders
    .map((order) => ({
      orderId: order.id,
      listingId: order.listingId,
      itemName: order.itemName,
      sellerName: shopName.get(order.sellerId) ?? 'A shop',
      unitMinor: affiliateUnitMinor(order.affiliate, order.unitPriceMinor),
      quantity: order.quantity,
      saleMinor: order.unitPriceMinor * order.quantity,
      commissionMinor: affiliateCommissionMinor(order),
      currency: order.currency,
      status: affiliateStatus(order),
      placedAt: order.placedAt ?? order.createdAt,
      paidAt: order.affiliate?.paidAt ?? null,
      paidReference: order.affiliate?.paidReference ?? null,
    }))
    .sort((a, b) => (b.placedAt ?? '').localeCompare(a.placedAt ?? ''));
  return json(200, { earnings });
}

/**
 * POST /api/orders/{id}/affiliate-paid - the shop says it paid the commission.
 *
 * Only once the item is delivered: until then the sale can still fall through,
 * and a commission paid on a cancelled order is money the shop has to chase.
 */
async function markAffiliatePaid(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireAuth(request);
  const repository = await getRepository();
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'An order id is required.');
  const order = await repository.getOrder(id);
  if (!order || order.sellerId !== user.id) return error(404, 'not_found', 'No such order.');
  if (!order.affiliate) return error(409, 'no_affiliate', 'Nobody earns a commission on this order.');

  const status = affiliateStatus(order);
  if (status === 'paid') return json(200, { order });
  if (status !== 'earned') {
    return error(409, 'not_earned', status === 'void'
      ? 'This order was called off, so no commission is owed.'
      : 'The commission is owed once the item is delivered.');
  }

  let body: { reference?: string } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    /* no body is fine */
  }
  const now = new Date().toISOString();
  order.affiliate = { ...order.affiliate, paidAt: now, paidReference: body.reference?.trim().slice(0, 80) || null };
  order.updatedAt = now;
  await repository.updateOrder(order);

  await notify(repository, [order.affiliate.referrerId], {
    kind: 'order_placed',
    title: `Commission paid — ${rupees(affiliateCommissionMinor(order))}`,
    body: `For ${order.itemName}.`,
    link: '/wallet?tab=earnings',
  });
  return json(200, { order });
}

export const myAffiliateRoute = handler(myAffiliate);
export const markAffiliatePaidRoute = handler(markAffiliatePaid);

const anon = { authLevel: 'anonymous' } as const;
app.http('me-affiliate', { ...anon, methods: ['GET'], route: 'me/affiliate', handler: myAffiliateRoute });
app.http('order-affiliate-paid', { ...anon, methods: ['POST'], route: 'orders/{id}/affiliate-paid', handler: markAffiliatePaidRoute });
