-- 0163 — Find by club, brand and model; brand logos; Top picks (Oct 2026)
--
-- The approved mock-ups "PinPals — find by brand & model": a buyer picks a
-- club type (or other item), then a brand, then a model, and the listings
-- are always on screen underneath, narrowing at each step. Above them sits a
-- "Top picks" row: up to three paid adverts that match what's picked, each
-- carrying a PREMIUM badge.
--
-- 1. public.marketplace_models — the model catalogue. One row per family
--    per category ("TaylorMade Qi10" under Drivers, and again under Woods &
--    hybrids), with its launch year and its versions ("Qi10 LS", "Qi10
--    Max"). Seeded from src/data/golf-models.json, the same "the JSON is the
--    data, the migration seeds a table from it" arrangement as the brands
--    (0060). Admin → Brands adds to it later. Readable by everyone, written
--    only by the service role.
--
-- 2. marketplace_brands.logo_url — the brand's official logo (uploaded in
--    Admin → Brands into the public brand-logos bucket). Null shows the name.
--
-- 3. listings.model_id — which catalogue model a listing is. Optional (the
--    free-text `model` stays for the exact version and anything not in the
--    catalogue). A trigger keeps it consistent with the listing's brand and
--    category. Existing listings are matched from their model text/title.
--
-- 4. listings.top_pick_until — paid Top picks placement. Both paid tiers
--    put an advert there: Premium (the 'bump' kind, €1.99) for 3 days and
--    Premium Plus (the 'featured' kind, €4.99) for 7 days — Premium Plus also
--    keeps featured_until, which shows it first and badges it everywhere.
--    Guarded exactly like featured_until (0117): members can't set it.
--
-- 5. search_marketplace_listings() gains p_model (rewritten mechanically from
--    the live definition, like 0116), and marketplace_finder_counts() gives
--    the numbers on the club / brand / model tiles.
--
-- Rollback:
--   drop function if exists public.marketplace_finder_counts(text, text);
--   (re-create search_marketplace_listings without p_model: the same rewrite
--    in reverse, then drop the 16-argument version)
--   drop trigger if exists listings_check_model on public.listings;
--   drop function if exists public.listings_check_model();
--   alter table public.listings drop column if exists model_id, drop column if exists top_pick_until;
--   alter table public.marketplace_brands drop column if exists logo_url;
--   drop table if exists public.marketplace_models;
--   (and restore listings_guard_promotion / activate_listing_promotion from 0117 / 0115)

-- ============ the model catalogue ============

create table if not exists public.marketplace_models (
  id text primary key,
  brand_id text not null references public.marketplace_brands (id) on update cascade on delete cascade,
  category text not null check (category in (
    'Drivers', 'Woods & hybrids', 'Irons', 'Wedges', 'Putters',
    'Full sets', 'Bags & trolleys', 'Shoes & apparel', 'Balls & accessories'
  )),
  family text not null check (char_length(btrim(family)) between 1 and 60),
  year smallint check (year is null or year between 1950 and 2100),
  versions text[] not null default '{}',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists marketplace_models_brand_cat_idx on public.marketplace_models (brand_id, category);
create unique index if not exists marketplace_models_family_uniq on public.marketplace_models (brand_id, category, lower(family));

comment on table public.marketplace_models is 'Model catalogue (0163): one row per brand + category + model family, with launch year and versions. Seeded from src/data/golf-models.json; added to in Admin → Brands.';

alter table public.marketplace_models enable row level security;

drop policy if exists "Models are readable by everyone" on public.marketplace_models;
create policy "Models are readable by everyone"
  on public.marketplace_models for select
  using (true);

revoke all on public.marketplace_models from anon, authenticated;
grant select on public.marketplace_models to anon, authenticated;

-- ============ brand logos ============

alter table public.marketplace_brands add column if not exists logo_url text;
alter table public.marketplace_brands drop constraint if exists marketplace_brands_logo_url_check;
alter table public.marketplace_brands
  add constraint marketplace_brands_logo_url_check
  check (logo_url is null or logo_url ~ '^https://');

-- Read-only to members (RLS already had no write policy; this makes a write
-- an error rather than a silent no-op).
revoke insert, update, delete, truncate on public.marketplace_brands from anon, authenticated;

comment on column public.marketplace_brands.logo_url is 'Official brand logo (0163), uploaded in Admin → Brands. Null shows the brand name instead.';

-- The public bucket the logos live in. Writes go through the admin client.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('brand-logos', 'brand-logos', true, 1048576, array['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'])
on conflict (id) do nothing;

-- ============ listings ============

alter table public.listings
  add column if not exists model_id text,
  add column if not exists top_pick_until timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listings_model_id_fkey') then
    alter table public.listings
      add constraint listings_model_id_fkey
      foreign key (model_id) references public.marketplace_models (id)
      on update cascade on delete set null;
  end if;
end $$;

create index if not exists listings_active_model_idx on public.listings (model_id) where status = 'active';
create index if not exists listings_top_pick_idx on public.listings (top_pick_until) where top_pick_until is not null;

comment on column public.listings.model_id is 'Catalogue model (0163). Must match the listing''s brand and category.';
comment on column public.listings.top_pick_until is 'Paid Top picks placement (0163): Premium 3 days, Premium Plus 7 days. Set only by activate_listing_promotion().';

-- A listing's model must be one of its own brand's, in its own category.
-- If the seller changes the brand or category, a model that no longer fits
-- is dropped rather than the save being refused.
create or replace function public.listings_check_model()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.model_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.marketplace_models m
     where m.id = new.model_id and m.brand_id = new.brand and m.category = new.category
  ) then
    if tg_op = 'UPDATE' and new.model_id is not distinct from old.model_id then
      new.model_id := null;
    else
      raise exception 'That model isn''t one of this brand''s %', lower(new.category) using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.listings_check_model() from public, anon, authenticated;

drop trigger if exists listings_check_model on public.listings;
create trigger listings_check_model
  before insert or update of model_id, brand, category on public.listings
  for each row execute function public.listings_check_model();

-- Members can't put themselves in Top picks (same guard as 0117).
create or replace function public.listings_guard_promotion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not public.is_staff() then
    if tg_op = 'INSERT' then
      new.featured_until := null;
      new.bumped_at := null;
      new.top_pick_until := null;
    else
      new.featured_until := old.featured_until;
      new.bumped_at := old.bumped_at;
      new.top_pick_until := old.top_pick_until;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.listings_guard_promotion() from public, anon, authenticated;

-- ============ paying for Top picks ============
-- 'bump' is sold as Premium (3 days in Top picks), 'featured' as Premium
-- Plus (7 days, shown first, badged everywhere). The kinds keep their names
-- so past payments, the webhook and the revenue figures carry on unchanged.

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
           top_pick_until = greatest(coalesce(top_pick_until, now()), now()) + make_interval(days => v_days),
           bumped_at = now()
     where id = v_promo.listing_id;
  else
    update public.listings
       set top_pick_until = greatest(coalesce(top_pick_until, now()), now()) + make_interval(days => v_days),
           bumped_at = now()
     where id = v_promo.listing_id;
  end if;
  return v_promo;
end;
$$;

revoke all on function public.activate_listing_promotion(bigint, text) from public, anon, authenticated;

-- Placements already running carry over into Top picks.
update public.listings l
   set top_pick_until = p.ends_at
  from (
    select listing_id, max(ends_at) as ends_at
      from public.listing_promotions
     where status = 'active' and ends_at > now()
     group by listing_id
  ) p
 where l.id = p.listing_id
   and (l.top_pick_until is null or l.top_pick_until < p.ends_at);

-- ============ search by model ============
-- The same function, with p_model added at the end (default null, so every
-- existing caller is unchanged). Rewritten from the live definition so the
-- rest of it can't drift; the old 15-argument version is then dropped so
-- PostgREST never sees two overloads.

do $$
declare
  v_def text;
  v_old regprocedure := to_regprocedure('public.search_marketplace_listings(text, text, text, text, text, text, text, integer, integer, text, timestamptz, integer, bigint, integer, text[])');
