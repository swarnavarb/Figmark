# Node Description Batch 54 of 55

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

- "shared_services_serviceentry": "ServiceEntry" | kind=code-symbol | source=shared/services.ts:L37 | neighbors=[services.ts]
- "shared_templates_basedocument": "BaseDocument" | kind=code-symbol | neighbors=[PostTemplate]
- "shared_templates_built_in_pre_lot_route": "BUILT_IN_PRE_LOT_ROUTE" | kind=code-symbol | source=shared/templates.ts:L61 | neighbors=[templates.ts]
- "shared_templates_emptytemplate": "emptyTemplate()" | kind=code-symbol | source=shared/templates.ts:L82 | neighbors=[templates.ts]
- "shared_templates_templatefill": "TemplateFill" | kind=code-symbol | source=shared/templates.ts:L105 | neighbors=[templates.ts]
- "src_api_apirequesterror_constructor": ".constructor()" | kind=code-symbol | source=app/src/api.ts:L42 | neighbors=[ApiRequestError]
- "src_api_boardlot": "BoardLot" | kind=code-symbol | source=app/src/api.ts:L888 | neighbors=[api.ts]
- "src_api_boardorder": "BoardOrder" | kind=code-symbol | source=app/src/api.ts:L900 | neighbors=[api.ts]
- "src_api_creditside": "CreditSide" | kind=code-symbol | source=app/src/api.ts:L263 | neighbors=[api.ts]
- "src_api_expects_401": "EXPECTS_401" | kind=code-symbol | source=app/src/api.ts:L66 | neighbors=[api.ts]
- "src_api_listing": "Listing" | kind=code-symbol | neighbors=[FeedListing]
- "src_api_lotsboard": "LotsBoard" | kind=code-symbol | source=app/src/api.ts:L917 | neighbors=[api.ts]
- "src_api_newlisting": "NewListing" | kind=code-symbol | source=app/src/api.ts:L459 | neighbors=[api.ts]
- "src_api_pagereview": "PageReview" | kind=code-symbol | source=app/src/api.ts:L244 | neighbors=[api.ts]
- "src_api_powersaleitemview": "PowerSaleItemView" | kind=code-symbol | source=app/src/api.ts:L352 | neighbors=[api.ts]
- "src_api_publicreview": "PublicReview" | kind=code-symbol | source=app/src/api.ts:L230 | neighbors=[api.ts]
- "src_api_ratingsummary": "RatingSummary" | kind=code-symbol | source=app/src/api.ts:L445 | neighbors=[api.ts]
- "src_api_routepreset": "RoutePreset" | kind=code-symbol | source=app/src/api.ts:L763 | neighbors=[api.ts]
- "src_api_sellercard": "SellerCard" | kind=code-symbol | source=app/src/api.ts:L97 | neighbors=[api.ts]
- "src_api_servicedirectory": "ServiceDirectory" | kind=code-symbol | source=app/src/api.ts:L710 | neighbors=[api.ts]
- "src_api_storedphoto": "StoredPhoto" | kind=code-symbol | source=app/src/api.ts:L868 | neighbors=[api.ts]
- "src_api_threadrow": "ThreadRow" | kind=code-symbol | source=app/src/api.ts:L929 | neighbors=[api.ts]
- "src_api_wantofferrow": "WantOfferRow" | kind=code-symbol | source=app/src/api.ts:L563 | neighbors=[api.ts]
- "src_config_appconfig": "AppConfig" | kind=code-symbol | source=api/src/config.ts:L27 | neighbors=[config.ts]
- "src_config_cosmos": "cosmos" | kind=code-symbol | source=api/src/config.ts:L157 | neighbors=[config.ts]
- "src_config_session": "session" | kind=code-symbol | source=api/src/config.ts:L158 | neighbors=[config.ts]
- "src_config_sessionsecretsource": "SessionSecretSource" | kind=code-symbol | source=api/src/config.ts:L111 | neighbors=[config.ts]
- "src_format_brand_hues": "BRAND_HUES" | kind=code-symbol | source=app/src/format.ts:L94 | neighbors=[format.ts]
- "src_format_brandhue": "BrandHue" | kind=code-symbol | source=app/src/format.ts:L95 | neighbors=[format.ts]
- "src_main_app": "App()" | kind=code-symbol | source=app/src/main.tsx:L35 | neighbors=[main.tsx]
- "src_main_container": "container" | kind=code-symbol | source=app/src/main.tsx:L89 | neighbors=[main.tsx]
- "src_session_sessioncontext": "SessionContext" | kind=code-symbol | source=app/src/session.tsx:L33 | neighbors=[session.tsx]
- "src_session_sessionvalue": "SessionValue" | kind=code-symbol | source=app/src/session.tsx:L11 | neighbors=[session.tsx]
- "storage_blob_store_blobphotostore_init": ".init()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L24 | neighbors=[BlobPhotoStore]
- "storage_blob_store_blobphotostore_read": ".read()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L69 | neighbors=[BlobPhotoStore]
- "storage_blob_store_blobphotostore_status": ".status()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L50 | neighbors=[BlobPhotoStore]
- "storage_blob_store_photostore": "PhotoStore" | kind=code-symbol | neighbors=[BlobPhotoStore]
- "storage_memory_store_memoryphotostore_init": ".init()" | kind=code-symbol | source=api/src/storage/memory-store.ts:L16 | neighbors=[MemoryPhotoStore]
- "storage_memory_store_memoryphotostore_read": ".read()" | kind=code-symbol | source=api/src/storage/memory-store.ts:L41 | neighbors=[MemoryPhotoStore]
- "storage_memory_store_memoryphotostore_status": ".status()" | kind=code-symbol | source=api/src/storage/memory-store.ts:L18 | neighbors=[MemoryPhotoStore]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-053.json

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
