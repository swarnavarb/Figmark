# Lock-screen notifications

Every notice that reaches the bell also goes to the person's phone or computer
as a standard Web Push notification, even with Figmark closed. No app store is
involved: the site is installable from the browser.

| Device | What the person does once |
|---|---|
| Android (Chrome, Edge, Samsung Internet, Firefox) | Bell → **Turn on** → Allow |
| Computer (Chrome, Edge, Firefox, Safari) | Bell → **Turn on** → Allow |
| iPhone / iPad (iOS 16.4+) | Safari → Share → **Add to Home Screen**, open Figmark from that icon, then Bell → **Turn on** → Allow. The bell explains this on an iPhone that has not done it. |

## Turning it on for a deployment

It is off until two keys are set; until then the site never offers it and the
bell works exactly as before.

1. Generate a key pair once (after `npm run install:all`):

   ```bash
   npm run push:keys
   ```

2. Add the three values as Static Web App application settings (Azure portal →
   the Static Web App → Settings → Environment variables, or):

   ```bash
   az staticwebapp appsettings set \
     --name stapp-figuremarket-dev \
     --resource-group rg-figuremarket-dev \
     --setting-names \
       WEB_PUSH_PUBLIC_KEY="<public key>" \
       WEB_PUSH_PRIVATE_KEY="<private key>" \
       WEB_PUSH_SUBJECT="mailto:<an address you read>"
   ```

   Keep the private key secret. Use the **same pair** for the life of the site:
   a new pair cuts off every device that already turned notifications on until
   each turns them on again.

3. Deploy, open the site, tap the bell → **Turn on** → **Send a test**.

## How it works

- `api/src/functions/notify.ts` is the only writer of notices, and it calls
  `api/src/push.ts` for each one, so every event is covered in one place.
- A notice held for the 3-minute undo window is sent when the window ends, and
  never if the step was undone. Sent by whichever comes first: a timer on this
  instance, the `push-clock` timer trigger where the host runs timers, or the
  next time any open copy of the site checks the bell (every minute).
- Devices are kept on the account (`User.pushEndpoints`), at most 10, and never
  sent to any client. A device the push service reports gone is dropped. Signing
  out removes the device; signing in as someone else on the same browser moves
  it to the new account.
- `app/public/sw.js` shows the notification, sets the icon badge to the unread
  count, and on tap marks it read and opens its page. It caches nothing.

Checked by `scripts/smoke-push.mjs` (part of `npm test`).

## Prompts and install-first on phones

- A phone in a browser tab is shown how to put Figmark on its home screen
  first; only the home-screen copy offers **Turn on**. iPhones need this
  (notifications only work from the home screen); on Android it is where they
  belong. Android browsers that support it get a one-tap **Install Figmark**.
  A computer turns notifications on where it is.
- About 10 seconds after signing in, a floating prompt offers real-time
  updates. Tapping **Turn on** opens a sheet with the steps for that exact
  device (iPhone Safari / Chrome, Android Chrome / Samsung / Firefox, a
  blocked permission, or a computer) and ends with notifications on. It shows
  after every sign-in, and otherwise at most every 4 hours, until Figmark is
  on the home screen and notifications are on. A phone browser whose owner
  already added Figmark to the home screen stops asking (the server says so
  in its answer to the device report).

## Installs & devices (admin)

Each signed-in copy of the site reports its device, browser, whether it was
opened from the home screen, and its notification state, once a day or when
one changes (`POST /api/me/device`, kept on the account as `clientDevices`).
The admin console's **Installs & devices** tab shows the totals by person:
e.g. "38% of iPhone users added Figmark to their home screen", plus browsers,
notifications on, and active in the last 7 days.

## What notices say, and how many there are

- **Who it is for.** A notice says whether it reached you or a store you run,
  by name: "Sana messaged you" / "Sana messaged Kaiju Imports". A name longer
  than 22 characters becomes "your store" (and a long sender name becomes
  their @handle). Order, payment, dispute and delivery notices name the buyer
  and the shop the same way, and each side of a dispute gets its own wording.
- **What is covered.** Everything that already notified, plus: direct
  messages (to the person, or to everyone who can post as the store; muted
  conversations stay quiet), reactions to messages, customers writing in a
  store's channel, store announcements to followers, likes and reactions on
  posts, comments and item comments, comment likes, shares, item saves,
  follows, order reviews (blind ones say "review yours to see both"), page
  reviews, and a shop's own pre-order filling or closing short.
- **Folding.** Repeats about the same thing fold into one unread row:
  "Sana sent Kaiju Imports 3 messages", "Sana and 4 others reacted to your
  post", one row per lot showing its latest step. The phone replaces the
  earlier line instead of stacking another. Once read, the next one is news
  again.
- **Reading.** Opening the page a notice points at reads it, however you got
  there (a conversation also reads its notices on the server).
- **The bell** pages 20 at a time ("Show older"), filters by Messages,
  Orders, Payments, Social, Reviews or Drops with unread counts, and "Mark
  read" follows the filter.
- **Phone settings** (profile → Notifications on this device): switch each
  category off the lock screen (it stays in the bell), and "Quiet at night"
  (22:00–07:00 in the person's own time zone, pushes arrive without sound).
  Stored on the account as `notificationPrefs`.
