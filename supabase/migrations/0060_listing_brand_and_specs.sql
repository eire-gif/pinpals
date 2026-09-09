-- Listing brand + item specification (Phase: marketplace-brand-filters).
--
-- Adds the "what exactly is this item" half of a listing: which brand it is,
-- and the handful of spec fields a golfer actually searches on (model, hand,
-- shaft flex/material, loft, size). Before this migration a buyer could
-- narrow to "Irons" and nothing further; the brand column plus the
-- p_brands argument on search_marketplace_listings() below is what turns
-- "irons" into "Mizuno or Srixon irons, left-handed, stiff shaft".
--
-- Two design notes worth reading before changing anything here:
--
-- 1. `listings.brand` stores a slug id ('taylormade'), not a display label
--    the way category/subcategory/condition do. Brand labels contain
--    characters that make poor keys and poor URL query values ('G/FORE',
--    'L.A.B. Golf', 'YES!'), and a brand's spelling is the kind of thing
--    that gets corrected later without wanting to rewrite listing rows.
--    public.marketplace_brands is the id -> label lookup, and the foreign
--    key from listings is what actually keeps the column honest.
--
-- 2. The brand list itself is seeded from src/data/golf-brands.json — the
--    same "the app's JSON is the source of truth, the migration seeds a
--    table from it" arrangement as CLUBS/0002_seed_clubs.sql. Adding a
--    brand means editing that file AND adding an insert here. The
--    per-category ordering and the per-subcategory narrowing (which brands
--    show under 'Rangefinders / GPS' vs 'Golf balls') deliberately live
--    ONLY in the JSON — they're presentation, they change often, and
--    nothing in the database needs to know about them.
--
-- Every new column is nullable and every existing row keeps working: a
-- listing created before this phase simply has no brand, and the buyer-side
-- brand filter treats it as "not matching a brand filter" rather than
-- hiding it from an unfiltered search.
--
-- Rollback:
--   drop function if exists public.marketplace_brand_facets(
--     text, text, text, text, text, text, text, integer, integer);
--   drop function if exists public.search_marketplace_listings(
--     text, text, text, text, text, text, text, integer, integer, text,
--     timestamptz, integer, bigint, integer, text[]);
--   alter table public.listings
--     drop column if exists brand, drop column if exists brand_other,
--     drop column if exists model, drop column if exists dexterity,
--     drop column if exists shaft_flex, drop column if exists shaft_material,
--     drop column if exists loft, drop column if exists item_size;
--   drop table if exists public.marketplace_brands;
--   (and re-create the 14-argument search_marketplace_listings from 0047)

-- ============ brand reference table ============
-- A plain reference table: publicly readable, never written by an ordinary
-- user. RLS is enabled with a read-only policy and NO write policy at all,
-- so inserts/updates are reachable only by the service role (i.e. a future
-- admin screen going through the admin client, or another migration) —
-- the most conservative shape available, and one that needs no is_staff()
-- style predicate to get right.

