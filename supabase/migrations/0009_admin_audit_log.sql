-- Pinpals: admin audit log
--
-- Infrastructure for Phase 3 (moderation actions). No mutations write to this
-- table yet — this migration only creates the table, its indexes, and its
-- RLS policy, so the audit framework exists and is provably tamper-resistant
-- before any admin mutation is built on top of it.
--
-- Deliberately no insert/update/delete policy for `authenticated` or `anon`,
-- on top of RLS being enabled: the only way a row can ever be written is
-- through the service-role client (which bypasses RLS entirely), and only
-- src/lib/admin/audit.ts uses that client for this table. No policy, no
-- grant, and no admin UI exists anywhere to update or delete a row — history
-- here is append-only by construction, not just by convention.

-- ============ ADMIN_AUDIT_LOG ============
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users (id),
  -- Snapshot of the actor's role AT THE TIME of the action — staff_roles.role
  -- can change later, and the audit trail should reflect what was true when
  -- the action happened, not what's true now.
  actor_role text not null check (actor_role in ('support', 'moderator', 'finance', 'admin', 'super_admin')),
  action text not null,
  target_type text not null,
  -- Text, not uuid/bigint: targets are a mix of uuid (profiles) and bigint
  -- (listings, tee_time_invites, offers) primary keys, and some future
  -- action (e.g. a settings change) may have no single row target at all.
  target_id text,
  reason text,
  -- Free-form but sanitized before insert (see audit.ts) — never secrets,
  -- credentials, or full request payloads. A record of *what changed*, not a
  -- request/response dump.
  metadata jsonb not null default '{}'::jsonb,
  -- Request/correlation id where available (e.g. Vercel's x-vercel-id), so a
  -- specific action can be traced back to a specific request/deployment log
  -- if needed. Not always available (e.g. a script-triggered action), hence
  -- nullable.
  correlation_id text,
  outcome text not null default 'success' check (outcome in ('success', 'failure')),
  created_at timestamptz not null default now()
);

alter table public.admin_audit_log enable row level security;

create index if not exists admin_audit_log_actor_id_idx on public.admin_audit_log (actor_id);
create index if not exists admin_audit_log_action_idx on public.admin_audit_log (action);
create index if not exists admin_audit_log_target_idx on public.admin_audit_log (target_type, target_id);
create index if not exists admin_audit_log_created_at_idx on public.admin_audit_log (created_at desc);

-- ============ RLS: admin_audit_log ============
-- Read-only, and only for super_admin — matches the role model in
-- claude/admin-architecture-review.md §6 ("super_admin — ... access the
-- audit log"). No insert/update/delete policy exists for any role: writes
-- only ever happen via the service-role client from src/lib/admin/audit.ts,
-- which bypasses RLS, and nothing here grants authenticated/anon the ability
-- to write or modify rows through PostgREST.
create policy "Super admins can view the audit log"
  on public.admin_audit_log for select
  to authenticated
  using (public.is_staff(array['super_admin']));

-- Belt-and-suspenders alongside "no policy = no access": explicitly revoke
-- write privileges from the roles PostgREST uses, the same lesson learned in
-- 0008_staff_roles_fix_is_staff_grants.sql (Supabase's default grants can be
-- broader than "no policy" alone would suggest).
revoke insert, update, delete on public.admin_audit_log from anon;
revoke insert, update, delete on public.admin_audit_log from authenticated;
