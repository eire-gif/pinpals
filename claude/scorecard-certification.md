# Scorecard certification

Oct 2026. **Status: 0128 applied to production (12 Oct 2026, comment-free, one part; RLS, grants and HMAC checked there); `scorecardCertification` flag on in this branch (PR #193), live once merged and published with `eas update`. The website parts (notify route, badge on the public card page) go live when Vercel deploys `main`. No native build: it uses expo-secure-store and expo-device, both already in the binary.**

A playing partner certifies your card, the way a marker signs a paper one. The card then shows:

> ✓ Certified by John Murphy · Face ID · 12 Oct, 17:42

## What a member does

**The owner**

- Finishes a live round. If they played and someone else in the round is a member, the app asks **"Get your card certified?"**. Choosing **Choose who** saves their card and opens it with the partner picker.
- Or opens any card of theirs. The certification panel sits above the hole-by-hole grid:
  - **Get this card certified** → **Choose who to ask**.
    - Live-round card: the members who played that round.
    - Card typed in by hand: their accepted PinPals.
    - Never across a block.
  - **Waiting for John**: **Ask someone else** replaces the request.
  - **John queried the 7th**: shows John's note. The 7th is highlighted on the grid. **Edit card** or **Ask again**.
  - **Declined / expired / changed since certified**: ask again.
  - **Certified**: the green badge, plus "Changing the scores removes the certificate."
- A card can be certified up to 14 days after the round. A live round must be finished first, because finishing locks its scores.

**The certifier**

- Gets a push: "Eire asks you to certify their card". Requests also appear under **Waiting for you to certify** at the top of My scorecards.
- The certify screen shows the card exactly as the owner sees it, minus putts, which aren't part of what's certified. It has three choices:
  - **Certify with Face ID / Touch ID / fingerprint.**
  - **Query a hole**: pick the hole, add an optional note (up to 200 characters).
  - **Don't certify.**
- A phone with no Face ID or fingerprint set up can still certify, after a warning. The badge then says **In the app**, not Face ID.
- Requests expire after 48 hours.

**Everyone else** who can see the card (0110's rules) sees the badge. They see it on the card, as **✓ Certified** on the scorecard list, and on the public `/c/<token>` page. The public page shows the certifier's first name only.

## How it works

### The key

1. The first time someone certifies, the phone calls `scorecard_certify_key_register('ios'|'android')`. The server generates 32 random bytes and returns them once.
2. The phone stores them with expo-secure-store `requireAuthentication`:
   - iOS: Keychain with biometryCurrentSet.
   - Android: a Keystore key that needs a BIOMETRIC_STRONG biometric.
3. The phone then calls `scorecard_certify_key_confirm(key_id)`.

Only confirmed keys can sign. Confirming a sixth key retires the member's oldest one. A set-up cancelled halfway retires nothing.

### Certifying

1. The phone reads the key back. This is the Face ID or fingerprint prompt.
2. It signs `pinpals-certify:v1:<request id>:<challenge>:<card hash>` with HMAC-SHA-256. The code is `mobile/src/lib/hmac-sha256.ts`, written in pure TypeScript because expo-crypto would need a store build.
3. `scorecard_certify()` recomputes the signature with pgcrypto's `hmac()`.

The app's signature and Postgres's were checked byte for byte against each other.

### Re-enrolment

- **Phone biometrics change:** adding a new face or fingerprint invalidates the key, and reading it returns null. The app sets up a new key silently.
- **Server stops recognising the key:** `hint = 'certify_key'` comes back. The app re-enrols and retries once.

### What it proves, and doesn't

**Proves:**

- A certificate needs the certifier's own signed-in account.
- It needs a key that account set up and confirmed.
- The signature covers this request's one-time challenge and the exact card.
- In this app, the key is only ever read through Face ID or a fingerprint.
- No biometric data leaves the phone.

**Doesn't prove:** the method label (Face ID, etc.) is what the app reports. A *modified* client using the certifier's own login could register a key and sign without biometrics. Since it's the certifier's own account vouching, this is a members' trust badge, not a handicap submission.

**To close it later (needs a store build):**

- A key pair generated inside the Secure Enclave or Keystore, sending only the public key (for example react-native-biometrics, or an Expo module).
- App Attest (iOS) and Play Integrity (Android) at enrolment.

### The card can't change under a certificate

The request stores a hash of the card. The hash is `jsonb`, so no field can run into the next, and the date is formatted explicitly. It covers:

- course, tees, holes, date
- course rating, slope, par
- handicap index, playing handicap
- per hole: par, stroke index, strokes

It does not cover putts, yards or visibility.

A trigger on `scorecards` and `scorecard_holes` voids any pending request or certificate the moment the hash changes. This applies to an edit and to "Update from the live round". Changing who can see the card doesn't void it.

## Database — 0128

| Table | Holds |
|---|---|
| `scorecard_certify_keys` | per-phone secret, platform, confirmed / last used / revoked. RLS on, no policies, no grants: functions only. |
| `scorecard_certifications` | card, owner, certifier (+ name as asked; "Former member" by trigger if their account goes), status, card hash, challenge, method, key, queried hole + note, requested / expires / answered. One open (pending, queried or certified) row per card. |

Statuses: `pending`, `certified`, `queried`, `declined`, `void` (card changed), `cancelled` (re-asked). "Expired" is a pending row past `expires_at`, worked out on read.

### Who reads what

- **Owner and certifier:** their rows.
- **Anyone who may see the card:** only its `certified` row.
- **`challenge` and `card_hash`:** never readable directly (column grants).
- **`scorecard_certification_open`:**
  - The owner gets their card in every state.
  - The certifier gets the card only while it is pending or certified, and never across a block. Being asked once isn't a lasting window onto an "Only me" card.
  - The certifier gets the challenge only while it is pending.

### Functions

All take `auth.uid()` and check it:

- `scorecard_certify_candidates`
- `scorecard_certify_request`
- `scorecard_certification_open`
- `my_certification_requests`
- `scorecard_certify_key_register` / `_confirm`
- `scorecard_certify`
- `scorecard_certification_query`
- `scorecard_certification_decline`

Internal only: `scorecard_card_hash`, `scorecard_certification_for_answer`, and the two trigger functions.

### Limits

- 30 requests a day per owner.
- 5 a day per card.
- 5 a day to the same certifier.
- 20 key set-ups a day per member.

### Tests

`supabase/tests/rls/scorecard-certification.test.ts` has 12 tests, and the function-grants register is updated. The full RLS suite passed 745/745 on a fresh replay. Loosening the read policy to `true` makes the tests fail, as it should.

The mobile tests are `mobile/src/lib/hmac-sha256.test.ts` (RFC 4231 vector, Node crypto cross-checks) and alert routes.

## Notifications

Sent by `src/lib/scorecard-certify-notifications.ts` through `POST /api/app/scorecards/certifications/[id]/notify`. The app calls this after each write. The caller must be the owner or the certifier, and only their own move triggers a send.

| Type | When | Goes to |
|---|---|---|
| `scorecard_certify_request` | the owner asks | the certifier; opens `/scorecards/certify/<id>` |
| `scorecard_certify_result` | the certifier certifies, queries or declines | the owner; opens `/scorecards/<card>` |

- Both types are under `tee_times` and are **app only**: Inbox and push, no email, because the website has no page for either end.
- Nothing is sent across a block, and no request push goes out for an expired request.
- The query note stays in the app and is never put on a lock screen.

## Map

| Piece | File |
|---|---|
| HMAC (pure, + test) | `mobile/src/lib/hmac-sha256.ts` |
| Phone key, biometrics, method label | `mobile/src/lib/certify-device.ts` |
| Reads / writes | `mobile/src/lib/scorecard-certifications.ts` |
| Owner panel + partner picker + badge | `mobile/src/components/certify-panel.tsx` |
| Certify screen | `mobile/src/app/scorecards/certify/[id].tsx` |
| Card grid (shared by both screens) | `mobile/src/components/scorecard-grid.tsx` |
| Entry points | card screen (`?certify=1` opens the picker), live round "Finish round", My scorecards "Waiting for you to certify", alerts (`alert-routes.ts`) |
| Public page badge | `src/lib/scorecard-share-server.ts`, `src/app/c/[token]/page.tsx` |

## Not done / next

- **Not run on a phone yet.** Check on an iPhone:
  1. First certify: Face ID prompt.
  2. Second certify: one prompt.
  3. After adding a new face: silent re-set-up.
  4. Cancel: nothing happens.
- **Android** isn't testable yet (no device). Expect two fingerprint prompts the very first time: one to store the key, then the certify uses it directly.
- **Non-members** can't certify. The SMS-link "Verified" tier discussed earlier needs an SMS provider and isn't built.
- **Other players** in the round aren't prompted when someone else presses Finish. They can certify from their own card.
- **Handicap indicator** could weight or count certified cards ("14 of 20 certified"). Not done.
- **Device attestation** for a stronger badge, as described above.
