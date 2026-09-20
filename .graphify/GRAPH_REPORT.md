# Graph Report - .  (2026-09-20)

## Corpus Check
- 248 files · ~428,979 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2228 nodes · 6293 edges · 67 communities detected
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output
- Edge kinds: contains: 1763 · calls: 1604 · imports: 1139 · MODIFIES: 586 · imports_from: 504 · ON_BRANCH: 335 · method: 250 · PARENT_OF: 69 · inherits: 23 · re_exports: 10 · implements: 6 · rationale_for: 4


## Input Scope
- Requested: auto
- Resolved: committed (source: default-auto)
- Included files: 248 · Candidates: 428
- Excluded: 0 untracked · 17615 ignored · 2 sensitive · 14 missing committed
- Recommendation: Use --scope all or graphify.yaml inputs.corpus for a knowledge-base folder.

## Graph Freshness
- Built from Git commit: `0ff8f4c`
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
- `0326170 Maintenance ran in front of every request, on every cold worker` --ON_BRANCH--> `chore/azure-swa-development-env`  [EXTRACTED]
  git → git  _Bridges community 39 → community 18_
- `0326170 Maintenance ran in front of every request, on every cold worker` --ON_BRANCH--> `development`  [EXTRACTED]
  git → git  _Bridges community 39 → community 44_
- `0460f84 The links were there and looked exactly like plain text` --ON_BRANCH--> `development`  [EXTRACTED]
  git → git  _Bridges community 18 → community 44_
- `12950fa Give Figmark a typeface, a dense order queue and a real chat` --ON_BRANCH--> `chore/azure-swa-development-env`  [EXTRACTED]
  git → git  _Bridges community 9 → community 18_
- `12950fa Give Figmark a typeface, a dense order queue and a real chat` --ON_BRANCH--> `development`  [EXTRACTED]
  git → git  _Bridges community 9 → community 44_

## Communities

### Community 0 - "Community 0"
Cohesion: 0.03
Nodes (116): applyGlobalBarLabelState(), applyPlaceholderSizingStyles(), averageRgb01(), buildAnnotationsForCapture(), buildCollapsible(), buildColorModels(), buildDesignHeader(), buildPinElement() (+108 more)

### Community 1 - "Community 1"
Cohesion: 0.02
Nodes (2): MemoryRepository, Repository

### Community 2 - "Community 2"
Cohesion: 0.06
Nodes (46): IconName, Avatar(), EmptyState(), ErrorNotice(), fillToneOf(), leadPhoto(), LotMeter(), Modal() (+38 more)

### Community 3 - "Community 3"
Cohesion: 0.07
Nodes (74): CATALOG_ORDER, IdentifierReservation, normaliseIdentifier(), BackendStatus, CatalogQuery, sessionDigest(), forwarder(), handler() (+66 more)

### Community 4 - "Community 4"
Cohesion: 0.05
Nodes (2): CosmosRepository, Repository

### Community 5 - "Community 5"
Cohesion: 0.06
Nodes (41): AuthService, hasSessionCookie(), MockAuthProvider, readToken(), readTokens(), toAuthUser(), AuthService, ClientPrincipal (+33 more)

### Community 6 - "Community 6"
Cohesion: 0.04
Nodes (58): EvidenceFields(), OrderPage(), Stars(), DisputeAction, feeRefunded(), loserOf(), reasonsFor(), splitFor() (+50 more)

