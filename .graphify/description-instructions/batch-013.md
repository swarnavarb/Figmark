# Node Description Batch 14 of 55

Graphify is running in assistant/skill mode (no API key). You are the host
assistant (Claude Code / Codex / Gemini CLI). Read the prompt below and write
your JSON answer to the answer file.

## Prompt

You are documenting nodes in a knowledge graph.
For each entry below, write ONE concise factual plain-language sentence
describing what it is or does. Use only the provided context.
For a code symbol (kind=code-symbol — a function, class, or constant),
describe what the function/symbol does based on its name, source location
and neighbors — e.g. "Resolves the configured ontology profile from graphify.yaml.".
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "shared_models_like": "Like" | kind=code-symbol | source=shared/models.ts:L554 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, models.ts, BaseDocument]
- "shared_models_sellerpaymentdetails": "SellerPaymentDetails" | kind=code-symbol | source=shared/models.ts:L240 | neighbors=[order-routes.ts, OrderPage.tsx, ShopPage.tsx, models.ts, api.ts]
- "shared_models_sellertrustsignals": "SellerTrustSignals" | kind=code-symbol | source=shared/models.ts:L80 | neighbors=[api.ts, seed.ts, contracts.ts, models.ts, TrustSignals]
- "shared_models_trustsignals": "TrustSignals" | kind=code-symbol | source=shared/models.ts:L64 | neighbors=[api.ts, seed.ts, contracts.ts, models.ts, SellerTrustSignals]
- "shared_models_wantseeker": "WantSeeker" | kind=code-symbol | source=shared/models.ts:L1171 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, models.ts, BaseDocument]
- "shared_orders_actionsfor": "actionsFor()" | kind=code-symbol | source=shared/orders.ts:L77 | neighbors=[dispute-routes.ts, order-routes.ts, ProfilePage.tsx, orders.ts, sideOf()]
- "shared_orders_sideof": "sideOf()" | kind=code-symbol | source=shared/orders.ts:L50 | neighbors=[dispute-routes.ts, order-routes.ts, disputes.ts, orders.ts, actionsFor()]
- "shared_parties_sellerref": "sellerRef()" | kind=code-symbol | source=shared/parties.ts:L24 | neighbors=[dispute-routes.ts, order-routes.ts, social-routes.ts, want-routes.ts, parties.ts]
- "shared_posts": "posts.ts" | kind=code-symbol | source=shared/posts.ts:L1 | neighbors=[27d0f52 Announcements are a choice the …, SocialPage.tsx, models.ts, Post, isAnnouncement()]
- "shared_preorder_preorderview": "PreOrderView" | kind=code-symbol | source=shared/preorder.ts:L17 | neighbors=[preorder.ts, FeedPage.tsx, preorder.ts, stateOf(), api.ts]
- "shared_routes_atselleryet": "atSellerYet()" | kind=code-symbol | source=shared/routes.ts:L543 | neighbors=[fulfilment-routes.ts, routes.ts, coarseStage(), currentStepOf(), routeOf()]
- "shared_routes_built_in_route": "BUILT_IN_ROUTE" | kind=code-symbol | source=shared/routes.ts:L273 | neighbors=[fulfilment-routes.ts, tracking-routes.ts, ShopPage.tsx, routes.ts, templates.ts]
- "shared_routes_currentstepname": "currentStepName()" | kind=code-symbol | source=shared/routes.ts:L535 | neighbors=[ShopPage.tsx, routes.ts, currentStepOf(), lotOffset(), routeOf()]
- "shared_routes_lotroute": "LotRoute" | kind=code-symbol | source=shared/routes.ts:L231 | neighbors=[fulfilment-routes.ts, tracking-routes.ts, models.ts, routes.ts, templates.ts]
- "shared_routes_normalisesteps": "normaliseSteps()" | kind=code-symbol | source=shared/routes.ts:L435 | neighbors=[catalog-routes.ts, fulfilment-routes.ts, template-routes.ts, tracking-routes.ts, routes.ts]
- "shared_routes_stepforstage": "stepForStage()" | kind=code-symbol | source=shared/routes.ts:L513 | neighbors=[Ladder.tsx, fulfilment-routes.ts, tracking-routes.ts, routes.ts, coarseStage()]
- "shared_routes_stepside": "StepSide" | kind=code-symbol | source=shared/routes.ts:L39 | neighbors=[RouteBuilder.tsx, fulfilment-routes.ts, tracking-routes.ts, routes.ts, api.ts]
- "shared_services_supplieridof": "supplierIdOf()" | kind=code-symbol | source=shared/services.ts:L188 | neighbors=[fulfilment-routes.ts, service-routes.ts, ShopPage.tsx, services.ts, crewRoleOf()]
- "shared_stores_storeaccess": "StoreAccess" | kind=code-symbol | source=shared/stores.ts:L16 | neighbors=[seller-routes.ts, ShopPage.tsx, SocialPage.tsx, stores.ts, api.ts]
- "src_api_lotboard": "LotBoard" | kind=code-symbol | source=app/src/api.ts:L921 | neighbors=[LotPeople.tsx, LotBoardPage.tsx, LotsPage.tsx, ShopPage.tsx, api.ts]
- "src_format_brandhuefor": "brandHueFor()" | kind=code-symbol | source=app/src/format.ts:L97 | neighbors=[FillMeter.tsx, ui.tsx, ProfileByHandlePage.tsx, format.ts, hash32()]
- "admin_api_admin": "admin" | kind=code-symbol | source=app/src/admin/api.ts:L106 | neighbors=[api.ts, DisputesView.tsx, main.tsx, UsersView.tsx]
- "admin_confirm": "Confirm.tsx" | kind=code-symbol | source=app/src/admin/Confirm.tsx:L1 | neighbors=[Confirm(), DisputesView.tsx, UsersView.tsx, f1b6577 An operations console, escrow a…]
- "auth_mock_provider_readtokens": "readTokens()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L358 | neighbors=[mock-provider.ts, .getCurrentUser(), .requireAuth(), readToken()]
- "auth_types_authservice": "AuthService" | kind=code-symbol | source=api/src/auth/types.ts:L21 | neighbors=[index.ts, mock-provider.ts, swa-provider.ts, types.ts]
- "commit:repo:github.com/swarnavarb/Figmark@119ed59f796acfdb6372af13016aca3a4b900e28": "119ed59 Add Emil Kowalski's design and animation skills" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, d51b9a6 Add the design-taste-frontend s…, a5a184e Orders, Track, and the statione…]
- "commit:repo:github.com/swarnavarb/Figmark@d51b9a69710ad737ba62fddb344e3e3767adb01d": "d51b9a6 Add the design-taste-frontend skill" | kind=Commit | source=git | neighbors=[119ed59 Add Emil Kowalski's design and …, claude/figmark-connection-icpfax, claude/new-session-13ackt, 0f35535 Add the Impeccable design skill]
- "components_categoryicon": "CategoryIcon.tsx" | kind=code-symbol | source=app/src/components/CategoryIcon.tsx:L1 | neighbors=[8cf0d9b Give Figmark a vibrant colour i…, CategoryIcon(), MARKS, FeedPage.tsx]
- "data_cosmos_repository_cosmosrepository_countsigninaccounts": ".countSignInAccounts()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L513 | neighbors=[CosmosRepository, .container(), .init(), .runMaintenance()]
- "data_cosmos_repository_cosmosrepository_getforum": ".getForum()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1282 | neighbors=[CosmosRepository, .createPost(), .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_getuserbyidentifier": ".getUserByIdentifier()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L605 | neighbors=[CosmosRepository, .container(), .getUserById(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_listallusers": ".listAllUsers()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L943 | neighbors=[CosmosRepository, .backfillHandles(), .container(), .repair()]
- "data_cosmos_repository_cosmosrepository_seedfixtures": ".seedFixtures()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L530 | neighbors=[CosmosRepository, .fill(), .repair(), .container()]
- "data_cosmos_repository_cosmosrepository_topupfixtures": ".topUpFixtures()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L432 | neighbors=[CosmosRepository, .runMaintenance(), .existingIds(), .getUserById()]
- "data_cosmos_repository_describeerror": "describeError()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1721 | neighbors=[cosmos-repository.ts, .ensureContainers(), .init(), .runMaintenance()]
- "data_memory_repository_memoryrepository_init": ".init()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L78 | neighbors=[MemoryRepository, followKey(), likeKey(), .indexUser()]
- "data_repository_backendstatus": "BackendStatus" | kind=code-symbol | source=api/src/data/repository.ts:L9 | neighbors=[cosmos-repository.ts, index.ts, memory-repository.ts, repository.ts]
- "data_repository_catalogquery": "CatalogQuery" | kind=code-symbol | source=api/src/data/repository.ts:L34 | neighbors=[cosmos-repository.ts, index.ts, memory-repository.ts, repository.ts]
- "data_seed_seedcomments": "seedComments()" | kind=code-symbol | source=api/src/data/seed.ts:L1003 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]
- "data_seed_seeddisputes": "seedDisputes()" | kind=code-symbol | source=api/src/data/seed.ts:L950 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts, iso()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-013.json

Keep each description factual and concise (one sentence). No markdown, no prose
outside the JSON object. It is acceptable to omit a node if context is
insufficient — but include every node you can ground confidently.

Example answer format:
```json
{
  "node_id_1": "Resolves the configured ontology profile from graphify.yaml.",
  "node_id_2": "Colonel James Barclay, an antagonist in The Crooked Man."
}
```
