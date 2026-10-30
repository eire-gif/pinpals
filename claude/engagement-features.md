# Engagement features: side games, course leaderboards, Course Passport, Wrapped, Claim your card (30 Oct 2026)

**Asked (Eire, 30 Oct 2026):** after research into the leading golf and
fitness apps (18Birdies, Golf GameBook, Garmin Golf, Arccos, Strava, the
side-game apps), build the five approved ideas — mock-ups on the canvas
*PinPals Engagement Features*. Follow-ups the same morning: the stake is an
amount the group types in; the passport is a world map with stars, on Apple
Maps, satellite.

**Status:** branch `engagement-features` (PR #360). Migrations **0196, 0197,
0198 applied to production 30 Oct 2026** (each `{"success":true}`; checked
after: RLS on the four new tables, signed-in users read-only on them, no anon
access, function grants as registered, the three realtime triggers, and the
claim now saves the card; the security advisor shows nothing new beyond the
usual "signed-in users can call this function"). App changes ship with `eas update` — no
native module is added (`react-native-webview` and `expo-image-manipulator`
are already in the binary). The Wrapped picture and the claim page need
Vercel to deploy `main`.

## To ship

1. ~~Apply 0196, 0197, 0198 to production~~ done 30 Oct 2026.
2. Merge the PR; let Vercel deploy (the app calls `/api/app/wrapped/share`,
   and the picture is `/w/<token>/photo`).
3. Codespace: `git pull origin main`, `cd mobile`, `eas update`.
4. Kill switches if anything misbehaves: `sideGames`, `courseBoards`,
   `coursePassport`, `wrapped` in `mobile/src/lib/features.ts`.

## 1. Side games (0196)

Alongside a live round's main score: **Best Front 9, Best Back 9, Best
Overall** and **Sixes** (holes 1–6, 7–12, 13–18) individually or in **pairs**
that rotate so with four players you partner everyone once (A+B v C+D, A+C v
B+D, A+D v B+C). Everything scores on Stableford points off each player's own
playing handicap. Played for **bragging rights, points or money** — the
group types the amount (quick picks €2/€5/€10/€20, or a different amount per
game), up to €500 a game, with "most you can lose / win" shown.

- **Money:** each member playing taps **I'm in** on their own phone; until
  everyone has, it's for bragging rights. Changing the games or amount
  clears the agreements. Refused if any member under 18 is in the round, and
  never offered to a minor.
- **Payouts:** an individual game's winner collects the stake from each
  player who didn't win; tied winners share (odd cents to the first winners,
  so books balance); everyone level moves nothing. A pairs match: each loser
  pays the stake to a winner; halved moves nothing. Matches end early once
  decided (Won 4&2).
- **Settle up:** fewest payments (biggest debt to biggest credit), each
  ticked **Mark as paid** by either player or whoever started the round;
  **Send a reminder** opens the share sheet. PinPals never holds money.
- **Where:** the scoring screen's green **Add side games / Side games** row
  (and after finishing, above Your fourball) → `live/side/[id]`.
- **Rules:** 18 holes, everyone plays their own ball (not scramble,
  foursomes, greensomes or match-day matches), 2+ players; pairs needs 4.

Files: `mobile/src/lib/side-games.ts` (+21 tests), `side-games-data.ts`,
`app/(tabs)/live/side/[id].tsx`, `components/side-games-row.tsx`.
DB: `live_round_side_games`, `live_round_side_game_agreements`,
`live_round_side_game_payments`; `live_round_set_side_games`,
`live_round_side_games_agree`, `live_round_side_game_paid`. Changes ping the
round's realtime channel. RLS tests: `side-games.test.ts` (11).

## 2. Course leaderboards (0197)

On every course page, **This week's leaderboard** (navy row) → each
member's best round there this week (Mon–Sun, Europe/Dublin) by Stableford,
net or gross; the **Course Legend** (most days played there in 90 days); and
**Hole champions** (best net per hole this month; ties to whoever did it
first).

- Built from members' scorecards: 18-hole cards at the course with every
  stroke index, from a finished live round (blank hole = picked up) or typed
  in with every hole filled.