create table if not exists public.marketplace_brands (
  id text primary key,
  label text not null,
  -- The Other / Unknown / Mixed choices, which every category offers on top
  -- of its own curated list. Flagged rather than kept in a separate table so
  -- listings.brand can be a single foreign key: a listing whose brand isn't
  -- in the curated taxonomy is never rejected, it just carries 'other' plus
  -- the seller's own brand_other text.
  is_fallback boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.marketplace_brands enable row level security;

drop policy if exists "Brands are readable by everyone" on public.marketplace_brands;
create policy "Brands are readable by everyone"
  on public.marketplace_brands for select
  using (true);

grant select on public.marketplace_brands to anon, authenticated;

-- Seeded from src/data/golf-brands.json. `on conflict do nothing` so this
-- migration is safely re-runnable and so a label corrected in a later
-- migration isn't clobbered by a replay of this one.
insert into public.marketplace_brands (id, label, is_fallback) values
  ('abacus', 'Abacus', false),
  ('acer', 'Acer', false),
  ('adams', 'Adams', false),
  ('adidas', 'adidas', false),
  ('arccos', 'Arccos', false),
  ('axglo', 'Axglo', false),
  ('bag-boy', 'Bag Boy', false),
  ('ben-hogan', 'Ben Hogan', false),
  ('ben-sayers', 'Ben Sayers', false),
  ('benross', 'Benross', false),
  ('bettinardi', 'Bettinardi', false),
  ('big-max', 'BIG MAX', false),
  ('blue-tees', 'Blue Tees', false),
  ('bridgestone', 'Bridgestone', false),
  ('bushnell', 'Bushnell', false),
  ('callaway', 'Callaway', false),
  ('calvin-klein', 'Calvin Klein', false),
  ('cleveland', 'Cleveland', false),
  ('clicgear', 'Clicgear', false),
  ('cobra', 'Cobra', false),
  ('daily-sports', 'Daily Sports', false),
  ('datrek', 'Datrek', false),
  ('druids', 'Druids', false),
  ('duca-del-cosma', 'Duca del Cosma', false),
  ('dunlop', 'Dunlop', false),
  ('ecco', 'ECCO', false),
  ('edel', 'Edel', false),
  ('edison', 'Edison', false),
  ('evnroll', 'Evnroll', false),
  ('fastfold', 'Fastfold', false),
  ('fazer', 'Fazer', false),
  ('footjoy', 'FootJoy', false),
  ('fourteen', 'Fourteen', false),
  ('g-fore', 'G/FORE', false),
  ('galvin-green', 'Galvin Green', false),
  ('garmin', 'Garmin', false),
  ('glenmuir', 'Glenmuir', false),
  ('golf-pride', 'Golf Pride', false),
  ('golfbuddy', 'GolfBuddy', false),
  ('golphin', 'Golphin', false),
  ('honma', 'Honma', false),
  ('inesis', 'Inesis', false),
  ('j-lindeberg', 'J.Lindeberg', false),
  ('jones', 'Jones', false),
  ('jucad', 'JuCad', false),
  ('kirkland-signature', 'Kirkland Signature', false),
  ('krank', 'Krank', false),
  ('l-a-b-golf', 'L.A.B. Golf', false),
  ('lamkin', 'Lamkin', false),
  ('longridge', 'Longridge', false),
  ('lynx', 'Lynx', false),
  ('macgregor', 'MacGregor', false),
  ('maltby', 'Maltby', false),
  ('masters', 'Masters', false),
  ('maxfli', 'Maxfli', false),
  ('mgi', 'MGI', false),
  ('miura', 'Miura', false),
  ('mizuno', 'Mizuno', false),
  ('mkids', 'MKids', false),
  ('motocaddy', 'Motocaddy', false),
  ('never-compromise', 'Never Compromise', false),
  ('new-balance', 'New Balance', false),
  ('new-level', 'New Level', false),
  ('nike', 'Nike', false),
  ('nikon', 'Nikon', false),
  ('oakley', 'Oakley', false),
  ('odyssey', 'Odyssey', false),
  ('ogio', 'OGIO', false),
  ('onoff', 'ONOFF', false),
  ('original-penguin', 'Original Penguin', false),
  ('orlimar', 'Orlimar', false),
  ('oscar-jacobson', 'Oscar Jacobson', false),
  ('payntr-golf', 'PAYNTR Golf', false),
  ('peter-millar', 'Peter Millar', false),
  ('ping', 'PING', false),
  ('pinnacle', 'Pinnacle', false),
  ('piretti', 'Piretti', false),
  ('powakaddy', 'PowaKaddy', false),
  ('powerbilt', 'PowerBilt', false),
  ('prgr', 'PRGR', false),
  ('pridesports', 'PrideSports', false),
  ('proquip', 'ProQuip', false),
  ('prosimmon', 'Prosimmon', false),
  ('puma', 'Puma', false),
  ('pxg', 'PXG', false),
  ('ralph-lauren', 'Ralph Lauren', false),
  ('ram', 'Ram', false),
  ('ray-cook', 'Ray Cook', false),
  ('rife', 'Rife', false),
  ('rohnisch', 'Rohnisch', false),
  ('scotty-cameron', 'Scotty Cameron', false),
  ('seed-golf', 'Seed Golf', false),
  ('seemore', 'SeeMore', false),
  ('shot-scope', 'Shot Scope', false),
  ('sik', 'SIK', false),
  ('skechers', 'Skechers', false),
  ('skycaddie', 'SkyCaddie', false),
  ('slazenger', 'Slazenger', false),
  ('snell-golf', 'Snell Golf', false),
  ('srixon', 'Srixon', false),
  ('stewart-golf', 'Stewart Golf', false),
  ('stitch', 'Stitch', false),
  ('stix', 'Stix', false),
  ('strata', 'Strata', false),
  ('sub-70', 'Sub 70', false),
  ('sun-mountain', 'Sun Mountain', false),
  ('sunderland-of-scotland', 'Sunderland of Scotland', false),
  ('superstroke', 'SuperStroke', false),
  ('swag-golf', 'Swag Golf', false),
  ('takomo', 'Takomo', false),
  ('taylormade', 'TaylorMade', false),
  ('titleist', 'Titleist', false),
  ('top-flite', 'Top-Flite', false),
  ('toulon-golf', 'Toulon Golf', false),
  ('tour-edge', 'Tour Edge', false),
  ('travismathew', 'TravisMathew', false),
  ('true-linkswear', 'TRUE linkswear', false),
  ('u-s-kids-golf', 'U.S. Kids Golf', false),
  ('under-armour', 'Under Armour', false),
  ('vega', 'Vega', false),
  ('vessel', 'Vessel', false),
  ('vice-golf', 'Vice Golf', false),
  ('voice-caddie', 'Voice Caddie', false),
  ('volvik', 'Volvik', false),
  ('wilson', 'Wilson', false),
  ('winn', 'Winn', false),
  ('xxio', 'XXIO', false),
  ('yes', 'YES!', false),
  ('yonex', 'Yonex', false),
  ('zebra', 'Zebra', false),
  ('other', 'Other', true),
  ('unknown', 'Unknown / unbranded', true),
  ('mixed', 'Mixed brands', true)
on conflict (id) do nothing;

-- ============ listing columns ============

alter table public.listings
  add column if not exists brand text,
  add column if not exists brand_other text,
  add column if not exists model text,
  add column if not exists dexterity text,
  add column if not exists shaft_flex text,
  add column if not exists shaft_material text,
  add column if not exists loft text,
  add column if not exists item_size text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'listings_brand_fkey'
  ) then
    alter table public.listings
      add constraint listings_brand_fkey
      foreign key (brand) references public.marketplace_brands (id)
      on update cascade on delete restrict;
  end if;
