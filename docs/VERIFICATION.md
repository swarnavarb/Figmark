# Verification

Browsing is open to everyone. **Buying and selling** - listings, private deals,
power sales, offers on wants, pre-order pledges, checkout and payment - need all
three checks below, or an operator's grant.

| Check | How it is proved | Cost |
|---|---|---|
| Email | A 6-digit code is emailed at sign-up and typed back. | Free (Brevo: 300 emails/day) |
| WhatsApp number | The person taps **Verify on WhatsApp**; WhatsApp opens with a message holding a one-time code; they send it to Figmark's WhatsApp number. WhatsApp tells us which number sent it, so it must be the account's number. | Free (messages people send you cost nothing) |
| Aadhaar | The person scans their Aadhaar **Secure QR** (letter, e-Aadhaar PDF or mAadhaar). The API checks UIDAI's RSA signature offline, then matches the Aadhaar-linked mobile to the WhatsApp-verified number: QRs from 2022 on (V2, V3, V5) carry only its last 4 digits, which must be the same; older QRs carry a hash of the whole number, which the API recomputes the way UIDAI does. The proof records which (`mobileMatch`: `last4` or `hash`). | Free (offline, no licence) |

**The WhatsApp number and the Aadhaar-linked mobile must be the same number.**
That match is what ties the Aadhaar to the person holding the SIM. The app says
so at sign-up, on the WhatsApp step and on the Aadhaar step; on a mismatch the
error names the last four digits of the Aadhaar-linked number (V2 QRs carry
them) so the person knows which number to switch to. A number can be corrected
before it is verified (Verification → Change); changing it resets the phone and
Aadhaar checks.

Kept from the Aadhaar: name, date of birth, gender, last 4 digits, the matched
number and the date. Never the full number, address or photo. Consent is a
required checkbox.

Code: `shared/verification.ts` (the rules), `api/src/verification/` (email,
WhatsApp, Aadhaar), `api/src/functions/verify-routes.ts` (HTTP),
`app/src/pages/VerifyPage.tsx` (the screens), `scripts/smoke-verify.mjs` (tests).

## Operators

Admin → Users shows every account's Email / WhatsApp / Aadhaar ticks and
whether it can buy and sell. Open an account → **Buying and selling** to set
each side to *By verification*, *Granted* or *Blocked*, with a required reason
(kept with who and when). Use it for people who cannot finish - no WhatsApp, an
Aadhaar without a linked mobile - and to stop a verified account.

### Manual review requests

Someone who cannot finish a check uses **Ask for a manual review** at the bottom
of the Verification page: they pick the step they are stuck on and say what is
wrong (`POST /api/verify/review`; `{ withdraw: true }` takes it back). Nothing is
marked verified by asking.

Requests wait at the top of Admin → Users ("Waiting for a manual review",
`GET /api/ops/reviews`, oldest first), and the account carries an *asked for
review* badge. Check who they are another way before granting. Saving
**Buying and selling** answers the request, whatever you chose, and notifies
them:

- **Granted** on either side: they are told they can buy or sell. The reason is
  your note and is not shown to them.
- Both left on *By verification*: the request is turned down and **the reason
  is shown to them**, so write it for them.

A grant does not give the Email / WhatsApp / Aadhaar ticks. Those come only from
the checks themselves, so a granted account still reads as unverified on its
public page. Finishing all three checks clears a waiting request.

## Settings

Each piece switches on when its settings are present. Until then its step says
it is not set up yet and points to a manual review, which an operator answers by granting rights.

| Setting | What |
|---|---|
| `AUTH_SESSION_SECRET` | Any long random string. Signs sessions. |
| `EMAIL_FROM` | The sender address, verified with each email provider below. |
| `EMAIL_FROM_NAME` | Optional, default `Figmark`. |
| `BREVO_API_KEY` | Brevo → SMTP & API → API keys. Used first (free: 300/day). |
| `MAILJET_API_KEY`, `MAILJET_SECRET_KEY` | Mailjet → Account → API keys. Used when Brevo is full (free: 200/day, 6,000/month). |
| `RESEND_API_KEY` | Resend → API Keys. Used when Mailjet is full (free: 100/day, 3,000/month). Needs a verified domain. |
| `BREVO_FROM`, `MAILJET_FROM`, `RESEND_FROM` | Optional: a different sender for that provider (e.g. Resend's verified domain). |
| `<NAME>_DAILY_LIMIT`, `<NAME>_MONTHLY_LIMIT` | Optional: override a provider's allowance if its free plan changes. |
| `WHATSAPP_BUSINESS_NUMBER` | The WhatsApp Business number people message, e.g. `+91 90000 00001`. |
| `WHATSAPP_VERIFY_TOKEN` | Any string; typed into Meta's webhook settings too. |
| `WHATSAPP_APP_SECRET` | Meta app → App settings → Basic → App secret. Checks each webhook's signature. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Optional: lets Figmark reply "verified" in the chat. |
| `AADHAAR_QR_CERT` | Optional. UIDAI's signing certificates ship with the API in `api/assets/uidai/`: the offline e-KYC keys DS 03 to DS 06 (2017 to 2029) and the Secure QR Code keys DS 4 and DS 7 (2017 to 2021, which still sign older e-Aadhaar QRs), plus UIDAI's authentication signing keys DS UIDAI 01 (2020 to 2023) and the 2023 to 2026 one, kept in case they signed QRs in those years, so Aadhaar works without this. Use it only for a new key UIDAI publishes before the next deploy: PEM blocks one after another, or base64 values separated by commas. It adds to the shipped keys, and a value that can't be read is logged and skipped. |

### Email: three free tiers, one after another

Codes go out through Brevo until today's allowance is used, then Mailjet, then
Resend (any of the three can be left unset). Counts are kept in one shared
database document (`siteContent/email-usage`), so every worker sees the same
numbers, and each send reserves its slot first so parallel sends cannot
overshoot. A provider that refuses for quota is skipped for the rest of the UTC
day even if our count says it has room; an outage only skips it for that one
email. Everything resets at midnight UTC (monthly counts on the 1st). Admin →
Users shows today's counts. When all three are full, the person is told to try
later. Together that is about 600 codes a day for free.

### WhatsApp Cloud API setup (once)

1. developers.facebook.com → Create app → Business → add **WhatsApp**.
2. Add a phone number that is not already on WhatsApp, and verify it.
3. WhatsApp → Configuration → Webhook: callback
   `https://<your-site>/api/verify/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`.
   Subscribe to **messages**.
4. Complete Meta business verification to go beyond test numbers.

On a local run with the in-memory store and no Brevo key, the email code is
shown on screen instead of emailed.
