# Node Description Batch 19 of 55

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

- "components_lotpeople_lotpeople": "LotPeople()" | kind=code-symbol | source=app/src/components/LotPeople.tsx:L26 | neighbors=[LotPeople.tsx, LotBoardPage.tsx, LotsPage.tsx]
- "components_routebuilder_routebuilder": "RouteBuilder()" | kind=code-symbol | source=app/src/components/RouteBuilder.tsx:L25 | neighbors=[RouteBuilder.tsx, LotsPage.tsx, RoutesPage.tsx]
- "components_ui_tile": "Tile()" | kind=code-symbol | source=app/src/components/ui.tsx:L146 | neighbors=[ui.tsx, ShopPage.tsx, SupplierPage.tsx]
- "data_cosmos_repository_cosmosrepository_assignlistingstolot": ".assignListingsToLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1481 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_bumplisting": ".bumpListing()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1443 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_createorder": ".createOrder()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1554 | neighbors=[CosmosRepository, .container(), .getListing()]
- "data_cosmos_repository_cosmosrepository_createpost": ".createPost()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1260 | neighbors=[CosmosRepository, .container(), .getForum()]
- "data_cosmos_repository_cosmosrepository_createuser": ".createUser()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L620 | neighbors=[CosmosRepository, .container(), isConflict()]
- "data_cosmos_repository_cosmosrepository_deletepledge": ".deletePledge()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1066 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_deleteuser": ".deleteUser()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1159 | neighbors=[CosmosRepository, .container(), .getUserById()]
- "data_cosmos_repository_cosmosrepository_ensurecontainers": ".ensureContainers()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L208 | neighbors=[CosmosRepository, describeError(), .init()]
- "data_cosmos_repository_cosmosrepository_fill": ".fill()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L365 | neighbors=[CosmosRepository, .seedFixtures(), .init()]
- "data_cosmos_repository_cosmosrepository_getbyhandle": ".getByHandle()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L786 | neighbors=[CosmosRepository, .getUserById(), .readReservation()]
- "data_cosmos_repository_cosmosrepository_getlisting": ".getListing()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1428 | neighbors=[CosmosRepository, .createOrder(), .container()]
- "data_cosmos_repository_cosmosrepository_getlot": ".getLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1337 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_getpowersale": ".getPowerSale()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1101 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_issessionrevoked": ".isSessionRevoked()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1322 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_listlistings": ".listListings()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1365 | neighbors=[CosmosRepository, catalogOrder(), .container()]
- "data_cosmos_repository_cosmosrepository_listmessages": ".listMessages()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L813 | neighbors=[CosmosRepository, .container(), .markThreadRead()]
- "data_cosmos_repository_cosmosrepository_markthreadread": ".markThreadRead()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1192 | neighbors=[CosmosRepository, .container(), .listMessages()]
- "data_cosmos_repository_cosmosrepository_querybyseller": ".queryBySeller()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1649 | neighbors=[CosmosRepository, .listLots(), .container()]
- "data_cosmos_repository_cosmosrepository_togglefollow": ".toggleFollow()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1619 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_togglelike": ".toggleLike()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1599 | neighbors=[CosmosRepository, .container(), isNotFound()]
- "data_cosmos_repository_cosmosrepository_updateuser": ".updateUser()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L781 | neighbors=[CosmosRepository, .backfillHandles(), .container()]
- "data_cosmos_repository_isconflict": "isConflict()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1701 | neighbors=[cosmos-repository.ts, .createUser(), .reserveHandle()]
- "data_memory_repository_followkey": "followKey()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L788 | neighbors=[memory-repository.ts, .init(), .toggleFollow()]
- "data_memory_repository_likekey": "likeKey()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L787 | neighbors=[memory-repository.ts, .init(), .toggleLike()]
- "data_memory_repository_memoryrepository_createuser": ".createUser()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L129 | neighbors=[MemoryRepository, identifiersOf(), .indexUser()]
- "data_memory_repository_normaliseidentifier": "normaliseIdentifier()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L776 | neighbors=[cosmos-repository.ts, memory-repository.ts, .getUserByIdentifier()]
- "data_repository_sessiondigest": "sessionDigest()" | kind=code-symbol | source=api/src/data/repository.ts:L335 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts]
- "data_seed_seedlistings": "seedListings()" | kind=code-symbol | source=api/src/data/seed.ts:L560 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts]
- "data_seed_seedlotbuyers": "seedLotBuyers()" | kind=code-symbol | source=api/src/data/seed.ts:L1201 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts]
- "data_seed_seedposts": "seedPosts()" | kind=code-symbol | source=api/src/data/seed.ts:L1151 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts]
- "data_seed_seedwants": "seedWants()" | kind=code-symbol | source=api/src/data/seed.ts:L855 | neighbors=[cosmos-repository.ts, memory-repository.ts, seed.ts]
- "data_seed_withescrow": "withEscrow()" | kind=code-symbol | source=api/src/data/seed.ts:L276 | neighbors=[seed.ts, seedUsers(), iso()]
- "functions_admin_routes_deleteaccount": "deleteAccount()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L184 | neighbors=[admin-routes.ts, deletionBlockers(), operator()]
- "functions_admin_routes_deletionblockers": "deletionBlockers()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L135 | neighbors=[admin-routes.ts, deleteAccount(), userDetail()]
- "functions_admin_routes_escrowrights": "escrowRights()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L259 | neighbors=[admin-routes.ts, operator(), row()]
- "functions_admin_routes_suspend": "suspend()" | kind=code-symbol | source=api/src/functions/admin-routes.ts:L160 | neighbors=[admin-routes.ts, operator(), row()]
- "functions_dispute_routes_accept": "accept()" | kind=code-symbol | source=api/src/functions/dispute-routes.ts:L422 | neighbors=[dispute-routes.ts, ownDispute(), settleDispute()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-018.json

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
