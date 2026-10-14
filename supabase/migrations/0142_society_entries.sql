-- Society entries: request a place, the waiting list, event details (14 Oct 2026).
-- Design: claude/society-entries.md. Builds on 0125 (outings), 0127
-- (payments), 0131 (guests).
--
-- WHAT CHANGES
--
--   1. How members get a place, per event (entry_mode):
--        'join'    — first come, first served (as before)
--        'request' — the member asks; the captain, secretary or organiser
--                    approves, declines, or puts them on the waiting list.
--   2. The waiting list. When an event with places is full, a member asking
--      for a place goes on it instead of being turned away. When a place
--      frees up, the first person on the list is OFFERED it and has 24 hours
--      to take it (auto_offer, on by default); an officer can also promote
--      anyone on the list by hand. An offer that runs out goes to the next.
--   3. With a request a member can choose their meal, ask to bring a guest,
--      say who they'd like to play with or an early/late tee, and leave a
--      note for the captain. Only the member and the officers see those.
--   4. Event details: arrive-by time, format, dress code, meal options, a
--      guest fee, whether members may bring guests, and an entry deadline
--      of the organiser's choosing (default: midnight before, as before).
--   5. Withdrawals are logged, and a withdrawn member's payment can be
--      marked refunded.
--   6. An outbox of society alerts (society_alerts). Functions and triggers
--      here write one row per recipient; the website sends them (push, the
--      Inbox) because notifyUser() lives there. Nothing reads it but the
--      service role.
--
-- WHY A SEPARATE QUEUE TABLE. society_outing_entries stays "who has a
-- place", exactly as before: the draw, payments, claims, the itinerary and
-- every older app build read it that way. Requests and the waiting list live
-- in society_outing_queue, and moving off it into an entry is one function.
--
-- LINKS TO PROFILES. Still at most one foreign key to profiles per table (0123).
--
-- Rollback (in order):
--   drop trigger if exists society_outing_alerts on public.society_outings;
--   drop table if exists public.society_alerts, public.society_outing_withdrawals,
--     public.society_outing_choices, public.society_outing_queue;
--   alter table public.society_outing_guests drop column if exists brought_by;
--   alter table public.society_outings drop column if exists entry_mode, … (see section 1);
--   …then re-run 0131's set_outing_entry, remove_outing_guest and 0129's save_outing.


-- ============ 1. Event details and entry rules ============

alter table public.society_outings
  add column if not exists entry_mode text not null default 'join',
  add column if not exists entries_close_at timestamptz,
  add column if not exists waiting_list boolean not null default true,
  add column if not exists auto_offer boolean not null default true,
  add column if not exists guests_allowed boolean not null default true,
  add column if not exists guest_fee_cents integer,
  add column if not exists arrive_by time,
  add column if not exists format_label text,
  add column if not exists dress_code text,
  add column if not exists meal_options text[] not null default '{}';

alter table public.society_outings drop constraint if exists society_outings_entry_mode_check;
alter table public.society_outings add constraint society_outings_entry_mode_check check (entry_mode in ('join', 'request'));
alter table public.society_outings drop constraint if exists society_outings_guest_fee_check;
alter table public.society_outings add constraint society_outings_guest_fee_check check (guest_fee_cents is null or guest_fee_cents between 0 and 100000);
alter table public.society_outings drop constraint if exists society_outings_format_label_check;
alter table public.society_outings add constraint society_outings_format_label_check check (format_label is null or char_length(format_label) <= 60);
alter table public.society_outings drop constraint if exists society_outings_dress_code_check;
alter table public.society_outings add constraint society_outings_dress_code_check check (dress_code is null or char_length(dress_code) <= 200);
alter table public.society_outings drop constraint if exists society_outings_meal_options_check;
alter table public.society_outings add constraint society_outings_meal_options_check check (cardinality(meal_options) <= 6);

-- A guest a member asked to bring (null: added by an officer, as 0131).
alter table public.society_outing_guests add column if not exists brought_by uuid;

-- A withdrawn member's payment can be refunded (cash or transfer, by hand;
-- a card refund will be the webhook's, like 'card').
alter table public.society_outing_payments drop constraint if exists society_outing_payments_status_check;
alter table public.society_outing_payments
  add constraint society_outing_payments_status_check check (status in ('cash', 'transfer', 'card', 'waived', 'refunded'));


-- ============ 2. Requests and the waiting list ============

create table if not exists public.society_outing_queue (
  id bigint generated always as identity primary key,
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  -- requested: waiting for an officer. waiting: on the waiting list.
  -- offered: a place is held for them until offer_expires_at.
  status text not null check (status in ('requested', 'waiting', 'offered')),
  -- A guest they'd like to bring: they take a place too.
  guest_name text check (guest_name is null or char_length(btrim(guest_name)) between 1 and 60),
  guest_index numeric(3, 1) check (guest_index is null or guest_index between -10 and 54),
  created_at timestamptz not null default now(),
  -- The waiting list runs in this order (moved on from created_at when a
  -- request is put on the list, so the list is first come, first served).
  queued_at timestamptz not null default now(),
  offered_at timestamptz,
  offer_expires_at timestamptz,
  unique (outing_id, member_id)
);
create index if not exists society_outing_queue_order_idx on public.society_outing_queue (outing_id, status, queued_at);
create index if not exists society_outing_queue_member_idx on public.society_outing_queue (member_id);

