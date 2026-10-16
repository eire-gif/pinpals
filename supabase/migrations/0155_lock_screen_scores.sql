-- 0155_lock_screen_scores.sql — Scoring from the lock screen (Oct 2026).
--
-- The iPhone Live Activity lets a player save their own score on a hole
-- without unlocking the phone. Its buttons run while the app is asleep, so
-- there is no Supabase session to call live_round_set_score() with. Instead
-- the website receives the score (POST /api/widget/live/score, authorised by
-- a short-lived key for one member and one round) and writes it with this
-- function, as the service role.
--
-- Deliberately narrower than live_round_set_score():
--   * only the member's OWN player row in the round — never a partner's or
--     an opponent's, even where the app would let them mark it;
--   * only rounds where each player plays their own ball: no scramble team,
--     no foursomes pair (scramble_size), no foursomes or greensomes match;
--   * only while the round is live, on a hole that is on its card.
-- Everything else (the broadcast ping, entered_by) is exactly as an in-app
-- score.
--
-- Callable by the service role only: it takes the member as a parameter, so
-- it must never be reachable with a member's or the publishable key.
--
-- Rollback:
--   drop function if exists public.live_round_set_own_score(uuid, bigint, smallint, smallint, boolean);

create or replace function public.live_round_set_own_score(
  p_member uuid,
  p_round_id bigint,
  p_hole smallint,
  p_strokes smallint,
  p_clear boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_player bigint;
  v_round public.live_rounds%rowtype;
begin
  if p_member is null then
    raise exception 'No member' using errcode = '42501';
  end if;
  select * into v_round from public.live_rounds where id = p_round_id;
  if not found then
    raise exception 'No such round' using errcode = '22023';
  end if;
  if v_round.status <> 'live' then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if v_round.scramble_size is not null
     or coalesce(v_round.match_type, 'singles') in ('foursomes', 'greensomes') then
    raise exception 'This format is scored in the app' using errcode = '22023';
  end if;
  select id into v_player
    from public.live_round_players
   where round_id = p_round_id and member_id = p_member
   order by position
   limit 1;
  if v_player is null then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_round_holes where round_id = p_round_id and hole = p_hole) then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;
  if not p_clear and p_strokes is not null and (p_strokes < 1 or p_strokes > 20) then
    raise exception 'Strokes must be between 1 and 20' using errcode = '22023';
  end if;

  if p_clear then
    delete from public.live_round_scores where player_id = v_player and hole = p_hole;
  else
    insert into public.live_round_scores (player_id, hole, round_id, strokes, entered_by)
    values (v_player, p_hole, p_round_id, p_strokes, p_member)
    on conflict (player_id, hole) do update
      set strokes = excluded.strokes, entered_by = excluded.entered_by, updated_at = now();
  end if;
  return v_player;
end;
$$;

revoke all on function public.live_round_set_own_score(uuid, bigint, smallint, smallint, boolean) from public, anon, authenticated;
grant execute on function public.live_round_set_own_score(uuid, bigint, smallint, smallint, boolean) to service_role;
