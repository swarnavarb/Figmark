# Node Description Batch 49 of 55

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

- "pages_shoppage_rejectorder": "RejectOrder()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L1366 | neighbors=[ShopPage.tsx]
- "pages_shoppage_routeintro": "RouteIntro()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L149 | neighbors=[ShopPage.tsx]
- "pages_shoppage_section": "Section" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L45 | neighbors=[ShopPage.tsx]
- "pages_shoppage_sections": "SECTIONS" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L47 | neighbors=[ShopPage.tsx]
- "pages_shoppage_shopconsole": "ShopConsole()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L217 | neighbors=[ShopPage.tsx]
- "pages_shoppage_shopstart": "ShopStart()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L180 | neighbors=[ShopPage.tsx]
- "pages_shoppage_stat": "Stat()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L2334 | neighbors=[ShopPage.tsx]
- "pages_shoppage_storefronteditor": "StorefrontEditor()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L320 | neighbors=[ShopPage.tsx]
- "pages_shoppage_templateform": "TemplateForm()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L876 | neighbors=[ShopPage.tsx]
- "pages_shoppage_templatespanel": "TemplatesPanel()" | kind=code-symbol | source=app/src/pages/ShopPage.tsx:L784 | neighbors=[ShopPage.tsx]
- "pages_socialpage_channelcomposer": "ChannelComposer()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L345 | neighbors=[SocialPage.tsx]
- "pages_socialpage_channelmessage": "ChannelMessage()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L307 | neighbors=[SocialPage.tsx]
- "pages_socialpage_channels": "Channels()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L136 | neighbors=[SocialPage.tsx]
- "pages_socialpage_composer": "Composer()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L565 | neighbors=[SocialPage.tsx]
- "pages_socialpage_followingfeed": "FollowingFeed()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L94 | neighbors=[SocialPage.tsx]
- "pages_socialpage_forums": "Forums()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L462 | neighbors=[SocialPage.tsx]
- "pages_socialpage_postview": "PostView()" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L639 | neighbors=[SocialPage.tsx]
- "pages_socialpage_view": "View" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L20 | neighbors=[SocialPage.tsx]
- "pages_socialpage_views": "VIEWS" | kind=code-symbol | source=app/src/pages/SocialPage.tsx:L22 | neighbors=[SocialPage.tsx]
- "pages_wantedpage_askdialog": "AskDialog()" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L245 | neighbors=[WantedPage.tsx]
- "pages_wantedpage_wantbody": "WantBody()" | kind=code-symbol | source=app/src/pages/WantedPage.tsx:L214 | neighbors=[WantedPage.tsx]
- "scripts_azure_check_describe": "describe()" | kind=code-symbol | source=scripts/azure-check.mjs:L195 | neighbors=[azure-check.mjs]
- "scripts_azure_check_failed": "failed" | kind=code-symbol | source=scripts/azure-check.mjs:L188 | neighbors=[azure-check.mjs]
- "scripts_azure_check_loadsettings": "loadSettings()" | kind=code-symbol | source=scripts/azure-check.mjs:L22 | neighbors=[azure-check.mjs]
- "scripts_azure_check_record": "record()" | kind=code-symbol | source=scripts/azure-check.mjs:L54 | neighbors=[azure-check.mjs]
- "scripts_azure_check_require": "require" | kind=code-symbol | source=scripts/azure-check.mjs:L17 | neighbors=[azure-check.mjs]
- "scripts_azure_check_results": "results" | kind=code-symbol | source=scripts/azure-check.mjs:L53 | neighbors=[azure-check.mjs]
- "scripts_azure_check_skipped": "skipped" | kind=code-symbol | source=scripts/azure-check.mjs:L189 | neighbors=[azure-check.mjs]
- "scripts_azure_check_timeout_ms": "TIMEOUT_MS" | kind=code-symbol | source=scripts/azure-check.mjs:L39 | neighbors=[azure-check.mjs]
- "scripts_azure_check_withtimeout": "withTimeout()" | kind=code-symbol | source=scripts/azure-check.mjs:L41 | neighbors=[azure-check.mjs]
- "scripts_check_containers_check": "check()" | kind=code-symbol | source=scripts/check-containers.mjs:L21 | neighbors=[check-containers.mjs]
- "scripts_check_containers_paths": "paths()" | kind=code-symbol | source=scripts/check-containers.mjs:L28 | neighbors=[check-containers.mjs]
- "scripts_check_queries_all": "all" | kind=code-symbol | source=scripts/check-queries.mjs:L62 | neighbors=[check-queries.mjs]
- "scripts_check_queries_check": "check()" | kind=code-symbol | source=scripts/check-queries.mjs:L25 | neighbors=[check-queries.mjs]
- "scripts_check_queries_code_pieces_allstrings": "{ code, pieces: allStrings }" | kind=code-symbol | source=scripts/check-queries.mjs:L162 | neighbors=[check-queries.mjs]
- "scripts_check_queries_parameterlist": "parameterList()" | kind=code-symbol | source=scripts/check-queries.mjs:L204 | neighbors=[check-queries.mjs]
- "scripts_check_queries_queries": "queries()" | kind=code-symbol | source=scripts/check-queries.mjs:L48 | neighbors=[check-queries.mjs]
- "scripts_check_queries_reserved": "RESERVED" | kind=code-symbol | source=scripts/check-queries.mjs:L38 | neighbors=[check-queries.mjs]
- "scripts_check_queries_scan": "scan()" | kind=code-symbol | source=scripts/check-queries.mjs:L130 | neighbors=[check-queries.mjs]
- "scripts_check_queries_statements": "statements()" | kind=code-symbol | source=scripts/check-queries.mjs:L167 | neighbors=[check-queries.mjs]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-048.json

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
