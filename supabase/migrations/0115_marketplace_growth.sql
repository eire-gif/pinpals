-- 0115 — Marketplace growth: promotions, pro shops, affiliates, banners (Oct 2026)
--
-- Decisions (Eire, 10 Oct 2026):
--   * Sellers can BUMP a listing (€1.99, back to the top for 3 days) or
--     FEATURE it (€4.99, gold "Featured" badge and first place for 7 days).
--     Bought on the website (Apple's in-app purchase rules); shown
--     everywhere.
--   * PRO SHOPS: a club's pro shop gets a storefront in New Gear. It sells
--     new stock (with quantities) through the same checkout, click &
--     collect at the club or post. No Buyer Protection fee on shop items —
--     the shop pays 8% commission instead, taken from what it's paid.
--     PinPals approves each shop.
--   * AFFILIATE products from online retailers, added by PinPals staff;
--     clicks counted.
--   * SPONSORED BANNERS at the top of New Gear; impressions and clicks
--     counted.
--
-- Everything here is written by the service role (the website's admin and
-- Stripe webhook) or through the narrow functions below. Members read.
--
-- Rollback (reverse order): drop the functions and triggers below, then
--   drop table if exists public.marketplace_banners, public.affiliate_clicks,
--     public.affiliate_products, public.listing_promotions, public.stores;
--   alter table public.listings drop column if exists store_id, is_new,
--     stock_quantity, featured_until, bumped_at;
--   alter table public.orders drop column if exists store_id, seller_commission_eur;

-- ---------------------------------------------------------------------------
-- Pro shops
-- ---------------------------------------------------------------------------

create table if not exists public.stores (
  id bigint generated always as identity primary key,
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 60),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  club_id bigint references public.clubs (id) on delete set null,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  description text check (description is null or char_length(description) <= 1000),
  logo_url text check (logo_url is null or char_length(logo_url) <= 500),
  cover_url text check (cover_url is null or char_length(cover_url) <= 500),
  phone text check (phone is null or char_length(phone) <= 40),
  email text check (email is null or char_length(email) <= 200),
  offers_fittings boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'active', 'suspended')),
  commission_rate numeric(4, 3) not null default 0.080 check (commission_rate >= 0 and commission_rate <= 0.5),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stores_owner_idx on public.stores (owner_id);
create index if not exists stores_club_idx on public.stores (club_id);

comment on table public.stores is 'Pro shop storefronts (0115). Pending until PinPals approves; commission_rate is taken from the shop''s payout on each sale.';

alter table public.stores enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'stores' and policyname = 'Anyone signed in reads active shops') then
    create policy "Anyone signed in reads active shops" on public.stores
      for select to authenticated using (status = 'active' or owner_id = (select auth.uid()) or public.is_staff());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'stores' and policyname = 'Visitors read active shops') then
    create policy "Visitors read active shops" on public.stores for select to anon using (status = 'active');
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.stores from anon, authenticated;

