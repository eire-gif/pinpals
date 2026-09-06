-- Security-hardening pass: a DB-backed rate limiter for the mutation
-- surfaces with no protection at all today (see the adversarial security
-- review this migration is part of) — credential-stuffing/enumeration on
-- login, signup, and password-reset, and spam/abuse on the highest-risk
-- authenticated mutations (marketplace offers, messages, conversation
-- reports). No new external service/dependency: this is a small,
-- self-contained fixed-window counter, the same "one choke-point function,
-- called only from the service-role client" shape as claim_webhook_event()
-- (0021) and create_refund_request() (0023).
--
-- Deliberately a FIXED window, not a sliding one or a token bucket: one row
-- per (key, window) pair, one upsert per call. A caller can burst up to
-- ~2x the configured max across a window boundary in the worst case — this
-- is accepted for what this is actually defending (scripted brute-force and
-- spam, not billing-grade precision), and keeps the whole thing to one
-- table and one function.
--
-- `rl_key` is the caller's own composition of `<action>:<identifier>` (see
-- src/lib/rate-limit.ts) — an IP address for the unauthenticated flows
-- (login/signup/forgot-password, where there's no user id yet) or a user id
-- for authenticated mutations (reset-password, offers, messages, reports).
-- This table holds no personal content, only bucketed hit counts against an
-- opaque string the app already knows, so there is nothing here for RLS to
-- meaningfully scope even if a policy existed — RLS is still enabled and
-- every grant to anon/authenticated revoked below, so a future migration
-- accidentally adding an open policy still can't be read directly over
-- PostgREST; the only access path is check_rate_limit() below, itself only
-- ever called from the service-role client (src/lib/rate-limit.ts), same
-- discipline as every other privileged function in this schema.
create table public.rate_limit_hits (
  rl_key text not null,
  window_start timestamptz not null,
  hits int not null default 1,
  primary key (rl_key, window_start)
);

alter table public.rate_limit_hits enable row level security;
revoke all on public.rate_limit_hits from anon, authenticated;

-- Backs the opportunistic cleanup below with an index scan rather than a
-- sequential scan once this table has grown past a trivial size.
create index rate_limit_hits_window_start_idx on public.rate_limit_hits (window_start);

-- Increments `p_key`'s current window bucket and reports whether this call
-- is still within `p_max_hits` for a `p_window_seconds`-wide window, plus
-- how many seconds remain until the current window rolls over (so a caller
-- can tell a blocked user when to retry rather than just "try again
-- later"). Not SECURITY DEFINER: unlike is_staff() or
-- admin_distinct_webhook_event_types(), nothing here needs to run as a
-- different role than its caller — the service-role client this is always
-- called through (never a lower-privileged one) already has whatever this
-- needs, same reasoning as apply_order_transfer_captured() (0024).
create or replace function public.check_rate_limit(
  p_key text,
  p_max_hits int,
  p_window_seconds int
)
returns table (allowed boolean, retry_after_seconds int)
language plpgsql
set search_path = public
as $$
declare
  v_window_start timestamptz;
  v_hits int;
begin
  v_window_start := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_hits (rl_key, window_start, hits)
  values (p_key, v_window_start, 1)
  on conflict (rl_key, window_start)
    do update set hits = public.rate_limit_hits.hits + 1
  returning public.rate_limit_hits.hits into v_hits;

  -- Opportunistic, amortized cleanup of expired buckets — not run on every
  -- call (unnecessary; this table sees at most a handful of writes per
  -- rate-limited action across the whole site) and not dependent on
  -- pg_cron being enabled on this project.
  if random() < 0.01 then
    delete from public.rate_limit_hits where window_start < now() - interval '1 day';
  end if;

  return query select
    v_hits <= p_max_hits,
    greatest(0, p_window_seconds - floor(extract(epoch from now() - v_window_start))::int);
end;
$$;

revoke execute on function public.check_rate_limit(text, int, int) from public, anon, authenticated;