end
$$;

-- brand_other is the seller's own words, and only means anything behind the
-- 'other' brand. Enforced here rather than left to the app so a stray
-- brand_other can't sit on a listing that also claims to be, say, Titleist —
-- which would make "what brand is this?" have two contradictory answers.
alter table public.listings
  drop constraint if exists listings_brand_other_requires_other_check;
alter table public.listings
  add constraint listings_brand_other_requires_other_check
  check (brand_other is null or brand = 'other');

alter table public.listings
  drop constraint if exists listings_other_brand_requires_text_check;
alter table public.listings
  add constraint listings_other_brand_requires_text_check
  check (brand <> 'other' or nullif(btrim(coalesce(brand_other, '')), '') is not null);

alter table public.listings
  drop constraint if exists listings_brand_other_length_check;
alter table public.listings
  add constraint listings_brand_other_length_check
  check (brand_other is null or char_length(brand_other) <= 60);

alter table public.listings
  drop constraint if exists listings_model_length_check;
alter table public.listings
  add constraint listings_model_length_check
  check (model is null or char_length(model) <= 80);

alter table public.listings
  drop constraint if exists listings_spec_length_check;
alter table public.listings
  add constraint listings_spec_length_check
  check (
    (loft is null or char_length(loft) <= 24)
    and (item_size is null or char_length(item_size) <= 24)
  );

-- Closed vocabularies, mirrored from src/lib/marketplace-brands.ts
-- (DEXTERITIES / SHAFT_FLEXES / SHAFT_MATERIALS) — same hand-mirroring
-- discipline as listings_sale_type_check and friends.
alter table public.listings
  drop constraint if exists listings_dexterity_check;
alter table public.listings
  add constraint listings_dexterity_check
  check (dexterity is null or dexterity in ('Right-handed', 'Left-handed'));

alter table public.listings
  drop constraint if exists listings_shaft_flex_check;
alter table public.listings
  add constraint listings_shaft_flex_check
  check (shaft_flex is null or shaft_flex in ('Ladies', 'Senior', 'Regular', 'Stiff', 'Extra stiff'));

alter table public.listings
  drop constraint if exists listings_shaft_material_check;
alter table public.listings
  add constraint listings_shaft_material_check
  check (shaft_material is null or shaft_material in ('Steel', 'Graphite', 'Multi-material'));

-- `category` has been free text since 0003 with nothing but app-layer
-- validation behind it — worth closing while we're here, since the brand
-- taxonomy is keyed by exactly these nine strings and a listing carrying a
-- tenth would silently have no brands to offer. Mirrors CATEGORIES in
-- src/lib/marketplace.ts.
alter table public.listings
  drop constraint if exists listings_category_check;
