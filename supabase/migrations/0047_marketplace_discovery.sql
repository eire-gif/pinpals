-- Marketplace discovery (Phase: marketplace-discovery). Replaces the
-- fixture-era /marketplace page's plain `.eq/.order/.limit(60)` query with
-- real, filterable, cursor-paginated search over `listings`.
--
-- Why an RPC rather than composing this with the PostgREST filter API the
-- rest of this app uses (see buildListingSearchOrFilter() in
-- src/lib/admin/queries.ts): the spec calls for genuine cursor (keyset)
-- pagination with a stable sort key, across three sort modes, one of which
-- (price) has to put NULL-priced rows (auction listings — see 0046's header
-- comment on why price_eur/price_cents are null for those) last regardless
-- of sort direction. Expressing that as a single correct `.or()` string
-- through the filter mini-language is exactly the kind of thing this
-- codebase already prefers to push into a real SQL function instead (see
-- validate_bid(), listing_is_visible(), prevent_listing_edit_during_live_auction()
-- and friends) rather than fight the REST filter grammar for it — one
-- indexed query, one place the ordering/keyset logic lives, easy to verify
-- against the RLS test harness.
--
-- Deliberately NOT `security definer` (unlike almost every other function in
-- this schema — see the functions listed above): this one only ever needs
-- to read what's already publicly readable (active listings, per the
-- existing "listings are readable by everyone" / listing_is_visible() select
-- policy), so there's nothing to bypass RLS for. Running as the caller
-- (the default) is strictly the more conservative choice here.
--
-- Rollback:
--   drop function if exists public.search_marketplace_listings(
--     text, text, text, text, text, text, text, integer, integer, text,
--     timestamptz, integer, bigint, integer
--   );
--   drop index if exists public.listings_active_created_at_id_idx;
--   drop index if exists public.listings_active_price_asc_id_idx;
--   drop index if exists public.listings_active_price_desc_id_idx;
--   drop index if exists public.listings_condition_idx;
--   drop index if exists public.listings_subcategory_idx;

-- ============ indexes ============
-- Partial (status = 'active' only) since discovery only ever browses active
-- listings — a My Listings-style query across every status has its own
-- (non-partial) listings_status_idx from 0003 already.

-- "Newest first" (the default sort, and what the first viewport shows
-- before any filter is touched) — covers `order by created_at desc, id desc`
-- and its keyset "created_at < ? or (created_at = ? and id < ?)" follow-up
-- directly.
create index if not exists listings_active_created_at_id_idx
  on public.listings (created_at desc, id desc)
  where status = 'active';

-- Price sorts. A plain ascending btree index already orders NULLs last by
-- default, which is exactly the "auctions sort after every fixed-priced
-- listing" behaviour this phase wants for "price: low to high" — no need
-- for an explicit NULLS LAST here. The descending companion needs one,
-- since a bare DESC index would otherwise put NULLs *first*.
create index if not exists listings_active_price_asc_id_idx
  on public.listings (price_cents, id)
  where status = 'active';

create index if not exists listings_active_price_desc_id_idx
  on public.listings (price_cents desc nulls last, id desc)
  where status = 'active';

-- category/county/sale_type/created_at already indexed (0003/0035);
-- condition and subcategory were not.
create index if not exists listings_condition_idx on public.listings (condition);
create index if not exists listings_subcategory_idx on public.listings (subcategory);

-- ============ search_marketplace_listings() ============
-- Free-text search reuses 0014's existing trigram indexes on
-- lower(title)/lower(description) — this function's ilike predicates are
-- written against the same lower(...) expressions so the planner can
-- actually use them, rather than adding a second, redundant pair of
-- trigram indexes on the raw columns.
--
-- Returns up to p_limit+1 rows (deliberately — the extra row is how the
-- caller tells "there's another page" apart from "that was the last one"
-- without a separate COUNT(*) query, which keyset pagination avoids on
-- principle). src/lib/marketplace-discovery.ts trims it back to p_limit
-- before rendering and derives the next cursor from the last kept row.
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
  p_limit integer default 24
)
returns setof public.listings
language plpgsql
stable
set search_path = public
as $$
declare
  v_pattern text;
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
        and (v_pattern is null or lower(l.title) ilike v_pattern or lower(l.description) ilike v_pattern)
        and (p_category is null or l.category = p_category)
        and (p_subcategory is null or l.subcategory = p_subcategory)
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
        and (v_pattern is null or lower(l.title) ilike v_pattern or lower(l.description) ilike v_pattern)
        and (p_category is null or l.category = p_category)
        and (p_subcategory is null or l.subcategory = p_subcategory)
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
        and (v_pattern is null or lower(l.title) ilike v_pattern or lower(l.description) ilike v_pattern)
        and (p_category is null or l.category = p_category)
        and (p_subcategory is null or l.subcategory = p_subcategory)
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
  timestamptz, integer, bigint, integer
) from public;
grant execute on function public.search_marketplace_listings(
  text, text, text, text, text, text, text, integer, integer, text,
  timestamptz, integer, bigint, integer
) to anon, authenticated;
