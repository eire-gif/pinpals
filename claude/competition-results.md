# Competition results — Oct 2026

**Asked (Eire, 13 Oct 2026):** make it easy for the organiser of a big society
or group to put the winners together once the cards are in, with countbacks
and a clear 1st, 2nd and 3rd for the format played, transparent, and shareable
to members. "Build it to what exactly Golf Ireland would see as fair and
correct." Mock-ups approved: canvas *PinPals Competition Results* (8 boards).

## The rules (lib/competition-results.ts — website and app, byte-identical)

Ties follow the R&A's recommended **matching scorecards** method, Rules of
Golf Committee Procedures 5A(6)d, which Golf Ireland clubs use:

1. last 9 holes, last 6, last 3, the 18th
2. still level: the last 6, last 3 and last hole of the **first** nine
3. still level: the Committee's choice made before publishing — **random
   draw** (default; deterministic FNV hash of the day and entrant, so anyone
   working it out gets the same order) or **share the place** (=2nd)

- Holes by their **card number** (10–18 is the last 9) whatever tee a group
  started on — the R&A recommendation for multi-tee/shotgun starts.
- **Stableford**: points on those holes, shots by stroke index exactly as in
  the competition.
- **Net stroke play**: gross on those holes minus ½, ⅓, ⅙, 1⁄18 of the
  playing handicap, **unrounded** (kept as integers scaled by the hole count;
  shown as 32.33).
- **Best gross**: gross on those holes.
- **9-hole** competitions: last 6, last 3, last hole, fractions of nine.
- **Pickups**: stroke play → no return (NR), can't place (Rule 3.3c);
  Stableford → 0 points on the hole (Rule 21.1c).
- Cards not finished aren't ranked ("Out"); publishing closes them.

Prizes: 1st–3rd per division (divisions by playing handicap, even split,
cuts adjustable), best gross (optional; with *one prize per player* a placed
player doesn't also take it — it passes down), guests listed but not placed
unless *guests can win*, and organiser-entered prizes (nearest the pin,
longest drive). Teams/pairs (scramble, foursomes): one ranking, no divisions
or best gross. Match days keep their team score (no results page).

## Storage (migration 0137)

`competition_results` per `live_match_days` row: `settings` (draft, saved as
the organiser changes them), `status` draft/published, `results` (the
published JSON exactly as worked out — what members are told is what stays
shown), `version` (republish = update), `share_token` (public link; cleared
when taken down). Functions: `competition_results_save`, `_publish` (also
closes every live card in the day), `_withdraw`, and
`competition_card_status` (certified yes/no per member, for the checks).
Organiser = `live_match_days.created_by`. RLS tests:
`supabase/tests/rls/competition-results.test.ts`.

## Screens

- Day board: **Results** card (`components/results-entry.tsx`) — cards in and
  *Prepare results* for the organiser; winners and *See the results* once out.
- `/live/day/results/[id]`: provisional view for the organiser (settings,
  podium, full list, tap-a-tie countback table, checks, prizes you enter,
  publish / publish update / take down); published view for everyone (your
  result, divisions, prizes, rule, share).
- Website: `/results/<token>` public page + `opengraph-image` (the share
  card); `POST /api/app/live/match-days/[id]/results` notifies everyone
  (type `live_match_result`, deduped per version, opens the results).
- Guide: *Publish the results* (`guide.ts`, id `results`).

## Deviations from the mock-ups

- Setup's "count back from the front 9" option was dropped: the R&A method
  always starts with holes 10–18 and only then uses the front nine, which
  covers "off the front or back" without letting a society pick a non-standard
  order.
- The share image is the link-preview card (website) rather than an image file
  attached from the phone — attaching a file needs a native module and a new
  TestFlight build. WhatsApp shows the card from the link.
- Not posted to the society chat automatically (members are notified and the
  results sit on the day); can be added.

## Oct 2026, later: pair cards, amendments, past results (migration 0138)

Asked (Eire, 13 Oct): Face ID certification for foursomes; results kept on
the society's page for members to view again; the organiser able to change a
result, clearly marked "Amended" where it differs from what players submitted.

- **Pair and team cards.** `scorecard_from_live_round` saves the side's card
  for foursomes/scramble pairs and teams and for foursomes/greensomes matches:
  the side's ball (on its first player), the side's handicap, no index,
  `scorecards.team_card` set. Fixes the foursomes-match bug where the
  partner's card came out blank. Certifier is from the **other side**
  (Rule 3.3b): the other side in a match; another pair/team in the same tee
  group on a day (`scorecard_certify_candidates`). Never counted for the
  handicap indicator (`handicap_differentials_of`: `team_card is null`) —
  WHS accepts individual formats only. Results count a team as certified when
  either partner's copy is.
- **Amendments** (`ResultsSettings.amendments`, `applyAmendments` in the
  engine): correct a hole or disqualify, with a reason. The players' cards are
  never changed. Rows carry `amended` lines ("Hole 7: 5 → 6 — reason"),
  `Results.amendments` summarises them; shown as **Amended** on the results
  screen, podium, prizes, day card, group list, share page, link image and the
  notification.
- **Past results on the group page.** `competition_results.group_id`
  (`competition_results_set_group`, organiser must be in the group;
  `competition_results_group_suggestion`: the event's society, else the
  organiser's group with most of the day's players). Group members read
  published results (new RLS policy); the published JSON now carries `event`
  (title, course, date) so non-players can open them. Group page section:
  `components/group-past-results.tsx`.
- Tests: `supabase/tests/rls/team-cards-and-society-results.test.ts`, engine
  amendment tests. Guides: *Play a round together* (pair's card), *Publish the
  results* (amend, group page).
