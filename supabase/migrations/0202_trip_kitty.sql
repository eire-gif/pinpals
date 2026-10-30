-- 0202 — The trip kitty (30 Oct 2026, claude/trip-kitty.md)
--
-- Asked by Eire, 30 Oct 2026 (canvas "PinPals Next Ideas", row 3, "build
-- it"). On a trip everyone pays for something — green fees, taxis, dinner —
-- on different cards. The kitty keeps a running list of who paid what and
-- who it's split between, everyone's balance, and the fewest payments that
-- square everyone. PinPals never holds the money: people pay each other by
-- Revolut, bank or cash and tick it off.
--
--   trip_kitty_expenses  something paid: what, how much, by whom
--   trip_kitty_shares    who it's split between (equally)
--   trip_kitty_payments  money paid back between two people, ticked off
--
-- Balances and the settle-up are worked out on the phone
-- (lib/kitty-rules.ts); nothing here is a running total.
--
-- WHO: members of the trip's group see it all and add what they paid (or
-- what someone else paid). An expense can be changed or taken off by
-- whoever added it, whoever paid it, or whoever runs the trip. A payment
-- is ticked by either of the two people, or whoever runs the trip, and
-- unticked by them too. Only for overnight and abroad trips.
--
-- No primary key here is made of foreign keys alone (see 0199). No drops.
--
-- Rollback:
--   drop function if exists public.trip_kitty_save(bigint, bigint, jsonb), public.trip_kitty_delete(bigint),
--     public.trip_kitty_pay(bigint, uuid, uuid, integer), public.trip_kitty_unpay(bigint);
--   drop table if exists public.trip_kitty_payments, public.trip_kitty_shares, public.trip_kitty_expenses;

create table if not exists public.trip_kitty_expenses (
  id bigint generated always as identity primary key,
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  group_id bigint not null references public.groups (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  category text not null default 'other' check (category in ('golf', 'travel', 'food', 'stay', 'drinks', 'other')),
  amount_cents integer not null check (amount_cents between 1 and 10000000),
  paid_by uuid not null references public.profiles (id) on delete cascade,
  spent_on date not null default current_date,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists trip_kitty_expenses_outing_idx on public.trip_kitty_expenses (outing_id, spent_on);
create index if not exists trip_kitty_expenses_paid_by_idx on public.trip_kitty_expenses (paid_by);
create index if not exists trip_kitty_expenses_group_idx on public.trip_kitty_expenses (group_id);

create table if not exists public.trip_kitty_shares (
  id bigint generated always as identity primary key,
  expense_id bigint not null references public.trip_kitty_expenses (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  constraint trip_kitty_shares_member_key unique (expense_id, member_id)
);
create index if not exists trip_kitty_shares_member_idx on public.trip_kitty_shares (member_id);

create table if not exists public.trip_kitty_payments (
  id bigint generated always as identity primary key,
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  group_id bigint not null references public.groups (id) on delete cascade,
  from_member uuid not null references public.profiles (id) on delete cascade,
  to_member uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents between 1 and 10000000),
  marked_by uuid references public.profiles (id) on delete set null,
  paid_at timestamptz not null default now(),
  check (from_member <> to_member)
);
create index if not exists trip_kitty_payments_outing_idx on public.trip_kitty_payments (outing_id);
create index if not exists trip_kitty_payments_from_idx on public.trip_kitty_payments (from_member);
create index if not exists trip_kitty_payments_to_idx on public.trip_kitty_payments (to_member);
create index if not exists trip_kitty_payments_group_idx on public.trip_kitty_payments (group_id);

comment on table public.trip_kitty_expenses is 'Trip kitty (0202): something paid on a trip, by whom. Split equally between its trip_kitty_shares. Written only through trip_kitty_save().';
comment on table public.trip_kitty_payments is 'Trip kitty (0202): money paid back between two people on a trip, ticked off. PinPals never holds the money.';

alter table public.trip_kitty_expenses enable row level security;
alter table public.trip_kitty_shares enable row level security;
alter table public.trip_kitty_payments enable row level security;
revoke all on public.trip_kitty_expenses, public.trip_kitty_shares, public.trip_kitty_payments from anon;
revoke insert, update, delete, truncate, references, trigger on public.trip_kitty_expenses, public.trip_kitty_shares, public.trip_kitty_payments from authenticated;
grant select on public.trip_kitty_expenses, public.trip_kitty_shares, public.trip_kitty_payments to authenticated;

create policy "Trip members read the kitty" on public.trip_kitty_expenses
  for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));
create policy "Trip members read the kitty's shares" on public.trip_kitty_shares
  for select to authenticated using (
    exists (select 1 from public.trip_kitty_expenses e where e.id = expense_id and public.is_group_member(e.group_id, (select auth.uid())))
  );
create policy "Trip members read the kitty's payments" on public.trip_kitty_payments
  for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));

