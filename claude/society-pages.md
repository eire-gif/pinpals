# Society pages: entries, waiting list, alerts, committee, membership (14 Oct 2026)

Migrations 0142–0145, website alert sender and exports, app screens. Mockups: the "Society pages — new features" design canvas.

## Decisions (Eire, 14 Oct 2026)
- Each event chooses **Join straight away** or **Request a place** (officers approve).
- **Waiting list** when full; a freed place is **offered for 24 hours** to the next in line, then moves on.
- **Annual membership** is optional per society. **No surcharges**: unpaid members either can still enter, or can't until they pay.
- Members can **bring guests** (guest fee optional; blank = entry fee).

## What's in it
| Area | Database | App |
|---|---|---|
| Requests, waiting list, offers, choices (meal, play with, early/late, note), member guests, withdrawals, refunded | 0142 `society_outing_queue`, `_choices`, `_withdrawals`; `request_outing_place`, `review_outing_request`, `answer_outing_offer`, `promote_outing_waiting`, `mark_outing_refunded`, `my_outing_queue`; pg_cron `pinpals-outing-offers` | event page, `outing/request.tsx`, events list chips, event form |
| Event details: arrive by, format, dress, meals, guest fee, entry deadline | 0142 columns on `society_outings`; `save_outing` keeps fields an older app doesn't send | event page facts + Directions |
| Alerts | 0142 outbox `society_alerts` + triggers; 0143 reminders sweep (`pinpals-society-reminders`) and sender job (`pinpals-society-alerts`) | `flushSocietyAlerts()` after changes; per-society switches on the Noticeboard |
| Noticeboard, targeted messages | 0143 `society_notices`, `society_messages`, `send_society_message` | `noticeboard.tsx`, `message.tsx` |
| Committee roles | 0144 offices vice_captain, treasurer, handicap_secretary, event_organiser; `society_can(group,user,area)` | society page "Run the society", `committee.tsx` |
| Annual membership, what you owe, treasurer | 0144 `society_membership_settings`, `society_memberships`, claims; `my_society_dues`, `society_money` | `membership.tsx`, `membership-settings.tsx`, `money.tsx` |
| Exports (CSV) | 0144 `society_exports` log + private bucket `society-exports` | `exports.tsx` → `POST /api/app/societies/[id]/export` (10-minute link) |
| Order of merit | 0145 `society_merit_settings` | `merit.tsx`, pure `lib/order-of-merit.ts` |
| Draw honours requests, avoids repeat pairings | — | `honourWishes()` in `lib/group-draw.ts` |
| No signal | — | scores queued on the phone (`lib/score-queue.ts`); event page kept on the phone |

## Areas (0144)
captain/secretary: everything · vice-captain: events, messages · treasurer: money, messages · handicap secretary: handicaps · event organiser: events, messages. Payment details on events and who owes money stay with the money area.

## Alert sender
`/api/societies/alerts/run` (pg_cron every 3 min) and `/api/app/societies/alerts` (app, right after a change). Bearer: vault `society_alerts_cron_secret` if set, else `account_deletion_cron_secret` (same as ACCOUNT_DELETION_CRON_SECRET) — no new set-up needed.

## Verified
RLS 855/855 (new: society-entries, society-committee), unit 1450, app and site tsc clean. Independent security review: 2 high + 5 medium findings fixed (members always go through requests; locks on places; money stays with the treasurer; refund-then-rejoin owes again; reminders only to members).

## Not in this round
- Card payments for societies (Stripe Connect per society) — the existing plan, step 3.
- Event details kept offline use SecureStore (small); a fuller offline mode needs a storage module and a store build.
