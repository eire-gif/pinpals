-- Events for crews and trips (Oct 2026).
--
-- Societies have had Events (0125 outings, 0126 itineraries, 0127 payment
-- details). Crews and trips now get the same: a day out, an overnight or a
-- trip abroad, entries, the draw, the itinerary and how to pay.
--
-- Only save_outing() checked the group's kind; every other outing function
-- goes by the outing's group and outing_officer() (owner or admin), which
-- already means "whoever runs it" in a crew or trip. So this is 0127's
-- save_outing() with one change: kind in ('society', 'crew', 'trip')
-- instead of 'society' only — plus wording that isn't society-specific.
--
-- Rollback: re-run 0127's save_outing().

create or replace function public.save_outing(p_group_id bigint, p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_kind text := coalesce(nullif(p ->> 'kind', ''), 'day');
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_course text := nullif(btrim(coalesce(p ->> 'course_name', '')), '');
  v_location text := nullif(btrim(coalesce(p ->> 'location', '')), '');
  v_revtag text := nullif(lower(regexp_replace(btrim(coalesce(p ->> 'pay_revtag', '')), '^@', '')), '');
  v_iban text := nullif(upper(regexp_replace(coalesce(p ->> 'pay_iban', ''), '\s', '', 'g')), '');
  v_account text := nullif(btrim(coalesce(p ->> 'pay_account_name', '')), '');
  v_cash boolean := coalesce((p ->> 'pay_cash')::boolean, true);
  v_pay_note text := nullif(btrim(coalesce(p ->> 'pay_note', '')), '');
  v_date date;
  v_end date;
  v_tee time;
  v_details text := nullif(btrim(coalesce(p ->> 'details', '')), '');
  v_fee integer := nullif(p ->> 'entry_fee_cents', '')::integer;
  v_max integer := nullif(p ->> 'max_entries', '')::integer;
  v_id bigint;
begin
  if not public.outing_officer(p_group_id, me) then
    raise exception 'Only whoever runs the group can set up events.' using errcode = '42501';
  end if;
  if coalesce((select kind from public.groups where id = p_group_id and hidden_at is null), '') not in ('society', 'crew', 'trip') then
    raise exception 'Events are for societies, crews and trips.';
  end if;
  if v_kind not in ('day', 'overnight', 'abroad') then
    raise exception 'Choose a day out, overnight or abroad.';
  end if;
  begin
    v_date := (p ->> 'plays_on')::date;
    v_end := nullif(p ->> 'ends_on', '')::date;
    v_tee := nullif(p ->> 'first_tee', '')::time;
  exception when others then
    raise exception 'That date or time doesn''t look right.';
  end;
  if char_length(v_title) = 0 then raise exception 'Give the outing a name.'; end if;
  if char_length(v_title) > 80 then raise exception 'That name is too long — 80 characters at most.'; end if;
  if v_date is null then raise exception 'Choose the date.'; end if;
  if v_date < (now() at time zone 'Europe/Dublin')::date then raise exception 'That date has passed.'; end if;
  if v_date > (now() at time zone 'Europe/Dublin')::date + 730 then raise exception 'Outings can be set up to two years ahead.'; end if;
  if v_kind = 'day' then
    if v_course is null then raise exception 'Choose the course.'; end if;
    v_end := null;
    v_location := null;
  else
    if v_end is null then raise exception 'Choose the last day of the trip.'; end if;
    if v_end <= v_date then raise exception 'The last day is after the first.'; end if;
    if v_end > v_date + 20 then raise exception 'A trip is three weeks at most.'; end if;
  end if;
  if v_course is not null and char_length(v_course) > 120 then raise exception 'That course name is too long.'; end if;
  if v_location is not null and char_length(v_location) > 120 then raise exception 'That place is too long — 120 characters at most.'; end if;
  if v_details is not null and char_length(v_details) > 1000 then raise exception 'The details are too long — 1,000 characters at most.'; end if;
  if v_fee is not null and (v_fee < 0 or v_fee > 100000) then raise exception 'The entry fee is between €0 and €1,000.'; end if;
  if v_max is not null and (v_max < 1 or v_max > 500) then raise exception 'Places are between 1 and 500.'; end if;
  if v_revtag is not null and v_revtag !~ '^[a-z0-9._-]{2,40}$' then
    raise exception 'That Revolut username doesn''t look right — it''s the @name in Revolut, without spaces.';
  end if;
  if v_iban is not null and v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then
    raise exception 'That IBAN doesn''t look right.';
  end if;
  if v_account is not null and char_length(v_account) > 70 then raise exception 'That account name is too long.'; end if;
  if v_pay_note is not null and char_length(v_pay_note) > 200 then raise exception 'The payment note is too long — 200 characters at most.'; end if;
  if v_iban is not null and v_account is null then raise exception 'Add the name on the bank account.'; end if;

  if p_id is null then
    if (select count(*) from public.society_outings where group_id = p_group_id and plays_on >= current_date) >= 60 then
      raise exception 'That''s a lot of outings ahead — 60 at most.';
    end if;
    insert into public.society_outings (group_id, kind, title, club_id, course_name, plays_on, ends_on, location,
                                        first_tee, details, entry_fee_cents, max_entries, created_by,
                                        pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note)
    values (p_group_id, v_kind, v_title, case when v_course is null then null else nullif(p ->> 'club_id', '')::bigint end,
            v_course, v_date, v_end, v_location, v_tee, v_details, v_fee, v_max, me,
            v_revtag, v_iban, v_account, v_cash, v_pay_note)
    returning id into v_id;
    return v_id;
  end if;

  if exists (select 1 from public.society_outing_items i where i.outing_id = p_id) then
    if v_kind = 'day' then
      raise exception 'This trip has an itinerary — remove it before making it a day out.';
    end if;
    if exists (select 1 from public.society_outing_items i where i.outing_id = p_id and (i.on_date < v_date or i.on_date > v_end)) then
      raise exception 'Some of the itinerary is on days outside the new dates — move or remove it first.';
    end if;
  end if;

  update public.society_outings
     set kind = v_kind,
         title = v_title,
         club_id = case when v_course is null then null else nullif(p ->> 'club_id', '')::bigint end,
         course_name = v_course,
         plays_on = v_date,
         ends_on = v_end,
         location = v_location,
         first_tee = v_tee,
         details = v_details,
         entry_fee_cents = v_fee,
         max_entries = v_max,
         pay_revtag = v_revtag,
         pay_iban = v_iban,
         pay_account_name = v_account,
         pay_cash = v_cash,
         pay_note = v_pay_note
   where id = p_id and group_id = p_group_id and status = 'open'
   returning id into v_id;
  if v_id is null then raise exception 'That outing can''t be changed.'; end if;
  return v_id;
end;
$$;
revoke all on function public.save_outing(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_outing(bigint, bigint, jsonb) to authenticated;
