# Clubhouse TV leaderboard (Oct 2026)

**Asked (Eire, 15 Oct 2026):** a live leaderboard for a TV in a bar or golf
lobby while the matches are on, in the widget's colours, showing name,
handicap, club, scoring and the hole each player is on, with a birdie or
better flashing up for a few seconds. Mock-ups approved: canvas *PinPals TV
Leaderboard* (4 boards).

## What people do

1. **On the TV**: open **pinpals.ie/tv** in its browser (or a Chromecast /
   Fire Stick, or a laptop on HDMI). It shows a six-character code and a QR.
   No sign-in on the TV.
2. **In the app**: on a society day / match day board tap **Show on TV**, or
   in a round tap **Show the leaderboard on TV** (a round in a day sends the
   whole day). Type the code (or scan the TV's QR: it opens the same screen
   with the code filled in) → **Connect the TV**.
3. The TV moves to the leaderboard by itself.
4. **Share the TV link instead** gives the link directly, for a laptop or an
   iPad on AirPlay. Anyone with the link sees that one leaderboard for three
   days.

## What the TV shows (`src/lib/tv-board.ts`, pure, tested)

- **Players** (society day, or one Stableford / stroke round): position with
  ▲/▼ when it changes, name, club (from the profile; "Guest" for guests),
  playing handicap, **ON** (the hole being played: the hole after the last one
  scored, in card order, so a 10th-tee start reads right; F when done; tee
  time before), OUT and IN (points for Stableford, gross for stroke), and the
  score (points, or net to par). 12 rows a page, paging every 15 s.
- **Teams** (scramble, foursomes pairs): the same, team name, players' first
  names, team handicap.
- **Matches** (match day): team totals (decided matches only), "if it ended
  now", points to win, and every match with status, who leads and thru.
- **The flash**: every birdie or better (`highlightKind`, the same rule as the
  app's alerts; a one-ball side credited once) is listed under *Latest on the
  course*; one that arrives while the TV is on takes over the screen for six
  seconds, in turn if several. Rows with one in the last 10 minutes get a
  badge.
- Footnote: scores provisional until the organiser publishes the results
  (or "Results published").

The TV polls `GET /api/tv/board` every 5 s (it has no session for the app's
private realtime pings). The page keeps the screen awake (Wake Lock), scales a
1920×1080 stage to any screen, shows "Reconnecting…" if updates stop for 30 s,
and hides the pointer and Full screen button until the mouse moves.

## Security

- **TV link** = `/tv/s/<token>`: HMAC-signed `{kind, id, exp}` (`tv-token.ts`,
  the share-links secret), three days, opens only that game's board. Sent to
  the board route in an `Authorization: TV` header.
- **Who can put a game on a TV**: `POST /api/app/live/tv` reads the day or
  round with the member's own client first, so RLS decides — the people who
  can see it in the app. Pairing attempts limited to 20 per 10 min per member.
- **Pairing codes** (migration **0147**, `tv_screens`): server only (RLS on,
  no policies, grants revoked). The TV holds a random secret; only a poll with
  that secret gets the link, so someone reading the code off the screen can't
  take it. Unpaired codes last 10 minutes; codes avoid 0/O/1/I/L. New codes
  limited to 30 an hour per address. RLS test: `supabase/tests/rls/tv-screens.test.ts`.
- What's on the screen: names as on the cards, home club, playing handicap,
  scores. No profile links, no member ids.

## Files

- Website: `src/lib/tv-board.ts` (+ test), `tv-data.ts`, `tv-token.ts`,
  `tv-pairing.ts`; `src/app/tv/*` (pairing screen, board, shell, CSS,
  `qr/[code]`); `src/app/api/tv/{pair,pair/status,board}`;
  `src/app/api/app/live/tv`; `src/app/live/tv` (QR landing without the app);
  `site-chrome-gate.tsx` hides the header/footer on /tv.
- App: `app/(tabs)/live/tv.tsx`, `lib/tv.ts`, `lib/tv-code.ts` (+ test);
  buttons on `live/day/[id].tsx` and `live/round/[id].tsx`; flag
  `clubhouseTv`; guide *Score a game live* → *Put the leaderboard on a TV*.

## To ship

1. Apply `0147_tv_screens.sql` (a create table; no drops).
2. Merge; Vercel deploys the website (/tv works from then).
3. `git pull origin main`, then `cd mobile && eas update --branch production --platform ios`
   (no native module, so no new build).

## Not done

- Side prizes (nearest the pin, longest drive) on the TV: they're entered on
  the results page after the round, not during it.
- Sponsor slot on the TV: can use the advertising system's images later.
- Certified ticks per card on the TV.
