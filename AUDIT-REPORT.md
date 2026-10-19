# Figmark pre-launch audit

Date: 19 Oct 2026 · Commit `7c606f4` · Tested locally (`npm run serve`, in-memory store, mock auth). The live Azure site could not be reached from the test environment (the egress proxy returned 403), so nothing here was checked against Cosmos, Blob Storage or the deployed host.

## How it was tested

| Area | Method | Result |
|---|---|---|
| Build + typecheck | `npm run install:all && npm run build` | Pass. One Vite warning, see P-6 |
| Existing test suite | `npm test` (21 scripts) | **892 checks, 0 failures** |
| Dependency audit | `npm audit` on api and app | Shipped dependencies: 0 vulnerabilities. App dev dependency: 1 high (`source-map-js`, through Vite) |
| Authorization fuzz | Every one of the 317 API routes, called as anonymous, a new unverified user, and two seeded third-party accounts, using real IDs of other people's orders, lots, listings and disputes | No IDOR found. Every write on someone else's resource returned 401, 403 or 404 |
| Business-logic abuse | Bad quantities (0, -1, 1.5, "2", 1e9), double payment race, early review/confirm, buyer calling seller actions, repeated quest XP claims | All rejected correctly. Concurrent `pay` → one 200, one 409, one fee in the ledger |
| Auth | Logout, sign-out-everywhere, tampered token, bearer token, forged token, brute force, IP rotation | One bug, see B-1 |
| Abuse/DoS | 60 MB JSON bodies, signup and login rate limits with spoofed IP headers | See S-3, S-4 |
| Injection/XSS/SSRF | OG HTML escaping, user URLs (`javascript:`), every outbound `fetch` | No exploitable issue. CSP blocks inline script |
| UI crawl | 35 routes × (anonymous, signed in) in headless Chromium on a 390×844 phone viewport: console errors, failed requests, horizontal overflow, screenshots | No crashes or JS errors, no sideways scroll. See B-2 |
| Accessibility | axe-core (WCAG 2 A/AA) on 11 key pages | 6 rule types failing, see A-1 |
| Page weight | Resource listing, gzip sizes, CSS/JS coverage | See P-1 to P-5 |

Overall the code is careful and well defended. Authorization, input validation, idempotency and optimistic concurrency hold up under direct attack. The real launch blockers are product and operational gaps: simulated payments, no password reset, mock auth, demo fixtures, and legal pages. Code defects are few.

---

## 1. Bugs

**B-1 · Signing in within the same second as "Sign out everywhere" creates a session that's already dead** · Low
`api/src/auth/mock-provider.ts:571`. `payload.iat` is in whole seconds and `sessionsValidAfter` is in milliseconds, so `iat * 1000 < after` is true for a token issued in the same second. Reproduced: logout-all, then immediate login → login returns 200, but the next `/auth/me` is anonymous. A login 1.5 s later works. `trustsDevice` (line 297) has the same off-by-sub-second problem.
*Fix:* store `sessionsValidAfter` rounded up to the next whole second, or carry ms precision in the token.

**B-2 · `VoiceProvider` loads "my shops" once, before sign-in, and never again** · Medium (UX)
`app/src/components/SocialVoice.tsx:41-54`. The effect has `[]` dependencies and no `user` guard. Effects:
- Every anonymous page view fires `GET /api/me/stores` → 401, which shows as a console error on `/`, `/discover`, `/s/d` and `/i/*`.
- Someone who signs in without a full reload gets an empty shop list, so they can't post as their shop until they reload.
- On a shared device, after a sign-out or account switch the previous account's shop identities stay in memory. The server refuses the post, but the picker shows the wrong shops.
*Fix:* depend on `user?.id`, skip the call when there's no user, and clear the list on sign-out (same pattern as `CreateSheet.tsx:91`).

**B-3 · The local dev server doesn't mount 3 production routes, so smoke tests never exercise them** · Medium (test gap)
`scripts/dev-server.mjs` has no handlers for `POST /api/me/profile` (profile bio/cover/tags save, called from `app/src/api.ts:2943`), `POST /api/ops/route-buttons/save` and `POST /api/ops/route-common/save`. They work on Azure, where `app.http` registers them, but under `npm run serve` they return 404 and no test covers them.
*Fix:* mount them, and add a check (like `check-routes.mjs`) that fails when an `app.http` route is missing from the dev server.

