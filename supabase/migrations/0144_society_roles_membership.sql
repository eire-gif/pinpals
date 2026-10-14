-- Society committee roles, annual membership and the treasurer's view (14 Oct 2026).
-- Design: claude/society-roles-and-membership.md. Builds on 0122 (offices),
-- 0125/0127/0131/0142 (events, payments), 0143 (messages, reminders).
--
-- 1. MORE OFFICES. A society's owner can now also appoint a vice-captain, a
--    treasurer, a handicap secretary and event organisers (any number of
--    those). Captain and secretary still run everything (role 'admin'); the
--    new offices stay ordinary members by role — they can't invite or
--    approve members — and get only their own areas:
--
--      area        captain/secretary  vice-capt  treasurer  handicap sec  event org
--      events             ✓               ✓                                  ✓
--      people             ✓
--      money              ✓                          ✓
--      handicaps          ✓                                      ✓
--      messages           ✓               ✓          ✓                       ✓
--
--    society_can(group, user, area) is the one place this lives.
--    outing_officer() (who runs events) now includes the vice-captain and
--    event organisers. Marking payments, refunds and seeing who has paid
--    move to the money area (outing_money_officer), so an event organiser
--    runs the day without seeing the money. In crews and trips nothing
--    changes: the owner and admins do everything.
--
-- 2. ANNUAL MEMBERSHIP (optional, per society: society_membership_settings).
--    Off by default. On: a fee, the month the season starts, a due date,
--    and what happens if someone hasn't paid — 'allow' (they can still enter
--    events; officers see "Membership unpaid") or 'block' (no new entries
--    until it's paid, after the due date). No surcharges.
--    society_memberships holds, per member per season, 'paid' (with how),
--    'honorary' (no fee; carries into later seasons) or 'lapsed'. No row
--    means unpaid. Members say "I've paid" (society_membership_claims) and
--    the treasurer confirms, as for events (0127).
--
-- 3. WHAT YOU OWE: my_society_dues() — membership, event fees and guests
--    you brought, for the society page.
-- 4. THE TREASURER: society_money() — the season's membership and events,
--    collected, outstanding and refunded, by method.
-- 5. MEMBERS: society_member_list() — status, office, handicaps and joining
--    date, for the captain and secretary (and the treasurer, for status).
-- 6. Messages can go to 'membership_unpaid'; membership reminders join the
--    sweep; members see the society handicap they play off.
-- 7. Exports are logged (society_exports) by the website.
--
-- Rollback: drop the new tables and functions; re-run 0122's
-- set_group_office, 0133's society_handicaps, 0122's set_society_handicap,
-- 0125's outing_officer and mark_outing_paid, 0127's claim_outing_paid,
-- 0131's mark_outing_guest_paid, 0142's mark_outing_refunded and
-- society_entry_blocked, 0143's society_can_message, society_audience and
-- society_reminder_sweep; restore the 0122 office check and index.


-- ============ 1. Offices ============

alter table public.group_members drop constraint if exists group_members_office_check;
alter table public.group_members
  add constraint group_members_office_check
  check (office is null or office in ('captain', 'secretary', 'vice_captain', 'treasurer', 'handicap_secretary', 'event_organiser'));

-- One of each office, except event organisers.
drop index if exists public.group_members_one_per_office;
create unique index if not exists group_members_one_per_office
  on public.group_members (group_id, office)
  where office is not null and office <> 'event_organiser';

create or replace function public.society_can(p_group_id bigint, p_user uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select case
      when m.role in ('owner', 'admin') then true
      when g.kind <> 'society' then false
      when p_area = 'events' then m.office in ('vice_captain', 'event_organiser')
      when p_area = 'money' then m.office = 'treasurer'
      when p_area = 'handicaps' then m.office = 'handicap_secretary'
      when p_area = 'messages' then m.office in ('vice_captain', 'treasurer', 'event_organiser')
      else false
    end
      from public.group_members m
      join public.groups g on g.id = m.group_id
     where m.group_id = p_group_id and m.member_id = p_user
  ), false);
$$;
revoke all on function public.society_can(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.society_can(bigint, uuid, text) to authenticated;

-- Your areas in a group, for the app to show the right tools.
create or replace function public.my_society_areas(p_group_id bigint)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(a order by a), '{}')
    from unnest(array['events', 'people', 'money', 'handicaps', 'messages']) a
   where public.society_can(p_group_id, (select auth.uid()), a);
$$;
revoke all on function public.my_society_areas(bigint) from public, anon, authenticated;
grant execute on function public.my_society_areas(bigint) to authenticated;

