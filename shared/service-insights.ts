import type { AddressValue, ServiceRequest } from './service-work.js';
import { answerFor, requestDueMinor } from './service-work.js';

/**
 * What a forwarder's or artist's own work says about the business: how many
 * ask and how many go ahead, how fast the team answers, which routes and
 * products bring the money, who comes back, and how it moves week to week.
 *
 * Computed from the requests alone, on read - nothing is stored twice. Money
 * is what the team confirmed it received: customers pay a store directly, so
 * that is the only figure anybody can stand behind.
 */

export interface InsightRow { label: string; count: number; minor: number }

export interface StoreInsights {
  totals: { requests: number; quoted: number; accepted: number; paid: number; delivered: number; declined: number; cancelled: number; links: number };
  money: { confirmedMinor: number; thisMonthMinor: number; lastMonthMinor: number; averageOrderMinor: number };
  speed: { quoteHours: number | null; deliveryDays: number | null };
  weeks: { start: string; requests: number; minor: number }[];
  subjects: InsightRow[];
  products: InsightRow[];
  extras: InsightRow[];
  places: InsightRow[];
  customers: { total: number; repeat: number; newThisMonth: number; top: { name: string; handle: string | null; count: number; minor: number }[] };
  ratings: { average: number | null; count: number; stars: [number, number, number, number, number] };
  kgBilled: number;
}

const DAY = 86_400_000;
const WEEKS = 12;

const reachedQuote = (row: ServiceRequest) => row.quoteMinor !== null || row.origin === 'link';
const reachedAccept = (row: ServiceRequest) => ['accepted', 'paid', 'received', 'in_progress', 'shipped', 'delivered'].includes(row.status);
const paidMinor = (row: ServiceRequest) => (row.payment?.confirmedAt ? (row.payment.amountMinor || requestDueMinor(row)) : 0);

/** Monday of the week a moment falls in, as a date. */
function weekStart(at: number): number {
  const day = new Date(at);
  day.setUTCHours(0, 0, 0, 0);
  return day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY;
}

function top(map: Map<string, InsightRow>, limit: number): InsightRow[] {
  return [...map.values()].sort((a, b) => b.count - a.count || b.minor - a.minor).slice(0, limit);
}

function add(map: Map<string, InsightRow>, label: string, minor: number) {
  const row = map.get(label) ?? { label, count: 0, minor: 0 };
  row.count += 1;
  row.minor += minor;
  map.set(label, row);
}

