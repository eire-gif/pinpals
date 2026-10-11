# Rounds from a group, and the society day (Oct 2026, migration 0121)

Pick a crew or society, tick who's playing, choose the format, and the app draws the tee groups or teams — at random or balanced by handicap — then everyone scores live on one leaderboard.

## Decisions (Eire, 11 Oct 2026)
- Include a **society day**: individual Stableford or stroke play across several tee groups, everyone on one leaderboard. This is the usual society format, and live scoring couldn't do it before.
- **Who can draw from a group, and be put on cards:**
  - anyone in a **crew or trip**
  - in a **society**, only the **owner and admins**
  - An ordinary member of a big society can't put strangers on cards.

## What a member does
- **Entry points:**
  - ☰ → Live scoring → **From a Group** (shown with the `groups` flag)
  - **Start a round** on a group's page, for those who can draw from it
- **Screen** (`live/day/group`), top to bottom:
  - Group chips.
  - **Who's playing:** crews and trips start with everyone ticked; a society starts with just you. Tick everyone / Clear, a handicap index per player (pre-filled where shared, red when missing), and **Add a guest**.
  - **Course:** the shared `CourseSection`.
  - **Format:** Stableford · Stroke play · Scramble 4s · Scramble 2s, plus Fourballs / Threeballs for tee groups.
  - **Name** of the day.
  - **The draw:**
    - Random or Balanced by handicap.
    - Optional first tee time and gap (8/9/10/12 minutes).
    - **Make the draw** shows each group with its tee time and index total. Tap one player, then another, to swap. **Draw again** reshuffles.
  - **Start the day** or **Start the scramble**.
- **Society day board** (`live/day/[id]`, `components/day-board.tsx`):
  - Position, player, group, thru, and points (with pace) or net.
  - Your row is tinted; tap a row for that group's card.
  - On the card, the header reads "Group N" and the link "leaderboard".

## The draw: `mobile/src/lib/group-draw.ts`
Pure functions, 11 tests.
- `teeGroupSizes(n, max)`: as few groups as possible, as even as possible, bigger first. For example, 10 in fours is 4 · 3 · 3.
- `teamSizes(n, size)`: exact teams only, plus how many are left over (a scramble needs guests added or someone unticked).
- `draw(players, sizes, mode, rng)`:
  - random: shuffle, then fill.
  - balanced: shuffle, sort by index, and deal snake style (1-2-3-3-2-1). A missing index counts as the field's median.
- `swapPlayers`, `teeTimes`, `indexTotal`.

## Handicaps
- **Society day:** course handicap from the course chosen, with a 95% allowance (WHS individual stroke play) for Stableford and stroke play.
- **Scramble:** the existing `scrambleHandicap()` shares, the same as the scramble set-up screen.

## Database (0121_group_rounds.sql)
- `live_can_add_player(me, member)`: one rule replacing the inline check in `live_round_create`, `live_match_day_create` and `live_scramble_day_create`.
  - You can add: yourself; an accepted PinPal; someone in a crew or trip with you; or anyone in a group you own or admin.
  - Never someone blocked either way, or a deleted member.
  - The three functions are recreated from 0113/0104 with only that check swapped. The refusal now reads "…your PinPals, people in your group, or guests by name".
- `live_match_days.kind` gains **'fourballs'**. Dropping the old check is a hand step in the SQL editor.
- `live_fourball_day_create(p_day, p_groups, p_card)`:
  - 1–40 groups of 1–5 players, format stableford or stroke, with an allowance.
  - One `live_rounds` row per group (`match_number` = group, `tee_time`).
  - Nobody in two groups.
  - Seeing, scoring, realtime, delete and calendar all reuse the match-day machinery unchanged.
- **Notifications:**
  - Each member player gets "Captain's Day: you're in group 3", saying who they're with and the tee time (`live_match_added`).
  - Match-result alerts are skipped for society days.

## Verified
- Full replay of 121 migrations.
- RLS 699/699, 8 new in `group-rounds.test.ts`. Making `live_can_add_player` always true fails three of them, which was checked.
- The three old tests' expected wording was updated.
- Function grants register updated.
- Website: tsc clean, lint 0 errors, production build OK, 1256 unit tests.
- App: tsc clean, 236 lib tests (14 new: draw and day board).

## To ship
1. Apply 0121.
   - Through the Supabase tool: everything except the two `live_match_days_kind_check` lines.
   - Those two lines by hand in the SQL editor.
2. Merge, and let Vercel deploy (notifications).
3. `git pull origin main`, then `cd mobile && eas update --branch production --platform ios`.

## Not done yet
- Match-day sides (Blues v Golds) from a draw.
- Keeping named pairs together in a draw.
- Linking a day to the group it came from (for a group's "rounds" tab later).
