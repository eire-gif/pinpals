-- Pinpals: internal admin notes on a member
--
-- Free-text notes staff leave on a member's account (e.g. "reminded them
-- listing photos need to be their own", "asked to verify GUI number") —
-- separate from admin_audit_log, which records *actions taken*, not general
-- commentary. Every note is immutable and carries who wrote it and when;
-- there is no edit/delete path anywhere in the app, so like
-- admin_audit_log this table is append-only by construction, not just
-- convention.
--
-- Unlike admin_audit_log (super_admin-only read), notes are readable by any
-- active staff member, support included — see
-- claude/admin-architecture-review.md §6 ("support — ... handle help
-- requests") and the project task's own "Support may view/help" rule.
-- Writing a note follows the same rule: any active staff member can add
-- one, not just moderators — a note isn't a moderation action.

-- ============ ADMIN_USER_NOTES ============
create table if not exists public.admin_user_notes (
  id bigint generated always as identity primary key,
  target_user_id uuid not null references auth.users (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  -- Snapshot of the author's role AT THE TIME of writing, same rationale as
  -- admin_audit_log.actor_role — a role can change later, and the note
  -- should reflect who was speaking with what authority when they wrote it.
  author_role text not null check (author_role in ('support', 'moderator', 'finance', 'admin', 'super_admin')),
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

alter table public.admin_user_notes enable row level security;

-- Primary access pattern: "notes for this member, newest first" — a
-- composite index serves that directly rather than an index scan plus sort.
create index if not exists admin_user_notes_target_user_created_idx
  on public.admin_user_notes (target_user_id, created_at desc);

create index if not exists admin_user_notes_author_id_idx
  on public.admin_user_notes (author_id);

-- ============ RLS: admin_user_notes ============
-- Read-only for any active staff member — matches "Support may view/help"
-- rather than admin_audit_log's super_admin-only policy.
create policy "Staff can view admin notes"
  on public.admin_user_notes for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for any role: exactly like
-- admin_audit_log, the only way a row is ever written is through the
-- service-role client (src/app/admin/users/[id]/actions.ts's addUserNote()),
-- which bypasses RLS entirely. Explicitly revoke write privileges from
-- anon/authenticated too, rather than relying on "no policy = no access"
-- alone — 0008_staff_roles_fix_is_staff_grants.sql and
-- 0010_admin_audit_log_fix_grants.sql both found Supabase's default grants
-- broader than that, so this migration bakes the fix in from the start
-- instead of needing a follow-up.
revoke insert, update, delete, truncate, references, trigger
  on public.admin_user_notes from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.admin_user_notes from authenticated;
