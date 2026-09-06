-- Per-user saved/favourited listings ("wishlist"). Purely additive; no
-- existing code reads or writes this table yet.
--
-- Rollback: `drop table if exists public.listing_favourites cascade;`

create table if not exists public.listing_favourites (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, user_id)
);

create index if not exists listing_favourites_user_id_idx on public.listing_favourites (user_id);
create index if not exists listing_favourites_listing_id_idx on public.listing_favourites (listing_id);

alter table public.listing_favourites enable row level security;

drop policy if exists "users manage their own favourites" on public.listing_favourites;
create policy "users manage their own favourites"
  on public.listing_favourites for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