-- A member applies for their shop; staff approve it in admin.
create or replace function public.store_apply(p_name text, p_club_id bigint, p_description text, p_phone text, p_email text, p_fittings boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_slug text;
  v_id bigint;
begin
  if v_me is null then
    raise exception 'Sign in to apply' using errcode = '42501';
  end if;
  if exists (select 1 from public.stores where owner_id = v_me) then
    raise exception 'You already have a shop on PinPals' using errcode = 'P0001';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 2 and 80 then
    raise exception 'Give the shop a name' using errcode = '22023';
  end if;
  v_slug := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if char_length(v_slug) < 3 then
    v_slug := v_slug || '-shop';
  end if;
  v_slug := left(v_slug, 50);
  if exists (select 1 from public.stores where slug = v_slug) then
    v_slug := v_slug || '-' || (select count(*) + 1 from public.stores);
  end if;
  insert into public.stores (slug, name, club_id, owner_id, description, phone, email, offers_fittings)
  values (v_slug, btrim(p_name), p_club_id, v_me, nullif(btrim(coalesce(p_description, '')), ''),
          nullif(btrim(coalesce(p_phone, '')), ''), nullif(btrim(coalesce(p_email, '')), ''), coalesce(p_fittings, false))
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.store_apply(text, bigint, text, text, text, boolean) from public;
revoke execute on function public.store_apply(text, bigint, text, text, text, boolean) from anon;
grant execute on function public.store_apply(text, bigint, text, text, text, boolean) to authenticated;

-- The owner edits their shop's details (not its status or commission).
create or replace function public.store_update(p_store_id bigint, p_description text, p_phone text, p_email text, p_fittings boolean, p_logo_url text, p_cover_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stores
     set description = nullif(btrim(coalesce(p_description, '')), ''),
         phone = nullif(btrim(coalesce(p_phone, '')), ''),
         email = nullif(btrim(coalesce(p_email, '')), ''),
         offers_fittings = coalesce(p_fittings, offers_fittings),
         logo_url = coalesce(nullif(btrim(coalesce(p_logo_url, '')), ''), logo_url),
         cover_url = coalesce(nullif(btrim(coalesce(p_cover_url, '')), ''), cover_url),
         updated_at = now()
   where id = p_store_id and owner_id = (select auth.uid());
  if not found then
    raise exception 'Shop not found' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.store_update(bigint, text, text, text, boolean, text, text) from public;
revoke execute on function public.store_update(bigint, text, text, text, boolean, text, text) from anon;
grant execute on function public.store_update(bigint, text, text, text, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Listings: new stock, shops, promotions
-- ---------------------------------------------------------------------------

alter table public.listings
  add column if not exists store_id bigint references public.stores (id) on delete set null,
  add column if not exists is_new boolean not null default false,
  add column if not exists stock_quantity integer check (stock_quantity is null or stock_quantity between 0 and 9999),
  add column if not exists featured_until timestamptz,
  add column if not exists bumped_at timestamptz;

create index if not exists listings_store_idx on public.listings (store_id) where store_id is not null;
create index if not exists listings_featured_idx on public.listings (featured_until) where featured_until is not null;
create index if not exists listings_new_idx on public.listings (is_new, status);

comment on column public.listings.stock_quantity is 'Shop stock (0115): units still available. Null for a one-off item. A sale reserves one unit and keeps the listing active while any are left.';
comment on column public.listings.featured_until is 'Paid Featured placement (0115) — first place and a gold badge until this time.';
comment on column public.listings.bumped_at is 'Paid Bump (0115) — sorts as if listed at this time.';

-- A shop listing must belong to its owner's active shop.
create or replace function public.listings_check_store()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.store_id is not null and (tg_op = 'INSERT' or new.store_id is distinct from old.store_id) then
    if not exists (select 1 from public.stores s where s.id = new.store_id and s.owner_id = new.seller_id and s.status = 'active') then
      raise exception 'Only an approved shop''s owner can list for it' using errcode = '42501';
    end if;
  end if;
  if new.store_id is null and new.is_new and new.stock_quantity is not null and new.stock_quantity > 1 then
    raise exception 'Quantities are for shop listings' using errcode = '22023';
  end if;
  return new;
end;
$$;

-- Stock: reserving a unit keeps the listing on sale while others are left.
create or replace function public.listings_stock_on_status()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.stock_quantity is null or new.status is not distinct from old.status then
    return new;
  end if;
  if old.status = 'active' and new.status = 'reserved' then
    new.stock_quantity := greatest(old.stock_quantity - 1, 0);
    if new.stock_quantity > 0 then
      new.status := 'active';
    end if;
  elsif old.status = 'active' and new.status = 'sold' and old.stock_quantity > 0 then
    -- A paid order for an earlier unit; others are still on sale.
    new.status := 'active';
  end if;
  return new;
end;
$$;

revoke all on function public.listings_check_store() from public, anon, authenticated;
revoke all on function public.listings_stock_on_status() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'listings_check_store') then
    create trigger listings_check_store
      before insert or update of store_id, is_new, stock_quantity on public.listings
      for each row execute function public.listings_check_store();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'listings_stock_on_status') then
    create trigger listings_stock_on_status
      before update of status on public.listings
      for each row execute function public.listings_stock_on_status();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Orders: shop sales pay commission instead of Buyer Protection
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists store_id bigint references public.stores (id) on delete set null,
  add column if not exists seller_commission_eur numeric(10, 2) not null default 0 check (seller_commission_eur >= 0);

comment on column public.orders.seller_commission_eur is 'Shop sales (0115): PinPals'' commission, kept back from the shop''s transfer on release. 0 for a member''s own sale (the buyer paid Buyer Protection instead).';

create or replace function public.orders_store_pricing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store public.stores;
begin
  select s.* into v_store
    from public.listings l join public.stores s on s.id = l.store_id
   where l.id = new.listing_id;
  if found then
    new.store_id := v_store.id;
    new.platform_fee_eur := 0;
    new.total_eur := round(new.amount_eur + coalesce(new.delivery_fee_cents, 0) / 100.0, 2);
    new.seller_commission_eur := round(new.amount_eur * v_store.commission_rate, 2);
  end if;
  return new;
end;
$$;

-- A cancelled order gives its unit back.
create or replace function public.orders_return_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.listing_id is not null then
    update public.listings
       set stock_quantity = stock_quantity + 1,
           status = case when status in ('reserved', 'sold') then 'active' else status end
     where id = new.listing_id and stock_quantity is not null;
  end if;
  return null;
end;
$$;

revoke all on function public.orders_store_pricing() from public, anon, authenticated;
revoke all on function public.orders_return_stock() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'orders_store_pricing') then
    create trigger orders_store_pricing
      before insert on public.orders
      for each row execute function public.orders_store_pricing();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'orders_return_stock') then
    create trigger orders_return_stock
      after update of status on public.orders
      for each row execute function public.orders_return_stock();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Promotions: bumps and featured listings
