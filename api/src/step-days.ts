/**
 * The step and delivery times the system works out (shared/step-days.ts),
 * read from the store.
 *
 * A shop's own numbers come from its own lots and orders, read when asked and
 * kept for a few minutes. The market's come from every shop and are kept for
 * hours: they move slowly, and reading every shop's history on each request
 * would grow with the whole platform.
 */
import {
  deliverySpans, mergeStepRanges, pickRange, startingImportRange, stepSpans, type ShopDays,
} from '../../shared/step-days.js';
import type { Sourcing } from '../../shared/enums.js';
import type { getRepository } from './data/index.js';

type Repo = Awaited<ReturnType<typeof getRepository>>;

interface Spans {
  steps: Map<string, number[]>;
  delivery: Record<Sourcing, number[]>;
}

const SHOP_TTL_MS = 5 * 60_000;
const MARKET_TTL_MS = 6 * 3_600_000;

const shops = new Map<string, { at: number; work: Promise<Spans> }>();
let market: { at: number; work: Promise<Spans> } | null = null;

async function spansOf(repository: Repo, sellerId: string): Promise<Spans> {
  const [lots, orders] = await Promise.all([
    repository.listLots({ sellerId }),
    repository.listOrdersForSeller(sellerId),
  ]);
  return {
    // A lot's moves and an item's own buttons are both a step reached.
    steps: stepSpans([...lots.map((lot) => lot.stageHistory), ...orders.map((order) => order.stageHistory)]),
    delivery: deliverySpans(orders),
  };
}

function cached(slot: { at: number; work: Promise<Spans> } | null | undefined, ttl: number): Promise<Spans> | null {
  return slot && Date.now() - slot.at < ttl ? slot.work : null;
}

function shopSpans(repository: Repo, sellerId: string): Promise<Spans> {
  const hit = cached(shops.get(sellerId), SHOP_TTL_MS);
  if (hit) return hit;
  const work = spansOf(repository, sellerId);
  shops.set(sellerId, { at: Date.now(), work });
  work.catch(() => shops.delete(sellerId));
  return work;
}

function marketSpans(repository: Repo): Promise<Spans> {
  const hit = cached(market, MARKET_TTL_MS);
  if (hit) return hit;
  const work = (async () => {
    const users = await repository.listAllUsers();
    const steps = new Map<string, number[]>();
    const delivery = { in_hand: [], import: [] } as unknown as Record<Sourcing, number[]>;
    for (const user of users) {
      if (!user.sellerProfile) continue;
      const one = await spansOf(repository, user.id).catch(() => null);
      if (!one) continue;
      for (const [key, list] of one.steps) steps.set(key, [...(steps.get(key) ?? []), ...list]);
      for (const [kind, list] of Object.entries(one.delivery) as [Sourcing, number[]][]) {
        delivery[kind] = [...(delivery[kind] ?? []), ...list];
      }
    }
    return { steps, delivery };
  })();
  market = { at: Date.now(), work };
  work.catch(() => { market = null; });
  return work;
}

/** Every step this shop's routes could show, and its delivery times, each its own or the market's. */
export async function shopDays(repository: Repo, sellerId: string): Promise<ShopDays> {
  const [own, all] = await Promise.all([shopSpans(repository, sellerId), marketSpans(repository)]);
  const delivery: ShopDays['delivery'] = {};
  for (const kind of ['in_hand', 'import'] as Sourcing[]) {
    const range = pickRange(own.delivery[kind], all.delivery[kind]);
    if (range) delivery[kind] = range;
  }
  // Until real imports have been delivered, the trade's own quote stands in.
  delivery.import ??= startingImportRange();
  return { steps: mergeStepRanges(own.steps, all.steps), delivery };
}
