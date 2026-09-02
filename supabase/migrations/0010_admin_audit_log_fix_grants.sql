-- Fix for 0009_admin_audit_log.sql: the initial migration only revoked
-- insert/update/delete from anon/authenticated. A check against
-- information_schema.role_table_grants afterward showed both roles still
-- held TRUNCATE, REFERENCES, and TRIGGER on the table via Supabase's default
-- grants — the same class of gap 0008_staff_roles_fix_is_staff_grants.sql
-- fixed for is_staff(). None of these are reachable through PostgREST (which
-- only maps to select/insert/update/delete), but per least-privilege they
-- should not be granted to roles that have no legitimate reason to hold them
-- on an append-only audit table.
revoke truncate, references, trigger on public.admin_audit_log from anon;
revoke truncate, references, trigger on public.admin_audit_log from authenticated;