-- ---------------------------------------------------------------------------

create table if not exists public.listing_promotions (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('bump', 'featured')),
  amount_eur numeric(6, 2) not null check (amount_eur >= 0),
  status text not null default 'pending' check (status in ('pending', 'active', 'expired', 'cancelled', 'refunded')),
  stripe_session_id text unique,
  stripe_payment_intent text unique,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists listing_promotions_listing_idx on public.listing_promotions (listing_id);
create index if not exists listing_promotions_seller_idx on public.listing_promotions (seller_id, created_at desc);

comment on table public.listing_promotions is 'Paid bumps (€1.99, 3 days) and featured placements (€4.99, 7 days), 0115. Written by the website (checkout) and the Stripe webhook (activation).';

alter table public.listing_promotions enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'listing_promotions' and policyname = 'Sellers read their promotions') then
    create policy "Sellers read their promotions" on public.listing_promotions
      for select to authenticated using (seller_id = (select auth.uid()) or public.is_staff());
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.listing_promotions from anon, authenticated;
revoke all on public.listing_promotions from anon;

-- Activation, from the webhook (service role only).
create or replace function public.activate_listing_promotion(p_promotion_id bigint, p_payment_intent text)
returns public.listing_promotions
language plpgsql
set search_path = public
as $$
declare
  v_promo public.listing_promotions;
  v_days int;
begin
  select * into v_promo from public.listing_promotions where id = p_promotion_id for update;
  if not found then
    raise exception 'Promotion % not found', p_promotion_id;
  end if;
  if v_promo.status = 'active' then
    return v_promo;
  end if;
  v_days := case when v_promo.kind = 'featured' then 7 else 3 end;
  update public.listing_promotions
     set status = 'active',
         stripe_payment_intent = p_payment_intent,
         starts_at = now(),
         ends_at = now() + make_interval(days => v_days)
   where id = p_promotion_id
  returning * into v_promo;
  if v_promo.kind = 'featured' then
    update public.listings
       set featured_until = greatest(coalesce(featured_until, now()), now()) + make_interval(days => v_days),
           bumped_at = now()
     where id = v_promo.listing_id;
  else
    update public.listings set bumped_at = now() where id = v_promo.listing_id;
  end if;
  return v_promo;
end;
$$;

