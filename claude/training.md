# Training (Oct 2026)

**Where:** Menu → Play → Training (`/train`). Also: **Lie help** on the live
scoring screen, and a "Practise your putting in Training" link under Your stats
in My Game.

Built from the approved Training mock-ups (Train home, What's your lie?, uphill
and bunker guides, Lie help in live scoring, Putting Lab, Clock drill, 4-week
plan, warm-up, first-putt distance).

## What's in it

| Screen | File | What it does |
| --- | --- | --- |
| Train home | `app/train/index.tsx` | Today's session (from the plan you're on), six lie tiles, three drills, the plans, the warm-up, a link to My Game |
| What's your lie? | `app/train/lies.tsx` | All 14 lies, searchable ("ball above my feet", "fried egg", "headwind"), by Slopes / Sand / Rough & trouble / Wind |
| A lie | `app/train/lie/[id].tsx` | Picture, club / aim / ball, the 4 keys, common mistake, a drill, the rule that applies (from `lib/rules-of-golf.ts`). Right- or left-handed switch flips every direction |
| Putting Lab | `app/train/putting.tsx` | 12 drills by Speed / Start line / Short putts / Games, plus At home; your best score on each |
| A drill | `app/train/drill/[id].tsx` | Set-up and steps, then a scorer you tap as you go — Holed/Missed (clock, mug, around the world), Good/Not (gate, ladder…), or putts per hole (Par 18). Timer; best score kept |
| A plan | `app/train/plan/[id].tsx` | Kill the 3-putt (4 weeks · 12 sessions), Bunker confidence (2 weeks), Winter indoors (6 weeks, carpet only). Start, tick sessions off, stop |
| Warm-up | `app/train/warm-up.tsx` | Car park 5 / Standard 20 / Full 40 minutes, a windy-day extra, the putting routine |
| Lie help | `components/lie-help-sheet.tsx` | Sheet on the live round screen: pick the lie → club, aim, three lines, Full guide |

All content is in **`mobile/src/lib/training.ts`** — pure data, tested by
`training.test.ts`. It works with no signal.

### Lie pictures

Each of the 14 lies has a realistic scene — real sky, textured turf and sand,
and a dimpled ball sitting in that lie (`components/train-art.tsx`). The app
has no SVG library, so the scenes are drawn as SVG in
**`mobile/tools/lie-art/`** (`defs.svg` holds the shared ball, sky and
textures; one file per lie in `scenes/`) and rendered to 960 × 660 JPEGs in
`mobile/assets/images/lies/` by `render.mjs` — edit the SVG and re-render
(instructions at the top of that script), never the JPEGs. Plain images ship
in OTA updates. The Training home shows the six featured lies as two-column
tiles with a short kicker (Slopes / Sand / Rough / Wind).

### Left-handers

Anything that depends on which way you stand is written for a right-hander
with `{left}` / `{right}` in braces; `forHand()` swaps them. The test fails if
a bare "left" or "right" sneaks into a lie guide.

### What's kept on the phone

`lib/training-store.ts` (SecureStore, like the guides' audience): right- or
left-handed, best score per drill, the current plan and which sessions are
ticked. Nothing is sent anywhere. A new phone starts the plan again — if that
ever matters, this one file moves to a table.

## First-putt distance (migration 0179)

Under **Track my stats**, once you've tapped 1 or more putts, a row asks
*First putt from (feet)*: <3, 3–6, 6–10, 10–20, 20–30, 30+. It's the same
stats record as putts — not a second putts entry.

- `member_hole_stats.first_putt` (nullable, six allowed values).
- `my_hole_stats_set(…, p_first_putt text)` — a new **eight-argument** version.
  The 0178 seven-argument version stays for older builds; its upsert doesn't
  name `first_putt`, so a distance survives an older build's save. A chip-in
  (0 putts) never keeps a distance.
- The app calls the eight-argument version and falls back to the old one on
  `PGRST202`, and reads without the column on `42703` — so an OTA ahead of the
  migration still saves and shows everything else.
- My Game: **First putts holed, by distance** (a band shows at 5 putts), and a
  tip when a band three-putts 15%+ of the time, pointing at Ladder lag.
- RLS tests: `my-game-stats.test.ts` (new case), `function-grants.test.ts`.

## Not built yet

- **Videos.** The 45-second animated explainers are being made separately
  (sample: the uphill-lie 3D animation). Each lie has room for one — add a
  `video` field to `Lie` and a Watch button on the guide when they're ready.
- **Crew challenges** (the Progress mock-up's leaderboard) need a table and
  invitations; plan progress and bests are phone-only for now.
- **Snap your lie** (photo → guide) — mock-up only.
- **Have a PGA professional read the advice** before Training is promoted.
