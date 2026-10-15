# Society admin on the website (/society) — 15 Oct 2026

A console for the people who run a society, on a big screen, with their
ordinary PinPals login. Separate from the superadmin console (/admin).

## Who sees what
| Office | Areas (0144 `society_can`) | Console pages |
|---|---|---|
| Owner, captain, secretary | everything | all, incl. Committee and Settings |
| Vice-captain, event organiser | events, messages | Events, Noticeboard, Messages, Results, Merit, Exports* |
| Treasurer | money, messages | Payments, Annual membership, Noticeboard, Messages, Results, Merit, Exports* |
| Handicap secretary | handicaps | Handicaps, Results, Merit, Exports* |

\* each export only where the app allows it. Ordinary members get a 404, so the console never confirms a private society exists.

## How it's safe
- No new privileges and no migration. Every read and write uses the member's
  OWN cookie client and the same tables/functions as the app; the database
  (RLS + `society_can`) stays the judge.
- `requireConsole()` (pages) and `consoleAction()` (every Server Action, every
  call) check sign-in + committee + area. Ids from forms are checked to belong
  to the society before the RPC is called.
- The service role is used only where the app's own routes already use it:
  export storage/signing/log (shared `src/lib/society-export-store.ts`, used by
  the app route too), the alert outbox flush, and group notifications after an
  approve/invite (recipients from database rows, never the form).
- `/society/**` is `private, no-store`; database messages reach the page only
  when they're the functions' own (P0001 / 42501).
- Independent security review: no high/medium findings; the lows were fixed
  (error text, fail-closed areas, export rate limit, outingId in the export log,
  `/groups/[id]` dynamic).

## Pages
Overview (needs attention) · Events & entries (new/edit, requests, waiting list,
24-hour offers, entrants, guests, payments, refunds, withdrawals, meals, cancel)
· Draw editor (random/balanced, honours requests, spreads repeat pairings, swaps,
tee times, publish) · Trip itineraries · Results (+ detail, share link) · Order of
merit (standings + rules) · Members & requests (approve, invite, link, phones,
remove) · Committee (appoint/stand down, hand over) · Handicaps (+ course
handicap calculator) · Payments (season figures, confirm claims) · Annual
membership (settings, mark, remind) · Noticeboard · Send a message (live count)
· Exports (CSV, 10-minute link) · Settings (name, about, club, cover, logo, own
alerts, delete).

## Code
`src/app/society/**`, `src/lib/society-console/**` (access, server-action,
rules + tests, data, pure copies of the app's outing/draw/merit rules + tests),
`src/components/society-console/{ui,forms}.tsx`. Entry points: header menu
"Society admin", `/groups/<id>` for committee members, a new step in the app's
"Run your society" guide.

## Stays in the app
Starting the round and live scoring on the day; compiling results from the
cards and Face ID certification; the native share sheet.

## Not yet
Card payments for societies (Stripe Connect per society, with PinPals' small
fee) — members still pay the society by Revolut, transfer or cash; the
console tracks and confirms it.
