-- Pinpals: find open tee-time invites within N km of a point
--
-- Powers "tee times near me" on /tee-times. The member's browser asks for
-- their GPS position, and the page passes it here to get back the invites
-- close enough to drive to, with the distance to each.
--
-- ============ Why this needs no PostGIS and no index ============
--
-- Great-circle distance by the haversine formula, computed in plain SQL.
-- PostGIS is not installed on this project and adding it for one query would
-- be a large dependency for a small job. The arithmetic is exact enough by a
-- wide margin: haversine on a spherical earth is within about 0.3% of the
-- true ellipsoidal distance, which over a 30 km radius is under 100 metres —
-- far inside the precision of the coordinates themselves, which come from
-- OpenStreetMap and are rounded to roughly a kilometre by the caller before
-- they are ever sent (see the client component's own comment on why).
--
-- No index and no bounding-box pre-filter either, deliberately. The query
-- drives from tee_time_invites, not from clubs: there are a handful of open
-- invites at any moment and each joins to exactly one club row by primary
-- key. Scanning 2,500 clubs would need an index; scanning the open invites
-- does not. If this table ever holds tens of thousands of live invites, the
-- fix is a bounding box on lat/lng before the acos — not sooner.
--
-- ============ Why SECURITY INVOKER ============
--
-- Left as the default (invoker) on purpose, and it must stay that way. RLS on
-- tee_time_invites is what enforces the audience a host chose in 0065 — a
-- "connections only" invite is invisible to everyone outside their accepted
-- connections. A SECURITY DEFINER function here would run as the owner,
-- bypass that policy, and quietly turn a proximity search into a way to
-- enumerate every private invite in the country. Invoker means this function
-- can only ever return rows the caller could already have read.
--
-- Rollback:
--   drop function if exists public.invites_near(double precision, double precision, double precision);

create or replace function public.invites_near(
  p_lat double precision,
  p_lng double precision,
  p_radius_km double precision default 30
)
returns table (invite_id bigint, distance_km double precision)
language sql
stable
set search_path = public
as $$
  with bounded as (
    -- Clamped rather than rejected: a bad radius should narrow to something
    -- sensible, not error out in front of a member who just pressed a button.
    select
      p_lat as lat,
      p_lng as lng,
      least(greatest(coalesce(p_radius_km, 30), 1), 200) as radius_km
  ),
  measured as (
    select
      i.id,
      -- least/greatest clamp the cosine into [-1, 1]. Floating-point error
      -- can push it a hair outside for two points at (or very near) the same
      -- coordinates, and acos() of 1.0000000001 is a runtime error, not a
      -- rounding artefact — so the one case that would break this is a member
      -- standing on the course they are searching from.
      6371 * acos(least(1, greatest(-1,
        cos(radians(b.lat)) * cos(radians(c.latitude))
          * cos(radians(c.longitude) - radians(b.lng))
        + sin(radians(b.lat)) * sin(radians(c.latitude))
      ))) as distance_km,
      b.radius_km
    from bounded b
    join public.tee_time_invites i on true
    join public.clubs c on c.id = i.club_id
    where b.lat is not null
      and b.lng is not null
      and c.latitude is not null
      and c.longitude is not null
  )
  select m.id, m.distance_km
  from measured m
  where m.distance_km <= m.radius_km
  order by m.distance_km;
$$;

revoke all on function public.invites_near(double precision, double precision, double precision) from public;
revoke execute on function public.invites_near(double precision, double precision, double precision) from anon;
grant execute on function public.invites_near(double precision, double precision, double precision) to authenticated;
