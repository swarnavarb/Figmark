# Node Description Batch 28 of 55

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

- "data_memory_repository_memoryrepository_deleteuser": ".deleteUser()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L679 | neighbors=[MemoryRepository, identifiersOf()]
- "data_memory_repository_memoryrepository_getuserbyidentifier": ".getUserByIdentifier()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L124 | neighbors=[MemoryRepository, normaliseIdentifier()]
- "data_memory_repository_memoryrepository_togglefollow": ".toggleFollow()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L434 | neighbors=[MemoryRepository, followKey()]
- "data_memory_repository_memoryrepository_togglelike": ".toggleLike()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L417 | neighbors=[MemoryRepository, likeKey()]
- "data_memory_repository_memoryrepository_updateuser": ".updateUser()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L457 | neighbors=[MemoryRepository, .indexUser()]
- "data_seed_soon": "soon()" | kind=code-symbol | source=api/src/data/seed.ts:L78 | neighbors=[seed.ts, seedReviews()]
- "functions_admin_routes_deleteresource": "deleteResource()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L217 | neighbors=[admin-routes.ts, operator()]
- "functions_admin_routes_disputes": "disputes()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L312 | neighbors=[admin-routes.ts, operator()]
- "functions_admin_routes_resolvedispute": "resolveDispute()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L355 | neighbors=[admin-routes.ts, operator()]
- "functions_admin_routes_users": "users()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L66 | neighbors=[admin-routes.ts, operator()]
- "functions_catalog_routes_feed": "feed()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L39 | neighbors=[catalog-routes.ts, numeric()]
- "functions_catalog_routes_listingdetail": "listingDetail()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L86 | neighbors=[catalog-routes.ts, toSellerCard()]
- "functions_catalog_routes_numeric": "numeric()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L578 | neighbors=[catalog-routes.ts, feed()]
- "functions_catalog_routes_tosellercard": "toSellerCard()" | kind=code-symbol | source=api/src/functions/catalog-routes.ts:L16 | neighbors=[catalog-routes.ts, listingDetail()]
- "functions_dispute_routes_read": "read()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L305 | neighbors=[dispute-routes.ts, ownDispute()]
- "functions_fulfilment_routes_advancestage": "advanceStage()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L466 | neighbors=[fulfilment-routes.ts, ownedLot()]
- "functions_fulfilment_routes_assigntolot": "assignToLot()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L435 | neighbors=[fulfilment-routes.ts, ownedLot()]
- "functions_fulfilment_routes_createlot": "createLot()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L322 | neighbors=[fulfilment-routes.ts, buildLot()]
- "functions_fulfilment_routes_findexportstorefor": "findExportStoreFor()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1073 | neighbors=[fulfilment-routes.ts, supplierLot()]
- "functions_fulfilment_routes_lotboard": "lotBoard()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L820 | neighbors=[fulfilment-routes.ts, lotsStoreFor()]
- "functions_fulfilment_routes_lotcontents": "lotContents()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L351 | neighbors=[fulfilment-routes.ts, ownedLot()]
- "functions_fulfilment_routes_lotsboard": "lotsBoard()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L777 | neighbors=[fulfilment-routes.ts, lotsStoreFor()]
- "functions_fulfilment_routes_mylots": "myLots()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L130 | neighbors=[fulfilment-routes.ts, lotsStoreFor()]
- "functions_fulfilment_routes_newlotbody": "NewLotBody" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L179 | neighbors=[fulfilment-routes.ts, template-routes.ts]
- "functions_fulfilment_routes_setcheckpoint": "setCheckpoint()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L886 | neighbors=[fulfilment-routes.ts, lotsStoreFor()]
- "functions_fulfilment_routes_setcrew": "setCrew()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L592 | neighbors=[fulfilment-routes.ts, ownedLot()]
- "functions_fulfilment_routes_settracking": "setTracking()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L549 | neighbors=[fulfilment-routes.ts, ownedLot()]
- "functions_fulfilment_routes_supplierlot": "supplierLot()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L1033 | neighbors=[fulfilment-routes.ts, findExportStoreFor()]
- "functions_fulfilment_routes_userforhandle": "userForHandle()" | kind=code-symbol | source=api/src/functions/fulfilment-routes.ts:L71 | neighbors=[fulfilment-routes.ts, updateLotDetails()]
- "functions_http_storestatus": "storeStatus()" | kind=code-symbol | source=api/src/functions/http.ts:L34 | neighbors=[http.ts, toErrorResponse()]
- "functions_insight_routes_names": "names()" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L48 | neighbors=[insight-routes.ts, insights()]
- "functions_insight_routes_shaped": "shaped()" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L66 | neighbors=[insight-routes.ts, insights()]
- "functions_insight_routes_shopfor": "shopFor()" | kind=code-symbol | source=api/src/functions/insight-routes.ts:L34 | neighbors=[insight-routes.ts, insights()]
- "functions_message_routes_inbox": "inbox()" | kind=code-symbol | source=api/src/functions/message-routes.ts:L108 | neighbors=[message-routes.ts, handlesFor()]
- "functions_order_routes_hasanydetail": "hasAnyDetail()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L259 | neighbors=[order-routes.ts, checkout()]
- "functions_order_routes_rescore": "rescore()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L444 | neighbors=[order-routes.ts, review()]
- "functions_order_routes_suggestescrow": "suggestEscrow()" | kind=code-symbol | source=api/src/functions/order-routes.ts:L309 | neighbors=[order-routes.ts, checkout()]
- "functions_power_sale_finishesat": "finishesAt()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L121 | neighbors=[power-sale.ts, power-sale-routes.ts]
- "functions_power_sale_listingfor": "listingFor()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L71 | neighbors=[power-sale.ts, advancePowerSale()]
- "functions_power_sale_releaseitems": "releaseItems()" | kind=code-symbol | source=api/src/functions/power-sale.ts:L254 | neighbors=[power-sale.ts, power-sale-routes.ts]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-027.json

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
