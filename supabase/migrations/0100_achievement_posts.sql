-- Achievement posts (Oct 2026 feed redesign, phase 8).
--
-- A member can mark a round or hole post as an achievement — Hole in One,
-- Eagle, Personal Best, Broke 70 / 80 / 90 / 100 — in details.achievement.
-- It's a claim the member makes, never stamped by PinPals, and it must be
-- one the post's own numbers support:
--
--   hole_in_one  a hole scored 1 (on a round: the best hole)
--   eagle        a hole two under its par, and not a 1 (that's an ace)
--   breaking_N   a full eighteen under N
--   personal_best a full eighteen; the website checks it beats every earlier
--                round the member has posted (a check can't read other rows)
--
-- Also: an optional `club` on a hole post (the club for an ace).
-- Mirrors src/lib/achievements.ts and src/lib/post-details.ts. Redefines
-- post_details_valid() whole, as 0098/0099 did; every existing row passes.
--
-- Rollback: re-run 0099's post_details_valid(); drop function
-- public.post_hole_claim_ok(text, int, int).

-- An ace is a 1; an eagle is two under par and not a 1.
create or replace function public.post_hole_claim_ok(claim text, score int, par int)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case claim
    when 'hole_in_one' then score = 1
    when 'eagle' then score is not null and par is not null and score <> 1 and score = par - 2
    else false
  end;
$$;
revoke all on function public.post_hole_claim_ok(text, int, int) from public, anon;
grant execute on function public.post_hole_claim_ok(text, int, int) to authenticated, service_role;

create or replace function public.post_details_valid(p_kind text, d jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  k text;
  allowed text[];
  b jsonb;
begin
  if p_kind = 'general' then
    return d is null;
  end if;
  if d is null or jsonb_typeof(d) <> 'object' then
    return false;
  end if;
  if pg_column_size(d) > 2048 then
    return false;
  end if;

  allowed := case p_kind
    when 'round' then array['score','holes','course_par','tee','played_on','differential',
                            'fairways_hit','fairways_total','gir','putts','birdies','best_hole',
                            'front_nine','back_nine','longest_drive','tee_time_id','achievement']
    when 'hole'  then array['hole','par','yards','score','club','achievement']
    when 'shot'  then array['hole','shot_number','club','distance_yards','lie','result']
    else null
  end;
  if allowed is null then
    return false;
  end if;
  for k in select jsonb_object_keys(d) loop
    if not (k = any(allowed)) then
      return false;
    end if;
  end loop;

  if p_kind = 'round' then
    if not public.post_detail_int(d, 'score', 18, 200, true) then return false; end if;
    if d ? 'holes' and not (d->'holes' = '9'::jsonb or d->'holes' = '18'::jsonb) then return false; end if;
    if not public.post_detail_int(d, 'course_par', 27, 80, false) then return false; end if;
    if not public.post_detail_text(d, 'tee', 20) then return false; end if;
    if d ? 'played_on' then
      if jsonb_typeof(d->'played_on') <> 'string' or (d->>'played_on') !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
      begin
        if to_char((d->>'played_on')::date, 'YYYY-MM-DD') <> d->>'played_on' then return false; end if;
      exception when others then
        return false;
      end;
    end if;
    if d ? 'differential' then
      if jsonb_typeof(d->'differential') <> 'number'
         or (d->>'differential')::numeric not between -10 and 60 then return false; end if;
    end if;
    if not public.post_detail_int(d, 'fairways_hit', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'fairways_total', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'gir', 0, 18, false) then return false; end if;
    if not public.post_detail_int(d, 'putts', 0, 99, false) then return false; end if;
    if not public.post_detail_int(d, 'birdies', 0, 18, false) then return false; end if;
    -- 0099: the recap's nines (adding up to the score on 18 holes), longest
    -- drive, and the tee time it was (existence and "you played it" are
    -- checked by the website's createPost — a check constraint can't read
    -- other tables).
    if not public.post_detail_int(d, 'front_nine', 9, 99, false) then return false; end if;
    if not public.post_detail_int(d, 'back_nine', 9, 99, false) then return false; end if;
    if d ? 'front_nine' and d ? 'back_nine' and coalesce(d->>'holes', '18') <> '9'
       and (d->>'front_nine')::int + (d->>'back_nine')::int <> (d->>'score')::int then return false; end if;
    if not public.post_detail_int(d, 'longest_drive', 50, 450, false) then return false; end if;
    if not public.post_detail_int(d, 'tee_time_id', 1, 2147483647, false) then return false; end if;
    -- 0100: a claimed achievement must be one the round's numbers support
    -- (achievements.ts eligibleAchievements). Personal Best is checked
    -- against earlier rounds by the website; here only "a full 18".
    if d ? 'achievement' then
      if jsonb_typeof(d->'achievement') <> 'string' then return false; end if;
      if d->>'achievement' in ('hole_in_one', 'eagle') then
        if not (d ? 'best_hole') then return false; end if;
        if not public.post_hole_claim_ok(d->>'achievement',
                 (d->'best_hole'->>'score')::int, (d->'best_hole'->>'par')::int) then return false; end if;
      elsif d->>'achievement' = 'personal_best' then
        if coalesce(d->>'holes', '18') = '9' then return false; end if;
      elsif d->>'achievement' in ('breaking_70', 'breaking_80', 'breaking_90', 'breaking_100') then
        if coalesce(d->>'holes', '18') = '9' then return false; end if;
        if (d->>'score')::int >= substring(d->>'achievement' from 10)::int then return false; end if;
      else
        return false;
      end if;
    end if;
    if d ? 'fairways_hit' and d ? 'fairways_total'
       and (d->>'fairways_hit')::int > (d->>'fairways_total')::int then return false; end if;
    if d ? 'best_hole' then
      b := d->'best_hole';
      if jsonb_typeof(b) <> 'object' then return false; end if;
      for k in select jsonb_object_keys(b) loop
        if not (k = any(array['hole','par','score'])) then return false; end if;
      end loop;
      if not public.post_detail_int(b, 'hole', 1, 27, true) then return false; end if;
      if not public.post_detail_int(b, 'par', 3, 6, false) then return false; end if;
      if not public.post_detail_int(b, 'score', 1, 15, true) then return false; end if;
    end if;
    return true;
  end if;

  if p_kind = 'hole' then
    if d ? 'achievement' then
      if jsonb_typeof(d->'achievement') <> 'string'
         or d->>'achievement' not in ('hole_in_one', 'eagle')
         or not (d ? 'score')
         or not public.post_hole_claim_ok(d->>'achievement', (d->>'score')::int, (d->>'par')::int) then
        return false;
      end if;
    end if;
    return public.post_detail_int(d, 'hole', 1, 27, true)
       and public.post_detail_int(d, 'par', 3, 6, false)
       and public.post_detail_int(d, 'yards', 30, 800, false)
       and public.post_detail_int(d, 'score', 1, 15, false)
       and public.post_detail_text(d, 'club', 24);
  end if;

  -- shot
  if not (d ? 'club' or d ? 'distance_yards' or d ? 'result') then return false; end if;
  if d ? 'lie' and not (jsonb_typeof(d->'lie') = 'string'
      and d->>'lie' = any(array['tee','fairway','rough','bunker','fringe','green','recovery'])) then return false; end if;
  return public.post_detail_int(d, 'hole', 1, 27, false)
     and public.post_detail_int(d, 'shot_number', 1, 15, false)
     and public.post_detail_text(d, 'club', 24)
     and public.post_detail_int(d, 'distance_yards', 1, 450, false)
     and public.post_detail_text(d, 'result', 40);
end;
$$;
