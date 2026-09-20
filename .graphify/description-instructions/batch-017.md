# Node Description Batch 18 of 55

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

- "scripts_modern_screenshot_umd_z": "z()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/modern-screenshot.umd.js:L7 | neighbors=[modern-screenshot.umd.js, jt(), Ot(), Re()]
- "scripts_smoke_api_req": "req()" | kind=code-symbol | source=scripts/smoke-api.mjs:L130 | neighbors=[smoke-api.mjs, newBuyer(), openCampaign(), waitingItem()]
- "shared_capabilities_hasanycapability": "hasAnyCapability()" | kind=code-symbol | source=shared/capabilities.ts:L45 | neighbors=[mock-provider.ts, swa-provider.ts, fulfilment-routes.ts, capabilities.ts]
- "shared_contracts_backendkind": "BackendKind" | kind=code-symbol | source=shared/contracts.ts:L92 | neighbors=[cosmos-repository.ts, memory-repository.ts, repository.ts, contracts.ts]
- "shared_enums_dispute_outcome_labels": "DISPUTE_OUTCOME_LABELS" | kind=code-symbol | source=shared/enums.ts:L161 | neighbors=[DisputesView.tsx, DisputePage.tsx, EscrowPage.tsx, enums.ts]
- "shared_enums_dispute_status_labels": "DISPUTE_STATUS_LABELS" | kind=code-symbol | source=shared/enums.ts:L143 | neighbors=[DisputesView.tsx, DisputePage.tsx, EscrowPage.tsx, enums.ts]
- "shared_enums_disputereason": "DisputeReason" | kind=code-symbol | source=shared/enums.ts:L192 | neighbors=[dispute-routes.ts, disputes.ts, enums.ts, models.ts]
- "shared_enums_fulfilmentstage": "FulfilmentStage" | kind=code-symbol | source=shared/enums.ts:L88 | neighbors=[enums.ts, fulfilment.ts, models.ts, api.ts]
- "shared_enums_lot_card_labels": "LOT_CARD_LABELS" | kind=code-symbol | source=shared/enums.ts:L317 | neighbors=[LotBoardPage.tsx, ShopPage.tsx, SupplierPage.tsx, enums.ts]
- "shared_enums_store_permissions": "STORE_PERMISSIONS" | kind=code-symbol | source=shared/enums.ts:L236 | neighbors=[seller-routes.ts, ShopPage.tsx, enums.ts, stores.ts]
- "shared_insights_live": "live()" | kind=code-symbol | source=shared/insights.ts:L34 | neighbors=[insight-routes.ts, insights.ts, packingEstimate(), phaseOf()]
- "shared_insights_phaseof": "phaseOf()" | kind=code-symbol | source=shared/insights.ts:L260 | neighbors=[insight-routes.ts, insights.ts, live(), phaseOfCounts()]
- "shared_models_messageparty": "MessageParty" | kind=code-symbol | source=shared/models.ts:L1342 | neighbors=[message-routes.ts, MessagesPage.tsx, models.ts, api.ts]
- "shared_models_storemanager": "StoreManager" | kind=code-symbol | source=shared/models.ts:L278 | neighbors=[ShopPage.tsx, models.ts, stores.ts, api.ts]
- "shared_models_verificationstate": "VerificationState" | kind=code-symbol | source=shared/models.ts:L40 | neighbors=[mock-provider.ts, seed.ts, contracts.ts, models.ts]
- "shared_orders_daysfrom": "daysFrom()" | kind=code-symbol | source=shared/orders.ts:L157 | neighbors=[dispute-routes.ts, fulfilment-routes.ts, order-routes.ts, orders.ts]
- "shared_orders_orderside": "OrderSide" | kind=code-symbol | source=shared/orders.ts:L48 | neighbors=[OrderPage.tsx, disputes.ts, orders.ts, api.ts]
- "shared_parties_partyref": "PartyRef" | kind=code-symbol | source=shared/parties.ts:L18 | neighbors=[insight-routes.ts, preorder.ts, social-routes.ts, parties.ts]
- "shared_routes_joinindexof": "joinIndexOf()" | kind=code-symbol | source=shared/routes.ts:L135 | neighbors=[fulfilment-routes.ts, RoutesPage.tsx, routes.ts, lotOffset()]
- "shared_routes_lotrefof": "lotRefOf()" | kind=code-symbol | source=shared/routes.ts:L567 | neighbors=[template-routes.ts, tracking-routes.ts, routes.ts, lotNumberFrom()]
- "shared_routes_sideof": "sideOf()" | kind=code-symbol | source=shared/routes.ts:L107 | neighbors=[RouteBuilder.tsx, LotsPage.tsx, RoutesPage.tsx, routes.ts]
- "shared_routes_steptrigger": "StepTrigger" | kind=code-symbol | source=shared/routes.ts:L58 | neighbors=[fulfilment-routes.ts, tracking-routes.ts, routes.ts, api.ts]
- "shared_routes_trigger_labels": "TRIGGER_LABELS" | kind=code-symbol | source=shared/routes.ts:L61 | neighbors=[RouteBuilder.tsx, LotsPage.tsx, RoutesPage.tsx, routes.ts]
- "shared_services_servicekind": "ServiceKind" | kind=code-symbol | source=shared/services.ts:L23 | neighbors=[service-routes.ts, ServicesPage.tsx, services.ts, api.ts]
- "shared_stores_accessfor": "accessFor()" | kind=code-symbol | source=shared/stores.ts:L61 | neighbors=[message-routes.ts, seller-routes.ts, stores.ts, permissionsFor()]
- "shared_stores_permissionsfor": "permissionsFor()" | kind=code-symbol | source=shared/stores.ts:L41 | neighbors=[stores.ts, accessFor(), can(), expandPermissions()]
- "shared_templates_prelotrouteof": "preLotRouteOf()" | kind=code-symbol | source=shared/templates.ts:L76 | neighbors=[fulfilment-routes.ts, ShopPage.tsx, templates.ts, journeyOf()]
- "src_api_providercard": "ProviderCard" | kind=code-symbol | source=app/src/api.ts:L691 | neighbors=[LotsPage.tsx, ServicesPage.tsx, ShopPage.tsx, api.ts]
- "src_api_routesresponse": "RoutesResponse" | kind=code-symbol | source=app/src/api.ts:L770 | neighbors=[LotsPage.tsx, RoutesPage.tsx, ShopPage.tsx, api.ts]
- "src_format_formatweight": "formatWeight()" | kind=code-symbol | source=app/src/format.ts:L10 | neighbors=[LotPeople.tsx, LotsPage.tsx, SupplierPage.tsx, format.ts]
- "storage_types_photostore": "PhotoStore" | kind=code-symbol | source=api/src/storage/types.ts:L23 | neighbors=[blob-store.ts, index.ts, memory-store.ts, types.ts]
- "storage_types_storagestatus": "StorageStatus" | kind=code-symbol | source=api/src/storage/types.ts:L1 | neighbors=[blob-store.ts, index.ts, memory-store.ts, types.ts]
- "admin_confirm_confirm": "Confirm()" | kind=code-symbol | source=app/src/admin/Confirm.tsx:L12 | neighbors=[Confirm.tsx, DisputesView.tsx, UsersView.tsx]
- "auth_mock_provider_hassessioncookie": "hasSessionCookie()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L380 | neighbors=[mock-provider.ts, .requireAuth(), .staleCookies()]
- "auth_mock_provider_mockauthprovider_stalecookies": ".staleCookies()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L142 | neighbors=[MockAuthProvider, hasSessionCookie(), .getCurrentUser()]
- "auth_mock_provider_readtoken": "readToken()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L386 | neighbors=[mock-provider.ts, .logout(), readTokens()]
- "auth_swa_provider_staticwebappsauthprovider_getcurrentuser": ".getCurrentUser()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L34 | neighbors=[StaticWebAppsAuthProvider, readClientPrincipal(), .requireAuth()]
- "auth_swa_provider_staticwebappsauthprovider_requireauth": ".requireAuth()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L54 | neighbors=[StaticWebAppsAuthProvider, .getCurrentUser(), .requireCapability()]
- "components_feedback_skeletonrows": "SkeletonRows()" | kind=code-symbol | source=app/src/components/Feedback.tsx:L66 | neighbors=[Feedback.tsx, MessagesPage.tsx, RoutesPage.tsx]
- "components_icon_iconname": "IconName" | kind=code-symbol | source=app/src/components/Icon.tsx:L19 | neighbors=[Icon.tsx, ui.tsx, SocialPage.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-017.json

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
