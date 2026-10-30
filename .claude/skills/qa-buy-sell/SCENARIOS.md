# Buy/sell scenarios

Each scenario: **who**, **what they try**, **what must be true**. Steps are a
person's intent, not exact clicks - find the way on screen like a user would,
and treat "I could not find how to do this" as a finding. "Both sides" means
check the buyer's and the seller's view of the same order.

Groups: A access · B selling · C checkout · D seller handling · E payments over
time · F fulfilment · G delivery & reviews · H cancel & reversal · I disputes ·
J wants, deals & extras · K edge cases & abuse.

---

## A. Access and gating

- **A1 Guest presses Buy.** Signed-out person opens `/listing/lst_my_cards`, taps Buy now. → A sign-in wall opens over the page ("You stay on this page"); closing it leaves them on the listing; no order created.
- **A2 Guest opens private pages.** `/purchases`, `/order/<any>`, `/sell`, `/wallet`. → Sign-in prompt, no data leaks, no crash.
- **A3 New account cannot trade.** `nisha` creates an account (name, WhatsApp number, email, password, 18+ box), verifies email with the on-screen code. Tries Buy now and Sell. → Buying is refused with a clear way to finish verification; Sell offers "Save draft and verify", not Publish. Nothing half-created.
- **A4 Draft survives verification nag.** As `nisha`, fill the sell form, "Save draft and verify", come back to Sell. → The draft is still there.
- **A5 Own listing.** `arjun` opens his own listing. → No Buy now; shows "Edit, quantity or delete" and Bump.
- **A6 Sign-in form checks.** Wrong password, unknown email, phone instead of email (`+919812345678`). → Clear error, no lockout surprises, phone login works.

## B. Selling - creating and managing listings (`arjun`)

- **B1 Simplest listing.** In hand, title, price ₹450, category, condition, description, one photo if possible, Publish. → Lands on/links to the listing; appears in Discover/feed and in his shop; preview card matched what was published.
- **B2 Fixed quantity.** More options → Stock: fixed 3. → "3 available" on the listing; quantity stepper for buyers maxes at 3.
- **B3 "Multiple" quantity.** → "Multiple available" / ∞, never a made-up number; buyer stepper allows up to 20.
- **B4 Import, lot later.** Where is it? → Importing, Lot "Add to a lot later". → Listing reads as an import; buyer sees it is coming from abroad.
- **B5 Import into a new lot.** Lot → "+ Open a new lot…", fill the modal, return. → Half-filled form intact, the new lot pre-selected; listing published inside it.
- **B6 Pre-order.** More options → Take pre-orders, bookings needed 5, close in 7 days. → "Pre-order" sticker; buyer sees "Buy a place now" with max quantity 1.
- **B7 Advance.** Accept an advance, 25 %. → "Booking Amt · 25%" strip; listing says "Book with ₹X (25%) now"; X is rounded up correctly.
- **B8 Limited-time deal.** Ends in 1 day. → Countdown shows; within 48 h it is flagged as closing soon.
- **B9 Affiliate + link discount.** Commission per unit and a buyer discount. → Listing offers an affiliate link; a buyer arriving through it sees the struck-through price (ties to C14).
- **B10 Validation.** Try publishing with: empty title, price 0, negative, letters, ₹99,99,99,999, 5,000-char description, emoji/Hindi title, `<img src=x onerror=alert(1)>` in title. → Sensible refusals; anything accepted renders as plain text everywhere (listing, card, order, notification).
- **B11 Edit live listing.** Change price and quantity on a listing that already has an open checkout from `meera`. → Listing updates; the existing order keeps its original price (check both sides).
- **B12 Delete / archive.** Delete a listing with no orders, then one with an order. → First disappears from browse; second is refused or handled without orphaning the buyer's order.
- **B13 Expiry and revive.** A deal that has expired → buyers see "This item has expired"; seller sees "Make available again" and it works.
- **B14 Quick Fill / saved items.** Start a listing from a Quick Fill template and from "From your saved items". → Fields prefilled sensibly, still editable.
- **B15 Bump.** Bump a listing; bump again until out of points. → Message states points left; refusal is clear when none left.
- **B16 Seller dashboard.** `/shop` tabs (orders/payments/lots/routes). → New listings and orders appear where expected, counts add up.

## C. Checkout - the buyer (`meera`, seller `arjun` unless noted)

