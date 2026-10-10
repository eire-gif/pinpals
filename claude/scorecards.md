# Scorecards

Oct 2026. **Status: 0110 applied to production (9 Oct 2026); `scorecards` flag on in this branch, live once merged and published with `eas update --branch production --platform ios`. The website parts (share API, public page) go live when Vercel deploys `main`. No native build.**

A member keeps their own card for every round, and shares it.

## What a member does

- **From a live round:** on the round screen, **Save my scorecard** (or
  "…so far" while it's live) copies *their own line* — their scores, the
  round's card, their index and playing handicap — into a scorecard and
  opens it. Saving again later refreshes the same card; it never duplicates.
- **By hand:** ☰ → Play → **My scorecards** → **New scorecard**. Search the
  course and pick the tees: par, stroke index and yards fill in from the
  course's saved card (golfapi-imported cards are verified). No card on file,
  or a course not in the directory → choose 9 or 18 and set each par. Then
  the date (last 30 days), an optional handicap index ("plays off" is worked
  out at 95%, WHS individual stroke play), and scores: tap a hole to start it
  at par, − / + to change. Putts optional.
- **The card:** laid out like the paper one — Out/In, yards, par, SI, scores
  ringed for birdies and boxed for bogeys, shot dots — with score, to par,
  Stableford points, net and putts, and the birdie/par/bogey counts.
- **Share to Social:** opens the composer as a round post filled from the
  card (score, holes, par, tees, date, both nines, birdies, putts, course).
  The member adds a caption and photo and posts as usual.
- **Send (WhatsApp, Messages…):** the system share sheet with the card as
  text (headline, Out/In, hole-by-hole scores, birdies) and a link to a
  public page with the full card and a preview image — the same pattern as
  inviting friends.
- **Who can see it:** Only me / My PinPals (default) / All members, changed
  any time. Profiles: the Rounds tab has a "Scorecards" link; other members
  see only what that setting allows.

- **Tee colours:** tee choices (here and in the live round set-up) are
  chips in the tee's own colour — Yellow, Red, Blue, Green, White, Black,
  Gold and so on, from the first colour word in the tee's name
  (`mobile/src/lib/tee-colours.ts`, + test). A tee with no colour in its
  name ("Championship") is navy. The card shows a dot in the tee colour.
- **Home:** the card has a Home button (header) and "Done — back to Home".
  A card is saved before it's shown, and a newly made one opens with
  "Saved to My scorecards". In the editor, Home saves first if the card can
  be saved, goes straight home if nothing was entered, and otherwise asks
  before leaving.

- **Links open the app (9 Oct 2026):** `/c/<token>` is claimed in the
  apple-app-site-association, so a shared card opens PinPals for a member
  who has it (`app/card-link.tsx`: their scorecard screen when signed in —
  falling back to the public card if it isn't shared with them — or the
  public card with "Log in" when signed out). Before this it opened Safari.
  Same fix for "Invite friends" (`/signup`).
- **On Social (0111):** "Post to Social" now carries the card hole by hole
  (`details.hole_pars` / `hole_scores`), and the feed draws round posts as a
  scorecard (`components/round-card.tsx`): navy header with course, tee
  colour, date and score; front and back nine with birdies ringed and
  bogeys boxed; then the stats. If the member changes the score after
  sharing, the post goes without the hole-by-hole rather than being refused.
  Rounds typed in by hand show the header and stats.

- **My scorecards, dressed up (10 Oct 2026):** a photograph band like the
  tee-time screens; the best 18 in a navy card (score, to par, course, date)
  with average and rounds beside it; six tiles — eagles, birdies, pars,
  par-or-better %, putts a round, best Stableford points
  (`lib/scorecard-stats.ts`, + test); and richer rows (tee colour, points,
  birdies, "In progress" / "Thru 7" for unfinished cards). **Longest drive
  isn't recorded on a scorecard**, so it isn't shown — it would need a
  drive field per card (a small migration) or the shot marks from live
  scoring.

## How it's built

| Piece | File |
|---|---|
| Totals, points, share text, post fields (pure) | `mobile/src/lib/scorecard-math.ts` (+ test, 9) — byte-identical in `src/lib/` (drift test) |
| Reads/writes | `mobile/src/lib/scorecards.ts` |
| Screens | `mobile/src/app/scorecards/` — `index` (list), `new` (create/edit), `[id]` (card) |
| Entry points | menu (`scorecards` flag), live round screen, member page Rounds tab, composer `?scorecard=<id>` |
| Database | `supabase/migrations/0110_scorecards.sql` (+ RLS test, 5) |
| Share link | `src/lib/scorecard-links.ts` (+ test), `src/app/api/app/scorecards/[id]/share`, `src/app/c/[token]/` (page + preview image) |

## Database — 0110

| Table | Holds |
|---|---|
| `scorecards` | course, tees, date, holes, par, rating/slope, index, playing handicap, source (`live`/`manual`), live round link, visibility |
| `scorecard_holes` | par, SI, yards, strokes (NULL = not entered / NR), putts |
| `course_card_holes.yards` | new: printed length per hole, from the importer |

- A copy, never a link to the course or round: correcting a course later
  doesn't rewrite a finished card. Totals are never stored.
- Read: `scorecard_visible_row(member, visibility)` — owner; PinPals or all
  members by setting; never across a block; nothing once the owner's account
  is being deleted. It takes the row's own values (no self-query; see 0052).
- Write: `scorecard_save(id|null, card, holes)` (yours only; holes count
  fixed after creation; date ≤ tomorrow) and `scorecard_from_live_round(round)`
  (your own line only; idempotent per round). Delete: owner, by RLS policy;
  holes cascade. No insert/update grants.
- Tested: visibility matrix (confirmed failing when loosened), write paths,
  delete, from-live-round copies only the caller's line and refreshes.

## Sharing links

`/c/<token>`: a signed `{c: scorecardId, s: sharerId}` — same HMAC scheme
as post links, domain-separated so a post token can't pass as a scorecard
token (tested both ways). Public on purpose (the recipient may not be a
member); shows the card only while it exists, the sharer owns it and their
account isn't being deleted. Not indexed. Revoke = delete the card.

## Not verified

- Not run on a phone yet.
- The website page and preview image are typechecked and linted, not
  rendered — check one link in WhatsApp after Vercel deploys.