begin
  if v_old is null then
    return; -- already rewritten
  end if;
  v_def := pg_get_functiondef(v_old);
  if position('p_brands text[] DEFAULT NULL::text[])' in v_def) = 0
     or position('and (v_brands is null or l.brand = any (v_brands))' in v_def) = 0 then
    raise exception 'Anchors not found in search_marketplace_listings';
  end if;
  v_def := replace(v_def, 'p_brands text[] DEFAULT NULL::text[])', 'p_brands text[] DEFAULT NULL::text[], p_model text DEFAULT NULL::text)');
  v_def := replace(v_def, 'and (v_brands is null or l.brand = any (v_brands))', 'and (v_brands is null or l.brand = any (v_brands))
        and (p_model is null or l.model_id = p_model)');
  execute v_def;
  execute 'drop function public.search_marketplace_listings(text, text, text, text, text, text, text, integer, integer, text, timestamptz, integer, bigint, integer, text[])';
end $$;

revoke all on function public.search_marketplace_listings(
  text, text, text, text, text, text, text, integer, integer, text,
  timestamptz, integer, bigint, integer, text[], text
) from public;
grant execute on function public.search_marketplace_listings(
  text, text, text, text, text, text, text, integer, integer, text,
  timestamptz, integer, bigint, integer, text[], text
) to anon, authenticated;

-- ============ the numbers on the tiles ============
-- Used gear for sale right now (the same set the search lists): how many per
-- club type (of the picked brand, when a brand is picked first); per brand within the picked club type; per model within the
-- picked brand — with each model's asking-price range.
--
-- Not security definer: it reads only what the public listings policy
-- already shows.

create or replace function public.marketplace_finder_counts(
  p_category text default null,
  p_brand text default null
)
returns table (level text, key text, listing_count bigint, min_price_cents integer, max_price_cents integer)
language sql
stable
set search_path = public
as $$
  select 'category'::text, l.category, count(*)::bigint, min(l.price_cents), max(l.price_cents)
    from public.listings l
   where l.status = 'active' and l.store_id is null
     and (p_brand is null or l.brand = p_brand)
   group by l.category
  union all
  select 'brand'::text, l.brand, count(*)::bigint, min(l.price_cents), max(l.price_cents)
    from public.listings l
   where p_category is not null
     and l.status = 'active' and l.store_id is null
     and l.category = p_category and l.brand is not null
   group by l.brand
  union all
  select 'model'::text, l.model_id, count(*)::bigint, min(l.price_cents), max(l.price_cents)
    from public.listings l
   where p_category is not null and p_brand is not null
     and l.status = 'active' and l.store_id is null
     and l.category = p_category and l.brand = p_brand and l.model_id is not null
   group by l.model_id
$$;

revoke all on function public.marketplace_finder_counts(text, text) from public;
grant execute on function public.marketplace_finder_counts(text, text) to anon, authenticated;

-- ============ seed: the catalogue ============
-- From src/data/golf-models.json. `on conflict do nothing` so a model
-- renamed later in Admin isn't overwritten by a replay.
insert into public.marketplace_models (id, brand_id, category, family, year, versions) values
  ('taylormade-qi4d', 'taylormade', 'Drivers', 'Qi4D', 2026, array['Qi4D', 'Qi4D LS', 'Qi4D Max']::text[]),
  ('taylormade-qi4d-woods-hybrids', 'taylormade', 'Woods & hybrids', 'Qi4D', 2026, array['Qi4D', 'Qi4D LS', 'Qi4D Max']::text[]),
  ('taylormade-qi35', 'taylormade', 'Drivers', 'Qi35', 2025, array['Qi35', 'Qi35 LS', 'Qi35 Max', 'Qi35 Max Lite']::text[]),
  ('taylormade-qi35-woods-hybrids', 'taylormade', 'Woods & hybrids', 'Qi35', 2025, array['Qi35', 'Qi35 LS', 'Qi35 Max', 'Qi35 Max Lite']::text[]),
  ('taylormade-qi35-irons', 'taylormade', 'Irons', 'Qi35', 2025, array['Qi35', 'Qi35 LS', 'Qi35 Max', 'Qi35 Max Lite']::text[]),
  ('taylormade-qi10', 'taylormade', 'Drivers', 'Qi10', 2024, array['Qi10', 'Qi10 LS', 'Qi10 Max', 'Qi10 Tour']::text[]),
  ('taylormade-qi10-woods-hybrids', 'taylormade', 'Woods & hybrids', 'Qi10', 2024, array['Qi10', 'Qi10 LS', 'Qi10 Max', 'Qi10 Tour']::text[]),
  ('taylormade-qi-irons', 'taylormade', 'Irons', 'Qi irons', 2024, array['Qi', 'Qi HL']::text[]),
  ('taylormade-stealth-2', 'taylormade', 'Drivers', 'Stealth 2', 2023, array['Stealth 2', 'Stealth 2 Plus', 'Stealth 2 HD']::text[]),
  ('taylormade-stealth-2-woods-hybrids', 'taylormade', 'Woods & hybrids', 'Stealth 2', 2023, array['Stealth 2', 'Stealth 2 Plus', 'Stealth 2 HD']::text[]),
  ('taylormade-stealth-2-irons', 'taylormade', 'Irons', 'Stealth 2', 2023, array['Stealth 2', 'Stealth 2 Plus', 'Stealth 2 HD']::text[]),
  ('taylormade-stealth', 'taylormade', 'Drivers', 'Stealth', 2022, array['Stealth', 'Stealth Plus', 'Stealth HD']::text[]),
  ('taylormade-stealth-woods-hybrids', 'taylormade', 'Woods & hybrids', 'Stealth', 2022, array['Stealth', 'Stealth Plus', 'Stealth HD']::text[]),
  ('taylormade-stealth-irons', 'taylormade', 'Irons', 'Stealth', 2022, array['Stealth', 'Stealth Plus', 'Stealth HD']::text[]),
  ('taylormade-sim2', 'taylormade', 'Drivers', 'SIM2', 2021, array['SIM2', 'SIM2 Max', 'SIM2 Max D', 'SIM2 Max OS']::text[]),
  ('taylormade-sim2-woods-hybrids', 'taylormade', 'Woods & hybrids', 'SIM2', 2021, array['SIM2', 'SIM2 Max', 'SIM2 Max D', 'SIM2 Max OS']::text[]),
  ('taylormade-sim2-irons', 'taylormade', 'Irons', 'SIM2', 2021, array['SIM2', 'SIM2 Max', 'SIM2 Max D', 'SIM2 Max OS']::text[]),
  ('taylormade-sim', 'taylormade', 'Drivers', 'SIM', 2020, array['SIM', 'SIM Max', 'SIM Max D']::text[]),
  ('taylormade-sim-woods-hybrids', 'taylormade', 'Woods & hybrids', 'SIM', 2020, array['SIM', 'SIM Max', 'SIM Max D']::text[]),
  ('taylormade-m6', 'taylormade', 'Drivers', 'M6', 2019, array['M6', 'M6 D-Type']::text[]),
  ('taylormade-m6-woods-hybrids', 'taylormade', 'Woods & hybrids', 'M6', 2019, array['M6', 'M6 D-Type']::text[]),
  ('taylormade-m6-irons', 'taylormade', 'Irons', 'M6', 2019, array['M6', 'M6 D-Type']::text[]),
  ('taylormade-m5', 'taylormade', 'Drivers', 'M5', 2019, array['M5', 'M5 Tour']::text[]),
  ('taylormade-m5-woods-hybrids', 'taylormade', 'Woods & hybrids', 'M5', 2019, array['M5', 'M5 Tour']::text[]),
  ('taylormade-m4', 'taylormade', 'Drivers', 'M4', 2018, array['M4', 'M4 D-Type']::text[]),
  ('taylormade-m4-woods-hybrids', 'taylormade', 'Woods & hybrids', 'M4', 2018, array['M4', 'M4 D-Type']::text[]),
  ('taylormade-m4-irons', 'taylormade', 'Irons', 'M4', 2018, array['M4', 'M4 D-Type']::text[]),
  ('taylormade-m3', 'taylormade', 'Drivers', 'M3', 2018, array['M3 440', 'M3 460']::text[]),
  ('taylormade-m3-woods-hybrids', 'taylormade', 'Woods & hybrids', 'M3', 2018, array['M3 440', 'M3 460']::text[]),
  ('taylormade-m2', 'taylormade', 'Drivers', 'M2', 2016, array['M2 (2017)', 'M2 (2016)', 'M2 D-Type']::text[]),
  ('taylormade-m2-woods-hybrids', 'taylormade', 'Woods & hybrids', 'M2', 2016, array['M2 (2017)', 'M2 (2016)', 'M2 D-Type']::text[]),
  ('taylormade-m2-irons', 'taylormade', 'Irons', 'M2', 2016, array['M2 (2017)', 'M2 (2016)', 'M2 D-Type']::text[]),
  ('taylormade-m1', 'taylormade', 'Drivers', 'M1', 2016, array['M1 (2017)', 'M1 (2016)', 'M1 440']::text[]),
  ('taylormade-m1-woods-hybrids', 'taylormade', 'Woods & hybrids', 'M1', 2016, array['M1 (2017)', 'M1 (2016)', 'M1 440']::text[]),
  ('taylormade-r15', 'taylormade', 'Drivers', 'R15', 2015, array['R15 430', 'R15 460']::text[]),
  ('taylormade-r15-woods-hybrids', 'taylormade', 'Woods & hybrids', 'R15', 2015, array['R15 430', 'R15 460']::text[]),
  ('taylormade-aeroburner', 'taylormade', 'Drivers', 'AeroBurner', 2015, array['AeroBurner', 'AeroBurner TP']::text[]),
  ('taylormade-aeroburner-woods-hybrids', 'taylormade', 'Woods & hybrids', 'AeroBurner', 2015, array['AeroBurner', 'AeroBurner TP']::text[]),
  ('taylormade-sldr', 'taylormade', 'Drivers', 'SLDR', 2014, array['SLDR', 'SLDR 430', 'SLDR S']::text[]),
  ('taylormade-sldr-woods-hybrids', 'taylormade', 'Woods & hybrids', 'SLDR', 2014, array['SLDR', 'SLDR 430', 'SLDR S']::text[]),
  ('taylormade-jetspeed', 'taylormade', 'Drivers', 'JetSpeed', 2014, array['JetSpeed']::text[]),
  ('taylormade-jetspeed-woods-hybrids', 'taylormade', 'Woods & hybrids', 'JetSpeed', 2014, array['JetSpeed']::text[]),
  ('taylormade-r1', 'taylormade', 'Drivers', 'R1', 2013, array['R1', 'R1 Black']::text[]),
  ('taylormade-rocketballz', 'taylormade', 'Drivers', 'RocketBallz', 2012, array['RocketBallz', 'RBZ Stage 2', 'RBZ Tour']::text[]),
  ('taylormade-rocketballz-woods-hybrids', 'taylormade', 'Woods & hybrids', 'RocketBallz', 2012, array['RocketBallz', 'RBZ Stage 2', 'RBZ Tour']::text[]),
  ('taylormade-rocketballz-irons', 'taylormade', 'Irons', 'RocketBallz', 2012, array['RocketBallz', 'RBZ Stage 2', 'RBZ Tour']::text[]),
  ('taylormade-r11', 'taylormade', 'Drivers', 'R11', 2011, array['R11', 'R11S']::text[]),
  ('taylormade-r11-woods-hybrids', 'taylormade', 'Woods & hybrids', 'R11', 2011, array['R11', 'R11S']::text[]),
  ('taylormade-burner', 'taylormade', 'Drivers', 'Burner', 2007, array['Burner SuperFast', 'Burner 2.0', 'Burner Plus']::text[]),
  ('taylormade-burner-woods-hybrids', 'taylormade', 'Woods & hybrids', 'Burner', 2007, array['Burner SuperFast', 'Burner 2.0', 'Burner Plus']::text[]),
  ('taylormade-burner-irons', 'taylormade', 'Irons', 'Burner', 2007, array['Burner SuperFast', 'Burner 2.0', 'Burner Plus']::text[]),
  ('taylormade-p790', 'taylormade', 'Irons', 'P790', 2017, array['P790 (2025)', 'P790 (2023)', 'P790 (2021)', 'P790 (2019)', 'P790 (2017)']::text[]),
  ('taylormade-p770', 'taylormade', 'Irons', 'P770', 2020, array['P770 (2024)', 'P770 (2022)', 'P770 (2020)']::text[]),
  ('taylormade-p7mc', 'taylormade', 'Irons', 'P7MC', 2020, array['P7MC (2023)', 'P7MC (2020)']::text[]),
  ('taylormade-p7mb', 'taylormade', 'Irons', 'P7MB', 2020, array['P7MB (2023)', 'P7MB (2020)']::text[]),
  ('taylormade-p7cb', 'taylormade', 'Irons', 'P7CB', 2024, array['P7CB']::text[]),
  ('taylormade-p8cb', 'taylormade', 'Irons', 'P8CB', 2025, array['P8CB']::text[]),
  ('taylormade-tp-irons', 'taylormade', 'Irons', 'TP irons', 2017, array['P730', 'P750', 'P760']::text[]),
  ('taylormade-milled-grind', 'taylormade', 'Wedges', 'Milled Grind', 2017, array['MG4', 'MG3', 'MG2', 'Milled Grind']::text[]),
  ('taylormade-hi-toe', 'taylormade', 'Wedges', 'Hi-Toe', 2019, array['Hi-Toe 4', 'Hi-Toe 3', 'Hi-Toe Raw', 'Hi-Toe']::text[]),
  ('taylormade-spider-tour', 'taylormade', 'Putters', 'Spider Tour', 2023, array['Spider Tour', 'Spider Tour X', 'Spider Tour Z', 'Spider Tour V']::text[]),
  ('taylormade-spider-x', 'taylormade', 'Putters', 'Spider X', 2020, array['Spider X', 'Spider X Hydro Blast']::text[]),
  ('taylormade-spider-gt', 'taylormade', 'Putters', 'Spider GT', 2022, array['Spider GT', 'Spider GT X', 'Spider GT Max']::text[]),
  ('taylormade-spider-ex', 'taylormade', 'Putters', 'Spider EX', 2021, array['Spider EX']::text[]),
  ('taylormade-spider-tour-2019', 'taylormade', 'Putters', 'Spider Tour (2019)', 2019, array['Spider Tour', 'Spider Tour Red', 'Spider Tour Black']::text[]),
  ('taylormade-tp-collection', 'taylormade', 'Putters', 'TP Collection', 2019, array['Juno', 'Soto', 'Del Monte', 'Mullen', 'Ardmore', 'Bandon']::text[]),
  ('callaway-elyte', 'callaway', 'Drivers', 'Elyte', 2025, array['Elyte', 'Elyte Triple Diamond', 'Elyte X', 'Elyte Max Fast']::text[]),
  ('callaway-elyte-woods-hybrids', 'callaway', 'Woods & hybrids', 'Elyte', 2025, array['Elyte', 'Elyte Triple Diamond', 'Elyte X', 'Elyte Max Fast']::text[]),
  ('callaway-elyte-irons', 'callaway', 'Irons', 'Elyte', 2025, array['Elyte', 'Elyte Triple Diamond', 'Elyte X', 'Elyte Max Fast']::text[]),
  ('callaway-paradym-ai-smoke', 'callaway', 'Drivers', 'Paradym Ai Smoke', 2024, array['Ai Smoke', 'Ai Smoke Max', 'Ai Smoke Max D', 'Ai Smoke Max Fast', 'Ai Smoke Triple Diamond']::text[]),
  ('callaway-paradym-ai-smoke-woods-hybrids', 'callaway', 'Woods & hybrids', 'Paradym Ai Smoke', 2024, array['Ai Smoke', 'Ai Smoke Max', 'Ai Smoke Max D', 'Ai Smoke Max Fast', 'Ai Smoke Triple Diamond']::text[]),
  ('callaway-paradym-ai-smoke-irons', 'callaway', 'Irons', 'Paradym Ai Smoke', 2024, array['Ai Smoke', 'Ai Smoke Max', 'Ai Smoke Max D', 'Ai Smoke Max Fast', 'Ai Smoke Triple Diamond']::text[]),
  ('callaway-paradym', 'callaway', 'Drivers', 'Paradym', 2023, array['Paradym', 'Paradym X', 'Paradym Triple Diamond']::text[]),
  ('callaway-paradym-woods-hybrids', 'callaway', 'Woods & hybrids', 'Paradym', 2023, array['Paradym', 'Paradym X', 'Paradym Triple Diamond']::text[]),
  ('callaway-paradym-irons', 'callaway', 'Irons', 'Paradym', 2023, array['Paradym', 'Paradym X', 'Paradym Triple Diamond']::text[]),
  ('callaway-rogue-st', 'callaway', 'Drivers', 'Rogue ST', 2022, array['Rogue ST Max', 'Rogue ST Max LS', 'Rogue ST Max D', 'Rogue ST Triple Diamond LS', 'Rogue ST Pro']::text[]),
  ('callaway-rogue-st-woods-hybrids', 'callaway', 'Woods & hybrids', 'Rogue ST', 2022, array['Rogue ST Max', 'Rogue ST Max LS', 'Rogue ST Max D', 'Rogue ST Triple Diamond LS', 'Rogue ST Pro']::text[]),
  ('callaway-rogue-st-irons', 'callaway', 'Irons', 'Rogue ST', 2022, array['Rogue ST Max', 'Rogue ST Max LS', 'Rogue ST Max D', 'Rogue ST Triple Diamond LS', 'Rogue ST Pro']::text[]),
  ('callaway-epic', 'callaway', 'Drivers', 'Epic', 2021, array['Epic Speed', 'Epic Max', 'Epic Max LS', 'Epic Max Fast']::text[]),
  ('callaway-epic-woods-hybrids', 'callaway', 'Woods & hybrids', 'Epic', 2021, array['Epic Speed', 'Epic Max', 'Epic Max LS', 'Epic Max Fast']::text[]),
  ('callaway-mavrik', 'callaway', 'Drivers', 'Mavrik', 2020, array['Mavrik', 'Mavrik Sub Zero', 'Mavrik Max', 'Mavrik Pro']::text[]),
  ('callaway-mavrik-woods-hybrids', 'callaway', 'Woods & hybrids', 'Mavrik', 2020, array['Mavrik', 'Mavrik Sub Zero', 'Mavrik Max', 'Mavrik Pro']::text[]),
  ('callaway-mavrik-irons', 'callaway', 'Irons', 'Mavrik', 2020, array['Mavrik', 'Mavrik Sub Zero', 'Mavrik Max', 'Mavrik Pro']::text[]),
  ('callaway-epic-flash', 'callaway', 'Drivers', 'Epic Flash', 2019, array['Epic Flash', 'Epic Flash Sub Zero', 'Epic Flash Star']::text[]),
  ('callaway-epic-flash-woods-hybrids', 'callaway', 'Woods & hybrids', 'Epic Flash', 2019, array['Epic Flash', 'Epic Flash Sub Zero', 'Epic Flash Star']::text[]),
  ('callaway-rogue', 'callaway', 'Drivers', 'Rogue', 2018, array['Rogue', 'Rogue Sub Zero', 'Rogue Draw', 'Rogue Pro']::text[]),
  ('callaway-rogue-woods-hybrids', 'callaway', 'Woods & hybrids', 'Rogue', 2018, array['Rogue', 'Rogue Sub Zero', 'Rogue Draw', 'Rogue Pro']::text[]),
  ('callaway-rogue-irons', 'callaway', 'Irons', 'Rogue', 2018, array['Rogue', 'Rogue Sub Zero', 'Rogue Draw', 'Rogue Pro']::text[]),
  ('callaway-gbb-epic', 'callaway', 'Drivers', 'GBB Epic', 2017, array['GBB Epic', 'GBB Epic Sub Zero', 'Epic Star']::text[]),
  ('callaway-gbb-epic-woods-hybrids', 'callaway', 'Woods & hybrids', 'GBB Epic', 2017, array['GBB Epic', 'GBB Epic Sub Zero', 'Epic Star']::text[]),
  ('callaway-gbb-epic-irons', 'callaway', 'Irons', 'GBB Epic', 2017, array['GBB Epic', 'GBB Epic Sub Zero', 'Epic Star']::text[]),
  ('callaway-xr16', 'callaway', 'Drivers', 'XR16', 2016, array['XR16', 'XR16 Pro', 'XR16 Sub Zero']::text[]),
  ('callaway-xr16-woods-hybrids', 'callaway', 'Woods & hybrids', 'XR16', 2016, array['XR16', 'XR16 Pro', 'XR16 Sub Zero']::text[]),
  ('callaway-xr', 'callaway', 'Drivers', 'XR', 2015, array['XR', 'XR Pro', 'XR OS']::text[]),
  ('callaway-xr-woods-hybrids', 'callaway', 'Woods & hybrids', 'XR', 2015, array['XR', 'XR Pro', 'XR OS']::text[]),
  ('callaway-xr-irons', 'callaway', 'Irons', 'XR', 2015, array['XR', 'XR Pro', 'XR OS']::text[]),
  ('callaway-big-bertha', 'callaway', 'Drivers', 'Big Bertha', 2014, array['Big Bertha (2023)', 'Big Bertha B21', 'Big Bertha Fusion', 'Big Bertha Alpha 815', 'Big Bertha (2014)']::text[]),
  ('callaway-big-bertha-woods-hybrids', 'callaway', 'Woods & hybrids', 'Big Bertha', 2014, array['Big Bertha (2023)', 'Big Bertha B21', 'Big Bertha Fusion', 'Big Bertha Alpha 815', 'Big Bertha (2014)']::text[]),
  ('callaway-big-bertha-irons', 'callaway', 'Irons', 'Big Bertha', 2014, array['Big Bertha (2023)', 'Big Bertha B21', 'Big Bertha Fusion', 'Big Bertha Alpha 815', 'Big Bertha (2014)']::text[]),
  ('callaway-x2-hot', 'callaway', 'Drivers', 'X2 Hot', 2014, array['X2 Hot', 'X2 Hot Pro']::text[]),
  ('callaway-x2-hot-woods-hybrids', 'callaway', 'Woods & hybrids', 'X2 Hot', 2014, array['X2 Hot', 'X2 Hot Pro']::text[]),
  ('callaway-x2-hot-irons', 'callaway', 'Irons', 'X2 Hot', 2014, array['X2 Hot', 'X2 Hot Pro']::text[]),
  ('callaway-x-hot', 'callaway', 'Drivers', 'X Hot', 2013, array['X Hot', 'X Hot Pro']::text[]),
  ('callaway-x-hot-woods-hybrids', 'callaway', 'Woods & hybrids', 'X Hot', 2013, array['X Hot', 'X Hot Pro']::text[]),
  ('callaway-x-hot-irons', 'callaway', 'Irons', 'X Hot', 2013, array['X Hot', 'X Hot Pro']::text[]),
  ('callaway-razr-fit', 'callaway', 'Drivers', 'RAZR Fit', 2011, array['RAZR Fit', 'RAZR Fit Xtreme']::text[]),
  ('callaway-razr-fit-woods-hybrids', 'callaway', 'Woods & hybrids', 'RAZR Fit', 2011, array['RAZR Fit', 'RAZR Fit Xtreme']::text[]),
  ('callaway-ft', 'callaway', 'Drivers', 'FT', 2008, array['FT-9', 'FT-iQ', 'FT-i', 'FT Optiforce']::text[]),
  ('callaway-ft-woods-hybrids', 'callaway', 'Woods & hybrids', 'FT', 2008, array['FT-9', 'FT-iQ', 'FT-i', 'FT Optiforce']::text[]),
  ('callaway-apex', 'callaway', 'Irons', 'Apex', 2014, array['Apex (2024)', 'Apex Ai200', 'Apex Ai300', 'Apex (2021)', 'Apex (2019)', 'Apex CF16', 'Apex (2014)']::text[]),
  ('callaway-apex-pro', 'callaway', 'Irons', 'Apex Pro', 2014, array['Apex Pro (2024)', 'Apex Pro (2021)', 'Apex Pro (2019)', 'Apex Pro 16']::text[]),
  ('callaway-apex-mb-cb', 'callaway', 'Irons', 'Apex MB / CB', 2018, array['Apex MB', 'Apex CB', 'Apex TCB', 'Apex DCB']::text[]),
  ('callaway-x-forged', 'callaway', 'Irons', 'X Forged', 2013, array['X Forged (2021)', 'X Forged (2018)', 'X Forged (2013)']::text[]),
  ('callaway-opus', 'callaway', 'Wedges', 'Opus', 2024, array['Opus', 'Opus Platinum']::text[]),
  ('callaway-jaws-raw', 'callaway', 'Wedges', 'Jaws Raw', 2022, array['Jaws Raw', 'Jaws Raw Face']::text[]),
  ('callaway-jaws-md5', 'callaway', 'Wedges', 'Jaws MD5', 2019, array['Jaws MD5']::text[]),
  ('callaway-jaws-forged', 'callaway', 'Wedges', 'Jaws Forged', 2023, array['Jaws Forged']::text[]),
  ('callaway-mack-daddy', 'callaway', 'Wedges', 'Mack Daddy', 2014, array['Mack Daddy 4', 'Mack Daddy 3', 'Mack Daddy 2', 'Mack Daddy CB']::text[]),
  ('odyssey-ai-one', 'odyssey', 'Putters', 'Ai-One', 2023, array['Ai-One', 'Ai-One Milled', 'Ai-One Cruiser']::text[]),
  ('odyssey-square-2-square', 'odyssey', 'Putters', 'Square 2 Square', 2025, array['Ai-One Square 2 Square', 'Square 2 Square Jailbird']::text[]),
  ('odyssey-tri-hot-5k', 'odyssey', 'Putters', 'Tri-Hot 5K', 2022, array['Tri-Hot 5K One', 'Tri-Hot 5K Two', 'Tri-Hot 5K Double Wide']::text[]),
  ('odyssey-white-hot-og', 'odyssey', 'Putters', 'White Hot OG', 2021, array['White Hot OG One', 'White Hot OG Two', 'White Hot OG #7', 'White Hot OG Rossie']::text[]),
  ('odyssey-eleven', 'odyssey', 'Putters', 'Eleven', 2021, array['Eleven', 'Eleven Tour Lined']::text[]),
  ('odyssey-ten', 'odyssey', 'Putters', 'Ten', 2022, array['Ten', 'Ten Tour Lined']::text[]),
  ('odyssey-stroke-lab', 'odyssey', 'Putters', 'Stroke Lab', 2019, array['Stroke Lab', 'Stroke Lab Black']::text[]),
  ('odyssey-toulon', 'odyssey', 'Putters', 'Toulon', 2017, array['Toulon Design']::text[]),
  ('odyssey-o-works', 'odyssey', 'Putters', 'O-Works', 2017, array['O-Works', 'O-Works Red', 'O-Works Tour']::text[]),
  ('odyssey-white-hot-pro', 'odyssey', 'Putters', 'White Hot Pro', 2016, array['White Hot Pro 2.0', 'White Hot Pro 3.0', 'White Hot RX']::text[]),
  ('odyssey-versa', 'odyssey', 'Putters', 'Versa', 2015, array['Versa', 'Versa 2-Ball']::text[]),
  ('odyssey-2-ball', 'odyssey', 'Putters', '2-Ball', 2007, array['White Hot 2-Ball', '2-Ball Fang', '2-Ball Ten']::text[]),
  ('titleist-gt', 'titleist', 'Drivers', 'GT', 2024, array['GT1', 'GT2', 'GT3', 'GT4', 'GT280']::text[]),
  ('titleist-gt-woods-hybrids', 'titleist', 'Woods & hybrids', 'GT', 2024, array['GT1', 'GT2', 'GT3', 'GT4', 'GT280']::text[]),
  ('titleist-tsr', 'titleist', 'Drivers', 'TSR', 2022, array['TSR1', 'TSR2', 'TSR3', 'TSR4']::text[]),
  ('titleist-tsr-woods-hybrids', 'titleist', 'Woods & hybrids', 'TSR', 2022, array['TSR1', 'TSR2', 'TSR3', 'TSR4']::text[]),
  ('titleist-tsi', 'titleist', 'Drivers', 'TSi', 2020, array['TSi1', 'TSi2', 'TSi3', 'TSi4']::text[]),
  ('titleist-tsi-woods-hybrids', 'titleist', 'Woods & hybrids', 'TSi', 2020, array['TSi1', 'TSi2', 'TSi3', 'TSi4']::text[]),
  ('titleist-ts', 'titleist', 'Drivers', 'TS', 2018, array['TS1', 'TS2', 'TS3', 'TS4']::text[]),
  ('titleist-ts-woods-hybrids', 'titleist', 'Woods & hybrids', 'TS', 2018, array['TS1', 'TS2', 'TS3', 'TS4']::text[]),
  ('titleist-917', 'titleist', 'Drivers', '917', 2016, array['917 D2', '917 D3', '917 F2', '917 F3']::text[]),
  ('titleist-917-woods-hybrids', 'titleist', 'Woods & hybrids', '917', 2016, array['917 D2', '917 D3', '917 F2', '917 F3']::text[]),
  ('titleist-915', 'titleist', 'Drivers', '915', 2014, array['915 D2', '915 D3', '915 F', '915 Fd']::text[]),
  ('titleist-915-woods-hybrids', 'titleist', 'Woods & hybrids', '915', 2014, array['915 D2', '915 D3', '915 F', '915 Fd']::text[]),
  ('titleist-913', 'titleist', 'Drivers', '913', 2012, array['913 D2', '913 D3', '913 F']::text[]),
  ('titleist-913-woods-hybrids', 'titleist', 'Woods & hybrids', '913', 2012, array['913 D2', '913 D3', '913 F']::text[]),
  ('titleist-910', 'titleist', 'Drivers', '910', 2010, array['910 D2', '910 D3', '910 F']::text[]),
  ('titleist-910-woods-hybrids', 'titleist', 'Woods & hybrids', '910', 2010, array['910 D2', '910 D3', '910 F']::text[]),
  ('titleist-909', 'titleist', 'Drivers', '909', 2008, array['909 D2', '909 D3', '909 DComp']::text[]),
  ('titleist-t100', 'titleist', 'Irons', 'T100', 2019, array['T100 (2025)', 'T100 (2023)', 'T100 (2021)', 'T100 (2019)', 'T100S']::text[]),
  ('titleist-t150', 'titleist', 'Irons', 'T150', 2023, array['T150']::text[]),
  ('titleist-t200', 'titleist', 'Irons', 'T200', 2019, array['T200 (2023)', 'T200 (2021)', 'T200 (2019)']::text[]),
  ('titleist-t250', 'titleist', 'Irons', 'T250', 2025, array['T250']::text[]),
  ('titleist-t300', 'titleist', 'Irons', 'T300', 2019, array['T300 (2021)', 'T300 (2019)']::text[]),
  ('titleist-t350', 'titleist', 'Irons', 'T350', 2023, array['T350']::text[]),
  ('titleist-620', 'titleist', 'Irons', '620', 2018, array['620 MB', '620 CB']::text[]),
  ('titleist-718', 'titleist', 'Irons', '718', 2017, array['718 AP1', '718 AP2', '718 AP3', '718 CB', '718 MB']::text[]),
  ('titleist-716', 'titleist', 'Irons', '716', 2015, array['716 AP1', '716 AP2', '716 CB', '716 MB']::text[]),
  ('titleist-714', 'titleist', 'Irons', '714', 2013, array['714 AP1', '714 AP2', '714 CB', '714 MB']::text[]),
  ('titleist-712', 'titleist', 'Irons', '712', 2011, array['712 AP1', '712 AP2', '712 CB', '712 MB']::text[]),
  ('titleist-vokey-sm10', 'titleist', 'Wedges', 'Vokey SM10', 2024, array['SM10']::text[]),
  ('titleist-vokey-sm9', 'titleist', 'Wedges', 'Vokey SM9', 2022, array['SM9']::text[]),
  ('titleist-vokey-sm8', 'titleist', 'Wedges', 'Vokey SM8', 2020, array['SM8']::text[]),
  ('titleist-vokey-sm7', 'titleist', 'Wedges', 'Vokey SM7', 2018, array['SM7']::text[]),
  ('titleist-vokey-sm6', 'titleist', 'Wedges', 'Vokey SM6', 2016, array['SM6']::text[]),
  ('titleist-vokey-sm5-and-older', 'titleist', 'Wedges', 'Vokey SM5 and older', 2008, array['SM5', 'SM4', 'Spin Milled']::text[]),
  ('titleist-vokey-wedgeworks', 'titleist', 'Wedges', 'Vokey WedgeWorks', 2012, array['WedgeWorks']::text[]),
  ('scotty-cameron-studio-style', 'scotty-cameron', 'Putters', 'Studio Style', 2025, array['Newport', 'Newport 2', 'Newport 2 Plus', 'Fastback 1.5']::text[]),
  ('scotty-cameron-phantom', 'scotty-cameron', 'Putters', 'Phantom', 2024, array['Phantom 5', 'Phantom 5.5', 'Phantom 7', 'Phantom 9', 'Phantom 11']::text[]),
  ('scotty-cameron-super-select', 'scotty-cameron', 'Putters', 'Super Select', 2023, array['Newport', 'Newport 2', 'Newport 2 Plus', 'Squareback 2', 'Fastback 1.5', 'Del Mar']::text[]),
  ('scotty-cameron-phantom-x', 'scotty-cameron', 'Putters', 'Phantom X', 2019, array['Phantom X 5', 'Phantom X 5.5', 'Phantom X 7', 'Phantom X 9', 'Phantom X 11', 'Phantom X 12']::text[]),
  ('scotty-cameron-special-select', 'scotty-cameron', 'Putters', 'Special Select', 2020, array['Newport', 'Newport 2', 'Newport 2.5', 'Fastback', 'Squareback', 'Flowback', 'Del Mar']::text[]),
  ('scotty-cameron-select', 'scotty-cameron', 'Putters', 'Select', 2016, array['Newport', 'Newport 2', 'Newport 2.5', 'Fastback', 'Squareback', 'Laguna']::text[]),
  ('scotty-cameron-futura', 'scotty-cameron', 'Putters', 'Futura', 2014, array['Futura 5', 'Futura 6M', 'Futura X', 'Futura X5']::text[]),
  ('scotty-cameron-golo', 'scotty-cameron', 'Putters', 'GoLo', 2015, array['GoLo 3', 'GoLo 5', 'GoLo 7', 'GoLo S5']::text[]),
  ('scotty-cameron-studio-select', 'scotty-cameron', 'Putters', 'Studio Select', 2012, array['Newport', 'Newport 2', 'Kombi', 'Laguna']::text[]),
  ('scotty-cameron-california', 'scotty-cameron', 'Putters', 'California', 2012, array['Del Mar', 'Monterey', 'Fastback', 'Sonoma']::text[]),
  ('scotty-cameron-newport-older', 'scotty-cameron', 'Putters', 'Newport (older)', 2007, array['Studio Style', 'Detour', 'Red X', 'Circa 62']::text[]),
  ('ping-g440', 'ping', 'Drivers', 'G440', 2025, array['G440 Max', 'G440 LST', 'G440 SFT', 'G440 K', 'G440 HL']::text[]),
  ('ping-g440-woods-hybrids', 'ping', 'Woods & hybrids', 'G440', 2025, array['G440 Max', 'G440 LST', 'G440 SFT', 'G440 K', 'G440 HL']::text[]),
  ('ping-g440-irons', 'ping', 'Irons', 'G440', 2025, array['G440 Max', 'G440 LST', 'G440 SFT', 'G440 K', 'G440 HL']::text[]),
  ('ping-g430', 'ping', 'Drivers', 'G430', 2023, array['G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K', 'G430 HL']::text[]),
  ('ping-g430-woods-hybrids', 'ping', 'Woods & hybrids', 'G430', 2023, array['G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K', 'G430 HL']::text[]),
  ('ping-g430-irons', 'ping', 'Irons', 'G430', 2023, array['G430 Max', 'G430 LST', 'G430 SFT', 'G430 Max 10K', 'G430 HL']::text[]),
  ('ping-g425', 'ping', 'Drivers', 'G425', 2021, array['G425 Max', 'G425 LST', 'G425 SFT']::text[]),
  ('ping-g425-woods-hybrids', 'ping', 'Woods & hybrids', 'G425', 2021, array['G425 Max', 'G425 LST', 'G425 SFT']::text[]),
  ('ping-g425-irons', 'ping', 'Irons', 'G425', 2021, array['G425 Max', 'G425 LST', 'G425 SFT']::text[]),
  ('ping-g410', 'ping', 'Drivers', 'G410', 2019, array['G410 Plus', 'G410 LST', 'G410 SFT']::text[]),
  ('ping-g410-woods-hybrids', 'ping', 'Woods & hybrids', 'G410', 2019, array['G410 Plus', 'G410 LST', 'G410 SFT']::text[]),
  ('ping-g410-irons', 'ping', 'Irons', 'G410', 2019, array['G410 Plus', 'G410 LST', 'G410 SFT']::text[]),
  ('ping-g400', 'ping', 'Drivers', 'G400', 2017, array['G400', 'G400 Max', 'G400 LST', 'G400 SFT']::text[]),
  ('ping-g400-woods-hybrids', 'ping', 'Woods & hybrids', 'G400', 2017, array['G400', 'G400 Max', 'G400 LST', 'G400 SFT']::text[]),
  ('ping-g400-irons', 'ping', 'Irons', 'G400', 2017, array['G400', 'G400 Max', 'G400 LST', 'G400 SFT']::text[]),
  ('ping-g-2016', 'ping', 'Drivers', 'G (2016)', 2016, array['G', 'G LS Tec', 'G SF Tec', 'G Crossover']::text[]),
  ('ping-g-2016-woods-hybrids', 'ping', 'Woods & hybrids', 'G (2016)', 2016, array['G', 'G LS Tec', 'G SF Tec', 'G Crossover']::text[]),
  ('ping-g-2016-irons', 'ping', 'Irons', 'G (2016)', 2016, array['G', 'G LS Tec', 'G SF Tec', 'G Crossover']::text[]),
  ('ping-g30', 'ping', 'Drivers', 'G30', 2014, array['G30', 'G30 LS Tec', 'G30 SF Tec']::text[]),
  ('ping-g30-woods-hybrids', 'ping', 'Woods & hybrids', 'G30', 2014, array['G30', 'G30 LS Tec', 'G30 SF Tec']::text[]),
  ('ping-g30-irons', 'ping', 'Irons', 'G30', 2014, array['G30', 'G30 LS Tec', 'G30 SF Tec']::text[]),
  ('ping-g25', 'ping', 'Drivers', 'G25', 2013, array['G25']::text[]),
  ('ping-g25-woods-hybrids', 'ping', 'Woods & hybrids', 'G25', 2013, array['G25']::text[]),
  ('ping-g25-irons', 'ping', 'Irons', 'G25', 2013, array['G25']::text[]),
  ('ping-g20', 'ping', 'Drivers', 'G20', 2011, array['G20']::text[]),
  ('ping-g20-woods-hybrids', 'ping', 'Woods & hybrids', 'G20', 2011, array['G20']::text[]),
  ('ping-g20-irons', 'ping', 'Irons', 'G20', 2011, array['G20']::text[]),
  ('ping-g15', 'ping', 'Drivers', 'G15', 2009, array['G15']::text[]),
  ('ping-g15-woods-hybrids', 'ping', 'Woods & hybrids', 'G15', 2009, array['G15']::text[]),
  ('ping-g15-irons', 'ping', 'Irons', 'G15', 2009, array['G15']::text[]),
  ('ping-g10', 'ping', 'Drivers', 'G10', 2007, array['G10', 'G10 Draw']::text[]),
  ('ping-g10-woods-hybrids', 'ping', 'Woods & hybrids', 'G10', 2007, array['G10', 'G10 Draw']::text[]),
  ('ping-g10-irons', 'ping', 'Irons', 'G10', 2007, array['G10', 'G10 Draw']::text[]),
  ('ping-i230', 'ping', 'Irons', 'i230', 2023, array['i230']::text[]),
  ('ping-i240', 'ping', 'Irons', 'i240', 2025, array['i240']::text[]),
  ('ping-i530', 'ping', 'Irons', 'i530', 2024, array['i530']::text[]),
  ('ping-i525', 'ping', 'Irons', 'i525', 2022, array['i525']::text[]),
  ('ping-i59', 'ping', 'Irons', 'i59', 2021, array['i59']::text[]),
  ('ping-i210', 'ping', 'Irons', 'i210', 2018, array['i210']::text[]),
  ('ping-i500', 'ping', 'Irons', 'i500', 2018, array['i500']::text[]),
  ('ping-i200', 'ping', 'Irons', 'i200', 2016, array['i200']::text[]),
  ('ping-i25', 'ping', 'Irons', 'i25', 2015, array['i25', 'i E1']::text[]),
  ('ping-i20', 'ping', 'Irons', 'i20', 2012, array['i20', 'i15', 'i10']::text[]),
  ('ping-blueprint', 'ping', 'Irons', 'Blueprint', 2019, array['Blueprint T', 'Blueprint S', 'Blueprint (2019)']::text[]),
  ('ping-anser-forged', 'ping', 'Irons', 'Anser forged', 2010, array['Anser Forged', 'Anser (2014)']::text[]),
  ('ping-s159', 'ping', 'Wedges', 's159', 2024, array['s159']::text[]),
  ('ping-glide-4-0', 'ping', 'Wedges', 'Glide 4.0', 2022, array['Glide 4.0']::text[]),
  ('ping-glide-forged-pro', 'ping', 'Wedges', 'Glide Forged Pro', 2021, array['Glide Forged Pro', 'Glide Forged']::text[]),
  ('ping-glide-3-0', 'ping', 'Wedges', 'Glide 3.0', 2019, array['Glide 3.0']::text[]),
  ('ping-glide-2-0', 'ping', 'Wedges', 'Glide 2.0', 2017, array['Glide 2.0', 'Glide 2.0 Stealth', 'Glide']::text[]),
  ('ping-ping-putters-2024', 'ping', 'Putters', 'PING putters 2024', 2024, array['Anser', 'Anser 2D', 'DS72', 'Tyne 4', 'Tomcat 14', 'Mundy', 'Ketsch G']::text[]),
  ('ping-ping-putters-2023', 'ping', 'Putters', 'PING putters 2023', 2023, array['Anser', 'Tyne G', 'Fetch', 'Shea', 'Ketsch G', 'Tomcat 14', 'Kushin 4']::text[]),
  ('ping-ping-putters-2021', 'ping', 'Putters', 'PING putters 2021', 2021, array['Anser', 'Anser 2', 'Tyne 4', 'Harwood', 'Fetch', 'Oslo H', 'Kushin 4', 'Tomcat 14']::text[]),
  ('ping-pld-milled', 'ping', 'Putters', 'PLD Milled', 2018, array['PLD Anser', 'PLD Anser 2', 'PLD DS72', 'PLD Prime Tyne 4', 'PLD Oslo 3']::text[]),
  ('ping-sigma-2', 'ping', 'Putters', 'Sigma 2', 2019, array['Sigma 2 Anser', 'Sigma 2 Tyne', 'Sigma 2 Fetch', 'Sigma 2 Arna', 'Sigma 2 Valor']::text[]),
  ('ping-heppler', 'ping', 'Putters', 'Heppler', 2020, array['Heppler Anser 2', 'Heppler Tomcat 14', 'Heppler Fetch', 'Heppler ZB3', 'Heppler Floki']::text[]),
  ('ping-vault', 'ping', 'Putters', 'Vault', 2016, array['Vault Anser', 'Vault Oslo', 'Vault Voss', 'Vault 2.0']::text[]),
  ('ping-cadence-tr', 'ping', 'Putters', 'Cadence TR', 2015, array['Cadence TR Anser', 'Cadence TR Ketsch', 'Cadence TR Craz-E']::text[]),
  ('ping-karsten-anser-classics', 'ping', 'Putters', 'Karsten / Anser classics', 2007, array['Anser', 'Anser 2', 'Zing', 'B60', 'Pal', 'Craz-E']::text[]),
  ('cobra-ds-adapt', 'cobra', 'Drivers', 'DS-Adapt', 2025, array['DS-Adapt Max K', 'DS-Adapt X', 'DS-Adapt LS', 'DS-Adapt Max']::text[]),
  ('cobra-ds-adapt-woods-hybrids', 'cobra', 'Woods & hybrids', 'DS-Adapt', 2025, array['DS-Adapt Max K', 'DS-Adapt X', 'DS-Adapt LS', 'DS-Adapt Max']::text[]),
  ('cobra-ds-adapt-irons', 'cobra', 'Irons', 'DS-Adapt', 2025, array['DS-Adapt Max K', 'DS-Adapt X', 'DS-Adapt LS', 'DS-Adapt Max']::text[]),
  ('cobra-darkspeed', 'cobra', 'Drivers', 'Darkspeed', 2024, array['Darkspeed', 'Darkspeed Max', 'Darkspeed X', 'Darkspeed LS']::text[]),
  ('cobra-darkspeed-woods-hybrids', 'cobra', 'Woods & hybrids', 'Darkspeed', 2024, array['Darkspeed', 'Darkspeed Max', 'Darkspeed X', 'Darkspeed LS']::text[]),
  ('cobra-darkspeed-irons', 'cobra', 'Irons', 'Darkspeed', 2024, array['Darkspeed', 'Darkspeed Max', 'Darkspeed X', 'Darkspeed LS']::text[]),
  ('cobra-aerojet', 'cobra', 'Drivers', 'Aerojet', 2023, array['Aerojet', 'Aerojet Max', 'Aerojet LS']::text[]),
  ('cobra-aerojet-woods-hybrids', 'cobra', 'Woods & hybrids', 'Aerojet', 2023, array['Aerojet', 'Aerojet Max', 'Aerojet LS']::text[]),
  ('cobra-aerojet-irons', 'cobra', 'Irons', 'Aerojet', 2023, array['Aerojet', 'Aerojet Max', 'Aerojet LS']::text[]),
  ('cobra-ltdx', 'cobra', 'Drivers', 'LTDx', 2022, array['LTDx', 'LTDx Max', 'LTDx LS']::text[]),
  ('cobra-ltdx-woods-hybrids', 'cobra', 'Woods & hybrids', 'LTDx', 2022, array['LTDx', 'LTDx Max', 'LTDx LS']::text[]),
  ('cobra-ltdx-irons', 'cobra', 'Irons', 'LTDx', 2022, array['LTDx', 'LTDx Max', 'LTDx LS']::text[]),
  ('cobra-radspeed', 'cobra', 'Drivers', 'Radspeed', 2021, array['Radspeed', 'Radspeed XB', 'Radspeed XD']::text[]),
  ('cobra-radspeed-woods-hybrids', 'cobra', 'Woods & hybrids', 'Radspeed', 2021, array['Radspeed', 'Radspeed XB', 'Radspeed XD']::text[]),
  ('cobra-radspeed-irons', 'cobra', 'Irons', 'Radspeed', 2021, array['Radspeed', 'Radspeed XB', 'Radspeed XD']::text[]),
  ('cobra-speedzone', 'cobra', 'Drivers', 'SpeedZone', 2020, array['SpeedZone', 'SpeedZone Xtreme', 'SpeedZone One Length']::text[]),
  ('cobra-speedzone-woods-hybrids', 'cobra', 'Woods & hybrids', 'SpeedZone', 2020, array['SpeedZone', 'SpeedZone Xtreme', 'SpeedZone One Length']::text[]),
  ('cobra-speedzone-irons', 'cobra', 'Irons', 'SpeedZone', 2020, array['SpeedZone', 'SpeedZone Xtreme', 'SpeedZone One Length']::text[]),
  ('cobra-f9-speedback', 'cobra', 'Drivers', 'F9 Speedback', 2019, array['F9 Speedback', 'F9 One Length']::text[]),
  ('cobra-f9-speedback-woods-hybrids', 'cobra', 'Woods & hybrids', 'F9 Speedback', 2019, array['F9 Speedback', 'F9 One Length']::text[]),
  ('cobra-f9-speedback-irons', 'cobra', 'Irons', 'F9 Speedback', 2019, array['F9 Speedback', 'F9 One Length']::text[]),
  ('cobra-king-f8', 'cobra', 'Drivers', 'King F8', 2018, array['King F8', 'King F8+', 'F8 One Length']::text[]),
  ('cobra-king-f8-woods-hybrids', 'cobra', 'Woods & hybrids', 'King F8', 2018, array['King F8', 'King F8+', 'F8 One Length']::text[]),
  ('cobra-king-f8-irons', 'cobra', 'Irons', 'King F8', 2018, array['King F8', 'King F8+', 'F8 One Length']::text[]),
  ('cobra-king-f7', 'cobra', 'Drivers', 'King F7', 2017, array['King F7', 'King F7+', 'F7 One Length']::text[]),
  ('cobra-king-f7-woods-hybrids', 'cobra', 'Woods & hybrids', 'King F7', 2017, array['King F7', 'King F7+', 'F7 One Length']::text[]),
  ('cobra-king-f7-irons', 'cobra', 'Irons', 'King F7', 2017, array['King F7', 'King F7+', 'F7 One Length']::text[]),
  ('cobra-king-ltd', 'cobra', 'Drivers', 'King LTD', 2017, array['King LTD', 'King LTD Pro']::text[]),
  ('cobra-king-ltd-woods-hybrids', 'cobra', 'Woods & hybrids', 'King LTD', 2017, array['King LTD', 'King LTD Pro']::text[]),
  ('cobra-fly-z', 'cobra', 'Drivers', 'Fly-Z', 2015, array['Fly-Z', 'Fly-Z+', 'Fly-Z XL']::text[]),
  ('cobra-fly-z-woods-hybrids', 'cobra', 'Woods & hybrids', 'Fly-Z', 2015, array['Fly-Z', 'Fly-Z+', 'Fly-Z XL']::text[]),
  ('cobra-fly-z-irons', 'cobra', 'Irons', 'Fly-Z', 2015, array['Fly-Z', 'Fly-Z+', 'Fly-Z XL']::text[]),
  ('cobra-bio-cell', 'cobra', 'Drivers', 'Bio Cell', 2014, array['Bio Cell', 'Bio Cell+']::text[]),
  ('cobra-bio-cell-woods-hybrids', 'cobra', 'Woods & hybrids', 'Bio Cell', 2014, array['Bio Cell', 'Bio Cell+']::text[]),
  ('cobra-bio-cell-irons', 'cobra', 'Irons', 'Bio Cell', 2014, array['Bio Cell', 'Bio Cell+']::text[]),
  ('cobra-amp-cell', 'cobra', 'Drivers', 'AMP Cell', 2013, array['AMP Cell', 'AMP Cell Pro']::text[]),
  ('cobra-amp-cell-woods-hybrids', 'cobra', 'Woods & hybrids', 'AMP Cell', 2013, array['AMP Cell', 'AMP Cell Pro']::text[]),
  ('cobra-amp-cell-irons', 'cobra', 'Irons', 'AMP Cell', 2013, array['AMP Cell', 'AMP Cell Pro']::text[]),
  ('cobra-king-tour', 'cobra', 'Irons', 'King Tour', 2020, array['King Tour (2023)', 'King Tour (2020)', 'King Forged Tec', 'King CB/MB']::text[]),
  ('cobra-snakebite', 'cobra', 'Wedges', 'Snakebite', 2021, array['King Cobra Snakebite', 'King Cobra Wedge', 'Snakebite Black']::text[]),
  ('cobra-king-putters', 'cobra', 'Putters', 'King putters', 2020, array['Vintage', '3D Printed Agera', '3D Printed Grandsport', 'Sport-45']::text[]),
  ('mizuno-st-2025', 'mizuno', 'Drivers', 'ST 2025', 2025, array['ST-Max', 'ST-G', 'ST-Z (2025)']::text[]),
  ('mizuno-st-2025-woods-hybrids', 'mizuno', 'Woods & hybrids', 'ST 2025', 2025, array['ST-Max', 'ST-G', 'ST-Z (2025)']::text[]),
  ('mizuno-st-230', 'mizuno', 'Drivers', 'ST 230', 2023, array['ST-Max 230', 'ST-Z 230', 'ST-X 230']::text[]),
  ('mizuno-st-230-woods-hybrids', 'mizuno', 'Woods & hybrids', 'ST 230', 2023, array['ST-Max 230', 'ST-Z 230', 'ST-X 230']::text[]),
  ('mizuno-st-220', 'mizuno', 'Drivers', 'ST 220', 2022, array['ST-Z 220', 'ST-X 220', 'ST-G 220']::text[]),
  ('mizuno-st-220-woods-hybrids', 'mizuno', 'Woods & hybrids', 'ST 220', 2022, array['ST-Z 220', 'ST-X 220', 'ST-G 220']::text[]),
  ('mizuno-st200', 'mizuno', 'Drivers', 'ST200', 2020, array['ST200', 'ST200G', 'ST200X']::text[]),
  ('mizuno-st200-woods-hybrids', 'mizuno', 'Woods & hybrids', 'ST200', 2020, array['ST200', 'ST200G', 'ST200X']::text[]),
  ('mizuno-st190', 'mizuno', 'Drivers', 'ST190', 2019, array['ST190', 'ST190G']::text[]),
  ('mizuno-st190-woods-hybrids', 'mizuno', 'Woods & hybrids', 'ST190', 2019, array['ST190', 'ST190G']::text[]),
  ('mizuno-gt180', 'mizuno', 'Drivers', 'GT180', 2018, array['GT180']::text[]),
  ('mizuno-jpx-925', 'mizuno', 'Irons', 'JPX 925', 2025, array['JPX 925 Forged', 'JPX 925 Hot Metal', 'JPX 925 Hot Metal Pro', 'JPX 925 Hot Metal HL', 'JPX 925 Tour']::text[]),
  ('mizuno-jpx-923', 'mizuno', 'Irons', 'JPX 923', 2023, array['JPX 923 Forged', 'JPX 923 Hot Metal', 'JPX 923 Hot Metal Pro', 'JPX 923 Tour']::text[]),
  ('mizuno-jpx-921', 'mizuno', 'Irons', 'JPX 921', 2021, array['JPX 921 Forged', 'JPX 921 Hot Metal', 'JPX 921 Tour']::text[]),
  ('mizuno-jpx-919', 'mizuno', 'Irons', 'JPX 919', 2019, array['JPX 919 Forged', 'JPX 919 Hot Metal', 'JPX 919 Tour']::text[]),
  ('mizuno-jpx-900', 'mizuno', 'Irons', 'JPX 900', 2016, array['JPX 900 Forged', 'JPX 900 Hot Metal', 'JPX 900 Tour']::text[]),
  ('mizuno-jpx-850', 'mizuno', 'Irons', 'JPX 850', 2014, array['JPX 850', 'JPX 850 Forged']::text[]),
  ('mizuno-jpx-825-800', 'mizuno', 'Irons', 'JPX 825 / 800', 2010, array['JPX 825', 'JPX 825 Pro', 'JPX 800']::text[]),
  ('mizuno-pro-24x', 'mizuno', 'Irons', 'Pro 24x', 2024, array['Pro 241', 'Pro 243', 'Pro 245']::text[]),
  ('mizuno-pro-22x', 'mizuno', 'Irons', 'Pro 22x', 2022, array['Pro 221', 'Pro 223', 'Pro 225']::text[]),
  ('mizuno-mp-20', 'mizuno', 'Irons', 'MP-20', 2020, array['MP-20 MB', 'MP-20 MMC', 'MP-20 HMB']::text[]),
  ('mizuno-mp-18', 'mizuno', 'Irons', 'MP-18', 2018, array['MP-18', 'MP-18 SC', 'MP-18 MMC']::text[]),
  ('mizuno-mp-5-mp-25', 'mizuno', 'Irons', 'MP-5 / MP-25', 2015, array['MP-5', 'MP-25', 'MP-15', 'MP-H5']::text[]),
  ('mizuno-t24', 'mizuno', 'Wedges', 'T24', 2024, array['T24']::text[]),
  ('mizuno-s23', 'mizuno', 'Wedges', 'S23', 2023, array['S23']::text[]),
  ('mizuno-t22', 'mizuno', 'Wedges', 'T22', 2022, array['T22']::text[]),
  ('mizuno-es21', 'mizuno', 'Wedges', 'ES21', 2021, array['ES21']::text[]),
  ('mizuno-t20', 'mizuno', 'Wedges', 'T20', 2020, array['T20']::text[]),
  ('mizuno-s18-t7', 'mizuno', 'Wedges', 'S18 / T7', 2017, array['S18', 'T7', 'S5']::text[]),
  ('mizuno-m-craft', 'mizuno', 'Putters', 'M.Craft', 2020, array['M.Craft I', 'M.Craft II', 'M.Craft III', 'M.Craft IV']::text[]),
  ('srixon-zxi', 'srixon', 'Drivers', 'ZXi', 2025, array['ZXi', 'ZXi LS', 'ZXi Max', 'ZXi4', 'ZXi5', 'ZXi7', 'ZXi CB', 'ZXi MB']::text[]),
  ('srixon-zxi-woods-hybrids', 'srixon', 'Woods & hybrids', 'ZXi', 2025, array['ZXi', 'ZXi LS', 'ZXi Max', 'ZXi4', 'ZXi5', 'ZXi7', 'ZXi CB', 'ZXi MB']::text[]),
  ('srixon-zxi-irons', 'srixon', 'Irons', 'ZXi', 2025, array['ZXi', 'ZXi LS', 'ZXi Max', 'ZXi4', 'ZXi5', 'ZXi7', 'ZXi CB', 'ZXi MB']::text[]),
  ('srixon-zx-mk-ii', 'srixon', 'Drivers', 'ZX Mk II', 2023, array['ZX5 Mk II', 'ZX7 Mk II', 'ZX5 Mk II LS', 'ZX4 Mk II', 'ZX Mk II MB', 'ZX Mk II CB']::text[]),
  ('srixon-zx-mk-ii-woods-hybrids', 'srixon', 'Woods & hybrids', 'ZX Mk II', 2023, array['ZX5 Mk II', 'ZX7 Mk II', 'ZX5 Mk II LS', 'ZX4 Mk II', 'ZX Mk II MB', 'ZX Mk II CB']::text[]),
  ('srixon-zx-mk-ii-irons', 'srixon', 'Irons', 'ZX Mk II', 2023, array['ZX5 Mk II', 'ZX7 Mk II', 'ZX5 Mk II LS', 'ZX4 Mk II', 'ZX Mk II MB', 'ZX Mk II CB']::text[]),
  ('srixon-zx', 'srixon', 'Drivers', 'ZX', 2020, array['ZX5', 'ZX7', 'ZX4', 'ZX MB']::text[]),
  ('srixon-zx-woods-hybrids', 'srixon', 'Woods & hybrids', 'ZX', 2020, array['ZX5', 'ZX7', 'ZX4', 'ZX MB']::text[]),
  ('srixon-zx-irons', 'srixon', 'Irons', 'ZX', 2020, array['ZX5', 'ZX7', 'ZX4', 'ZX MB']::text[]),
  ('srixon-z-85', 'srixon', 'Drivers', 'Z 85', 2018, array['Z785', 'Z585', 'Z985', 'Z H85', 'Z F85']::text[]),
  ('srixon-z-85-woods-hybrids', 'srixon', 'Woods & hybrids', 'Z 85', 2018, array['Z785', 'Z585', 'Z985', 'Z H85', 'Z F85']::text[]),
  ('srixon-z-85-irons', 'srixon', 'Irons', 'Z 85', 2018, array['Z785', 'Z585', 'Z985', 'Z H85', 'Z F85']::text[]),
  ('srixon-z-65', 'srixon', 'Drivers', 'Z 65', 2016, array['Z765', 'Z565', 'Z965', 'Z H65', 'Z F65']::text[]),
  ('srixon-z-65-woods-hybrids', 'srixon', 'Woods & hybrids', 'Z 65', 2016, array['Z765', 'Z565', 'Z965', 'Z H65', 'Z F65']::text[]),
  ('srixon-z-65-irons', 'srixon', 'Irons', 'Z 65', 2016, array['Z765', 'Z565', 'Z965', 'Z H65', 'Z F65']::text[]),
  ('srixon-z-45', 'srixon', 'Drivers', 'Z 45', 2014, array['Z745', 'Z545', 'Z945', 'Z355']::text[]),
  ('srixon-z-45-woods-hybrids', 'srixon', 'Woods & hybrids', 'Z 45', 2014, array['Z745', 'Z545', 'Z945', 'Z355']::text[]),
  ('srixon-z-45-irons', 'srixon', 'Irons', 'Z 45', 2014, array['Z745', 'Z545', 'Z945', 'Z355']::text[]),
  ('cleveland-rtx-6-zipcore', 'cleveland', 'Wedges', 'RTX 6 ZipCore', 2023, array['RTX 6 ZipCore', 'RTX 6 ZipCore Black Satin']::text[]),
  ('cleveland-rtx-zipcore', 'cleveland', 'Wedges', 'RTX ZipCore', 2020, array['RTX ZipCore', 'RTX ZipCore Full-Face']::text[]),
  ('cleveland-rtx-4', 'cleveland', 'Wedges', 'RTX 4', 2018, array['RTX 4', 'RTX 4 Full-Face']::text[]),
  ('cleveland-rtx-3', 'cleveland', 'Wedges', 'RTX-3', 2016, array['RTX-3', 'RTX-3 CB']::text[]),
  ('cleveland-588-rtx', 'cleveland', 'Wedges', '588 RTX', 2013, array['588 RTX 2.0', '588 RTX', '588 Forged']::text[]),
  ('cleveland-cbx', 'cleveland', 'Wedges', 'CBX', 2018, array['CBX 4 ZipCore', 'CBX 2', 'CBX ZipCore', 'CBX Full-Face']::text[]),
  ('cleveland-smart-sole', 'cleveland', 'Wedges', 'Smart Sole', 2016, array['Smart Sole 4', 'Smart Sole 3']::text[]),
  ('cleveland-cvx-zipcore', 'cleveland', 'Wedges', 'CVX ZipCore', 2022, array['CVX ZipCore', 'CVX 2 ZipCore']::text[]),
  ('cleveland-launcher', 'cleveland', 'Drivers', 'Launcher', 2019, array['Launcher XL', 'Launcher XL Lite', 'Launcher HB Turbo', 'Launcher UHX', 'Launcher XL Halo', 'Halo XL']::text[]),
  ('cleveland-launcher-woods-hybrids', 'cleveland', 'Woods & hybrids', 'Launcher', 2019, array['Launcher XL', 'Launcher XL Lite', 'Launcher HB Turbo', 'Launcher UHX', 'Launcher XL Halo', 'Halo XL']::text[]),
  ('cleveland-launcher-irons', 'cleveland', 'Irons', 'Launcher', 2019, array['Launcher XL', 'Launcher XL Lite', 'Launcher HB Turbo', 'Launcher UHX', 'Launcher XL Halo', 'Halo XL']::text[]),
  ('cleveland-frontline', 'cleveland', 'Putters', 'Frontline', 2021, array['Frontline Elite', 'Frontline Cero', 'Frontline Iso', 'Frontline 4.0']::text[]),
  ('cleveland-hb-soft', 'cleveland', 'Putters', 'HB Soft', 2018, array['HB Soft 2', 'HB Soft Milled', 'Huntington Beach Soft']::text[]),
  ('wilson-dynapower', 'wilson', 'Drivers', 'Dynapower', 2024, array['Dynapower', 'Dynapower LS', 'Dynapower Max', 'Dynapower Titanium']::text[]),
  ('wilson-dynapower-woods-hybrids', 'wilson', 'Woods & hybrids', 'Dynapower', 2024, array['Dynapower', 'Dynapower LS', 'Dynapower Max', 'Dynapower Titanium']::text[]),
  ('wilson-dynapower-irons', 'wilson', 'Irons', 'Dynapower', 2024, array['Dynapower', 'Dynapower LS', 'Dynapower Max', 'Dynapower Titanium']::text[]),
  ('wilson-launch-pad', 'wilson', 'Drivers', 'Launch Pad', 2022, array['Launch Pad', 'Launch Pad 2']::text[]),
  ('wilson-launch-pad-woods-hybrids', 'wilson', 'Woods & hybrids', 'Launch Pad', 2022, array['Launch Pad', 'Launch Pad 2']::text[]),
  ('wilson-launch-pad-irons', 'wilson', 'Irons', 'Launch Pad', 2022, array['Launch Pad', 'Launch Pad 2']::text[]),
  ('wilson-d9', 'wilson', 'Drivers', 'D9', 2020, array['D9']::text[]),
  ('wilson-d9-woods-hybrids', 'wilson', 'Woods & hybrids', 'D9', 2020, array['D9']::text[]),
  ('wilson-d9-irons', 'wilson', 'Irons', 'D9', 2020, array['D9']::text[]),
  ('wilson-d7', 'wilson', 'Drivers', 'D7', 2018, array['D7']::text[]),
  ('wilson-d7-woods-hybrids', 'wilson', 'Woods & hybrids', 'D7', 2018, array['D7']::text[]),
  ('wilson-d7-irons', 'wilson', 'Irons', 'D7', 2018, array['D7']::text[]),
  ('wilson-staff-model', 'wilson', 'Irons', 'Staff Model', 2020, array['Staff Model Blade', 'Staff Model CB', 'Staff Model Utility', 'Staff Model Hi-Toe']::text[]),
  ('wilson-staff-model-wedges', 'wilson', 'Wedges', 'Staff Model', 2020, array['Staff Model Blade', 'Staff Model CB', 'Staff Model Utility', 'Staff Model Hi-Toe']::text[]),
  ('wilson-c300-fg-tour', 'wilson', 'Drivers', 'C300 / FG Tour', 2016, array['C300', 'FG Tour F5', 'FG Tour V6', 'FG Tour 100']::text[]),
  ('wilson-c300-fg-tour-woods-hybrids', 'wilson', 'Woods & hybrids', 'C300 / FG Tour', 2016, array['C300', 'FG Tour F5', 'FG Tour V6', 'FG Tour 100']::text[]),
  ('wilson-c300-fg-tour-irons', 'wilson', 'Irons', 'C300 / FG Tour', 2016, array['C300', 'FG Tour F5', 'FG Tour V6', 'FG Tour 100']::text[]),
  ('wilson-infinite', 'wilson', 'Putters', 'Infinite', 2020, array['Infinite Windy City', 'Infinite Grant Park', 'Infinite Bean', 'Infinite Michigan Ave']::text[]),
  ('pxg-black-ops', 'pxg', 'Drivers', 'Black Ops', 2024, array['Black Ops', 'Black Ops Tour-1', 'Black Ops Ultra Lite']::text[]),
  ('pxg-black-ops-woods-hybrids', 'pxg', 'Woods & hybrids', 'Black Ops', 2024, array['Black Ops', 'Black Ops Tour-1', 'Black Ops Ultra Lite']::text[]),
  ('pxg-0311-drivers', 'pxg', 'Drivers', '0311 drivers', 2021, array['0311 Gen6', '0311 Gen5', '0311 Gen4']::text[]),
  ('pxg-0311-drivers-woods-hybrids', 'pxg', 'Woods & hybrids', '0311 drivers', 2021, array['0311 Gen6', '0311 Gen5', '0311 Gen4']::text[]),
  ('pxg-0211', 'pxg', 'Drivers', '0211', 2019, array['0211 (2022)', '0211 (2021)', '0211 (2019)']::text[]),
  ('pxg-0211-woods-hybrids', 'pxg', 'Woods & hybrids', '0211', 2019, array['0211 (2022)', '0211 (2021)', '0211 (2019)']::text[]),
  ('pxg-0211-irons', 'pxg', 'Irons', '0211', 2019, array['0211 (2022)', '0211 (2021)', '0211 (2019)']::text[]),
  ('pxg-0311-irons', 'pxg', 'Irons', '0311 irons', 2016, array['0311 Gen7', '0311 Gen6', '0311 Gen5', '0311 Gen4', '0311 Gen3', '0311 Gen2', '0311 P', '0311 T', '0311 XP']::text[]),
  ('pxg-0311-forged-sugar-daddy', 'pxg', 'Wedges', '0311 Forged / Sugar Daddy', 2018, array['0311 Forged', 'Sugar Daddy', 'Sugar Daddy II']::text[]),
  ('pxg-battle-ready', 'pxg', 'Putters', 'Battle Ready', 2022, array['Battle Ready', 'Battle Ready II']::text[]),
  ('xxio-xxio-13', 'xxio', 'Drivers', 'XXIO 13', 2024, array['XXIO 13', 'XXIO 13 Ladies']::text[]),
  ('xxio-xxio-13-woods-hybrids', 'xxio', 'Woods & hybrids', 'XXIO 13', 2024, array['XXIO 13', 'XXIO 13 Ladies']::text[]),
  ('xxio-xxio-13-irons', 'xxio', 'Irons', 'XXIO 13', 2024, array['XXIO 13', 'XXIO 13 Ladies']::text[]),
  ('xxio-xxio-12', 'xxio', 'Drivers', 'XXIO 12', 2022, array['XXIO 12', 'XXIO 12 Ladies']::text[]),
  ('xxio-xxio-12-woods-hybrids', 'xxio', 'Woods & hybrids', 'XXIO 12', 2022, array['XXIO 12', 'XXIO 12 Ladies']::text[]),
  ('xxio-xxio-12-irons', 'xxio', 'Irons', 'XXIO 12', 2022, array['XXIO 12', 'XXIO 12 Ladies']::text[]),
  ('xxio-xxio-x', 'xxio', 'Drivers', 'XXIO X', 2020, array['XXIO X', 'XXIO X Black']::text[]),
  ('xxio-xxio-x-woods-hybrids', 'xxio', 'Woods & hybrids', 'XXIO X', 2020, array['XXIO X', 'XXIO X Black']::text[]),
  ('xxio-xxio-x-irons', 'xxio', 'Irons', 'XXIO X', 2020, array['XXIO X', 'XXIO X Black']::text[]),
  ('xxio-xxio-11', 'xxio', 'Drivers', 'XXIO 11', 2020, array['XXIO 11']::text[]),
  ('xxio-xxio-11-woods-hybrids', 'xxio', 'Woods & hybrids', 'XXIO 11', 2020, array['XXIO 11']::text[]),
  ('xxio-xxio-11-irons', 'xxio', 'Irons', 'XXIO 11', 2020, array['XXIO 11']::text[]),
  ('honma-tr20-tr21', 'honma', 'Drivers', 'TR20 / TR21', 2020, array['TR20 460', 'TR20 440', 'TR21 X', 'TR21 P']::text[]),
  ('honma-tr20-tr21-woods-hybrids', 'honma', 'Woods & hybrids', 'TR20 / TR21', 2020, array['TR20 460', 'TR20 440', 'TR21 X', 'TR21 P']::text[]),
  ('honma-tr20-tr21-irons', 'honma', 'Irons', 'TR20 / TR21', 2020, array['TR20 460', 'TR20 440', 'TR21 X', 'TR21 P']::text[]),
  ('honma-t-world', 'honma', 'Drivers', 'T//World', 2019, array['T//World GS', 'T//World XP-1', 'T//World TW747']::text[]),
  ('honma-t-world-woods-hybrids', 'honma', 'Woods & hybrids', 'T//World', 2019, array['T//World GS', 'T//World XP-1', 'T//World TW747']::text[]),
  ('honma-t-world-irons', 'honma', 'Irons', 'T//World', 2019, array['T//World GS', 'T//World XP-1', 'T//World TW747']::text[]),
  ('honma-beres', 'honma', 'Drivers', 'Beres', 2019, array['Beres 07', 'Beres Aizu', 'Beres 09']::text[]),
  ('honma-beres-woods-hybrids', 'honma', 'Woods & hybrids', 'Beres', 2019, array['Beres 07', 'Beres Aizu', 'Beres 09']::text[]),
  ('honma-beres-irons', 'honma', 'Irons', 'Beres', 2019, array['Beres 07', 'Beres Aizu', 'Beres 09']::text[]),
  ('motocaddy-m7-remote', 'motocaddy', 'Bags & trolleys', 'M7 Remote', 2021, array['M7 Remote', 'M7 GPS Remote']::text[]),
  ('motocaddy-m5-gps', 'motocaddy', 'Bags & trolleys', 'M5 GPS', 2019, array['M5 GPS', 'M5 GPS DHC']::text[]),
  ('motocaddy-m3-pro-m3-gps', 'motocaddy', 'Bags & trolleys', 'M3 Pro / M3 GPS', 2016, array['M3 Pro', 'M3 GPS', 'M3 GPS DHC']::text[]),
  ('motocaddy-m1', 'motocaddy', 'Bags & trolleys', 'M1', 2016, array['M1', 'M1 DHC']::text[]),
  ('motocaddy-s-series', 'motocaddy', 'Bags & trolleys', 'S-series', 2010, array['S1', 'S3 Pro', 'S5 Connect', 'S7 Remote']::text[]),
  ('motocaddy-push-trolleys', 'motocaddy', 'Bags & trolleys', 'Push trolleys', 2014, array['P1', 'P3', 'Cube', 'Z1']::text[]),
  ('powakaddy-ct-series', 'powakaddy', 'Bags & trolleys', 'CT series', 2022, array['CT6', 'CT8 GPS', 'CT10 GPS']::text[]),
  ('powakaddy-fx-series', 'powakaddy', 'Bags & trolleys', 'FX series', 2016, array['FX3', 'FX5', 'FX7 GPS']::text[]),
  ('powakaddy-freeway-compact', 'powakaddy', 'Bags & trolleys', 'Freeway / Compact', 2012, array['Freeway', 'Compact C2', 'Compact C2i', 'Touch']::text[]),
  ('big-max-blade', 'big-max', 'Bags & trolleys', 'Blade', 2016, array['Blade IP', 'Blade Quattro', 'Blade Trio']::text[]),
  ('big-max-autofold', 'big-max', 'Bags & trolleys', 'Autofold', 2018, array['Autofold FF', 'Autofold X']::text[]),
  ('clicgear-clicgear', 'clicgear', 'Bags & trolleys', 'Clicgear', 2010, array['Clicgear 4.0', 'Clicgear 3.5+', 'Clicgear 8.0']::text[]),
  ('bushnell-pro-x3', 'bushnell', 'Balls & accessories', 'Pro X3', 2022, array['Pro X3', 'Pro X3+']::text[]),
  ('bushnell-tour-v6', 'bushnell', 'Balls & accessories', 'Tour V6', 2023, array['Tour V6', 'Tour V6 Shift']::text[]),
  ('bushnell-tour-v5', 'bushnell', 'Balls & accessories', 'Tour V5', 2020, array['Tour V5', 'Tour V5 Shift']::text[]),
  ('bushnell-pro-xe', 'bushnell', 'Balls & accessories', 'Pro XE', 2019, array['Pro XE', 'Pro X2']::text[]),
  ('bushnell-tour-v4', 'bushnell', 'Balls & accessories', 'Tour V4', 2016, array['Tour V4', 'Tour V4 Shift']::text[]),
  ('garmin-approach-z', 'garmin', 'Balls & accessories', 'Approach Z', 2017, array['Approach Z82', 'Approach Z30', 'Approach Z80']::text[]),
  ('garmin-approach-s-watches', 'garmin', 'Balls & accessories', 'Approach S watches', 2019, array['Approach S70', 'Approach S62', 'Approach S44', 'Approach S42', 'Approach S12']::text[]),
  ('garmin-approach-g', 'garmin', 'Balls & accessories', 'Approach G', 2018, array['Approach G80', 'Approach G30', 'Approach G12']::text[]),
  ('shot-scope-shot-scope', 'shot-scope', 'Balls & accessories', 'Shot Scope', 2019, array['Pro L2', 'Pro LX+', 'V3', 'X5', 'G5']::text[])
on conflict (id) do nothing;

-- ============ existing listings: find their model ============
-- Where a listing's model text or title names a catalogue family of its own
-- brand and category, link it. The longest family name wins, so "Stealth 2"
-- beats "Stealth".
update public.listings l
   set model_id = (
     select m.id
       from public.marketplace_models m
      where m.brand_id = l.brand
        and m.category = l.category
        and (
          lower(coalesce(l.model, '')) like '%' || lower(m.family) || '%'
          or lower(l.title) like '%' || lower(m.family) || '%'
        )
      order by char_length(m.family) desc, m.year desc nulls last
      limit 1
   )
 where l.model_id is null
   and l.brand is not null;
