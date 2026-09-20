# Graph Report - .  (2026-09-20)

## Corpus Check
- 188 files · ~381,335 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2161 nodes · 5988 edges · 65 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: contains: 1718 · calls: 1602 · imports: 1137 · MODIFIES: 586 · imports_from: 503 · method: 250 · ON_BRANCH: 100 · PARENT_OF: 49 · inherits: 23 · re_exports: 10 · implements: 6 · rationale_for: 4


## Input Scope
- Requested: auto
- Resolved: committed (source: cli)
- Included files: 188 · Candidates: 238
- Excluded: 2 untracked · 0 ignored · 2 sensitive · 14 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `71eee88`
- Compare this hash to `git rev-parse HEAD` before trusting freshness-sensitive graph output.
## God Nodes (most connected - your core abstractions)
1. `CosmosRepository` - 118 edges
2. `MemoryRepository` - 104 edges
3. `resumeSession()` - 30 edges
4. `setLiveState()` - 29 edges
5. `el()` - 28 edges
6. `api` - 27 edges
7. `injectSvelteComponentsFromManifest()` - 25 edges
8. `handleKeyDown()` - 25 edges
9. `showToast()` - 25 edges
10. `ApiRequestError` - 25 edges

## Surprising Connections (you probably didn't know these)
- `0f35535 Add the Impeccable design skill` --PARENT_OF--> `8cf0d9b Give Figmark a vibrant colour identity`  [EXTRACTED]
  git → git  _Bridges community 12 → community 4_
- `12950fa Give Figmark a typeface, a dense order queue and a real chat` --ON_BRANCH--> `claude/figmark-connection-icpfax`  [EXTRACTED]
  git → git  _Bridges community 34 → community 12_
- `141db1a Routes you can write, and a tracking timeline you can edit` --ON_BRANCH--> `claude/figmark-connection-icpfax`  [EXTRACTED]
  git → git  _Bridges community 43 → community 12_
- `27d0f52 Announcements are a choice the shop makes, not everything it says` --ON_BRANCH--> `claude/figmark-connection-icpfax`  [EXTRACTED]
  git → git  _Bridges community 26 → community 12_
- `543c531 Joining a lot is an event, not a rung on the ladder` --PARENT_OF--> `b36b0b9 Stop the warehouse tick claiming the crate has left, and make the lot editable`  [EXTRACTED]
  git → git  _Bridges community 43 → community 44_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (116): applyGlobalBarLabelState(), applyPlaceholderSizingStyles(), averageRgb01(), buildAnnotationsForCapture(), buildCollapsible(), buildColorModels(), buildDesignHeader(), buildPinElement() (+108 more)

### Community 1 - "Community 1"
Cohesion: 0.05
Nodes (94): 6d70f64 Make a broken deployment say which container is missing, d820fb9 The order lifecycle: hold the money, confirm delivery, rate each other, efdbcff `from` is a reserved word in Cosmos SQL, and the inbox query used it, f1b6577 An operations console, escrow as a granted right, and disputes both sides can work, CATALOG_ORDER, IdentifierReservation, normaliseIdentifier(), BackendStatus (+86 more)

### Community 2 - "Community 2"
Cohesion: 0.02
Nodes (2): MemoryRepository, Repository

### Community 3 - "Community 3"
Cohesion: 0.05
Nodes (2): CosmosRepository, Repository

