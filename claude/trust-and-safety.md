# Trust & safety (Oct 2026, 0188)

Three things that make playing with, and buying from, strangers feel safe.
Decided 24 Oct 2026: the AI approves Verified golfer checks on its own (no
time for manual review); no-shows are proved by a live scorecard or marked by
the host; drop-outs inside 24 hours are late; everyone sees a simple badge.

## 1. Tee-time reliability

- **What counts.** Last 12 months. A round counts as *played* when you were
  confirmed on it (or hosted it with someone confirmed), it wasn't cancelled,
  it has started, and nobody marked you absent. Only the exceptions are
  stored, in `tee_time_attendance` (`no_show` / `late_cancel`).
- **Late cancellation.** Giving back a confirmed place under 24 hours before
  the tee time (Irish time; 8am when no time is set). A trigger on
  `tee_time_interests` records it, so every route that drops a place is
  covered. A host cancelling a round with players in it inside 24 hours gets
  one too. Rejoining the same round wipes it.
- **No-show.** The host marks it after the round, within 7 days
  (`mark_tee_time_no_show`). Refused if the golfer has a live scorecard from
  that day with the host or at that club (`played_live_that_day`). The golfer
  gets an alert and can dispute (`dispute_tee_time_attendance`); a disputed
  no-show stops counting until staff uphold it at `/admin/trust`.
- **Badge** (`member_reliability(uuid[])`, words in `lib/reliability.ts`):
  under 3 on record → *New to tee times*; 90%+ *Reliable · 18 of 18 rounds*;
  75%+ *Usually turns up*; else *Has missed rounds*.
- **Good record only.** `tee_time_invites.reliable_only`: a golfer whose
  record is *patchy* can't ask or take a place (`enforce_reliable_only`). New
  members still can; a host's own invitations are never blocked.
- **Where it shows.** Requests in My rounds (app + website), sorted best
  record first; member pages; the host on a round's page (app); own Profile.
  Played rounds in My rounds have *Who turned up?* (host) and *I was there*
  (golfer). Cancelling inside 24 hours warns first.

## 2. Verified golfer

- Member enters their Golf Ireland number and club and photographs their card
  (or the Golf Ireland app's card screen): app `/verify`, website
  `/profile/verify`, both into `submitVerification()`
  (`src/lib/verification/server.ts`).
- The photo is shrunk and stripped by sharp, sent to Claude
  (`VERIFY_MODEL`, default `claude-sonnet-5`, via `src/lib/news/claude.ts`,
  needs `ANTHROPIC_API_KEY`) which only *reads* the card.
  `decide()` (`src/lib/verification/decide.ts`, tested) compares it with the
  profile in code: approve only when the name (surname + first name or
  initial), club and number all match, confidence ≥ 0.8, and it doesn't look
  edited. Clearly not a card, or unreadable → rejected with a reason. Anything
  else → `needs_review`.
- Approved → `member_verifications.status = 'verified'` + a row in
  `verified_members` (public to signed-in members; the badge).
- `needs_review` keeps the photo in the private `verification-cards` bucket
  until staff decide at `/admin/trust`; it's deleted then. Nothing is stored
  otherwise. 5 tries a day. If the API is down, it goes to review.
- Badge shows on member pages, Profile, tee-time requests, the round page
  (host) and marketplace seller cards (app + website).

## 3. Marketplace scam protection

- `messages.safety_flags` is set on insert in a marketplace conversation
  (`conversations.listing_id`) by `message_safety_flags()`: `link` (not
  pinpals.ie), `pay_first` (deposits, pay first), `courier` (couriers, delivery
  fees, payment links), `odd_payment` (gift cards, crypto, PayPal F&F, Western
  Union), `off_app` (WhatsApp, Telegram, email addresses). Nothing is blocked.
- The other person sees one yellow warning under the message (most serious
  first; wording in `lib/message-safety.ts`).
- Marketplace chats open with *Buying and selling safely* tips and **Suggest
  meeting at the club**, which drops a message naming your home club into the
  box. Closed after the first few messages; one tap to reopen.
- Corrected the card-number refusal and the listing's safety tips, which still
  said to pay through PinPals checkout.

## Files

- Migration `supabase/migrations/0188_trust_and_safety.sql`; RLS tests
  `supabase/tests/rls/trust-and-safety.test.ts`.
- Shared (identical copies): `src/lib/reliability.ts` /
  `mobile/src/lib/reliability.ts`, `src/lib/message-safety.ts` /
  `mobile/src/lib/message-safety.ts`.
- Website: `src/lib/trust-server.ts`, `src/components/trust-badges.tsx`,
  `src/app/profile/verify/*`, `src/app/admin/trust/*`,
  `src/app/api/app/verification/route.ts`, My rounds board and actions,
  conversation thread, seller card.
- App: `mobile/src/lib/trust.ts`, `mobile/src/components/trust-badges.tsx`,
  `mobile/src/app/verify.tsx`, My rounds, member page, Profile, invite page,
  conversation, listing, post a tee time.

## To ship

1. Apply `0188_trust_and_safety.sql` (additive).
2. Merge; Vercel deploys the website. `ANTHROPIC_API_KEY` must be set (it is
   already used by the news pipeline).
3. App: GitHub → Actions → Publish app update (no native change).

## Not done

- No push notification for a no-show or a verification decision — they're
  in-app alerts.
- A badge can be taken away (`revokeBadge` in `src/app/admin/trust/actions.ts`)
  but there's no button for it on the admin member page yet.
- The website's tee-time list doesn't show *Good record only* on cards yet
  (the app's round page does, and the rule is enforced either way).
