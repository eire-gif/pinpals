-- 0147: clubhouse TV screens (Oct 2026).
--
-- A TV in a bar or golf lobby opens pinpals.ie/tv and shows a six-character
-- code. The organiser, in the app, taps Show on TV on their match day or
-- round and types (or scans) that code; the TV then shows the leaderboard.
-- Nobody signs in on the TV.
--
-- One row per code shown on a TV:
--   code         what the TV shows (no 0/O/1/I/L)
--   secret_hash  sha256 of a random secret only that TV holds, so another
--                browser that reads the code off the screen can't pick up
--                the link meant for the TV
--   match_day_id / round_id  what it was paired to (null until then)
--   expires_at   an unpaired code lasts 10 minutes; the TV asks for a new one
--
-- SERVER ONLY. The website's routes read and write this with the service
-- role (src/app/api/tv/*, src/app/api/app/live/tv): no policies and no
-- grants for anon or authenticated, so nobody can list codes or pair one
-- directly. Whether the organiser may show a game is checked in the route
-- with the member's own client (RLS on live_rounds / live_match_days).
--
-- Rollback:
--   drop table if exists public.tv_screens;

create table if not exists public.tv_screens (
  code text primary key check (code ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'),
  secret_hash text not null check (secret_hash ~ '^[0-9a-f]{64}$'),
  match_day_id bigint references public.live_match_days (id) on delete cascade,
  round_id bigint references public.live_rounds (id) on delete cascade,
  linked_by uuid references public.profiles (id) on delete set null,
  linked_at timestamptz,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (num_nonnulls(match_day_id, round_id) <= 1),
  check ((linked_at is null) = (match_day_id is null and round_id is null))
);

create index if not exists tv_screens_expires_idx on public.tv_screens (expires_at);

comment on table public.tv_screens is
  'Clubhouse TV pairing codes (0147). Server only: written and read by the website with the service role. A code is paired to one match day or round by its organiser from the app.';

alter table public.tv_screens enable row level security;

revoke all on table public.tv_screens from anon, authenticated;