- **Who's shown:** automatic, as approved, except "Only me" cards, members
  who switch it off (**Privacy & security → Course leaderboards**,
  `course_board_optouts`), under-18s, deleted accounts and blocks either way.
  First name + surname initial, score, day — never the card. Handicap only
  when the member shows it on their profile.
- DB: `course_week_board`, `course_legend`, `course_hole_champions`
  (security definer, ranking rows the viewer couldn't read one by one),
  internal `course_board_holes`, `set_course_boards_hidden`. Tests:
  `course-boards.test.ts` (7).
- App: `app/course/board/[id].tsx`, `app/course/champions/[id].tsx`,
  `lib/course-boards.ts`, `lib/course-board-rules.ts` (+tests).

## 3. Course Passport (no migration)

Profile → **Course Passport** (also Menu → Play): a satellite map with a gold
star on every course played (scorecards + courses ticked as played), the
newest white with a gold ring, bucket-list courses outlined; close stars
group into a navy count; **Ireland / Europe / World** chips; tap a star for
the course. Then badges (All 4 Provinces, course milestones, Links Trail,
Played Abroad), courses by province, the **Irish Links Trail** (12 links,
matched to the directory by name) and **My bucket list** (`passport-list`).

- **Map:** a WebView like the hole maps. Apple's satellite map **with place
  names** (MapKit JS "hybrid", native clustering) when the website hands out
  an Apple token (`/api/app/map-tiles`); otherwise Esri satellite with Esri's
  place-name layer. When the website says Google, the passport uses Esri:
  Google's tiles need a per-view copyright line that a world map doesn't
  justify. Falls back to Esri by itself if Apple can't start in 8 s.
- Files: `lib/passport-rules.ts` (+tests), `lib/passport.ts`,
  `components/passport-map.tsx`, `app/passport.tsx`, `app/passport-list.tsx`.

## 4. PinPals Wrapped (no migration)

Profile → **My year in golf** (also Menu → Play): full-screen story cards —
cover (rounds, km walked), the numbers (handicap index change, best round,
birdies/eagles, courses, new courses, rounds by month), and a persona
(Society Regular, Golf Traveller, Course Explorer, Home Bird, The Grinder,
Weekend Warrior), partner of the year and home course, then **Share to
Instagram story**: a 1080×1920 picture drawn by the website
(`/w/<token>/photo`, token signed like scorecard links, from
`POST /api/app/wrapped/share`). In January it shows the year just gone.

- `src/lib/wrapped.ts` is byte-identical in `mobile/src/lib/wrapped.ts`
  (drift test in `wrapped.test.ts`). Handicap change = first vs last
  handicap index on the year's cards.
- Files: `mobile/src/lib/wrapped-data.ts`, `mobile/src/app/wrapped.tsx`,
  `src/lib/wrapped-links.ts` (+test), `src/lib/wrapped-server.ts`,
  `src/app/api/app/wrapped/share/route.ts`, `src/app/w/[token]/photo/route.tsx`.

## 5. Claim your card (0198)

"Send Mark his scorecard" already existed (0118: Your fourball after a round
→ WhatsApp / Text message → `/guest/<token>`). Added:

- `claim_round_guest` now also saves the claimer's own scorecard from the
  round, so it's in their scorecards, passport, leaderboards and Wrapped at
  once (best effort — the claim stands if saving fails).
- `my_guest_invite_stats()` → "2 golfers have joined from the 3 cards you've
  sent" under Your fourball (counts only, never who).
- The claim page shows Stableford points per hole and an "Also waiting for
  you" list (side-game results if played, the connection, the passport
  stamp, the leaderboard).
- **Not built:** the mock-up's "bring 3 golfers, get a month of Premium" —
  paid plans are still off for everyone, so there's nothing to give yet.
  The count is there to hang it on when memberships go live.

Tests: `claim-your-card.test.ts`; grants register updated.

## Guides

`guide.ts`: two steps added to **Score a game live** (Add side games; Say
you're in, and settle up) and a new guide **Your passport, leaderboards and
year**; GUIDE_CHANGES 30 Oct.

## Checked

Website + app unit tests 2,228 passing; RLS suite 1,137 passing on a fresh
local replay (0001–0198); app `tsc` clean. Not yet seen on a phone.
