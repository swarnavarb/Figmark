# Verification

Browsing is open to everyone. **Buying and selling** - listings, private deals,
power sales, offers on wants, pre-order pledges, checkout and payment - need all
three checks below, or an operator's grant.

| Check | How it is proved | Cost |
|---|---|---|
| Email | A 6-digit code is emailed at sign-up and typed back. | Free (Brevo: 300 emails/day) |
| WhatsApp number | The person taps **Verify on WhatsApp**; WhatsApp opens with a message holding a one-time code; they send it to Figmark's WhatsApp number. WhatsApp tells us which number sent it, so it must be the account's number. | Free (messages people send you cost nothing) |
| Aadhaar | The person scans their Aadhaar **Secure QR** (letter, e-Aadhaar PDF or mAadhaar). The API checks UIDAI's RSA signature offline, then hashes the WhatsApp-verified number the way UIDAI does and compares it with the mobile hash in the QR. | Free (offline, no licence) |

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

## Settings

Each piece switches on when its settings are present. Until then its step says
it is not set up yet, and an operator can grant rights instead.

| Setting | What |
|---|---|
| `AUTH_SESSION_SECRET` | Any long random string. Signs sessions. |
| `BREVO_API_KEY` | Brevo → SMTP & API → API keys. |
| `EMAIL_FROM` | A sender address verified in Brevo (Senders & IP). |
| `EMAIL_FROM_NAME` | Optional, default `Figmark`. |
| `WHATSAPP_BUSINESS_NUMBER` | The WhatsApp Business number people message, e.g. `+91 90000 00001`. |
| `WHATSAPP_VERIFY_TOKEN` | Any string; typed into Meta's webhook settings too. |
| `WHATSAPP_APP_SECRET` | Meta app → App settings → Basic → App secret. Checks each webhook's signature. |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Optional: lets Figmark reply "verified" in the chat. |
| `AADHAAR_QR_CERT` | UIDAI's offline-verification certificate (`uidai_offline_publickey_*.cer`), as PEM or base64. Download it from UIDAI's "Secure QR Code" reader page. |

### WhatsApp Cloud API setup (once)

1. developers.facebook.com → Create app → Business → add **WhatsApp**.
2. Add a phone number that is not already on WhatsApp, and verify it.
3. WhatsApp → Configuration → Webhook: callback
   `https://<your-site>/api/verify/whatsapp/webhook`, verify token = `WHATSAPP_VERIFY_TOKEN`.
   Subscribe to **messages**.
4. Complete Meta business verification to go beyond test numbers.

On a local run with the in-memory store and no Brevo key, the email code is
shown on screen instead of emailed.
