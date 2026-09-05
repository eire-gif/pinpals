-- Performance pass (admin-scale audit): add covering indexes for foreign-key
-- columns that are used in filters/joins but had no index backing them,
-- confirmed against the live pg_indexes state before writing this migration.
-- Without these, admin lookups like "orders for this listing" or "messages
-- hidden by this staff member" degrade to sequential scans as the tables
-- grow into the hundreds of thousands/millions of rows the task assumes.
--
-- staff_roles.created_by is deliberately NOT indexed here — that table will
-- always be a small, staff-sized table, so an index there has no payoff.

create index if not exists listings_seller_id_idx on public.listings (seller_id);
create index if not exists messages_sender_id_idx on public.messages (sender_id);
create index if not exists messages_hidden_by_idx on public.messages (hidden_by);
create index if not exists orders_listing_id_idx on public.orders (listing_id);
create index if not exists refunds_requested_by_idx on public.refunds (requested_by);
create index if not exists reports_linked_action_id_idx on public.reports (linked_action_id);
create index if not exists reports_resolved_by_idx on public.reports (resolved_by);

-- listAuditLog() (src/lib/admin/queries.ts) now paginates admin_audit_log by
-- keyset on (created_at desc, id desc) instead of OFFSET — see that
-- function's own comment. admin_audit_log_created_at_idx (0009) alone can't
-- serve the `id`-tiebreaker range condition efficiently; this composite
-- index covers the exact (order by, tiebreak) pair the cursor filter needs.
create index if not exists admin_audit_log_created_at_id_idx on public.admin_audit_log (created_at desc, id desc);
