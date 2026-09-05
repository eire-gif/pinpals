-- Defense-in-depth lockdown for staff_roles, ahead of /admin/staff shipping
-- its first real write path (grant/change-role/disable/reinstate — see
-- src/app/admin/staff/actions.ts). 0007_staff_roles.sql never added an
-- insert/update/delete policy for this table (by design, at the time — see
-- its own comment), which already means "no policy = no access" for
-- `authenticated`. But 0008's own lesson (Supabase's default grants can be
-- broader than "no policy = no access" alone — confirmed live via
-- has_function_privilege for is_staff()) applies just as much to table
-- privileges as to function EXECUTE, and every later migration since
-- (0010, 0013, 0026, ...) has explicitly revoked write privileges up front
-- rather than trusting that inference. staff_roles never got that same
-- explicit revoke — this migration adds it.
--
-- Every actual write to this table now goes exclusively through
-- src/lib/admin/staff-management.ts's Server Actions using the service-role
-- client (createAdminClient()), which bypasses RLS/grants entirely and is
-- itself gated by requireStaff({ roles: ["super_admin"] }) on every call.
-- No new insert/update/delete RLS policy is added here — there still isn't
-- meant to be one; ordinary `authenticated` sessions should never be able to
-- write this table under any policy, only the service role.
revoke insert, update, delete, truncate, references, trigger
  on public.staff_roles from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.staff_roles from authenticated;
