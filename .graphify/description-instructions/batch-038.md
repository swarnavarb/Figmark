# Node Description Batch 39 of 55

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

- "components_feedback_toast": "Toast" | kind=code-symbol | source=app/src/components/Feedback.tsx:L86 | neighbors=[Feedback.tsx]
- "components_feedback_toastcontext": "ToastContext" | kind=code-symbol | source=app/src/components/Feedback.tsx:L88 | neighbors=[Feedback.tsx]
- "components_feedback_toasthost": "ToastHost()" | kind=code-symbol | source=app/src/components/Feedback.tsx:L107 | neighbors=[Feedback.tsx]
- "components_feedback_toasttone": "ToastTone" | kind=code-symbol | source=app/src/components/Feedback.tsx:L85 | neighbors=[Feedback.tsx]
- "components_feedback_usetoast": "useToast()" | kind=code-symbol | source=app/src/components/Feedback.tsx:L91 | neighbors=[Feedback.tsx]
- "components_fillmeter_facepile": "FacePile()" | kind=code-symbol | source=app/src/components/FillMeter.tsx:L104 | neighbors=[FillMeter.tsx]
- "components_icon_filled": "FILLED" | kind=code-symbol | source=app/src/components/Icon.tsx:L66 | neighbors=[Icon.tsx]
- "components_icon_paths": "PATHS" | kind=code-symbol | source=app/src/components/Icon.tsx:L26 | neighbors=[Icon.tsx]
- "components_ladder_when": "when()" | kind=code-symbol | source=app/src/components/Ladder.tsx:L210 | neighbors=[Ladder.tsx]
- "components_lotfields_extras": "Extras()" | kind=code-symbol | source=app/src/components/LotFields.tsx:L94 | neighbors=[LotFields.tsx]
- "components_lotpeople_customercard": "CustomerCard()" | kind=code-symbol | source=app/src/components/LotPeople.tsx:L116 | neighbors=[LotPeople.tsx]
- "components_photomanager_shrink": "shrink()" | kind=code-symbol | source=app/src/components/PhotoManager.tsx:L22 | neighbors=[PhotoManager.tsx]
- "components_powersale_countdown": "Countdown()" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L226 | neighbors=[PowerSale.tsx]
- "components_powersale_itemdraft": "ItemDraft" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L257 | neighbors=[PowerSale.tsx]
- "components_powersale_salecard": "SaleCard()" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L114 | neighbors=[PowerSale.tsx]
- "components_powersale_status_label": "STATUS_LABEL" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L23 | neighbors=[PowerSale.tsx]
- "components_powersale_status_tone": "STATUS_TONE" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L31 | neighbors=[PowerSale.tsx]
- "components_routebuilder_addstep": "AddStep()" | kind=code-symbol | source=app/src/components/RouteBuilder.tsx:L297 | neighbors=[RouteBuilder.tsx]
- "components_routebuilder_half": "Half()" | kind=code-symbol | source=app/src/components/RouteBuilder.tsx:L149 | neighbors=[RouteBuilder.tsx]
- "components_routebuilder_rowprops": "RowProps" | kind=code-symbol | source=app/src/components/RouteBuilder.tsx:L132 | neighbors=[RouteBuilder.tsx]
- "components_routebuilder_steprows": "StepRows()" | kind=code-symbol | source=app/src/components/RouteBuilder.tsx:L184 | neighbors=[RouteBuilder.tsx]
- "components_tabbar_tabs": "TABS" | kind=code-symbol | source=app/src/components/TabBar.tsx:L29 | neighbors=[TabBar.tsx]
- "data_cosmos_repository_catalog_order": "CATALOG_ORDER" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1681 | neighbors=[cosmos-repository.ts]
- "data_cosmos_repository_cosmosrepository_constructor": ".constructor()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L87 | neighbors=[CosmosRepository]
- "data_cosmos_repository_cosmosrepository_listdemoaccounts": ".listDemoAccounts()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1297 | neighbors=[CosmosRepository]
- "data_cosmos_repository_cosmosrepository_settled": ".settled()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L315 | neighbors=[CosmosRepository]
- "data_cosmos_repository_cosmosrepository_status": ".status()" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L586 | neighbors=[CosmosRepository]
- "data_cosmos_repository_identifierreservation": "IdentifierReservation" | kind=code-symbol | source=api/src/data/cosmos-repository.ts:L1694 | neighbors=[cosmos-repository.ts]
- "data_cosmos_repository_repository": "Repository" | kind=code-symbol | neighbors=[CosmosRepository]
- "data_memory_repository_freshness": "freshness()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L772 | neighbors=[memory-repository.ts]
- "data_memory_repository_memoryrepository_addcomment": ".addComment()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L412 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_assignlistingstolot": ".assignListingsToLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L388 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_bumplisting": ".bumpListing()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L320 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createdispute": ".createDispute()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L642 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createforum": ".createForum()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L762 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createlisting": ".createListing()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L315 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createlot": ".createLot()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L374 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createorder": ".createOrder()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L352 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createpost": ".createPost()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L747 | neighbors=[MemoryRepository]
- "data_memory_repository_memoryrepository_createreview": ".createReview()" | kind=code-symbol | source=api/src/data/memory-repository.ts:L632 | neighbors=[MemoryRepository]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-038.json

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
