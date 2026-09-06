-- Local/CI-only Postgres bootstrap for replaying supabase/migrations against a
-- plain Postgres instance, used only because this project's Supabase plan has
-- no hosted branching to test RLS changes against safely. Never applied to
-- the real Supabase project — this recreates just enough of Supabase's own
-- platform-provided schema (roles, auth.users, auth.uid(), storage) for the
-- migrations in this repo to run and for RLS to be meaningfully testable.
--
-- Run this BEFORE 0001_init.sql (roles/auth/storage have to exist first —
-- 0001 FKs into auth.users, 0003 writes to storage.buckets). Idempotent: safe
-- to re-run against the same database.
--
-- See replay-migrations.sh for how this fits into a full replay, and
-- setup-local-db-part2.sql for the second (post-0003) half.

-- ============ Roles ============
-- Mirrors Supabase's own role model: `anon`/`authenticated` are the two
-- PostgREST-facing roles every RLS policy in this schema is written against;
-- `service_role` bypasses RLS entirely (BYPASSRLS), matching what the
-- service-role key does against a real Supabase project.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

-- ============ auth schema ============
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- The real Supabase auth.uid() reads a GUC PostgREST sets per-request from the
-- caller's JWT `sub` claim. Replicated the same way here so a test can
-- simulate any identity with:
--   select set_config('request.jwt.claim.sub', '<uuid>', true); -- current transaction only
--   set local role authenticated;
-- and have every RLS policy and SECURITY DEFINER helper in the schema see
-- exactly the auth.uid() a real request from that user would produce.
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

-- ============ storage schema (bucket/object policies from 0003_marketplace.sql) ============
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz not null default now()
);

create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text,
  owner uuid,
  created_at timestamptz not null default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema storage to anon, authenticated, service_role;
-- On the real project, `auth.users` is managed by Supabase's own GoTrue
-- service (via its own admin API, not a direct SQL grant), so service_role's
-- access to it there is a platform detail this stub can't fully replicate.
-- Granting it here only so a test can seed a one-off user
-- (supabase/tests/rls/admin-only-tables.test.ts's super_admin scenario) the
-- same way `postgres` seeds the main fixtures — never exposed to
-- anon/authenticated, which never touch this table on the real project
-- either.
grant all on auth.users to service_role;
grant all on storage.buckets to anon, authenticated, service_role;
grant all on storage.objects to anon, authenticated, service_role;

-- ============ Default privileges for tables/functions created after this point ============
-- On the real Supabase project, `anon`/`authenticated` get broad default
-- table privileges (SELECT/INSERT/UPDATE/DELETE) and EXECUTE on functions the
-- moment a migration creates them — this is *why* so many migrations in this
-- repo end with an explicit `revoke ... from anon`/`revoke ... from
-- authenticated` for a privileged table or SECURITY DEFINER function (e.g.
-- 0008/0010/0013/0016/0019): the revoke only makes sense against a broader
-- default grant that already exists. `ALTER DEFAULT PRIVILEGES` here
-- reproduces that default for every table/function the replay creates from
-- this point on (every migration runs as this same `postgres` role), so RLS
-- policies — not a missing base GRANT — are what's actually gating access in
-- these tests, same as on the real project.
alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated;
alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated;
alter default privileges in schema public
  grant execute on functions to anon, authenticated;

-- `service_role` has BYPASSRLS (see the role creation above), but that only
-- skips row-level *policy* evaluation — it still needs the ordinary
-- table-level GRANTs Postgres checks first, same as any other role. The real
-- Supabase project grants service_role everything on every table by default
-- for exactly this reason.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant execute on functions to service_role;
