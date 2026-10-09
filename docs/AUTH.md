# Auth

Real authentication is deferred. Azure AD B2C is closed to new tenants (May
2025), and the replacement — Microsoft Entra External ID — has not been chosen
over Auth0 or Clerk yet. This document describes the seam that makes that
choice a contained change rather than a rewrite.

## The rule

**No feature code checks auth directly.** Nothing outside `api/src/auth/` reads
a cookie, a header, or a principal claim. Handlers call one of three methods on
`AuthService` and receive an `AuthUser`:

```ts
const auth = await getAuthService();

const user = await auth.getCurrentUser(request);            // AuthUser | null
const user = await auth.requireAuth(request);               // throws 401
const user = await auth.requireCapability(request, ['sell']); // throws 401 / 403
```

`AuthUser` (in `shared/contracts.ts`) is provider-agnostic: the mock provider
builds it from a seeded user record, and a real provider builds the same shape
from its own claims. Because it is shared with the frontend, both sides see the
same identity type.

**Capabilities, not roles.** Every account is both buyer and seller — selling is
simply what happens when an account lists something — so a single mutually
exclusive role cannot describe a real user. `canBuy`, `canSell` and `canForward`
are *derived* from verification state by `deriveCapabilities` in
`shared/capabilities.ts`, shared by both sides so the client never reimplements
the rules. `isAdmin` is the exception: a genuine assigned role, stored on the
record.

Capability is not authorisation on its own — and less so than a role was.
`requireCapability(request, ['sell'])` answers "may this account sell?", to which
the answer is almost always yes; it says nothing about *whose* lot is being
read. Ownership is a separate check at the point of use, and seller-scoped
routes need both. `lot-routes.ts` shows the pattern.

## What exists now

`MockAuthProvider` — development only, in `api/src/auth/mock-provider.ts`.

- Username and password against users seeded into the repository.
- Passwords are scrypt-hashed, compared in constant time, and compared even when
  the user does not exist so a missing account and a wrong password take the
  same time to answer.
- Sessions are a signed envelope — `base64url(payload).base64url(HMAC-SHA256)` —
  set as an HttpOnly, Secure, SameSite=Lax cookie, and also returned as a bearer
  token for non-browser clients. A bearer header takes precedence over the cookie.
- Logout records the token's digest (never the token) in a revocation list that
  expires itself via the container's TTL.
- **Session length.** A session lasts 12 hours from when it was last renewed.
  `GET /api/auth/me` (every app load) renews the cookie once the token is an
  hour old, so a session in use does not run out mid-use. No renewal goes past
  14 days from the sign-in itself (`aut` in the token); then the password is
  asked for again.
