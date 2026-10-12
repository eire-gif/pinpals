-- How members pay for an outing, and "I've paid" (12 Oct 2026).
-- Design: claude/outing-payments-and-sharing.md. Builds on 0125 and 0126.
--
-- WHAT CHANGES
--
--   1. The captain or secretary can say how to pay on each outing or trip:
--        pay_revtag        a Revolut username (revtag), shown as a button
--                          that opens revolut.me/<revtag>
--        pay_iban          an IBAN for a bank transfer
--        pay_account_name  the name on that account
--        pay_cash          cash is fine (default true)
--        pay_note          e.g. "By 1 May, please"
--      These are on the outing row, so exactly the society's members can
--      read them (0125's policy). Nobody else ever sees them.
--
--   2. A member can tell the officers they've paid ("I've paid by Revolut").
--      That is a claim, not a payment: it sits in its own table until an
--      officer marks the payment (0125's mark_outing_paid), and only the
--      member and the officers can see it. Officers can clear a claim
--      ("not received"); the member can withdraw it.
--
-- Nothing moves money. PinPals never sees the transfer.
--
-- Rollback:
--   drop table if exists public.society_outing_payment_claims;
--   drop function if exists public.claim_outing_paid(bigint, text, uuid);
--   alter table public.society_outings drop column if exists pay_revtag, drop column if exists pay_iban,
--     drop column if exists pay_account_name, drop column if exists pay_cash, drop column if exists pay_note;
--   (and restore 0126's save_outing and outing_entry_left)


-- ============ Payment details on the outing ============

alter table public.society_outings
  add column if not exists pay_revtag text check (pay_revtag is null or pay_revtag ~ '^[a-z0-9._-]{2,40}$'),
  add column if not exists pay_iban text check (pay_iban is null or pay_iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  add column if not exists pay_account_name text check (pay_account_name is null or char_length(btrim(pay_account_name)) between 1 and 70),
  add column if not exists pay_cash boolean not null default true,
  add column if not exists pay_note text check (pay_note is null or char_length(btrim(pay_note)) between 1 and 200);


-- ============ "I've paid" ============

create table if not exists public.society_outing_payment_claims (
  outing_id bigint not null references public.society_outings (id) on delete cascade,
  member_id uuid not null references public.profiles (id) on delete cascade,
  method text not null check (method in ('revolut', 'transfer', 'cash')),
  claimed_at timestamptz not null default now(),
  primary key (outing_id, member_id)
);

alter table public.society_outing_payment_claims enable row level security;

-- Your own claim; officers see the society's (like payments, 0125).
drop policy if exists "own claim, or the officers" on public.society_outing_payment_claims;
create policy "own claim, or the officers" on public.society_outing_payment_claims
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or exists (
      select 1 from public.society_outings o
       where o.id = outing_id and public.outing_officer(o.group_id, (select auth.uid()))
    )
  );

revoke all on public.society_outing_payment_claims from anon, authenticated;
grant select on public.society_outing_payment_claims to authenticated;

-- p_method 'revolut' / 'transfer' / 'cash': "I've paid this way". null:
-- withdraw it. With p_member (officers only): clear someone's claim
-- ("not received"); officers can't make a claim for someone else.
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
    if not public.outing_officer(o.group_id, me) then
      raise exception 'Only the captain or secretary can change someone else''s payment.' using errcode = '42501';
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


-- ============ Leaving takes away your claim too (replaces 0126's) ============

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
  delete from public.society_outing_payment_claims c
   where c.outing_id = old.outing_id and c.member_id = old.member_id;
  return old;
end;
$$;
revoke all on function public.outing_entry_left() from public, anon, authenticated;


-- ============ Setting up an outing (replaces 0126's) ============

-- p: as 0126, plus { pay_revtag?, pay_iban?, pay_account_name?, pay_cash?, pay_note? }.
-- A revtag may start with "@"; an IBAN may have spaces. Both are tidied here.
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
