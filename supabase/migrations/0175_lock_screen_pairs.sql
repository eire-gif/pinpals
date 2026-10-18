-- 0175 — Score a pair's or team's card from the lock screen (Oct 2026)
--
-- Eire, 18 Oct 2026, on a greensomes test day: the lock screen card didn't
-- appear. 0155 kept the lock screen to formats where everyone plays their own
-- ball. A foursomes or greensomes pair, or a scramble team (scramble_size set),
-- is one ball with one card, kept on the team's first player (lowest
-- position) — the same row the app scores. Any player in the team can score
-- that card in the app, so they can from the lock screen too.
--
-- live_round_set_own_score() now, for a team round, writes the team's card
-- (its first player's row) when the named member is one of its players.
-- Foursomes and greensomes MATCHES (two sides in one round, match_type) stay
-- in the app: which side's card is whose isn't something the lock screen
-- can show yet.
--
-- CREATE OR REPLACE keeps the grant (service role only, 0155).
--
-- Applied to production 18 Oct 2026.
--
-- Rollback: recreate the function from 0155.

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
  if coalesce(v_round.match_type, 'singles') in ('foursomes', 'greensomes') then
    raise exception 'This format is scored in the app' using errcode = '22023';
  end if;
  if not exists (select 1 from public.live_round_players where round_id = p_round_id and member_id = p_member) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if v_round.scramble_size is not null then
    -- A pair or team: one card, on its first player.
    select id into v_player
      from public.live_round_players
     where round_id = p_round_id
     order by position
     limit 1;
  else
    select id into v_player
      from public.live_round_players
     where round_id = p_round_id and member_id = p_member
     order by position
     limit 1;
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
