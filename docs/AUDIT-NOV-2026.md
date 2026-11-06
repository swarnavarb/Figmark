# Figmark audit — November 2026

Date: 6 Nov 2026 · Base commit `6ec7106` · Follows `AUDIT-REPORT.md` (19 Oct), so this pass looks mainly at the 79 commits and ~17k lines added since then, and at lots and routes in depth.

Method: code reading of the lot/route engine (`shared/routes.ts`, `api/src/functions/tracking-routes.ts`, `fulfilment-routes.ts`, `RouteStudioPage.tsx`, `RoutesPage.tsx`, `LotsPage.tsx`), auth checks on every newer route file (billing, loyalty, service-work, customer, board), `npm audit`, and a scan of the CSS/TSX for motion and XSS patterns. `npm run build` and `npm test` pass before and after the fixes (1,069 checks).

## Status after round 2 (6 Nov 2026)

Everything below that could be fixed in code has been, and deployed to `development`. The suite runs 1,073 checks, all passing.

| Item | Status | What changed |
|---|---|---|
| S-1 Pro/fees without payment | ✅ Guarded | With `SITE_ENVIRONMENT=production`, buying Pro and paying fees answer 503 "payments not available" until a gateway is connected. An operator can override this deliberately with `FIGMARK_SIMULATED_BILLING=on`. Development behaves as before. |
| S-2 Item in two lots | ✅ Fixed | `moveOrderToLot` claims the old copy first (delete with `IfMatch` etag). A second, simultaneous move is refused and `addItems` skips that item. If the new copy can't be written, the old one is put back. The in-memory store behaves the same way. |
| S-3 Handler without consent | ✅ Fixed | Naming someone as handler gives them a seat only if they have a handler profile, are the shop's staff, or are the seller. Anyone else is kept on the lot as a name only. |
| S-4 Voucher used up on failure | ✅ Fixed | If saving the account fails, the voucher use is handed back. |
| S-5 Vite advisory | ✅ Fixed | `npm audit fix` in `app/`: 0 advisories. |
| Lot numbers repeat | ✅ Fixed | A new lot's number is re-drawn until no other lot in the shop has it. |
| Held lot names one item | ✅ Fixed | The 409 now carries `held: [...]` (every item, its buyer and the missing button), and the lot page lists them all. |
| Motion: tab bar | ✅ Fixed | The highlight slides with `transform` instead of `left`. |
| Motion: page changes | ✅ Added | A 180 ms opacity cross-fade on every page change. Nothing remounts, there's no transform that could move fixed bars, and it's off under reduced motion. |
| Motion: skeleton flash | ✅ Fixed | The page skeleton appears only after 150 ms. |
| Motion: lot move | ✅ Added | The new step rises into place, and the phone gives a haptic tick. |
| Route update preview | ✅ Added | `POST /routes/{id}/apply?preview=1` writes nothing and returns each lot's current step, its new step, and its buyer count. The Routes list shows this in the confirm dialog. |
| Delete route count | ✅ Added | The confirm in both the Routes list and Route Studio says how many lots are on the route. |
| Undo step delete | ✅ Added | A 10-second Undo in Route Studio. |
| Typical days per step | ✅ Added | Optional "Usually takes N days" on each step (1–180). The lot page shows "Day X on this step · usually N" with a running-late flag and about how many days are left. Buyers' lot view shows a rough remaining time, labelled as the shop's estimate. |
| Manifest export | ✅ Added | "⬇ Manifest (CSV)" on the lot page: item, condition, quantity, buyer, handle, status and step. Cells are guarded against spreadsheet formula injection. |
| Who to contact | ✅ Added | The lot page names the forwarder or handler for the current step, with tap-to-call or tap-to-email. |
| Screen readers | ✅ Added | `aria-live` on Route Studio's lane counts. |

Not done, and why:
- **Progress-bar `width` transitions (about 20)**. These run only when a value changes, inside small fixed-size tracks, so they cost little. Converting them would mean changing every component that sets the width, so I left them.
- **`backdrop-filter`**. Whether to keep the frosted-glass look is a design decision, so I didn't remove it.
- **Lot cost sheet**. Per-listing cost sheets already exist (Pro). Splitting freight across a lot is a separate feature.
- **Documents on a lot, bulk actions on the item list, a real payment gateway, WhatsApp lot updates, public tracking links, and route statistics**. Each is a product feature that needs decisions or third-party accounts. WhatsApp Business is already connected for verification, but lot updates would need approved message templates. The gateway needs a provider account.
- **`noteOnLot` on finished lots**. Left as it is; whether it should change is a product decision.

