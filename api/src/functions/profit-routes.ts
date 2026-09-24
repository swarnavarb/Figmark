import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  BASIS_LABELS, COST_STAGES, KIND_LABELS, starterLines,
  type CostBasis, type CostKind, type CostLine, type CostStage, type ProfitTemplate,
} from '../../../shared/profit.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';
import { shopFor } from './insight-routes.js';

/**
 * The profit calculator's cost sheets (Pro).
 *
 * The sums run in the browser, off `@shared/profit`, so typing a price never
 * waits on the network. The server only keeps the sheets, and reads them for
 * whoever may read the shop's numbers - the same right as Insights, because a
 * shop's costs say more about it than its revenue does.
 */

const MAX_TEMPLATES = 20;
const MAX_LINES = 60;

const clampNumber = (value: unknown, min: number, max: number, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

/** One line as the client sent it, made safe to keep. */
function cleanLine(raw: Partial<CostLine>, index: number): CostLine {
  const kind: CostKind = raw.kind && raw.kind in KIND_LABELS ? raw.kind : 'per_item';
  const basis: CostBasis = raw.basis && raw.basis in BASIS_LABELS ? raw.basis : 'item';
  const stage: CostStage = COST_STAGES.includes(raw.stage as CostStage) ? (raw.stage as CostStage) : 'selling';
  return {
    id: typeof raw.id === 'string' && /^[\w-]{1,40}$/.test(raw.id) ? raw.id : `line_${index}_${randomUUID().slice(0, 6)}`,
    label: (typeof raw.label === 'string' ? raw.label.trim() : '').slice(0, 80) || 'Cost',
    stage,
    kind,
    amount: clampNumber(raw.amount, 0, 1e9),
    currency: raw.currency === 'foreign' ? 'foreign' : 'INR',
    ...(kind === 'percent' ? { basis, basisLineId: basis === 'line' ? String(raw.basisLineId ?? '') : null } : {}),
    ...(kind === 'per_kg'
      ? { minKg: clampNumber(raw.minKg, 0, 10_000), stepKg: clampNumber(raw.stepKg, 0, 100), volumetric: Boolean(raw.volumetric) }
      : {}),
    enabled: Boolean(raw.enabled),
  };
}

async function load(request: HttpRequest) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const shopId = await shopFor(request, repository, user);
  const shop = shopId ? await repository.getUserById(shopId) : null;
  return { repository, shop };
}

/** GET /api/me/profit-templates - this shop's cost sheets, plus a blank one to start from. */
async function listProfitTemplates(request: HttpRequest, _context: InvocationContext) {
  const { shop } = await load(request);
  if (!shop) return error(403, 'forbidden', 'You cannot read the costs for that shop.');
  return json(200, { templates: shop.profitTemplates ?? [], starter: starterLines() });
}

/** POST /api/me/profit-templates - write one, or correct one. */
async function saveProfitTemplate(request: HttpRequest, _context: InvocationContext) {
  const { repository, shop } = await load(request);
  if (!shop) return error(403, 'forbidden', 'You cannot change the costs for that shop.');

  let body: Partial<ProfitTemplate>;
  try {
    body = (await request.json()) as Partial<ProfitTemplate>;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const name = body.name?.trim().slice(0, 60);
  if (!name) return error(400, 'invalid_template', 'Give the calculator a name.');
  if (!Array.isArray(body.lines) || body.lines.length > MAX_LINES) {
    return error(400, 'invalid_template', `A calculator holds up to ${MAX_LINES} cost lines.`);
  }

  const templates = [...(shop.profitTemplates ?? [])];
  const index = body.id ? templates.findIndex((entry) => entry.id === body.id) : -1;
  if (body.id && index < 0) return error(404, 'not_found', 'No such calculator.');
  if (index < 0 && templates.length >= MAX_TEMPLATES) {
    return error(400, 'too_many', `Keep up to ${MAX_TEMPLATES} calculators - delete one you no longer use.`);
  }

  const now = new Date().toISOString();
  const existing = index >= 0 ? templates[index] : undefined;
  const lines = body.lines.map((line, at) => cleanLine(line, at));
  // A percentage of another line may only lean on one before it - the sums
  // run top to bottom, and a line further down has no value yet.
  for (const [at, line] of lines.entries()) {
    if (line.kind === 'percent' && line.basis === 'line' && !lines.slice(0, at).some((prior) => prior.id === line.basisLineId)) {
      return error(400, 'invalid_template', `"${line.label}" is a percentage of a line that does not come before it.`);
    }
  }

  const template: ProfitTemplate = {
    id: existing?.id ?? `pt_${randomUUID().slice(0, 10)}`,
    name,
    currency: (body.currency ?? 'USD').toString().trim().toUpperCase().slice(0, 6) || 'USD',
    rate: clampNumber(body.rate, 0, 1e6),
    volumetricDivisor: clampNumber(body.volumetricDivisor, 1, 100_000, 5000),
    targetMarginPercent: clampNumber(body.targetMarginPercent, 0, 95, 25),
    isDefault: Boolean(body.isDefault) || templates.length === 0 || (templates.length === 1 && index === 0),
    lines,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (index >= 0) templates[index] = template;
  else templates.push(template);
  // One default, and always one.
  if (template.isDefault) for (const entry of templates) entry.isDefault = entry.id === template.id;

  await repository.updateUser({ ...shop, profitTemplates: templates, updatedAt: now });
  return json(index >= 0 ? 200 : 201, { template, templates });
}

/** POST /api/me/profit-templates/{id}/delete - drop one. */
async function deleteProfitTemplate(request: HttpRequest, _context: InvocationContext) {
  const { repository, shop } = await load(request);
  if (!shop) return error(403, 'forbidden', 'You cannot change the costs for that shop.');
  const id = request.params.id;
  const templates = (shop.profitTemplates ?? []).filter((entry) => entry.id !== id);
  if (templates.length === (shop.profitTemplates ?? []).length) return error(404, 'not_found', 'No such calculator.');
  if (templates.length > 0 && !templates.some((entry) => entry.isDefault)) templates[0]!.isDefault = true;
  await repository.updateUser({ ...shop, profitTemplates: templates, updatedAt: new Date().toISOString() });
  return json(200, { templates });
}

export const listProfitTemplatesRoute = handler(listProfitTemplates);
export const saveProfitTemplateRoute = handler(saveProfitTemplate);
export const deleteProfitTemplateRoute = handler(deleteProfitTemplate);

app.http('me-profit-templates', {
  authLevel: 'anonymous',
  methods: ['GET'],
  route: 'me/profit-templates',
  handler: listProfitTemplatesRoute,
});

app.http('me-profit-templates-save', {
  authLevel: 'anonymous',
  methods: ['POST'],
  route: 'me/profit-templates/save',
  handler: saveProfitTemplateRoute,
});

app.http('me-profit-templates-delete', {
  authLevel: 'anonymous',
  methods: ['POST'],
  route: 'me/profit-templates/{id}/delete',
  handler: deleteProfitTemplateRoute,
});