export function insightsOf(rows: readonly ServiceRequest[], now = Date.now()): StoreInsights {
  const monthStart = new Date(now);
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const lastMonthStart = new Date(monthStart);
  lastMonthStart.setUTCMonth(lastMonthStart.getUTCMonth() - 1);

  const firstWeek = weekStart(now) - (WEEKS - 1) * 7 * DAY;
  const weeks = Array.from({ length: WEEKS }, (_, index) => ({ start: new Date(firstWeek + index * 7 * DAY).toISOString().slice(0, 10), requests: 0, minor: 0 }));
  const subjects = new Map<string, InsightRow>();
  const products = new Map<string, InsightRow>();
  const extras = new Map<string, InsightRow>();
  const places = new Map<string, InsightRow>();
  const people = new Map<string, { name: string; handle: string | null; count: number; minor: number; first: number }>();
  const stars: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  const quoteHours: number[] = [];
  const deliveryDays: number[] = [];
  let confirmed = 0; let thisMonth = 0; let lastMonth = 0; let paidCount = 0; let kg = 0;

  for (const row of rows) {
    const created = Date.parse(row.createdAt);
    const money = paidMinor(row);
    const paidAt = row.payment?.confirmedAt ? Date.parse(row.payment.confirmedAt) : null;
    if (money) {
      confirmed += money;
      paidCount += 1;
      if (paidAt! >= monthStart.getTime()) thisMonth += money;
      else if (paidAt! >= lastMonthStart.getTime()) lastMonth += money;
    }
    const week = Math.floor((weekStart(created) - firstWeek) / (7 * DAY));
    if (week >= 0 && week < WEEKS) weeks[week]!.requests += 1;
    if (paidAt) {
      const paidWeek = Math.floor((weekStart(paidAt) - firstWeek) / (7 * DAY));
      if (paidWeek >= 0 && paidWeek < WEEKS) weeks[paidWeek]!.minor += money;
    }

    add(subjects, row.subject?.label ?? row.title ?? 'Other', money);
    if (row.option) add(products, row.option.name, money);
    for (const extra of row.addons ?? []) add(extras, extra.name, extra.priceMinor);
    if (row.chargeableKg && reachedAccept(row)) kg += row.chargeableKg;

    const address = answerFor<AddressValue>(row.fields, row.answers, row.kind === 'forwarder' ? 'delivery' : 'return_delivery');
    const city = address?.city?.trim();
    if (city) add(places, city.replace(/\b\w/g, (letter) => letter.toUpperCase()), money);

    if (row.customerId) {
      const person = people.get(row.customerId) ?? { name: row.customerName, handle: row.customerHandle, count: 0, minor: 0, first: created };
      person.count += 1;
      person.minor += money;
      person.first = Math.min(person.first, created);
      people.set(row.customerId, person);
    }
    if (row.review) {
      const at = Math.min(5, Math.max(1, row.review.stars)) - 1;
      stars[at] = (stars[at] ?? 0) + 1;
    }

    // How long the team took to quote, and to finish.
    if (row.origin === 'form') {
      const quoted = row.history.find((event) => event.status === 'quoted' || event.note.startsWith('Quoted'));
      if (quoted) quoteHours.push((Date.parse(quoted.at) - created) / 3_600_000);
    }
    const delivered = row.history.find((event) => event.status === 'delivered' || /^(Delivered|Confirmed it arrived|Done)/.test(event.note));
    if (row.status === 'delivered' && delivered) deliveryDays.push((Date.parse(delivered.at) - created) / DAY);
  }

  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const rated = stars.reduce((sum, count) => sum + count, 0);
  const everyone = [...people.values()];
  const round = (value: number | null, places = 1) => (value === null ? null : Math.round(value * 10 ** places) / 10 ** places);

  return {
    totals: {
      requests: rows.filter((row) => row.origin === 'form').length,
      links: rows.filter((row) => row.origin === 'link').length,
      quoted: rows.filter(reachedQuote).length,
      accepted: rows.filter(reachedAccept).length,
      paid: rows.filter((row) => row.payment?.confirmedAt).length,
      delivered: rows.filter((row) => row.status === 'delivered').length,
      declined: rows.filter((row) => row.status === 'declined').length,
      cancelled: rows.filter((row) => row.status === 'cancelled').length,
    },
    money: { confirmedMinor: confirmed, thisMonthMinor: thisMonth, lastMonthMinor: lastMonth, averageOrderMinor: paidCount ? Math.round(confirmed / paidCount) : 0 },
    speed: { quoteHours: round(mean(quoteHours)), deliveryDays: round(mean(deliveryDays)) },
    weeks,
    subjects: top(subjects, 6),
    products: top(products, 6),
    extras: top(extras, 6),
    places: top(places, 6),
    customers: {
      total: everyone.length,
      repeat: everyone.filter((person) => person.count > 1).length,
      newThisMonth: everyone.filter((person) => person.first >= monthStart.getTime()).length,
      top: everyone.sort((a, b) => b.minor - a.minor || b.count - a.count).slice(0, 5)
        .map(({ name, handle, count, minor }) => ({ name, handle, count, minor })),
    },
    ratings: { average: rated ? round(stars.reduce((sum, count, index) => sum + count * (index + 1), 0) / rated) : null, count: rated, stars },
    kgBilled: Math.round(kg * 10) / 10,
  };
}