alter table public.listings
  add constraint listings_category_check
  check (category in (
    'Drivers', 'Woods & hybrids', 'Irons', 'Wedges', 'Putters',
    'Full sets', 'Bags & trolleys', 'Shoes & apparel', 'Balls & accessories'
  ));

-- ============ indexes ============
-- Partial on active, same rationale as the discovery indexes in 0047:
-- brand is only ever filtered/faceted over browsable listings.
create index if not exists listings_active_brand_idx
  on public.listings (brand)
  where status = 'active';

create index if not exists listings_active_dexterity_idx
  on public.listings (dexterity)
  where status = 'active';

-- Free-text search now also covers model and the seller's own brand text
-- (searching "vokey" or "stealth 2" should find the club). Trigram indexes
-- on the same lower(...) expressions the predicates use, matching 0014's
-- treatment of title/description.
create index if not exists listings_model_trgm_idx
  on public.listings using gin (lower(model) gin_trgm_ops);

create index if not exists listings_brand_other_trgm_idx
  on public.listings using gin (lower(brand_other) gin_trgm_ops);

-- ============ search_marketplace_listings() ============
-- Replaces 0047's 14-argument version. Dropped explicitly rather than left
-- alongside the new one: two overloads differing only by a trailing
-- defaulted argument make the PostgREST call ambiguous, which fails at
-- runtime rather than at deploy time.
--
-- p_brands is an array because brand is the one filter buyers genuinely
-- want to multi-select ("Mizuno or Srixon irons"). Semantics: OR within the
-- array, AND against every other filter — so a brand selection broadens the
-- brands considered but never escapes the chosen category. A null or empty
-- array means no brand filter at all, and a listing with a null brand is
-- simply not a member of any brand set (it still shows in unfiltered
-- browsing, which is what keeps every pre-brand listing visible).
drop function if exists public.search_marketplace_listings(
  text, text, text, text, text, text, text, integer, integer, text,
  timestamptz, integer, bigint, integer
);

create or replace function public.search_marketplace_listings(
  p_query text default null,
  p_category text default null,
  p_subcategory text default null,
  p_county text default null,
  p_condition text default null,
  p_sale_type text default null,
  p_delivery text default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null,
  p_sort text default 'newest',
  p_cursor_created_at timestamptz default null,
  p_cursor_price_cents integer default null,
  p_cursor_id bigint default null,
  p_limit integer default 24,
  p_brands text[] default null
)
returns setof public.listings
language plpgsql
stable
set search_path = public
as $$
declare
  v_pattern text;
  v_brands text[] := nullif(p_brands, '{}');
  v_limit integer := least(greatest(coalesce(p_limit, 24), 1), 60);
