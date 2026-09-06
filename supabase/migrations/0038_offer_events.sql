-- Append-only audit trail of every offer's lifecycle. Self-populating via a
-- trigger on `offers` (insert + status-change update), so the existing
-- makeOffer()/respondToOffer() flows in src/app/marketplace/[id]/actions.ts
-- start producing history rows with no application-code change at all.
--
-- New table, so its money column follows the "integer cents + currency"
-- rule rather than offers.amount_eur's legacy numeric(8,2) convention.
--
-- Rollback:
--   drop trigger if exists offers_log_event on public.offers;
--   drop function if exists public.log_offer_event();
--   drop table if exists public.offer_events cascade;

create table if not exists public.offer_events (
  id bigint generated always as identity primary key,
  offer_id bigint not null references public.offers (id) on delete cascade,
  event_type text not null check (event_type in (
    'created', 'countered', 'accepted', 'declined', 'withdrawn', 'expired'
  )),
  actor_id uuid references public.profiles (id) on delete set null,
  amount_cents integer check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists offer_events_offer_id_idx on public.offer_events (offer_id);
create index if not exists offer_events_actor_id_idx on public.offer_events (actor_id);

alter table public.offer_events enable row level security;

drop policy if exists "offer participants can view offer events" on public.offer_events;
create policy "offer participants can view offer events"
  on public.offer_events for select
  to authenticated
  using (
    exists (
      select 1 from public.offers o
      join public.listings l on l.id = o.listing_id
      where o.id = offer_events.offer_id
        and ((select auth.uid()) = o.buyer_id or (select auth.uid()) = l.seller_id)
    )
    or public.is_staff()
  );

-- No insert/update/delete policy for anon or authenticated: this is a
-- system-populated log, written only by log_offer_event() below (security
-- definer, so it bypasses RLS) or the service-role client.
revoke insert, update, delete, truncate, references, trigger
  on public.offer_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.offer_events from authenticated;

create or replace function public.log_offer_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.offer_events (offer_id, event_type, actor_id, amount_cents)
    values (new.id, 'created', new.buyer_id, round(new.amount_eur * 100)::integer);
  elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
    insert into public.offer_events (offer_id, event_type, amount_cents)
    values (new.id, new.status, round(new.amount_eur * 100)::integer);
  end if;
  return new;
end;
$$;

revoke execute on function public.log_offer_event() from public, anon, authenticated;

drop trigger if exists offers_log_event on public.offers;
create trigger offers_log_event
  after insert or update on public.offers
  for each row
  execute function public.log_offer_event();
