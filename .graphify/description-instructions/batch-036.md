# Node Description Batch 37 of 55

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

- "src_api_lotitem": "LotItem" | kind=code-symbol | source=app/src/api.ts:L794 | neighbors=[LotsPage.tsx, api.ts]
- "src_api_lotrouteview": "LotRouteView" | kind=code-symbol | source=app/src/api.ts:L814 | neighbors=[LotsPage.tsx, api.ts]
- "src_api_orderstate": "OrderState" | kind=code-symbol | source=app/src/api.ts:L429 | neighbors=[OrderPage.tsx, api.ts]
- "src_api_ordertracking": "OrderTracking" | kind=code-symbol | source=app/src/api.ts:L200 | neighbors=[OrderPage.tsx, api.ts]
- "src_api_pagereviews": "PageReviews" | kind=code-symbol | source=app/src/api.ts:L254 | neighbors=[ProfileByHandlePage.tsx, api.ts]
- "src_api_post": "post()" | kind=code-symbol | source=app/src/api.ts:L94 | neighbors=[api.ts, request()]
- "src_api_postcard": "PostCard" | kind=code-symbol | source=app/src/api.ts:L504 | neighbors=[SocialPage.tsx, api.ts]
- "src_api_powersaledraft": "PowerSaleDraft" | kind=code-symbol | source=app/src/api.ts:L388 | neighbors=[PowerSale.tsx, api.ts]
- "src_api_powersaleview": "PowerSaleView" | kind=code-symbol | source=app/src/api.ts:L367 | neighbors=[PowerSale.tsx, api.ts]
- "src_api_preordermember": "PreOrderMember" | kind=code-symbol | source=app/src/api.ts:L126 | neighbors=[FillMeter.tsx, api.ts]
- "src_api_preorderroster": "PreOrderRoster" | kind=code-symbol | source=app/src/api.ts:L136 | neighbors=[ListingPage.tsx, api.ts]
- "src_api_publicprofile": "PublicProfile" | kind=code-symbol | source=app/src/api.ts:L953 | neighbors=[ProfileByHandlePage.tsx, api.ts]
- "src_api_reviewsabout": "ReviewsAbout" | kind=code-symbol | source=app/src/api.ts:L450 | neighbors=[ProfileByHandlePage.tsx, api.ts]
- "src_api_salerow": "SaleRow" | kind=code-symbol | source=app/src/api.ts:L314 | neighbors=[ShopPage.tsx, api.ts]
- "src_api_salesresponse": "SalesResponse" | kind=code-symbol | source=app/src/api.ts:L341 | neighbors=[ShopPage.tsx, api.ts]
- "src_api_serviceshub": "ServicesHub" | kind=code-symbol | source=app/src/api.ts:L703 | neighbors=[ServicesPage.tsx, api.ts]
- "src_api_setsessionrejectedhandler": "setSessionRejectedHandler()" | kind=code-symbol | source=app/src/api.ts:L61 | neighbors=[api.ts, session.tsx]
- "src_api_storefrontdraft": "StorefrontDraft" | kind=code-symbol | source=app/src/api.ts:L873 | neighbors=[ShopPage.tsx, api.ts]
- "src_api_supplieritem": "SupplierItem" | kind=code-symbol | source=app/src/api.ts:L979 | neighbors=[SupplierPage.tsx, api.ts]
- "src_api_supplierlot": "SupplierLot" | kind=code-symbol | source=app/src/api.ts:L996 | neighbors=[SupplierPage.tsx, api.ts]
- "src_api_supplierstore": "SupplierStore" | kind=code-symbol | source=app/src/api.ts:L989 | neighbors=[SupplierPage.tsx, api.ts]
- "src_api_thread": "Thread" | kind=code-symbol | source=app/src/api.ts:L944 | neighbors=[MessagesPage.tsx, api.ts]
- "src_api_wantcard": "WantCard" | kind=code-symbol | source=app/src/api.ts:L542 | neighbors=[WantedPage.tsx, api.ts]
- "src_api_wantdetail": "WantDetail" | kind=code-symbol | source=app/src/api.ts:L583 | neighbors=[WantedPage.tsx, api.ts]
- "src_appshell_appshell": "AppShell()" | kind=code-symbol | source=app/src/AppShell.tsx:L14 | neighbors=[AppShell.tsx, main.tsx]
- "src_config_cosmosconfig": "CosmosConfig" | kind=code-symbol | source=api/src/config.ts:L14 | neighbors=[cosmos-repository.ts, config.ts]
- "src_config_resolveadmins": "resolveAdmins()" | kind=code-symbol | source=api/src/config.ts:L74 | neighbors=[config.ts, env()]
- "src_config_resolveauthmode": "resolveAuthMode()" | kind=code-symbol | source=api/src/config.ts:L94 | neighbors=[config.ts, env()]
- "src_config_resolvecosmos": "resolveCosmos()" | kind=code-symbol | source=api/src/config.ts:L56 | neighbors=[config.ts, env()]
- "src_config_resolvesessionsecret": "resolveSessionSecret()" | kind=code-symbol | source=api/src/config.ts:L131 | neighbors=[config.ts, env()]
- "src_config_resolvestorage": "resolveStorage()" | kind=code-symbol | source=api/src/config.ts:L83 | neighbors=[config.ts, env()]
- "src_config_storageconfig": "StorageConfig" | kind=code-symbol | source=api/src/config.ts:L21 | neighbors=[config.ts, blob-store.ts]
- "src_format_daysuntil": "daysUntil()" | kind=code-symbol | source=app/src/format.ts:L19 | neighbors=[FillMeter.tsx, format.ts]
- "src_session_sessionprovider": "SessionProvider()" | kind=code-symbol | source=app/src/session.tsx:L35 | neighbors=[main.tsx, session.tsx]
- "storage_blob_store_blobphotostore_constructor": ".constructor()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L14 | neighbors=[BlobPhotoStore, buildClient()]
- "storage_blob_store_blobphotostore_upload": ".upload()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L58 | neighbors=[BlobPhotoStore, .urlFor()]
- "storage_blob_store_blobphotostore_urlfor": ".urlFor()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L54 | neighbors=[BlobPhotoStore, .upload()]
- "storage_blob_store_buildclient": "buildClient()" | kind=code-symbol | source=api/src/storage/blob-store.ts:L84 | neighbors=[blob-store.ts, .constructor()]
- "storage_memory_store_memoryphotostore_urlfor": ".urlFor()" | kind=code-symbol | source=api/src/storage/memory-store.ts:L29 | neighbors=[MemoryPhotoStore, .upload()]
- "admin_disputesview_disputedetail": "DisputeDetail()" | kind=code-symbol | source=app/src/admin/DisputesView.tsx:L94 | neighbors=[DisputesView.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-036.json

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