- **C1 Quantity stepper.** On a 3-stock item: minus disabled at 1, plus disabled at 3. Pre-order: no stepper.
- **C2 Buy opens a checkout, not an order.** Buy now ×2. → `/order/<id>` "Not placed yet", total = 2 × price. As `arjun`: the order is **not** in his orders/notifications yet.
- **C3 Walk away from checkout.** Cancel/discard the unplaced checkout; also simply leave and come back via Cart (`/cart`). → Discard removes it; abandoned one is resumable from Cart; stock not held forever.
- **C4 Pay directly - with reference.** Choose "Buy directly from the seller", see Arjun's UPI and account name, tick "I have sent the payment", enter a reference, "Tell the seller I have paid". → Buyer: "Payment sent - waiting for the seller to confirm". Seller: notification + "Customer says they paid" + "Did this payment arrive?".
- **C5 Pay directly - screenshot only.** Same with a screenshot and no reference. → Accepted ("one of these two is enough"); seller can open the picture.
- **C6 Claim with nothing.** Tick sent, leave both empty. → "Tell the seller I have paid" stays disabled.
- **C7 Buyer Protection.** Choose "Add Buyer Protection". → Fee shown, total = due + fee, "Work in progress" notice, Pay disabled. (Expected today - report only if the numbers or wording are wrong.)
- **C8 Seller without payment details.** Buy from a seeded shop with no UPI (try several, e.g. Gadget Grid). → "Buy directly" disabled with the reason; Book still possible.
- **C9 Book.** Choose Book. → Order placed as a booking, no payment asked yet; seller sees "✅ Accept booking" / "❌ Reject".
- **C10 Book → accepted → pay.** Arjun accepts. → Meera notified, now gets "Pay ₹X"; completing C4 from here works.
- **C11 Pre-order "Buy a place now".** On B6's listing. → Place booked, fill meter moves (1/5); a second booking by another buyer moves it again.
- **C12 Sold out / expired.** Buy the last unit (qty 1 item) as `meera`; as `arjun` buying from someone else's sold-out item, or reload Meera's listing page. → "Sold out", Buy disabled; expired items cannot be bought.
- **C13 Last unit race.** `meera` and a desktop persona both open a qty-1 item and press Buy near-simultaneously; both try to place. → Only one order can be placed; the other gets a clear message, not a phantom order.
- **C14 Affiliate link price.** Arjun copies the affiliate link (B9); `meera` opens it. → Discounted price on listing and in checkout totals; seller sees the correct amount.
- **C15 Cart with several items.** Two items from Arjun, one from another shop, all in Cart. → Grouped per seller, totals correct, each checks out independently.

## D. Seller handling a new order (`arjun`)

- **D1 Payment arrived.** On C4's order: "Did this payment arrive?" → yes. → Both sides: paid; timeline "Paid ✓"; seller can move to dispatch.
- **D2 Payment did not arrive.** On another claimed order answer no (with the reason form). → Buyer is told clearly what happens next; order is not marked paid; buyer can re-claim or dispute.
- **D3 Accept fresh order.** → Status moves; buyer notified; reject no longer offered, cancel offered instead.
- **D4 Reject fresh order.** "❌ Reject" with a reason. → Buyer sees Rejected + reason; stock comes back on the listing; no review offered.
- **D5 Payment reminder.** Remind the buyer on an unpaid accepted order. → Buyer gets a notification; no spam on repeated taps.
- **D6 Seller order lists.** `/shop` payments/orders tabs and notifications after D1-D5. → Every order is where its status says it should be; counts match.
- **D7 Seller jumps ahead.** Before confirming a claimed payment, try "⚡ Dispatched". → Either refused or clearly allowed with sensible consequences; buyer view consistent. Record what happens.

## E. Money over time

- **E1 Advance then balance.** On B7's listing choose Pay advance (25 %), claim it; Arjun confirms. → Money bar Total/Paid/Balance correct on both sides; "💳 Pay more · ₹X left" for the buyer.
- **E2 Pay more in instalments.** From `/purchases` pay part of the balance, then the rest, same method forced. → Each payment listed with date and kind; balance reaches "Paid in full 🎉".
- **E3 Overpay.** Pay more than the balance. → Extra shown as credit; seller gets "refund credit" options.
- **E4 Seller refunds the credit.** Arjun refunds the extra with a reference. → Meera asked "did it reach you?" and can answer; both sides show the credit closed.
- **E5 Seller keeps credit, buyer spends it.** Arjun holds the credit; Meera buys another Arjun item. → "💰 Credit kept for you" line, due-now reduced; if it covers everything, "Place order with my credit" places it without a payment.
- **E6 Payment details request.** Seller asks the buyer to check refund details; buyer updates and confirms "I've Updated My Payment Details". → Seller sees confirmation.
- **E7 Allocation across items.** In `/purchases`, pay one amount across several outstanding items from the same seller. → The preview allocation equals what is recorded.
- **E8 Wallet.** `/wallet` (refunds, credit, details tabs) after E3-E6. → Every amount traceable to an order.

## F. Fulfilment

- **F1 Direct ship.** In-hand paid order: Arjun ticks Dispatched (with tracking if asked), later Delivered. → Buyer timeline updates at each step with the same words.
- **F2 Import via a lot.** Arjun opens a lot (`/shop?tab=lots`), files Meera's import order into it, advances the lot through its route steps, adds tracking. → Meera sees the lot's timeline at `/purchases/lot/<id>` and on the order; each step appears once.
- **F3 Bulk checkpoints.** Mark several orders at a checkpoint at once. → Each buyer's timeline gets it; cancelled orders untouched.
- **F4 Lot details and crew.** Edit lot dispatch date / forwarder; give `packer` access. → `packer` sees pieces and nothing about buyers.
- **F5 Order photos.** Seller adds QC/packing photos to an order. → Buyer sees them; another buyer cannot.
- **F6 Cancelled order in a lot.** Cancel an order filed in a lot, then advance the lot. → The cancelled order does not move.

