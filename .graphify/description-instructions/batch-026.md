# Node Description Batch 27 of 55

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

- "data_cosmos_repository_cosmosrepository_listordersforlisting": ".listOrdersForListing()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1530 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listordersforlot": ".listOrdersForLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1417 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listordersforseller": ".listOrdersForSeller()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1222 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listordersheldby": ".listOrdersHeldBy()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1212 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listpledgedlistingids": ".listPledgedListingIds()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1075 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listpledges": ".listPledges()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1054 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listposts": ".listPosts()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1235 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listpostsbyauthor": ".listPostsByAuthor()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1149 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listpostsforchannels": ".listPostsForChannels()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1245 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listpowersales": ".listPowerSales()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1094 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listreviewsabout": ".listReviewsAbout()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L856 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listreviewsfororder": ".listReviewsForOrder()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L873 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listroutes": ".listRoutes()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L700 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_liststoreowners": ".listStoreOwners()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1205 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_liststorereviews": ".listStoreReviews()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1134 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listtemplates": ".listTemplates()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L662 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listusersbyids": ".listUsersByIds()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L642 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listwantidsseekingby": ".listWantIdsSeekingBy()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1038 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listwantoffers": ".listWantOffers()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1011 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listwantsby": ".listWantsBy()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L985 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listwantseekers": ".listWantSeekers()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1026 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_moveordertolot": ".moveOrderToLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L757 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_releasehandle": ".releaseHandle()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L808 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_revokesession": ".revokeSession()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1310 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savenotification": ".saveNotification()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1129 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savepledge": ".savePledge()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1061 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savepowersale": ".savePowerSale()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1111 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_saveroute": ".saveRoute()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L722 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savestorereview": ".saveStoreReview()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1144 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savetemplate": ".saveTemplate()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L686 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savewant": ".saveWant()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1006 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savewantoffer": ".saveWantOffer()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1021 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_savewantseeker": ".saveWantSeeker()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1033 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_sendmessage": ".sendMessage()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L847 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_updatedispute": ".updateDispute()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L908 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_updatelisting": ".updateListing()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1087 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_updatelot": ".updateLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1464 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_updateorder": ".updateOrder()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1513 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_updatereview": ".updateReview()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L888 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_namefor": "nameFor()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1717 | neighbors=[cosmos-repository.ts, .backfillHandles()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-026.json

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
