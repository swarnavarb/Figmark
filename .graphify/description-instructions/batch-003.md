# Node Description Batch 4 of 55

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
For an entity node (any other kind — e.g. a person, place, event, object),
describe what the entity is and its role, grounded in its type, its
relations (neighbors) and the provided citations/evidence — e.g.
"Lady Carfax, a wealthy heiress who disappears en route to Lausanne.".
Ground entity descriptions in the citations/evidence when present; do not
speculate beyond the context, so a node with no supporting context may be
left out of the reply.
Write every description in English (en). Do not switch languages.
No marketing language.
Respond ONLY with a JSON object mapping each node id (as a string) to its
one-sentence description — no prose, no markdown fences.

- "components_lotfields": "LotFields.tsx" | kind=code-symbol | source=app/src/components/LotFields.tsx:L1 | neighbors=[141db1a Routes you can write, and a tra…, c6c033a The batch is the tracking engin…, f4ae77f The lot board: count the pieces…, emptyLotDetails(), Extras(), LotDetailFields()]
- "scripts_live_browser_hidebar": "hideBar()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1186 | neighbors=[live-browser.js, abortSvelteComponentInjection(), cancelEditingToPicking(), cancelInsertConfigure(), cleanup(), cleanupAcceptedSession()]
- "admin_disputesview": "DisputesView.tsx" | kind=code-symbol | source=app/src/admin/DisputesView.tsx:L1 | neighbors=[api.ts, admin, AdminDisputeRow, Confirm.tsx, Confirm(), DisputeDetail()]
- "auth_errors_autherror": "AuthError" | kind=code-symbol | source=api/src/auth/errors.ts:L5 | neighbors=[errors.ts, .accountMissing(), .constructor(), .forbidden(), .invalidCredentials(), .noSession()]
- "commit:repo:github.com/swarnavarb/Figmark@b269064cc0866030b680cee8d8127ec7b3f82bca": "b269064 Create missing Cosmos containers, and give a person their own username" | kind=Commit | source=git | neighbors=[aa99b23 Usernames, shops as the only wa…, mock-provider.ts, claude/figmark-connection-icpfax, claude/new-session-13ackt, 6d70f64 Make a broken deployment say wh…, cosmos-repository.ts]
- "components_ui_emptystate": "EmptyState()" | kind=code-symbol | source=app/src/components/ui.tsx:L89 | neighbors=[LotPeople.tsx, PowerSale.tsx, ui.tsx, EscrowPage.tsx, FeedPage.tsx, ForwardersPage.tsx]
- "functions_health": "health.ts" | kind=code-symbol | source=api/src/functions/health.ts:L1 | neighbors=[6d70f64 Make a broken deployment say wh…, f4ae77f The lot board: count the pieces…, index.ts, getAuthService(), index.ts, getRepository()]
- "pages_authpage": "AuthPage.tsx" | kind=code-symbol | source=app/src/pages/AuthPage.tsx:L1 | neighbors=[aa99b23 Usernames, shops as the only wa…, f4ae77f The lot board: count the pieces…, ui.tsx, ErrorNotice(), AuthPage(), Mode]
- "scripts_live_browser_handleinsertcreate": "handleInsertCreate()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L7858 | neighbors=[live-browser.js, buildInsertPlaceholderSnapshotFromDom(), canCreateInsert(), captureAndEmit(), clearAnnotations(), clearMountErrorCard()]
- "shared_handles": "handles.ts" | kind=code-symbol | source=shared/handles.ts:L1 | neighbors=[mock-provider.ts, 141db1a Routes you can write, and a tra…, aa99b23 Usernames, shops as the only wa…, cosmos-repository.ts, memory-repository.ts, message-routes.ts]
- "shared_models_lot": "Lot" | kind=code-symbol | source=shared/models.ts:L626 | neighbors=[LotFields.tsx, cosmos-repository.ts, memory-repository.ts, repository.ts, seed.ts, fulfilment-routes.ts]
- "commit:repo:github.com/swarnavarb/Figmark@71eee88404ed5f2d4fc25376939993dd908c42f8": "71eee88 The exporter was the supplier all along" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, seed.ts, fulfilment-routes.ts, service-routes.ts, LotsPage.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@f26bb32b964f97cb1a52e420cbd4c7f2b1f608de": "f26bb32 Wanted: the half of the market that never says anything" | kind=Commit | source=git | neighbors=[27d0f52 Announcements are a choice the …, claude/figmark-connection-icpfax, claude/new-session-13ackt, 843b46a +Me, and a bell that tells ever…, cosmos-repository.ts, memory-repository.ts]
- "scripts_live_browser_init": "init()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12937 | neighbors=[live-browser.js, attachSteerFocusDebug(), attachSteerFocusGuard(), connectSSE(), fetchPendingCount(), initActionPicker()]
- "scripts_live_browser_rendereditbadge": "renderEditBadge()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L4690 | neighbors=[live-browser.js, applyEditing(), cancelEditing(), cancelEditingToPicking(), cleanup(), cleanupAcceptedSession()]
- "shared_index": "index.ts" | kind=code-symbol | source=shared/index.ts:L1 | neighbors=[8992ccb A fill meter you can join, and …, a5a184e Orders, Track, and the statione…, b1179de Pro analytics off the packing b…, e492525 A Services tab, and the people …, f4ae77f The lot board: count the pieces…, capabilities.ts]
- "src_format_formatmoney": "formatMoney()" | kind=code-symbol | source=app/src/format.ts:L2 | neighbors=[DisputesView.tsx, UsersView.tsx, PowerSale.tsx, DisputePage.tsx, EscrowPage.tsx, FeedPage.tsx]
- "admin_main": "main.tsx" | kind=code-symbol | source=app/src/admin/main.tsx:L1 | neighbors=[api.ts, admin, DisputesView.tsx, DisputesView(), BackendStatus(), Console()]
- "auth_mock_provider_mockauthprovider": "MockAuthProvider" | kind=code-symbol | source=api/src/auth/mock-provider.ts:L41 | neighbors=[index.ts, mock-provider.ts, AuthService, .constructor(), .getCurrentUser(), .listDemoAccounts()]
- "commit:repo:github.com/swarnavarb/Figmark@320bbe50f3d8b9ee0503cd018c7e9a50fbc177b6": "320bbe5 A members' window that actually withholds something, and one place for …" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, b1179de Pro analytics off the packing b…, PowerSale.tsx, cosmos-repository.ts, memory-repository.ts]
- "commit:repo:github.com/swarnavarb/Figmark@543c5311d71d85900e07800aac235f03c8631823": "543c531 Joining a lot is an event, not a rung on the ladder" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, b36b0b9 Stop the warehouse tick claimin…, Ladder.tsx, RouteBuilder.tsx, catalog-routes.ts]
- "commit:repo:github.com/swarnavarb/Figmark@dc5dc06732ac8d9fe5643d6b1ca03c2a6d9f9d27": "dc5dc06 Notifications for the rest of it, and +Me from the list" | kind=Commit | source=git | neighbors=[843b46a +Me, and a bell that tells ever…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 8992ccb A fill meter you can join, and …, cosmos-repository.ts, memory-repository.ts]
- "components_fillmeter": "FillMeter.tsx" | kind=code-symbol | source=app/src/components/FillMeter.tsx:L1 | neighbors=[8992ccb A fill meter you can join, and …, 8cf0d9b Give Figmark a vibrant colour i…, FacePile(), FillBlock(), FillGap(), FillKey()]
- "functions_notify": "notify.ts" | kind=code-symbol | source=api/src/functions/notify.ts:L1 | neighbors=[dc5dc06 Notifications for the rest of i…, dispute-routes.ts, fulfilment-routes.ts, index.ts, getRepository(), NoticeDraft]
- "pages_lotboardpage": "LotBoardPage.tsx" | kind=code-symbol | source=app/src/pages/LotBoardPage.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 44f8ea3 Label the warehouse toggle, and…, 74942be One lot card, and a lot page wi…, f4ae77f The lot board: count the pieces…, LotPeople.tsx, LotPeople()]
- "scripts_live_browser_mountsveltecomponentvariant": "mountSvelteComponentVariant()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L5619 | neighbors=[live-browser.js, injectSvelteComponentsFromManifest(), applyOriginalAttrsToSvelteAnchor(), clearMountErrorCard(), componentModuleCandidates(), describeMountFailure()]
- "scripts_live_browser_renderdesignvisual": "renderDesignVisual()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L12324 | neighbors=[live-browser.js, renderDesignBody(), buildColorModels(), buildRadiiModels(), buildTypographyModels(), designEmptyMessage()]
- "scripts_live_browser_showmanualapplybusytoast": "showManualApplyBusyToast()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L3876 | neighbors=[live-browser.js, applyEditing(), enterEditingMode(), handleAccept(), handleClick(), handleDiscard()]
- "scripts_live_browser_updatebarcontent": "updateBarContent()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L1202 | neighbors=[live-browser.js, handleAccept(), maybeCompleteAcceptedSession(), refreshLiveControlsForManualApply(), showOrUpdateCyclingBar(), applyConfigureBarChrome()]
- "src_format_timeago": "timeAgo()" | kind=code-symbol | source=app/src/format.ts:L23 | neighbors=[DisputesView.tsx, Notifications.tsx, PowerSale.tsx, DisputePage.tsx, EscrowPage.tsx, FeedPage.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@44846663184b33fe1cf74b382b01f21141d7d0d9": "4484666 Buying is two transactions, not a tick box on one" | kind=Commit | source=git | neighbors=[29bd178 The Functions host keeps /admin…, claude/figmark-connection-icpfax, claude/new-session-13ackt, 466681d Buy now skipped the checkout it…, seed.ts, order-routes.ts]
- "commit:repo:github.com/swarnavarb/Figmark@b36b0b92762524be73b1088bf07756cfbcf9ec5e": "b36b0b9 Stop the warehouse tick claiming the crate has left, and make the lot e…" | kind=Commit | source=git | neighbors=[543c531 Joining a lot is an event, not …, claude/figmark-connection-icpfax, claude/new-session-13ackt, ced09f4 A lot's ladder is the lot's ste…, Ladder.tsx, fulfilment-routes.ts]
- "functions_notification_routes": "notification-routes.ts" | kind=code-symbol | source=api/src/functions/notification-routes.ts:L1 | neighbors=[843b46a +Me, and a bell that tells ever…, index.ts, getAuthService(), index.ts, getRepository(), http.ts]
- "scripts_check_routes": "check-routes.mjs" | kind=code-symbol | source=scripts/check-routes.mjs:L1 | neighbors=[29bd178 The Functions host keeps /admin…, 4e0f732 A route module can be present, …, f4ae77f The lot board: count the pieces…, byName, byRoute, byShape]
- "scripts_live_browser_barpalettefortheme": "barPaletteForTheme()" | kind=code-symbol | source=.agents/skills/impeccable/scripts/live-browser.js:L9863 | neighbors=[live-browser.js, buildParamsPanel(), configureBarPalette(), ensureAgentPollTooltip(), initActionPicker(), initBar()]
- "shared_parties": "parties.ts" | kind=code-symbol | source=shared/parties.ts:L1 | neighbors=[e057084 Every name is an address, and e…, catalog-routes.ts, dispute-routes.ts, insight-routes.ts, order-routes.ts, preorder.ts]
- "src_appshell": "AppShell.tsx" | kind=code-symbol | source=app/src/AppShell.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, 613ff69 Rebuild the sell tab: one door …, 6d70f64 Make a broken deployment say wh…, 843b46a +Me, and a bell that tells ever…, f4ae77f The lot board: count the pieces…, Notifications.tsx]
- "commit:repo:github.com/swarnavarb/Figmark@6d70f646b8cae93bd3d367c3952d3e35d244ed99": "6d70f64 Make a broken deployment say which container is missing" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, efdbcff `from` is a reserved word in Co…, cosmos-repository.ts, memory-repository.ts, repository.ts]
- "commit:repo:github.com/swarnavarb/Figmark@7b5199d987e3afffedf68a4a615895c2ce2fbb44": "7b5199d Filters that fit, tabs that hold together, fixtures that don't expire" | kind=Commit | source=git | neighbors=[claude/figmark-connection-icpfax, claude/new-session-13ackt, 613ff69 Rebuild the sell tab: one door …, TabBar.tsx, cosmos-repository.ts, memory-repository.ts]
- "components_feedback": "Feedback.tsx" | kind=code-symbol | source=app/src/components/Feedback.tsx:L1 | neighbors=[12950fa Give Figmark a typeface, a dens…, Skeleton(), SkeletonGrid(), SkeletonRows(), SkeletonText(), Toast]

## Instructions

Write a single JSON object mapping each node id to a one-sentence description
to: /home/user/Figmark/.graphify/description-instructions/batch-003.json

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
