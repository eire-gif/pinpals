-- 0114 — Buyer Protection and the handover code (Oct 2026)
--
-- Decisions (Eire, 10 Oct 2026):
--   * The buyer's fee becomes "Buyer Protection": €0.70 + 5% of the item
--     price (was a flat 7%). Sellers still list free and receive the full
--     item price (plus postage they charged).
--   * The buyer's money is HELD until the item changes hands:
--       collection — the buyer reads a 4-digit handover code to the seller
--                    at the meet-up; the seller enters it; money released.
--       post       — the seller marks it posted; the buyer taps "It arrived
--                    — all OK"; money released.
--     Automatic release when nobody reports a problem: 3 days after an
--     agreed meet-up time, or 14 days after posting.
--   * A buyer who reports a problem freezes the release until staff decide.
--
-- Money movement stays outside the database. Payments become separate
-- charges and transfers: the PaymentIntent is created on the platform with
-- no transfer_data (src/app/dashboard/orders/[id]/actions.ts), and the
-- website creates the transfer to the seller when an order is released
-- (src/lib/marketplace-release.ts). These functions only decide WHEN an
-- order may be released and record that it was.
--
-- Orders reuse payout_status: 'held' while the money waits, then 'pending'
-- (transfer made) and 'paid_out' (swept into a payout) as before.
--
-- The handover code is the buyer's alone: it lives in its own table that
-- only the buyer can read. The seller never sees it — they type what the
-- buyer tells them, and order_confirm_handover() checks it.
--
-- Rollback:
--   drop function if exists public.order_set_meetup(bigint, timestamptz, text);
--   drop function if exists public.order_confirm_handover(bigint, text);
--   drop function if exists public.order_mark_posted(bigint, text);
--   drop function if exists public.order_confirm_received(bigint);
--   drop function if exists public.order_flag_problem(bigint);
--   drop function if exists public.orders_due_for_release();
--   drop trigger if exists orders_handover_on_paid on public.orders;
--   drop trigger if exists orders_handover_code_on_paid on public.orders;
--   drop function if exists public.orders_handover_on_paid(), public.orders_handover_code_on_paid();
--   drop table if exists public.order_handover_codes;
--   alter table public.orders drop column if exists fulfilment_status, ... (the columns below);
--   re-run platform_fee_rate() from 0051 and the fee lines in offer_action / create_purchase_order.

-- ---------------------------------------------------------------------------
-- The fee
-- ---------------------------------------------------------------------------

create or replace function public.platform_fee_eur(p_amount_eur numeric)
returns numeric
language sql
immutable
set search_path = public
as $$
  select round(0.70 + p_amount_eur * 0.05, 2);
$$;

revoke execute on function public.platform_fee_eur(numeric) from public, anon, authenticated;

comment on function public.platform_fee_eur(numeric) is 'Buyer Protection: €0.70 + 5% of the item price (0114). The one source of truth; src/lib/marketplace.ts mirrors it for previews.';

-- Kept for anything still reading the rate: the percentage part only.
create or replace function public.platform_fee_rate()
returns numeric
language sql
immutable
set search_path = public
as $$
  select 0.05;
$$;

-- The two functions that snapshot an order's fee, rewritten mechanically
-- from their live definitions so nothing else in them drifts.
do $$
declare
  v_def text;
  v_fn regprocedure;
begin
  foreach v_fn in array array[
    'public.offer_action(bigint, uuid, text, integer, integer)'::regprocedure,
    'public.create_purchase_order(uuid, bigint, text, bigint, integer)'::regprocedure
  ] loop
    v_def := pg_get_functiondef(v_fn);
    if position('public.platform_fee_eur(v_amount_eur)' in v_def) > 0 then
      continue; -- already applied
    end if;
    if position('round(v_amount_eur * public.platform_fee_rate(), 2)' in v_def) = 0 then
      raise exception 'Fee line not found in %', v_fn;
    end if;
    v_def := replace(v_def, 'round(v_amount_eur * public.platform_fee_rate(), 2)', 'public.platform_fee_eur(v_amount_eur)');
    execute v_def;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Orders: the handover
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists fulfilment_status text
    check (fulfilment_status is null or fulfilment_status in ('awaiting_handover', 'awaiting_post', 'posted', 'received', 'completed', 'problem')),
  add column if not exists meetup_at timestamptz,
  add column if not exists meetup_place text check (meetup_place is null or char_length(btrim(meetup_place)) between 1 and 160),
  add column if not exists posted_at timestamptz,
  add column if not exists tracking_ref text check (tracking_ref is null or char_length(btrim(tracking_ref)) between 1 and 80),
  add column if not exists received_at timestamptz,
  add column if not exists release_due_at timestamptz,
  add column if not exists released_at timestamptz,
  add column if not exists problem_at timestamptz;