-- Add (p_id null) or change an expense.
-- p: { title, category, amount_cents, paid_by, spent_on?, shares: [member ids] }
create or replace function public.trip_kitty_save(p_outing_id bigint, p_id bigint, p jsonb)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  e public.trip_kitty_expenses%rowtype;
  v_title text := btrim(coalesce(p ->> 'title', ''));
  v_cat text := coalesce(nullif(p ->> 'category', ''), 'other');
  v_amount integer := nullif(p ->> 'amount_cents', '')::integer;
  v_paid_by uuid := nullif(p ->> 'paid_by', '')::uuid;
  v_on date := coalesce(nullif(p ->> 'spent_on', '')::date, current_date);
  v_shares uuid[];
  v_id bigint;
  m uuid;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or me is null or not public.is_group_member(o.group_id, me) then
    raise exception 'Only people on the trip can add to its kitty.' using errcode = '42501';
  end if;
  if coalesce(o.kind, 'day') = 'day' then raise exception 'The kitty is for overnight and abroad trips.'; end if;
  if char_length(v_title) not between 1 and 80 then raise exception 'Say what it was for (80 letters at most).'; end if;
  if v_cat not in ('golf', 'travel', 'food', 'stay', 'drinks', 'other') then raise exception 'Pick what kind of spend it was.'; end if;
  if v_amount is null or v_amount not between 1 and 10000000 then raise exception 'Put in the amount, up to €100,000.'; end if;
  if v_paid_by is null or not public.is_group_member(o.group_id, v_paid_by) then raise exception 'Who paid? Someone on the trip.'; end if;
  if jsonb_typeof(p -> 'shares') <> 'array' then raise exception 'Split it between at least one person.'; end if;
  select array_agg(distinct x::uuid) into v_shares from jsonb_array_elements_text(p -> 'shares') x;
  if v_shares is null or array_length(v_shares, 1) not between 1 and 80 then raise exception 'Split it between at least one person.'; end if;
  foreach m in array v_shares loop
    if not public.is_group_member(o.group_id, m) then raise exception 'Split it only between people on the trip.'; end if;
  end loop;

  if p_id is null then
    insert into public.trip_kitty_expenses (outing_id, group_id, title, category, amount_cents, paid_by, spent_on, created_by)
    values (p_outing_id, o.group_id, v_title, v_cat, v_amount, v_paid_by, v_on, me)
    returning id into v_id;
  else
    select * into e from public.trip_kitty_expenses where id = p_id and outing_id = p_outing_id;
    if not found then raise exception 'That has gone from the kitty.'; end if;
    if me is distinct from e.created_by and me is distinct from e.paid_by and not public.outing_officer(o.group_id, me) then
      raise exception 'Only whoever added it, whoever paid, or whoever runs the trip can change it.' using errcode = '42501';
    end if;
    update public.trip_kitty_expenses
       set title = v_title, category = v_cat, amount_cents = v_amount, paid_by = v_paid_by, spent_on = v_on, updated_at = now()
     where id = p_id;
    delete from public.trip_kitty_shares where expense_id = p_id and not (member_id = any (v_shares));
    v_id := p_id;
  end if;
  insert into public.trip_kitty_shares (expense_id, member_id)
  select v_id, x from unnest(v_shares) x
  on conflict (expense_id, member_id) do nothing;
  return v_id;
end;
$$;
revoke all on function public.trip_kitty_save(bigint, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.trip_kitty_save(bigint, bigint, jsonb) to authenticated;

create or replace function public.trip_kitty_delete(p_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  e public.trip_kitty_expenses%rowtype;
begin
  select * into e from public.trip_kitty_expenses where id = p_id;
  if not found then return; end if;
  if me is null or (me is distinct from e.created_by and me is distinct from e.paid_by and not public.outing_officer(e.group_id, me)) then
    raise exception 'Only whoever added it, whoever paid, or whoever runs the trip can take it off.' using errcode = '42501';
  end if;
  delete from public.trip_kitty_expenses where id = p_id;
end;
$$;
revoke all on function public.trip_kitty_delete(bigint) from public, anon, authenticated;
grant execute on function public.trip_kitty_delete(bigint) to authenticated;

-- "Paid": p_from paid p_to back. Either of them, or whoever runs the trip.
create or replace function public.trip_kitty_pay(p_outing_id bigint, p_from uuid, p_to uuid, p_amount_cents integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  o public.society_outings%rowtype;
  v_id bigint;
begin
  select * into o from public.society_outings where id = p_outing_id;
  if not found or me is null or not public.is_group_member(o.group_id, me) then
    raise exception 'Only people on the trip can tick off payments.' using errcode = '42501';
  end if;
  if me is distinct from p_from and me is distinct from p_to and not public.outing_officer(o.group_id, me) then
    raise exception 'Only the two of them, or whoever runs the trip, can tick this off.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from = p_to
     or not public.is_group_member(o.group_id, p_from) or not public.is_group_member(o.group_id, p_to) then
    raise exception 'That payment doesn''t look right.';
  end if;
  if p_amount_cents is null or p_amount_cents not between 1 and 10000000 then
    raise exception 'That amount doesn''t look right.';
  end if;
  insert into public.trip_kitty_payments (outing_id, group_id, from_member, to_member, amount_cents, marked_by)
  values (p_outing_id, o.group_id, p_from, p_to, p_amount_cents, me)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.trip_kitty_pay(bigint, uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.trip_kitty_pay(bigint, uuid, uuid, integer) to authenticated;

create or replace function public.trip_kitty_unpay(p_payment_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  pay public.trip_kitty_payments%rowtype;
begin
  select * into pay from public.trip_kitty_payments where id = p_payment_id;
  if not found then return; end if;
  if me is null or (me is distinct from pay.from_member and me is distinct from pay.to_member
                    and me is distinct from pay.marked_by and not public.outing_officer(pay.group_id, me)) then
    raise exception 'Only the two of them, or whoever runs the trip, can undo this.' using errcode = '42501';
  end if;
  delete from public.trip_kitty_payments where id = p_payment_id;
end;
$$;
revoke all on function public.trip_kitty_unpay(bigint) from public, anon, authenticated;
grant execute on function public.trip_kitty_unpay(bigint) to authenticated;