-- What a member chose when they asked: meal, who to play with, early or
-- late, a note. Kept while they're queued or in; gone when they withdraw.
create table if not exists public.society_outing_choices (
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  meal text check (meal is null or char_length(meal) <= 40),
  guest_meal text check (guest_meal is null or char_length(guest_meal) <= 40),
  -- Another member they'd like to play with. No foreign key (0123).
  play_with uuid,
  tee_pref text check (tee_pref is null or tee_pref in ('early', 'late')),
  note text check (note is null or char_length(note) <= 200),
  updated_at timestamptz not null default now(),
  primary key (outing_id, member_id)
);

create table if not exists public.society_outing_withdrawals (
  id bigint generated always as identity primary key,
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  withdrawn_at timestamptz not null default now(),
  -- Who took them off (themselves, or an officer). No foreign key (0123).
  withdrawn_by uuid
);
create index if not exists society_outing_withdrawals_outing_idx on public.society_outing_withdrawals (outing_id);

alter table public.society_outing_queue enable row level security;
alter table public.society_outing_choices enable row level security;
alter table public.society_outing_withdrawals enable row level security;

-- Your own; the officers see the event's.
drop policy if exists "own queue place, or the officers" on public.society_outing_queue;
create policy "own queue place, or the officers" on public.society_outing_queue
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (select 1 from public.society_outings o where o.id = outing_id and public.outing_officer(o.group_id, (select auth.uid())))
  );

drop policy if exists "own choices, or the officers" on public.society_outing_choices;
create policy "own choices, or the officers" on public.society_outing_choices
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (select 1 from public.society_outings o where o.id = outing_id and public.outing_officer(o.group_id, (select auth.uid())))
  );

drop policy if exists "own withdrawals, or the officers" on public.society_outing_withdrawals;
create policy "own withdrawals, or the officers" on public.society_outing_withdrawals
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (select 1 from public.society_outings o where o.id = outing_id and public.outing_officer(o.group_id, (select auth.uid())))
  );

revoke all on public.society_outing_queue, public.society_outing_choices, public.society_outing_withdrawals from anon, authenticated;
grant select on public.society_outing_queue, public.society_outing_choices, public.society_outing_withdrawals to authenticated;


-- ============ 3. The alert outbox ============

-- One row per recipient. Written only by SECURITY DEFINER functions and
-- triggers here; read and marked sent only by the website's service role.
create table if not exists public.society_alerts (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  outing_id bigint references public.society_outings (id) on delete cascade,
  -- The recipient. No foreign key to profiles: nothing embeds this table.
  member_id uuid not null,
  kind text not null check (char_length(kind) between 1 and 40),
  -- Safe, structured facts the sender words: names, dates, counts. Never
  -- free text another member wrote that the lock screen would show.
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (member_id, dedupe_key)
);
create index if not exists society_alerts_unsent_idx on public.society_alerts (created_at) where sent_at is null;

alter table public.society_alerts enable row level security;
revoke all on public.society_alerts from anon, authenticated;

