-- Auction infrastructure for listings with sale_type 'auction' or
-- 'auction_with_buy_now' (0035). Brand-new tables, so money is integer
-- cents + currency throughout, per the money-representation rule.
--
-- Self-dealing prevention ("a user cannot bid on their own listing") is
-- enforced twice, matching the offers precedent (RLS guard + defensive
-- check): once in the bids INSERT policy, and again inside validate_bid()
-- with a clear error message, since the trigger is also where bid-amount
-- and auction-status validation live (things a CHECK/RLS policy can't
-- express cleanly against another table's current state).
--
-- Status transitions (scheduled -> live -> ended/cancelled) are
-- system-controlled only: apply_new_bid() flips scheduled -> live and
-- records the current winner on every accepted bid. There is no
-- seller-facing UPDATE policy on auctions in this phase (no bidding UI
-- exists yet to drive one) — ending an auction on schedule or letting a
-- seller cancel a still-scheduled one both need a dedicated, carefully
-- guarded RPC, which is app-code work for a later phase, not a schema
-- concern. Until then, both tables are effectively append-only from the
-- authenticated side.
--
-- Rollback:
--   drop trigger if exists bids_apply_new_bid on public.bids;
--   drop trigger if exists bids_validate on public.bids;
--   drop function if exists public.apply_new_bid();
--   drop function if exists public.validate_bid();
--   drop table if exists public.bids cascade;
--   alter table public.auctions drop column if exists winning_bid_id;
--   drop table if exists public.auctions cascade;

create table if not exists public.auctions (
  id bigint generated always as identity primary key,
  listing_id bigint not null unique references public.listings (id) on delete cascade,
  starting_price_cents integer not null check (starting_price_cents > 0),
  reserve_price_cents integer check (reserve_price_cents is null or reserve_price_cents >= starting_price_cents),
  buy_now_price_cents integer check (
    buy_now_price_cents is null
    or buy_now_price_cents > coalesce(reserve_price_cents, starting_price_cents)
  ),
  currency text not null default 'eur' check (currency = 'eur'),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auctions_ends_after_starts_check check (ends_at > starts_at)
);

create index if not exists auctions_listing_id_idx on public.auctions (listing_id);
create index if not exists auctions_status_idx on public.auctions (status);
create index if not exists auctions_ends_at_idx on public.auctions (ends_at);

drop trigger if exists auctions_set_updated_at on public.auctions;
create trigger auctions_set_updated_at
  before update on public.auctions
  for each row
  execute function public.set_updated_at();

alter table public.auctions enable row level security;

drop policy if exists "auctions are readable unless listing removed" on public.auctions;
create policy "auctions are readable unless listing removed"
  on public.auctions for select
  to public
  using (
    exists (
      select 1 from public.listings l
      where l.id = auctions.listing_id
        and (l.status <> 'removed' or (select auth.uid()) = l.seller_id)
    )
  );

drop policy if exists "sellers can start auctions on their own listings" on public.auctions;
create policy "sellers can start auctions on their own listings"
  on public.auctions for insert
  to authenticated
  with check (
    exists (
      select 1 from public.listings l
      where l.id = auctions.listing_id
        and l.seller_id = (select auth.uid())
        and l.sale_type in ('auction', 'auction_with_buy_now')
    )
  );

-- No UPDATE/DELETE policy for anon or authenticated — see header comment.
revoke update, delete, truncate, references, trigger
  on public.auctions from anon;
revoke update, delete, truncate, references, trigger
  on public.auctions from authenticated;

create table if not exists public.bids (
  id bigint generated always as identity primary key,
  auction_id bigint not null references public.auctions (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'eur' check (currency = 'eur'),
  created_at timestamptz not null default now()
);

create index if not exists bids_auction_id_idx on public.bids (auction_id);
create index if not exists bids_bidder_id_idx on public.bids (bidder_id);
-- Covers "current highest bid for this auction" lookups (validate_bid(),
-- and any future leaderboard read) without a sequential scan.
create index if not exists bids_auction_id_amount_cents_idx
  on public.bids (auction_id, amount_cents desc);

alter table public.auctions
  add column if not exists winning_bid_id bigint references public.bids (id) on delete set null;
create index if not exists auctions_winning_bid_id_idx on public.auctions (winning_bid_id);

alter table public.bids enable row level security;

drop policy if exists "bidders can view their own bids" on public.bids;
create policy "bidders can view their own bids"
  on public.bids for select
  to authenticated
  using ((select auth.uid()) = bidder_id);

drop policy if exists "sellers can view bids on their auctions" on public.bids;
create policy "sellers can view bids on their auctions"
  on public.bids for select
  to authenticated
  using (
    exists (
      select 1 from public.auctions a
      join public.listings l on l.id = a.listing_id
      where a.id = bids.auction_id
        and l.seller_id = (select auth.uid())
    )
  );

drop policy if exists "bidders can place bids on eligible auctions" on public.bids;
create policy "bidders can place bids on eligible auctions"
  on public.bids for insert
  to authenticated
  with check (
    (select auth.uid()) = bidder_id
    and exists (
      select 1 from public.auctions a
      join public.listings l on l.id = a.listing_id
      where a.id = bids.auction_id
        and l.seller_id <> (select auth.uid())
    )
  );

-- Bids are an immutable ledger: no update/delete for anyone but the
-- service role.
revoke update, delete, truncate, references, trigger
  on public.bids from anon;
revoke update, delete, truncate, references, trigger
  on public.bids from authenticated;

create or replace function public.validate_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_ends_at timestamptz;
  v_starting_price_cents integer;
  v_listing_seller_id uuid;
  v_current_high integer;
begin
  select a.status, a.ends_at, a.starting_price_cents, l.seller_id
    into v_status, v_ends_at, v_starting_price_cents, v_listing_seller_id
    from public.auctions a
    join public.listings l on l.id = a.listing_id
    where a.id = new.auction_id
    for update of a;

  if not found then
    raise exception 'Auction % not found', new.auction_id;
  end if;

  if v_listing_seller_id = new.bidder_id then
    raise exception 'Sellers cannot bid on their own listing';
  end if;

  if v_status not in ('scheduled', 'live') then
    raise exception 'Auction % is not open for bidding (status: %)', new.auction_id, v_status;
  end if;

  if now() > v_ends_at then
    raise exception 'Auction % has already ended', new.auction_id;
  end if;

  select max(amount_cents) into v_current_high
    from public.bids
    where auction_id = new.auction_id;

  if v_current_high is null then
    if new.amount_cents < v_starting_price_cents then
      raise exception 'Bid must be at least the starting price (% cents)', v_starting_price_cents;
    end if;
  elsif new.amount_cents <= v_current_high then
    raise exception 'Bid must exceed the current highest bid (% cents)', v_current_high;
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_bid() from public, anon, authenticated;

drop trigger if exists bids_validate on public.bids;
create trigger bids_validate
  before insert on public.bids
  for each row
  execute function public.validate_bid();

create or replace function public.apply_new_bid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.auctions
    set status = 'live',
        winning_bid_id = new.id
    where id = new.auction_id
      and status in ('scheduled', 'live');
  return new;
end;
$$;

revoke execute on function public.apply_new_bid() from public, anon, authenticated;

drop trigger if exists bids_apply_new_bid on public.bids;
create trigger bids_apply_new_bid
  after insert on public.bids
  for each row
  execute function public.apply_new_bid();
