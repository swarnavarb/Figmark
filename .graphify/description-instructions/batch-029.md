# Node Description Batch 30 of 55

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

- "pages_messagespage_messagesview": "MessagesView()" | kind=code-symbol | source=app/src/pages/MessagesPage.tsx:L17 | neighbors=[MessagesPage.tsx, SocialPage.tsx]
- "pages_messagespage_threadpage": "ThreadPage()" | kind=code-symbol | source=app/src/pages/MessagesPage.tsx:L162 | neighbors=[MessagesPage.tsx, main.tsx]
- "pages_orderpage_evidencefields": "EvidenceFields()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L993 | neighbors=[DisputePage.tsx, OrderPage.tsx]
- "pages_orderpage_orderpage": "OrderPage()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L25 | neighbors=[OrderPage.tsx, main.tsx]
- "pages_orderpage_stars": "Stars()" | kind=code-symbol | source=app/src/pages/OrderPage.tsx:L1119 | neighbors=[OrderPage.tsx, ProfileByHandlePage.tsx]
- "pages_profilebyhandlepage_creditsheet": "CreditSheet()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L290 | neighbors=[ProfileByHandlePage.tsx, gradeFor()]
- "pages_profilebyhandlepage_withscheme": "withScheme()" | kind=code-symbol | source=app/src/pages/ProfileByHandlePage.tsx:L580 | neighbors=[ProfileByHandlePage.tsx, ProfileByHandlePage()]
- "pages_profilepage_waitingon": "waitingOn()" | kind=code-symbol | source=app/src/pages/ProfilePage.tsx:L29 | neighbors=[ProfilePage.tsx, ProfilePage()]
- "pages_routespage_routeeditor": "RouteEditor()" | kind=code-symbol | source=app/src/pages/RoutesPage.tsx:L141 | neighbors=[RoutesPage.tsx, ShopPage.tsx]
- "pages_routespage_routeeditorpage": "RouteEditorPage()" | kind=code-symbol | source=app/src/pages/RoutesPage.tsx:L116 | neighbors=[RoutesPage.tsx, main.tsx]
- "pages_routespage_routespage": "RoutesPage()" | kind=code-symbol | source=app/src/pages/RoutesPage.tsx:L17 | neighbors=[RoutesPage.tsx, main.tsx]
- "pages_sellpage_sellpage": "SellPage()" | kind=code-symbol | source=app/src/pages/SellPage.tsx:L67 | neighbors=[SellPage.tsx, main.tsx]
- "pages_servicespage_consignmentspage": "ConsignmentsPage()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L434 | neighbors=[ServicesPage.tsx, main.tsx]
- "pages_servicespage_distributionpage": "DistributionPage()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L497 | neighbors=[ServicesPage.tsx, main.tsx]
- "pages_servicespage_myservicespage": "MyServicesPage()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L246 | neighbors=[ServicesPage.tsx, main.tsx]
- "pages_servicespage_servicedirectorypage": "ServiceDirectoryPage()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L119 | neighbors=[ServicesPage.tsx, main.tsx]
- "pages_servicespage_servicespage": "ServicesPage()" | kind=code-symbol | source=app/src/pages/ServicesPage.tsx:L36 | neighbors=[ServicesPage.tsx, main.tsx]
- "pages_shoppage_orderrow": "OrderRow()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1111 | neighbors=[ShopPage.tsx, orderTone()]
- "pages_shoppage_ordertone": "orderTone()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1089 | neighbors=[ShopPage.tsx, OrderRow()]
- "pages_shoppage_shoppage": "ShopPage()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L69 | neighbors=[ShopPage.tsx, main.tsx]
- "pages_socialpage_channelpage": "ChannelPage()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L194 | neighbors=[SocialPage.tsx, main.tsx]
- "pages_socialpage_socialpage": "SocialPage()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L40 | neighbors=[SocialPage.tsx, main.tsx]
- "pages_supplierpage_packinglist": "PackingList()" | kind=code-symbol | source=app/src/pages/SupplierPage.tsx:L38 | neighbors=[ShopPage.tsx, SupplierPage.tsx]
- "pages_supplierpage_packinglotpage": "PackingLotPage()" | kind=code-symbol | source=app/src/pages/SupplierPage.tsx:L110 | neighbors=[SupplierPage.tsx, main.tsx]
- "pages_supplierpage_supplierpage": "SupplierPage()" | kind=code-symbol | source=app/src/pages/SupplierPage.tsx:L18 | neighbors=[SupplierPage.tsx, main.tsx]
- "pages_wantedpage_wantdialog": "WantDialog()" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L326 | neighbors=[WantedPage.tsx, othersLine()]
- "pages_wantedpage_wantedpage": "WantedPage()" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L23 | neighbors=[SocialPage.tsx, WantedPage.tsx]
- "pages_wantedpage_wantrow": "WantRow()" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L174 | neighbors=[WantedPage.tsx, othersLine()]
- "scripts_live_browser_applyplaceholdersizingstyles": "applyPlaceholderSizingStyles()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1850 | neighbors=[live-browser.js, createInsertPlaceholder()]
- "scripts_live_browser_attachsteerfocusguard": "attachSteerFocusGuard()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L10122 | neighbors=[live-browser.js, init()]
- "scripts_live_browser_begineditpin": "beginEditPin()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L825 | neighbors=[live-browser.js, onAnnotUp()]
- "scripts_live_browser_bindconfigurecountpilltooltip": "bindConfigureCountPillTooltip()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1551 | neighbors=[live-browser.js, buildConfigureCountControl()]
- "scripts_live_browser_bindeditbadgeproxy": "bindEditBadgeProxy()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4572 | neighbors=[live-browser.js, syncEditBadgeHitProxies()]
- "scripts_live_browser_buildcolormodels": "buildColorModels()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12364 | neighbors=[live-browser.js, renderDesignVisual()]
- "scripts_live_browser_builddesignheader": "buildDesignHeader()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12172 | neighbors=[live-browser.js, renderDesignChrome()]
- "scripts_live_browser_buildinsertplaceholdersnapshotfromdom": "buildInsertPlaceholderSnapshotFromDom()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L2101 | neighbors=[live-browser.js, handleInsertCreate()]
- "scripts_live_browser_buildlocatorforleaf": "buildLocatorForLeaf()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3586 | neighbors=[live-browser.js, applyEditing()]
- "scripts_live_browser_buildpickedanchorsnapshot": "buildPickedAnchorSnapshot()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5043 | neighbors=[live-browser.js, handleGo()]
- "scripts_live_browser_buildpinelement": "buildPinElement()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L788 | neighbors=[live-browser.js, buildAnnotationsForCapture()]
- "scripts_live_browser_buildradiimodels": "buildRadiiModels()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12403 | neighbors=[live-browser.js, renderDesignVisual()]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-029.json

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
