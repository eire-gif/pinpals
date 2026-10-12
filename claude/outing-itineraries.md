# Trip itineraries: overnight and abroad outings (Oct 2026, migration 0126)

Builds on `claude/society-outings.md` (0125). A society's captain or secretary can now set up a trip, not just a day out, and build its itinerary day by day: rounds with groups and tee times, flights, where everyone is staying, transfers, dinners and notes. Mockups: the "PinPals Trip Itinerary" design canvas (12 Oct 2026).

## Decisions (Eire, 12 Oct 2026)
- **New event** asks first: **Day out**, **Overnight in Ireland** or **Abroad**.
  - Day out is exactly the 0125 outing: one course, one date, one draw.
  - Overnight and abroad open the full itinerary: location, days and dates, rounds and tee times, accommodation, travel and notes.
  - Flights appear only for abroad; overnight gets transfers ("Travel": car-share, coach).
- The itinerary sits in the society's **Events** tab, and **Profile › My trips** links to it.
- **Booking references are not stored.** They stay with each member.

## What a member does
- **Events:** a trip shows as the large navy card with a badge ("ABROAD · 4 DAYS"), its dates and place, who's going, the cost and a countdown. It has **Itinerary** and **Join / Going · Cancel** buttons. Joining closes at midnight before the first day, as for any outing.
- **The trip's page** (the 0125 outing page): dates, place, countdown and cost, plus a card that opens the itinerary. Payments work as for any outing: cash, transfer or waived, marked by the officers.
- **Itinerary:**
  - a summary: rounds, going, nights
  - **Your trip:** your flights out and home, your room and who you're sharing with, and your tee time each day
  - a tab for each day of the trip, with that day's items in time order (untimed items last). Rounds show each group's tee time, and your group is outlined.
  - tap anything to see who's on it: the groups with times, the rooms, who's on each flight
  - the trip notes (the outing's details)
- **Profile:** the next three trips under **My trips**, each with a countdown, and a **My trips** row in Golf that opens the full list (Upcoming / Past).

## What the captain and secretary do
- **New event → Overnight / Abroad:** name, first and last day (two date wheels; the last day moves with the first), location, cost per person, places, trip notes. **Build the itinerary** creates the trip and opens its itinerary.
- **On a day: Add to Thursday** offers Round, Flight (abroad only), Hotel, Transfer, Dinner and Note.
  - **Round:** course from the directory, first tee (clock wheel), format, minutes between groups (8/9/10/12), then groups. Use **Random draw** (fours, as even as possible, larger groups first) or set each person's group with the number buttons. The tee times shown are worked out as first tee + (group − 1) × gap.
  - **Flight:** from, to, departs, lands (local time), airline and flight number, and who's on it. Everyone starts ticked; untick anyone on a different flight and give them their own.
  - **Hotel:** name, check-in day, nights (checks it doesn't run past the trip), and rooms, set at random in twos or picked by hand.
  - **Transfer:** from, to, time, company, who's on it.
  - **Dinner / Note:** a time and a few words.
- Tap any item to change or remove it. The trip itself is edited from its page (Edit).

## Database (0126_outing_itineraries.sql)
| Change | What |
|---|---|
| `society_outings` | `+ kind` (day/overnight/abroad, default day), `+ ends_on`, `+ location`. `course_name` is now nullable. Check: a day out has a course and no last day; a trip has a last day 1–20 days after the first |
| `society_outing_items` | on_date, kind (round/flight/stay/transfer/meal/note), starts_at, ends_at, title, details, club_id, from_place, to_place, carrier, nights, tee_interval, play_format |
| `society_outing_item_people` | item, member (the only foreign key to profiles), slot (tee group or room), position |

- **Reads:** the itinerary and who is on what are visible to whoever can see the outing (the society's members), using the same policy shape as 0125's entries.
- **Writes only through functions:**
  - `save_outing` (replaced, same signature): accepts kind, ends_on and location; a call without kind is still a day out. It refuses to turn a trip with an itinerary into a day out, or to move its dates so items fall outside them.
  - `save_outing_item`: officers only, trips only, on the trip's days. Each kind keeps only its own fields. A flight needs from and to; a stay can't run past the trip; tee gap is 5–20 minutes; 200 items at most.
  - `delete_outing_item`
  - `set_outing_item_people`: replaces the list. Only people entered in the trip, each once. Rounds and stays need a slot from 1 to 60, with at most 8 per slot. Meals and notes take nobody.
- **Trigger** `outing_entry_left`: cancelling your place takes you off every flight, room and group on the trip.
- A trip's outing-level draw and "start the round" are hidden in the app. Draws live on each round.

## Map
- Rules (pure, tested): `mobile/src/lib/itinerary-rules.ts`
- Data: `mobile/src/lib/itinerary.ts`; `mobile/src/lib/outings.ts` (kind, endsOn, location; a trip stays "upcoming" until its last day)
- Screens:
  - `app/group/[id]/itinerary/[outingId].tsx`: the itinerary
  - `app/group/[id]/itinerary/item.tsx`: add, edit or view an item
  - `app/my-trips.tsx`
- Changed:
  - `app/group/[id]/outing/new.tsx`: kind picker and trip fields
  - `app/group/[id]/outing/[outingId].tsx`: trip hero and itinerary card
  - `app/group/[id]/events.tsx`: trip card, "New event"
  - `app/(tabs)/profile.tsx`: My trips

## Verified (12 Oct 2026)
- Full migration replay is clean.
- RLS: 728/728, including 7 new tests in `outing-itineraries.test.ts` covering:
  - the rules for each kind
  - officers only; members see, outsiders don't
  - only people on the trip; 8 per group or room; meals take nobody
  - leaving clears your places
  - a trip can't be reshaped under its itinerary
  - no direct writes
- Grants snapshot updated.
- Unit tests: 1282, including 10 new in `itinerary-rules.test.ts`. App `tsc` is clean against regenerated typed routes. Website `tsc` shows only the known `LayoutProps` error.
- Not yet run on a device.

## Next
1. **Live scoring from a trip round:** "Start the round" on a round item, opening the 0121 day with that round's groups (the outing-level `link_outing_match_day` would become per item).
2. **Notifications:** "the itinerary changed", "your tee time tomorrow".
3. **Add the whole trip to my calendar:** extend the site's .ics route to trips.
4. Itineraries for **crew and trip groups**, not just societies (`save_outing` currently refuses other kinds of group).
5. A per-member "I'm on a different flight" that members can enter themselves.