## Fixed in round 1

| # | Severity | What was wrong | Fix |
|---|---|---|---|
| F-1 | **High (security)** | **Undoing a lot move trusted the step number sent by the browser.** `POST /lots/{id}/step` with `undoOf` used `body.to` with no checks. That skipped the floor, the "lot is unpacked" limit, the "orders still need their buttons" hold and the forwarder's step permission. A forwarder who had made one move could send `{undoOf, to: N}` within 3 minutes and put the shop's lot on any step. A seller could use it to skip the hold. Undoing an older move after a newer one also left the newer move on the timeline with the lot back behind it. | Every move now stores where it started (`StageEvent.undoFrom`). Undo returns there and ignores `to`, and only the latest move can be undone. The same fix applies to single-item moves (`/orders/{id}/step`). Test updated: an undo that sends `to: 999` still lands on the starting step. |
| F-2 | Medium (security/stability) | **No size limits on route and timeline text.** Route names, step names and descriptions, the number of steps, lot notes, tracking IDs and courier names could be up to the 4 MB body limit. A lot stores its route and its whole history in one Cosmos document (2 MB maximum), so one big note could stop the lot being saved again. Each note is also sent to every buyer as a push notification. | Limits: route name 80 characters, 40 steps, step name 120, descriptions and wait messages 500, notes 1,000, tracking ID and courier 80. Applied to saved routes, to steps sent inline when a lot is created, and to notes and moves on lots and items. |
| F-3 | Medium (logic, UI) | **Deleting a step in Route Studio could move another step into the lot.** `removeAt` set the leave line using the join line from *before* the delete. When the "in the lot" lane was empty and a step before it was deleted, the first "after" step moved silently into the lot. | Both lines are now recalculated from the positions after the delete. |
| F-4 | Low (UX) | **Refreshing or closing the tab in Route Studio lost unsaved work.** The confirmation only appeared on the in-app ✕ button. | A `beforeunload` prompt appears while there are unsaved changes. |

## Open — security

| # | Severity | Finding | Recommendation |
|---|---|---|---|
| S-1 | High, before launch | **Pro plans, platform fees and vouchers are granted with no real payment.** `buyPro` and `payFees` (`billing-routes.ts:100-210`) create a gateway reference and grant the months or clear the fees straight away. Any signed-in user can get Pro for free while `pricing.pro.enabled` is on. This is the known "payments are simulated" blocker, but it now also covers platform revenue. | Keep Pro sales switched off in production until a real gateway is connected. Grant only from the gateway's signed webhook, not from the request. |
| S-2 | Medium | **The same item can end up in two lots.** `moveOrderToLot` (`cosmos-repository.ts:632`) does an upsert into the new lot and then a best-effort delete, with no etag. If a seller sends two `addItems` calls for the same item to two different lots (two tabs, or a double tap), the item ends up in both. Each buyer timeline and manifest then counts it twice. | Read the source document's `_etag` and delete it with `ifMatch` *first*, or use a transactional batch. Treat a 412 as "already moved". |
| S-3 | Low | **Anyone can be named a lot's handler, without agreeing.** Forwarders have an accept step; handlers do not. Naming someone gives them the `handler` role on that lot's orders (`crewRolesOn`), including buyer names, and puts the lot on their work screen. | Add `acceptance: 'pending'` for handlers, like forwarders. |
| S-4 | Low | A voucher use is recorded before the user's Pro update is saved (`redeemVoucher`). If that update fails (for example a 409 from a concurrent write), the voucher is used up and no days are added. | Save the grant first, or release the voucher use in a `catch`. |
| S-5 | Dev only | `npm audit` in `app/`: 1 high advisory (Vite ≤ 6.4.3 / `launch-editor`). Only the dev server is affected, not the shipped bundle. | `cd app && npm audit fix`. |

