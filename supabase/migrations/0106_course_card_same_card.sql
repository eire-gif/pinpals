-- 0106 — saving a course card that is already on file
--
-- Tester report, 7 Oct 2026: two members played Adare Manor (Whites). The
-- round's starter saved the card; when the other tapped "Save this card"
-- for the same round, course_card_save refused it as an overwrite and the
-- app said "Please try again". The cards were identical hole for hole.
--
-- Now an identical card from anyone is a no-op that returns the card's id.
-- A *different* card for the same tees still can't overwrite someone else's
-- or a verified one; the message now says it differs. Same signature, same
-- grants (create or replace keeps them).

create or replace function public.course_card_save(
  p_club_id bigint,
  p_tee_name text,
  p_holes smallint,
  p_par_total smallint,
  p_course_rating numeric,
  p_slope smallint,
  p_card jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_card_id bigint;
  v_verified timestamptz;
  v_by uuid;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and deleted_at is null) then
    raise exception 'Sign in to save a card' using errcode = '42501';
  end if;
  if p_holes not in (9, 18) or jsonb_typeof(p_card) <> 'array' or jsonb_array_length(p_card) <> p_holes then
    raise exception 'The card must have one entry for each hole' using errcode = '22023';
  end if;
  -- Every hole numbered once, every stroke index present and different.
  if (select count(distinct (h ->> 'hole')::int) from jsonb_array_elements(p_card) h
       where (h ->> 'hole')::int between 1 and p_holes) <> p_holes
     or (select count(distinct (h ->> 'stroke_index')::int) from jsonb_array_elements(p_card) h
          where (h ->> 'stroke_index')::int between 1 and 18) <> p_holes then
    raise exception 'Each hole needs its own stroke index' using errcode = '22023';
  end if;

  select id, verified_at, submitted_by into v_card_id, v_verified, v_by
    from public.course_cards
   where club_id = p_club_id and lower(btrim(tee_name)) = lower(btrim(p_tee_name)) and holes = p_holes;

  if v_card_id is not null then
    if v_verified is not null or v_by is distinct from v_me then
      -- Someone else's card. The same card again is not an overwrite: the
      -- second player in a group to tap "Save this card" gets a quiet yes.
      if (select count(*) from public.course_card_holes ch
            join jsonb_array_elements(p_card) h on (h ->> 'hole')::smallint = ch.hole
           where ch.card_id = v_card_id
             and ch.par = (h ->> 'par')::smallint
             and ch.stroke_index = (h ->> 'stroke_index')::smallint) = p_holes
         and (select count(*) from public.course_card_holes where card_id = v_card_id) = p_holes then
        return v_card_id;
      end if;
      raise exception 'A different card for these tees is already on file' using errcode = 'P0001';
    end if;
    update public.course_cards
       set par_total = p_par_total, course_rating = p_course_rating, slope = p_slope, updated_at = now()
     where id = v_card_id;
  else
    insert into public.course_cards (club_id, tee_name, holes, par_total, course_rating, slope, source, submitted_by)
    values (p_club_id, btrim(p_tee_name), p_holes, p_par_total, p_course_rating, p_slope, 'member', v_me)
    returning id into v_card_id;
  end if;

  -- Same tees, same number of holes: every hole is replaced in place.
  insert into public.course_card_holes (card_id, hole, par, stroke_index)
  select v_card_id, (h ->> 'hole')::smallint, (h ->> 'par')::smallint, (h ->> 'stroke_index')::smallint
    from jsonb_array_elements(p_card) h
  on conflict (card_id, hole) do update set par = excluded.par, stroke_index = excluded.stroke_index;

  return v_card_id;
end;
$$;
