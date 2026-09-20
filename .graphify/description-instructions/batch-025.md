# Node Description Batch 26 of 55

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

- "components_ui_filltoneof": "fillToneOf()" | kind=code-symbol | source=app/src/components/ui.tsx:L116 | neighbors=[ui.tsx, LotMeter()]
- "components_ui_lotmeter": "LotMeter()" | kind=code-symbol | source=app/src/components/ui.tsx:L123 | neighbors=[ui.tsx, fillToneOf()]
- "data_cosmos_repository_autoseedenabled": "autoSeedEnabled()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L52 | neighbors=[cosmos-repository.ts, .init()]
- "data_cosmos_repository_catalogorder": "catalogOrder()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1689 | neighbors=[cosmos-repository.ts, .listListings()]
- "data_cosmos_repository_cosmosrepository_addcomment": ".addComment()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1594 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_createdispute": ".createDispute()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L893 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_createforum": ".createForum()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1292 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_createlisting": ".createListing()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1438 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_createlot": ".createLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1459 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_createreview": ".createReview()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L883 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deletelisting": ".deleteListing()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1176 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deletelot": ".deleteLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1184 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deletepost": ".deletePost()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1180 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deletereview": ".deleteReview()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1188 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deleteroute": ".deleteRoute()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L727 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deletetemplate": ".deleteTemplate()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L691 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_deletewantseeker": ".deleteWantSeeker()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1050 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_freehandle": ".freeHandle()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L300 | neighbors=[CosmosRepository, .backfillHandles()]
- "data_cosmos_repository_cosmosrepository_getdispute": ".getDispute()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L898 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_getdisputebyid": ".getDisputeById()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L917 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_getorder": ".getOrder()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1503 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_getroute": ".getRoute()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L713 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_gettemplate": ".getTemplate()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L675 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_getwant": ".getWant()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L995 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listcomments": ".listComments()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1581 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listdisputes": ".listDisputes()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L927 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listescrowagents": ".listEscrowAgents()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L950 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listfollowedsellerids": ".listFollowedSellerIds()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1632 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listfollowerids": ".listFollowerIds()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1639 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listforums": ".listForums()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1275 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listforwarders": ".listForwarders()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L653 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listhandlers": ".listHandlers()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L770 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listlikedlistingids": ".listLikedListingIds()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1612 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listlistingsinlot": ".listListingsInLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1471 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listlots": ".listLots()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1333 | neighbors=[CosmosRepository, .queryBySeller()]
- "data_cosmos_repository_cosmosrepository_listmessagesforhandles": ".listMessagesForHandles()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L827 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listnotifications": ".listNotifications()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1116 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listopenwants": ".listOpenWants()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L959 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listordersawaitinglot": ".listOrdersAwaitingLot()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L736 | neighbors=[CosmosRepository, .container()]
- "data_cosmos_repository_cosmosrepository_listordersforbuyer": ".listOrdersForBuyer()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1520 | neighbors=[CosmosRepository, .container()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-025.json

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