**B-4 · Documentation drift** · Trivial
README says `npm test` runs "57 checks" (it runs 892). `docs/AUTH.md` says `isAdmin` is "stored on the record", but it's derived from `ADMIN_EMAILS` (`api/src/config.ts:157`).

---

## 2. Security

| # | Finding | Severity | Where / evidence | Recommendation |
|---|---|---|---|---|
| S-1 | **An empty production Cosmos DB autoseeds the demo accounts** (password `figmark123`, published in the repo and listed on `/api/health`), including a community manager who decides disputes. After that, every cold start tops the fixtures up again. | **Critical before launch** | `cosmos-repository.ts:270`, `topUpFixtures` at `:954`, `listDemoAccounts` at `:2498` | Set `COSMOS_AUTOSEED=off` in production, or invert the default to off when running in Azure. Use a separate database for demos. |
| S-2 | On Azure **without Cosmos** (memory store) but with `AUTH_SESSION_SECRET` set, `demo@figmark.in` is automatically an admin with the public password. | High (misconfiguration) | `config.ts:157-164` | Never default an admin on Azure. Require `ADMIN_EMAILS` whenever `runningInAzure()`. |
| S-3 | **Rate limits trust client-supplied IP headers.** `clientIp()` falls back to `x-client-ip` and then `x-forwarded-for`. Locally, rotating `x-client-ip` allowed 30/30 signups, where the limit is 20/hour per IP. Per-account login caps still held. | Medium (depends on SWA header handling) | `rate-limit.ts:204` | On Azure, use only `x-azure-clientip` (or the platform's trusted header). Verify on the deployed site. Add a CAPTCHA (Turnstile/hCaptcha) to signup. |
| S-4 | **No request-body size cap before JSON parsing.** A 60 MB body is fully parsed (~1 s CPU, +150 MB RSS) before the handler returns "Keep a post under 2000 characters". A few concurrent requests can OOM a worker. | Medium | `http.ts` `handler()` wrapper; every `request.json()` | Reject on `Content-Length` in the `handler` wrapper: about 64 KB by default, about 1.5 MB for photo routes. |
| S-5 | **Account lockout from new devices.** 20 wrong passwords in 15 min (100/day) blocks sign-in to that account from every device that hasn't signed in before. Reproduced. The owner's existing devices are exempt (good), but a user on a new phone can be locked out by anyone who knows their email. | Low–Medium (accepted trade-off) | `rate-limit.ts` `login_fail_account` | Add an emailed unlock link or step-up (OTP) instead of a hard block. |
| S-6 | `/api/health` is public and returns the Cosmos endpoint, the auth method, raw error descriptions and demo credentials. | Low | `health.ts` | Return only `status` publicly, and the detail only to admins. |
| S-7 | Session cookie is `SameSite=Lax` with no CSRF token. Safe today: all writes are POST + JSON, and no state-changing GETs were found. But `*.azurestaticapps.net` siblings may count as same-site. | Low | `tokens.ts:146` | Launch on a custom domain. Optionally require `Content-Type: application/json` or an `X-Requested-With` header on writes. |
| S-8 | `img-src https:` lets user-supplied image URLs (profile cover, store links, wanted photos) load third-party trackers that see viewers' IPs. | Low | `staticwebapp.config.json` CSP | Proxy or re-host user images, or restrict `img-src` to own blob and CDN. |
| S-9 | scrypt runs at Node defaults (N=16384). | Low | `auth/passwords.ts` | Raise to N=2^17 (OWASP), with rehash on login. |
| S-10 | The app's dev toolchain has 1 high advisory (`source-map-js`, ReDoS) and isn't shipped. | Info | `npm audit` | Run `npm --prefix app audit fix`. |
| S-11 | No MFA, even for admins and community managers who move held money. | Medium (for launch) | — | Require TOTP/passkey at least for `ADMIN_EMAILS` and managers. |

Verified secure: HMAC session tokens with timing-safe compare; tampered and forged tokens rejected; logout and logout-all revoke; secrets and `passwordHash` stripped from every response (`http.ts` STORE_FIELDS); parameterised Cosmos SQL; HTML-escaped OG pages; no `dangerouslySetInnerHTML`; outbound fetches only to fixed hosts (no SSRF); WhatsApp webhook HMAC-checked; strong CSP, HSTS, `X-Frame-Options`, `Permissions-Policy`; GitHub Actions pinned by SHA with least-privilege permissions; no source maps shipped.

---

## 3. Performance, page load and resource use

Measured locally, uncompressed (Azure serves gzip/brotli).

| # | Finding | Impact | Recommendation |
|---|---|---|---|
| P-1 | **One 446 KB global stylesheet (84 KB gzip), render-blocking on every page, and 90% of it is unused on the home page** (Chrome coverage). It comes from `app/src/styles.css`, 11,512 lines. | Biggest first-paint cost on 3G/4G | Split by route: move page-specific rules next to the lazy page (Vite already code-splits CSS per chunk). Keep shell and tokens global. Target under 25 KB gzip critical CSS. |
| P-2 | First-load JS: `main` 90 KB + `vendor` 60 KB + `styles` chunk 29 KB = **179 KB gzip** before the first screen. The `ShopPage` chunk is 219 KB raw / 63 KB gzip (5,007-line file). | Slow TTI on low-end Android | Split `ShopPage` by tab, lazy-load `FloatingCalc` (53 KB) and the Quest/Showcase widgets, and check what `main` pulls in eagerly. |
| P-3 | **Every page makes 8 bootstrap API calls**: `auth/me`, `health`, `route-words`, `me/items`, `push/key`, `notifications`, `invite/me`, `quest/me`. Each is a separate Functions invocation, and each also runs `syncRouteWords` in the `handler` wrapper. | Latency, cold starts, cost | One `GET /api/bootstrap` that returns all of them. Cache `push/key` and `route-words` with `Cache-Control`. Drop `health` from the client, or fetch it only for the banner when signed in as admin. |
| P-4 | Blob uploads set no `Cache-Control`, and photos are served straight from Blob Storage (no CDN). The names are UUIDs, so they're immutable. | Repeat image downloads | `blobHTTPHeaders: { blobCacheControl: 'public, max-age=31536000, immutable' }` in `blob-store.ts:66`. Put Azure Front Door/CDN in front of the photos container. |
| P-5 | One size per photo (up to 90 KB), with no thumbnails or `srcset`. Feed and grid tiles download the full image. | Feed bandwidth | Generate a ~20 KB thumbnail at upload, and use `srcset`/`sizes`. |
| P-6 | `VerifyPage` is lazy-loaded in `main.tsx` but also imported statically by AppShell, Sell, Shop and Social pages, so it ships in the main bundle (Vite warning). | Small main-bundle bloat | Import only the shared helper those pages need, not the page. |
| P-7 | The catalog query uses `@all = true OR …` and `CONTAINS` clauses across partitions. Fine at seed scale, but RU cost grows linearly with listings. | Cosmos cost at scale | Use distinct query shapes per filter. Move text search to Azure AI Search, or a Cosmos full-text index, before the catalog grows. |
| P-8 | On every cold start with autoseed on, `topUpFixtures` reads every id from 13 containers. | Cold-start RU and latency | Becomes moot with S-1 (autoseed off in prod). Otherwise gate it behind a version marker. |
| P-9 | `bumpListing` reads, then replaces without an etag. Two bumps can race. | Minor | Use `writeChecked`, like lots and orders. |

Already good: hashed assets cached as immutable for a year; HTML, `sw.js` and boot files are `no-cache`; fonts self-hosted, subset and preloaded; photos compressed off-thread to ≤90 KB; polling pauses when the tab is hidden; reads deduplicated for 5 s on the client; API import (cold start) ~0.5 s.

---

## 4. Accessibility (axe-core, WCAG 2 AA)

**A-1**
- `color-contrast`: 78 nodes on 8/11 pages (for example the small XP text in the quest chip).
- `link-name`: 9 nodes. The `.brand` logo link has no accessible name.
- `scrollable-region-focusable`: `.trkbox` on order and profile pages.
- `aria-hidden-focus`: `.soccompact` on `/social`.
- `aria-prohibited-attr`: `.qring` on `/me`.
- `definition-list`: a malformed `<dl>` on the listing page.

All are small fixes.

---

## 5. Pending before launch

### Blockers
1. **Real payments.** All charges, holds, payouts and fees are simulated (`simulatedPayment: true`, fake `gw_…` refs in `community.ts:91-130`, `order-routes.ts:46`, `dispute-routes.ts`). Needs a payment gateway (Razorpay/Cashfree/PayU) with webhooks, refunds, payouts and reconciliation.
2. **Regulatory basis for holding buyer money.** "Held by Figmark" escrow in India needs an RBI-authorised Payment Aggregator, or the gateway's escrow/nodal product. Confirm with counsel before taking money.
3. **Real authentication.** `AUTH_MODE=mock` is the only provider in use. `docs/AUTH.md` says the real provider (Entra External ID / Auth0 / Clerk) is still undecided. At minimum the mock provider needs:
   - **password reset / forgot password** (none exists)
   - email-change flow
   - MFA for staff (S-11)
4. **Production configuration**:
   - `COSMOS_AUTOSEED=off` (S-1)
   - `AUTH_SESSION_SECRET`
   - `ADMIN_EMAILS`
   - `PUBLIC_ORIGIN` (needed once a custom domain is added, or share cards point at the azurestaticapps URL)
   - `SWA_PRINCIPAL_TRUST` if using SWA auth
   - Web Push VAPID keys (`push/key` currently returns null)
   - email provider keys (Brevo/Mailjet/Resend)
   - WhatsApp Cloud API
   - `AADHAAR_QR_CERT`

   Without the last three, **no new user can verify, and so no new user can buy or sell** (buying requires email + WhatsApp + Aadhaar). Only an operator grant gets them in.
5. **Run against live Azure.** Per `docs/AZURE.md` ("What still needs doing"), nothing has been verified against real Cosmos, Blob Storage or the SWA host: provisioning, `azure:check`, `azure:live-check`. Also set the GitHub default branch to `main`.
6. **Legal pages and policies**: Terms, Privacy Policy, refund/cancellation and shipping policies, prohibited-items list, a Grievance Officer contact (Consumer Protection (E-Commerce) Rules 2020, IT Rules 2021), and DPDP Act 2023 consent and notice. None exist in the app today.
7. **Aadhaar handling.** Making Aadhaar mandatory to *buy* is a legal risk (private entities can't make Aadhaar compulsory) and a heavy conversion barrier. Offer alternatives (PAN, DigiLocker, or phone + payment KYC). Document retention for the stored name and last-4.

### Should do before launch
8. Self-serve **account deletion and data export** (only admin delete exists). Needed for DPDP.
9. Fix S-2 to S-6 and B-1 to B-3.
10. **Monitoring**: no client error reporting, and Application Insights excludes request sampling but has no alerts. Add frontend error capture, availability tests on `/api/health`, and alerts on 5xx and Cosmos 429s.
11. **Backups/DR**: enable Cosmos continuous backup (PITR) and blob soft-delete. Write a restore runbook.
12. **Abuse controls**: a CAPTCHA on signup; image moderation for uploads (only text moderation found); reporting SLAs for staff.
13. Performance items P-1 to P-4. They give the biggest page-load win for the least work.
14. Accessibility fixes in A-1.
15. A **custom domain** with HTTPS (also tightens cookie scope, S-7).
16. **Load test** the bootstrap and feed endpoints on Cosmos serverless, to size RU/s and decide between serverless and provisioned.

### Nice to have
- Precache the app shell in the service worker for instant repeat loads.
- Thumbnails/CDN (P-4, P-5); a search service (P-7).
- Split the largest files (`ShopPage.tsx` 5k lines, `styles.css` 11.5k lines, `social-routes.ts` 3.4k) for maintainability.
- An end-to-end Playwright suite in CI for the core money flows (list → buy → pay → ship → confirm → review → dispute), on top of the existing API smoke tests.
