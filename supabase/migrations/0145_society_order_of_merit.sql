-- A society's order of merit (14 Oct 2026). Design: claude/society-order-of-merit.md.
--
-- The standings are worked out on the phone from the society's published
-- results (0137/0138: competition_results with group_id set), with one
-- pure, tested function (mobile/src/lib/order-of-merit.ts), the same way
-- the results themselves are. What's stored here is only the society's
-- rules, set by the captain or secretary:
--
--   points            points for 1st, 2nd, 3rd… (up to 20 places)
--   attendance_points for everyone who played and returned a card
--   best_of           count only a member's best N events (null: all)
--   include_team      team and pairs events count (each player scores the
--                     team's points)
--   season_start_month the season the table runs over (1 = January)
--
-- Members read the rules; nobody writes them directly.
--
-- Rollback: drop function if exists public.save_order_of_merit(bigint, jsonb);
--           drop table if exists public.society_merit_settings;

create table if not exists public.society_merit_settings (
  group_id bigint primary key references public.groups (id) on delete cascade,
  points integer[] not null default '{25,20,16,13,11,10,9,8,7,6}' check (cardinality(points) between 1 and 20),
  attendance_points integer not null default 2 check (attendance_points between 0 and 50),
  best_of integer check (best_of is null or best_of between 1 and 60),
  include_team boolean not null default true,
  season_start_month smallint not null default 1 check (season_start_month between 1 and 12),
  updated_at timestamptz not null default now()
);
alter table public.society_merit_settings enable row level security;
drop policy if exists "group members read the order of merit rules" on public.society_merit_settings;
create policy "group members read the order of merit rules" on public.society_merit_settings
  for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));
revoke all on public.society_merit_settings from anon, authenticated;
grant select on public.society_merit_settings to authenticated;

create or replace function public.save_order_of_merit(p_group_id bigint, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_points integer[];
  v_att integer := coalesce(nullif(p ->> 'attendance_points', '')::integer, 2);
  v_best integer := nullif(p ->> 'best_of', '')::integer;
  v_month smallint := coalesce(nullif(p ->> 'season_start_month', '')::smallint, 1);
  v_p integer;
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'The order of merit is for societies.';
  end if;
  if coalesce(public.group_role(p_group_id, (select auth.uid())), '') not in ('owner', 'admin') then
    raise exception 'Only the captain or secretary can change the order of merit.' using errcode = '42501';
  end if;
  if jsonb_typeof(p -> 'points') <> 'array' then raise exception 'Set the points for each place.'; end if;
  select array_agg(x::integer order by ord) into v_points from jsonb_array_elements_text(p -> 'points') with ordinality t(x, ord);
  if v_points is null or cardinality(v_points) not between 1 and 20 then raise exception 'Points for between 1 and 20 places.'; end if;
  foreach v_p in array v_points loop
    if v_p < 0 or v_p > 500 then raise exception 'Points are between 0 and 500.'; end if;
  end loop;
  if v_att < 0 or v_att > 50 then raise exception 'Points for playing are between 0 and 50.'; end if;
  if v_best is not null and (v_best < 1 or v_best > 60) then raise exception 'Best of between 1 and 60 events.'; end if;
  if v_month not between 1 and 12 then raise exception 'Choose the month the season starts.'; end if;

  insert into public.society_merit_settings (group_id, points, attendance_points, best_of, include_team, season_start_month, updated_at)
  values (p_group_id, v_points, v_att, v_best, coalesce((p ->> 'include_team')::boolean, true), v_month, now())
  on conflict (group_id) do update set points = excluded.points, attendance_points = excluded.attendance_points,
    best_of = excluded.best_of, include_team = excluded.include_team, season_start_month = excluded.season_start_month, updated_at = now();
end;
$$;
revoke all on function public.save_order_of_merit(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_order_of_merit(bigint, jsonb) to authenticated;

notify pgrst, 'reload schema';
