-- Guests on events (13 Oct 2026). Builds on 0125 (society outings).
-- Design: claude/outing-guests.md.
--
-- WHY
--
--   0125 stored the published draw on each entry, and an entry is a PinPals
--   member. A guest has no account, so there was nowhere to keep their tee
--   time: publish_outing_draw refused any draw with a guest in it, and the
--   app said "add them on the day".
--
-- WHAT CHANGES
--
--   - A guest is entered on an event by its captain, secretary or organiser:
--     a name and, optionally, a handicap index. They count towards places.
--   - publish_outing_draw takes guests in a group as {"guest": <id>} beside
--     the member uuids, in tee order. Old apps send only uuids and still work.
--   - The officers mark a guest paid (cash, transfer, waived), like a member.
--     Only the officers see guest payments.
--   - Guests are on the event and in its draw. A trip's rooms and flights
--     (0126) stay members-only.
--
-- WHO SEES WHAT
--
--   - Guests (name, index, tee time): whoever can see the event, as entries.
--   - Guest payments: the officers only.
--   - Every write goes through the functions below.
--
-- Rollback:
--   drop table if exists public.society_outing_guest_payments, public.society_outing_guests;
--   drop function if exists public.add_outing_guest(bigint, text, numeric),
--     public.update_outing_guest(bigint, text, numeric), public.remove_outing_guest(bigint),
--     public.mark_outing_guest_paid(bigint, text), public.outing_entry_count(bigint);
--   …then re-run 0125's set_outing_entry and publish_outing_draw.


-- ============ Tables ============

create table if not exists public.society_outing_guests (
  id bigint generated always as identity primary key,
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  handicap_index numeric(3, 1) check (handicap_index is null or handicap_index between -10 and 54),
  -- The published draw, as on society_outing_entries.
  tee_group smallint check (tee_group is null or tee_group between 1 and 60),
  tee_time time,
  tee_position smallint check (tee_position is null or tee_position between 1 and 8),
  -- Who added them. No foreign key to profiles on purpose (the 0123 lesson).
  added_by uuid,
  created_at timestamptz not null default now()
);
create index if not exists society_outing_guests_outing_idx on public.society_outing_guests (outing_id);

create table if not exists public.society_outing_guest_payments (
  guest_id bigint primary key references public.society_outing_guests (id) on delete cascade,
  status text not null check (status in ('cash', 'transfer', 'waived')),
  marked_by uuid,
  marked_at timestamptz not null default now()
);

alter table public.society_outing_guests enable row level security;
alter table public.society_outing_guest_payments enable row level security;

drop policy if exists "society members read guests" on public.society_outing_guests;
create policy "society members read guests" on public.society_outing_guests
  for select to authenticated
  using (exists (select 1 from public.society_outings o where o.id = outing_id));

drop policy if exists "officers read guest payments" on public.society_outing_guest_payments;
create policy "officers read guest payments" on public.society_outing_guest_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.society_outing_guests g
        join public.society_outings o on o.id = g.outing_id
       where g.id = guest_id and public.outing_officer(o.group_id, (select auth.uid()))
    )
  );

revoke all on public.society_outing_guests, public.society_outing_guest_payments from anon, authenticated;
grant select on public.society_outing_guests, public.society_outing_guest_payments to authenticated;


-- ============ Helpers ============

