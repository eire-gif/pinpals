-- Pinpals: admin staff identity & authorization foundation
--
-- Introduces the staff/role model used to gate the /admin surface. Deliberately
-- minimal: this migration only creates the table, the authorization function,
-- and read policies. There is no insert/update/delete policy yet — granting or
-- changing a staff role is a manual SQL statement (run by a super_admin/service
-- role) until the staff-management UI ships in a later phase.

-- ============ STAFF_ROLES ============
create table if not exists public.staff_roles (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('support', 'moderator', 'finance', 'admin', 'super_admin')),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id),
  unique (user_id)
);

alter table public.staff_roles enable row level security;

drop trigger if exists staff_roles_set_updated_at on public.staff_roles;
create trigger staff_roles_set_updated_at
  before update on public.staff_roles
  for each row
  execute function public.set_updated_at();

create index if not exists staff_roles_role_idx on public.staff_roles (role);
create index if not exists staff_roles_status_idx on public.staff_roles (status);

-- ============ is_staff() ============
-- SECURITY DEFINER + a fixed search_path so it can be safely called from RLS
-- policies on staff_roles itself without recursing back through those same
-- policies. Returns whether the CURRENT user (auth.uid()) is an active staff
-- member, optionally restricted to a specific set of roles.
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
  );
$$;

-- Only signed-in users need to call this (it always resolves to false for
-- anon since auth.uid() is null for them) — keep it off the anon/public grant
-- the same way the earlier security review flagged for handle_new_user().
revoke all on function public.is_staff(text[]) from public;
grant execute on function public.is_staff(text[]) to authenticated;

-- ============ RLS: staff_roles ============
-- A staff member can see their own row (this is what the admin layout/guard
-- reads to resolve the signed-in user's role and status).
create policy "Staff can view their own staff row"
  on public.staff_roles for select
  to authenticated
  using (user_id = auth.uid());

-- Super admins can see every staff row (needed once staff management ships;
-- harmless to have in place now — is_staff() is SECURITY DEFINER so this
-- does not recurse).
create policy "Super admins can view all staff rows"
  on public.staff_roles for select
  to authenticated
  using (public.is_staff(array['super_admin']));

-- No insert/update/delete policy yet. Granting the first admin(s) is a manual
-- statement run with elevated access, e.g.:
--   insert into public.staff_roles (user_id, role, status)
--   values ('<auth.users.id>', 'super_admin', 'active');
