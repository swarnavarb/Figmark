# Graph Report - .  (2026-09-20)

## Corpus Check
- 248 files · ~429,041 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2255 nodes · 6375 edges · 66 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: contains: 1784 · calls: 1605 · imports: 1158 · MODIFIES: 614 · imports_from: 509 · ON_BRANCH: 338 · method: 251 · PARENT_OF: 72 · inherits: 23 · re_exports: 10 · implements: 7 · rationale_for: 4


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 248 · Candidates: 426
- Excluded: 0 untracked · 17617 ignored · 2 sensitive · 14 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `9bd6ac1`
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
- `0326170 Maintenance ran in front of every request, on every cold worker` --ON_BRANCH--> `development`  [EXTRACTED]
  git → git  _Bridges community 16 → community 48_
- `0ff8f4c Simplify the Sell tab into five cards: Analytics, Manage Store, and an Items to Lots to Routes workflow` --ON_BRANCH--> `development`  [EXTRACTED]
  git → git  _Bridges community 29 → community 48_
- `21a509d Resume Route Builder: mobile-first stage boxes over the existing route model` --ON_BRANCH--> `development`  [EXTRACTED]
  git → git  _Bridges community 10 → community 48_
- `21a509d Resume Route Builder: mobile-first stage boxes over the existing route model` --ON_BRANCH--> `feature/route-builder-stages`  [EXTRACTED]
  git → git  _Bridges community 10 → community 16_
