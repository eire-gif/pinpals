-- Multiple ordered images per listing. `listings.image_url` (0003) is left
-- untouched as the single legacy/primary image every existing read site
-- already relies on; this table is purely additive gallery storage for a
-- later UI phase. Application code does not read this table yet.
--
-- Rollback: `drop table if exists public.listing_images cascade;`

create table if not exists public.listing_images (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  image_url text not null,
  position smallint not null default 0 check (position >= 0),
  created_at timestamptz not null default now()
);

create unique index if not exists listing_images_listing_id_position_idx
  on public.listing_images (listing_id, position);
create index if not exists listing_images_listing_id_idx on public.listing_images (listing_id);

alter table public.listing_images enable row level security;

-- Readable wherever the parent listing is readable (mirrors 0015's
-- "listings are readable unless removed" policy).
drop policy if exists "listing images are readable unless listing removed" on public.listing_images;
create policy "listing images are readable unless listing removed"
  on public.listing_images for select
  to public
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id
        and (l.status <> 'removed' or (select auth.uid()) = l.seller_id)
    )
  );

drop policy if exists "sellers manage their own listing images" on public.listing_images;
create policy "sellers manage their own listing images"
  on public.listing_images for all
  to authenticated
  using (
    exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id
        and l.seller_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.listings l
      where l.id = listing_images.listing_id
        and l.seller_id = (select auth.uid())
    )
  );
