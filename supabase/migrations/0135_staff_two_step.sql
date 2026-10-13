-- Two-step sign-in for staff (Oct 2026). Design: claude/security-and-gdpr.md
--
-- The website already sends staff to /two-step before any /admin page
-- (requireStaff, src/lib/admin/authorization.ts). This makes the database
-- agree: is_staff() is true only for a session that passed the second step
-- (JWT aal = 'aal2'). A staff member's password alone — phished, reused,
-- leaked — no longer unlocks anything a member can't already see, including
-- by calling the API directly with that session.
--
-- APPLY AFTER every active staff member has set up two-step sign-in on the
-- website (/two-step). Until they have, they are treated as members.
--
-- Staff on the app (aal1 sessions) see the app as members do; the app's
-- Admin row reads staff_roles directly and opens the website, which asks
-- for the code.
--
-- Rollback: recreate is_staff() as in 0007 (drop the aal line).

create or replace function public.is_staff(required_roles text[] default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.staff_roles sr
    where sr.user_id = auth.uid()
      and sr.status = 'active'
      and (required_roles is null or sr.role = any(required_roles))
  )
  and coalesce((select auth.jwt()) ->> 'aal', 'aal1') = 'aal2';
$$;

revoke all on function public.is_staff(text[]) from public, anon;
grant execute on function public.is_staff(text[]) to authenticated;
