-- Pinpals: cover two of /admin/reports' foreign keys with indexes
--
-- The Supabase performance advisor flags every unindexed foreign key on
-- reports/report_notes (INFO level) — most are left as-is, matching this
-- app's existing convention of not indexing every owner-style FK by default
-- (e.g. listings.seller_id, offers.buyer_id are unindexed too, and that's an
-- accepted pre-existing pattern, not an oversight). These two specifically
-- mirror indexes this app already ships deliberately for the same reason on
-- sibling admin tables — admin_audit_log_actor_id_idx (0009) and
-- admin_user_notes_author_id_idx (0013) — "who did this" being a real,
-- likely-to-be-queried lookup for both a report's reporter and a note's
-- author, unlike e.g. reports.resolved_by or reports.linked_action_id, which
-- nothing in this phase queries in that direction.

create index if not exists reports_reporter_id_idx on public.reports (reporter_id);
create index if not exists report_notes_author_id_idx on public.report_notes (author_id);
