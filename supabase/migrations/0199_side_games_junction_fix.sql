-- 0199 — Side games: give the two link tables their own ids (30 Oct 2026)
--
-- REGRESSION FIX for 0196. live_round_side_game_payments had the primary key
-- (round_id, from_player_id, to_player_id) and live_round_side_game_agreements
-- (round_id, member_id). A table whose primary key is made of foreign keys
-- to two other tables is read by the API (PostgREST) as a many-to-many
-- "junction" between them. That gave live_round_players → live_rounds a
-- second and third route (through the payments table), so every request
-- embedding one in the other — the MY ROUND pill's
-- live_round_players?select=…,live_rounds!inner(…), match days, competition
-- results — was refused as ambiguous (PGRST201). The agreements table did
-- the same between live_rounds and profiles.
--
-- Each table gets a plain identity primary key, and the old key becomes a
-- unique constraint, so nothing about what's allowed changes and every
-- `on conflict (round_id, from_player_id, to_player_id)` / `on conflict do
-- nothing` in 0196's functions works as before. The API then sees no
-- junctions and only the direct links.
--
-- Rollback: drop the id columns and restore the composite primary keys
-- (which brings the ambiguity back).

alter table public.live_round_side_game_payments
  add column if not exists id bigint generated always as identity;
alter table public.live_round_side_game_payments
  drop constraint if exists live_round_side_game_payments_pkey;
alter table public.live_round_side_game_payments
  add constraint live_round_side_game_payments_pkey primary key (id);
alter table public.live_round_side_game_payments
  drop constraint if exists live_round_side_game_payments_pair_key;
alter table public.live_round_side_game_payments
  add constraint live_round_side_game_payments_pair_key unique (round_id, from_player_id, to_player_id);

alter table public.live_round_side_game_agreements
  add column if not exists id bigint generated always as identity;
alter table public.live_round_side_game_agreements
  drop constraint if exists live_round_side_game_agreements_pkey;
alter table public.live_round_side_game_agreements
  add constraint live_round_side_game_agreements_pkey primary key (id);
alter table public.live_round_side_game_agreements
  drop constraint if exists live_round_side_game_agreements_member_key;
alter table public.live_round_side_game_agreements
  add constraint live_round_side_game_agreements_member_key unique (round_id, member_id);

-- The API reloads its picture of the tables.
notify pgrst, 'reload schema';
