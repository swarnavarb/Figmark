import { randomUUID } from 'node:crypto';
import { app, type HttpRequest, type InvocationContext } from '@azure/functions';
import {
  BUILT_IN_KITS, DEFAULT_KIT_IDS, SAMPLE_FLOWS, builtInKit, isBuiltInKit, normaliseKitButtons, snapshotOf,
  type ButtonKit, type FlowDoc, type KitButton, type KitSnapshot, type KitStage, type RouteFlow,
} from '../../../shared/flows.js';
import { getAuthService } from '../auth/index.js';
import { getRepository } from '../data/index.js';
import { error, handler, json } from './http.js';

/**
 * Flows and the button kits they are built from.
 *
 * A flow is "items before lot → in a lot → after a lot": two kits and a
 * route. The route half lives in tracking-routes and is untouched by this
 * module; the kits are the buttons an item shows on either side of it.
 */

type Repo = Awaited<ReturnType<typeof getRepository>>;

const kitsOf = (docs: FlowDoc[]) => docs.filter((doc): doc is ButtonKit => doc.kind === 'kit');
const flowsOf = (docs: FlowDoc[]) => docs.filter((doc): doc is RouteFlow => doc.kind === 'flow');

/** A kit by id: one of the shop's own, or a built-in one. */
export function findKit(docs: FlowDoc[], id: string | null | undefined): ButtonKit | undefined {
  if (!id) return undefined;
  return builtInKit(id) ?? kitsOf(docs).find((kit) => kit.id === id);
}

/**
 * The kit a stage falls back to: a kit of the shop's own marked default, else
 * whatever the default flow snapped into that end (a built-in kit cannot be
 * marked, so this is how one becomes the default), else the built-in one.
 */
export function defaultKit(docs: FlowDoc[], stage: KitStage): ButtonKit {
  const own = kitsOf(docs).find((kit) => kit.stage === stage && kit.isDefault);
  if (own) return own;
  const flow = flowsOf(docs).find((entry) => entry.isDefault);
  const fromFlow = findKit(docs, stage === 'before' ? flow?.beforeKitId : flow?.afterKitId);
  return fromFlow && fromFlow.stage === stage ? fromFlow : builtInKit(DEFAULT_KIT_IDS[stage])!;
}

/**
 * The after-lot buttons a lot's items show.
 *
 * The flow wired to the lot's route says which - its default flow first, if
 * more than one flow uses the route - and with no flow at all, the shop's
 * default last-mile kit.
 */
export async function afterKitFor(repository: Repo, sellerId: string, routeId: string | null): Promise<KitSnapshot> {
  const docs = await repository.listFlowDocs(sellerId);
  const wired = flowsOf(docs).filter((flow) => routeId && flow.routeId === routeId && flow.afterKitId);
  const flow = wired.find((entry) => entry.isDefault) ?? wired[0];
  const kit = findKit(docs, flow?.afterKitId) ?? defaultKit(docs, 'after');
  return snapshotOf(kit);
}

/** The before-lot kit a new listing gets: the one asked for, else the shop's default. */
export async function beforeKitFor(repository: Repo, sellerId: string, kitId: string | null | undefined): Promise<ButtonKit> {
  const docs = await repository.listFlowDocs(sellerId);
  const asked = findKit(docs, kitId);
  return asked && asked.stage === 'before' ? asked : defaultKit(docs, 'before');
}

/** GET /api/flows - the shop's kits and flows, the built-in kits, and samples. */
async function listFlows(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const repository = await getRepository();
  const docs = await repository.listFlowDocs(user.id);
  return json(200, {
    kits: kitsOf(docs),
    flows: flowsOf(docs),
    builtInKits: BUILT_IN_KITS,
    samples: SAMPLE_FLOWS,
    defaults: {
      before: defaultKit(docs, 'before').id,
      after: defaultKit(docs, 'after').id,
    },
  });
}

/**
 * Only one default per stage (kits) or per shop (flows): setting one clears
 * the flag everywhere else, so "the default" always names exactly one thing.
 */
async function clearDefaults(repository: Repo, docs: FlowDoc[], keep: string, match: (doc: FlowDoc) => boolean) {
  const stale = docs.filter((doc) => doc.id !== keep && doc.isDefault && match(doc));
  await Promise.all(stale.map((doc) => repository.saveFlowDoc({ ...doc, isDefault: false })));
}

interface KitBody {
  id?: string;
  stage?: KitStage;
  name?: string;
  buttons?: Partial<KitButton>[];
  isDefault?: boolean;
}

