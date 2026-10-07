-- 0105 — live scoring fixes from the first tester rounds (7 Oct 2026)
--
-- 1. A stroke index can be on one hole only. Testers entering the card hole
--    by hole put SI 13 and SI 4 on two holes each; the app greyed the used
--    numbers but still let them be tapped. The app now refuses too, and so
--    does this, for any client.
--
-- 2. Deleting. A round's creator can delete it, live or finished. A match
--    day's organiser can delete the whole day, or one match in it. Players,
--    holes and scores go with it (on delete cascade, 0103/0104). Everyone
--    still looking at it gets a ping and their screen reloads to "This
--    round isn't available".
--
-- Writes stay in SECURITY DEFINER functions; the tables keep no write
-- grants for authenticated. EXECUTE is revoked from public and anon by name
-- (Supabase's default privileges grant it to both — the 0076 rule).

create or replace function public.live_round_set_hole(p_round_id bigint, p_hole smallint, p_par smallint, p_stroke_index smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken smallint;
begin
  if not public.can_score_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_rounds where id = p_round_id and status = 'live') then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if p_stroke_index is not null
     and not exists (select 1 from public.live_round_holes
                      where round_id = p_round_id and hole = p_hole and stroke_index = p_stroke_index) then
    select hole into v_taken
      from public.live_round_holes
     where round_id = p_round_id and stroke_index = p_stroke_index and hole <> p_hole
     limit 1;
    if v_taken is not null then
      raise exception 'Stroke index % is already on hole %', p_stroke_index, v_taken using errcode = '23505';
    end if;
  end if;
  update public.live_round_holes set par = p_par, stroke_index = p_stroke_index
   where round_id = p_round_id and hole = p_hole;
  if not found then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;
end;
$$;

-- Who may delete a round: whoever started it, or the organiser of the match
-- day it belongs to. Players who were added by someone else can't.
create or replace function public.live_round_delete(p_round_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator uuid;
  v_day bigint;
  v_organiser uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  select r.created_by, r.match_day_id, d.created_by
    into v_creator, v_day, v_organiser
    from public.live_rounds r
    left join public.live_match_days d on d.id = r.match_day_id
   where r.id = p_round_id;
  if not found then
    return;
  end if;
  if v_creator is distinct from (select auth.uid()) and v_organiser is distinct from (select auth.uid()) then
    raise exception 'Only the person who started this round can delete it' using errcode = '42501';
  end if;

  begin
    perform realtime.send(jsonb_build_object('round_id', p_round_id, 'deleted', true), 'changed', 'live-round-' || p_round_id, true);
    if v_day is not null then
      perform realtime.send(jsonb_build_object('round_id', p_round_id, 'day_id', v_day), 'changed', 'live-day-' || v_day, true);
    end if;
  exception when others then
    null;
  end;

  delete from public.live_rounds where id = p_round_id;
end;
$$;

create or replace function public.live_match_day_delete(p_day_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organiser uuid;
  v_round bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'Not your match day' using errcode = '42501';
  end if;
  select created_by into v_organiser from public.live_match_days where id = p_day_id;
  if not found then
    return;
  end if;
  if v_organiser is distinct from (select auth.uid()) then
    raise exception 'Only the organiser can delete this match day' using errcode = '42501';
  end if;

  begin
    perform realtime.send(jsonb_build_object('day_id', p_day_id, 'deleted', true), 'changed', 'live-day-' || p_day_id, true);
    for v_round in select id from public.live_rounds where match_day_id = p_day_id loop
      perform realtime.send(jsonb_build_object('round_id', v_round, 'deleted', true), 'changed', 'live-round-' || v_round, true);
    end loop;
  exception when others then
    null;
  end;

  delete from public.live_match_days where id = p_day_id;
end;
$$;

revoke all on function public.live_round_delete(bigint) from public;
revoke execute on function public.live_round_delete(bigint) from anon;
grant execute on function public.live_round_delete(bigint) to authenticated;

revoke all on function public.live_match_day_delete(bigint) from public;
revoke execute on function public.live_match_day_delete(bigint) from anon;
grant execute on function public.live_match_day_delete(bigint) to authenticated;
