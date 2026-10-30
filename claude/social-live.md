# Social: live circles, watching a society day, comments with likes (28 Oct 2026)

**Asked (Eire, 28 Oct 2026):** the Social tab redesigned as a mix of
Instagram, TikTok and Facebook. Mock-ups: canvas *PinPals Social — style
options* — row D ("Combined") approved, with the comments element (likes
etc.) kept on everything.

**Status:** migration 0194, app changes on branch `social-live`. No native
build: nothing adds a native module, `app.json` untouched — ships with
`eas update`.

## What members see

| Where | What |
|---|---|
| **Social, top** (`components/live-circles.tsx`) | A white band with Instagram-style circles: **Post** (your photo + a plus → compose), **Your round** (green LIVE, the MY ROUND pill's round), each of your groups' days going on now (**red LIVE**, "36 playing" → the live view), cards shared with you (green LIVE → Follow my round), results published to your groups in the last 2 days (**gold**, "Results in"). Then **For You · Following · Groups** and My posts. The old compose card is gone (⊕ in the bar and the Post circle replace it). |
| **Groups tab** | Posts by everyone in your Golf Buddies, trips and societies (read under the posts' own RLS), plus those groups' results. "No groups yet" sends you to Groups & Societies. |
| **Results in the feed** (`components/results-card.tsx`) | For You and Groups: a society's published results (last 30 days) among the posts by date — group, navy podium (2nd · 1st · 3rd), your place, **Great Shot** count, comment count, Full results, and the day's comments. |
| **Comments under every post** (`components/comment-preview.tsx`) | Top two comments with a **heart and count**, Reply, "View all 12 comments", "Add a comment…". The post card had stopped previewing comments; the feed already loaded two per post, so this is display only. Hearts use the existing comment likes (0097/0111). |
| **Live view** (`app/social-live/[id].tsx`) | Full screen over the course photo, TikTok-style: title, course, players, LIVE/FINAL; a gold **Birdie / Eagle / Hole in one** banner when one happens while you're watching; the top 5 (players for a society day, teams for a scramble; match days show the team score) with ▲▼ since the last refresh; Full leaderboard; down the right **Great Shot**, Comments, Cards; the comment stream with a heart and count on each, Reply (@name), the pinned comment highlighted; long-press for Pin (organiser) / Delete (yours, or any for the organiser). Refreshes every 15 s. Under 18s see the board only. |
| **Group page** (`components/group-live.tsx`) | For members: a navy **LIVE** banner while a group day is on (Watch → live view), and the latest results from the last 2 weeks as the same results card with comments. |

## Database — `0194_social_live.sql`

- `live_match_days.group_id` + `set_match_day_group(day, group)` (the day's
  starter, who must be in the group). Called after **Start the day** from a
  group's page (`live/day/group.tsx`). Days from a society event were already
  linked through `society_outings.match_day_id`.
- `live_match_day_group(day)` = `group_id`, else the event's group, else the
  published results' group. Internal (no grants).
- `can_view_match_day` = 0174's body **plus**: members of the day's group,
  unless the leaderboard is secret. `can_view_live_round` is unchanged, so
  group members see the cards through its existing "can view the day" branch,
  and a secret day stays hidden from non-players until results are out.
- `live_day_comments` (one thread per day; ≤300 chars; 10 a minute),
  `live_day_comment_likes` (`like_count` kept by trigger),
  `live_day_cheers` (one Great Shot per member per day). Read by anyone who
  can see the day; blocks hide comments both ways; delete your own, or any as
  the organiser (`live_day_is_organiser`); `live_day_comment_pin` organiser
  only. Under 18s: 0159's age guard on insert and the restrictive read rule.
- Tests: `supabase/tests/rls/social-live.test.ts` (10), grants register.
  Whole RLS suite 1113 passing on a local replay.

## Code map

- Rules (pure, tested): `mobile/src/lib/social-live-rules.ts` — circle order,
  initials, board rows, movement, birdie detection, results placed by date.
- Data: `mobile/src/lib/social-live.ts` — circles, group live day, comments,
  likes, cheers, feed results, group mates.
- Feed: `lib/feed.ts` (`groups` scope, `results` entries), `lib/feed-rules.ts`
  (`FEED_SCOPES` adds `groups` — app only; the website keeps two).
- `competition-data.ts`: `groupResultFrom()` split out of `loadGroupResults`.
- Guide: Share on Social — Start a post and React and comment updated; new
  step Watch your group live; GUIDE_CHANGES 28 Oct.

## Not in this round

- No push alerts for live-day comments (the day's players already get birdie
  alerts; comments could be noisy on a 130-player day).
- Viewer counts ("142 watching") from the mock-up: not tracked.
- The website's feed doesn't show the Groups tab or results cards yet.

## 30 Oct 2026 — Share live on PinPals Social (0195)

**Asked (Eire, 30 Oct):** an option to share a round with everyone on PinPals
Social. Decided: society/group days (the organiser) **and** a player's own
round; **off unless switched on**.

- **Switch** `components/share-on-social-row.tsx` — "Share live on PinPals
  Social", with a confirm that says names and scores will be public. On the
  day's leaderboard (`live/day/[id].tsx`, organiser/committee, while live and
  not secret) and on a round's scorecard under Share live
  (`live/round/[id].tsx`, a round outside a day, anyone playing or its starter).
- **Database 0195:** `public_on_social` on `live_match_days` and
  `live_rounds`; `set_match_day_public` (organiser), `set_live_round_public`
  (a player; not a round inside a day). Refused while the leaderboard is
  secret or a member under 18 is playing. `can_view_match_day` /
  `can_view_live_round` + "shared, and the viewer is 18+". A shared day that
  is later made secret disappears again.
- **Comments, likes and Great Shots on a round too:** `round_id` on
  `live_day_comments` and `live_day_cheers` (exactly one of day/round);
  `can_view_live_thread(day, round)`. A round's starter can pin/delete.
- **Social:** shared days show as red LIVE circles to everyone (RLS returns
  them); shared rounds as red circles "Ciarán +3 · Lahinch" →
  `/social-live/<round id>?round=1`. **Players now see their own day's red
  circle** too (it was hidden from them).
- Tests: `social-live.test.ts` +5 (1118 RLS total), rules test, guide step
  "Share a round live with everyone".
- Known: a matchplay round shared on its own shows on the Stableford board
  in the live view; its own scorecard (Cards) has the match.
