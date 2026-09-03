-- Pinpals: unified moderation report queue (/admin/reports)
--
-- `reports` — one row per filed report, `report_notes` — internal staff
-- commentary on a report (mirrors admin_user_notes: append-only, any active
-- staff member may write one, not just moderators — a note isn't itself a
-- moderation action).
--
-- No member-facing "file a report" flow exists yet (this phase is
-- deliberately scoped to the admin queue only — see the phase plan), so this
-- table starts empty in production. Nothing here assumes a particular
-- creation path: `reporter_id` and every write happen through the
-- service-role client in src/app/admin/reports/[id]/actions.ts and (once a
-- public reporting flow ships in a later phase) whatever Server Action that
-- phase adds — this migration only has to get the shape and the
-- authorization boundary right, not the creation UI.
--
-- `target_type` includes 'message' and 'conversation' even though no
-- messaging system exists anywhere in the app yet (see
-- claude/admin-architecture-review.md — "No messaging, so no
-- content-moderation surface for DMs yet"). They're declared now only so the
-- column's shape doesn't need a migration later; nothing in this phase reads
-- or joins against a messages/conversations table for either value, and the
-- report detail page shows only the report's own stored fields for that
-- target type, never message content, per the task's minimization
-- instruction.

-- ============ REPORTS ============
create table if not exists public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references auth.users (id),
  target_type text not null check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation')),
  -- Text, not uuid/bigint — same reasoning as admin_audit_log.target_id:
  -- targets mix uuid (profiles) and bigint (listings, tee_time_invites) keys.
  target_id text not null,
  category text not null check (
    category in ('spam', 'harassment', 'inappropriate_content', 'scam_fraud', 'fake_listing', 'no_show', 'other')
  ),
  description text check (char_length(description) <= 4000),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  status text not null default 'open' check (status in ('open', 'claimed', 'resolved', 'dismissed')),
  -- Claim/assignment. assigned_admin + claimed_at travel together (both set
  -- or both null) — enforced in application code (claimReport()'s single
  -- atomic UPDATE), not a DB constraint, since a constraint can't express
  -- "both or neither" any more simply than the WHERE-guarded UPDATE already
  -- does the real work of preventing double-claims.
  assigned_admin uuid references auth.users (id),
  claimed_at timestamptz,
  -- Free-form list of what the reporter pointed to as evidence — a listing
  -- id, a screenshot URL/description, a related report id, etc. Not a file
  -- upload system; just short strings staff can read and click through by
  -- hand. Bounded so one bad report can't bloat this table.
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  resolution text check (char_length(resolution) <= 4000),
  resolved_at timestamptz,
  resolved_by uuid references auth.users (id),
  -- Optional pointer to the admin_audit_log row for the moderation action
  -- (if any) that this report's resolution corresponds to — e.g. "resolved
  -- by hiding listing #42". Set only via the resolution form's link picker
  -- (src/app/admin/reports/[id]/actions.ts's resolveReport()), which only
  -- offers entries already scoped to this report's own target, so this can
  -- never point at an unrelated action.
  linked_action_id bigint references public.admin_audit_log (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.reports enable row level security;

drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
  before update on public.reports
  for each row
  execute function public.set_updated_at();

-- Queue views filter by status/priority and by "mine"/"unassigned" first,
-- and every target-scoped read (the listing/user detail page's "Reports"
-- section) filters by (target_type, target_id) — index all four.
create index if not exists reports_status_idx on public.reports (status);
create index if not exists reports_priority_idx on public.reports (priority);
create index if not exists reports_assigned_admin_idx on public.reports (assigned_admin);
create index if not exists reports_target_idx on public.reports (target_type, target_id);
create index if not exists reports_created_at_idx on public.reports (created_at desc);

-- ============ RLS: reports ============
-- Read-only for any active staff member, same rationale as
-- admin_user_notes: support needs to view the queue to triage/help even
-- though only MODERATION_ROLES can claim/resolve (enforced by requireStaff()
-- in the Server Actions, not by RLS — see admin_user_notes for the same
-- read-broad/write-narrow split).
create policy "Staff can view reports"
  on public.reports for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for any role: every write (claim, status
-- change, resolve, dismiss) happens through the service-role client in
-- src/app/admin/reports/[id]/actions.ts, which bypasses RLS and always
-- records a matching admin_audit_log entry first. Explicitly revoke write
-- privileges up front rather than relying on "no policy = no access" alone —
-- 0008/0010/0013 all found Supabase's default grants broader than that.
revoke insert, update, delete, truncate, references, trigger
  on public.reports from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.reports from authenticated;

-- ============ REPORT_NOTES ============
create table if not exists public.report_notes (
  id bigint generated always as identity primary key,
  report_id bigint not null references public.reports (id) on delete cascade,
  author_id uuid not null references auth.users (id),
  -- Snapshot of the author's role at write time — same rationale as
  -- admin_user_notes.author_role and admin_audit_log.actor_role.
  author_role text not null check (author_role in ('support', 'moderator', 'finance', 'admin', 'super_admin')),
  body text not null check (char_length(trim(body)) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now()
);

alter table public.report_notes enable row level security;

create index if not exists report_notes_report_id_created_idx
  on public.report_notes (report_id, created_at desc);

-- ============ RLS: report_notes ============
create policy "Staff can view report notes"
  on public.report_notes for select
  to authenticated
  using (public.is_staff());

-- Append-only by construction, identical reasoning to admin_user_notes: the
-- only write path is addReportNote()'s service-role client.
revoke insert, update, delete, truncate, references, trigger
  on public.report_notes from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.report_notes from authenticated;
