# Competitions — Oct 2026

**Asked (Eire, 15 Oct 2026):** could PinPals carry the open competitions that
BRS lists, so members can compete? Settled on: matchplay leagues with a table
(the part members liked most), ladders, and opens listed with the club's own
booking link plus a "need a partner" flag. Mock-ups approved: canvas
*PinPals Competitions* (5 boards: hub, league table, submit result, knockout,
opens).

## Why not pull BRS's opens

BRS (GolfNow) has no public API for third parties, and copying its listings
would breach its terms. Opens are shared by members and marked "posted by the
club" by staff; a BRS/GolfNow partner feed is the later step once PinPals has
the numbers to ask. PinPals never books or takes the entry for an open.

## The rules

- **Leagues:** singles matchplay. Groups of 3–8 play round robin (circle
  method, built by the database), each round by its play-by date. Win 3,
  half 1 (configurable before the draw); ties on points go to holes +/-, then
  wins, then the match between two players level (two-way ties only), then
  name. The top 1 or 2 from each group go to a knockout, seeded so a group's
  winner and runner-up can't meet in the first round; byes go to top seeds.
- **Ladders:** join at the bottom; challenge up to N places above (default
  3); a challenger's win takes the place and everyone between moves down one.
  Halves allowed; nothing moves.
- **Margins:** `1 up`, `2 up`, `N&M` with N = M+1 (or M+2 after dormie),
  N+M ≤ 18; `19th`, `20th`, `21st`… in a knockout only; `w/o` by the
  organiser. Mirrored in `lib/matchplay.ts` and `competition_margin_holes()`,
  and a test keeps them in step.
- **Shots:** the full difference between course handicaps (WHS / Golf
  Ireland singles matchplay). The app estimates from handicap indexes and
  says to check course handicaps on the day.
- **Results:** either player reports; the other confirms (against the result
  they were shown) or disputes; it stands after 48 hours
  (`competition_settle_due`, pg_cron every 15 min). Both reporting the same
  result confirms it; different results go to the organiser.
- **Organisers:** a group's *current* owner/admins, or active staff
  (admin/super_admin, read from `staff_roles` directly — `is_staff()` needs
  two-step sign-in, which app sessions never have) for PinPals-wide ones.
  They make the draw, mark fees, settle disputes, give walkovers, void group
  or ladder matches, start the knockout and cancel.
- **Entry fees:** recorded and marked paid by the organiser (cash, transfer,
  waived). No card payments yet — next step, as society entry fees were
  staged.

## Storage (migration 0148)

| Table | Holds |
|---|---|
| `competition_leagues` | league or ladder, who it's for (group or everyone), fee, dates, format settings, status |
| `competition_entries` | who's in, handicap index at entry, group, ladder rung (unique, deferred), paid |
| `competition_matches` | group/knockout/ladder matches, arranged time and club, result, report/confirm/dispute state, knockout wiring |
| `open_competitions` | club, date, title, fee text, booking link, province, member/club source |
| `open_partner_requests` | members looking for a partner for an open |
| `competition_alerts` | outbox the website sends (Inbox + push, app only, type `competition`) |

Reads under RLS (a group's competitions only to its members); every write
through a function. Alerts: the app calls `POST /api/app/competitions/alerts`
after a change; pg_cron calls `/api/competitions/alerts/run` every 3 minutes
with the society-alerts secret.

Tests: `supabase/tests/rls/competitions.test.ts`,
`mobile/src/lib/matchplay.test.ts`. Reviewed by a separate agent before
applying; fixes: nulls in a draw, confirm-against-shown-result, alert dedupe,
organiser rights tied to current role, ladder lock + unique rung, settle
sweep only acting on rows it confirmed, ladder halves consistent.

## Screens (app, behind `competitions` flag)

Menu → Play → Competitions.

- `app/compete/index.tsx` — your matches, leagues/ladders tabs, open for
  entries, Open competitions card, Start a league or ladder.
- `app/compete/[id].tsx` — entries and Enter, the organiser's draw preview
  (balanced by handicap, reshuffle, group count), group tables and fixtures,
  knockout, ladder with Challenge.
- `app/compete/match/[id].tsx` — players, shots, set a time and club,
  report / confirm / dispute, organiser settle.
- `app/compete/new.tsx` — start or edit.
- `app/compete/opens.tsx`, `app/compete/share-open.tsx`.
- Guide: *Play in a league, ladder or open* (`guide.ts`, id `compete`).

## Deviations from the mock-ups

- Built in the app's own cream/navy theme rather than the all-navy mock-up.
- Fourball leagues (the "Spring fourball league" card) are not in v1:
  singles only (`format` column is ready for pairs).
- No "posted by the club" self-service for clubs yet: clubs email
  info@pinpals.ie and staff mark them.

## Next

1. Card payments for entry fees (Stripe Connect, as society entry fees).
2. Fourball pairs leagues.
3. Club accounts that post their own opens; a BRS/GolfNow feed conversation.
4. Website pages for leagues and opens.