revoke all on function public.activate_listing_promotion(bigint, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Affiliate products
-- ---------------------------------------------------------------------------

create table if not exists public.affiliate_products (
  id bigint generated always as identity primary key,
  title text not null check (char_length(btrim(title)) between 2 and 120),
  brand text check (brand is null or char_length(brand) <= 60),
  category text check (category is null or char_length(category) <= 60),
  price_eur numeric(10, 2) check (price_eur is null or price_eur >= 0),
  was_price_eur numeric(10, 2) check (was_price_eur is null or was_price_eur >= 0),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  retailer text not null check (char_length(btrim(retailer)) between 2 and 80),
  url text not null check (url ~ '^https://' and char_length(url) <= 1000),
  active boolean not null default true,
  sort_order integer not null default 0,
  clicks integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.affiliate_clicks (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.affiliate_products (id) on delete cascade,
  member_id uuid references public.profiles (id) on delete set null,
  source text check (source is null or source in ('web', 'app')),
  created_at timestamptz not null default now()
);

create index if not exists affiliate_clicks_product_idx on public.affiliate_clicks (product_id, created_at desc);

comment on table public.affiliate_products is 'Retailer products shown in New Gear (0115), managed by PinPals staff. url carries the affiliate tag.';

alter table public.affiliate_products enable row level security;
alter table public.affiliate_clicks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'affiliate_products' and policyname = 'Anyone reads active affiliate products') then
    create policy "Anyone reads active affiliate products" on public.affiliate_products
      for select to anon, authenticated using (active or public.is_staff());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'affiliate_clicks' and policyname = 'Staff read affiliate clicks') then
    create policy "Staff read affiliate clicks" on public.affiliate_clicks
      for select to authenticated using (public.is_staff());
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.affiliate_products, public.affiliate_clicks from anon, authenticated;
revoke all on public.affiliate_clicks from anon;

-- ---------------------------------------------------------------------------
-- Sponsored banners
-- ---------------------------------------------------------------------------

create table if not exists public.marketplace_banners (
  id bigint generated always as identity primary key,
  eyebrow text check (eyebrow is null or char_length(eyebrow) <= 40),
  title text not null check (char_length(btrim(title)) between 2 and 80),
  subtitle text check (subtitle is null or char_length(subtitle) <= 140),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  link_url text not null check (link_url ~ '^https://' and char_length(link_url) <= 1000),
  sponsor text not null check (char_length(btrim(sponsor)) between 2 and 80),
  placement text not null default 'new_gear' check (placement in ('new_gear', 'used_gear')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  impressions integer not null default 0,
  clicks integer not null default 0,
  fee_eur numeric(10, 2) check (fee_eur is null or fee_eur >= 0),
  created_at timestamptz not null default now()
);

comment on table public.marketplace_banners is 'Sponsored banners in the marketplace (0115). fee_eur is what the sponsor paid, for the revenue dashboard.';

alter table public.marketplace_banners enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'marketplace_banners' and policyname = 'Anyone reads live banners') then
    create policy "Anyone reads live banners" on public.marketplace_banners
      for select to anon, authenticated
      using ((active and starts_at <= now() and (ends_at is null or ends_at > now())) or public.is_staff());
  end if;
end $$;

revoke insert, update, delete, truncate, references, trigger on public.marketplace_banners from anon, authenticated;

-- Counting, from the app and site. Cheap and harmless to repeat; a member
-- can inflate a count by tapping, which is why fees are flat, not per click.
create or replace function public.banner_seen(p_banner_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  update public.marketplace_banners set impressions = impressions + 1 where id = p_banner_id and active;
$$;

create or replace function public.banner_clicked(p_banner_id bigint)
returns text
language sql
security definer
set search_path = public
as $$
  update public.marketplace_banners set clicks = clicks + 1 where id = p_banner_id and active returning link_url;
$$;

create or replace function public.affiliate_clicked(p_product_id bigint, p_source text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  update public.affiliate_products set clicks = clicks + 1 where id = p_product_id and active returning url into v_url;
  if v_url is not null then
    insert into public.affiliate_clicks (product_id, member_id, source)
    values (p_product_id, (select auth.uid()), case when p_source in ('web', 'app') then p_source end);
  end if;
  return v_url;
end;
$$;

revoke all on function public.banner_seen(bigint) from public;
revoke all on function public.banner_clicked(bigint) from public;
revoke all on function public.affiliate_clicked(bigint, text) from public;
grant execute on function public.banner_seen(bigint) to anon, authenticated;
grant execute on function public.banner_clicked(bigint) to anon, authenticated;
grant execute on function public.affiliate_clicked(bigint, text) to anon, authenticated;
