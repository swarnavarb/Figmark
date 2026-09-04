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
5. Delete `mock-provider.ts`, `passwords.ts`, `tokens.ts`, the `sessions`
   container, and the `passwordHash` field on `User`.

If a third-party provider (Auth0, Clerk) is chosen instead, write a third
implementation of `AuthService` — validating that provider's JWT — and select it
in `api/src/auth/index.ts`. No handler changes either way.

## Verification fields

Every `User` carries a full `VerificationState` plus separate buyer and seller
trust records from day one, described in [DATA-MODEL.md](DATA-MODEL.md). The
seeded accounts have a verified phone so they can transact; everything heavier
(ID, bank match, business registration) is unverified, which is what keeps the
seller tier low and leaves the "become a verified seller" flow meaningful.

The bar to transact is deliberately low — a verified phone — because the model is
light friction at signup with the heavier checks deferred to where they matter:
payouts, and high-value listings.

## Before this goes near real users

- `AUTH_SESSION_SECRET` **must** be set in the deployed app settings. Without
  it, `config.ts` falls back to a constant development secret that is committed
  to this repository, and anyone can mint a valid session token.
- The mock provider must not be reachable in production. It is gated only by
  `AUTH_MODE`, which defaults to `mock`.
