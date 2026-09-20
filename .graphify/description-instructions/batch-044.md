# Node Description Batch 45 of 55

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

- "functions_power_sale_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/power-sale-routes.ts:L28 | neighbors=[power-sale-routes.ts]
- "functions_preorder_preordermember": "PreOrderMember" | kind=code-symbol | source=api/src/functions/preorder.ts:L30 | neighbors=[preorder.ts]
- "functions_preorder_preorderroster": "PreOrderRoster" | kind=code-symbol | source=api/src/functions/preorder.ts:L50 | neighbors=[preorder.ts]
- "functions_preorder_repo": "Repo" | kind=code-symbol | source=api/src/functions/preorder.ts:L7 | neighbors=[preorder.ts]
- "functions_preorder_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L131 | neighbors=[preorder-routes.ts]
- "functions_preorder_routes_preorderpledgeroute": "preOrderPledgeRoute" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L129 | neighbors=[preorder-routes.ts]
- "functions_preorder_routes_preorderreadroute": "preOrderReadRoute" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L128 | neighbors=[preorder-routes.ts]
- "functions_preorder_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/preorder-routes.ts:L20 | neighbors=[preorder-routes.ts]
- "functions_profile_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L309 | neighbors=[profile-routes.ts]
- "functions_profile_routes_creditroute": "creditRoute" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L303 | neighbors=[profile-routes.ts]
- "functions_profile_routes_pagereviews": "pageReviews()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L121 | neighbors=[profile-routes.ts]
- "functions_profile_routes_pagereviewsroute": "pageReviewsRoute" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L305 | neighbors=[profile-routes.ts]
- "functions_profile_routes_repo": "Repo" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L27 | neighbors=[profile-routes.ts]
- "functions_profile_routes_saveprofile": "saveProfile()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L267 | neighbors=[profile-routes.ts]
- "functions_profile_routes_saveprofileroute": "saveProfileRoute" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L304 | neighbors=[profile-routes.ts]
- "functions_profile_routes_tradereviewsroute": "tradeReviewsRoute" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L307 | neighbors=[profile-routes.ts]
- "functions_profile_routes_writepagereview": "writePageReview()" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L154 | neighbors=[profile-routes.ts]
- "functions_profile_routes_writepagereviewroute": "writePageReviewRoute" | kind=code-symbol | source=api/src/functions/profile-routes.ts:L306 | neighbors=[profile-routes.ts]
- "functions_seller_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L495 | neighbors=[seller-routes.ts]
- "functions_seller_routes_dashboard": "dashboard()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L197 | neighbors=[seller-routes.ts]
- "functions_seller_routes_dashboardroute": "dashboardRoute" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L492 | neighbors=[seller-routes.ts]
- "functions_seller_routes_getstorefront": "getStorefront()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L54 | neighbors=[seller-routes.ts]
- "functions_seller_routes_mystores": "myStores()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L410 | neighbors=[seller-routes.ts]
- "functions_seller_routes_mystoresroute": "myStoresRoute" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L488 | neighbors=[seller-routes.ts]
- "functions_seller_routes_sales": "sales()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L294 | neighbors=[seller-routes.ts]
- "functions_seller_routes_salesroute": "salesRoute" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L493 | neighbors=[seller-routes.ts]
- "functions_seller_routes_storefrontroute": "storefrontRoute" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L490 | neighbors=[seller-routes.ts]
- "functions_seller_routes_updatemanagers": "updateManagers()" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L442 | neighbors=[seller-routes.ts]
- "functions_seller_routes_updatemanagersroute": "updateManagersRoute" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L489 | neighbors=[seller-routes.ts]
- "functions_seller_routes_updatestorefrontroute": "updateStorefrontRoute" | kind=code-symbol | source=api/src/functions/seller-routes.ts:L491 | neighbors=[seller-routes.ts]
- "functions_service_routes_anon": "anon" | kind=code-symbol | source=api/src/functions/service-routes.ts:L468 | neighbors=[service-routes.ts]
- "functions_service_routes_consignmentsroute": "consignmentsRoute" | kind=code-symbol | source=api/src/functions/service-routes.ts:L464 | neighbors=[service-routes.ts]
- "functions_service_routes_distributiondetailroute": "distributionDetailRoute" | kind=code-symbol | source=api/src/functions/service-routes.ts:L466 | neighbors=[service-routes.ts]
- "functions_service_routes_distributionroute": "distributionRoute" | kind=code-symbol | source=api/src/functions/service-routes.ts:L465 | neighbors=[service-routes.ts]
- "functions_service_routes_escrowcard": "escrowCard()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L77 | neighbors=[service-routes.ts]
- "functions_service_routes_forwardercard": "forwarderCard()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L46 | neighbors=[service-routes.ts]
- "functions_service_routes_handlercard": "handlerCard()" | kind=code-symbol | source=api/src/functions/service-routes.ts:L63 | neighbors=[service-routes.ts]
- "functions_service_routes_listingbody": "ListingBody" | kind=code-symbol | source=api/src/functions/service-routes.ts:L193 | neighbors=[service-routes.ts]
- "functions_service_routes_offerserviceroute": "offerServiceRoute" | kind=code-symbol | source=api/src/functions/service-routes.ts:L463 | neighbors=[service-routes.ts]
- "functions_service_routes_providercard": "ProviderCard" | kind=code-symbol | source=api/src/functions/service-routes.ts:L33 | neighbors=[service-routes.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-044.json

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