create index if not exists orders_release_due_idx on public.orders (release_due_at)
  where payout_status = 'held' and release_due_at is not null;

comment on column public.orders.fulfilment_status is 'After payment (0114): awaiting_handover (collection) / awaiting_post → posted → received, or completed (code given), or problem (buyer reported one; release frozen).';
comment on column public.orders.release_due_at is 'When the held money goes to the seller if nobody acts (0114). Null: not yet due (no meet-up agreed, not posted) or frozen.';

create table if not exists public.order_handover_codes (
  order_id bigint primary key references public.orders (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$'),
  failed_attempts smallint not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.order_handover_codes is 'The 4-digit code a buyer reads to the seller at a collection (0114). Readable by the buyer only; checked by order_confirm_handover().';

alter table public.order_handover_codes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'order_handover_codes' and policyname = 'Buyers read their handover code') then
    create policy "Buyers read their handover code" on public.order_handover_codes
      for select to authenticated
      using (exists (select 1 from public.orders o where o.id = order_id and o.buyer_id = (select auth.uid())));
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.order_handover_codes from authenticated;
revoke all on public.order_handover_codes from anon;

-- When an order is paid: hold the money and start the handover.
create or replace function public.orders_handover_on_paid()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' and new.fulfilment_status is null then
    new.fulfilment_status := case when new.delivery_method = 'post' then 'awaiting_post' else 'awaiting_handover' end;
    if new.payout_status = 'not_started' then
      new.payout_status := 'held';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.orders_handover_code_on_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Fires on the payment update itself: orders_handover_on_paid() (BEFORE)
  -- has just set fulfilment_status, which an UPDATE OF fulfilment_status
  -- trigger would not see.
  if new.fulfilment_status = 'awaiting_handover' and old.payment_status is distinct from 'paid' and new.payment_status = 'paid' then
    insert into public.order_handover_codes (order_id, code)
    values (new.id, lpad((floor(random() * 10000))::int::text, 4, '0'))
    on conflict (order_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.orders_handover_on_paid() from public, anon, authenticated;
revoke all on function public.orders_handover_code_on_paid() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'orders_handover_on_paid') then
    create trigger orders_handover_on_paid
      before update of payment_status on public.orders
      for each row execute function public.orders_handover_on_paid();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'orders_handover_code_on_paid') then
    create trigger orders_handover_code_on_paid
      after update of payment_status on public.orders
      for each row execute function public.orders_handover_code_on_paid();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- The steps
-- ---------------------------------------------------------------------------