- **Sign out everywhere.** `POST /api/auth/logout-all` (profile menu → "Sign out
  everywhere") stamps `sessionsValidAfter` on the account; every token issued
  before it is refused, on every device, from that moment.
- **Passwords.** 8 to 128 characters; not a common password, a repeated
  character or a keyboard run; not containing the person's name, handle or
  email name; and, where `PASSWORD_BREACH_CHECK` is on (the default when
  deployed to Azure), not found in Have I Been Pwned's breach corpus. That check
  uses the k-anonymity range API: only the first five characters of the
  password's SHA-1 leave the server. If the service is unreachable the check
  passes rather than blocking sign-up.
- **Throttling.** Wrong passwords are counted per account *and* address: 8 in
  10 minutes locks that address out of that account, and nobody else - typing
  someone's email with bad passwords cannot lock them out. Guessing spread over
  many addresses is capped per account too (20 in 15 minutes, 100 a day), but
  only for browsers that have never signed in to it: a successful sign-in sets
  a signed `figmark_device` cookie (Path `/api/auth`, 180 days, ended by "sign
  out everywhere"), and the owner's own browser is never held back by somebody
  else's guessing. Each address is also limited across every account (30
  sign-ins a minute, 300 an hour; 20 sign-ups an hour, 100 a day) - generous,
  because a mobile carrier puts many people behind one address. These counters,
  like every rate limit in `api/src/rate-limit.ts`, are shared by all instances
  through the `sessions` container, so they hold across scale-out and restarts.

It signs its own tokens and stores its own password hashes, which a real
provider will not do. Everything about it is expected to be deleted.

## What is ready for the swap

`StaticWebAppsAuthProvider` — `api/src/auth/swa-provider.ts`, selected by
`AUTH_MODE=swa`.

Static Web Apps terminates the identity provider and injects the resulting
principal as an `x-ms-client-principal` header. The provider decodes it, resolves
`principal.userId` to the application's own user document, and prefers a
platform-supplied `admin` role over the stored flag, so administrator access can
be revoked in the identity provider without a write to our store. The other
capabilities stay derived from verification state, which is ours to decide. Login and logout are refused,
because the platform owns them at `/.auth/login/<provider>` and `/.auth/logout`.

**The header is only trusted where it cannot be forged.** Static Web Apps sets
`x-ms-client-principal`, but nothing in the header proves that: anyone who can
reach the Functions app other than through Static Web Apps can send it and be
any user, admin included. So on Azure the provider accepts no principal at all
until `SWA_PRINCIPAL_TRUST` says why it can be believed:

- `managed` - the API is the Static Web App's own managed functions, which have
  no address of their own.
- `linked` - a linked Functions app whose App Service Authentication is on and
  restricted to the Static Web App, so the header is stripped from any request
  that did not come through it. Check this before setting it: a linked app with
  its own public hostname and no such restriction is exactly the hole.

Off Azure (the SWA CLI on a laptop) it is trusted as before.

## Swapping in a real provider

1. Configure the provider in `staticwebapp.config.json` under `auth`, and
   register the app with it. Confirm the Static Web Apps plan supports a custom
   provider — this may require the Standard plan.
2. Provision a user document per external identity, using the provider's stable
   subject claim as the document `id`. That is the only linkage the provider
   assumes.
3. Set `AUTH_MODE=swa` in the app settings.
4. Point the frontend's sign-in control at `/.auth/login/<provider>` instead of
   `POST /api/auth/login`. `SignInPanel` is the only component that touches
   sign-in.
5. Set `SWA_PRINCIPAL_TRUST` (above).
6. Delete `mock-provider.ts`, `passwords.ts`, `tokens.ts` and the `passwordHash`
   and `sessionsValidAfter` fields on `User`. Keep the `sessions` container: the
   shared rate-limit counters live there too.

If a third-party provider (Auth0, Clerk) is chosen instead, write a third
implementation of `AuthService` — validating that provider's JWT — and select it
in `api/src/auth/index.ts`. No handler changes either way.

## Verification fields

Every `User` carries a full `VerificationState` plus separate buyer and seller
trust records from day one, described in [DATA-MODEL.md](DATA-MODEL.md).

Buying and selling (listings, private deals, power sales, want offers, pledges,
checkout and payment) need **email, a WhatsApp-verified phone and an Aadhaar
whose linked mobile is that same phone** - see [VERIFICATION.md](VERIFICATION.md).
Nothing typed in at sign-up is treated as verified. Each status needs its proof
in `verification.proofs`; accounts marked verified before real checks existed
have no proof and so are not trusted. An operator can grant or block buying and
selling per account from the admin user list. Seeded fixtures are fully
verified (with `via: 'seed'` proofs) so the demo works end to end.

## Before this goes near real users

- `AUTH_SESSION_SECRET` should be set in the deployed app settings. Without it
  the key is derived from `COSMOS_KEY`/`STORAGE_KEY` when present. With no key
  material at all, a deployed API (running in Azure, or with a database) switches
  sign-in off and says so; the committed development constant is used only on a
  developer's machine with the in-memory store.
- The password provider (`AUTH_MODE=mock`, the default) is the live sign-in
  until an external identity provider replaces it. It no longer marks anything
  verified at sign-up. Its seeded demo accounts have passwords published in this
  repository and are fully verified, so do not seed a production database
  (`azure:provision -- --seed`).
