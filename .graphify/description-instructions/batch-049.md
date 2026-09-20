# Node Description Batch 50 of 55

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

- "scripts_check_queries_strings": "strings" | kind=code-symbol | source=scripts/check-queries.mjs:L165 | neighbors=[check-queries.mjs]
- "scripts_check_routes_byname": "byName" | kind=code-symbol | source=scripts/check-routes.mjs:L53 | neighbors=[check-routes.mjs]
- "scripts_check_routes_byroute": "byRoute" | kind=code-symbol | source=scripts/check-routes.mjs:L31 | neighbors=[check-routes.mjs]
- "scripts_check_routes_byshape": "byShape" | kind=code-symbol | source=scripts/check-routes.mjs:L66 | neighbors=[check-routes.mjs]
- "scripts_check_routes_conflicts": "conflicts" | kind=code-symbol | source=scripts/check-routes.mjs:L36 | neighbors=[check-routes.mjs]
- "scripts_check_routes_dir": "dir" | kind=code-symbol | source=scripts/check-routes.mjs:L14 | neighbors=[check-routes.mjs]
- "scripts_check_routes_files": "files" | kind=code-symbol | source=scripts/check-routes.mjs:L15 | neighbors=[check-routes.mjs]
- "scripts_check_routes_registrations": "registrations" | kind=code-symbol | source=scripts/check-routes.mjs:L17 | neighbors=[check-routes.mjs]
- "scripts_check_routes_repeated": "repeated" | kind=code-symbol | source=scripts/check-routes.mjs:L57 | neighbors=[check-routes.mjs]
- "scripts_check_routes_reserved": "reserved" | kind=code-symbol | source=scripts/check-routes.mjs:L86 | neighbors=[check-routes.mjs]
- "scripts_check_routes_reserved_prefixes": "RESERVED_PREFIXES" | kind=code-symbol | source=scripts/check-routes.mjs:L85 | neighbors=[check-routes.mjs]
- "scripts_check_routes_shaped": "shaped" | kind=code-symbol | source=scripts/check-routes.mjs:L71 | neighbors=[check-routes.mjs]
- "scripts_check_routes_unimported": "unimported" | kind=code-symbol | source=scripts/check-routes.mjs:L102 | neighbors=[check-routes.mjs]
- "scripts_check_styles_bareclasses": "bareClasses()" | kind=code-symbol | source=scripts/check-styles.mjs:L73 | neighbors=[check-styles.mjs]
- "scripts_check_styles_check": "check()" | kind=code-symbol | source=scripts/check-styles.mjs:L19 | neighbors=[check-styles.mjs]
- "scripts_check_styles_css": "css" | kind=code-symbol | source=scripts/check-styles.mjs:L16 | neighbors=[check-styles.mjs]
- "scripts_check_styles_displayof": "displayOf()" | kind=code-symbol | source=scripts/check-styles.mjs:L60 | neighbors=[check-styles.mjs]
- "scripts_check_styles_parsed": "parsed" | kind=code-symbol | source=scripts/check-styles.mjs:L81 | neighbors=[check-styles.mjs]
- "scripts_check_styles_rules": "rules()" | kind=code-symbol | source=scripts/check-styles.mjs:L32 | neighbors=[check-styles.mjs]
- "scripts_check_swa_config_check": "check()" | kind=code-symbol | source=scripts/check-swa-config.mjs:L22 | neighbors=[check-swa-config.mjs]
- "scripts_check_swa_config_navigation_fallback": "NAVIGATION_FALLBACK" | kind=code-symbol | source=scripts/check-swa-config.mjs:L33 | neighbors=[check-swa-config.mjs]
- "scripts_check_swa_config_path": "path" | kind=code-symbol | source=scripts/check-swa-config.mjs:L18 | neighbors=[check-swa-config.mjs]
- "scripts_check_swa_config_route": "ROUTE" | kind=code-symbol | source=scripts/check-swa-config.mjs:L32 | neighbors=[check-swa-config.mjs]
- "scripts_check_swa_config_top_level": "TOP_LEVEL" | kind=code-symbol | source=scripts/check-swa-config.mjs:L28 | neighbors=[check-swa-config.mjs]
- "scripts_dev_server_apiroot": "apiRoot" | kind=code-symbol | source=scripts/dev-server.mjs:L18 | neighbors=[dev-server.mjs]
- "scripts_dev_server_matchroute": "matchRoute()" | kind=code-symbol | source=scripts/dev-server.mjs:L216 | neighbors=[dev-server.mjs]
- "scripts_dev_server_mime": "MIME" | kind=code-symbol | source=scripts/dev-server.mjs:L199 | neighbors=[dev-server.mjs]
- "scripts_dev_server_port": "port" | kind=code-symbol | source=scripts/dev-server.mjs:L330 | neighbors=[dev-server.mjs]
- "scripts_dev_server_readbody": "readBody()" | kind=code-symbol | source=scripts/dev-server.mjs:L239 | neighbors=[dev-server.mjs]
- "scripts_dev_server_root": "root" | kind=code-symbol | source=scripts/dev-server.mjs:L16 | neighbors=[dev-server.mjs]
- "scripts_dev_server_routes": "routes" | kind=code-symbol | source=scripts/dev-server.mjs:L84 | neighbors=[dev-server.mjs]
- "scripts_dev_server_server": "server" | kind=code-symbol | source=scripts/dev-server.mjs:L269 | neighbors=[dev-server.mjs]
- "scripts_dev_server_setcookiesof": "setCookiesOf()" | kind=code-symbol | source=scripts/dev-server.mjs:L257 | neighbors=[dev-server.mjs]
- "scripts_dev_server_staticroot": "staticRoot" | kind=code-symbol | source=scripts/dev-server.mjs:L17 | neighbors=[dev-server.mjs]
- "scripts_live_browser_bindconfiguremodifierpillhover": "bindConfigureModifierPillHover()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1381 | neighbors=[live-browser.js]
- "scripts_live_browser_buffertobase64": "bufferToBase64()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7956 | neighbors=[live-browser.js]
- "scripts_live_browser_buildlisthtml": "buildListHtml()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12884 | neighbors=[live-browser.js]
- "scripts_live_browser_collectvisibletexts": "collectVisibleTexts()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5533 | neighbors=[live-browser.js]
- "scripts_live_browser_cssident": "cssIdent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4478 | neighbors=[live-browser.js]
- "scripts_live_browser_cycleselectedcount": "cycleSelectedCount()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1587 | neighbors=[live-browser.js]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-049.json

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
