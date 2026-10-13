# Guests on events (Oct 2026, migration 0131)

## Why
Published tee times were saved on each entry, and an entry is a PinPals member. A guest had nowhere to keep a tee time, so the draw screen said "Guests can't go on published tee times — add them on the day" and greyed out Publish.

## What changes
- **The captain or secretary (a crew or trip's organiser) adds guests to an event:** on the event, **Add a guest** → name and optional handicap index → **Add guest**. Tap a guest to change their name or index, mark them paid (cash, transfer, waived) or take them off.
- **Guests take a place** — places count members and guests.
- **The draw:** an event's guests come into the draw screen already entered. Guests typed in on the draw screen are put on the event when the tee times are published (or when a round is saved for a later date). Publishing works with guests in it.
- **Members see** guests in Who's in and in the tee groups, marked Guest, and "with Pat Murphy (guest)" on their own tee time.
- **Only the officers** see whether a guest has paid.
- **On the day** guests carry into the round as now; their group scores for them.

## Not in this step
A trip's rooms, flights and itinerary rounds stay members-only (0126). Guests on a trip show in Who's in and can be added to a round on the day.

## Database (0131_outing_guests.sql)
| Table | Holds | Who reads |
|---|---|---|
| `society_outing_guests` | name, handicap index, published tee group/time/position | whoever can see the event |
| `society_outing_guest_payments` | cash / transfer / waived | the officers |

Functions: `add_outing_guest`, `update_outing_guest`, `remove_outing_guest`, `mark_outing_guest_paid`; `set_outing_entry` and `publish_outing_draw` replaced (places count guests; the draw takes `{"guest": id}` beside member ids — old apps sending only ids still work).

## App
- `mobile/src/lib/outings.ts` — guests on `loadOuting`, counts in `listOutings`, guest partners in `loadMyTeeTimes`, the four guest calls. A database without 0131 simply has no guests.
- `mobile/src/app/(tabs)/live/day/group.tsx` — guests loaded from the event, put on it when publishing or saving ahead.
- `mobile/src/app/group/[id]/outing/[outingId].tsx` — Add a guest, guests in Who's in and tee groups, guest payments.
- Guides: Create an event gained an "Add guests" step (`mobile/src/lib/guide.ts`).
