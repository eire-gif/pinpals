-- Append-only audit trail of every order's lifecycle, mirroring
-- offer_events (0038). Self-populating via a trigger on `orders`, so the
-- existing respondToOffer() insert and every existing Stripe-webhook
-- function (apply_order_payment_succeeded/_failed/_refunded,
-- apply_order_transfer_captured, apply_payout_reconciliation — 0021/0024)
-- start producing history rows with no change to that code.
--
-- Rollback:
--   drop trigger if exists orders_log_event on public.orders;
--   drop function if exists public.log_order_event();
--   drop table if exists public.order_events cascade;

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id bigint not null references public.orders (id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'status_changed', 'payment_status_changed', 'payout_status_changed'
  )),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_id_idx on public.order_events (order_id);

alter table public.order_events enable row level security;

drop policy if exists "order participants can view order events" on public.order_events;
create policy "order participants can view order events"
  on public.order_events for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_events.order_id
        and ((select auth.uid()) = o.buyer_id or (select auth.uid()) = o.seller_id)
    )
    or public.is_staff()
  );

-- System-populated only, like offer_events.
revoke insert, update, delete, truncate, references, trigger
  on public.order_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.order_events from authenticated;

create or replace function public.log_order_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.order_events (order_id, event_type, detail)
    values (new.id, 'created', jsonb_build_object('status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.order_events (order_id, event_type, detail)
    values (new.id, 'status_changed', jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.payment_status is distinct from old.payment_status then
    insert into public.order_events (order_id, event_type, detail)
    values (new.id, 'payment_status_changed', jsonb_build_object('from', old.payment_status, 'to', new.payment_status));
  end if;

  if new.payout_status is distinct from old.payout_status then
    insert into public.order_events (order_id, event_type, detail)
    values (new.id, 'payout_status_changed', jsonb_build_object('from', old.payout_status, 'to', new.payout_status));
  end if;

  return new;
end;
$$;

revoke execute on function public.log_order_event() from public, anon, authenticated;

drop trigger if exists orders_log_event on public.orders;
create trigger orders_log_event
  after insert or update on public.orders
  for each row
  execute function public.log_order_event();