-- Internal: queue an alert. Repeats with the same key are dropped.
create or replace function public.queue_society_alert(p_group_id bigint, p_outing_id bigint, p_member uuid, p_kind text, p_payload jsonb, p_dedupe text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.society_alerts (group_id, outing_id, member_id, kind, payload, dedupe_key)
  values (p_group_id, p_outing_id, p_member, p_kind, coalesce(p_payload, '{}'::jsonb), p_dedupe)
  on conflict (member_id, dedupe_key) do nothing;
$$;
revoke all on function public.queue_society_alert(bigint, bigint, uuid, text, jsonb, text) from public, anon, authenticated;

-- Internal: the people who run an event (whoever outing_officer() allows).
create or replace function public.outing_officer_ids(p_group_id bigint)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.member_id from public.group_members m
   where m.group_id = p_group_id and public.outing_officer(p_group_id, m.member_id);
$$;
revoke all on function public.outing_officer_ids(bigint) from public, anon, authenticated;


-- ============ 4. Helpers ============

-- When members' own changes stop: the organiser's deadline, else midnight
-- at the start of the day (0125).
create or replace function public.outing_entries_closed(p_outing_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select now() >= coalesce(o.entries_close_at, public.outing_entries_close_at(o.plays_on))
    from public.society_outings o where o.id = p_outing_id;
$$;
revoke all on function public.outing_entries_closed(bigint) from public, anon, authenticated;
grant execute on function public.outing_entries_closed(bigint) to authenticated;

-- What a member is told once entries have closed.
create or replace function public.outing_closed_message(o public.society_outings)
returns text
language sql
immutable
as $$
  select case when o.entries_close_at is null
    then 'Entries closed at midnight — ask the captain or secretary.'
    else 'Entries have closed — ask the captain or secretary.' end;
$$;
revoke all on function public.outing_closed_message(public.society_outings) from public, anon, authenticated;

-- Anything that stops a member asking for places in this group, as the
-- message to show them; null if nothing does. 0144 fills it in (unpaid
-- annual membership, where the society says that stops entries).
create or replace function public.society_entry_blocked(p_group_id bigint, p_member uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select null::text;
$$;
revoke all on function public.society_entry_blocked(bigint, uuid) from public, anon, authenticated;

-- Who handles an event's money. Until 0144 that's whoever runs events;
-- 0144 gives it to the treasurer (and keeps it from event organisers).
create or replace function public.outing_money_officer(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.outing_officer(p_group_id, p_user_id);
$$;
revoke all on function public.outing_money_officer(bigint, uuid) from public, anon, authenticated;
grant execute on function public.outing_money_officer(bigint, uuid) to authenticated;

-- Places a queue row needs: the member, and their guest if any.
create or replace function public.outing_queue_seats(q public.society_outing_queue)
returns integer
language sql
immutable
as $$
  select 1 + case when q.guest_name is null then 0 else 1 end;
$$;
revoke all on function public.outing_queue_seats(public.society_outing_queue) from public, anon, authenticated;

-- Places still free: max − (members + guests) − places held for offers.
-- Null when the event has no limit.
create or replace function public.outing_free_places(p_outing_id bigint)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select case when o.max_entries is null then null
    else o.max_entries - public.outing_entry_count(o.id)
         - coalesce((select sum(public.outing_queue_seats(q)) from public.society_outing_queue q
                      where q.outing_id = o.id and q.status = 'offered'), 0)::integer
  end
  from public.society_outings o where o.id = p_outing_id;
$$;
revoke all on function public.outing_free_places(bigint) from public, anon, authenticated;

-- Give a queue row its place: an entry, and their guest, then tidy up.
create or replace function public.outing_seat_from_queue(p_queue_id bigint, p_with_guest boolean, p_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.society_outing_queue%rowtype;
begin
  select * into q from public.society_outing_queue where id = p_queue_id;
  if not found then return; end if;
  insert into public.society_outing_entries (outing_id, member_id) values (q.outing_id, q.member_id)
  on conflict (outing_id, member_id) do nothing;
  if p_with_guest and q.guest_name is not null then
    insert into public.society_outing_guests (outing_id, name, handicap_index, added_by, brought_by)
    values (q.outing_id, btrim(q.guest_name), q.guest_index, p_by, q.member_id);
  end if;
  delete from public.society_outing_queue where id = p_queue_id;
end;
$$;
revoke all on function public.outing_seat_from_queue(bigint, boolean, uuid) from public, anon, authenticated;

-- Offer free places to the waiting list, first come first served, while the
-- next person fits. Called after anything that frees a place. An offer runs
-- 24 hours, or until the start of the day if that's sooner; one that would
-- already have run out isn't made (the officers promote by hand then).
create or replace function public.offer_outing_places(p_outing_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.society_outings%rowtype;
  q public.society_outing_queue%rowtype;
  v_free integer;
  v_until timestamptz;
  v_made integer := 0;
begin
  select * into o from public.society_outings where id = p_outing_id for update;
  if not found or o.status <> 'open' or o.match_day_id is not null or not o.auto_offer or o.max_entries is null then
    return 0;
  end if;
  -- 24 hours from now, or the start of the day itself if that's sooner.
  v_until := least(now() + interval '24 hours', public.outing_entries_close_at(o.plays_on));
  if v_until <= now() + interval '30 minutes' then return 0; end if;
  loop
    v_free := public.outing_free_places(p_outing_id);
    select * into q from public.society_outing_queue
     where outing_id = p_outing_id and status = 'waiting'
     order by queued_at, id limit 1;
    exit when not found or v_free < public.outing_queue_seats(q);
    update public.society_outing_queue
       set status = 'offered', offered_at = now(), offer_expires_at = v_until
     where id = q.id;
    perform public.queue_society_alert(o.group_id, o.id, q.member_id, 'place_offered',
      jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'expires_at', v_until),
      'place_offered:' || q.id || ':' || extract(epoch from now())::bigint);
    v_made := v_made + 1;
  end loop;
  return v_made;
end;
$$;
revoke all on function public.offer_outing_places(bigint) from public, anon, authenticated;

-- Offers that ran out go back to nobody: the member comes off the list and
-- the place is offered to the next. Run lazily before every queue change
-- on that event, and by the sweep for all of them.
create or replace function public.expire_outing_offers(p_outing_id bigint)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  q record;
  v_n integer := 0;
begin
  for q in
    delete from public.society_outing_queue x
     using public.society_outings o
     where x.outing_id = p_outing_id and o.id = x.outing_id
       and x.status = 'offered' and x.offer_expires_at <= now()
    returning x.id, x.member_id, o.group_id, o.title, o.plays_on
  loop
    delete from public.society_outing_choices c where c.outing_id = p_outing_id and c.member_id = q.member_id;
    perform public.queue_society_alert(q.group_id, p_outing_id, q.member_id, 'offer_expired',
      jsonb_build_object('title', q.title, 'plays_on', q.plays_on), 'offer_expired:' || q.id);
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then perform public.offer_outing_places(p_outing_id); end if;
  return v_n;
end;
$$;
revoke all on function public.expire_outing_offers(bigint) from public, anon, authenticated;

-- Every event's expired offers (pg_cron, every 10 minutes).
create or replace function public.sweep_outing_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id bigint;
  v_n integer := 0;
begin
  for v_id in select distinct outing_id from public.society_outing_queue where status = 'offered' and offer_expires_at <= now() loop
    v_n := v_n + public.expire_outing_offers(v_id);
  end loop;
  return v_n;
end;
$$;
revoke all on function public.sweep_outing_offers() from public, anon, authenticated;

-- Save a member's choices for an event from p (meal, guest_meal, play_with,
-- tee_pref, note). Checked against the event's meal options.
create or replace function public.save_outing_choices(o public.society_outings, p_member uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meal text := nullif(btrim(coalesce(p ->> 'meal', '')), '');
  v_guest_meal text := nullif(btrim(coalesce(p ->> 'guest_meal', '')), '');
  v_with uuid;
  v_pref text := nullif(p ->> 'tee_pref', '');
  v_note text := nullif(btrim(coalesce(p ->> 'note', '')), '');
begin
  begin
    v_with := nullif(p ->> 'play_with', '')::uuid;
  exception when others then
    raise exception 'That playing partner doesn''t look right.';
  end;
  if v_meal is not null and not (v_meal = any (o.meal_options)) then raise exception 'Choose one of the meals on offer.'; end if;
  if v_guest_meal is not null and not (v_guest_meal = any (o.meal_options)) then raise exception 'Choose one of the meals on offer.'; end if;
  if v_pref is not null and v_pref not in ('early', 'late') then raise exception 'Ask for an early or a late tee time.'; end if;
  if v_note is not null and char_length(v_note) > 200 then raise exception 'The note is too long — 200 characters at most.'; end if;
  if v_with is not null and (v_with = p_member or not public.is_group_member(o.group_id, v_with)) then
    raise exception 'Choose someone in the group to play with.';
  end if;
  if v_meal is null and v_guest_meal is null and v_with is null and v_pref is null and v_note is null then
    delete from public.society_outing_choices where outing_id = o.id and member_id = p_member;
    return;
  end if;
  insert into public.society_outing_choices (outing_id, member_id, meal, guest_meal, play_with, tee_pref, note)
  values (o.id, p_member, v_meal, v_guest_meal, v_with, v_pref, v_note)
  on conflict (outing_id, member_id) do update
    set meal = excluded.meal, guest_meal = excluded.guest_meal, play_with = excluded.play_with,
        tee_pref = excluded.tee_pref, note = excluded.note, updated_at = now();
end;
$$;
revoke all on function public.save_outing_choices(public.society_outings, uuid, jsonb) from public, anon, authenticated;


-- ============ 5. Asking for a place ============

-- The member asks for a place (or changes what they asked for).
-- p: { meal?, guest_meal?, play_with?, tee_pref?, note?, guest?: { name, index? } }
-- Returns where they are: 'confirmed', 'requested' or 'waiting'.
--   join mode:    a place if there's room for them (and their guest), else
--                 the waiting list (if the event keeps one), else full.
--   request mode: 'requested' — the officers decide.
create or replace function public.request_outing_place(p_outing_id bigint, p jsonb default '{}'::jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  p2 jsonb := coalesce(p, '{}'::jsonb);
  v_guest text := nullif(btrim(coalesce(p2 #>> '{guest,name}', '')), '');
  v_guest_index numeric;
  v_seats integer;
  v_free integer;
  q public.society_outing_queue%rowtype;
begin
  select * into o from public.society_outings where id = p_outing_id for update;
  if not found or not public.is_group_member(o.group_id, me) then
    raise exception 'That outing isn''t available.';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if o.match_day_id is not null then raise exception 'The round has started.'; end if;
  if public.outing_entries_closed(p_outing_id) then
    raise exception '%', public.outing_closed_message(o);
  end if;
  perform public.expire_outing_offers(p_outing_id);
  if not exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = me)
     and public.society_entry_blocked(o.group_id, me) is not null then
    raise exception '%', public.society_entry_blocked(o.group_id, me);
  end if;

  begin
    v_guest_index := nullif(p2 #>> '{guest,index}', '')::numeric;
  exception when others then
    raise exception 'A handicap index looks like 14.2.';
  end;
  if v_guest is not null then
    if not o.guests_allowed then raise exception 'Guests aren''t being taken for this one.'; end if;
    if char_length(v_guest) > 60 then raise exception 'That name is too long — 60 characters at most.'; end if;
    if v_guest_index is not null and (v_guest_index < -10 or v_guest_index > 54) then
      raise exception 'A handicap index is between +10 and 54.';
    end if;
  end if;

  perform public.save_outing_choices(o, me, p2);

  -- Already in: only their choices change (a guest is added by asking the
  -- officers, so the places stay theirs to manage).
  if exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = me) then
    return 'confirmed';
  end if;

  select * into q from public.society_outing_queue where outing_id = p_outing_id and member_id = me;
  if found then
    if q.status = 'offered' then
      raise exception 'A place is being held for you — take it or turn it down.';
    end if;
    update public.society_outing_queue
       set guest_name = v_guest, guest_index = case when v_guest is null then null else round(v_guest_index, 1) end
     where id = q.id;
    return q.status;
  end if;

  v_seats := 1 + case when v_guest is null then 0 else 1 end;

  if o.entry_mode = 'request' then
    insert into public.society_outing_queue (outing_id, member_id, status, guest_name, guest_index)
    values (p_outing_id, me, 'requested', v_guest, round(v_guest_index, 1));
    perform public.queue_society_alert(o.group_id, o.id, x, 'request_received',
      jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'member', me, 'guest', v_guest is not null),
      'request_received:' || o.id || ':' || me || ':' || (now() at time zone 'Europe/Dublin')::date)
      from public.outing_officer_ids(o.group_id) x where x <> me;
    return 'requested';
  end if;

  v_free := public.outing_free_places(p_outing_id);
  -- Nobody jumps the list: with people waiting, a newcomer joins the back.
  if v_free is null or (v_free >= v_seats
       and not exists (select 1 from public.society_outing_queue where outing_id = p_outing_id and status = 'waiting')) then
    insert into public.society_outing_entries (outing_id, member_id) values (p_outing_id, me);
    if v_guest is not null then
      insert into public.society_outing_guests (outing_id, name, handicap_index, added_by, brought_by)
      values (p_outing_id, v_guest, round(v_guest_index, 1), me, me);
    end if;
    return 'confirmed';
  end if;

  if not o.waiting_list then
    raise exception 'The outing is full.';
  end if;
  insert into public.society_outing_queue (outing_id, member_id, status, guest_name, guest_index)
  values (p_outing_id, me, 'waiting', v_guest, round(v_guest_index, 1));
  return 'waiting';
end;
$$;
revoke all on function public.request_outing_place(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.request_outing_place(bigint, jsonb) to authenticated;

-- Officers: what to do with a request or someone on the waiting list.
--   'approve'      — a place for them and their guest
--   'member_only'  — a place for them, not the guest
--   'waiting'      — onto the waiting list (from a request)
--   'decline'      — off the list
create or replace function public.review_outing_request(p_outing_id bigint, p_member uuid, p_decision text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  q public.society_outing_queue%rowtype;
  v_seats integer;
  v_free integer;
begin
  select * into o from public.society_outings where id = p_outing_id for update;
  if not found or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can answer requests.' using errcode = '42501';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if o.match_day_id is not null then raise exception 'The round has started.'; end if;
  perform public.expire_outing_offers(p_outing_id);
  select * into q from public.society_outing_queue where outing_id = p_outing_id and member_id = p_member;
  if not found then raise exception 'They''re not asking for a place any more.'; end if;

  if p_decision = 'decline' then
    delete from public.society_outing_queue where id = q.id;
    delete from public.society_outing_choices where outing_id = p_outing_id and member_id = p_member;
    perform public.queue_society_alert(o.group_id, o.id, p_member, 'request_declined',
      jsonb_build_object('title', o.title, 'plays_on', o.plays_on), 'request_declined:' || q.id);
    if q.status = 'offered' then perform public.offer_outing_places(p_outing_id); end if;
    return 'declined';
  end if;

  if p_decision = 'waiting' then
    if q.status = 'requested' then
      update public.society_outing_queue set status = 'waiting', queued_at = now() where id = q.id;
      perform public.queue_society_alert(o.group_id, o.id, p_member, 'waitlisted',
        jsonb_build_object('title', o.title, 'plays_on', o.plays_on), 'waitlisted:' || q.id);
      perform public.offer_outing_places(p_outing_id);
    end if;
    return 'waiting';
  end if;

  if p_decision not in ('approve', 'member_only') then
    raise exception 'Approve, decline or put them on the waiting list.';
  end if;
  v_seats := 1 + case when p_decision = 'approve' and q.guest_name is not null then 1 else 0 end;
  v_free := public.outing_free_places(p_outing_id);
  -- An offered place is already set aside for them.
  if q.status = 'offered' then v_free := v_free + public.outing_queue_seats(q); end if;
  if v_free is not null and v_free < v_seats then
    raise exception 'Not enough places left — put them on the waiting list, or add places to the event.';
  end if;
  perform public.outing_seat_from_queue(q.id, p_decision = 'approve', me);
  perform public.queue_society_alert(o.group_id, o.id, p_member, 'place_confirmed',
    jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'fee_cents', o.entry_fee_cents), 'place_confirmed:' || q.id);
  if q.status = 'offered' and v_seats < public.outing_queue_seats(q) then perform public.offer_outing_places(p_outing_id); end if;
  return 'confirmed';
end;
$$;
revoke all on function public.review_outing_request(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.review_outing_request(bigint, uuid, text) to authenticated;

-- The member answers an offer: true takes the place, false lets it go to
-- the next person.
create or replace function public.answer_outing_offer(p_outing_id bigint, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  q public.society_outing_queue%rowtype;
begin
  select * into o from public.society_outings where id = p_outing_id for update;
  if not found or not public.is_group_member(o.group_id, me) then
    raise exception 'That outing isn''t available.';
  end if;
  perform public.expire_outing_offers(p_outing_id);
  select * into q from public.society_outing_queue where outing_id = p_outing_id and member_id = me;
  if not found or q.status <> 'offered' then
    raise exception 'That offer has run out.';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if o.match_day_id is not null then raise exception 'The round has started.'; end if;
  if p_accept and public.society_entry_blocked(o.group_id, me) is not null then
    raise exception '%', public.society_entry_blocked(o.group_id, me);
  end if;
  if not p_accept then
    delete from public.society_outing_queue where id = q.id;
    delete from public.society_outing_choices where outing_id = p_outing_id and member_id = me;
    perform public.offer_outing_places(p_outing_id);
    return 'declined';
  end if;
  perform public.outing_seat_from_queue(q.id, true, me);
  return 'confirmed';
end;
$$;
revoke all on function public.answer_outing_offer(bigint, boolean) from public, anon, authenticated;
grant execute on function public.answer_outing_offer(bigint, boolean) to authenticated;

-- Officers: give someone on the list a place now (before or instead of an offer).
create or replace function public.promote_outing_waiting(p_outing_id bigint, p_member uuid)
returns text
language sql
security definer
set search_path = public
as $$
  select public.review_outing_request(p_outing_id, p_member, 'approve');
$$;
revoke all on function public.promote_outing_waiting(bigint, uuid) from public, anon, authenticated;
grant execute on function public.promote_outing_waiting(bigint, uuid) to authenticated;

-- Where you stand on a group's events: requested / waiting (with your place
-- in the line) / offered (until when). One row per event you're queued on.
create or replace function public.my_outing_queue(p_group_id bigint)
returns table (outing_id bigint, status text, line_position integer, offer_expires_at timestamptz, guest_name text)
language sql
stable
security definer
set search_path = public
as $$
  select q.outing_id, q.status,
         case when q.status = 'waiting' then (
           select count(*)::integer from public.society_outing_queue w
            where w.outing_id = q.outing_id and w.status = 'waiting' and (w.queued_at, w.id) <= (q.queued_at, q.id)
         ) end,
         q.offer_expires_at, q.guest_name
    from public.society_outing_queue q
    join public.society_outings o on o.id = q.outing_id
   where q.member_id = (select auth.uid()) and o.group_id = p_group_id
     and public.is_group_member(p_group_id, (select auth.uid()));
$$;
revoke all on function public.my_outing_queue(bigint) from public, anon, authenticated;
grant execute on function public.my_outing_queue(bigint) to authenticated;


-- ============ 6. Joining and leaving (replaces 0131's) ============

-- Same signature, so older apps keep working:
--   a member joining (p_in, no p_member) goes through request_outing_place,
--     so on a request-only or full event they're queued, not refused;
--   an officer adding someone puts them straight in (places still apply),
--     taking them off any list they were on;
--   leaving, by anyone, also leaves the list, takes off guests the member
--     brought, is logged, and offers the place to the waiting list.
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
  v_was_in boolean;
  v_queued boolean;
begin
  select * into o from public.society_outings where id = p_outing_id for update;
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
  if not v_officer and public.outing_entries_closed(p_outing_id) then
    raise exception '%', public.outing_closed_message(o);
  end if;
  if not public.is_group_member(o.group_id, v_who) then
    raise exception 'They''re not in the society.';
  end if;
  perform public.expire_outing_offers(p_outing_id);

  if p_in then
    if exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = v_who) then
      return;
    end if;
    -- A member (however they call it) asks, so requests, the waiting list
    -- and an unpaid membership all apply. Only officers put people straight in.
    if not v_officer then
      perform public.request_outing_place(p_outing_id, '{}'::jsonb);
      return;
    end if;
    if o.max_entries is not null
       and public.outing_free_places(p_outing_id)
           + coalesce((select public.outing_queue_seats(q) from public.society_outing_queue q
                        where q.outing_id = p_outing_id and q.member_id = v_who and q.status = 'offered'), 0) < 1 then
      raise exception 'The outing is full.';
    end if;
    delete from public.society_outing_queue where outing_id = p_outing_id and member_id = v_who;
    insert into public.society_outing_entries (outing_id, member_id) values (p_outing_id, v_who);
    return;
  end if;

  delete from public.society_outing_entries where outing_id = p_outing_id and member_id = v_who
  returning true into v_was_in;
  delete from public.society_outing_queue where outing_id = p_outing_id and member_id = v_who
  returning true into v_queued;
  delete from public.society_outing_choices where outing_id = p_outing_id and member_id = v_who;
  if coalesce(v_was_in, false) then
    delete from public.society_outing_guests where outing_id = p_outing_id and brought_by = v_who;
    insert into public.society_outing_withdrawals (outing_id, member_id, withdrawn_by) values (p_outing_id, v_who, me);
  end if;
  if coalesce(v_was_in, false) or coalesce(v_queued, false) then
    perform public.offer_outing_places(p_outing_id);
  end if;
end;
$$;
revoke all on function public.set_outing_entry(bigint, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_outing_entry(bigint, boolean, uuid) to authenticated;

-- A guest coming off frees a place too (replaces 0131's).
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
   where g.id = p_guest_id
     for update of o2;
  if o.id is null or not public.outing_officer(o.group_id, me) then
    raise exception 'Only the captain or secretary can take a guest off.' using errcode = '42501';
  end if;
  if o.match_day_id is not null then raise exception 'The round has started.'; end if;
  delete from public.society_outing_guests where id = p_guest_id;
  perform public.offer_outing_places(o.id);
end;
$$;
revoke all on function public.remove_outing_guest(bigint) from public, anon, authenticated;
grant execute on function public.remove_outing_guest(bigint) to authenticated;

-- An officer adding a guest counts places held for offers too (replaces 0131's).
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
  select * into o from public.society_outings where id = p_outing_id for update;
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
  if o.max_entries is not null and public.outing_free_places(p_outing_id) < 1 then
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

-- Back in after a refund: the refunded payment no longer stands, so they
-- owe the fee again (and show as unpaid, not paid, everywhere).
create or replace function public.outing_entry_rejoined()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.society_outing_payments
   where outing_id = new.outing_id and member_id = new.member_id and status = 'refunded';
  return new;
end;
$$;
revoke all on function public.outing_entry_rejoined() from public, anon, authenticated;

drop trigger if exists society_outing_entry_rejoined on public.society_outing_entries;
create trigger society_outing_entry_rejoined
  after insert on public.society_outing_entries
  for each row execute function public.outing_entry_rejoined();

-- Officers: a withdrawn member's cash or transfer payment was handed back
-- (p_refunded false undoes it). Only for someone no longer entered.
create or replace function public.mark_outing_refunded(p_outing_id bigint, p_member uuid, p_refunded boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_group bigint := (select group_id from public.society_outings where id = p_outing_id);
  v_status text;
begin
  if v_group is null or not public.outing_officer(v_group, me) then
    raise exception 'Only the captain or secretary can mark refunds.' using errcode = '42501';
  end if;
  if exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = p_member) then
    raise exception 'They''re still entered — take them off first.';
  end if;
  select status into v_status from public.society_outing_payments where outing_id = p_outing_id and member_id = p_member;
  if v_status is null then raise exception 'They hadn''t paid.'; end if;
  if v_status = 'card' then raise exception 'Card payments are refunded through the card.'; end if;
  if p_refunded then
    if v_status = 'waived' then raise exception 'Their fee was waived — there''s nothing to refund.'; end if;
    update public.society_outing_payments set status = 'refunded', marked_by = me, marked_at = now()
     where outing_id = p_outing_id and member_id = p_member;
  elsif v_status = 'refunded' then
    -- Undo: back to paid. The method isn't kept, so it's recorded as transfer.
    update public.society_outing_payments set status = 'transfer', marked_by = me, marked_at = now()
     where outing_id = p_outing_id and member_id = p_member;
  end if;
end;
$$;
revoke all on function public.mark_outing_refunded(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_outing_refunded(bigint, uuid, boolean) to authenticated;

-- mark_outing_paid (0125) must not touch a refunded payment of someone
-- who has left; it already refuses anyone not entered, which covers it.


-- ============ 7. Setting up an event (replaces 0129's) ============

-- p: as 0129, plus { entry_mode?, entries_close_at?, waiting_list?,
--    auto_offer?, guests_allowed?, guest_fee_cents?, arrive_by?,
--    format_label?, dress_code?, meal_options? }.
-- On a change, a key that isn't sent keeps its value — an older app that
-- doesn't know about these fields can't wipe them.
create or replace function public.save_outing(p_group_id bigint, p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  cur public.society_outings%rowtype;
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
  -- 0142
  v_mode text;
  v_close timestamptz;
  v_waiting boolean;
  v_auto boolean;
  v_guests boolean;
  v_guest_fee integer;
  v_arrive time;
  v_format text;
  v_dress text;
  v_meals text[];
  v_meal text;
  v_id bigint;
begin
  if not public.outing_officer(p_group_id, me) then
    raise exception 'Only whoever runs the group can set up events.' using errcode = '42501';
  end if;
  if coalesce((select kind from public.groups where id = p_group_id and hidden_at is null), '') not in ('society', 'crew', 'trip') then
    raise exception 'Events are for societies, crews and trips.';
  end if;
  if p_id is not null then
    select * into cur from public.society_outings where id = p_id and group_id = p_group_id;
    if not found then raise exception 'That outing can''t be changed.'; end if;
  end if;
  -- Where members send money is the money area's to set: anyone else
  -- running the event keeps what's there (or, new, the society's last).
  if not public.outing_money_officer(p_group_id, me) then
    if p_id is null then
      select o.pay_revtag, o.pay_iban, o.pay_account_name, coalesce(o.pay_cash, true), o.pay_note
        into v_revtag, v_iban, v_account, v_cash, v_pay_note
        from public.society_outings o
       where o.group_id = p_group_id and (o.pay_revtag is not null or o.pay_iban is not null or o.pay_note is not null)
       order by o.created_at desc limit 1;
      v_cash := coalesce(v_cash, true);
    else
      v_revtag := cur.pay_revtag; v_iban := cur.pay_iban; v_account := cur.pay_account_name;
      v_cash := coalesce(cur.pay_cash, true); v_pay_note := cur.pay_note;
    end if;
  end if;
  if v_kind not in ('day', 'overnight', 'abroad') then
    raise exception 'Choose a day out, overnight or abroad.';
  end if;
  begin
    v_date := (p ->> 'plays_on')::date;
    v_end := nullif(p ->> 'ends_on', '')::date;
    v_tee := nullif(p ->> 'first_tee', '')::time;
    v_close := case when p ? 'entries_close_at' then nullif(p ->> 'entries_close_at', '')::timestamptz else cur.entries_close_at end;
    v_arrive := case when p ? 'arrive_by' then nullif(p ->> 'arrive_by', '')::time else cur.arrive_by end;
  exception when others then
    raise exception 'That date or time doesn''t look right.';
  end;
  v_mode := case when p ? 'entry_mode' then coalesce(nullif(p ->> 'entry_mode', ''), 'join') else coalesce(cur.entry_mode, 'join') end;
  v_waiting := case when p ? 'waiting_list' then coalesce((p ->> 'waiting_list')::boolean, true) else coalesce(cur.waiting_list, true) end;
  v_auto := case when p ? 'auto_offer' then coalesce((p ->> 'auto_offer')::boolean, true) else coalesce(cur.auto_offer, true) end;
  v_guests := case when p ? 'guests_allowed' then coalesce((p ->> 'guests_allowed')::boolean, true) else coalesce(cur.guests_allowed, true) end;
  v_guest_fee := case when p ? 'guest_fee_cents' then nullif(p ->> 'guest_fee_cents', '')::integer else cur.guest_fee_cents end;
  v_format := case when p ? 'format_label' then nullif(btrim(coalesce(p ->> 'format_label', '')), '') else cur.format_label end;
  v_dress := case when p ? 'dress_code' then nullif(btrim(coalesce(p ->> 'dress_code', '')), '') else cur.dress_code end;
  if p ? 'meal_options' then
    if jsonb_typeof(p -> 'meal_options') not in ('array', 'null') then raise exception 'The meals don''t look right.'; end if;
    v_meals := '{}';
    for v_meal in select btrim(x) from jsonb_array_elements_text(case when jsonb_typeof(p -> 'meal_options') = 'array' then p -> 'meal_options' else '[]'::jsonb end) x loop
      if char_length(v_meal) = 0 then continue; end if;
      if char_length(v_meal) > 40 then raise exception 'A meal is 40 characters at most.'; end if;
      if not (v_meal = any (v_meals)) then v_meals := v_meals || v_meal; end if;
    end loop;
    if cardinality(v_meals) > 6 then raise exception 'Six meal choices at most.'; end if;
  else
    v_meals := coalesce(cur.meal_options, '{}');
  end if;

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
  if v_mode not in ('join', 'request') then raise exception 'Choose how members get a place.'; end if;
  if v_guest_fee is not null and (v_guest_fee < 0 or v_guest_fee > 100000) then raise exception 'The guest fee is between €0 and €1,000.'; end if;
  if v_format is not null and char_length(v_format) > 60 then raise exception 'The format is 60 characters at most.'; end if;
  if v_dress is not null and char_length(v_dress) > 200 then raise exception 'The dress code is 200 characters at most.'; end if;
  if v_close is not null and v_close > (v_date::timestamp + interval '1 day') at time zone 'Europe/Dublin' then
    raise exception 'Entries have to close by the end of the day itself.';
  end if;

  if p_id is null then
    if (select count(*) from public.society_outings where group_id = p_group_id and plays_on >= current_date) >= 60 then
      raise exception 'That''s a lot of outings ahead — 60 at most.';
    end if;
    insert into public.society_outings (group_id, kind, title, club_id, course_name, plays_on, ends_on, location,
                                        first_tee, details, entry_fee_cents, max_entries, created_by,
                                        pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note,
                                        entry_mode, entries_close_at, waiting_list, auto_offer, guests_allowed,
                                        guest_fee_cents, arrive_by, format_label, dress_code, meal_options)
    values (p_group_id, v_kind, v_title, case when v_course is null then null else nullif(p ->> 'club_id', '')::bigint end,
            v_course, v_date, v_end, v_location, v_tee, v_details, v_fee, v_max, me,
            v_revtag, v_iban, v_account, v_cash, v_pay_note,
            v_mode, v_close, v_waiting, v_auto, v_guests, v_guest_fee, v_arrive, v_format, v_dress, v_meals)
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
  -- Meals already chosen that are no longer on offer are cleared.
  update public.society_outing_choices c
     set meal = case when c.meal = any (v_meals) then c.meal end,
         guest_meal = case when c.guest_meal = any (v_meals) then c.guest_meal end
   where c.outing_id = p_id and ((c.meal is not null and not (c.meal = any (v_meals))) or (c.guest_meal is not null and not (c.guest_meal = any (v_meals))));

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
         pay_note = v_pay_note,
         entry_mode = v_mode,
         entries_close_at = v_close,
         waiting_list = v_waiting,
         auto_offer = v_auto,
         guests_allowed = v_guests,
         guest_fee_cents = v_guest_fee,
         arrive_by = v_arrive,
         format_label = v_format,
         dress_code = v_dress,
         meal_options = v_meals
   where id = p_id and group_id = p_group_id and status = 'open'
   returning id into v_id;
  if v_id is null then raise exception 'That outing can''t be changed.'; end if;
  -- More places, or offers switched back on: offer them to the waiting list.
  perform public.offer_outing_places(v_id);
  return v_id;
end;
$$;
revoke all on function public.save_outing(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_outing(bigint, bigint, jsonb) to authenticated;


-- ============ 8. Alerts from changes to an event ============

-- New event → everyone in the group. Changed date, course or first tee →
-- everyone with a place or on the list. Cancelled → the same. The draw
-- published (or republished) → everyone with a place.
create or replace function public.society_outing_alerts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb := jsonb_build_object('title', new.title, 'plays_on', new.plays_on, 'course', new.course_name, 'first_tee', new.first_tee);
  v_stamp text := extract(epoch from now())::bigint::text;
begin
  if tg_op = 'INSERT' then
    if new.plays_on >= (now() at time zone 'Europe/Dublin')::date then
      perform public.queue_society_alert(new.group_id, new.id, m.member_id, 'event_new', v_payload, 'event_new:' || new.id)
         from public.group_members m
        where m.group_id = new.group_id and m.member_id is distinct from new.created_by;
    end if;
    return new;
  end if;

  if new.status = 'cancelled' and old.status <> 'cancelled' then
    perform public.queue_society_alert(new.group_id, new.id, x.member_id, 'event_cancelled', v_payload, 'event_cancelled:' || new.id)
       from (select member_id from public.society_outing_entries where outing_id = new.id
             union select member_id from public.society_outing_queue where outing_id = new.id) x;
    return new;
  end if;
  if new.status <> 'open' then return new; end if;

  if new.plays_on is distinct from old.plays_on or new.course_name is distinct from old.course_name
     or new.first_tee is distinct from old.first_tee or new.ends_on is distinct from old.ends_on then
    perform public.queue_society_alert(new.group_id, new.id, x.member_id, 'event_changed',
             v_payload || jsonb_build_object('old_plays_on', old.plays_on),
             'event_changed:' || new.id || ':' || v_stamp)
       from (select member_id from public.society_outing_entries where outing_id = new.id
             union select member_id from public.society_outing_queue where outing_id = new.id) x;
  end if;

  if new.draw_published_at is not null and new.draw_published_at is distinct from old.draw_published_at
     and new.match_day_id is null then
    perform public.queue_society_alert(new.group_id, new.id, e.member_id, 'draw_published', v_payload,
             -- One "tee times are out" a day per member, however often it's republished.
             'draw_published:' || new.id || ':' || (now() at time zone 'Europe/Dublin')::date)
       from public.society_outing_entries e where e.outing_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.society_outing_alerts() from public, anon, authenticated;

drop trigger if exists society_outing_alerts on public.society_outings;
create trigger society_outing_alerts
  after insert or update on public.society_outings
  for each row execute function public.society_outing_alerts();

-- Cancelling an event clears its lists (nobody is waiting for a place any more).
create or replace function public.society_outing_cancelled_clear()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    delete from public.society_outing_queue where outing_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function public.society_outing_cancelled_clear() from public, anon, authenticated;

-- Runs after the alerts trigger (names sort: "society_outing_alerts" < "society_outing_z_…").
drop trigger if exists society_outing_z_cancelled_clear on public.society_outings;
create trigger society_outing_z_cancelled_clear
  after update of status on public.society_outings
  for each row execute function public.society_outing_cancelled_clear();


-- ============ 9. Expired offers, every 10 minutes ============

do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the outing offers sweep was NOT scheduled. Expected on a local replay or in CI.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'pinpals-outing-offers') then
    perform cron.unschedule('pinpals-outing-offers');
  end if;
  perform cron.schedule('pinpals-outing-offers', '*/10 * * * *', 'select public.sweep_outing_offers()');
end
$$;

notify pgrst, 'reload schema';