begin
  v_pattern := case
    when nullif(trim(coalesce(p_query, '')), '') is null then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  if p_sort = 'price_low' then
    return query
      select l.* from public.listings l
      where l.status = 'active'
        and (
          v_pattern is null
          or lower(l.title) ilike v_pattern
          or lower(l.description) ilike v_pattern
          or lower(l.model) ilike v_pattern
          or lower(l.brand_other) ilike v_pattern
        )
        and (p_category is null or l.category = p_category)
        and (p_subcategory is null or l.subcategory = p_subcategory)
        and (v_brands is null or l.brand = any (v_brands))
        and (p_county is null or l.county = p_county)
        and (p_condition is null or l.condition = p_condition)
        and (p_sale_type is null or l.sale_type = p_sale_type)
        and (p_delivery is null or l.delivery_options @> array[p_delivery])
        and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
        and (
          p_cursor_id is null
          or (l.price_cents is null) > (p_cursor_price_cents is null)
          or ((l.price_cents is null) = (p_cursor_price_cents is null) and l.price_cents > p_cursor_price_cents)
          or (
            (l.price_cents is null) = (p_cursor_price_cents is null)
            and l.price_cents is not distinct from p_cursor_price_cents
            and l.id > p_cursor_id
          )
        )
      order by (l.price_cents is null) asc, l.price_cents asc, l.id asc
      limit v_limit;

  elsif p_sort = 'price_high' then
    return query
      select l.* from public.listings l
      where l.status = 'active'
        and (
          v_pattern is null
          or lower(l.title) ilike v_pattern
          or lower(l.description) ilike v_pattern
          or lower(l.model) ilike v_pattern
          or lower(l.brand_other) ilike v_pattern
        )
        and (p_category is null or l.category = p_category)
        and (p_subcategory is null or l.subcategory = p_subcategory)
        and (v_brands is null or l.brand = any (v_brands))
        and (p_county is null or l.county = p_county)
        and (p_condition is null or l.condition = p_condition)
        and (p_sale_type is null or l.sale_type = p_sale_type)
        and (p_delivery is null or l.delivery_options @> array[p_delivery])
        and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
        and (
          p_cursor_id is null
          or (l.price_cents is null) > (p_cursor_price_cents is null)
          or ((l.price_cents is null) = (p_cursor_price_cents is null) and l.price_cents < p_cursor_price_cents)
          or (
            (l.price_cents is null) = (p_cursor_price_cents is null)
            and l.price_cents is not distinct from p_cursor_price_cents
            and l.id < p_cursor_id
          )
        )
      order by (l.price_cents is null) asc, l.price_cents desc, l.id desc
      limit v_limit;

  else -- 'newest', also the fallback for any unrecognised sort value
    return query
      select l.* from public.listings l
      where l.status = 'active'
        and (
          v_pattern is null
          or lower(l.title) ilike v_pattern
          or lower(l.description) ilike v_pattern
          or lower(l.model) ilike v_pattern
          or lower(l.brand_other) ilike v_pattern
        )
        and (p_category is null or l.category = p_category)
        and (p_subcategory is null or l.subcategory = p_subcategory)
        and (v_brands is null or l.brand = any (v_brands))
        and (p_county is null or l.county = p_county)
        and (p_condition is null or l.condition = p_condition)
        and (p_sale_type is null or l.sale_type = p_sale_type)
        and (p_delivery is null or l.delivery_options @> array[p_delivery])
        and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
        and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
        and (
          p_cursor_id is null
          or l.created_at < p_cursor_created_at
          or (l.created_at = p_cursor_created_at and l.id < p_cursor_id)
        )
      order by l.created_at desc, l.id desc
      limit v_limit;
  end if;
end;
$$;

revoke all on function public.search_marketplace_listings(
  text, text, text, text, text, text, text, integer, integer, text,
  timestamptz, integer, bigint, integer, text[]
) from public;
grant execute on function public.search_marketplace_listings(
  text, text, text, text, text, text, text, integer, integer, text,
  timestamptz, integer, bigint, integer, text[]
) to anon, authenticated;

-- ============ marketplace_brand_facets() ============
-- "Titleist (12)" next to each checkbox — the counts a buyer needs to avoid
-- clicking into an empty result set.
--
-- Deliberately takes every filter EXCEPT brand: a facet list that also
-- applied the current brand selection would collapse to just the selected
-- brands showing their own counts, which is exactly when the counts stop
-- being useful. Same reason it counts only status='active' rows — a sold
-- listing must never contribute to "how many can I buy right now".
--
-- Not security definer, same reasoning as search_marketplace_listings():
-- it only reads what the existing public select policy already exposes.
create or replace function public.marketplace_brand_facets(
  p_query text default null,
  p_category text default null,
  p_subcategory text default null,
  p_county text default null,
  p_condition text default null,
  p_sale_type text default null,
  p_delivery text default null,
  p_min_price_cents integer default null,
  p_max_price_cents integer default null
)
returns table (brand text, listing_count bigint)
language plpgsql
stable
set search_path = public
as $$
declare
  v_pattern text;
begin
  v_pattern := case
    when nullif(trim(coalesce(p_query, '')), '') is null then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  return query
    select l.brand, count(*)::bigint
    from public.listings l
    where l.status = 'active'
      and l.brand is not null
      and (
        v_pattern is null
        or lower(l.title) ilike v_pattern
        or lower(l.description) ilike v_pattern
        or lower(l.model) ilike v_pattern
        or lower(l.brand_other) ilike v_pattern
      )
      and (p_category is null or l.category = p_category)
      and (p_subcategory is null or l.subcategory = p_subcategory)
      and (p_county is null or l.county = p_county)
      and (p_condition is null or l.condition = p_condition)
      and (p_sale_type is null or l.sale_type = p_sale_type)
      and (p_delivery is null or l.delivery_options @> array[p_delivery])
      and (p_min_price_cents is null or l.price_cents >= p_min_price_cents)
      and (p_max_price_cents is null or l.price_cents <= p_max_price_cents)
    group by l.brand;
end;
$$;

revoke all on function public.marketplace_brand_facets(
  text, text, text, text, text, text, text, integer, integer
) from public;
grant execute on function public.marketplace_brand_facets(
  text, text, text, text, text, text, text, integer, integer
) to anon, authenticated;
