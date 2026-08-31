-- Pinpals: Marketplace (sell/browse used golf equipment, DoneDeal/Vinted-style)

-- ============ LISTINGS ============
create table if not exists public.listings (
  id bigint generated always as identity primary key,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  description text,
  price_eur numeric(8,2) not null check (price_eur >= 0),
  category text not null,
  condition text not null,
  county text,
  image_url text,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.listings enable row level security;

-- Anyone can browse the marketplace, logged in or not (DoneDeal/Vinted-style).
create policy "listings are readable by everyone"
  on public.listings for select
  using (true);

-- A user can only create listings under their own seller_id.
create policy "users can insert their own listings"
  on public.listings for insert
  to authenticated
  with check (auth.uid() = seller_id);

create policy "users can update their own listings"
  on public.listings for update
  to authenticated
  using (auth.uid() = seller_id)
  with check (auth.uid() = seller_id);

create policy "users can delete their own listings"
  on public.listings for delete
  to authenticated
  using (auth.uid() = seller_id);

drop trigger if exists listings_set_updated_at on public.listings;
create trigger listings_set_updated_at
  before update on public.listings
  for each row
  execute function public.set_updated_at();

create index if not exists listings_category_idx on public.listings (category);
create index if not exists listings_county_idx on public.listings (county);
create index if not exists listings_status_idx on public.listings (status);
create index if not exists listings_created_at_idx on public.listings (created_at desc);

-- ============ STORAGE: listing photos ============
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('listing-images', 'listing-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Photos are public to view (needed for the marketplace grid and img tags).
create policy "listing images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'listing-images');

-- Sellers upload into a folder named after their own user id: <uid>/<file>.
create policy "users can upload their own listing images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can update their own listing images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "users can delete their own listing images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'listing-images'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
