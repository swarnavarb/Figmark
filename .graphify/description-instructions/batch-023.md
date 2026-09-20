# Node Description Batch 24 of 55

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

- "shared_board_lottally": "LotTally" | kind=code-symbol | source=shared/board.ts:L24 | neighbors=[ShopPage.tsx, board.ts, api.ts]
- "shared_capabilities_derivecapabilities": "deriveCapabilities()" | kind=code-symbol | source=shared/capabilities.ts:L31 | neighbors=[mock-provider.ts, capabilities.ts, isTransactable()]
- "shared_catalog_matchessearch": "matchesSearch()" | kind=code-symbol | source=shared/catalog.ts:L181 | neighbors=[cosmos-repository.ts, memory-repository.ts, catalog.ts]
- "shared_contracts_apierror": "ApiError" | kind=code-symbol | source=shared/contracts.ts:L145 | neighbors=[http.ts, contracts.ts, api.ts]
- "shared_contracts_meresponse": "MeResponse" | kind=code-symbol | source=shared/contracts.ts:L84 | neighbors=[auth-routes.ts, contracts.ts, api.ts]
- "shared_contracts_signuprequest": "SignupRequest" | kind=code-symbol | source=shared/contracts.ts:L66 | neighbors=[mock-provider.ts, auth-routes.ts, contracts.ts]
- "shared_disputes_disputeactionsfor": "disputeActionsFor()" | kind=code-symbol | source=shared/disputes.ts:L52 | neighbors=[dispute-routes.ts, disputes.ts, responseOverdue()]
- "shared_disputes_reasonsfor": "reasonsFor()" | kind=code-symbol | source=shared/disputes.ts:L33 | neighbors=[dispute-routes.ts, OrderPage.tsx, disputes.ts]
- "shared_disputes_responseoverdue": "responseOverdue()" | kind=code-symbol | source=shared/disputes.ts:L40 | neighbors=[dispute-routes.ts, disputes.ts, disputeActionsFor()]
- "shared_enums_checkpoint_count_labels": "CHECKPOINT_COUNT_LABELS" | kind=code-symbol | source=shared/enums.ts:L285 | neighbors=[ServicesPage.tsx, ShopPage.tsx, enums.ts]
- "shared_enums_sourcing_labels": "SOURCING_LABELS" | kind=code-symbol | source=shared/enums.ts:L52 | neighbors=[FeedPage.tsx, SellPage.tsx, enums.ts]
- "shared_fulfilment_furtheststage": "furthestStage()" | kind=code-symbol | source=shared/fulfilment.ts:L89 | neighbors=[fulfilment-routes.ts, fulfilment.ts, stagesFor()]
- "shared_fulfilment_kindof": "kindOf()" | kind=code-symbol | source=shared/fulfilment.ts:L135 | neighbors=[Ladder.tsx, fulfilment.ts, isLotEvent()]
- "shared_fulfilment_labelfor": "labelFor()" | kind=code-symbol | source=shared/fulfilment.ts:L64 | neighbors=[OrderPage.tsx, ProfilePage.tsx, fulfilment.ts]
- "shared_fulfilment_sourcingof": "sourcingOf()" | kind=code-symbol | source=shared/fulfilment.ts:L123 | neighbors=[catalog-routes.ts, FeedPage.tsx, fulfilment.ts]
- "shared_handles_handlekey": "handleKey()" | kind=code-symbol | source=shared/handles.ts:L12 | neighbors=[cosmos-repository.ts, memory-repository.ts, handles.ts]
- "shared_insights_checkpointprogress": "checkpointProgress()" | kind=code-symbol | source=shared/insights.ts:L228 | neighbors=[insight-routes.ts, insights.ts, ticked()]
- "shared_insights_groupbybuyer": "groupByBuyer()" | kind=code-symbol | source=shared/insights.ts:L132 | neighbors=[insight-routes.ts, insights.ts, packingEstimate()]
- "shared_insights_phaseofcounts": "phaseOfCounts()" | kind=code-symbol | source=shared/insights.ts:L271 | neighbors=[ShopPage.tsx, insights.ts, phaseOf()]
- "shared_insights_segments": "SEGMENTS" | kind=code-symbol | source=shared/insights.ts:L145 | neighbors=[insight-routes.ts, ShopPage.tsx, insights.ts]
- "shared_insights_ticked": "ticked()" | kind=code-symbol | source=shared/insights.ts:L38 | neighbors=[insights.ts, checkpointProgress(), timingsOf()]
- "shared_insights_timings": "Timings" | kind=code-symbol | source=shared/insights.ts:L155 | neighbors=[insight-routes.ts, insights.ts, api.ts]
- "shared_insights_timingsof": "timingsOf()" | kind=code-symbol | source=shared/insights.ts:L165 | neighbors=[insight-routes.ts, insights.ts, ticked()]
- "shared_models_forwarderprofile": "ForwarderProfile" | kind=code-symbol | source=shared/models.ts:L301 | neighbors=[contracts.ts, models.ts, api.ts]
- "shared_models_powersaleitem": "PowerSaleItem" | kind=code-symbol | source=shared/models.ts:L1287 | neighbors=[power-sale.ts, power-sale-routes.ts, models.ts]
- "shared_models_preorder": "PreOrder" | kind=code-symbol | source=shared/models.ts:L476 | neighbors=[preorder.ts, models.ts, preorder.ts]
- "shared_orders_reviewrevealed": "reviewRevealed()" | kind=code-symbol | source=shared/orders.ts:L133 | neighbors=[order-routes.ts, profile-routes.ts, orders.ts]
- "shared_orders_scorefrom": "scoreFrom()" | kind=code-symbol | source=shared/orders.ts:L150 | neighbors=[order-routes.ts, profile-routes.ts, orders.ts]
- "shared_routes_stepid": "stepId()" | kind=code-symbol | source=shared/routes.ts:L425 | neighbors=[RouteBuilder.tsx, tracking-routes.ts, routes.ts]
- "shared_routes_suggestlotname": "suggestLotName()" | kind=code-symbol | source=shared/routes.ts:L598 | neighbors=[LotsPage.tsx, ShopPage.tsx, routes.ts]
- "shared_services_service_order": "SERVICE_ORDER" | kind=code-symbol | source=shared/services.ts:L128 | neighbors=[service-routes.ts, ServicesPage.tsx, services.ts]
- "shared_services_services": "SERVICES" | kind=code-symbol | source=shared/services.ts:L62 | neighbors=[service-routes.ts, ServicesPage.tsx, services.ts]
- "src_api_activityresponse": "ActivityResponse" | kind=code-symbol | source=app/src/api.ts:L158 | neighbors=[ProfilePage.tsx, ShopPage.tsx, api.ts]
- "src_api_evidencedraft": "EvidenceDraft" | kind=code-symbol | source=app/src/api.ts:L27 | neighbors=[DisputePage.tsx, OrderPage.tsx, api.ts]
- "src_api_feedlisting": "FeedListing" | kind=code-symbol | source=app/src/api.ts:L111 | neighbors=[FeedPage.tsx, api.ts, Listing]
- "src_api_lotdetails": "LotDetails" | kind=code-symbol | source=app/src/api.ts:L490 | neighbors=[LotFields.tsx, LotsPage.tsx, api.ts]
- "src_api_lotsresponse": "LotsResponse" | kind=code-symbol | source=app/src/api.ts:L181 | neighbors=[LotsPage.tsx, ShopPage.tsx, api.ts]
- "src_api_lotsummary": "LotSummary" | kind=code-symbol | source=app/src/api.ts:L170 | neighbors=[OrderPage.tsx, ShopPage.tsx, api.ts]
- "src_api_partyref": "PartyRef" | kind=code-symbol | source=app/src/api.ts:L21 | neighbors=[DisputePage.tsx, ShopPage.tsx, api.ts]
- "src_api_photodraft": "PhotoDraft" | kind=code-symbol | source=app/src/api.ts:L862 | neighbors=[PhotoManager.tsx, SellPage.tsx, api.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-023.json

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
