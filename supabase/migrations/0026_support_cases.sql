-- Pinpals: lightweight support-case system (/admin/support)
--
-- `support_cases` — one row per help request staff are tracking for a
-- member, `support_case_notes` — internal staff commentary (mirrors
-- report_notes/admin_user_notes: append-only, any active staff member may
-- write one), `support_case_linked_actions` — a many-to-many pointer from a
-- case to existing admin_audit_log rows, so a case's timeline can show
-- exactly which consequential actions (a suspension, a refund, a listing
-- takedown) it led to WITHOUT copying any of that action's own sensitive
-- detail into the case.
--
-- No member-facing "open a support case" flow exists yet — same reasoning
-- as reports (0016_admin_reports.sql): this phase is deliberately scoped to
-- the admin queue, so every case starts life created by a staff member on a
-- member's behalf (e.g. from a phone call or email). Nothing here assumes a
-- particular creation path, so a later member-facing flow can write into
-- this same table without a migration.
--
-- Deliberately does NOT duplicate sensitive payment or message data: a case
-- points at an order/listing/tee-time/report/conversation via
-- (linked_target_type, linked_target_id) and staff follow that pointer to
-- the record's own permission-gated admin page — see the task's own
-- minimization instruction and reports' identical 'message'/'conversation'
-- forward-declaration for why 'conversation' is listed below even though no
-- messaging system exists in the app yet.
--
-- A case's own event timeline is NOT a separate table: every case mutation
-- (claim, status change, priority change, resolve, close, reopen, note,
-- action linked) already calls recordAdminAction() with target_type =
-- 'support_case' (see src/lib/admin/audit.ts), so admin_audit_log filtered
-- by (target_type, target_id) already *is* the case's timeline — reusing
-- the one existing audit choke point rather than building a second,
-- parallel history mechanism that could drift from it.

