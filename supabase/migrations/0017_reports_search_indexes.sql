-- Pinpals: indexed search support for /admin/reports
--
-- Same reasoning as 0012_profiles_search_indexes.sql / 0014_listings_search_indexes.sql:
-- listReports()'s free-text search box does substring ("contains") matching
-- against `description`, so a trigram GIN index (not a plain btree, which
-- can only accelerate prefix matches) is what actually gets used by
-- `ilike '%term%'`. pg_trgm is already enabled (0012) — no need to
-- `create extension` again.
--
-- Reporter-name search reuses the trigram indexes 0012 already put on
-- profiles.first_name/last_name — no new index needed for that half of the
-- search box (see buildReportSearchOrFilter() in src/lib/admin/queries.ts).

create index if not exists reports_description_trgm_idx
  on public.reports using gin (lower(description) extensions.gin_trgm_ops);
