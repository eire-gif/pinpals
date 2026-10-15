-- 0153 — Hole map: My bag, the club for a shot, and local knowledge (Oct 2026).
--
-- MY BAG. How far a member hits each club: typed in (member_bag.yards) and,
-- better, learned from the shots they mark on the hole map. When a shot is
-- marked, the app shows how far it went; the member can tap the club they
-- hit, and live_round_shot_club() keeps the club and that distance on the
-- shot. my_bag() returns, per club, the typed number and the median and
-- usual spread (20th–80th percentile) of the last year's tagged shots.
-- The app suggests the club whose distance is nearest the "plays like"
-- number. Everything here is the member's own: nobody else reads it.
--
-- LOCAL KNOWLEDGE. Members leave a short tip for a hole ("aim at the left
-- edge of the ruin") and mark others' tips useful. One tip per member per
-- hole per club (they can delete and write it again) keeps it from being
-- spammed. Signed-in members read tips through hole_tips_for(), which gives
-- the author's first name and handicap only. Staff hide a tip by setting
-- hidden_at (as for course reviews); its author still sees it.
--
-- Rollback:
--   drop function if exists public.hole_tips_for(bigint, smallint);
--   drop function if exists public.my_bag();
--   drop function if exists public.live_round_shot_club(bigint, bigint, smallint, smallint, text, numeric);
--   drop table if exists public.hole_tip_votes, public.hole_tips, public.member_bag;
--   alter table public.live_round_shots drop column if exists club, drop column if exists club_distance_m;

-- The clubs a bag can hold, longest first. The app has the labels.
create or replace function public.golf_club_keys()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['driver','3w','5w','7w','2h','3h','4h','5h','6h','2i','3i','4i','5i','6i','7i','8i','9i','pw','gw','sw','lw']::text[];
$$;

-- ---------------------------------------------------------------------------
-- My bag
-- ---------------------------------------------------------------------------

create table if not exists public.member_bag (
  member_id uuid not null references public.profiles (id) on delete cascade,
  club text not null check (club = any (public.golf_club_keys())),
  -- What the member says they carry it, before there are shots to go by.
  yards smallint check (yards is null or yards between 20 and 400),
  in_bag boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (member_id, club)
);

comment on table public.member_bag is 'My bag: the clubs a member carries and how far they say they hit each. Private to the member.';

alter table public.member_bag enable row level security;

create policy "Members read their own bag" on public.member_bag
  for select to authenticated using (member_id = (select auth.uid()));
create policy "Members add to their own bag" on public.member_bag
  for insert to authenticated with check (member_id = (select auth.uid()));
create policy "Members change their own bag" on public.member_bag
  for update to authenticated using (member_id = (select auth.uid())) with check (member_id = (select auth.uid()));
create policy "Members empty their own bag" on public.member_bag
  for delete to authenticated using (member_id = (select auth.uid()));

revoke all on public.member_bag from anon;
grant select, insert, update, delete on public.member_bag to authenticated;

-- ---------------------------------------------------------------------------
-- The club a marked shot was hit with
-- ---------------------------------------------------------------------------

alter table public.live_round_shots
  add column if not exists club text check (club is null or club = any (public.golf_club_keys())),
  add column if not exists club_distance_m numeric(5, 1) check (club_distance_m is null or club_distance_m between 1 and 450);

comment on column public.live_round_shots.club is 'The club the player says they hit this shot with (My bag, 0153). Set only by that player, via live_round_shot_club.';
comment on column public.live_round_shots.club_distance_m is 'How far that shot went, as the hole map measured it when the club was tagged — from the tee or the previous mark.';

-- Tag (or clear, with p_club null) the club for one of YOUR OWN shots. Only
-- the player themself: a club is their own account of their game, and it
-- feeds only their own bag. The round needn't still be live — a member can
-- tag on the walk to the car.
create or replace function public.live_round_shot_club(
  p_round_id bigint,
  p_player_id bigint,
  p_hole smallint,
  p_shot_no smallint,
  p_club text,
  p_distance_m numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select auth.uid()) is null or not exists (
    select 1 from public.live_round_players
    where id = p_player_id and round_id = p_round_id and member_id = (select auth.uid())
  ) then
    raise exception 'You can only say which club you hit for your own shots' using errcode = '42501';
  end if;
  if p_club is not null and not (p_club = any (public.golf_club_keys())) then
    raise exception 'Unknown club' using errcode = '22023';
  end if;
  if p_club is not null and (p_distance_m is null or p_distance_m not between 1 and 450) then
    raise exception 'That shot has no distance to keep' using errcode = '22023';
  end if;

  update public.live_round_shots
     set club = p_club,
         club_distance_m = case when p_club is null then null else round(p_distance_m, 1) end
   where round_id = p_round_id and player_id = p_player_id and hole = p_hole and shot_no = p_shot_no;
  if not found then
    raise exception 'No such shot' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.live_round_shot_club(bigint, bigint, smallint, smallint, text, numeric) from public, anon;
grant execute on function public.live_round_shot_club(bigint, bigint, smallint, smallint, text, numeric) to authenticated;

-- The caller's bag: each club they carry or have tagged a shot with in the
-- last year — what they typed, and what their shots say.
create or replace function public.my_bag()
returns table (club text, in_bag boolean, yards smallint, shots integer, median_m numeric, low_m numeric, high_m numeric)
language sql
stable
security definer
set search_path = public
as $$
  with mine as (
    select s.club, s.club_distance_m as d
    from public.live_round_shots s
    join public.live_round_players p on p.id = s.player_id
    where p.member_id = (select auth.uid())
      and s.club is not null and s.club_distance_m is not null
      and s.recorded_at > now() - interval '365 days'
  ),
  learned as (
    select club,
           count(*)::integer as shots,
           round(percentile_cont(0.5) within group (order by d)::numeric, 1) as median_m,
           round(percentile_cont(0.2) within group (order by d)::numeric, 1) as low_m,
           round(percentile_cont(0.8) within group (order by d)::numeric, 1) as high_m
    from mine group by club
  )
  select k.club,
         coalesce(b.in_bag, l.club is not null) as in_bag,
         b.yards,
         coalesce(l.shots, 0),
         l.median_m, l.low_m, l.high_m
  from unnest(public.golf_club_keys()) with ordinality as k(club, ord)
  left join public.member_bag b on b.club = k.club and b.member_id = (select auth.uid())
  left join learned l on l.club = k.club
  where (select auth.uid()) is not null and (b.club is not null or l.club is not null)
  order by k.ord;
$$;

revoke all on function public.my_bag() from public, anon;
grant execute on function public.my_bag() to authenticated;

-- ---------------------------------------------------------------------------
-- Local knowledge
-- ---------------------------------------------------------------------------

create table if not exists public.hole_tips (
  id bigint generated always as identity primary key,
  club_id bigint not null references public.clubs (id) on delete cascade,
  hole smallint not null check (hole between 1 and 18),
  member_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 3 and 280),
  created_at timestamptz not null default now(),
  hidden_at timestamptz,
  hidden_by uuid references public.profiles (id) on delete set null,
  hidden_reason text check (hidden_reason is null or char_length(hidden_reason) <= 500),
  unique (club_id, hole, member_id)
);

