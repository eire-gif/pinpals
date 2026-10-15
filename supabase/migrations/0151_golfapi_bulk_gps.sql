-- 0151 — golfapi bulk import: hole positions too (Oct 2026).
--
-- The bulk card import (0148) can now also fetch each course's GPS hole
-- positions (`bulk` with gps), and fill them in afterwards for clubs that
-- were imported cards-only (`bulk_gps`). gps_at records when a club's
-- positions were fetched, so a club is never paid for twice. Positions go
-- to course_layout_points (0108) — read one club at a time, like the cards
-- (0149/0150), under golfapi's no-copying terms.
--
-- Order agreed 15 Oct 2026: Ireland (with Northern Ireland) first, then
-- England, Scotland and Wales; Spain and Portugal later.
--
-- Rollback:
--   drop function if exists public.golfapi_bulk_gps_next(int, text[], bigint[]);
--   alter table public.golfapi_bulk_clubs drop column if exists gps_at;

alter table public.golfapi_bulk_clubs add column if not exists gps_at timestamptz;

-- Clubs whose cards were imported but whose positions haven't been fetched,
-- in the same country order as golfapi_bulk_next, optionally limited to
-- some countries or clubs.
create or replace function public.golfapi_bulk_gps_next(p_limit int, p_countries text[] default null, p_club_ids bigint[] default null)
returns table (club_id bigint, country text, name text, candidates jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select c.id, c.country, c.name, b.candidates
  from public.golfapi_bulk_clubs b
  join public.clubs c on c.id = b.club_id
  where b.status = 'imported'
    and b.gps_at is null
    and (p_countries is null or c.country = any (p_countries))
    and (p_club_ids is null or c.id = any (p_club_ids))
  order by coalesce(array_position(array['ireland', 'northern-ireland', 'england', 'scotland', 'wales', 'spain', 'portugal'], c.country), 99),
           c.name, c.id
  limit greatest(0, least(p_limit, 200));
$$;

revoke all on function public.golfapi_bulk_gps_next(int, text[], bigint[]) from public, anon, authenticated;
grant execute on function public.golfapi_bulk_gps_next(int, text[], bigint[]) to service_role;