## G. Delivery, completion and reviews

- **G1 Buyer confirms receipt.** On a shipped/delivered direct order: "📬 I received it". → Completed on both sides.
- **G2 Seller cannot confirm for the buyer.** → No such control for Arjun anywhere.
- **G3 Blind reviews.** Meera reviews first. → Arjun cannot read it until he writes his; after both, both visible; trust scores update.
- **G4 No review without completion.** On an unpaid or cancelled order → no review option.
- **G5 Unboxing share.** Buyer shares an unboxing after delivery. → Works; no private data in the share card.

## H. Cancel and payment reversal

- **H1 Cancel accepted, unpaid.** Arjun cancels an accepted unpaid order. → Buyer told; stock restored; no money steps.
- **H2 Cancel paid → reversal.** Arjun cancels a paid order. → Status "Payment Reversal Pending" on both sides; seller gets "↩️ Payment reversal".
- **H3 Reversal details round-trip.** Seller requests details → buyer confirms → seller submits reversal with reference. → Buyer gets "Payment Received / Payment Not Received".
- **H4 Reversal received.** Buyer: Payment Received. → Closed as cancelled & reversed.
- **H5 Reversal not received.** Buyer: Payment Not Received → raise dispute. → Dispute opens and is visible in `/disputes` on both sides.
- **H6 Buyer tries to cancel after paying.** → Whatever the rule is, the buyer is told how to proceed (message seller / dispute), not left with a dead end.

## I. Disputes

- **I1 Buyer raises one.** "⚖️ Raise a dispute" / "Something is wrong" with each reason (never arrived, not as described, damaged, wrong item, not genuine) and evidence. → Seller notified; `/dispute/<id>` shows the thread.
- **I2 Conversation and offer.** Seller replies, makes a partial refund offer; buyer accepts. → Amounts consistent; dispute resolved; order reflects it.
- **I3 Withdraw.** Buyer withdraws. → Closed as withdrawn; order continues.
- **I4 Escalate.** Either side escalates to mediation. → Status under mediation; manager assignment visible. (Meera is a manager - note if she can mediate her own case: she must not.)
- **I5 Seller-side reasons.** Arjun raises one on a shipped order (buyer unresponsive, false claim…). → Allowed only where the rules say.
- **I6 Dispute on an unplaced checkout.** A "Raise a dispute" button appears on a not-yet-placed checkout (seen 2026-10-23). → Check what it does; a dispute about an order that does not exist yet is likely a bug.
- **I7 Lists.** `/disputes` and `/refunds` for both people after I1-I5. → Complete and consistent.

## J. Wants, private deals and extras

- **J1 Wanted post.** Meera posts a want in Social → Wanted. Arjun offers on it; Meera sees the offer and buys through it; she closes the want. Others can tap "me too".
- **J2 Private deal from chat.** Meera messages Arjun about an item (Message about this item), asks for a private deal; Arjun sends "🤝 Send private deal" at a special price. → Only Meera can see/buy it at that price; checkout uses the deal price.
- **J3 Ask / offer in chat.** Bargain in messages with the item attached. → Item card shows; links back to the listing.
- **J4 Power sale.** Arjun builds a power sale (`/shop/power-sale`), Meera buys during it, Arjun stops it. → Prices change in and out of the sale; orders keep the price paid.
- **J5 Save and follow.** Meera saves an item and follows the shop. → Appears in saved; follower count moves; Arjun's new drop reaches her feed/notifications.

## K. Edge cases a real person causes

- **K1 Double tap.** Double-click Buy now, "Tell the seller I have paid", Accept, Pay more. → One order/claim/payment, never two.
- **K2 Back and reload.** Back after claiming payment, reload mid-checkout, reopen the order from a notification. → No resubmit, state intact.
- **K3 Stale screen.** Meera keeps a checkout open while Arjun edits price / sells out / deletes the listing; Meera then pays. → She is told about the change before money moves.
- **K4 Wrong person.** Meera opens Arjun's sale URL of someone else's order; Arjun opens a checkout of Meera's that is not placed. → Neither can see or act on what isn't theirs.
- **K5 Phone vs desktop.** Repeat C4 + D1 with `--desktop`. → Nothing cut off, sticky buttons reachable, no horizontal scroll on phone.
- **K6 Long and odd input.** Very long references, emoji, Devanagari, pasted spaces in UPI reference, ₹ with commas. → Accepted or refused cleanly; displayed safely.
- **K7 Server restart mid-flow.** Restart (`QA_SKIP_BUILD=1 start.sh`) during a checkout, then continue. → Signed-out state or a clear error, not a blank screen. (Data loss is expected with the in-memory store.)
- **K8 Console and network.** `errors` after every group. → Zero page errors and zero 5xx.