create index if not exists hole_tips_hole_idx on public.hole_tips (club_id, hole);

comment on table public.hole_tips is 'Local knowledge: members'' tips for a hole, shown on the hole map. One per member per hole. Hidden by staff with hidden_at.';

create table if not exists public.hole_tip_votes (
  tip_id bigint not null references public.hole_tips (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (tip_id, member_id)
);

alter table public.hole_tips enable row level security;
alter table public.hole_tip_votes enable row level security;

create policy "Members read visible tips and their own" on public.hole_tips
  for select to authenticated using (hidden_at is null or member_id = (select auth.uid()) or (select public.is_staff()));
create policy "Members write their own tip" on public.hole_tips
  for insert to authenticated with check (member_id = (select auth.uid()) and hidden_at is null and hidden_by is null and hidden_reason is null);
create policy "Members delete their own tip" on public.hole_tips
  for delete to authenticated using (member_id = (select auth.uid()));
create policy "Staff hide tips" on public.hole_tips
  for update to authenticated using ((select public.is_staff())) with check ((select public.is_staff()));

create policy "Members see their own votes" on public.hole_tip_votes
  for select to authenticated using (member_id = (select auth.uid()));
create policy "Members vote as themselves" on public.hole_tip_votes
  for insert to authenticated with check (
    member_id = (select auth.uid())
    and exists (select 1 from public.hole_tips t where t.id = tip_id and t.hidden_at is null and t.member_id <> (select auth.uid()))
  );
create policy "Members take back their own vote" on public.hole_tip_votes
  for delete to authenticated using (member_id = (select auth.uid()));

revoke all on public.hole_tips, public.hole_tip_votes from anon;
grant select, insert, delete on public.hole_tips to authenticated;
grant update (hidden_at, hidden_by, hidden_reason) on public.hole_tips to authenticated;
grant select, insert, delete on public.hole_tip_votes to authenticated;

-- A hole's tips, most useful first, with what the screen shows of the
-- author: first name and handicap. A hidden tip shows only to its author.
create or replace function public.hole_tips_for(p_club_id bigint, p_hole smallint)
returns table (id bigint, body text, created_at timestamptz, author_first_name text, author_handicap numeric, useful integer, i_found_useful boolean, mine boolean, hidden boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.body, t.created_at,
         pr.first_name,
         case when pr.handicap_visible then pr.handicap end,
         (select count(*)::integer from public.hole_tip_votes v where v.tip_id = t.id),
         exists (select 1 from public.hole_tip_votes v where v.tip_id = t.id and v.member_id = (select auth.uid())),
         t.member_id = (select auth.uid()),
         t.hidden_at is not null
  from public.hole_tips t
  join public.profiles pr on pr.id = t.member_id
  where (select auth.uid()) is not null
    and t.club_id = p_club_id and t.hole = p_hole
    and (t.hidden_at is null or t.member_id = (select auth.uid()))
  order by 6 desc, t.created_at desc
  limit 30;
$$;

revoke all on function public.hole_tips_for(bigint, smallint) from public, anon;
grant execute on function public.hole_tips_for(bigint, smallint) to authenticated;