/** POST /api/flows/kits - save a kit of buttons, new or edited. */
async function saveKit(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: KitBody;
  try {
    body = (await request.json()) as KitBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const stage = body.stage === 'after' ? 'after' : body.stage === 'before' ? 'before' : null;
  if (!stage) return error(400, 'invalid_kit', 'Say which end of the journey this kit is for.');
  const name = body.name?.trim().slice(0, 60);
  if (!name) return error(400, 'invalid_kit', 'Give the kit a name.');
  const buttons = normaliseKitButtons(stage, body.buttons);
  if (buttons.length === 0) return error(400, 'invalid_kit', 'A kit needs at least one button.');

  const repository = await getRepository();
  const docs = await repository.listFlowDocs(user.id);
  const now = new Date().toISOString();
  // A built-in kit is never written to: editing one saves the shop's own copy.
  const existing = body.id && !isBuiltInKit(body.id)
    ? kitsOf(docs).find((kit) => kit.id === body.id)
    : undefined;
  if (body.id && !isBuiltInKit(body.id) && !existing) return error(404, 'not_found', 'No such kit.');

  const kit: ButtonKit = existing
    ? { ...existing, stage, name, buttons, isDefault: body.isDefault ?? existing.isDefault, updatedAt: now }
    : {
        id: `kit_${randomUUID().slice(0, 12)}`,
        kind: 'kit',
        sellerId: user.id,
        stage,
        name,
        buttons,
        isDefault: body.isDefault === true,
        createdAt: now,
        updatedAt: now,
      };
  const saved = await repository.saveFlowDoc(kit);
  if (kit.isDefault) {
    await clearDefaults(repository, docs, kit.id, (doc) => doc.kind === 'kit' && doc.stage === stage);
  }
  return json(existing ? 200 : 201, { kit: saved });
}

interface FlowBody {
  id?: string;
  name?: string;
  beforeKitId?: string | null;
  routeId?: string | null;
  afterKitId?: string | null;
  isDefault?: boolean;
}

/** POST /api/flows - wire two kits and a route into a flow. */
async function saveFlow(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);

  let body: FlowBody;
  try {
    body = (await request.json()) as FlowBody;
  } catch {
    return error(400, 'invalid_body', 'Request body must be JSON.');
  }
  const name = body.name?.trim().slice(0, 60);
  if (!name) return error(400, 'invalid_flow', 'Give the flow a name.');

  const repository = await getRepository();
  const docs = await repository.listFlowDocs(user.id);
  /* Every piece has to be one this shop can actually use: its own, or built in. */
  const before = body.beforeKitId ? findKit(docs, body.beforeKitId) : undefined;
  if (body.beforeKitId && before?.stage !== 'before') return error(400, 'invalid_flow', 'Pick a before-the-lot kit.');
  const after = body.afterKitId ? findKit(docs, body.afterKitId) : undefined;
  if (body.afterKitId && after?.stage !== 'after') return error(400, 'invalid_flow', 'Pick an after-the-lot kit.');
  if (body.routeId && !(await repository.getRoute(user.id, body.routeId))) {
    return error(400, 'invalid_flow', 'That route is not one of yours.');
  }
  if (!body.beforeKitId && !body.routeId && !body.afterKitId) {
    return error(400, 'invalid_flow', 'Snap at least one piece into the flow.');
  }

  const now = new Date().toISOString();
  const existing = body.id ? flowsOf(docs).find((flow) => flow.id === body.id) : undefined;
  if (body.id && !existing) return error(404, 'not_found', 'No such flow.');
  const flow: RouteFlow = {
    ...(existing ?? {
      id: `flw_${randomUUID().slice(0, 12)}`,
      kind: 'flow' as const,
      sellerId: user.id,
      createdAt: now,
    }),
    name,
    beforeKitId: body.beforeKitId ?? null,
    routeId: body.routeId ?? null,
    afterKitId: body.afterKitId ?? null,
    isDefault: body.isDefault ?? existing?.isDefault ?? false,
    updatedAt: now,
  };
  const saved = await repository.saveFlowDoc(flow);
  if (flow.isDefault) {
    await clearDefaults(repository, docs, flow.id, (doc) => doc.kind === 'flow');
    /* The default flow's ends become the shop's default kits, which is what
       "applied to the items by default" means: the next item listed gets
       this flow's before-the-lot buttons without being asked twice. */
    for (const kit of [before, after]) {
      if (kit && !isBuiltInKit(kit.id) && !kit.isDefault) {
        await repository.saveFlowDoc({ ...kit, isDefault: true, updatedAt: now });
        await clearDefaults(repository, docs, kit.id, (doc) => doc.kind === 'kit' && doc.stage === kit.stage);
      } else if (kit && isBuiltInKit(kit.id)) {
        // A built-in kit is the default when no kit of the shop's own claims it.
        await clearDefaults(repository, docs, kit.id, (doc) => doc.kind === 'kit' && doc.stage === kit.stage);
      }
    }
  }
  return json(existing ? 200 : 201, { flow: saved });
}

/** POST /api/flows/{id}/delete - a kit or a flow. Items keep the copy they carry. */
async function deleteFlowDoc(request: HttpRequest, _context: InvocationContext) {
  const auth = await getAuthService();
  const user = await auth.requireCapability(request, ['sell']);
  const id = request.params.id;
  if (!id) return error(400, 'invalid_request', 'An id is required.');
  if (isBuiltInKit(id)) return error(400, 'built_in', 'The built-in kits stay. Make your own and set it as the default.');
  const repository = await getRepository();
  const gone = await repository.deleteFlowDoc(user.id, id);
  if (!gone) return error(404, 'not_found', 'Nothing by that id.');
  return json(200, { deleted: id });
}

export const listFlowsRoute = handler(listFlows);
export const saveKitRoute = handler(saveKit);
export const saveFlowRoute = handler(saveFlow);
export const deleteFlowDocRoute = handler(deleteFlowDoc);

const anon = { authLevel: 'anonymous' } as const;

app.http('flows-list', { ...anon, methods: ['GET'], route: 'flows', handler: listFlowsRoute });
app.http('flows-save', { ...anon, methods: ['POST'], route: 'flows/new', handler: saveFlowRoute });
app.http('flows-kit-save', { ...anon, methods: ['POST'], route: 'flows/kits/new', handler: saveKitRoute });
app.http('flows-delete', { ...anon, methods: ['POST'], route: 'flows/{id}/delete', handler: deleteFlowDocRoute });
