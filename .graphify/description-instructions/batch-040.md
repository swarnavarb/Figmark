# Node Description Batch 41 of 55

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

- "data_memory_repository_memoryrepository_listordersforbuyer": ".listOrdersForBuyer()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L340 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listordersforlisting": ".listOrdersForListing()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L346 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listordersforlot": ".listOrdersForLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L330 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listordersforseller": ".listOrdersForSeller()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L728 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listordersheldby": ".listOrdersHeldBy()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L334 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listpledgedlistingids": ".listPledgedListingIds()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L577 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listpledges": ".listPledges()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L562 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listposts": ".listPosts()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L732 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listpostsbyauthor": ".listPostsByAuthor()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L673 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listpostsforchannels": ".listPostsForChannels()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L739 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listpowersales": ".listPowerSales()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L589 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listreviewsabout": ".listReviewsAbout()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L502 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listreviewsfororder": ".listReviewsForOrder()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L628 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listroutes": ".listRoutes()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L170 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_liststoreowners": ".listStoreOwners()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L724 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_liststorereviews": ".listStoreReviews()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L617 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listtemplates": ".listTemplates()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L147 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listusersbyids": ".listUsersByIds()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L139 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listwantidsseekingby": ".listWantIdsSeekingBy()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L552 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listwantoffers": ".listWantOffers()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L532 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listwantsby": ".listWantsBy()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L517 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listwantseekers": ".listWantSeekers()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L543 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_markthreadread": ".markThreadRead()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L712 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_moveordertolot": ".moveOrderToLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L202 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_releasehandle": ".releaseHandle()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L478 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_reservehandle": ".reserveHandle()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L469 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_revokesession": ".revokeSession()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L228 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savenotification": ".saveNotification()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L612 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savepledge": ".savePledge()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L568 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savepowersale": ".savePowerSale()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L600 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_saveroute": ".saveRoute()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L181 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savestorereview": ".saveStoreReview()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L623 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savetemplate": ".saveTemplate()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L158 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savewant": ".saveWant()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L527 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savewantoffer": ".saveWantOffer()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L538 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_savewantseeker": ".saveWantSeeker()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L547 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_sendmessage": ".sendMessage()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L497 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_status": ".status()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L108 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_updatedispute": ".updateDispute()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L707 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_updatelisting": ".updateListing()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L583 | neighbors=[MemoryRepository]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-040.json

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