-- Members and guests entered: what places are counted against.
create or replace function public.outing_entry_count(p_outing_id bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (select count(*) from public.society_outing_entries where outing_id = p_outing_id)::integer
       + (select count(*) from public.society_outing_guests where outing_id = p_outing_id)::integer;
$$;
revoke all on function public.outing_entry_count(bigint) from public, anon, authenticated;


-- ============ Guests ============

create or replace function public.add_outing_guest(p_outing_id bigint, p_name text, p_index numeric default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_id bigint;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can add guests.' using errcode = '42501';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if o.match_day_id is not null then raise exception 'The round has started — add guests in the round.'; end if;
  if char_length(v_name) = 0 then raise exception 'Give the guest a name.'; end if;
  if char_length(v_name) > 60 then raise exception 'That name is too long — 60 characters at most.'; end if;
  if p_index is not null and (p_index < -10 or p_index > 54) then
    raise exception 'A handicap index is between +10 and 54.';
  end if;
  if (select count(*) from public.society_outing_guests where outing_id = p_outing_id) >= 100 then
    raise exception 'That''s a lot of guests — 100 at most.';
  end if;
  if o.max_entries is not null and public.outing_entry_count(p_outing_id) >= o.max_entries then
    raise exception 'The outing is full.';
  end if;
  insert into public.society_outing_guests (outing_id, name, handicap_index, added_by)
  values (p_outing_id, v_name, round(p_index, 1), me)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.add_outing_guest(bigint, text, numeric) from public, anon, authenticated;
grant execute on function public.add_outing_guest(bigint, text, numeric) to authenticated;

create or replace function public.update_outing_guest(p_guest_id bigint, p_name text, p_index numeric default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_group bigint;
  v_name text := btrim(coalesce(p_name, ''));
begin
  select o.group_id into v_group
    from public.society_outing_guests g join public.society_outings o on o.id = g.outing_id
   where g.id = p_guest_id;
  if v_group is null or not public.outing_officer(v_group, me) then
    raise exception 'Only the captain or secretary can change a guest.' using errcode = '42501';
  end if;
  if char_length(v_name) = 0 then raise exception 'Give the guest a name.'; end if;
  if char_length(v_name) > 60 then raise exception 'That name is too long — 60 characters at most.'; end if;
  if p_index is not null and (p_index < -10 or p_index > 54) then
    raise exception 'A handicap index is between +10 and 54.';
  end if;
  update public.society_outing_guests set name = v_name, handicap_index = round(p_index, 1) where id = p_guest_id;
end;
$$;
revoke all on function public.update_outing_guest(bigint, text, numeric) from public, anon, authenticated;
grant execute on function public.update_outing_guest(bigint, text, numeric) to authenticated;

create or replace function public.remove_outing_guest(p_guest_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
begin
  select o2.* into o
    from public.society_outing_guests g join public.society_outings o2 on o2.id = g.outing_id
   where g.id = p_guest_id;
  if o.id is null or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can take a guest off.' using errcode = '42501';
  end if;
  if o.match_day_id is not null then raise exception 'The round has started.'; end if;
  delete from public.society_outing_guests where id = p_guest_id;
end;
$$;
revoke all on function public.remove_outing_guest(bigint) from public, anon, authenticated;
grant execute on function public.remove_outing_guest(bigint) to authenticated;

create or replace function public.mark_outing_guest_paid(p_guest_id bigint, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_group bigint;
begin
  select o.group_id into v_group
    from public.society_outing_guests g join public.society_outings o on o.id = g.outing_id
   where g.id = p_guest_id;
  if v_group is null or not public.outing_officer(v_group, me) then
    raise exception 'Only the captain or secretary can mark payments.' using errcode = '42501';
  end if;
  if p_status is not null and p_status not in ('cash', 'transfer', 'waived') then
    raise exception 'Mark it as cash, transfer or waived.';
  end if;
  if p_status is null then
    delete from public.society_outing_guest_payments where guest_id = p_guest_id;
  else
    insert into public.society_outing_guest_payments (guest_id, status, marked_by)
    values (p_guest_id, p_status, me)
    on conflict (guest_id) do update set status = excluded.status, marked_by = excluded.marked_by, marked_at = now();
  end if;
end;
$$;
revoke all on function public.mark_outing_guest_paid(bigint, text) from public, anon, authenticated;
grant execute on function public.mark_outing_guest_paid(bigint, text) to authenticated;


-- ============ Places count guests (replaces 0125's) ============

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
    if o.max_entries is not null and public.outing_entry_count(p_outing_id) >= o.max_entries then
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


-- ============ The draw, with guests (replaces 0125's) ============

-- p_groups: [{ tee_time?: "HH:MM", members: [uuid | {"guest": id}, …] }, …]
-- in tee order. Only people entered on this outing, each once.
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
  v_el jsonb;
  v_n smallint := 0;
  v_pos smallint;
  v_member uuid;
  v_guest bigint;
  v_seen uuid[] := '{}';
  v_seen_guests bigint[] := '{}';
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
  update public.society_outing_guests set tee_group = null, tee_time = null, tee_position = null
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
    for v_el in select * from jsonb_array_elements(v_group -> 'members') loop
      v_pos := v_pos + 1;
      if jsonb_typeof(v_el) = 'object' then
        begin
          v_guest := (v_el ->> 'guest')::bigint;
        exception when others then
          raise exception 'That draw doesn''t look right.';
        end;
        if v_guest is null then raise exception 'That draw doesn''t look right.'; end if;
        if v_guest = any (v_seen_guests) then raise exception 'Someone is in two groups.'; end if;
        v_seen_guests := v_seen_guests || v_guest;
        update public.society_outing_guests
           set tee_group = v_n, tee_time = v_time, tee_position = v_pos
         where outing_id = p_outing_id and id = v_guest;
        if not found then raise exception 'Only guests on this outing can be in the draw.'; end if;
      else
        begin
          v_member := (v_el #>> '{}')::uuid;
        exception when others then
          raise exception 'That draw doesn''t look right.';
        end;
        if v_member = any (v_seen) then raise exception 'Someone is in two groups.'; end if;
        v_seen := v_seen || v_member;
        update public.society_outing_entries
           set tee_group = v_n, tee_time = v_time, tee_position = v_pos
         where outing_id = p_outing_id and member_id = v_member;
        if not found then raise exception 'Only people entered can be in the draw.'; end if;
      end if;
    end loop;
  end loop;

  update public.society_outings set draw_published_at = now() where id = p_outing_id;
end;
$$;
revoke all on function public.publish_outing_draw(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.publish_outing_draw(bigint, jsonb) to authenticated;