- `29bd178 The Functions host keeps /admin for itself, so those eight routes never existed` --ON_BRANCH--> `chore/azure-swa-development-env`  [EXTRACTED]
  git → git  _Bridges community 40 → community 16_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (116): applyGlobalBarLabelState(), applyPlaceholderSizingStyles(), averageRgb01(), buildAnnotationsForCapture(), buildCollapsible(), buildColorModels(), buildDesignHeader(), buildPinElement() (+108 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (2): MemoryRepository, Repository

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (74): CATALOG_ORDER, IdentifierReservation, normaliseIdentifier(), BackendStatus, CatalogQuery, sessionDigest(), forwarder(), handler() (+66 more)

### Community 3 - "Community 3"
Cohesion: 0.04
Nodes (69): ALLOWED_TYPES, anon, assignOrderToLotRoute, deleteTemplateRoute, listTemplatesRoute, photoRoute, saveTemplateRoute, TemplateBody (+61 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (44): AuthService, hasSessionCookie(), MockAuthProvider, readToken(), readTokens(), toAuthUser(), AuthService, ClientPrincipal (+36 more)

### Community 5 - "Community 5"
Cohesion: 0.05
Nodes (2): CosmosRepository, Repository

### Community 6 - "Community 6"
Cohesion: 0.05
Nodes (58): getAuthService(), error(), handler(), json(), storeStatus(), toErrorResponse(), insights(), insightsRoute (+50 more)

### Community 7 - "Community 7"
Cohesion: 0.04
Nodes (66): LotPeople(), Tile(), LotBoardPage(), PackingList(), PackingLotPage(), SupplierPage(), byCustomer(), CheckpointCount (+58 more)

### Community 8 - "Community 8"
Cohesion: 0.06
Nodes (50): CategoryIcon(), MARKS, FillBlock(), FillGap(), FillKey(), FillMeter(), Avatar(), EmptyState() (+42 more)

### Community 9 - "Community 9"
Cohesion: 0.08
Nodes (69): applyEditing(), beginNewLiveConfiguration(), buildInsertPlaceholderSnapshotFromDom(), buildLocatorForLeaf(), buildPickedAnchorSnapshot(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure() (+61 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (48): 21a509d Resume Route Builder: mobile-first stage boxes over the existing route model, 4300313 Merge route builder stages into development, FILLED, Icon(), IconName, PATHS, Ladder(), notesByStep() (+40 more)

### Community 11 - "Community 11"
Cohesion: 0.09
Nodes (51): ae(), be(), bt(), Ce(), Ct(), de(), dt(), _e() (+43 more)

### Community 12 - "Community 12"
Cohesion: 0.06
Nodes (37): Notifications(), PhotoManager(), TabBar(), AuthPage(), Mode, FeedPage(), ForwardersPage(), ListingPage() (+29 more)

### Community 13 - "Community 13"
Cohesion: 0.04
Nodes (26): RouteEditor(), RoutesList(), Drill, DRILL_HINTS, ESCROW_WORDS, OrderFilter, OrderRow(), orderTone() (+18 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (15): LOT_SECTIONS, LotDetail(), LotSection, NewLotForm(), summarise(), Drill, DRILL_HINTS, ESCROW_WORDS (+7 more)

### Community 15 - "Community 15"
Cohesion: 0.06
Nodes (34): addCommentRoute, anon, bumpListingRoute, createListingRoute, createOrderRoute, feed(), feedRoute, forwardersRoute (+26 more)

### Community 16 - "Community 16"
Cohesion: 0.23
Nodes (44): chore/azure-swa-development-env, claude/figmark-connection-icpfax, claude/new-session-13ackt, feature/route-builder-stages, fix/azure-swa-remove-invalid-input, 0326170 Maintenance ran in front of every request, on every cold worker, 0460f84 The links were there and looked exactly like plain text, 06b6faa Init cost 157 sequential round trips, so the console never finished loading (+36 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (38): getRepository(), accept(), acceptDisputeRoute, anon, escalate(), escalateDisputeRoute, escrowHoldingsRoute, evidenceFrom() (+30 more)

### Community 18 - "Community 18"
Cohesion: 0.07
Nodes (43): applyParamDefaults(), applyParamValue(), applyPlaceholderDimensions(), buildParamsPanel(), closedClipPath(), commitAcceptedVariantToDom(), completeParameterGenerationIfReady(), completeParameterPublication() (+35 more)

### Community 19 - "Community 19"
Cohesion: 0.08
Nodes (42): armPageChatForTyping(), attachSteerFocusDebug(), clearSteerAwaitTimer(), collapsePageChat(), configureVoiceContext(), expandPageChat(), finishVoiceSession(), focusConfigureInput() (+34 more)

### Community 20 - "Community 20"
Cohesion: 0.10
Nodes (40): actionLabel(), applyConfigureBarChrome(), bindConfigureCountPillTooltip(), bindConfigureInlineControlHover(), buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureRow(), buildConfigureSubmitButton() (+32 more)

### Community 21 - "Community 21"
Cohesion: 0.09
Nodes (36): anon, checkout(), checkoutRoute, claimPayment(), claimPaymentRoute, confirm(), confirmRoute, hasAnyDetail() (+28 more)

### Community 22 - "Community 22"
Cohesion: 0.08
Nodes (38): applyOriginalAttrsToSvelteAnchor(), buildSvelteExpressionTextMap(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2(), captureAndEmit(), checkpointPayload(), cloneWithoutElements(), collectTextNodes() (+30 more)

### Community 23 - "Community 23"
Cohesion: 0.06
Nodes (18): SkeletonRows(), Toast, ToastContext, ToastTone, MessagesView(), ThreadPage(), ChannelPage(), SocialPage() (+10 more)

### Community 24 - "Community 24"
Cohesion: 0.07
Nodes (28): blankItem(), ItemDraft, PowerSalePanel(), SaleBuilder(), STATUS_LABEL, STATUS_TONE, othersLine(), WantDialog() (+20 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (17): Modal(), DisputePage(), EscrowPage(), EvidenceFields(), OrderPage(), DISPUTE_OUTCOME_LABELS, DISPUTE_REASON_LABELS, DISPUTE_STATUS_LABELS (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.07
Nodes (22): addItemsRoute, anon, deleteRouteRoute, listRoutesRoute, lotCandidates(), lotCandidatesRoute, myItemsRoute, namesFor() (+14 more)

### Community 27 - "Community 27"
Cohesion: 0.09
Nodes (33): abandonForeignSession(), abortSvelteComponentInjection(), cleanup(), clearHandled(), clearScrollY(), clearSteerFocusRecoverTimer(), copyToClipboard(), discardedWrappers() (+25 more)

### Community 28 - "Community 28"
Cohesion: 0.10
Nodes (33): agentHasWorkInFlight(), agentStatusText(), attachSteerFocusGuard(), barPaletteForTheme(), brandMarkSvg(), buildSteerProcessingDots(), buildSteerQueueHint(), connectSSE() (+25 more)

### Community 29 - "Community 29"
Cohesion: 0.09
Nodes (20): 0ff8f4c Simplify the Sell tab into five cards: Analytics, Manage Store, and an Items to Lots to Routes workflow, 6213066 Lot origin/destination, route templates, and forward-event tracking, emptyLotDetails(), LotDetailFields(), lotDetailsOf(), Modal(), NewLotDialog(), LOT_SECTIONS (+12 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (29): advanceAll(), advancePowerSale(), dueAt(), finishesAt(), listingFor(), minutes(), releaseItems(), Repo (+21 more)

### Community 31 - "Community 31"
Cohesion: 0.10
Nodes (21): anon, dashboardRoute, myStoresRoute, safeLink(), salesRoute, slugify(), storefrontRoute, updateManagersRoute (+13 more)

### Community 32 - "Community 32"
Cohesion: 0.12
Nodes (15): admin, AdminDisputeRow, AdminUserDetail, AdminUserRow, post(), request(), Confirm(), DisputesView() (+7 more)

### Community 33 - "Community 33"
Cohesion: 0.12
Nodes (27): applySavedSessionMeta(), clampVariantIndex(), clearSession(), findActiveSessionSummary(), findAdoptableServerSession(), findAnyVariantsWrapper(), injectVariantsFromSource(), isFrameworkComponentPreviewMode() (+19 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (18): auth, bystanderAuth, cookieAuth, ctx, day(), directAuth, escrow, fns (+10 more)

### Community 35 - "Community 35"
Cohesion: 0.08
Nodes (23): advanceStageRoute, anon, assignToLotRoute, createLotRoute, findExportStoreFor(), lotBoardRoute, lotContentsRoute, LotDetailsBody (+15 more)

### Community 36 - "Community 36"
Cohesion: 0.10
Nodes (22): anon, consignments(), consignmentsRoute, distribution(), distributionDetail(), distributionDetailRoute, distributionRoute, ListingBody (+14 more)

### Community 37 - "Community 37"
Cohesion: 0.18
Nodes (25): clearStoredManualApplyState(), fetchPendingCount(), handleManualEditActivity(), hidePendingApplyDock(), manualApplyLoadingText(), manualApplyStateKey(), manualEditEventForCurrentPage(), numberOrNull() (+17 more)

### Community 38 - "Community 38"
Cohesion: 0.14
Nodes (10): StorageConfig, BlobPhotoStore, buildClient(), PhotoStore, extensionFor(), MemoryPhotoStore, PhotoStore, PhotoStore (+2 more)

### Community 39 - "Community 39"
Cohesion: 0.13
Nodes (23): adminDeleteResourceRoute, adminDeleteUserRoute, adminDisputesRoute, adminEscrowRoute, adminResolveRoute, adminSuspendRoute, adminUserDetailRoute, adminUsersRoute (+15 more)

### Community 40 - "Community 40"
Cohesion: 0.13
Nodes (15): 29bd178 The Functions host keeps /admin for itself, so those eight routes never existed, 4484666 Buying is two transactions, not a tick box on one, a5a184e Orders, Track, and the stationery a shop lists from, b1179de Pro analytics off the packing board, and numbers that open, c6c033a The batch is the tracking engine, and the seller writes the route, e492525 A Services tab, and the people who do the work get a screen, apiRoot, MIME (+7 more)

### Community 41 - "Community 41"
Cohesion: 0.10
Nodes (13): 6d70f64 Make a broken deployment say which container is missing, aa99b23 Usernames, shops as the only way to list, packing access, and messages, b269064 Create missing Cosmos containers, and give a person their own username, efdbcff `from` is a reserved word in Cosmos SQL, and the inbox query used it, { CosmosClient }, require, base, calls (+5 more)

### Community 42 - "Community 42"
Cohesion: 0.11
Nodes (21): addManualContextText(), canRestoreManualEditElement(), collectManualContextPieces(), contextElementForManualEdit(), directMixedTextRestoreNodes(), documentRefClassSuffix(), documentRefIdSuffix(), documentRefSegment() (+13 more)

### Community 43 - "Community 43"
Cohesion: 0.16
Nodes (17): alsoMe(), anon, card(), close(), expiryFrom(), findWant(), notifySeekers(), offer() (+9 more)

### Community 44 - "Community 44"
Cohesion: 0.18
Nodes (3): autoSeedEnabled(), describeError(), nameFor()

### Community 45 - "Community 45"
Cohesion: 0.14
Nodes (1): isNotFound()

### Community 46 - "Community 46"
Cohesion: 0.15
Nodes (8): 613ff69 Rebuild the sell tab: one door in, two ways to sell, every order answered, 7b5199d Filters that fit, tabs that hold together, fixtures that don't expire, 8992ccb A fill meter you can join, and a catalog you can narrow, TABS, all, { code, pieces: allStrings }, RESERVED, strings

### Community 47 - "Community 47"
Cohesion: 0.14
Nodes (13): CREW_CHECKPOINTS, CrewRole, crewRoleOf(), ENTRY_NOTE, mayTick(), SERVICE_KINDS, SERVICE_ORDER, ServiceEntry (+5 more)

### Community 48 - "Community 48"
Cohesion: 0.22
Nodes (11): development, 06db1c6 Stop tracking graphify local/machine state, 31569c8 Remove unsupported production_branch input from Azure SWA deploy steps, 320bbe5 A members' window that actually withholds something, and one place for batches, 3ca4812 Add stable development deployment to Azure Static Web Apps workflow, 87cac97 Remove unsupported production_branch input from Azure SWA deploy steps, 904cac6 Fix the powerSales indexing path, and check the rest of them, 9bd6ac1 Add graphify local-state files to .gitignore (+3 more)

### Community 49 - "Community 49"
Cohesion: 0.23
Nodes (14): acceptedDomAlreadyClean(), clearHandledWrapperReloadStamp(), commitAcceptedSvelteComponentToDom(), deferredRecoverySuperseded(), ensureAcceptedDomClean(), findAcceptedRuntimeWrappers(), handledWrapperReloadKey(), maybeCompleteAcceptedSession() (+6 more)

### Community 50 - "Community 50"
Cohesion: 0.20
Nodes (14): beginEditPin(), cancelEditingPin(), canCreateInsert(), finalizeEditingPin(), hideInsertCreateTooltip(), insertCreateDisabledReason(), insertCreateGateState(), onAnnotDown() (+6 more)

### Community 51 - "Community 51"
Cohesion: 0.15
Nodes (1): AuthError

### Community 52 - "Community 52"
Cohesion: 0.15
Nodes (12): byName, byRoute, byShape, conflicts, dir, files, registrations, repeated (+4 more)

### Community 53 - "Community 53"
Cohesion: 0.20
Nodes (8): d820fb9 The order lifecycle: hold the money, confirm delivery, rate each other, f1b6577 An operations console, escrow as a granted right, and disputes both sides can work, auth, base, bearer, check(), expectAuthError(), repository

### Community 54 - "Community 54"
Cohesion: 0.22
Nodes (3): followKey(), identifiersOf(), likeKey()

### Community 55 - "Community 55"
Cohesion: 0.20
Nodes (5): failed, require, results, skipped, TIMEOUT_MS

### Community 56 - "Community 56"
Cohesion: 0.31
Nodes (9): bindEditBadgeProxy(), editBadgeProxyTargets(), initEditBadge(), initEditBadgeHitProxies(), positionEditBadge(), setImportantStyle(), styleEditBadgeProxy(), syncEditBadgeHitProxies() (+1 more)

### Community 57 - "Community 57"
Cohesion: 0.29
Nodes (2): css, parsed

### Community 58 - "Community 58"
Cohesion: 0.48
Nodes (5): matchesScope(), normalizeIgnoreRule(), normalizeIgnoreValue(), pageCandidates(), resolveDetectIgnores()

### Community 59 - "Community 59"
Cohesion: 0.33
Nodes (6): advanceStage(), assignToLot(), lotContents(), ownedLot(), setCrew(), setTracking()

### Community 60 - "Community 60"
Cohesion: 0.33
Nodes (4): NAVIGATION_FALLBACK, path, ROUTE, TOP_LEVEL

### Community 61 - "Community 61"
Cohesion: 0.47
Nodes (4): ExternalTrackingEvent, getTrackingProvider(), NoopTrackingProvider, TrackingProvider

### Community 62 - "Community 62"
Cohesion: 0.40
Nodes (5): buildLot(), createLot(), supplierFrom(), updateLotDetails(), userForHandle()

### Community 63 - "Community 63"
Cohesion: 0.40
Nodes (5): lotBoard(), lotsBoard(), lotsStoreFor(), myLots(), setCheckpoint()

### Community 64 - "Community 64"
Cohesion: 0.67
Nodes (1): isConflict()

### Community 65 - "Community 65"
Cohesion: 1.00
Nodes (1): catalogOrder()

## Knowledge Gaps
- **350 isolated node(s):** `NOTE: the compiled component imported from the dev server already carries`, `NOTE: do NOT clear the persistent scroll key here. startScrollLock`, `TODO: Enable this proxy for React/Vue/etc. adapters once their live`, `NOTE: scrollY is stored under a separate key (writeScrollY). Storing`, `ClientPrincipal` (+345 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 1`** (2 nodes): `MemoryRepository`, `Repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 5`** (2 nodes): `CosmosRepository`, `Repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 45`** (1 nodes): `isNotFound()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `AuthError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 57`** (2 nodes): `css`, `parsed`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 64`** (1 nodes): `isConflict()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `catalogOrder()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CosmosRepository` connect `Community 5` to `Community 2`, `Community 45`, `Community 44`, `Community 66`, `Community 64`, `Community 65`, `Community 67`, `Community 68`, `Community 17`?**
  _High betweenness centrality (0.092) - this node is a cross-community bridge._
- **Why does `MemoryRepository` connect `Community 1` to `Community 17`, `Community 2`, `Community 54`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `AuthError` connect `Community 51` to `Community 4`, `Community 35`, `Community 6`?**
  _High betweenness centrality (0.010) - this node is a cross-community bridge._
- **What connects `NOTE: the compiled component imported from the dev server already carries`, `NOTE: do NOT clear the persistent scroll key here. startScrollLock`, `TODO: Enable this proxy for React/Vue/etc. adapters once their live` to the rest of the system?**
  _350 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.026869776790436898 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.020833333333333332 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.07469135802469136 - nodes in this community are weakly interconnected._