Confirmed clean: no `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `new Function` anywhere. API responses strip password hashes and MFA fields at any depth (`http.ts`). Every newer route file checks auth before acting, and ops endpoints require `admin`. `npm audit` on the API's production dependencies: 0 issues.

## Open — logic

- **Lot numbers can repeat within a shop.** `lotNumberFrom` uses the last 4 hex characters of the UUID, which allows 65,536 values. A shop with about 100 lots has a ~7% chance that two share a number, and about 300 lots puts it near 50%. The code comment says the number is meant to be "unambiguous". Fix: a per-shop counter, or re-roll at creation until it is unique within the shop.
- **When the lot is held back, the seller only sees one blocking item.** The `orders_not_ready` error in `stepLot` names only the first order ("3 orders still need… X needs 'Packed'"). The seller then has to find the other two. Return the full list (`held: [{orderId, itemName, buyerName, needs}]`) and show it as a checklist with a one-tap button for each (see the lot-route ideas below).
- `noteOnLot` still posts to and notifies buyers on a lot that is finished. That may be intended, but it is worth a decision.

## UI and motion

The app already has a lot of motion: about 220 `@keyframes`, skeleton page loaders, and 93 `prefers-reduced-motion` guards. The main gap is smoothness on low-end Android phones:

1. **Transitions on layout properties (22 places).** These redo layout on every frame. Switch them to `transform`:
   - `styles.css:1675` tab-bar highlight animates `left`. Use `transform: translateX()`.
   - Progress bars animate `width`: `styles.css:1852, 2000, 2975, 3599, 4005, 4284`. Use `transform: scaleX()` with `transform-origin: left`.
   - `styles.css:4871` `.chpin` animates `top`. Use `translateY`.
2. **Page changes cut instead of animating.** React Router 7 supports `viewTransition` on `<Link>`/`navigate()`. Add a 150–200 ms cross-fade with `::view-transition-old/new(root)`, turned off under `prefers-reduced-motion`. Give the lot card and the lot page the same `view-transition-name` so opening a lot reads as one continuous motion.
3. **`backdrop-filter: blur()` is used in 54 places**, including sticky elements, and it is expensive while scrolling on mid-range phones. Keep it on the sheets and the top bar only, and use a solid `color-mix` background elsewhere.
4. **Delay the skeleton when a lazy page is already cached.** Show `PageLoading` only after about 150 ms, so a fast page change doesn't flash a skeleton for one frame.
5. **Lot step moves:** animate the rung tick and the progress line (scale and opacity) when the seller moves a lot, and add `haptics.ts` feedback on success. The undo toast already exists, and this would make the move feel physical.

## Lot routes: making it easier for sellers

The engine (route templates, a copy kept on each lot, buttons, undo, forwarder steps) is solid. What sellers are missing is *information at the moment they act*:

1. **A blocking checklist instead of an error.** When a lot can't move, list every held item with its buyer, its photo and the missing button, each with a tap to press it, plus "Move the rest and leave these behind" (move those items to an "awaiting" lot).
2. **Expected time per step and late-lot alerts.** Add an optional `typicalDays` to each `RouteStep`. Sellers then get "Customs: day 6 of usually 3–5" on the board and a nudge when a lot is late. Buyers get an ETA range instead of "In transit". Prefill it from the shop's own history (the median time between moves on past lots).
3. **Preview before "Update N lots to these steps".** Show each affected lot's current step on the old ladder and on the new one ("LOT K4-3F2A: *Customs* → *Clearing customs*"), and which buyers will be told. `rerouteLot` already works out the new position, so a `dryRun` flag can return it.
4. **Deleting a route should say how many lots are on it.** `usage[route.id].lots` is already loaded in `RoutesPage`. Put it in the confirm message.
5. **Undo for deleting a step** in Route Studio (a toast like the lot-move undo). Today one tap removes a step with its custom words and wait message.
6. **Lot cost sheet in the lot view:** freight, customs duty, forwarder fee and weight, split across items by weight. This gives the landed cost per item and margin per buyer. `ProfitBook` exists, so link it in from the lot rather than making sellers re-enter the numbers.
7. **Documents on the lot:** attach the airway bill, invoice and customs papers (PDF or photo) to a step, shown to the forwarder and handler, and to buyers only if the seller chooses.
8. **Bulk actions on the manifest:** select several items and press a button, mark them dispatched with one courier, or export the manifest as CSV or PDF for the forwarder.
9. **Per-step contact:** who to call at this step (the forwarder or handler phone, already on the lot), shown on the step itself.
10. **Accessibility:** step reordering already uses "Move up/down" menu items, which is good. Also add `aria-live="polite"` for the lane counts in Route Studio, so screen-reader users hear "2 in the lot" change when they move a line.

## Other additions worth considering

- **A real payment gateway** with escrow-style holds (Razorpay Route or Cashfree Marketplace) is still the main launch blocker.
- **Buyer ETA and "where is my parcel" sharing:** a public tracking link per order (read-only, unguessable token), so buyers can send it to family.
- **WhatsApp notifications for lot moves.** You already collect WhatsApp numbers at checkout, and this is where your buyers actually read updates.
- **A seller analytics view per route:** average days per step, items on hold, and dispute rate by route. This shows sellers which forwarder or route works best.
- **Search service and image moderation**, still open from the October audit.
