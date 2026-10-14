-- 0146: one card for the whole day.
--
-- A society day (match day, fourball day, scramble or foursomes day) is many
-- live_rounds at one course, each with its own copy of the card in
-- live_round_holes. Until now a par or stroke index entered on one group's
-- card stayed on that card, so on 14 Oct (day 33, Portmarnock Links,
-- foursomes Stableford) pair 1 entered 17 indexes and pairs 2-4 still showed
-- "SI not set".
--
-- live_round_set_hole now writes the hole to every round still live in the
-- same day. If another card has that index on a different hole (entered
-- differently earlier), that hole's index is cleared on that card, so every
-- card ends up the same and nobody gets a duplicate index. The existing
-- live_round_holes_broadcast trigger tells each group's phones to re-fetch.
--
-- Same signature, so the grants in the function-grants register still apply.

create or replace function public.live_round_set_hole(p_round_id bigint, p_hole smallint, p_par smallint, p_stroke_index smallint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_taken smallint;
  v_day bigint;
begin
  if not public.can_score_live_round(p_round_id) then
    raise exception 'Not your round' using errcode = '42501';
  end if;
  select match_day_id into v_day from public.live_rounds where id = p_round_id and status = 'live';
  if not found then
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

  if v_day is not null then
    -- The rest of the day's cards: free the index where another hole has it…
    if p_stroke_index is not null then
      update public.live_round_holes h
         set stroke_index = null
        from public.live_rounds r
       where r.match_day_id = v_day and r.status = 'live' and r.id <> p_round_id
         and h.round_id = r.id and h.hole <> p_hole and h.stroke_index = p_stroke_index;
    end if;
    -- …then set this hole, only where it differs (each change broadcasts).
    update public.live_round_holes h
       set par = p_par, stroke_index = p_stroke_index
      from public.live_rounds r
     where r.match_day_id = v_day and r.status = 'live' and r.id <> p_round_id
       and h.round_id = r.id and h.hole = p_hole
       and (h.par is distinct from p_par or h.stroke_index is distinct from p_stroke_index);
  end if;
end;
$$;