-- Buyer or seller agrees where and when to meet. Re-arranging moves the
-- automatic release with it.
create or replace function public.order_set_meetup(p_order_id bigint, p_at timestamptz, p_place text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or (select auth.uid()) is null or (select auth.uid()) not in (v_order.buyer_id, v_order.seller_id) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if v_order.fulfilment_status is distinct from 'awaiting_handover' then
    raise exception 'This order isn''t waiting for a collection' using errcode = 'P0001';
  end if;
  if p_at is null or p_at < now() - interval '1 day' or p_at > now() + interval '90 days' then
    raise exception 'Pick a time in the next few weeks' using errcode = '22023';
  end if;
  if p_place is null or char_length(btrim(p_place)) not between 1 and 160 then
    raise exception 'Say where you''ll meet' using errcode = '22023';
  end if;
  update public.orders
     set meetup_at = p_at,
         meetup_place = btrim(p_place),
         release_due_at = p_at + interval '3 days'
   where id = p_order_id;
end;
$$;

-- The seller types the code the buyer reads out. Five wrong tries locks it
-- (staff can help) so a code can't be guessed. A wrong code RETURNS
-- 'wrong' rather than raising: raising would roll back the attempt count.
-- Returns 'ok', 'wrong' or 'locked'.
create or replace function public.order_confirm_handover(p_order_id bigint, p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_code public.order_handover_codes;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or (select auth.uid()) is null or v_order.seller_id <> (select auth.uid()) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if v_order.fulfilment_status is distinct from 'awaiting_handover' then
    raise exception 'This order isn''t waiting for a handover' using errcode = 'P0001';
  end if;
  select * into v_code from public.order_handover_codes where order_id = p_order_id;
  if not found then
    raise exception 'No code for this order yet' using errcode = 'P0001';
  end if;
  if v_code.failed_attempts >= 5 then
    return 'locked';
  end if;
  if btrim(coalesce(p_code, '')) <> v_code.code then
    update public.order_handover_codes set failed_attempts = failed_attempts + 1 where order_id = p_order_id;
    return case when v_code.failed_attempts + 1 >= 5 then 'locked' else 'wrong' end;
  end if;
  update public.orders
     set fulfilment_status = 'completed',
         received_at = now(),
         release_due_at = now()
   where id = p_order_id;
  return 'ok';
end;
$$;

create or replace function public.order_mark_posted(p_order_id bigint, p_tracking text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or (select auth.uid()) is null or v_order.seller_id <> (select auth.uid()) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if v_order.fulfilment_status is distinct from 'awaiting_post' then
    raise exception 'This order isn''t waiting to be posted' using errcode = 'P0001';
  end if;
  update public.orders
     set fulfilment_status = 'posted',
         posted_at = now(),
         tracking_ref = nullif(btrim(coalesce(p_tracking, '')), ''),
         release_due_at = now() + interval '14 days'
   where id = p_order_id;
end;
$$;

-- "It arrived — all OK": the buyer releases the money now.
create or replace function public.order_confirm_received(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or (select auth.uid()) is null or v_order.buyer_id <> (select auth.uid()) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if v_order.fulfilment_status not in ('posted', 'awaiting_post') then
    raise exception 'This order isn''t on its way to you' using errcode = 'P0001';
  end if;
  update public.orders
     set fulfilment_status = 'received',
         received_at = now(),
         release_due_at = now()
   where id = p_order_id;
end;
$$;

-- The buyer reports a problem before the money is released: freeze it.
-- (The report itself is written by reportOrderIssue(), as before.)
create or replace function public.order_flag_problem(p_order_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or (select auth.uid()) is null or v_order.buyer_id <> (select auth.uid()) then
    raise exception 'Order not found' using errcode = '42501';
  end if;
  if v_order.payout_status <> 'held' then
    raise exception 'The seller has already been paid for this order. Your report has gone to PinPals support.' using errcode = 'P0001';
  end if;
  update public.orders
     set fulfilment_status = 'problem',
         problem_at = now(),
         release_due_at = null
   where id = p_order_id;
end;
$$;

-- Orders whose held money is due to the seller (service role only: the
-- website's release sweep).
create or replace function public.orders_due_for_release()
returns setof public.orders
language sql
stable
set search_path = public
as $$
  select * from public.orders
   where payout_status = 'held'
     and payment_status = 'paid'
     and status = 'completed'
     and fulfilment_status is distinct from 'problem'
     and release_due_at is not null
     and release_due_at <= now()
   order by release_due_at
   limit 50;
$$;

revoke all on function public.order_set_meetup(bigint, timestamptz, text) from public;
revoke all on function public.order_confirm_handover(bigint, text) from public;
revoke all on function public.order_mark_posted(bigint, text) from public;
revoke all on function public.order_confirm_received(bigint) from public;
revoke all on function public.order_flag_problem(bigint) from public;
revoke execute on function public.order_set_meetup(bigint, timestamptz, text) from anon;
revoke execute on function public.order_confirm_handover(bigint, text) from anon;
revoke execute on function public.order_mark_posted(bigint, text) from anon;
revoke execute on function public.order_confirm_received(bigint) from anon;
revoke execute on function public.order_flag_problem(bigint) from anon;
grant execute on function public.order_set_meetup(bigint, timestamptz, text) to authenticated;
grant execute on function public.order_confirm_handover(bigint, text) to authenticated;
grant execute on function public.order_mark_posted(bigint, text) to authenticated;
grant execute on function public.order_confirm_received(bigint) to authenticated;
grant execute on function public.order_flag_problem(bigint) to authenticated;

revoke all on function public.orders_due_for_release() from public, anon, authenticated;
