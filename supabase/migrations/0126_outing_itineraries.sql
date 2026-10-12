-- Trip itineraries for society outings (12 Oct 2026).
-- Design: claude/outing-itineraries.md. Builds on 0125 (society outings).
--
-- WHAT CHANGES
--
--   An outing is now one of three kinds:
--     day        one course, one day (everything 0125 already did)
--     overnight  two or more days in Ireland, with somewhere to stay
--     abroad     the same, plus flights and transfers
--
--   An overnight or abroad outing (a "trip") has a last day (ends_on), an
--   optional place (location, e.g. "Vale do Lobo, Portugal") and an
--   itinerary: a list of things on each day of the trip.
--
--     round     a course, a first tee and the gap between groups; who plays
--               in which group (slot = tee group, in tee order)
--     flight    from, to, departs, lands, airline; who is on it
--     stay      a hotel or house, check-in day and nights; who is in which
--               room (slot = room)
--     transfer  a bus or taxis; who is on it
--     meal      a dinner or lunch
--     note      anything else on a day
--
--   Entries, payments and "join until midnight before the first day" are
--   0125's, unchanged. A trip's draw lives on each round, not on the outing.
--
-- WHO SEES WHAT
--
--   - The itinerary and who is on what: the society's members (through the
--     outing's own policy, exactly as 0125's entries do).
--   - Booking references are NOT stored. They stay with each member.
--   - Only the captain, secretary or owner changes the itinerary, and only
--     through the functions below.
--   - Only people entered in the trip can be put on a flight, in a room or
--     in a group. Cancelling your place takes you off all of them.
--
-- LINKS TO PROFILES. society_outing_item_people has exactly one foreign key
-- to profiles (the 0123 lesson).
--
-- Rollback:
--   drop table if exists public.society_outing_item_people, public.society_outing_items;
--   drop function if exists public.save_outing_item(bigint, bigint, jsonb), public.delete_outing_item(bigint),
--     public.set_outing_item_people(bigint, jsonb), public.outing_entry_left();
--   alter table public.society_outings drop constraint if exists society_outings_kind_shape,
--     drop column if exists kind, drop column if exists ends_on, drop column if exists location;
--   (and restore 0125's save_outing and the not-null on course_name)


-- ============ The outing: kind, last day, place ============

alter table public.society_outings
  add column if not exists kind text not null default 'day' check (kind in ('day', 'overnight', 'abroad')),
  add column if not exists ends_on date,
  add column if not exists location text check (location is null or char_length(btrim(location)) between 1 and 120);

-- A trip's courses are on its rounds, so it needs no single course.
alter table public.society_outings alter column course_name drop not null;

alter table public.society_outings drop constraint if exists society_outings_kind_shape;
alter table public.society_outings add constraint society_outings_kind_shape check (
  (kind = 'day' and ends_on is null and course_name is not null)
  or (kind <> 'day' and ends_on is not null and ends_on > plays_on and ends_on <= plays_on + 20)
);


-- ============ The itinerary ============

create table if not exists public.society_outing_items (
  id bigint generated always as identity primary key,
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  on_date date not null,
  kind text not null check (kind in ('round', 'flight', 'stay', 'transfer', 'meal', 'note')),
  starts_at time,
  ends_at time,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  details text check (details is null or char_length(details) <= 1000),
  -- A round's course, or a stay's nearest club (optional).
  club_id bigint references public.clubs (id) on delete set null,
  -- Flights and transfers: where from and to ("DUB", "Faro", "Hotel").
  from_place text check (from_place is null or char_length(btrim(from_place)) between 1 and 60),
  to_place text check (to_place is null or char_length(btrim(to_place)) between 1 and 60),
  -- Airline and flight number, or the bus company.
  carrier text check (carrier is null or char_length(btrim(carrier)) between 1 and 60),
  -- Stays: how many nights from on_date.
  nights smallint check (nights is null or nights between 1 and 30),
  -- Rounds: minutes between groups, and the format.
  tee_interval smallint check (tee_interval is null or tee_interval between 5 and 20),
  play_format text check (play_format is null or play_format in ('stableford', 'strokeplay', 'matchplay', 'scramble', 'fourball', 'foursomes')),
  created_at timestamptz not null default now()
);
create index if not exists society_outing_items_outing_idx on public.society_outing_items (outing_id, on_date, starts_at);

create table if not exists public.society_outing_item_people (
  item_id bigint not null references public.society_outing_items (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  -- A round: the tee group. A stay: the room. Flights and transfers: none.
  slot smallint check (slot is null or slot between 1 and 60),
  -- Order within the group or room.
  position smallint check (position is null or position between 1 and 8),
  primary key (item_id, member_id)
);
create index if not exists society_outing_item_people_member_idx on public.society_outing_item_people (member_id);

alter table public.society_outing_items enable row level security;
alter table public.society_outing_item_people enable row level security;

-- Whoever can see the outing (its society's members, 0125) sees its itinerary.
drop policy if exists "society members read itinerary" on public.society_outing_items;
create policy "society members read itinerary" on public.society_outing_items
  for select to authenticated
  using (exists (select 1 from public.society_outings o where o.id = outing_id));

drop policy if exists "society members read who is on what" on public.society_outing_item_people;
create policy "society members read who is on what" on public.society_outing_item_people
  for select to authenticated
  using (exists (select 1 from public.society_outing_items i where i.id = item_id));

revoke all on public.society_outing_items, public.society_outing_item_people from anon, authenticated;
grant select on public.society_outing_items, public.society_outing_item_people to authenticated;


-- ============ Setting up an outing (replaces 0125's) ============

-- p: { kind?, title, club_id?, course_name?, plays_on, ends_on?, location?,
--      first_tee?, details?, entry_fee_cents?, max_entries? }.
-- kind defaults to 'day', which needs a course and no last day. A trip
-- (overnight / abroad) needs a last day 1–20 days after the first.
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
  v_date date;
  v_end date;
  v_tee time;
  v_details text := nullif(btrim(coalesce(p ->> 'details', '')), '');
  v_fee integer := nullif(p ->> 'entry_fee_cents', '')::integer;
  v_max integer := nullif(p ->> 'max_entries', '')::integer;
  v_id bigint;
begin
  if not public.outing_officer(p_group_id, me) then
    raise exception 'Only the captain or secretary can set up outings.' using errcode = '42501';
  end if;
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Outings are for societies.';
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

  if p_id is null then
    if (select count(*) from public.society_outings where group_id = p_group_id and plays_on >= current_date) >= 60 then
      raise exception 'That''s a lot of outings ahead — 60 at most.';
    end if;
    insert into public.society_outings (group_id, kind, title, club_id, course_name, plays_on, ends_on, location,
                                        first_tee, details, entry_fee_cents, max_entries, created_by)
    values (p_group_id, v_kind, v_title, case when v_course is null then null else nullif(p ->> 'club_id', '')::bigint end,
            v_course, v_date, v_end, v_location, v_tee, v_details, v_fee, v_max, me)
    returning id into v_id;
    return v_id;
  end if;

  -- Changing a trip's dates or kind mustn't strand its itinerary.
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
         max_entries = v_max
   where id = p_id and group_id = p_group_id and status = 'open'
   returning id into v_id;
  if v_id is null then raise exception 'That outing can''t be changed.'; end if;
  return v_id;
end;
$$;
revoke all on function public.save_outing(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_outing(bigint, bigint, jsonb) to authenticated;


-- ============ The itinerary: adding, changing, removing ============

-- p: { on_date, kind, title, starts_at?, ends_at?, details?, club_id?,
--      from_place?, to_place?, carrier?, nights?, tee_interval?, play_format? }
-- With p_id, changes that item (its kind stays as it was).
create or replace function public.save_outing_item(p_outing_id bigint, p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_kind text := p ->> 'kind';
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_details text := nullif(btrim(coalesce(p ->> 'details', '')), '');
  v_from text := nullif(btrim(coalesce(p ->> 'from_place', '')), '');
  v_to text := nullif(btrim(coalesce(p ->> 'to_place', '')), '');
  v_carrier text := nullif(btrim(coalesce(p ->> 'carrier', '')), '');
  v_format text := nullif(p ->> 'play_format', '');
  v_date date;
  v_start time;
  v_end time;
  v_nights smallint;
  v_gap smallint;
  v_club bigint;
  v_id bigint;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can change the itinerary.' using errcode = '42501';
  end if;
  if o.kind = 'day' then raise exception 'Only overnight and abroad trips have an itinerary.'; end if;
  if o.status <> 'open' then raise exception 'This trip was cancelled.'; end if;
  if p_id is not null then
    select kind into v_kind from public.society_outing_items where id = p_id and outing_id = p_outing_id;
    if v_kind is null then raise exception 'That part of the itinerary has gone.'; end if;
  end if;
  if v_kind is null or v_kind not in ('round', 'flight', 'stay', 'transfer', 'meal', 'note') then
    raise exception 'Choose what to add.';
  end if;
  begin
    v_date := (p ->> 'on_date')::date;
    v_start := nullif(p ->> 'starts_at', '')::time;
    v_end := nullif(p ->> 'ends_at', '')::time;
    v_nights := nullif(p ->> 'nights', '')::smallint;
    v_gap := nullif(p ->> 'tee_interval', '')::smallint;
    v_club := nullif(p ->> 'club_id', '')::bigint;
  exception when others then
    raise exception 'A date, time or number doesn''t look right.';
  end;
  if v_date is null or v_date < o.plays_on or v_date > o.ends_on then
    raise exception 'Choose a day of the trip.';
  end if;
  if char_length(v_title) = 0 then
    raise exception '%', case v_kind when 'round' then 'Choose the course.' when 'stay' then 'Name the hotel or house.' else 'Give it a name.' end;
  end if;
  if char_length(v_title) > 120 then raise exception 'That name is too long — 120 characters at most.'; end if;
  if v_details is not null and char_length(v_details) > 1000 then raise exception 'The notes are too long — 1,000 characters at most.'; end if;
  if coalesce(char_length(v_from), 0) > 60 or coalesce(char_length(v_to), 0) > 60 then raise exception 'A place name is too long — 60 characters at most.'; end if;
  if v_carrier is not null and char_length(v_carrier) > 60 then raise exception 'That is too long — 60 characters at most.'; end if;

  -- Each kind keeps only what belongs to it.
  if v_kind = 'round' then
    v_gap := coalesce(v_gap, 10);
    if v_gap not between 5 and 20 then raise exception 'Groups go off 5 to 20 minutes apart.'; end if;
    if v_format is not null and v_format not in ('stableford', 'strokeplay', 'matchplay', 'scramble', 'fourball', 'foursomes') then
      raise exception 'Choose a format.';
    end if;
    v_from := null; v_to := null; v_carrier := null; v_nights := null; v_end := null;
  elsif v_kind = 'flight' then
    if v_from is null or v_to is null then raise exception 'Say where the flight is from and to.'; end if;
    v_club := null; v_nights := null; v_gap := null; v_format := null;
  elsif v_kind = 'stay' then
    v_nights := coalesce(v_nights, 1);
    if v_nights not between 1 and 30 then raise exception 'A stay is 1 to 30 nights.'; end if;
    if v_date + v_nights > o.ends_on + 1 then raise exception 'That stay runs past the end of the trip.'; end if;
    v_from := null; v_to := null; v_carrier := null; v_gap := null; v_format := null; v_end := null;
  elsif v_kind = 'transfer' then
    v_club := null; v_nights := null; v_gap := null; v_format := null;
  else
    v_club := null; v_from := null; v_to := null; v_carrier := null; v_nights := null; v_gap := null; v_format := null;
  end if;

  if p_id is null then
    if (select count(*) from public.society_outing_items where outing_id = p_outing_id) >= 200 then
      raise exception 'That''s a full itinerary — 200 items at most.';
    end if;
    insert into public.society_outing_items (outing_id, on_date, kind, starts_at, ends_at, title, details, club_id,
                                             from_place, to_place, carrier, nights, tee_interval, play_format)
    values (p_outing_id, v_date, v_kind, v_start, v_end, v_title, v_details, v_club,
            v_from, v_to, v_carrier, v_nights, v_gap, v_format)
    returning id into v_id;
    return v_id;
  end if;

  update public.society_outing_items
     set on_date = v_date, starts_at = v_start, ends_at = v_end, title = v_title, details = v_details,
         club_id = v_club, from_place = v_from, to_place = v_to, carrier = v_carrier, nights = v_nights,
         tee_interval = v_gap, play_format = v_format
   where id = p_id and outing_id = p_outing_id
   returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.save_outing_item(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_outing_item(bigint, bigint, jsonb) to authenticated;

create or replace function public.delete_outing_item(p_item_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group bigint := (select o.group_id from public.society_outing_items i join public.society_outings o on o.id = i.outing_id where i.id = p_item_id);
begin
  if v_group is null or not public.outing_officer(v_group, (select auth.uid())) then
    raise exception 'Only the captain or secretary can change the itinerary.' using errcode = '42501';
  end if;
  delete from public.society_outing_items where id = p_item_id;
end;
$$;
revoke all on function public.delete_outing_item(bigint) from public, anon, authenticated;
grant execute on function public.delete_outing_item(bigint) to authenticated;

-- p_people: [{ member: uuid, slot?: n }, …]. Replaces who is on the item.
--   round     slot (tee group) 1–60 for everyone; at most 8 to a group
--   stay      slot (room) 1–60 for everyone; at most 8 to a room
--   flight, transfer   no slot
--   meal, note         nobody (they're for the whole trip)
-- Only people entered in the trip, each once. Order in the list is the order
-- within the group or room.
create or replace function public.set_outing_item_people(p_item_id bigint, p_people jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  i public.society_outing_items%rowtype;
  o public.society_outings%rowtype;
  v_row jsonb;
  v_member uuid;
  v_slot smallint;
  v_seen uuid[] := '{}';
  v_counts integer[] := array_fill(0, array[60]);
begin
  select * into i from public.society_outing_items where id = p_item_id;
  if found then select * into o from public.society_outings where id = i.outing_id; end if;
  if i.id is null or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can change the itinerary.' using errcode = '42501';
  end if;
  if o.status <> 'open' then raise exception 'This trip was cancelled.'; end if;
  if jsonb_typeof(p_people) <> 'array' then raise exception 'That list doesn''t look right.'; end if;
  if i.kind in ('meal', 'note') and jsonb_array_length(p_people) > 0 then
    raise exception 'That''s for everyone on the trip.';
  end if;
  if jsonb_array_length(p_people) > 500 then raise exception 'That''s too many people.'; end if;

  delete from public.society_outing_item_people where item_id = p_item_id;

  for v_row in select * from jsonb_array_elements(p_people) loop
    begin
      v_member := (v_row ->> 'member')::uuid;
      v_slot := nullif(v_row ->> 'slot', '')::smallint;
    exception when others then
      raise exception 'That list doesn''t look right.';
    end;
    if v_member is null then raise exception 'That list doesn''t look right.'; end if;
    if v_member = any (v_seen) then raise exception 'Someone is on the list twice.'; end if;
    v_seen := v_seen || v_member;
    if not exists (select 1 from public.society_outing_entries e where e.outing_id = o.id and e.member_id = v_member) then
      raise exception 'Only people on the trip can be added.';
    end if;
    if i.kind in ('round', 'stay') then
      if v_slot is null or v_slot not between 1 and 60 then
        raise exception '%', case i.kind when 'round' then 'Put everyone in a group.' else 'Put everyone in a room.' end;
      end if;
      v_counts[v_slot] := v_counts[v_slot] + 1;
      if v_counts[v_slot] > 8 then
        raise exception '%', case i.kind when 'round' then 'A group has 8 players at most.' else 'A room has 8 people at most.' end;
      end if;
      insert into public.society_outing_item_people (item_id, member_id, slot, position)
      values (p_item_id, v_member, v_slot, v_counts[v_slot]);
    else
      insert into public.society_outing_item_people (item_id, member_id) values (p_item_id, v_member);
    end if;
  end loop;
end;
$$;
revoke all on function public.set_outing_item_people(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.set_outing_item_people(bigint, jsonb) to authenticated;


-- ============ Leaving the trip takes you off everything on it ============

create or replace function public.outing_entry_left()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.society_outing_item_people p
   using public.society_outing_items i
   where p.item_id = i.id and i.outing_id = old.outing_id and p.member_id = old.member_id;
  return old;
end;
$$;
revoke all on function public.outing_entry_left() from public, anon, authenticated;

drop trigger if exists outing_entry_left on public.society_outing_entries;
create trigger outing_entry_left
  after delete on public.society_outing_entries
  for each row execute function public.outing_entry_left();