### Community 4 - "Community 4"
Cohesion: 0.06
Nodes (57): 8cf0d9b Give Figmark a vibrant colour identity, aa99b23 Usernames, shops as the only way to list, packing access, and messages, b269064 Create missing Cosmos containers, and give a person their own username, CategoryIcon(), MARKS, FillBlock(), FillGap(), FillKey() (+49 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (40): AuthService, hasSessionCookie(), MockAuthProvider, readToken(), readTokens(), toAuthUser(), AuthService, ClientPrincipal (+32 more)

### Community 6 - "Community 6"
Cohesion: 0.08
Nodes (69): applyEditing(), beginNewLiveConfiguration(), buildInsertPlaceholderSnapshotFromDom(), buildLocatorForLeaf(), buildPickedAnchorSnapshot(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure() (+61 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (57): LotPeople(), LotBoardPage(), byCustomer(), CheckpointCount, countCheckpoints(), LotTally, tally(), CHECKPOINT_LABELS (+49 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (50): getRepository(), accept(), acceptDisputeRoute, anon, escalate(), escalateDisputeRoute, escrowHoldingsRoute, evidenceFrom() (+42 more)

### Community 9 - "Community 9"
Cohesion: 0.09
Nodes (51): ae(), be(), bt(), Ce(), Ct(), de(), dt(), _e() (+43 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (39): anon, defaultVoice(), handlesFor(), inbox(), inboxRoute, partyFor(), publicProfileRoute, Repo (+31 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (46): CAPABILITIES, ConditionTag, DISPUTE_OUTCOMES, DISPUTE_REASONS, DISPUTE_STATUSES, DisputeOutcome, DisputeStatus, ESCROW_STATES (+38 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (37): claude/figmark-connection-icpfax, claude/new-session-13ackt, 0326170 Maintenance ran in front of every request, on every cold worker, 0460f84 The links were there and looked exactly like plain text, 06b6faa Init cost 157 sequential round trips, so the console never finished loading, 0f35535 Add the Impeccable design skill, 119ed59 Add Emil Kowalski's design and animation skills, 121777a A page at /<username>, and a record on it a stranger can check (+29 more)

### Community 13 - "Community 13"
Cohesion: 0.05
Nodes (25): 71eee88 The exporter was the supplier all along, Tile(), RouteEditor(), Drill, DRILL_HINTS, ESCROW_WORDS, OrderFilter, OrderRow() (+17 more)

### Community 14 - "Community 14"
Cohesion: 0.07
Nodes (31): getAuthService(), healthRoute, error(), handler(), json(), storeStatus(), toErrorResponse(), insights() (+23 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (37): AuthPage(), FeedPage(), ListingPage(), LotsPage(), RouteEditorPage(), RoutesPage(), ConsignmentsPage(), DistributionPage() (+29 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (43): applyParamDefaults(), applyParamValue(), applyPlaceholderDimensions(), buildParamsPanel(), closedClipPath(), commitAcceptedVariantToDom(), completeParameterGenerationIfReady(), completeParameterPublication() (+35 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (42): armPageChatForTyping(), attachSteerFocusDebug(), clearSteerAwaitTimer(), collapsePageChat(), configureVoiceContext(), expandPageChat(), finishVoiceSession(), focusConfigureInput() (+34 more)

### Community 18 - "Community 18"
Cohesion: 0.10
Nodes (40): actionLabel(), applyConfigureBarChrome(), bindConfigureCountPillTooltip(), bindConfigureInlineControlHover(), buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureRow(), buildConfigureSubmitButton() (+32 more)

### Community 19 - "Community 19"
Cohesion: 0.07
Nodes (36): advanceStage(), advanceStageRoute, anon, assignToLot(), assignToLotRoute, buildLot(), createLot(), createLotRoute (+28 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (19): Modal(), PersonLink(), DisputePage(), EscrowPage(), EvidenceFields(), OrderPage(), DISPUTE_OUTCOME_LABELS, DISPUTE_REASON_LABELS (+11 more)

### Community 21 - "Community 21"
Cohesion: 0.08
Nodes (38): applyOriginalAttrsToSvelteAnchor(), buildSvelteExpressionTextMap(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2(), captureAndEmit(), checkpointPayload(), cloneWithoutElements(), collectTextNodes() (+30 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (27): 8992ccb A fill meter you can join, and a catalog you can narrow, a5a184e Orders, Track, and the stationery a shop lists from, f4ae77f The lot board: count the pieces, not the crate, { CosmosClient }, require, CATALOG_KIND_LABELS, CATALOG_KINDS, CATALOG_SORT_LABELS (+19 more)

### Community 23 - "Community 23"
Cohesion: 0.09
Nodes (33): abandonForeignSession(), abortSvelteComponentInjection(), cleanup(), clearHandled(), clearScrollY(), clearSteerFocusRecoverTimer(), copyToClipboard(), discardedWrappers() (+25 more)

### Community 24 - "Community 24"
Cohesion: 0.10
Nodes (33): agentHasWorkInFlight(), agentStatusText(), attachSteerFocusGuard(), barPaletteForTheme(), brandMarkSvg(), buildSteerProcessingDots(), buildSteerQueueHint(), connectSSE() (+25 more)

### Community 25 - "Community 25"
Cohesion: 0.12
Nodes (29): advanceAll(), advancePowerSale(), dueAt(), finishesAt(), listingFor(), minutes(), releaseItems(), Repo (+21 more)

### Community 26 - "Community 26"
Cohesion: 0.09
Nodes (18): 27d0f52 Announcements are a choice the shop makes, not everything it says, 843b46a +Me, and a bell that tells everyone who pressed it, a2f74f9 A channel is a shop's room, and it can be spoken in, dc5dc06 Notifications for the rest of it, and +Me from the list, f26bb32 Wanted: the half of the market that never says anything, View, VIEWS, othersLine() (+10 more)

### Community 27 - "Community 27"
Cohesion: 0.11
Nodes (28): anon, checkout(), checkoutRoute, claimPayment(), claimPaymentRoute, confirm(), confirmRoute, hasAnyDetail() (+20 more)

### Community 28 - "Community 28"
Cohesion: 0.07
Nodes (19): addItemsRoute, anon, deleteRouteRoute, listRoutesRoute, lotCandidates(), lotCandidatesRoute, myItemsRoute, namesFor() (+11 more)

### Community 29 - "Community 29"
Cohesion: 0.09
Nodes (17): emptyLotDetails(), LotDetailFields(), lotDetailsOf(), Modal(), NewLotDialog(), LOT_SECTIONS, LotDetail(), LotSection (+9 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (27): applySavedSessionMeta(), clampVariantIndex(), clearSession(), findActiveSessionSummary(), findAdoptableServerSession(), findAnyVariantsWrapper(), injectVariantsFromSource(), isFrameworkComponentPreviewMode() (+19 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (21): Ladder(), notesByStep(), DIRECT_STAGE_LABELS, DIRECT_STAGES, DirectStage, LOT_STAGE_LABELS, LOT_STAGES, LotStage (+13 more)

### Community 32 - "Community 32"
Cohesion: 0.10
Nodes (22): anon, consignments(), consignmentsRoute, distribution(), distributionDetail(), distributionDetailRoute, distributionRoute, ListingBody (+14 more)

### Community 33 - "Community 33"
Cohesion: 0.09
Nodes (18): auth, bystanderAuth, cookieAuth, ctx, day(), directAuth, escrow, fns (+10 more)

### Community 34 - "Community 34"
Cohesion: 0.10
Nodes (15): 12950fa Give Figmark a typeface, a dense order queue and a real chat, SkeletonRows(), Toast, ToastContext, ToastTone, FILLED, Icon(), IconName (+7 more)

### Community 35 - "Community 35"
Cohesion: 0.10
Nodes (16): PhotoManager(), blankItem(), ItemDraft, PowerSalePanel(), SaleBuilder(), STATUS_LABEL, STATUS_TONE, SellPage() (+8 more)

### Community 36 - "Community 36"
Cohesion: 0.18
Nodes (25): clearStoredManualApplyState(), fetchPendingCount(), handleManualEditActivity(), hidePendingApplyDock(), manualApplyLoadingText(), manualApplyStateKey(), manualEditEventForCurrentPage(), numberOrNull() (+17 more)

### Community 37 - "Community 37"
Cohesion: 0.12
Nodes (23): atSellerYet(), BUILT_IN_DESCRIPTIONS, BUILT_IN_SIDES, BUILT_IN_TRIGGERS, coarseStage(), currentStepName(), currentStepOf(), HasSteps (+15 more)

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (15): addCommentRoute, anon, bumpListingRoute, createListingRoute, createOrderRoute, feed(), feedRoute, forwardersRoute (+7 more)

### Community 39 - "Community 39"
Cohesion: 0.12
Nodes (13): admin, AdminDisputeRow, AdminUserDetail, AdminUserRow, post(), request(), Confirm(), DisputesView() (+5 more)

### Community 40 - "Community 40"
Cohesion: 0.14
Nodes (22): adminDeleteResourceRoute, adminDeleteUserRoute, adminDisputesRoute, adminEscrowRoute, adminResolveRoute, adminSuspendRoute, adminUserDetailRoute, adminUsersRoute (+14 more)

### Community 41 - "Community 41"
Cohesion: 0.13
Nodes (17): anon, channelsRoute, channelThread(), channelThreadRoute, createForum(), createForumRoute, createPostRoute, decorate() (+9 more)

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (21): addManualContextText(), canRestoreManualEditElement(), collectManualContextPieces(), contextElementForManualEdit(), directMixedTextRestoreNodes(), documentRefClassSuffix(), documentRefIdSuffix(), documentRefSegment() (+13 more)

### Community 43 - "Community 43"
Cohesion: 0.15
Nodes (14): 141db1a Routes you can write, and a tracking timeline you can edit, 543c531 Joining a lot is an event, not a rung on the ladder, 74942be One lot card, and a lot page with four faces, 84e162a Bind a step to the button that moves it, 89d4620 Ask a new shop how its stock travels, before it has anything to ship, c501457 Put Routes on the Track tab, where Track actually lives, RouteBuilder(), RowProps (+6 more)

### Community 44 - "Community 44"
Cohesion: 0.11
Nodes (13): b36b0b9 Stop the warehouse tick claiming the crate has left, and make the lot editable, ced09f4 A lot's ladder is the lot's steps; an item's is the whole journey, NewLotBody, ALLOWED_TYPES, anon, assignOrderToLotRoute, deleteTemplateRoute, listTemplatesRoute (+5 more)

### Community 45 - "Community 45"
Cohesion: 0.17
Nodes (16): alsoMe(), anon, card(), close(), expiryFrom(), findWant(), notifySeekers(), offer() (+8 more)

### Community 46 - "Community 46"
Cohesion: 0.18
Nodes (3): autoSeedEnabled(), describeError(), nameFor()

### Community 47 - "Community 47"
Cohesion: 0.14
Nodes (1): isNotFound()

### Community 48 - "Community 48"
Cohesion: 0.23
Nodes (14): acceptedDomAlreadyClean(), clearHandledWrapperReloadStamp(), commitAcceptedSvelteComponentToDom(), deferredRecoverySuperseded(), ensureAcceptedDomClean(), findAcceptedRuntimeWrappers(), handledWrapperReloadKey(), maybeCompleteAcceptedSession() (+6 more)

### Community 49 - "Community 49"
Cohesion: 0.20
Nodes (14): beginEditPin(), cancelEditingPin(), canCreateInsert(), finalizeEditingPin(), hideInsertCreateTooltip(), insertCreateDisabledReason(), insertCreateGateState(), onAnnotDown() (+6 more)

### Community 50 - "Community 50"
Cohesion: 0.15
Nodes (1): AuthError

### Community 51 - "Community 51"
Cohesion: 0.15
Nodes (12): byName, byRoute, byShape, conflicts, dir, files, registrations, repeated (+4 more)

### Community 52 - "Community 52"
Cohesion: 0.15
Nodes (7): base, calls, containers, halfSeeded, repaired, repository, unreachable

### Community 53 - "Community 53"
Cohesion: 0.20
Nodes (9): SOURCING, BUILT_IN_ROUTE, LotRoute, RouteStep, BUILT_IN_PRE_LOT_ROUTE, fillFrom(), journeyOf(), preLotRouteOf() (+1 more)

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (3): followKey(), identifiersOf(), likeKey()

### Community 55 - "Community 55"
Cohesion: 0.20
Nodes (5): failed, require, results, skipped, TIMEOUT_MS

### Community 56 - "Community 56"
Cohesion: 0.20
Nodes (4): all, { code, pieces: allStrings }, RESERVED, strings

### Community 57 - "Community 57"
Cohesion: 0.31
Nodes (9): bindEditBadgeProxy(), editBadgeProxyTargets(), initEditBadge(), initEditBadgeHitProxies(), positionEditBadge(), setImportantStyle(), styleEditBadgeProxy(), syncEditBadgeHitProxies() (+1 more)

### Community 58 - "Community 58"
Cohesion: 0.25
Nodes (3): BlobPhotoStore, buildClient(), PhotoStore

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (2): css, parsed

### Community 60 - "Community 60"
Cohesion: 0.48
Nodes (5): matchesScope(), normalizeIgnoreRule(), normalizeIgnoreValue(), pageCandidates(), resolveDetectIgnores()

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (2): MemoryPhotoStore, PhotoStore

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (4): NAVIGATION_FALLBACK, path, ROUTE, TOP_LEVEL

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (1): isConflict()

### Community 65 - "Community 65"
Cohesion: 1.00
Nodes (1): catalogOrder()

## Knowledge Gaps
- **337 isolated node(s):** `NOTE: the compiled component imported from the dev server already carries`, `NOTE: do NOT clear the persistent scroll key here. startScrollLock`, `TODO: Enable this proxy for React/Vue/etc. adapters once their live`, `NOTE: scrollY is stored under a separate key (writeScrollY). Storing`, `ClientPrincipal` (+332 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 2`** (2 nodes): `MemoryRepository`, `Repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 3`** (2 nodes): `CosmosRepository`, `Repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 47`** (1 nodes): `isNotFound()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 50`** (1 nodes): `AuthError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `css`, `parsed`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 61`** (2 nodes): `MemoryPhotoStore`, `PhotoStore`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 63`** (1 nodes): `isConflict()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `catalogOrder()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CosmosRepository` connect `Community 3` to `Community 1`, `Community 47`, `Community 46`, `Community 66`, `Community 63`, `Community 65`, `Community 67`, `Community 68`, `Community 8`?**
  _High betweenness centrality (0.098) - this node is a cross-community bridge._
- **Why does `MemoryRepository` connect `Community 2` to `Community 8`, `Community 1`, `Community 54`?**
  _High betweenness centrality (0.089) - this node is a cross-community bridge._
- **Why does `AuthError` connect `Community 50` to `Community 5`, `Community 19`, `Community 14`?**
  _High betweenness centrality (0.011) - this node is a cross-community bridge._
- **What connects `NOTE: the compiled component imported from the dev server already carries`, `NOTE: do NOT clear the persistent scroll key here. startScrollLock`, `TODO: Enable this proxy for React/Vue/etc. adapters once their live` to the rest of the system?**
  _337 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.026869776790436898 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05175202156334232 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.020833333333333332 - nodes in this community are weakly interconnected._