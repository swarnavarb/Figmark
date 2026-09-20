# Node Description Batch 25 of 55

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

- "src_api_request": "request()" | kind=code-symbol | source=app/src/api.ts:L68 | neighbors=[api.ts, post(), ApiRequestError]
- "src_format_gradientfor": "gradientFor()" | kind=code-symbol | source=app/src/format.ts:L75 | neighbors=[ui.tsx, format.ts, hueFor()]
- "src_format_hash32": "hash32()" | kind=code-symbol | source=app/src/format.ts:L50 | neighbors=[format.ts, brandHueFor(), hueFor()]
- "src_format_huefor": "hueFor()" | kind=code-symbol | source=app/src/format.ts:L59 | neighbors=[format.ts, gradientFor(), hash32()]
- "src_format_initialsof": "initialsOf()" | kind=code-symbol | source=app/src/format.ts:L101 | neighbors=[FillMeter.tsx, ui.tsx, format.ts]
- "storage_index_getphotostore": "getPhotoStore()" | kind=code-symbol | source=api/src/storage/index.ts:L11 | neighbors=[health.ts, template-routes.ts, index.ts]
- "storage_memory_store_extensionfor": "extensionFor()" | kind=code-symbol | source=api/src/storage/memory-store.ts:L46 | neighbors=[blob-store.ts, memory-store.ts, .upload()]
- "storage_memory_store_memoryphotostore_upload": ".upload()" | kind=code-symbol | source=api/src/storage/memory-store.ts:L35 | neighbors=[MemoryPhotoStore, extensionFor(), .urlFor()]
- "storage_types_storedphoto": "StoredPhoto" | kind=code-symbol | source=api/src/storage/types.ts:L9 | neighbors=[blob-store.ts, memory-store.ts, types.ts]
- "admin_api_admindisputerow": "AdminDisputeRow" | kind=code-symbol | source=app/src/admin/api.ts:L45 | neighbors=[api.ts, DisputesView.tsx]
- "admin_api_adminuserdetail": "AdminUserDetail" | kind=code-symbol | source=app/src/admin/api.ts:L34 | neighbors=[api.ts, UsersView.tsx]
- "admin_api_adminuserrow": "AdminUserRow" | kind=code-symbol | source=app/src/admin/api.ts:L13 | neighbors=[api.ts, UsersView.tsx]
- "admin_api_post": "post()" | kind=code-symbol | source=app/src/admin/api.ts:L103 | neighbors=[api.ts, request()]
- "admin_api_request": "request()" | kind=code-symbol | source=app/src/admin/api.ts:L66 | neighbors=[api.ts, post()]
- "admin_disputesview_disputesview": "DisputesView()" | kind=code-symbol | source=app/src/admin/DisputesView.tsx:L20 | neighbors=[DisputesView.tsx, main.tsx]
- "admin_usersview_usersview": "UsersView()" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L13 | neighbors=[main.tsx, UsersView.tsx]
- "app_vite_config": "vite.config.ts" | kind=code-symbol | source=app/vite.config.ts:L1 | neighbors=[f1b6577 An operations console, escrow a…, f4ae77f The lot board: count the pieces…]
- "auth_mock_provider_mockauthprovider_login": ".login()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L161 | neighbors=[MockAuthProvider, toAuthUser()]
- "auth_mock_provider_mockauthprovider_logout": ".logout()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L220 | neighbors=[MockAuthProvider, readToken()]
- "auth_mock_provider_mockauthprovider_requirecapability": ".requireCapability()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L148 | neighbors=[MockAuthProvider, .requireAuth()]
- "auth_mock_provider_mockauthprovider_signup": ".signup()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L236 | neighbors=[MockAuthProvider, toAuthUser()]
- "auth_swa_provider_readclientprincipal": "readClientPrincipal()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L103 | neighbors=[swa-provider.ts, .getCurrentUser()]
- "auth_swa_provider_staticwebappsauthprovider_requirecapability": ".requireCapability()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L60 | neighbors=[StaticWebAppsAuthProvider, .requireAuth()]
- "components_categoryicon_categoryicon": "CategoryIcon()" | kind=code-symbol | source=app/src/components/CategoryIcon.tsx:L72 | neighbors=[CategoryIcon.tsx, FeedPage.tsx]
- "components_fillmeter_fillblock": "FillBlock()" | kind=code-symbol | source=app/src/components/FillMeter.tsx:L136 | neighbors=[FillMeter.tsx, ListingPage.tsx]
- "components_fillmeter_fillgap": "FillGap()" | kind=code-symbol | source=app/src/components/FillMeter.tsx:L53 | neighbors=[FillMeter.tsx, FeedPage.tsx]
- "components_fillmeter_fillkey": "FillKey()" | kind=code-symbol | source=app/src/components/FillMeter.tsx:L78 | neighbors=[FillMeter.tsx, FeedPage.tsx]
- "components_fillmeter_fillmeter": "FillMeter()" | kind=code-symbol | source=app/src/components/FillMeter.tsx:L20 | neighbors=[FillMeter.tsx, FeedPage.tsx]
- "components_ladder_notesbystep": "notesByStep()" | kind=code-symbol | source=app/src/components/Ladder.tsx:L193 | neighbors=[Ladder.tsx, Ladder()]
- "components_lotfields_emptylotdetails": "emptyLotDetails()" | kind=code-symbol | source=app/src/components/LotFields.tsx:L105 | neighbors=[LotFields.tsx, LotsPage.tsx]
- "components_lotfields_lotdetailfields": "LotDetailFields()" | kind=code-symbol | source=app/src/components/LotFields.tsx:L13 | neighbors=[LotFields.tsx, LotsPage.tsx]
- "components_lotfields_lotdetailsof": "lotDetailsOf()" | kind=code-symbol | source=app/src/components/LotFields.tsx:L116 | neighbors=[LotFields.tsx, LotsPage.tsx]
- "components_lotfields_modal": "Modal()" | kind=code-symbol | source=app/src/components/LotFields.tsx:L180 | neighbors=[LotFields.tsx, LotsPage.tsx]
- "components_lotfields_newlotdialog": "NewLotDialog()" | kind=code-symbol | source=app/src/components/LotFields.tsx:L133 | neighbors=[LotFields.tsx, SellPage.tsx]
- "components_notifications_notifications": "Notifications()" | kind=code-symbol | source=app/src/components/Notifications.tsx:L21 | neighbors=[Notifications.tsx, AppShell.tsx]
- "components_photomanager_photomanager": "PhotoManager()" | kind=code-symbol | source=app/src/components/PhotoManager.tsx:L61 | neighbors=[PhotoManager.tsx, SellPage.tsx]
- "components_powersale_blankitem": "blankItem()" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L270 | neighbors=[PowerSale.tsx, SaleBuilder()]
- "components_powersale_powersalepanel": "PowerSalePanel()" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L39 | neighbors=[PowerSale.tsx, ShopPage.tsx]
- "components_powersale_salebuilder": "SaleBuilder()" | kind=code-symbol | source=app/src/components/PowerSale.tsx:L290 | neighbors=[PowerSale.tsx, blankItem()]
- "components_tabbar_tabbar": "TabBar()" | kind=code-symbol | source=app/src/components/TabBar.tsx:L94 | neighbors=[TabBar.tsx, AppShell.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-024.json

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
