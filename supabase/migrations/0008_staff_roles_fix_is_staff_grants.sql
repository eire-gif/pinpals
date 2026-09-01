-- Fix for 0007_staff_roles.sql: Supabase's default privileges grant EXECUTE
-- on new public-schema functions directly to the `anon` role (not via the
-- PUBLIC pseudo-role), so "revoke all ... from public" in 0007 did not
-- actually strip anon's access to is_staff() — confirmed live via
-- has_function_privilege('anon', 'public.is_staff(text[])', 'EXECUTE').
-- Revoke it explicitly, per-role, so only `authenticated` can call it.
revoke execute on function public.is_staff(text[]) from anon;
revoke execute on function public.is_staff(text[]) from public;
grant execute on function public.is_staff(text[]) to authenticated;
