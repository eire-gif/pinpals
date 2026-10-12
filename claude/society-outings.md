# Society outings: Events, Tee times and who has paid (Oct 2026, migration 0125)

Step 2 of `claude/society-entry-fees.md`, plus the draw. A society's captain or secretary sets up its days out; members join them; the officers publish the tee times and start the round on the day. Card payment is the next step.

## Decisions (Eire, 12 Oct 2026)
- The three tiles on a society's page:
  - **Events**: the society's upcoming days out, which members join.
  - **Tee times**: the tee times you've been given.
  - **Posts**: the society's posts on Social (groups step C, still to come).
- The captain or secretary sets an outing up with the **date on a scroll wheel**.
- Members **join or cancel until midnight the evening before** (00:00 Irish time at the start of the day). After that only the captain or secretary changes the list.
- Once the tee times are made, each member sees theirs.
- **Only the captain or secretary starts the round.**
- **Payment**: the app shows who has paid. Officers mark cash, transfer or waived now; card payment comes later.

## What a member does
- **Society page:** Events ("3 coming up") and Tee times ("1 yours" / "Draw to come") are live tiles; Posts still says Soon.
- **Events:** upcoming and past outings, each with:
  - the date, course, first tee and fee
  - how many are in (of how many places)
  - "Join or cancel until midnight on Mon 19 Oct"
  - **Join** / **You're in · Cancel** inline.
- **An outing:**
  - the details, and Join / Cancel my place
  - your tee time, big, with group number and partners
  - your payment: "Paid cash", or "Entry €60 — not paid yet"
  - who's in, laid out by tee group once the draw is out
  - on the day, once started, a button to the leaderboard and cards.
- **Tee times:** one card per published tee time: time, group, date, course, who you're with. On the day it opens your card.

## What the captain and secretary do
- **Events → New outing:** name, date (wheel), course, first tee (clock wheel), entry fee, places, details. Edit or cancel later.
- **On an outing:**
  - **Make the draw** opens From a group on this outing, with entrants, name, course and first tee filled in, and any published draw laid out again.
  - **Publish tee times** saves the draw. Members see theirs at once; publishing again replaces it. Anyone ticked who hadn't entered is entered. Guests can't go on published tee times.
  - On the day, **Draw and start the round**: choose the tees and Start the day. The final draw is published and the outing linked to the live day.
  - **Add members** (any time before the round) and **tap a name**: Paid cash / Paid by transfer / Waive the fee / Not paid / Take off the outing. "x of y paid or waived" is shown.

## Database (0125_society_outings.sql)
| Table | Holds | Who reads |
|---|---|---|
| `society_outings` | title, club, course, plays_on, first_tee, details, entry fee, places, status (open/cancelled), draw_published_at, match_day_id | society members |
| `society_outing_entries` | who's in; their tee_group, tee_time, tee_position | society members |
| `society_outing_payments` | cash / transfer / card / waived, marked_by | the member themselves, and officers |

- Each table has at most one foreign key to `profiles` (the 0123 lesson). `marked_by` has none on purpose.
- **Writes only through functions:**
  - `save_outing`: societies only; date from today to 2 years ahead.
  - `cancel_outing`
  - `set_outing_entry(outing, in, member?)`: self until midnight; officers for anyone in the society until the round starts. Places are enforced.
  - `publish_outing_draw`: entrants only, each once, 1–60 groups of 1–8.
  - `link_outing_match_day`: only a day the caller created.
  - `mark_outing_paid`: never 'card'; a card payment can't be changed by hand.
- `outing_entries_close_at(date)` = midnight Europe/Dublin; `outing_officer()` = owner/admin (in a society, owner, captain, secretary).
- App mirror of the timing rules: `mobile/src/lib/outing-rules.ts` (+ test, incl. clock changes).

## Map
- Data: `mobile/src/lib/outings.ts`.
- Screens:
  - `app/group/[id]/events.tsx`
  - `app/group/[id]/tee-times.tsx`
  - `app/group/[id]/outing/new.tsx` (also edit)
  - `app/group/[id]/outing/[outingId].tsx`
- Changed: `app/group/[id]/index.tsx` (tiles) and `app/(tabs)/live/day/group.tsx` (outing mode).

## Verified
- Full replay; RLS 721/721, 10 new in `society-outings.test.ts`. They cover: officers only; joining up to midnight; officers after; Irish midnight in summer and winter; capacity; cancelled outings; the draw rules; linking only your own day; payments seen only by self and officers; no direct writes.
- Website tsc and 1272 unit tests (6 new); app tsc.

## Next
1. **Notifications:** new outing to the society; "tee times are out" to entrants; a reminder the evening before entries close.
2. **Card payments** (entry-fees plan step 3): Stripe Connect for the society, pay in the app, webhook sets 'card'.
3. Guests on outings, a waiting list when full, and Posts (groups step C).