-- ============ SUPPORT_CASES ============
create table if not exists public.support_cases (
  id bigint generated always as identity primary key,
  requester_id uuid not null references auth.users (id),
  subject text not null check (char_length(trim(subject)) > 0 and char_length(subject) <= 200),
  description text check (char_length(description) <= 4000),
  category text not null check (
    category in ('account', 'listing_marketplace', 'tee_times', 'payments_orders', 'technical', 'other')
  ),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open'
    check (status in ('open', 'claimed', 'waiting_on_member', 'resolved', 'closed')),
  -- Claim/assignment — same "both or neither" convention as reports.assigned_admin/
  -- claimed_at, enforced in application code (claimCase()'s single atomic
  -- guarded UPDATE), not a DB constraint.
  assigned_admin uuid references auth.users (id),
  claimed_at timestamptz,
  -- Optional pointer to the ONE record this case is mainly about — never a
  -- second copy of that record's data, just enough to build a permission-
  -- gated link on the case detail page (see getSupportCaseDetail()).
  linked_target_type text check (
    linked_target_type is null
    or linked_target_type in ('order', 'listing', 'tee_time_invite', 'report', 'conversation')
  ),
  -- Text, not uuid/bigint — same reasoning as admin_audit_log.target_id and
  -- reports.target_id: targets mix uuid and bigint primary keys.
  linked_target_id text,
  resolution text check (char_length(resolution) <= 4000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- linked_target_type/linked_target_id travel together, same "both or
  -- neither" shape as assigned_admin/claimed_at above — a target type with
  -- no id (or vice versa) is meaningless.
  constraint support_cases_linked_target_both_or_neither
    check ((linked_target_type is null) = (linked_target_id is null))
);

alter table public.support_cases enable row level security;

drop trigger if exists support_cases_set_updated_at on public.support_cases;
create trigger support_cases_set_updated_at
  before update on public.support_cases
  for each row
  execute function public.set_updated_at();

-- Queue views filter by status/priority and by "mine"/"unassigned" first
-- (same shape as reports), and the requester's own case history (a future
-- "past cases" section on the user detail page) filters by requester_id —
-- index all four. linked_target lookups (a listing/order's own "support
-- cases about this" section) filter by (linked_target_type, linked_target_id).
create index if not exists support_cases_status_idx on public.support_cases (status);
create index if not exists support_cases_priority_idx on public.support_cases (priority);
create index if not exists support_cases_assigned_admin_idx on public.support_cases (assigned_admin);
create index if not exists support_cases_requester_id_idx on public.support_cases (requester_id);
create index if not exists support_cases_linked_target_idx
  on public.support_cases (linked_target_type, linked_target_id);
create index if not exists support_cases_created_at_idx on public.support_cases (created_at desc);

-- ============ RLS: support_cases ============
-- Read-only for any active staff member: unlike reports (which restricts
-- claim/resolve/dismiss to MODERATION_ROLES), EVERY active staff role may
-- work a support case — case triage/tracking isn't itself a destructive
-- action (see admin-architecture-review.md §6: support's own job
-- description is exactly "handle help requests"). Only the underlying
-- actions a case might reference (suspending a user, issuing a refund)
-- stay gated by their own existing role checks in their own actions.ts
-- files — support_case_linked_actions only ever *points at* one of those
-- already-recorded, already-authorized rows, never re-performs it.
create policy "Staff can view support cases"
  on public.support_cases for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for any role: every write (create, claim,
-- status change, resolve, close, reopen) happens through the service-role
-- client in src/app/admin/support/**/actions.ts, which bypasses RLS and
-- always records a matching admin_audit_log entry first. Explicitly revoke
-- write privileges up front rather than relying on "no policy = no access"
-- alone — 0008/0010/0013 all found Supabase's default grants broader than
-- that.
revoke insert, update, delete, truncate, references, trigger
  on public.support_cases from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.support_cases from authenticated;

-- ============ SUPPORT_CASE_NOTES ============
create table if not exists public.support_case_notes (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.support_cases (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  -- Snapshot of the author's role at write time — same rationale as
  -- report_notes.author_role / admin_user_notes.author_role.
  author_role text not null check (author_role in ('support', 'moderator', 'finance', 'admin', 'super_admin')),
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

alter table public.support_case_notes enable row level security;

create index if not exists support_case_notes_case_id_created_idx
  on public.support_case_notes (case_id, created_at desc);

-- ============ RLS: support_case_notes ============
create policy "Staff can view support case notes"
  on public.support_case_notes for select
  to authenticated
  using (public.is_staff());

-- Append-only by construction, identical reasoning to report_notes/
-- admin_user_notes: the only write path is addCaseNote()'s service-role
-- client.
revoke insert, update, delete, truncate, references, trigger
  on public.support_case_notes from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.support_case_notes from authenticated;

-- ============ SUPPORT_CASE_LINKED_ACTIONS ============
-- A pure pointer table: one row per (case, admin_audit_log entry) staff have
-- confirmed is a consequential action this case led to — e.g. "this case
-- resulted in suspending the user" or "this case resulted in refunding
-- order #42". The referenced admin_audit_log row already carries its own
-- actor/target/reason/outcome; this table never repeats any of that, only
-- the pointer plus who linked it and an optional short note on why it's
-- relevant to this case.
create table if not exists public.support_case_linked_actions (
  id bigint generated always as identity primary key,
  case_id bigint not null references public.support_cases (id) on delete cascade,
  audit_log_id bigint not null references public.admin_audit_log (id),
  linked_by uuid not null references auth.users (id),
  note text check (char_length(note) <= 1000),
  created_at timestamptz not null default now(),
  -- The same underlying action shouldn't be linked to the same case twice —
  -- a genuine UI/re-submit guard, not a business rule with exceptions.
  constraint support_case_linked_actions_unique unique (case_id, audit_log_id)
);

alter table public.support_case_linked_actions enable row level security;

create index if not exists support_case_linked_actions_case_id_idx
  on public.support_case_linked_actions (case_id, created_at desc);
create index if not exists support_case_linked_actions_audit_log_id_idx
  on public.support_case_linked_actions (audit_log_id);

-- ============ RLS: support_case_linked_actions ============
create policy "Staff can view support case linked actions"
  on public.support_case_linked_actions for select
  to authenticated
  using (public.is_staff());

revoke insert, update, delete, truncate, references, trigger
  on public.support_case_linked_actions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.support_case_linked_actions from authenticated;
