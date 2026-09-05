-- Performance pass (admin-scale audit): replace listWebhookEventTypes()'s
-- previous approach — `select("event_type")` over every row in
-- webhook_events, then dedupe in JS — with a single indexed DISTINCT query
-- run inside Postgres. webhook_events grows with every Stripe event this
-- app ever receives (retries included), so fetching every row's event_type
-- just to populate a filter dropdown would have meant transferring an
-- ever-growing column to the app on every /admin/webhook-events page load.
--
-- STABLE (not VOLATILE): this only reads, never writes, so Postgres can
-- cache/reuse the result within a single statement — same reasoning as
-- is_staff() in 0007_staff_roles.sql. SECURITY DEFINER + a fixed
-- search_path for the same reason every privileged function in this schema
-- uses it (0007/0021/0022/0023/0024): a function callable via `.rpc()`
-- should not be resolvable to a different `public` if some future migration
-- ever changes the calling role's search_path.
--
-- Not exposed to anon/authenticated: this is an admin-only lookup (backs
-- /admin/webhook-events, gated by requireStaff() same as every other admin
-- read), called only via the service-role client in
-- src/lib/admin/queries.ts. Revoked from public/anon/authenticated below,
-- same discipline as claim_webhook_event() and friends in 0021.
create or replace function public.admin_distinct_webhook_event_types()
returns table (event_type text)
language sql
security definer
set search_path = public
stable
as $$
  select distinct we.event_type
  from public.webhook_events we
  order by we.event_type
$$;

revoke execute on function public.admin_distinct_webhook_event_types() from public, anon, authenticated;

-- Backs the DISTINCT above with an index scan instead of a sequential scan
-- once webhook_events has grown past a trivial size.
create index if not exists webhook_events_event_type_idx on public.webhook_events (event_type);
