# Paying for outings, and sharing them (Oct 2026, migration 0127)

Builds on `claude/society-outings.md` (0125) and `claude/outing-itineraries.md` (0126).

## Decisions (Eire, 12 Oct 2026)
- The organiser (captain or secretary) can put **how to pay** on each outing or trip: a **Revolut username**, **bank details** (IBAN and the name on the account), **cash is fine** (on by default) and a short **payment note**. A new outing starts with the society's last details, so they're entered once.
- Members see a **Pay** card on the outing page with:
  - **Pay with Revolut**, which opens `revolut.me/<username>`: the Revolut app, or the web page where non-Revolut people can pay by card
  - the bank details and a reference ("Kerry November – Geoff Walsh"), press and hold to copy
  - cash
- **"I've paid"**: the member says how they paid. The organiser sees **Says paid** next to the name and taps **Confirm** (which marks it paid by transfer or cash, as 0125 does) or **Not received**. Until confirmed, other members don't see it.
- PinPals never moves the money. Card payment through the app is still the separate Stripe plan (`claude/society-entry-fees.md`, step 3).
- **Share**: a share button on the outing page and the itinerary opens the phone's share sheet: WhatsApp, Facebook, Messages, Instagram (where it accepts text), etc. The text is what a society would post publicly: name, dates, place, courses, society name and a pinpals.ie link. It never includes who's going, the cost, payment details or tee times.

## Database (0127_outing_payment_details.sql)
- `society_outings`: `+ pay_revtag`, `+ pay_iban`, `+ pay_account_name`, `+ pay_cash` (default true), `+ pay_note`.
  - They're readable by the society's members, the same as the rest of the outing (0125).
  - `save_outing` (replaced, same signature) tidies them ("@Geoff.Walsh" → "geoff.walsh"; spaces removed from the IBAN) and checks their shape. An IBAN needs an account name.
- `society_outing_payment_claims` (outing, member, method revolut/transfer/cash):
  - **Reads:** the member, and the officers.
  - **Writes:** only `claim_outing_paid(outing, method | null, member?)`.
    - A member claims for themselves only when entered, the outing has a fee and they're not already marked paid. `null` withdraws the claim.
    - Officers can clear anyone's claim ("not received") but can't make one.
- `outing_entry_left` (replaced): leaving an outing also clears your claim.

## App
- Rules (pure, tested in `outing-payments.test.ts`):
  - `mobile/src/lib/outing-payments.ts`: revtag tidy, Revolut link, IBAN mod-97 check and formatting, reference
  - `mobile/src/lib/outing-share.ts`: the share text
- `components/outing-pay-card.tsx`: the member's Pay card.
- `outing/new.tsx`: the "How members pay" section; the form won't save a mistyped IBAN.
- `outing/[outingId].tsx`:
  - the Pay card
  - **Says paid** badges, and Confirm / Not received in the officer's menu
  - "x say they've paid" count
  - the Share button
- `itinerary/[outingId].tsx`: Share button.
- No new native modules (core `Share` and `Linking`), so this ships over the air.

## Order to ship
**Apply 0127 before publishing the app update.** The app now reads the new columns, so an app without the migration can't load Events.

## Verified (12 Oct 2026)
- Replay is clean.
- RLS: 733/733. The 5 new tests in `outing-payment-details.test.ts` cover:
  - tidy and check
  - members read, outsiders don't
  - claims: own only, entered, fee, not already paid
  - officers clear but don't claim
  - leaving clears the claim
  - no direct writes
- Unit tests: 1288 (6 new).
- App and site `tsc` are clean.

## Next
- A shareable **image card** for Instagram Stories and posts. Instagram won't take text alone. It needs `react-native-view-shot` (a native module), so it ships with the next store build, not over the air.
- A notification to the organiser when someone says they've paid.
