# Node Description Batch 40 of 55

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

- "data_memory_repository_memoryrepository_deletelisting": ".deleteListing()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L691 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deletelot": ".deleteLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L699 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deletepledge": ".deletePledge()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L573 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deletepost": ".deletePost()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L695 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deletereview": ".deleteReview()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L703 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deleteroute": ".deleteRoute()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L186 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deletetemplate": ".deleteTemplate()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L163 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_deletewantseeker": ".deleteWantSeeker()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L558 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getbyhandle": ".getByHandle()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L462 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getdispute": ".getDispute()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L647 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getdisputebyid": ".getDisputeById()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L651 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getforum": ".getForum()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L758 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getlisting": ".getListing()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L308 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getlot": ".getLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L249 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getorder": ".getOrder()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L365 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getpowersale": ".getPowerSale()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L595 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getroute": ".getRoute()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L176 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_gettemplate": ".getTemplate()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L153 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getuserbyid": ".getUserById()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L120 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_getwant": ".getWant()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L523 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_issessionrevoked": ".isSessionRevoked()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L232 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listallusers": ".listAllUsers()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L663 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listcomments": ".listComments()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L406 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listdemoaccounts": ".listDemoAccounts()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L217 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listdisputes": ".listDisputes()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L655 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listescrowagents": ".listEscrowAgents()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L667 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listfollowedsellerids": ".listFollowedSellerIds()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L449 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listfollowerids": ".listFollowerIds()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L453 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listforums": ".listForums()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L754 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listforwarders": ".listForwarders()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L143 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listhandlers": ".listHandlers()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L211 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listlikedlistingids": ".listLikedListingIds()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L430 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listlistings": ".listListings()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L254 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listlistingsinlot": ".listListingsInLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L384 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listlots": ".listLots()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L243 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listmessages": ".listMessages()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L482 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listmessagesforhandles": ".listMessagesForHandles()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L489 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listnotifications": ".listNotifications()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L605 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listopenwants": ".listOpenWants()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L508 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_listordersawaitinglot": ".listOrdersAwaitingLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L193 | neighbors=[MemoryRepository]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-039.json

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