-- Who runs events (replaces 0125's): owner and admins, and in a society
-- the vice-captain and event organisers.
create or replace function public.outing_officer(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.society_can(p_group_id, p_user_id, 'events');
$$;
revoke all on function public.outing_officer(bigint, uuid) from public, anon, authenticated;
grant execute on function public.outing_officer(bigint, uuid) to authenticated;

-- Who handles the money: owner and admins, and in a society the treasurer.
create or replace function public.outing_money_officer(p_group_id bigint, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.society_can(p_group_id, p_user_id, 'money');
$$;
revoke all on function public.outing_money_officer(bigint, uuid) from public, anon, authenticated;
grant execute on function public.outing_money_officer(bigint, uuid) to authenticated;

-- The owner appoints (or stands down) any office (replaces 0122's).
-- Captain and secretary make you an admin; the others leave your role as it is.
create or replace function public.set_group_office(p_group_id bigint, p_member_id uuid, p_office text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_office text := nullif(btrim(coalesce(p_office, '')), '');
  v_runs boolean;
begin
  if coalesce(public.group_role(p_group_id, me), '') <> 'owner' then
    raise exception 'Only the society''s owner can appoint its committee.';
  end if;
  if (select kind from public.groups where id = p_group_id) is distinct from 'society' then
    raise exception 'Only a society has a committee.';
  end if;
  if not public.is_group_member(p_group_id, p_member_id) then
    raise exception 'They''re not in this society.';
  end if;
  if v_office is not null and v_office not in ('captain', 'secretary', 'vice_captain', 'treasurer', 'handicap_secretary', 'event_organiser') then
    raise exception 'Unknown office.';
  end if;
  v_runs := v_office in ('captain', 'secretary');

  if v_office is null then
    update public.group_members
       set office = null,
           role = case when role = 'admin' then 'member' else role end
     where group_id = p_group_id and member_id = p_member_id;
    return;
  end if;

  -- Whoever held it stands down (there can be several event organisers).
  if v_office <> 'event_organiser' then
    update public.group_members
       set office = null,
           role = case when role = 'admin' then 'member' else role end
     where group_id = p_group_id and office = v_office and member_id <> p_member_id;
  end if;

  update public.group_members
     set office = v_office,
         role = case when role = 'owner' then 'owner' when v_runs then 'admin' else 'member' end
   where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.set_group_office(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.set_group_office(bigint, uuid, text) to authenticated;

-- Messages (replaces 0143's).
create or replace function public.society_can_message(p_group_id bigint, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.society_can(p_group_id, p_user, 'messages');
$$;
revoke all on function public.society_can_message(bigint, uuid) from public, anon, authenticated;
grant execute on function public.society_can_message(bigint, uuid) to authenticated;


-- ============ 2. Money moves to the money area ============

drop policy if exists "own payment, or the officers" on public.society_outing_payments;
create policy "own payment, or the officers" on public.society_outing_payments
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (select 1 from public.society_outings o where o.id = outing_id and public.outing_money_officer(o.group_id, (select auth.uid())))
  );

drop policy if exists "officers read guest payments" on public.society_outing_guest_payments;
create policy "officers read guest payments" on public.society_outing_guest_payments
  for select to authenticated
  using (
    exists (
      select 1 from public.society_outing_guests g
        join public.society_outings o on o.id = g.outing_id
       where g.id = guest_id
         and (public.outing_money_officer(o.group_id, (select auth.uid())) or g.brought_by = (select auth.uid()))
    )
  );

do $$
declare
  v_policy text;
begin
  for v_policy in select policyname from pg_policies where schemaname = 'public' and tablename = 'society_outing_payment_claims' and cmd = 'SELECT' loop
    execute format('drop policy if exists %I on public.society_outing_payment_claims', v_policy);
  end loop;
end
$$;
create policy "own claim, or the treasurer" on public.society_outing_payment_claims
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (select 1 from public.society_outings o where o.id = outing_id and public.outing_money_officer(o.group_id, (select auth.uid())))
  );

-- As 0125, checked against the money area.
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
  if v_group is null or not public.outing_money_officer(v_group, me) then
    raise exception 'Only the treasurer, captain or secretary can mark payments.' using errcode = '42501';
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
    delete from public.society_outing_payment_claims where outing_id = p_outing_id and member_id = p_member;
  end if;
end;
$$;
revoke all on function public.mark_outing_paid(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.mark_outing_paid(bigint, uuid, text) to authenticated;

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
  if v_group is null or not public.outing_money_officer(v_group, me) then
    raise exception 'Only the treasurer, captain or secretary can mark payments.' using errcode = '42501';
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
  if v_group is null or not public.outing_money_officer(v_group, me) then
    raise exception 'Only the treasurer, captain or secretary can mark refunds.' using errcode = '42501';
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
    update public.society_outing_payments set status = 'transfer', marked_by = me, marked_at = now()
     where outing_id = p_outing_id and member_id = p_member;
  end if;
end;
$$;
revoke all on function public.mark_outing_refunded(bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.mark_outing_refunded(bigint, uuid, boolean) to authenticated;

-- As 0127, with the officer side checked against the money area.
create or replace function public.claim_outing_paid(p_outing_id bigint, p_method text, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_who uuid := coalesce(p_member, (select auth.uid()));
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or not public.is_group_member(o.group_id, me) then
    raise exception 'That outing isn''t available.';
  end if;
  if v_who <> me then
    if not public.outing_money_officer(o.group_id, me) then
      raise exception 'Only the treasurer, captain or secretary can change someone else''s payment.' using errcode = '42501';
    end if;
    if p_method is not null then
      raise exception 'Mark their payment instead.';
    end if;
  end if;

  if p_method is null then
    delete from public.society_outing_payment_claims where outing_id = p_outing_id and member_id = v_who;
    return;
  end if;

  if p_method not in ('revolut', 'transfer', 'cash') then
    raise exception 'Say how you paid: Revolut, bank transfer or cash.';
  end if;
  if o.status <> 'open' then raise exception 'This outing was cancelled.'; end if;
  if o.entry_fee_cents is null or o.entry_fee_cents = 0 then
    raise exception 'There''s nothing to pay for this one.';
  end if;
  if not exists (select 1 from public.society_outing_entries where outing_id = p_outing_id and member_id = me) then
    raise exception 'Join it first.';
  end if;
  if exists (select 1 from public.society_outing_payments where outing_id = p_outing_id and member_id = me) then
    raise exception 'You''re already marked as paid.';
  end if;

  insert into public.society_outing_payment_claims (outing_id, member_id, method)
  values (p_outing_id, me, p_method)
  on conflict (outing_id, member_id) do update set method = excluded.method, claimed_at = now();
end;
$$;
revoke all on function public.claim_outing_paid(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_outing_paid(bigint, text, uuid) to authenticated;


-- ============ 3. Handicaps area ============

create or replace function public.society_handicaps(p_group_id bigint)
returns table (
  member_id uuid,
  own_index numeric,
  indicator numeric,
  rounds integer,
  society_index numeric,
  society_index_set_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Only a society keeps handicaps.';
  end if;
  if not public.society_can(p_group_id, (select auth.uid()), 'handicaps') then
    raise exception 'Only the society''s captain, secretary and handicap secretary can see its handicaps.';
  end if;

  return query
    select m.member_id, p.handicap, i.indicator, i.rounds, m.society_index, m.society_index_set_at
      from public.group_members m
      left join public.member_private p on p.member_id = m.member_id
      cross join lateral public.handicap_indicator_of(m.member_id) i
     where m.group_id = p_group_id;
end;
$$;
revoke all on function public.society_handicaps(bigint) from public, anon, authenticated;
grant execute on function public.society_handicaps(bigint) to authenticated;

create or replace function public.set_society_handicap(p_group_id bigint, p_member_id uuid, p_index numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Only a society keeps handicaps.';
  end if;
  if not public.society_can(p_group_id, me, 'handicaps') then
    raise exception 'Only the society''s captain, secretary and handicap secretary can set handicaps.';
  end if;
  if not public.is_group_member(p_group_id, p_member_id) then
    raise exception 'They''re not in this society.';
  end if;
  if p_index is not null and (p_index < -10 or p_index > 54) then
    raise exception 'A handicap index is between +10 and 54.';
  end if;

  update public.group_members
     set society_index = round(p_index, 1),
         society_index_set_by = case when p_index is null then null else me end,
         society_index_set_at = case when p_index is null then null else now() end
   where group_id = p_group_id and member_id = p_member_id;
end;
$$;
revoke all on function public.set_society_handicap(bigint, uuid, numeric) from public, anon, authenticated;
grant execute on function public.set_society_handicap(bigint, uuid, numeric) to authenticated;

-- The handicap the society plays you off, who set it and when.
create or replace function public.my_society_handicap(p_group_id bigint)
returns table (society_index numeric, set_at timestamptz, set_by_name text)
language sql
stable
security definer
set search_path = public
as $$
  select m.society_index, m.society_index_set_at, nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '')
    from public.group_members m
    left join public.profiles p on p.id = m.society_index_set_by
   where m.group_id = p_group_id and m.member_id = (select auth.uid());
$$;
revoke all on function public.my_society_handicap(bigint) from public, anon, authenticated;
grant execute on function public.my_society_handicap(bigint) to authenticated;


-- ============ 4. Annual membership ============

create table if not exists public.society_membership_settings (
  group_id bigint primary key references public.groups (id) on delete cascade,
  enabled boolean not null default false,
  fee_cents integer check (fee_cents is null or fee_cents between 0 and 500000),
  -- The season starts on the 1st of this month and runs a year.
  season_start_month smallint not null default 1 check (season_start_month between 1 and 12),
  -- Days after the season starts by which it's due.
  due_after_days smallint not null default 30 check (due_after_days between 0 and 180),
  unpaid_policy text not null default 'allow' check (unpaid_policy in ('allow', 'block')),
  pay_revtag text check (pay_revtag is null or pay_revtag ~ '^[a-z0-9._-]{2,40}$'),
  pay_iban text check (pay_iban is null or pay_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  pay_account_name text check (pay_account_name is null or char_length(pay_account_name) <= 70),
  pay_cash boolean not null default true,
  pay_note text check (pay_note is null or char_length(pay_note) <= 200),
  updated_at timestamptz not null default now()
);

create table if not exists public.society_memberships (
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  -- The season, by the year it starts.
  season smallint not null check (season between 2000 and 2100),
  status text not null check (status in ('paid', 'honorary', 'lapsed')),
  method text check (method is null or method in ('cash', 'transfer', 'card')),
  marked_by uuid,
  marked_at timestamptz not null default now(),
  primary key (group_id, member_id, season)
);

create table if not exists public.society_membership_claims (
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  season smallint not null,
  method text not null check (method in ('revolut', 'transfer', 'cash')),
  claimed_at timestamptz not null default now(),
  primary key (group_id, member_id, season)
);

alter table public.society_membership_settings enable row level security;
alter table public.society_memberships enable row level security;
alter table public.society_membership_claims enable row level security;

drop policy if exists "group members read membership settings" on public.society_membership_settings;
create policy "group members read membership settings" on public.society_membership_settings
  for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));

drop policy if exists "own membership, or people and money" on public.society_memberships;
create policy "own membership, or people and money" on public.society_memberships
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or public.society_can(group_id, (select auth.uid()), 'money')
    or public.society_can(group_id, (select auth.uid()), 'people')
  );

drop policy if exists "own membership claim, or money" on public.society_membership_claims;
create policy "own membership claim, or money" on public.society_membership_claims
  for select to authenticated
  using (member_id = (select auth.uid()) or public.society_can(group_id, (select auth.uid()), 'money'));

revoke all on public.society_membership_settings, public.society_memberships, public.society_membership_claims from anon, authenticated;
grant select on public.society_membership_settings, public.society_memberships, public.society_membership_claims to authenticated;

-- The season a date falls in, by the year it starts.
create or replace function public.membership_season_of(p_start_month smallint, p_on date)
returns smallint
language sql
immutable
as $$
  select (extract(year from p_on)::integer - case when extract(month from p_on) < p_start_month then 1 else 0 end)::smallint;
$$;
revoke all on function public.membership_season_of(smallint, date) from public, anon, authenticated;

create or replace function public.membership_season_start(p_start_month smallint, p_season smallint)
returns date
language sql
immutable
as $$
  select make_date(p_season, p_start_month, 1);
$$;
revoke all on function public.membership_season_start(smallint, smallint) from public, anon, authenticated;

-- The season members are asked to pay for now: the current one, or from
-- 45 days before it starts, the next one.
create or replace function public.membership_billing_season(p_group_id bigint)
returns smallint
language sql
stable
security definer
set search_path = public
as $$
  select public.membership_season_of(s.season_start_month, ((now() at time zone 'Europe/Dublin')::date + 45))
    from public.society_membership_settings s where s.group_id = p_group_id;
$$;
revoke all on function public.membership_billing_season(bigint) from public, anon, authenticated;
grant execute on function public.membership_billing_season(bigint) to authenticated;

-- A member's status for a season: paid / honorary / lapsed / claimed /
-- unpaid. Honorary carries on from an earlier season.
create or replace function public.membership_status(p_group_id bigint, p_member uuid, p_season smallint)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status from public.society_memberships where group_id = p_group_id and member_id = p_member and season = p_season),
    (select 'honorary' from public.society_memberships where group_id = p_group_id and member_id = p_member and season < p_season
       and status = 'honorary' order by season desc limit 1),
    (select 'claimed' from public.society_membership_claims where group_id = p_group_id and member_id = p_member and season = p_season),
    'unpaid'
  );
$$;
revoke all on function public.membership_status(bigint, uuid, smallint) from public, anon, authenticated;

-- p: { enabled, fee_cents, season_start_month, due_after_days, unpaid_policy,
--      pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note }.
create or replace function public.save_membership_settings(p_group_id bigint, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_revtag text := nullif(lower(regexp_replace(btrim(coalesce(p ->> 'pay_revtag', '')), '^@', '')), '');
  v_iban text := nullif(upper(regexp_replace(coalesce(p ->> 'pay_iban', ''), '\s', '', 'g')), '');
  v_account text := nullif(btrim(coalesce(p ->> 'pay_account_name', '')), '');
  v_note text := nullif(btrim(coalesce(p ->> 'pay_note', '')), '');
  v_enabled boolean := coalesce((p ->> 'enabled')::boolean, false);
  v_fee integer := nullif(p ->> 'fee_cents', '')::integer;
  v_month smallint := coalesce(nullif(p ->> 'season_start_month', '')::smallint, 1);
  v_due smallint := coalesce(nullif(p ->> 'due_after_days', '')::smallint, 30);
  v_policy text := coalesce(nullif(p ->> 'unpaid_policy', ''), 'allow');
begin
  if (select kind from public.groups where id = p_group_id and hidden_at is null) is distinct from 'society' then
    raise exception 'Annual membership is for societies.';
  end if;
  if coalesce(public.group_role(p_group_id, me), '') not in ('owner', 'admin') then
    raise exception 'Only the captain or secretary can change membership.' using errcode = '42501';
  end if;
  if v_enabled and v_fee is null then raise exception 'Set the annual fee.'; end if;
  if v_fee is not null and (v_fee < 0 or v_fee > 500000) then raise exception 'The fee is between €0 and €5,000.'; end if;
  if v_month not between 1 and 12 then raise exception 'Choose the month the season starts.'; end if;
  if v_due not between 0 and 180 then raise exception 'It''s due within six months of the season starting.'; end if;
  if v_policy not in ('allow', 'block') then raise exception 'Choose what happens if someone hasn''t paid.'; end if;
  if v_revtag is not null and v_revtag !~ '^[a-z0-9._-]{2,40}$' then
    raise exception 'That Revolut username doesn''t look right — it''s the @name in Revolut, without spaces.';
  end if;
  if v_iban is not null and v_iban !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$' then raise exception 'That IBAN doesn''t look right.'; end if;
  if v_iban is not null and v_account is null then raise exception 'Add the name on the bank account.'; end if;
  if v_account is not null and char_length(v_account) > 70 then raise exception 'That account name is too long.'; end if;
  if v_note is not null and char_length(v_note) > 200 then raise exception 'The payment note is too long — 200 characters at most.'; end if;

  insert into public.society_membership_settings as s (group_id, enabled, fee_cents, season_start_month, due_after_days, unpaid_policy,
                                                       pay_revtag, pay_iban, pay_account_name, pay_cash, pay_note, updated_at)
  values (p_group_id, v_enabled, v_fee, v_month, v_due, v_policy, v_revtag, v_iban, v_account,
          coalesce((p ->> 'pay_cash')::boolean, true), v_note, now())
  on conflict (group_id) do update set
    enabled = excluded.enabled, fee_cents = excluded.fee_cents, season_start_month = excluded.season_start_month,
    due_after_days = excluded.due_after_days, unpaid_policy = excluded.unpaid_policy, pay_revtag = excluded.pay_revtag,
    pay_iban = excluded.pay_iban, pay_account_name = excluded.pay_account_name, pay_cash = excluded.pay_cash,
    pay_note = excluded.pay_note, updated_at = now();
end;
$$;
revoke all on function public.save_membership_settings(bigint, jsonb) from public, anon, authenticated;
grant execute on function public.save_membership_settings(bigint, jsonb) to authenticated;

-- Money: 'paid' (with method), 'honorary', 'lapsed', or null to clear.
create or replace function public.mark_membership(p_group_id bigint, p_member uuid, p_season smallint, p_status text, p_method text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
begin
  if not (public.society_can(p_group_id, me, 'money') or public.society_can(p_group_id, me, 'people')) then
    raise exception 'Only the treasurer, captain or secretary can mark membership.' using errcode = '42501';
  end if;
  if not public.is_group_member(p_group_id, p_member) then raise exception 'They''re not in this society.'; end if;
  if p_season is null or p_season not between 2000 and 2100 then raise exception 'Choose the season.'; end if;
  if p_status is not null and p_status not in ('paid', 'honorary', 'lapsed') then
    raise exception 'Mark them paid, honorary or lapsed.';
  end if;
  if p_status = 'paid' and coalesce(p_method, '') not in ('cash', 'transfer') then
    raise exception 'Say how they paid: cash or transfer.';
  end if;
  if p_status = 'paid' and not public.society_can(p_group_id, me, 'money') then
    raise exception 'Only the treasurer, captain or secretary can mark a payment.' using errcode = '42501';
  end if;
  if (select status = 'paid' and method = 'card' from public.society_memberships where group_id = p_group_id and member_id = p_member and season = p_season) then
    raise exception 'They paid by card — that can only be changed by a refund.';
  end if;
  if p_status is null then
    delete from public.society_memberships where group_id = p_group_id and member_id = p_member and season = p_season;
  else
    insert into public.society_memberships (group_id, member_id, season, status, method, marked_by)
    values (p_group_id, p_member, p_season, p_status, case when p_status = 'paid' then p_method end, me)
    on conflict (group_id, member_id, season) do update
      set status = excluded.status, method = excluded.method, marked_by = excluded.marked_by, marked_at = now();
    delete from public.society_membership_claims where group_id = p_group_id and member_id = p_member and season = p_season;
  end if;
end;
$$;
revoke all on function public.mark_membership(bigint, uuid, smallint, text, text) from public, anon, authenticated;
grant execute on function public.mark_membership(bigint, uuid, smallint, text, text) to authenticated;

-- The member: "I've paid my membership" (a method), or withdraw it (null).
-- With p_member, the treasurer clears someone's claim ("not received").
create or replace function public.claim_membership_paid(p_group_id bigint, p_method text, p_member uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_who uuid := coalesce(p_member, (select auth.uid()));
  s public.society_membership_settings%rowtype;
  v_season smallint := public.membership_billing_season(p_group_id);
begin
  if not public.is_group_member(p_group_id, me) then raise exception 'That society isn''t available.'; end if;
  select * into s from public.society_membership_settings where group_id = p_group_id;
  if not found or not s.enabled then raise exception 'This society has no annual membership.'; end if;
  if v_who <> me then
    if not public.society_can(p_group_id, me, 'money') then
      raise exception 'Only the treasurer, captain or secretary can change someone else''s payment.' using errcode = '42501';
    end if;
    if p_method is not null then raise exception 'Mark their membership instead.'; end if;
  end if;
  if p_method is null then
    delete from public.society_membership_claims where group_id = p_group_id and member_id = v_who and season = v_season;
    return;
  end if;
  if p_method not in ('revolut', 'transfer', 'cash') then raise exception 'Say how you paid: Revolut, bank transfer or cash.'; end if;
  if public.membership_status(p_group_id, me, v_season) in ('paid', 'honorary') then
    raise exception 'You''re already marked as paid.';
  end if;
  insert into public.society_membership_claims (group_id, member_id, season, method)
  values (p_group_id, me, v_season, p_method)
  on conflict (group_id, member_id, season) do update set method = excluded.method, claimed_at = now();
end;
$$;
revoke all on function public.claim_membership_paid(bigint, text, uuid) from public, anon, authenticated;
grant execute on function public.claim_membership_paid(bigint, text, uuid) to authenticated;

-- Blocks new entries for unpaid members after the due date, where the
-- society says so (replaces 0142's stub).
create or replace function public.society_entry_blocked(p_group_id bigint, p_member uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.society_membership_settings%rowtype;
  v_season smallint;
begin
  select * into s from public.society_membership_settings where group_id = p_group_id;
  if not found or not s.enabled or s.unpaid_policy <> 'block' or coalesce(s.fee_cents, 0) = 0 then return null; end if;
  v_season := public.membership_season_of(s.season_start_month, (now() at time zone 'Europe/Dublin')::date);
  if (now() at time zone 'Europe/Dublin')::date < public.membership_season_start(s.season_start_month, v_season) + s.due_after_days then
    return null;
  end if;
  if public.membership_status(p_group_id, p_member, v_season) in ('paid', 'honorary') then return null; end if;
  if public.society_can(p_group_id, p_member, 'events') then return null; end if;
  return 'Your membership for this season isn''t paid yet — pay it first, or ask the treasurer.';
end;
$$;
revoke all on function public.society_entry_blocked(bigint, uuid) from public, anon, authenticated;


-- ============ 5. What you owe ============

-- One row per thing: kind 'membership' | 'event' | 'guest', a label, the
-- amount, the event (if any), and whether you've said you've paid.
create or replace function public.my_society_dues(p_group_id bigint)
returns table (kind text, label text, amount_cents integer, outing_id bigint, plays_on date, claimed boolean, season smallint)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  s public.society_membership_settings%rowtype;
  v_season smallint;
  v_status text;
begin
  if not public.is_group_member(p_group_id, me) then return; end if;
  select * into s from public.society_membership_settings where group_id = p_group_id;
  if found and s.enabled and coalesce(s.fee_cents, 0) > 0 then
    v_season := public.membership_billing_season(p_group_id);
    v_status := public.membership_status(p_group_id, me, v_season);
    if v_status in ('unpaid', 'claimed') then
      kind := 'membership';
      label := 'Annual membership ' || case when s.season_start_month = 1 then v_season::text
                 else v_season::text || '–' || lpad(((v_season + 1) % 100)::text, 2, '0') end;
      amount_cents := s.fee_cents; outing_id := null; plays_on := null; claimed := v_status = 'claimed'; season := v_season;
      return next;
    end if;
  end if;

  return query
    select 'event', o.title, o.entry_fee_cents, o.id, o.plays_on,
           exists (select 1 from public.society_outing_payment_claims c where c.outing_id = o.id and c.member_id = me), null::smallint
      from public.society_outing_entries e
      join public.society_outings o on o.id = e.outing_id
     where e.member_id = me and o.group_id = p_group_id and o.status = 'open' and o.hidden_at is null
       and coalesce(o.entry_fee_cents, 0) > 0
       and not exists (select 1 from public.society_outing_payments p where p.outing_id = o.id and p.member_id = me)
     order by o.plays_on;

  return query
    select 'guest', g.name || ' · ' || o.title, coalesce(o.guest_fee_cents, o.entry_fee_cents), o.id, o.plays_on, false, null::smallint
      from public.society_outing_guests g
      join public.society_outings o on o.id = g.outing_id
     where g.brought_by = me and o.group_id = p_group_id and o.status = 'open' and o.hidden_at is null
       and coalesce(o.guest_fee_cents, o.entry_fee_cents, 0) > 0
       and not exists (select 1 from public.society_outing_guest_payments p where p.guest_id = g.id)
     order by o.plays_on;
end;
$$;
revoke all on function public.my_society_dues(bigint) from public, anon, authenticated;
grant execute on function public.my_society_dues(bigint) to authenticated;


-- ============ 6. The treasurer ============

-- The season's money as one JSON object:
--   { season, season_label, membership: { enabled, fee_cents, due, paid,
--     unpaid, claimed, honorary, lapsed, collected_cents, outstanding_cents },
--     events: [{ id, title, plays_on, status, fee_cents, entrants, paid,
--     waived, unpaid, claimed, collected_cents, outstanding_cents,
--     refunded_cents, played }], methods: { cash, transfer, card } (cents),
--     claims: number to confirm }
-- p_season null: the billing season.
create or replace function public.society_money(p_group_id bigint, p_season smallint default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.society_membership_settings%rowtype;
  v_month smallint := 1;
  v_season smallint;
  v_from date;
  v_to date;
  v_membership jsonb := null;
  v_events jsonb;
  v_methods jsonb;
  v_claims integer;
begin
  if not public.society_can(p_group_id, (select auth.uid()), 'money') then
    raise exception 'Only the treasurer, captain or secretary can see the money.' using errcode = '42501';
  end if;
  select * into s from public.society_membership_settings where group_id = p_group_id;
  if found then v_month := s.season_start_month; end if;
  v_season := coalesce(p_season, case when found and s.enabled then public.membership_billing_season(p_group_id)
                                      else public.membership_season_of(v_month, (now() at time zone 'Europe/Dublin')::date) end);
  v_from := public.membership_season_start(v_month, v_season);
  v_to := (v_from + interval '1 year')::date;

  if found and s.enabled then
    with st as (
      select public.membership_status(p_group_id, m.member_id, v_season) as status,
             (select method from public.society_memberships x where x.group_id = p_group_id and x.member_id = m.member_id and x.season = v_season) as method
        from public.group_members m where m.group_id = p_group_id
    )
    select jsonb_build_object(
      'enabled', true, 'fee_cents', s.fee_cents, 'due', v_from + s.due_after_days,
      'paid', count(*) filter (where status = 'paid'),
      'unpaid', count(*) filter (where status = 'unpaid'),
      'claimed', count(*) filter (where status = 'claimed'),
      'honorary', count(*) filter (where status = 'honorary'),
      'lapsed', count(*) filter (where status = 'lapsed'),
      'collected_cents', coalesce(s.fee_cents, 0) * count(*) filter (where status = 'paid'),
      'outstanding_cents', coalesce(s.fee_cents, 0) * count(*) filter (where status in ('unpaid', 'claimed')),
      'cash_cents', coalesce(s.fee_cents, 0) * count(*) filter (where status = 'paid' and method = 'cash'),
      'transfer_cents', coalesce(s.fee_cents, 0) * count(*) filter (where status = 'paid' and method = 'transfer'),
      'card_cents', coalesce(s.fee_cents, 0) * count(*) filter (where status = 'paid' and method = 'card')
    ) into v_membership from st;
  end if;

  with ev as (
    select o.id, o.title, o.plays_on, o.status, coalesce(o.entry_fee_cents, 0) as fee,
           coalesce(o.guest_fee_cents, o.entry_fee_cents, 0) as guest_fee
      from public.society_outings o
     where o.group_id = p_group_id and o.hidden_at is null and o.plays_on >= v_from and o.plays_on < v_to
       and coalesce(o.entry_fee_cents, 0) > 0
  ), seats as (
    select ev.id, ev.fee as amount, p.status as paid
      from ev join public.society_outing_entries e on e.outing_id = ev.id
      left join public.society_outing_payments p on p.outing_id = ev.id and p.member_id = e.member_id
    union all
    select ev.id, ev.guest_fee, gp.status
      from ev join public.society_outing_guests g on g.outing_id = ev.id
      left join public.society_outing_guest_payments gp on gp.guest_id = g.id
  ), per as (
    select ev.id, ev.title, ev.plays_on, ev.status, ev.fee,
           count(seats.id) filter (where true) as entrants,
           count(*) filter (where seats.paid in ('cash', 'transfer', 'card')) as paid,
           count(*) filter (where seats.paid = 'waived') as waived,
           count(seats.id) filter (where seats.paid is null) as unpaid,
           coalesce(sum(seats.amount) filter (where seats.paid in ('cash', 'transfer', 'card')), 0) as collected,
           coalesce(sum(seats.amount) filter (where seats.paid is null and seats.id is not null and ev.status = 'open'), 0) as outstanding,
           (select count(*) from public.society_outing_payment_claims c where c.outing_id = ev.id) as claimed,
           (select ev.fee * count(*) from public.society_outing_payments r where r.outing_id = ev.id and r.status = 'refunded') as refunded
      from ev left join seats on seats.id = ev.id
     group by ev.id, ev.title, ev.plays_on, ev.status, ev.fee
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'plays_on', plays_on, 'status', status, 'fee_cents', fee,
           'entrants', entrants, 'paid', paid, 'waived', waived, 'unpaid', unpaid, 'claimed', claimed,
           'collected_cents', collected, 'outstanding_cents', outstanding, 'refunded_cents', refunded,
           'played', plays_on < (now() at time zone 'Europe/Dublin')::date
         ) order by plays_on desc), '[]'::jsonb)
    into v_events from per;

  select jsonb_build_object(
           'cash', coalesce(sum(a) filter (where m = 'cash'), 0),
           'transfer', coalesce(sum(a) filter (where m = 'transfer'), 0),
           'card', coalesce(sum(a) filter (where m = 'card'), 0))
    into v_methods
    from (
      select o.entry_fee_cents as a, p.status as m
        from public.society_outing_payments p join public.society_outings o on o.id = p.outing_id
       where o.group_id = p_group_id and o.hidden_at is null and o.plays_on >= v_from and o.plays_on < v_to
         and p.status in ('cash', 'transfer', 'card')
      union all
      select coalesce(o.guest_fee_cents, o.entry_fee_cents), gp.status
        from public.society_outing_guest_payments gp
        join public.society_outing_guests g on g.id = gp.guest_id
        join public.society_outings o on o.id = g.outing_id
       where o.group_id = p_group_id and o.hidden_at is null and o.plays_on >= v_from and o.plays_on < v_to
         and gp.status in ('cash', 'transfer')
    ) x;
  if v_membership is not null then
    v_methods := jsonb_build_object(
      'cash', (v_methods ->> 'cash')::bigint + (v_membership ->> 'cash_cents')::bigint,
      'transfer', (v_methods ->> 'transfer')::bigint + (v_membership ->> 'transfer_cents')::bigint,
      'card', (v_methods ->> 'card')::bigint + (v_membership ->> 'card_cents')::bigint);
  end if;

  select (select count(*) from public.society_outing_payment_claims c join public.society_outings o on o.id = c.outing_id
           where o.group_id = p_group_id and o.status = 'open')
       + (select count(*) from public.society_membership_claims c where c.group_id = p_group_id and c.season = v_season)
    into v_claims;

  return jsonb_build_object(
    'season', v_season,
    'season_label', case when v_month = 1 then v_season::text else v_season::text || '–' || lpad(((v_season + 1) % 100)::text, 2, '0') end,
    'season_from', v_from, 'season_to', v_to - 1,
    'membership', coalesce(v_membership, jsonb_build_object('enabled', false)),
    'events', v_events, 'methods', v_methods, 'claims', v_claims);
end;
$$;
revoke all on function public.society_money(bigint, smallint) from public, anon, authenticated;
grant execute on function public.society_money(bigint, smallint) to authenticated;

-- "Says they've paid", across the society, for the treasurer to confirm.
create or replace function public.society_payment_claims(p_group_id bigint)
returns table (kind text, outing_id bigint, title text, member_id uuid, name text, method text, amount_cents integer, season smallint, claimed_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.society_can(p_group_id, (select auth.uid()), 'money') then
    raise exception 'Only the treasurer, captain or secretary can see payments.' using errcode = '42501';
  end if;
  return query
    select 'event', o.id, o.title, c.member_id, btrim(concat_ws(' ', p.first_name, p.last_name)), c.method, o.entry_fee_cents, null::smallint, c.claimed_at
      from public.society_outing_payment_claims c
      join public.society_outings o on o.id = c.outing_id
      join public.profiles p on p.id = c.member_id
     where o.group_id = p_group_id and o.status = 'open'
    union all
    select 'membership', null, 'Membership', c.member_id, btrim(concat_ws(' ', p.first_name, p.last_name)), c.method, s.fee_cents, c.season, c.claimed_at
      from public.society_membership_claims c
      join public.society_membership_settings s on s.group_id = c.group_id
      join public.profiles p on p.id = c.member_id
     where c.group_id = p_group_id
    order by 9;
end;
$$;
revoke all on function public.society_payment_claims(bigint) from public, anon, authenticated;
grant execute on function public.society_payment_claims(bigint) to authenticated;


-- ============ 7. Members ============

-- The captain and secretary (people) see everything here; the treasurer
-- (money) sees names, offices and membership status, without handicaps.
create or replace function public.society_member_list(p_group_id bigint)
returns table (member_id uuid, first_name text, last_name text, role text, office text, joined_at timestamptz,
               own_index numeric, society_index numeric, membership text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  v_people boolean := public.society_can(p_group_id, me, 'people');
  v_handicaps boolean := public.society_can(p_group_id, me, 'handicaps');
  v_season smallint := public.membership_billing_season(p_group_id);
  v_enabled boolean := coalesce((select enabled from public.society_membership_settings where group_id = p_group_id), false);
begin
  if not (v_people or public.society_can(p_group_id, me, 'money')) then
    raise exception 'Only the captain, secretary or treasurer can see the members list.' using errcode = '42501';
  end if;
  return query
    select m.member_id, p.first_name, p.last_name, m.role, m.office, m.joined_at,
           case when v_handicaps then mp.handicap end,
           case when v_handicaps then m.society_index end,
           case when v_enabled then public.membership_status(p_group_id, m.member_id, v_season) end
      from public.group_members m
      join public.profiles p on p.id = m.member_id
      left join public.member_private mp on mp.member_id = m.member_id
     where m.group_id = p_group_id
     order by case when m.office is not null or m.role = 'owner' then 0 else 1 end, p.first_name, p.last_name;
end;
$$;
revoke all on function public.society_member_list(bigint) from public, anon, authenticated;
grant execute on function public.society_member_list(bigint) to authenticated;


-- ============ 8. Messages and reminders about membership ============

create or replace function public.society_audience(p_group_id bigint, p_audience text, p_outing_id bigint)
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_season smallint;
begin
  if p_audience = 'everyone' then
    return query select m.member_id from public.group_members m where m.group_id = p_group_id;
  elsif p_audience = 'entrants' then
    return query select e.member_id from public.society_outing_entries e
      join public.society_outings o on o.id = e.outing_id
     where o.id = p_outing_id and o.group_id = p_group_id;
  elsif p_audience = 'waiting' then
    return query select q.member_id from public.society_outing_queue q
      join public.society_outings o on o.id = q.outing_id
     where o.id = p_outing_id and o.group_id = p_group_id;
  elsif p_audience = 'fees_unpaid' then
    return query select distinct e.member_id from public.society_outing_entries e
      join public.society_outings o on o.id = e.outing_id
     where o.group_id = p_group_id and o.status = 'open' and coalesce(o.entry_fee_cents, 0) > 0
       and (case when p_outing_id is null then o.plays_on >= (now() at time zone 'Europe/Dublin')::date else o.id = p_outing_id end)
       and not exists (select 1 from public.society_outing_payments p where p.outing_id = o.id and p.member_id = e.member_id);
  elsif p_audience = 'membership_unpaid' then
    if not coalesce((select enabled from public.society_membership_settings where group_id = p_group_id), false) then
      raise exception 'This society has no annual membership.';
    end if;
    v_season := public.membership_billing_season(p_group_id);
    return query select m.member_id from public.group_members m
     where m.group_id = p_group_id and public.membership_status(p_group_id, m.member_id, v_season) = 'unpaid';
  elsif p_audience = 'committee' then
    return query select m.member_id from public.group_members m
     where m.group_id = p_group_id and (m.role in ('owner', 'admin') or m.office is not null);
  else
    raise exception 'Choose who it''s for.';
  end if;
end;
$$;
revoke all on function public.society_audience(bigint, text, bigint) from public, anon, authenticated;

-- A reminder to one member about their membership (the treasurer's "Remind").
create or replace function public.remind_membership(p_group_id bigint, p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season smallint := public.membership_billing_season(p_group_id);
begin
  if not public.society_can(p_group_id, (select auth.uid()), 'money') then
    raise exception 'Only the treasurer, captain or secretary can send reminders.' using errcode = '42501';
  end if;
  if v_season is null or public.membership_status(p_group_id, p_member, v_season) <> 'unpaid' then
    raise exception 'They don''t owe membership.';
  end if;
  perform public.queue_society_alert(p_group_id, null, p_member, 'membership_due',
           jsonb_build_object('season', v_season, 'fee_cents', (select fee_cents from public.society_membership_settings where group_id = p_group_id)),
           'membership_due:' || v_season || ':' || (now() at time zone 'Europe/Dublin')::date);
end;
$$;
revoke all on function public.remind_membership(bigint, uuid) from public, anon, authenticated;
grant execute on function public.remind_membership(bigint, uuid) to authenticated;

-- 0143's sweep, plus membership reminders: a month before the season
-- starts, the day it starts, and ten days before it's due — daytime only.
create or replace function public.society_reminder_sweep()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_local timestamp := now() at time zone 'Europe/Dublin';
  v_today date := (now() at time zone 'Europe/Dublin')::date;
  v_before integer := (select count(*) from public.society_alerts);
  s record;
  v_season smallint;
  v_start date;
  v_step text;
begin
  perform public.queue_society_alert(o.group_id, o.id, m.member_id, 'entries_closing',
           jsonb_build_object('title', o.title, 'plays_on', o.plays_on,
                              'closes_at', coalesce(o.entries_close_at, public.outing_entries_close_at(o.plays_on))),
           'entries_closing:' || o.id)
     from public.society_outings o
     join public.group_members m on m.group_id = o.group_id
    where o.status = 'open' and o.match_day_id is null and o.hidden_at is null
      and coalesce(o.entries_close_at, public.outing_entries_close_at(o.plays_on)) between v_now and v_now + interval '24 hours'
      and o.created_at < v_now - interval '1 day'
      and not exists (select 1 from public.society_outing_entries e where e.outing_id = o.id and e.member_id = m.member_id)
      and not exists (select 1 from public.society_outing_queue q where q.outing_id = o.id and q.member_id = m.member_id);

  if extract(hour from v_local) between 17 and 22 then
    perform public.queue_society_alert(o.group_id, o.id, e.member_id, 'tee_time_tomorrow',
             jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'course', o.course_name,
                                'tee_time', e.tee_time, 'tee_group', e.tee_group, 'arrive_by', o.arrive_by),
             'tee_time_tomorrow:' || o.id)
       from public.society_outings o
       join public.society_outing_entries e on e.outing_id = o.id
      where o.status = 'open' and o.hidden_at is null and o.plays_on = v_today + 1
        and o.draw_published_at is not null and e.tee_group is not null;
  end if;

  if extract(hour from v_local) between 10 and 19 then
    perform public.queue_society_alert(o.group_id, o.id, e.member_id, 'payment_due',
             jsonb_build_object('title', o.title, 'plays_on', o.plays_on, 'fee_cents', o.entry_fee_cents),
             'payment_due:' || o.id || ':' || to_char(v_today, 'IYYY-IW'))
       from public.society_outings o
       join public.society_outing_entries e on e.outing_id = o.id
      where o.status = 'open' and o.hidden_at is null and coalesce(o.entry_fee_cents, 0) > 0
        and o.plays_on between v_today + 1 and v_today + 7
        and not exists (select 1 from public.society_outing_payments p where p.outing_id = o.id and p.member_id = e.member_id)
        and not exists (select 1 from public.society_outing_payment_claims c where c.outing_id = o.id and c.member_id = e.member_id);

    for s in
      select ms.* from public.society_membership_settings ms
        join public.groups g on g.id = ms.group_id and g.hidden_at is null
       where ms.enabled and coalesce(ms.fee_cents, 0) > 0
    loop
      v_season := public.membership_billing_season(s.group_id);
      v_start := public.membership_season_start(s.season_start_month, v_season);
      v_step := case
        when v_today between v_start - 31 and v_start - 25 then 'opens'
        when v_today between v_start and v_start + 6 and s.due_after_days > 10 then 'started'
        when v_today between v_start + s.due_after_days - 10 and v_start + s.due_after_days then 'due_soon'
      end;
      continue when v_step is null;
      perform public.queue_society_alert(s.group_id, null, m.member_id, 'membership_due',
               jsonb_build_object('season', v_season, 'fee_cents', s.fee_cents, 'step', v_step,
                                  'due', v_start + s.due_after_days),
               'membership_due:' || v_season || ':' || v_step)
         from public.group_members m
        where m.group_id = s.group_id and public.membership_status(s.group_id, m.member_id, v_season) = 'unpaid';
    end loop;
  end if;

  return (select count(*) from public.society_alerts) - v_before;
end;
$$;
revoke all on function public.society_reminder_sweep() from public, anon, authenticated;


-- ============ 9. The export log ============

create table if not exists public.society_exports (
  id bigint generated always as identity primary key,
  group_id bigint not null references public.groups (id) on delete cascade,
  member_id uuid references public.profiles (id) on delete set null,
  file text not null check (char_length(file) <= 40),
  outing_id bigint,
  rows integer not null,
  created_at timestamptz not null default now()
);
create index if not exists society_exports_group_idx on public.society_exports (group_id, created_at desc);
alter table public.society_exports enable row level security;
drop policy if exists "the committee reads the export log" on public.society_exports;
create policy "the committee reads the export log" on public.society_exports
  for select to authenticated
  using (public.society_can(group_id, (select auth.uid()), 'people') or public.society_can(group_id, (select auth.uid()), 'money'));
revoke all on public.society_exports from anon, authenticated;
grant select on public.society_exports to authenticated;

notify pgrst, 'reload schema';
