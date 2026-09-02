-- Pinpals: search indexes for /admin/listings free-text search.
--
-- Same rationale as 0012_profiles_search_indexes.sql: listListings() used to
-- fetch every row and filter in memory (fine at today's row counts, per the
-- file-header comment in src/lib/admin/queries.ts), but this phase replaces
-- that with genuine server-side `.range()` pagination and an indexed `ilike`
-- search across title/description (see buildListingSearchOrFilter()). A
-- plain btree index (like listings_category_idx/listings_county_idx) only
-- helps equality/prefix lookups — substring ILIKE ("%term%") needs a
-- trigram index to avoid a sequential scan once the table grows past a
-- handful of rows. pg_trgm is already enabled (0012), so this only adds the
-- two new indexes.
--
-- category and county stay plain equality filters (already indexed by
-- listings_category_idx/listings_county_idx from 0003_marketplace.sql) — the
-- admin UI turns those into exact-match dropdowns rather than free text, so
-- no trigram index is needed for either.
create index if not exists listings_title_trgm_idx
  on public.listings using gin (lower(title) gin_trgm_ops);

create index if not exists listings_description_trgm_idx
  on public.listings using gin (lower(description) gin_trgm_ops);