### Community 7 - "Community 7"
Cohesion: 0.08
Nodes (69): applyEditing(), beginNewLiveConfiguration(), buildInsertPlaceholderSnapshotFromDom(), buildLocatorForLeaf(), buildPickedAnchorSnapshot(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure() (+61 more)

### Community 8 - "Community 8"
Cohesion: 0.04
Nodes (63): CAPABILITIES, ConditionTag, DIRECT_STAGE_LABELS, DIRECT_STAGES, DirectStage, DISPUTE_REASONS, DISPUTE_STATUSES, DisputeOutcome (+55 more)

### Community 9 - "Community 9"
Cohesion: 0.05
Nodes (45): 12950fa Give Figmark a typeface, a dense order queue and a real chat, SkeletonRows(), Toast, ToastContext, ToastTone, FILLED, Icon(), PATHS (+37 more)

### Community 10 - "Community 10"
Cohesion: 0.06
Nodes (54): getRepository(), accept(), acceptDisputeRoute, anon, escalate(), escalateDisputeRoute, escrowHoldingsRoute, evidenceFrom() (+46 more)

### Community 11 - "Community 11"
Cohesion: 0.05
Nodes (42): getAuthService(), healthRoute, error(), handler(), json(), storeStatus(), toErrorResponse(), insights() (+34 more)

### Community 12 - "Community 12"
Cohesion: 0.05
Nodes (45): Notifications(), TabBar(), TABS, AuthPage(), Mode, DisputePage(), EscrowPage(), FeedPage() (+37 more)

### Community 13 - "Community 13"
Cohesion: 0.09
Nodes (51): ae(), be(), bt(), Ce(), Ct(), de(), dt(), _e() (+43 more)

### Community 14 - "Community 14"
Cohesion: 0.05
Nodes (45): LotPeople(), Tile(), LotBoardPage(), PackingList(), PackingLotPage(), SupplierPage(), byCustomer(), CheckpointCount (+37 more)

### Community 15 - "Community 15"
Cohesion: 0.05
Nodes (15): LOT_SECTIONS, LotDetail(), LotSection, NewLotForm(), summarise(), Drill, DRILL_HINTS, ESCROW_WORDS (+7 more)

### Community 16 - "Community 16"
Cohesion: 0.07
Nodes (43): applyParamDefaults(), applyParamValue(), applyPlaceholderDimensions(), buildParamsPanel(), closedClipPath(), commitAcceptedVariantToDom(), completeParameterGenerationIfReady(), completeParameterPublication() (+35 more)

### Community 17 - "Community 17"
Cohesion: 0.08
Nodes (42): armPageChatForTyping(), attachSteerFocusDebug(), clearSteerAwaitTimer(), collapsePageChat(), configureVoiceContext(), expandPageChat(), finishVoiceSession(), focusConfigureInput() (+34 more)

### Community 18 - "Community 18"
Cohesion: 0.22
Nodes (39): chore/azure-swa-development-env, claude/figmark-connection-icpfax, claude/new-session-13ackt, feature/route-builder-stages, fix/azure-swa-remove-invalid-input, 0460f84 The links were there and looked exactly like plain text, 0f35535 Add the Impeccable design skill, 119ed59 Add Emil Kowalski's design and animation skills (+31 more)

### Community 19 - "Community 19"
Cohesion: 0.10
Nodes (40): actionLabel(), applyConfigureBarChrome(), bindConfigureCountPillTooltip(), bindConfigureInlineControlHover(), buildConfigureActionControl(), buildConfigureCountControl(), buildConfigureRow(), buildConfigureSubmitButton() (+32 more)

### Community 20 - "Community 20"
Cohesion: 0.08
Nodes (38): applyOriginalAttrsToSvelteAnchor(), buildSvelteExpressionTextMap(), buildSveltePropValuesFromLiveElement(), buildSveltePropValuesV2(), captureAndEmit(), checkpointPayload(), cloneWithoutElements(), collectTextNodes() (+30 more)

### Community 21 - "Community 21"
Cohesion: 0.06
Nodes (16): Drill, DRILL_HINTS, ESCROW_WORDS, OrderFilter, OrderRow(), orderTone(), PAYMENT_WORDS, Section (+8 more)

### Community 22 - "Community 22"
Cohesion: 0.09
Nodes (33): abandonForeignSession(), abortSvelteComponentInjection(), cleanup(), clearHandled(), clearScrollY(), clearSteerFocusRecoverTimer(), copyToClipboard(), discardedWrappers() (+25 more)

### Community 23 - "Community 23"
Cohesion: 0.10
Nodes (33): agentHasWorkInFlight(), agentStatusText(), attachSteerFocusGuard(), barPaletteForTheme(), brandMarkSvg(), buildSteerProcessingDots(), buildSteerQueueHint(), connectSSE() (+25 more)

### Community 24 - "Community 24"
Cohesion: 0.08
Nodes (25): CategoryIcon(), MARKS, FillBlock(), FillGap(), FillKey(), FillMeter(), PRICE_BANDS, CATALOG_KIND_LABELS (+17 more)

### Community 25 - "Community 25"
Cohesion: 0.07
Nodes (21): addItemsRoute, anon, deleteRouteRoute, listRoutesRoute, lotCandidates(), lotCandidatesRoute, myItemsRoute, namesFor() (+13 more)

### Community 26 - "Community 26"
Cohesion: 0.12
Nodes (29): advanceAll(), advancePowerSale(), dueAt(), finishesAt(), listingFor(), minutes(), releaseItems(), Repo (+21 more)

### Community 27 - "Community 27"
Cohesion: 0.10
Nodes (22): anon, dashboardRoute, myStoresRoute, safeLink(), salesRoute, slugify(), storefrontRoute, updateManagersRoute (+14 more)

### Community 28 - "Community 28"
Cohesion: 0.11
Nodes (16): admin, AdminDisputeRow, AdminUserDetail, AdminUserRow, post(), request(), Confirm(), DisputesView() (+8 more)

### Community 29 - "Community 29"
Cohesion: 0.07
Nodes (25): advanceStageRoute, anon, assignToLotRoute, createLotRoute, findExportStoreFor(), lotBoardRoute, lotContentsRoute, LotDetailsBody (+17 more)

### Community 30 - "Community 30"
Cohesion: 0.12
Nodes (26): anon, checkout(), checkoutRoute, claimPayment(), claimPaymentRoute, confirm(), confirmRoute, hasAnyDetail() (+18 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (27): applySavedSessionMeta(), clampVariantIndex(), clearSession(), findActiveSessionSummary(), findAdoptableServerSession(), findAnyVariantsWrapper(), injectVariantsFromSource(), isFrameworkComponentPreviewMode() (+19 more)

### Community 32 - "Community 32"
Cohesion: 0.10
Nodes (16): 141db1a Routes you can write, and a tracking timeline you can edit, emptyLotDetails(), LotDetailFields(), lotDetailsOf(), Modal(), LOT_SECTIONS, LotDetail(), LotSection (+8 more)

### Community 33 - "Community 33"
Cohesion: 0.10
Nodes (22): anon, consignments(), consignmentsRoute, distribution(), distributionDetail(), distributionDetailRoute, distributionRoute, ListingBody (+14 more)

### Community 34 - "Community 34"
Cohesion: 0.09
Nodes (18): auth, bystanderAuth, cookieAuth, ctx, day(), directAuth, escrow, fns (+10 more)

### Community 35 - "Community 35"
Cohesion: 0.18
Nodes (25): clearStoredManualApplyState(), fetchPendingCount(), handleManualEditActivity(), hidePendingApplyDock(), manualApplyLoadingText(), manualApplyStateKey(), manualEditEventForCurrentPage(), numberOrNull() (+17 more)

### Community 36 - "Community 36"
Cohesion: 0.14
Nodes (10): StorageConfig, BlobPhotoStore, buildClient(), PhotoStore, extensionFor(), MemoryPhotoStore, PhotoStore, PhotoStore (+2 more)

### Community 37 - "Community 37"
Cohesion: 0.13
Nodes (23): adminDeleteResourceRoute, adminDeleteUserRoute, adminDisputesRoute, adminEscrowRoute, adminResolveRoute, adminSuspendRoute, adminUserDetailRoute, adminUsersRoute (+15 more)

### Community 38 - "Community 38"
Cohesion: 0.09
Nodes (15): addCommentRoute, anon, bumpListingRoute, createListingRoute, createOrderRoute, feed(), feedRoute, forwardersRoute (+7 more)

### Community 39 - "Community 39"
Cohesion: 0.10
Nodes (14): 0326170 Maintenance ran in front of every request, on every cold worker, 06b6faa Init cost 157 sequential round trips, so the console never finished loading, aa99b23 Usernames, shops as the only way to list, packing access, and messages, b269064 Create missing Cosmos containers, and give a person their own username, e7e5925 The seed only ever ran once, so the deployed data stopped at day one, { CosmosClient }, require, base (+6 more)

### Community 40 - "Community 40"
Cohesion: 0.13
Nodes (16): 29bd178 The Functions host keeps /admin for itself, so those eight routes never existed, 4484666 Buying is two transactions, not a tick box on one, 8992ccb A fill meter you can join, and a catalog you can narrow, a5a184e Orders, Track, and the stationery a shop lists from, b1179de Pro analytics off the packing board, and numbers that open, c6c033a The batch is the tracking engine, and the seller writes the route, e492525 A Services tab, and the people who do the work get a screen, apiRoot (+8 more)

### Community 41 - "Community 41"
Cohesion: 0.11
Nodes (21): addManualContextText(), canRestoreManualEditElement(), collectManualContextPieces(), contextElementForManualEdit(), directMixedTextRestoreNodes(), documentRefClassSuffix(), documentRefIdSuffix(), documentRefSegment() (+13 more)

### Community 42 - "Community 42"
Cohesion: 0.12
Nodes (14): NewLotDialog(), PhotoManager(), SellPage(), Shape, SOURCING, SOURCING_LABELS, BUILT_IN_ROUTE, LotRoute (+6 more)

### Community 43 - "Community 43"
Cohesion: 0.16
Nodes (17): alsoMe(), anon, card(), close(), expiryFrom(), findWant(), notifySeekers(), offer() (+9 more)

### Community 44 - "Community 44"
Cohesion: 0.21
Nodes (14): development, 0ff8f4c Simplify the Sell tab into five cards: Analytics, Manage Store, and an Items to Lots to Routes workflow, 21a509d Resume Route Builder: mobile-first stage boxes over the existing route model, 31569c8 Remove unsupported production_branch input from Azure SWA deploy steps, 320bbe5 A members' window that actually withholds something, and one place for batches, 3ca4812 Add stable development deployment to Azure Static Web Apps workflow, 4300313 Merge route builder stages into development, 613ff69 Rebuild the sell tab: one door in, two ways to sell, every order answered (+6 more)

### Community 45 - "Community 45"
Cohesion: 0.14
Nodes (13): anon, credit(), creditFrom(), creditRoute, pageReviewsRoute, Repo, saveProfileRoute, summarise() (+5 more)

### Community 46 - "Community 46"
Cohesion: 0.15
Nodes (14): anon, channelsRoute, channelThread(), channelThreadRoute, createForum(), createForumRoute, createPostRoute, decorate() (+6 more)

### Community 47 - "Community 47"
Cohesion: 0.18
Nodes (3): autoSeedEnabled(), describeError(), nameFor()

### Community 48 - "Community 48"
Cohesion: 0.14
Nodes (1): isNotFound()

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
Cohesion: 0.17
Nodes (6): 6d70f64 Make a broken deployment say which container is missing, efdbcff `from` is a reserved word in Cosmos SQL, and the inbox query used it, all, { code, pieces: allStrings }, RESERVED, strings

### Community 55 - "Community 55"
Cohesion: 0.20
Nodes (8): blankItem(), ItemDraft, PowerSalePanel(), SaleBuilder(), STATUS_LABEL, STATUS_TONE, PowerSaleDraft, PowerSaleView

### Community 56 - "Community 56"
Cohesion: 0.22
Nodes (3): followKey(), identifiersOf(), likeKey()

### Community 57 - "Community 57"
Cohesion: 0.20
Nodes (5): failed, require, results, skipped, TIMEOUT_MS

### Community 58 - "Community 58"
Cohesion: 0.31
Nodes (9): bindEditBadgeProxy(), editBadgeProxyTargets(), initEditBadge(), initEditBadgeHitProxies(), positionEditBadge(), setImportantStyle(), styleEditBadgeProxy(), syncEditBadgeHitProxies() (+1 more)

### Community 59 - "Community 59"
Cohesion: 0.29
Nodes (2): css, parsed

### Community 60 - "Community 60"
Cohesion: 0.48
Nodes (5): matchesScope(), normalizeIgnoreRule(), normalizeIgnoreValue(), pageCandidates(), resolveDetectIgnores()

### Community 61 - "Community 61"
Cohesion: 0.33
Nodes (6): advanceStage(), assignToLot(), lotContents(), ownedLot(), setCrew(), setTracking()

### Community 62 - "Community 62"
Cohesion: 0.33
Nodes (4): NAVIGATION_FALLBACK, path, ROUTE, TOP_LEVEL

### Community 63 - "Community 63"
Cohesion: 0.40
Nodes (5): buildLot(), createLot(), supplierFrom(), updateLotDetails(), userForHandle()

### Community 64 - "Community 64"
Cohesion: 0.40
Nodes (5): lotBoard(), lotsBoard(), lotsStoreFor(), myLots(), setCheckpoint()

### Community 65 - "Community 65"
Cohesion: 0.67
Nodes (1): isConflict()

### Community 66 - "Community 66"
Cohesion: 1.00
Nodes (1): catalogOrder()

## Knowledge Gaps
- **347 isolated node(s):** `LotSection`, `LOT_SECTIONS`, `Section`, `SECTIONS`, `SECTION_GROUPS` (+342 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **Thin community `Community 1`** (2 nodes): `MemoryRepository`, `Repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 4`** (2 nodes): `CosmosRepository`, `Repository`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 48`** (1 nodes): `isNotFound()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 51`** (1 nodes): `AuthError`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 59`** (2 nodes): `css`, `parsed`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 65`** (1 nodes): `isConflict()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `Community 66`** (1 nodes): `catalogOrder()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `CosmosRepository` connect `Community 4` to `Community 3`, `Community 48`, `Community 47`, `Community 67`, `Community 65`, `Community 66`, `Community 68`, `Community 69`, `Community 10`?**
  _High betweenness centrality (0.094) - this node is a cross-community bridge._
- **Why does `MemoryRepository` connect `Community 1` to `Community 10`, `Community 3`, `Community 56`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **What connects `LotSection`, `LOT_SECTIONS`, `Section` to the rest of the system?**
  _347 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.026869776790436898 - nodes in this community are weakly interconnected._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.020833333333333332 - nodes in this community are weakly interconnected._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.05802469135802469 - nodes in this community are weakly interconnected._
- **Should `Community 3` be split into smaller, more focused modules?**
  _Cohesion score 0.07469135802469136 - nodes in this community are weakly interconnected._