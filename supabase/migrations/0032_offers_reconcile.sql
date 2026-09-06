-- Reconciles a pre-existing schema drift: the live `offers` table (and its
-- RLS policies) were created directly against the Supabase project as part
-- of the "marketplace_offers" migration, but no corresponding file was ever
-- committed to this repo (see claude/admin-architecture-review.md §migration
-- drift, and claude/production-readiness-runbook.md §2's warning against
-- exactly this failure mode: "always apply schema changes through a numbered
-- migration file, never a one-off edit that doesn't get committed"). This
-- file is the missing source of truth: it reconstructs the table, trigger
-- and policies to match the live shape exactly.
--
-- On the live project every statement below is a no-op (`if not exists` /
-- `drop ... if exists` guards throughout) — nothing here changes production
-- behaviour. On a fresh branch or a clean install replaying 0001..0031, this
-- file is what actually creates `offers`, since no earlier file does.
--
-- Rollback: `drop table if exists public.offers cascade;` — safe only if no
-- later migration (0033+) or live data depends on it. Not expected to be run
-- against the live project, since offers already exists there with data.

create table if not exists public.offers (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  amount_eur numeric(8,2) not null check (amount_eur > 0),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists offers_listing_id_idx on public.offers (listing_id);
create index if not exists offers_buyer_id_idx on public.offers (buyer_id);
create index if not exists offers_status_idx on public.offers (status);

drop trigger if exists offers_set_updated_at on public.offers;
create trigger offers_set_updated_at
  before update on public.offers
  for each row
  execute function public.set_updated_at();

alter table public.offers enable row level security;

-- Buyers may make an offer on any active listing that isn't their own.
-- (This is the self-dealing guard the "prevent a user ... offering on ...
-- their own listing" requirement asks for — it already lives here, at the
-- RLS layer, for the existing offers flow.)
drop policy if exists "buyers can create offers" on public.offers;
create policy "buyers can create offers"
  on public.offers for insert
  to public
  with check (
    (select auth.uid()) = buyer_id
    and exists (
      select 1 from public.listings l
      where l.id = offers.listing_id
        and l.seller_id <> (select auth.uid())
        and l.status = 'active'
    )
  );

drop policy if exists "buyers can view their own offers" on public.offers;
create policy "buyers can view their own offers"
  on public.offers for select
  to public
  using ((select auth.uid()) = buyer_id);

drop policy if exists "sellers can view offers on their listings" on public.offers;
create policy "sellers can view offers on their listings"
  on public.offers for select
  to public
  using (
    exists (
      select 1 from public.listings l
      where l.id = offers.listing_id
        and l.seller_id = (select auth.uid())
    )
  );

drop policy if exists "sellers can respond to offers" on public.offers;
create policy "sellers can respond to offers"
  on public.offers for update
  to public
  using (
    exists (
      select 1 from public.listings l
      where l.id = offers.listing_id
        and l.seller_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = offers.listing_id
        and l.seller_id = (select auth.uid())
    )
  );
