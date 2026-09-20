# Node Description Batch 36 of 55

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
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "shared_preorder_stateof": "stateOf()" | kind=code-symbol | source=shared/preorder.ts:L40 | neighbors=[preorder.ts, PreOrderView]
- "shared_routes_hastriggers": "hasTriggers()" | kind=code-symbol | source=shared/routes.ts:L179 | neighbors=[routes.ts, itemStepOn()]
- "shared_routes_presteps": "preSteps()" | kind=code-symbol | source=shared/routes.ts:L120 | neighbors=[ShopPage.tsx, routes.ts]
- "shared_routes_route_presets": "ROUTE_PRESETS" | kind=code-symbol | source=shared/routes.ts:L309 | neighbors=[tracking-routes.ts, routes.ts]
- "shared_routes_stepstateat": "stepStateAt()" | kind=code-symbol | source=shared/routes.ts:L523 | neighbors=[Ladder.tsx, routes.ts]
- "shared_routes_suggested_steps": "SUGGESTED_STEPS" | kind=code-symbol | source=shared/routes.ts:L398 | neighbors=[tracking-routes.ts, routes.ts]
- "shared_routes_triggeredstep": "triggeredStep()" | kind=code-symbol | source=shared/routes.ts:L170 | neighbors=[routes.ts, itemStepOn()]
- "shared_services_crew_checkpoints": "CREW_CHECKPOINTS" | kind=code-symbol | source=shared/services.ts:L206 | neighbors=[ServicesPage.tsx, services.ts]
- "shared_services_crewrole": "CrewRole" | kind=code-symbol | source=shared/services.ts:L164 | neighbors=[fulfilment-routes.ts, services.ts]
- "shared_services_crewroleof": "crewRoleOf()" | kind=code-symbol | source=shared/services.ts:L173 | neighbors=[services.ts, supplierIdOf()]
- "shared_services_entry_note": "ENTRY_NOTE" | kind=code-symbol | source=shared/services.ts:L131 | neighbors=[ServicesPage.tsx, services.ts]
- "shared_services_maytick": "mayTick()" | kind=code-symbol | source=shared/services.ts:L211 | neighbors=[fulfilment-routes.ts, services.ts]
- "shared_services_servicemeta": "ServiceMeta" | kind=code-symbol | source=shared/services.ts:L39 | neighbors=[services.ts, api.ts]
- "shared_services_servicesof": "servicesOf()" | kind=code-symbol | source=shared/services.ts:L155 | neighbors=[service-routes.ts, services.ts]
- "shared_stores_expandpermissions": "expandPermissions()" | kind=code-symbol | source=shared/stores.ts:L33 | neighbors=[stores.ts, permissionsFor()]
- "shared_stores_managerentry": "managerEntry()" | kind=code-symbol | source=shared/stores.ts:L76 | neighbors=[seller-routes.ts, stores.ts]
- "shared_templates_fillfrom": "fillFrom()" | kind=code-symbol | source=shared/templates.ts:L114 | neighbors=[SellPage.tsx, templates.ts]
- "shared_templates_journeyof": "journeyOf()" | kind=code-symbol | source=shared/templates.ts:L130 | neighbors=[templates.ts, preLotRouteOf()]
- "src_api_appnotification": "AppNotification" | kind=code-symbol | source=app/src/api.ts:L572 | neighbors=[Notifications.tsx, api.ts]
- "src_api_boardcustomer": "BoardCustomer" | kind=code-symbol | source=app/src/api.ts:L909 | neighbors=[LotPeople.tsx, api.ts]
- "src_api_candidateitem": "CandidateItem" | kind=code-symbol | source=app/src/api.ts:L781 | neighbors=[LotsPage.tsx, api.ts]
- "src_api_channelrow": "ChannelRow" | kind=code-symbol | source=app/src/api.ts:L511 | neighbors=[SocialPage.tsx, api.ts]
- "src_api_channelthread": "ChannelThread" | kind=code-symbol | source=app/src/api.ts:L524 | neighbors=[SocialPage.tsx, api.ts]
- "src_api_checkout": "Checkout" | kind=code-symbol | source=app/src/api.ts:L301 | neighbors=[OrderPage.tsx, api.ts]
- "src_api_consignmentrow": "ConsignmentRow" | kind=code-symbol | source=app/src/api.ts:L716 | neighbors=[ServicesPage.tsx, api.ts]
- "src_api_credit": "Credit" | kind=code-symbol | source=app/src/api.ts:L271 | neighbors=[ProfileByHandlePage.tsx, api.ts]
- "src_api_dashboardresponse": "DashboardResponse" | kind=code-symbol | source=app/src/api.ts:L602 | neighbors=[ShopPage.tsx, api.ts]
- "src_api_directoryforwarder": "DirectoryForwarder" | kind=code-symbol | source=app/src/api.ts:L168 | neighbors=[ForwardersPage.tsx, api.ts]
- "src_api_disputeview": "DisputeView" | kind=code-symbol | source=app/src/api.ts:L420 | neighbors=[DisputePage.tsx, api.ts]
- "src_api_distributionlot": "DistributionLot" | kind=code-symbol | source=app/src/api.ts:L740 | neighbors=[ServicesPage.tsx, api.ts]
- "src_api_distributionrow": "DistributionRow" | kind=code-symbol | source=app/src/api.ts:L731 | neighbors=[ServicesPage.tsx, api.ts]
- "src_api_escrowholding": "EscrowHolding" | kind=code-symbol | source=app/src/api.ts:L409 | neighbors=[EscrowPage.tsx, api.ts]
- "src_api_escrowoption": "EscrowOption" | kind=code-symbol | source=app/src/api.ts:L284 | neighbors=[OrderPage.tsx, api.ts]
- "src_api_feedresponse": "FeedResponse" | kind=code-symbol | source=app/src/api.ts:L118 | neighbors=[FeedPage.tsx, api.ts]
- "src_api_forumsresponse": "ForumsResponse" | kind=code-symbol | source=app/src/api.ts:L594 | neighbors=[SocialPage.tsx, api.ts]
- "src_api_inbox": "Inbox" | kind=code-symbol | source=app/src/api.ts:L939 | neighbors=[MessagesPage.tsx, api.ts]
- "src_api_insightsresponse": "InsightsResponse" | kind=code-symbol | source=app/src/api.ts:L638 | neighbors=[ShopPage.tsx, api.ts]
- "src_api_itemgroup": "ItemGroup" | kind=code-symbol | source=app/src/api.ts:L835 | neighbors=[ProfilePage.tsx, api.ts]
- "src_api_listingdetail": "ListingDetail" | kind=code-symbol | source=app/src/api.ts:L146 | neighbors=[ListingPage.tsx, api.ts]
- "src_api_lotcontents": "LotContents" | kind=code-symbol | source=app/src/api.ts:L187 | neighbors=[LotsPage.tsx, api.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-035.json

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
