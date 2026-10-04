-- Round recaps (Oct 2026 feed redesign, phase 7).
--
-- A confirmed tee time whose date has passed is a completed round; the app
-- now offers to share it as a recap. The recap adds four optional keys to a
-- round's details:
--
--   front_nine, back_nine  9–99 each; on an 18-hole round they must add up
--                          to the score
--   longest_drive          50–450 yards
--   tee_time_id            the tee_time_invites row it was — so the app
--                          stops offering a recap once one is posted. The
--                          website's createPost checks the poster hosted or
--                          confirmed for that tee time; this function only
--                          checks the shape.
--
-- post_details_valid() is redefined whole, as 0098 did; every existing row
-- still passes. Mirrors src/lib/post-details.ts.
--
-- Rollback: re-run 0098's definition (no row can carry these keys until this
-- is applied).

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
                            'front_nine','back_nine','longest_drive','tee_time_id']
    when 'hole'  then array['hole','par','yards','score']
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
    return public.post_detail_int(d, 'hole', 1, 27, true)
       and public.post_detail_int(d, 'par', 3, 6, false)
       and public.post_detail_int(d, 'yards', 30, 800, false)
       and public.post_detail_int(d, 'score', 1, 15, false);
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
