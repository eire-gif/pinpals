-- Pinpals: indexed search support for /admin/users
--
-- src/lib/admin/queries.ts's listUsers() used to fetch every row of
-- `profiles` into memory and filter/paginate in JS. This migration is the
-- other half of fixing that: real, indexed, server-side search across the
-- fields the admin search box matches against (name, home club, county).
-- Email is deliberately not part of this — it lives in Supabase Auth, not
-- Postgres, so it can never be a SQL-indexed field; listUsers() handles it
-- separately via the (already bounded, ≤1000-row) Auth Admin API roster.
--
-- pg_trgm (trigram) GIN indexes are used rather than plain btree because the
-- search box does substring ("contains") matching, not prefix matching — a
-- plain btree index can't accelerate `ilike '%term%'`, only `ilike 'term%'`.
-- Functional on lower(...) so the index is actually used regardless of the
-- query's casing (ilike itself is case-insensitive, but a functional index
-- has to match the expression the query planner sees).

create extension if not exists pg_trgm with schema extensions;

create index if not exists profiles_first_name_trgm_idx
  on public.profiles using gin (lower(first_name) extensions.gin_trgm_ops);

create index if not exists profiles_last_name_trgm_idx
  on public.profiles using gin (lower(last_name) extensions.gin_trgm_ops);

-- home_club and county already have plain btree indexes (0001_init.sql) for
-- exact-match lookups; these are additive, for the same substring-search
-- case as the two above.
create index if not exists profiles_home_club_trgm_idx
  on public.profiles using gin (lower(home_club) extensions.gin_trgm_ops);

create index if not exists profiles_county_trgm_idx
  on public.profiles using gin (lower(county) extensions.gin_trgm_ops);

-- listUsers()'s default (and only, for now) sort order — matches the same
-- "index the sort column" reasoning admin_audit_log_created_at_idx already
-- uses for /admin/audit-log's pagination.
create index if not exists profiles_created_at_idx
  on public.profiles (created_at desc);
