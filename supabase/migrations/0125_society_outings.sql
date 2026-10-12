-- Society outings: events, entries, the draw and who has paid (12 Oct 2026).
-- Design: claude/society-outings.md (step 2 of claude/society-entry-fees.md).
--
-- WHAT A SOCIETY DOES
--
--   1. The captain or secretary (or the owner) sets up an outing: name,
--      course, date, first tee, entry fee and what it covers.
--   2. Members join it, or cancel, until midnight at the start of the day
--      (Irish time) — "by the evening before". After that only an officer
--      can add or take someone off.
--   3. An officer makes the draw and publishes the tee times; each member
--      sees their own tee time and who they're playing with. Publishing
--      again replaces the draw.
--   4. On the day an officer starts the round (the 0121 society day); the
--      outing remembers which live day it became.
--   5. Officers mark who has paid (cash, transfer, or waived). Card payment
--      comes later (Stripe Connect for societies), and only the webhook will
--      ever set 'card'.
--
-- WHO SEES WHAT
--
--   - Outings and entries (who's in, and the draw): the society's members.
--   - Payments: your own, and the officers see everyone's. Other members
--     never see who has paid (claude/society-entry-fees.md).
--   - Every write goes through the functions below.
--
-- LINKS TO PROFILES. Each table has at most one foreign key to profiles:
-- two make the app's profile:profiles(...) embeds ambiguous (see 0123).
--
-- Rollback:
--   drop table if exists public.society_outing_payments, public.society_outing_entries, public.society_outings;
--   …and the functions below.


-- ============ Tables ============

create table if not exists public.society_outings (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  club_id bigint references public.clubs (id) on delete set null,
  course_name text not null check (char_length(btrim(course_name)) between 1 and 120),
  plays_on date not null,
  first_tee time,
  details text check (details is null or char_length(details) <= 1000),
  entry_fee_cents integer check (entry_fee_cents is null or entry_fee_cents between 0 and 100000),
  max_entries integer check (max_entries is null or max_entries between 1 and 500),
  status text not null default 'open' check (status in ('open', 'cancelled')),
  draw_published_at timestamptz,
  -- The live day it became on the day (0121). Set by link_outing_match_day.
  match_day_id bigint references public.live_match_days (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists society_outings_group_idx on public.society_outings (group_id, plays_on);

create table if not exists public.society_outing_entries (
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  entered_at timestamptz not null default now(),
  -- The published draw: which tee group, at what time, in what order.
  tee_group smallint check (tee_group is null or tee_group between 1 and 60),
  tee_time time,
  tee_position smallint check (tee_position is null or tee_position between 1 and 8),
  primary key (outing_id, member_id)
);
create index if not exists society_outing_entries_member_idx on public.society_outing_entries (member_id);

create table if not exists public.society_outing_payments (
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  status text not null check (status in ('cash', 'transfer', 'card', 'waived')),
  -- Who marked it. No foreign key on purpose (see LINKS TO PROFILES).
  marked_by uuid,
  marked_at timestamptz not null default now(),
  primary key (outing_id, member_id)
);

alter table public.society_outings enable row level security;
alter table public.society_outing_entries enable row level security;
alter table public.society_outing_payments enable row level security;


-- ============ Helpers ============

-- Members join or cancel until midnight at the start of the day, Irish time.
create or replace function public.outing_entries_close_at(p_plays_on date)
returns timestamptz
language sql
stable
set search_path = public
as $$
  select (p_plays_on::timestamp) at time zone 'Europe/Dublin';
$$;
grant execute on function public.outing_entries_close_at(date) to authenticated;

-- Owner or officer (role owner/admin; in a society the admins are its
-- captain and secretary, 0122).
create or replace function public.outing_officer(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.group_role(p_group_id, p_user_id) in ('owner', 'admin'), false);
$$;
revoke all on function public.outing_officer(bigint, uuid) from public, anon, authenticated;
grant execute on function public.outing_officer(bigint, uuid) to authenticated;


-- ============ Policies ============

drop policy if exists "society members read outings" on public.society_outings;
create policy "society members read outings" on public.society_outings
  for select to authenticated
  using (public.is_group_member(group_id, (select auth.uid())));

drop policy if exists "society members read entries" on public.society_outing_entries;
create policy "society members read entries" on public.society_outing_entries
  for select to authenticated
  using (exists (select 1 from public.society_outings o where o.id = outing_id));

-- Your own payment; officers see the society's.
drop policy if exists "own payment, or the officers" on public.society_outing_payments;
create policy "own payment, or the officers" on public.society_outing_payments
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (
      select 1 from public.society_outings o
       where o.id = outing_id and public.outing_officer(o.group_id, (select auth.uid()))
    )
  );

revoke all on public.society_outings, public.society_outing_entries, public.society_outing_payments from anon, authenticated;
grant select on public.society_outings, public.society_outing_entries, public.society_outing_payments to authenticated;


-- ============ Setting up an outing ============

-- p: { title, club_id?, course_name, plays_on, first_tee?, details?,
--      entry_fee_cents?, max_entries? }. With p_id, edits that outing.
create or replace function public.save_outing(p_group_id bigint, p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_course text := btrim(coalesce(p ->> 'course_name', ''));
  v_date date;
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
  begin
    v_date := (p ->> 'plays_on')::date;
    v_tee := nullif(p ->> 'first_tee', '')::time;
  exception when others then
    raise exception 'That date or time doesn''t look right.';
  end;
  if char_length(v_title) = 0 then raise exception 'Give the outing a name.'; end if;
  if char_length(v_title) > 80 then raise exception 'That name is too long — 80 characters at most.'; end if;
  if char_length(v_course) = 0 then raise exception 'Choose the course.'; end if;
  if v_date is null then raise exception 'Choose the date.'; end if;
  if v_date < (now() at time zone 'Europe/Dublin')::date then raise exception 'That date has passed.'; end if;
  if v_date > (now() at time zone 'Europe/Dublin')::date + 730 then raise exception 'Outings can be set up to two years ahead.'; end if;
  if v_details is not null and char_length(v_details) > 1000 then raise exception 'The details are too long — 1,000 characters at most.'; end if;
  if v_fee is not null and (v_fee < 0 or v_fee > 100000) then raise exception 'The entry fee is between €0 and €1,000.'; end if;
  if v_max is not null and (v_max < 1 or v_max > 500) then raise exception 'Places are between 1 and 500.'; end if;

  if p_id is null then
    if (select count(*) from public.society_outings where group_id = p_group_id and plays_on >= current_date) >= 60 then
      raise exception 'That''s a lot of outings ahead — 60 at most.';
    end if;
    insert into public.society_outings (group_id, title, club_id, course_name, plays_on, first_tee, details,
                                        entry_fee_cents, max_entries, created_by)
    values (p_group_id, v_title, nullif(p ->> 'club_id', '')::bigint, v_course, v_date, v_tee, v_details, v_fee, v_max, me)
    returning id into v_id;
    return v_id;
  end if;

  update public.society_outings
     set title = v_title,
         club_id = nullif(p ->> 'club_id', '')::bigint,
         course_name = v_course,
         plays_on = v_date,
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

create or replace function public.cancel_outing(p_outing_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group bigint := (select group_id from public.society_outings where id = p_outing_id);
begin
  if v_group is null or not public.outing_officer(v_group, (select auth.uid())) then
    raise exception 'Only the captain or secretary can cancel an outing.' using errcode = '42501';
  end if;
  update public.society_outings set status = 'cancelled' where id = p_outing_id;
end;
$$;
revoke all on function public.cancel_outing(bigint) from public, anon, authenticated;
grant execute on function public.cancel_outing(bigint) to authenticated;


-- ============ Joining and cancelling ============

-- p_in true: join; false: cancel. Members, until midnight at the start of
-- the day. p_member (an officer only): put someone else in or take them
-- off, at any time before the round starts.
create or replace function public.set_outing_entry(p_outing_id bigint, p_in boolean, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_who uuid := coalesce(p_member, (select auth.uid()));
  v_officer boolean;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.is_group_member(o.group_id, me) then
    raise exception 'That outing isn''t available.';
  end if;
  v_officer := public.outing_officer(o.group_id, me);
  if v_who <> me and not v_officer then
    raise exception 'Only the captain or secretary can add or remove someone else.' using errcode = '42501';
  end if;
  if o.status <> 'open' then
    raise exception 'This outing was cancelled.';
  end if;
  if o.match_day_id is not null then
    raise exception 'The round has started.';
  end if;
  if not v_officer and now() >= public.outing_entries_close_at(o.plays_on) then
    raise exception 'Entries closed at midnight — ask the captain or secretary.';
  end if;
  if not public.is_group_member(o.group_id, v_who) then
    raise exception 'They''re not in the society.';
  end if;

  if p_in then
    if exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = v_who) then
      return;
    end if;
    if o.max_entries is not null
       and (select count(*) from public.society_outing_entries where outing_id = p_outing_id) >= o.max_entries then
      raise exception 'The outing is full.';
    end if;
    insert into public.society_outing_entries (outing_id, member_id) values (p_outing_id, v_who);
  else
    delete from public.society_outing_entries where outing_id = p_outing_id and member_id = v_who;
  end if;
end;
$$;
revoke all on function public.set_outing_entry(bigint, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_outing_entry(bigint, boolean, uuid) to authenticated;


-- ============ The draw ============

-- p_groups: [{ tee_time?: "HH:MM", members: [uuid, …] }, …] in tee order.
-- Only people entered can be drawn; each once. Anyone entered and left out
-- is shown as not yet drawn. Publishing again replaces the draw.
create or replace function public.publish_outing_draw(p_outing_id bigint, p_groups jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_group jsonb;
  v_n smallint := 0;
  v_pos smallint;
  v_member uuid;
  v_seen uuid[] := '{}';
  v_time time;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can publish the draw.' using errcode = '42501';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if jsonb_typeof(p_groups) <> 'array' or jsonb_array_length(p_groups) not between 1 and 60 then
    raise exception 'A draw has between 1 and 60 groups.';
  end if;

  update public.society_outing_entries set tee_group = null, tee_time = null, tee_position = null
   where outing_id = p_outing_id;

  for v_group in select * from jsonb_array_elements(p_groups) loop
    v_n := v_n + 1;
    v_pos := 0;
    begin
      v_time := nullif(v_group ->> 'tee_time', '')::time;
    exception when others then
      raise exception 'A tee time doesn''t look right.';
    end;
    if jsonb_typeof(v_group -> 'members') <> 'array' or jsonb_array_length(v_group -> 'members') not between 1 and 8 then
      raise exception 'Each group has between 1 and 8 players.';
    end if;
    for v_member in select (x #>> '{}')::uuid from jsonb_array_elements(v_group -> 'members') x loop
      if v_member = any (v_seen) then raise exception 'Someone is in two groups.'; end if;
      v_seen := v_seen || v_member;
      v_pos := v_pos + 1;
      update public.society_outing_entries
         set tee_group = v_n, tee_time = v_time, tee_position = v_pos
       where outing_id = p_outing_id and member_id = v_member;
      if not found then raise exception 'Only people entered can be in the draw.'; end if;
    end loop;
  end loop;

  update public.society_outings set draw_published_at = now() where id = p_outing_id;
end;
$$;
revoke all on function public.publish_outing_draw(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.publish_outing_draw(bigint, jsonb) to authenticated;

-- On the day: remember the live day the outing became. The caller must have
-- created that day (0121's live_fourball_day_create / scramble).
create or replace function public.link_outing_match_day(p_outing_id bigint, p_match_day_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_group bigint := (select group_id from public.society_outings where id = p_outing_id);
begin
  if v_group is null or not public.outing_officer(v_group, me) then
    raise exception 'Only the captain or secretary can start the round.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.live_match_days where id = p_match_day_id and created_by = me) then
    raise exception 'That isn''t your round.';
  end if;
  update public.society_outings set match_day_id = p_match_day_id where id = p_outing_id;
end;
$$;
revoke all on function public.link_outing_match_day(bigint, bigint) from public, anon, authenticated;
grant execute on function public.link_outing_match_day(bigint, bigint) to authenticated;


-- ============ Who has paid ============

-- Officers: 'cash', 'transfer' or 'waived'; null clears it. 'card' is never
-- set here — only by the payment webhook, when card payments arrive.
create or replace function public.mark_outing_paid(p_outing_id bigint, p_member uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_group bigint := (select group_id from public.society_outings where id = p_outing_id);
begin
  if v_group is null or not public.outing_officer(v_group, me) then
    raise exception 'Only the captain or secretary can mark payments.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('cash', 'transfer', 'waived') then
    raise exception 'Mark it as cash, transfer or waived.';
  end if;
  if not exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = p_member) then
    raise exception 'They''re not entered.';
  end if;
  if (select status from public.society_outing_payments where outing_id = p_outing_id and member_id = p_member) = 'card' then
    raise exception 'They paid by card — that can only be changed by a refund.';
  end if;

  if p_status is null then
    delete from public.society_outing_payments where outing_id = p_outing_id and member_id = p_member;
  else
    insert into public.society_outing_payments (outing_id, member_id, status, marked_by)
    values (p_outing_id, p_member, p_status, me)
    on conflict (outing_id, member_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
  end if;
end;
$$;
revoke all on function public.mark_outing_paid(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_outing_paid(bigint, uuid, text) to authenticated;
