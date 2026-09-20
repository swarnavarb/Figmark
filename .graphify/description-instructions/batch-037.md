# Node Description Batch 38 of 55

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

- "admin_main_backendstatus": "BackendStatus()" | kind=code-symbol | source=app/src/admin/main.tsx:L115 | neighbors=[main.tsx]
- "admin_main_console": "Console()" | kind=code-symbol | source=app/src/admin/main.tsx:L31 | neighbors=[main.tsx]
- "admin_main_container": "container" | kind=code-symbol | source=app/src/admin/main.tsx:L196 | neighbors=[main.tsx]
- "admin_main_signin": "SignIn()" | kind=code-symbol | source=app/src/admin/main.tsx:L151 | neighbors=[main.tsx]
- "admin_main_tab": "Tab" | kind=code-symbol | source=app/src/admin/main.tsx:L29 | neighbors=[main.tsx]
- "admin_usersview_escrowpanel": "EscrowPanel()" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L287 | neighbors=[UsersView.tsx]
- "admin_usersview_pending": "Pending" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L101 | neighbors=[UsersView.tsx]
- "admin_usersview_resourceitem": "ResourceItem" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L381 | neighbors=[UsersView.tsx]
- "admin_usersview_resourcelist": "ResourceList()" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L389 | neighbors=[UsersView.tsx]
- "admin_usersview_userdetail": "UserDetail()" | kind=code-symbol | source=app/src/admin/UsersView.tsx:L106 | neighbors=[UsersView.tsx]
- "auth_errors_autherror_accountmissing": ".accountMissing()" | kind=code-symbol | source=api/src/auth/errors.ts:L91 | neighbors=[AuthError]
- "auth_errors_autherror_constructor": ".constructor()" | kind=code-symbol | source=api/src/auth/errors.ts:L17 | neighbors=[AuthError]
- "auth_errors_autherror_forbidden": ".forbidden()" | kind=code-symbol | source=api/src/auth/errors.ts:L76 | neighbors=[AuthError]
- "auth_errors_autherror_invalidcredentials": ".invalidCredentials()" | kind=code-symbol | source=api/src/auth/errors.ts:L80 | neighbors=[AuthError]
- "auth_errors_autherror_nosession": ".noSession()" | kind=code-symbol | source=api/src/auth/errors.ts:L37 | neighbors=[AuthError]
- "auth_errors_autherror_notimplemented": ".notImplemented()" | kind=code-symbol | source=api/src/auth/errors.ts:L117 | neighbors=[AuthError]
- "auth_errors_autherror_sessionended": ".sessionEnded()" | kind=code-symbol | source=api/src/auth/errors.ts:L67 | neighbors=[AuthError]
- "auth_errors_autherror_sessionexpired": ".sessionExpired()" | kind=code-symbol | source=api/src/auth/errors.ts:L62 | neighbors=[AuthError]
- "auth_errors_autherror_sessionunverified": ".sessionUnverified()" | kind=code-symbol | source=api/src/auth/errors.ts:L52 | neighbors=[AuthError]
- "auth_errors_autherror_signinunavailable": ".signInUnavailable()" | kind=code-symbol | source=api/src/auth/errors.ts:L109 | neighbors=[AuthError]
- "auth_errors_autherror_suspended": ".suspended()" | kind=code-symbol | source=api/src/auth/errors.ts:L113 | neighbors=[AuthError]
- "auth_errors_autherror_unauthenticated": ".unauthenticated()" | kind=code-symbol | source=api/src/auth/errors.ts:L25 | neighbors=[AuthError]
- "auth_mock_provider_authservice": "AuthService" | kind=code-symbol | neighbors=[MockAuthProvider]
- "auth_mock_provider_mockauthprovider_constructor": ".constructor()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L53 | neighbors=[MockAuthProvider]
- "auth_mock_provider_mockauthprovider_listdemoaccounts": ".listDemoAccounts()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L333 | neighbors=[MockAuthProvider]
- "auth_mock_provider_mockauthprovider_logincookies": ".loginCookies()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L337 | neighbors=[MockAuthProvider]
- "auth_mock_provider_mockauthprovider_logoutcookies": ".logoutCookies()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L341 | neighbors=[MockAuthProvider]
- "auth_mock_provider_mockauthprovider_storeisephemeral": ".storeIsEphemeral()" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L66 | neighbors=[MockAuthProvider]
- "auth_swa_provider_authservice": "AuthService" | kind=code-symbol | neighbors=[StaticWebAppsAuthProvider]
- "auth_swa_provider_clientprincipal": "ClientPrincipal" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L96 | neighbors=[swa-provider.ts]
- "auth_swa_provider_staticwebappsauthprovider_constructor": ".constructor()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L32 | neighbors=[StaticWebAppsAuthProvider]
- "auth_swa_provider_staticwebappsauthprovider_listdemoaccounts": ".listDemoAccounts()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L83 | neighbors=[StaticWebAppsAuthProvider]
- "auth_swa_provider_staticwebappsauthprovider_login": ".login()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L73 | neighbors=[StaticWebAppsAuthProvider]
- "auth_swa_provider_staticwebappsauthprovider_logincookies": ".loginCookies()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L87 | neighbors=[StaticWebAppsAuthProvider]
- "auth_swa_provider_staticwebappsauthprovider_logout": ".logout()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L79 | neighbors=[StaticWebAppsAuthProvider]
- "auth_swa_provider_staticwebappsauthprovider_logoutcookies": ".logoutCookies()" | kind=code-symbol | source=api/src/auth/swa-provider.ts:L91 | neighbors=[StaticWebAppsAuthProvider]
- "components_categoryicon_marks": "MARKS" | kind=code-symbol | source=app/src/components/CategoryIcon.tsx:L16 | neighbors=[CategoryIcon.tsx]
- "components_feedback_skeleton": "Skeleton()" | kind=code-symbol | source=app/src/components/Feedback.tsx:L20 | neighbors=[Feedback.tsx]
- "components_feedback_skeletongrid": "SkeletonGrid()" | kind=code-symbol | source=app/src/components/Feedback.tsx:L48 | neighbors=[Feedback.tsx]
- "components_feedback_skeletontext": "SkeletonText()" | kind=code-symbol | source=app/src/components/Feedback.tsx:L36 | neighbors=[Feedback.tsx]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-037.json

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
