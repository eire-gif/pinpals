-- 0185 — Score the whole group from a watch (Oct 2026)
--
-- Watch v2 (claude/watch-v2.md). Eire, 22 Oct 2026: anyone the app already
-- lets score the group can score it from the wrist too — not just a
-- designated marker. So this is the app's own rule, can_score_live_round()
-- (0104): the round's creator, its match day's organiser, or anyone playing
-- in it — with the member passed in, because the watch has no Supabase
-- session. It's called by the website as the service role, after checking the
-- signed lock-screen key (src/lib/live-score-token.ts) that names the member
-- and the round. The grant is the boundary, as for live_round_set_own_score
-- (0155).
--
-- p_scores: [{ "player_id": 12, "strokes": 5 }, { "player_id": 13, "strokes": null }, …]
--   strokes null = picked up, as in the app; "clear": true removes the score.
--   At most 8 entries. A player who isn't in this round is skipped, not an
--   error, so one stale row can't cost the rest of the group their scores.
-- Returns the player ids written, in the order given.
--
-- Pairs, scramble teams and foursomes/greensomes matches keep one card per
-- side; the watch only offers the group page where everyone plays their own
-- ball, but nothing here depends on that — it writes the rows it's given, as
-- live_round_set_score() does for the app.
--
-- No drop statements.
--
-- Applied to production 22 Oct 2026.
--
-- Rollback:
--   drop function if exists public.live_round_set_scores_as(uuid, bigint, smallint, jsonb);

create or replace function public.live_round_set_scores_as(
  p_member uuid,
  p_round_id bigint,
  p_hole smallint,
  p_scores jsonb
)
returns bigint[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round public.live_rounds%rowtype;
  v_day_owner uuid;
  v_item jsonb;
  v_player bigint;
  v_strokes smallint;
  v_clear boolean;
  v_saved bigint[] := '{}';
begin
  if p_member is null then
    raise exception 'No member' using errcode = '42501';
  end if;
  select * into v_round from public.live_rounds where id = p_round_id;
  if not found then
    raise exception 'No such round' using errcode = '22023';
  end if;
  if v_round.match_day_id is not null then
    select created_by into v_day_owner from public.live_match_days where id = v_round.match_day_id;
  end if;
  -- can_score_live_round(), for this member. coalesce: a round with no match
  -- day (or no creator) gives NULL, and NOT NULL would let anyone through.
  if not coalesce(
    v_round.created_by = p_member
    or v_day_owner = p_member
    or exists (select 1 from public.live_round_players where round_id = p_round_id and member_id = p_member),
    false
  ) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  if v_round.status <> 'live' then
    raise exception 'This round has finished' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.live_round_holes where round_id = p_round_id and hole = p_hole) then
    raise exception 'No such hole in this round' using errcode = '22023';
  end if;
  if p_scores is null or jsonb_typeof(p_scores) <> 'array' or jsonb_array_length(p_scores) = 0 or jsonb_array_length(p_scores) > 8 then
    raise exception 'Between 1 and 8 scores' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_scores) loop
    if jsonb_typeof(v_item) <> 'object' or coalesce(jsonb_typeof(v_item -> 'player_id'), 'missing') <> 'number' then
      raise exception 'Each score needs a player_id' using errcode = '22023';
    end if;
    v_player := (v_item ->> 'player_id')::bigint;
    v_clear := coalesce((v_item ->> 'clear')::boolean, false);
    if jsonb_typeof(v_item -> 'strokes') = 'number' then
      v_strokes := (v_item ->> 'strokes')::numeric::smallint;
      if v_strokes < 1 or v_strokes > 20 or (v_item ->> 'strokes')::numeric <> v_strokes then
        raise exception 'Strokes must be between 1 and 20' using errcode = '22023';
      end if;
    elsif v_item -> 'strokes' is null or jsonb_typeof(v_item -> 'strokes') = 'null' then
      v_strokes := null;
      if not v_clear and not (v_item ? 'strokes') then
        raise exception 'Each score needs strokes (or null for picked up)' using errcode = '22023';
      end if;
    else
      raise exception 'Strokes must be a number or null' using errcode = '22023';
    end if;

    if not exists (select 1 from public.live_round_players where id = v_player and round_id = p_round_id) then
      continue;
    end if;

    if v_clear then
      delete from public.live_round_scores where player_id = v_player and hole = p_hole;
    else
      insert into public.live_round_scores (player_id, hole, round_id, strokes, entered_by)
      values (v_player, p_hole, p_round_id, v_strokes, p_member)
      on conflict (player_id, hole) do update
        set strokes = excluded.strokes, entered_by = excluded.entered_by, updated_at = now();
    end if;
    v_saved := v_saved || v_player;
  end loop;

  return v_saved;
end;
$$;

revoke all on function public.live_round_set_scores_as(uuid, bigint, smallint, jsonb) from public, anon, authenticated;
grant execute on function public.live_round_set_scores_as(uuid, bigint, smallint, jsonb) to service_role;
