-- Pinpals: payment persistence + Stripe webhook idempotency ledger
--
-- This is what turns "accept offer" into an actual checkout step (per
-- admin-architecture-review.md §8's sequencing) and hardens webhook
-- processing around it. Two things ship together because the second is
-- meaningless without the first:
--
--   1. `webhook_events` — a durable ledger keyed uniquely on
--      (provider, event_id), so a Stripe webhook delivery (or redelivery —
--      Stripe's own docs say "at least once", never "exactly once") can
--      always be told apart from one already handled. Nothing in this app
--      trusts payment/order state Stripe reports through any other channel
--      without this ledger having claimed the event first.
--   2. Two new columns on `orders` (`currency`, `payment_last_error`) — the
--      payment *projection* orders already models (payment_status,
--      payment_reference — see 0019) was missing a place to record what
--      currency Stripe actually charged in (a reconciliation check, not
--      multi-currency support — this app is EUR-only) and why a payment
--      attempt failed, both of which the admin payment view needs to show.
--
-- Design rule this migration follows throughout: Stripe is the source of
-- truth for whether money actually moved. Everything here is Pinpals'
-- *cached, timestamped projection* of that — never the reverse. Nothing here
-- ever computes or trusts a price, fee, or ownership value handed to it from
-- a browser request; every function below takes only Pinpals-internal ids
-- and values already read from `orders` or a verified Stripe payload,
-- because the callers (src/app/api/webhooks/stripe/route.ts,
-- src/app/dashboard/orders/[id]/actions.ts) are what enforce that boundary,
-- not this schema — but the schema is shaped so a caller has to go out of
-- its way to violate it (e.g. every "apply" function below re-derives the
-- order's own payment_status before touching it, rather than trusting a
-- caller-supplied "previous status").
--
-- Why five small Postgres functions instead of doing this update-by-update
-- from application code: "update payment/order/fee state transactionally
-- where appropriate" (the task) needs a real multi-statement transaction —
-- claiming a webhook event as processed AND updating the order it refers to
-- must both happen or neither does, so a crash between two separate
-- supabase-js calls can never leave the ledger saying "processed" while the
-- order was never actually updated. Postgres already wraps a single function
-- body in one transaction; that's the only transaction boundary Supabase's
-- client (PostgREST) exposes, so it's what these functions use it for. Kept
-- small and single-purpose (one per real state transition) rather than one
-- generic "apply this jsonb patch" function, matching the rest of this
-- schema's style (set_updated_at, is_staff, handle_new_user) over a
-- dynamic-SQL patch mechanism that would be harder to review and to keep
-- idempotent/retry-safe.

-- ============ orders: payment projection additions ============
alter table public.orders
  add column currency text not null default 'eur',
  add column payment_last_error text;

alter table public.orders
  add constraint orders_currency_check check (currency = 'eur');

comment on column public.orders.currency is
  'Currency Stripe actually reported on the PaymentIntent for this order (reconciliation, not multi-currency support — this app only ever charges EUR).';
comment on column public.orders.payment_last_error is
  'Stripe''s own decline/failure message (payment_intent.last_payment_error.message) from the most recent failed attempt. Cleared on success. Never a secret, never raw request/response payload — just the human-readable reason shown to a finance admin.';

-- ============ webhook_events ============
create table public.webhook_events (
  id bigint generated always as identity primary key,

  -- "provider" is forward-declared, one-value-wide, the same way orders'
  -- payment_reference/payout_reference were forward-declared ahead of any
  -- Stripe integration existing at all (0019) — this app only integrates
  -- Stripe today, but the ledger's own identity (provider, event_id) is
  -- designed not to need a migration if that ever changes.
  provider text not null default 'stripe' check (provider = 'stripe'),
  event_id text not null,

  event_type text not null,
  api_version text,

  -- 'received' the moment claim_webhook_event() first sees this event id;
  -- 'processing' is available for a future async/queued worker (nothing in
  -- this phase sets it — the webhook route processes synchronously within
  -- the request) but not removed, since a status column an admin queue
  -- filters on on is cheap to leave room in now; 'processed' = handled,
  -- whether or not it caused an order mutation (e.g. account.updated, or an
  -- event type this app doesn't act on, still lands here — see
  -- mark_webhook_event_terminal()); 'failed' = needs human attention, shown
  -- in /admin/webhook-events' queue.
  status text not null default 'received'
    check (status in ('received', 'processing', 'processed', 'failed', 'ignored')),

  -- How many times this exact event id has been delivered/claimed — Stripe
  -- redelivers on a non-2xx response, and a human can also hit "Retry" on a
  -- failed row in /admin/webhook-events. Observability only; nothing in this
  -- app changes behavior based on this number.
  attempts int not null default 1,
  last_error text,

  -- The verified event payload (signature already checked before this table
  -- is ever written to — see the webhook route). Kept for admin debugging
  -- and safe replay of the *routing* decision (never a request for a fresh
  -- Stripe API call needing this app's own secret key). This is Stripe's own
  -- event data — amounts, statuses, ids, at most a card's brand/last4 — not
  -- a "secret" in the STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET sense and
  -- never a full card number (Stripe's payloads never include one). Not
  -- exposed to any authenticated/anon RLS role regardless — see below — and
  -- the admin UI reading it always goes through the service-role client, on
  -- a page gated to FINANCE_ROLES, never queried directly from the browser.
  payload jsonb not null,

  -- Convenience drill-through only, same discipline as orders.listing_id/
  -- offer_id (0019) — set by the apply_order_payment_*() functions once an
  -- event is matched to an order, never authoritative for anything.
  related_order_id bigint references public.orders (id) on delete set null,

  received_at timestamptz not null default now(),
  processed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (provider, event_id)
);

alter table public.webhook_events enable row level security;

drop trigger if exists webhook_events_set_updated_at on public.webhook_events;
create trigger webhook_events_set_updated_at
  before update on public.webhook_events
  for each row
  execute function public.set_updated_at();

-- /admin/webhook-events' queue defaults to "failed, most recent first" and
-- filters by status/event type; the detail page's "related order" link and
-- the reconciliation lookups in apply_order_payment_*() go by
-- related_order_id. (provider, event_id) already has a unique index from the
-- constraint above.
create index webhook_events_status_idx on public.webhook_events (status);
create index webhook_events_received_at_idx on public.webhook_events (received_at desc);
create index webhook_events_event_type_idx on public.webhook_events (event_type);
create index webhook_events_related_order_id_idx on public.webhook_events (related_order_id);

-- ============ RLS: webhook_events ============
-- Staff can read every row — /admin/webhook-events is further gated to
-- FINANCE_ROLES at the requireStaff() layer, not here, same read-broad/
-- gate-in-app split every other admin table in this schema uses.
create policy "Staff can view webhook events"
  on public.webhook_events for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for anon or authenticated at all: the
-- webhook route and the admin retry action both write exclusively through
-- the service-role client (via the functions below), same discipline as
-- every other privileged-write table in this schema (0008/0010/0013/0016/
-- 0019/0020). A member — even a signed-in one — has no path to insert a
-- fabricated "payment succeeded" event into this table.
revoke insert, update, delete, truncate, references, trigger
  on public.webhook_events from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.webhook_events from authenticated;

-- ============ Functions: webhook ledger + order state transitions ============
-- All five are called only from the service-role client (the webhook route,
-- the checkout Server Action, and the admin retry action) — never something
-- an authenticated user's own session could invoke against another user's
-- order, so unlike is_staff() these don't need SECURITY DEFINER (there's no
-- lower-privileged caller to elevate from). Execute is still explicitly
-- revoked from anon/authenticated below, matching this schema's "don't rely
-- on 'no grant' alone" discipline for every other privileged write path.

-- Idempotent claim: first sight of an event id inserts a 'received' row and
-- reports is_new = true; a redelivery (same provider+event_id) hits the
-- unique constraint, increments attempts for observability, and reports
-- is_new = false with whatever status the row already carries — the caller
-- (the webhook route) uses that to short-circuit a duplicate delivery of an
-- already-'processed' event without redoing any order mutation. One INSERT
-- statement, so this claim itself is atomic without needing anything more.
create or replace function public.claim_webhook_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_api_version text,
  p_payload jsonb
)
returns table (id bigint, status text, is_new boolean)
language plpgsql
as $$
begin
  return query
  insert into public.webhook_events (provider, event_id, event_type, api_version, payload)
  values (p_provider, p_event_id, p_event_type, p_api_version, p_payload)
  on conflict (provider, event_id) do update
    set attempts = public.webhook_events.attempts + 1
  returning webhook_events.id, webhook_events.status, (xmax = 0) as is_new;
end;
$$;

-- payment_intent.succeeded (or the checkout action's own self-heal retrieve
-- on return from Stripe hosted confirmation). Guarded by
-- `payment_status <> 'paid'` so a duplicate/out-of-order succeeded event
-- can never re-fire side effects or clobber a row a later event already
-- moved on from — this is what makes the handler safe to call more than
-- once for the same order. Marks the ledger row processed in the same
-- transaction as the order update, so the two can never disagree.
create or replace function public.apply_order_payment_succeeded(
  p_event_row_id bigint,
  p_order_id bigint,
  p_payment_intent_id text,
  p_currency text
)
returns setof public.orders
language plpgsql
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payment_status = 'paid',
        status = case when status = 'pending' then 'completed' else status end,
        payment_reference = p_payment_intent_id,
        currency = p_currency,
        payment_last_error = null,
        completed_at = coalesce(completed_at, now())
    where id = p_order_id
      and payment_status <> 'paid'
    returning *;
end;
$$;

-- payment_intent.payment_failed. Same never-downgrade-a-paid-order guard as
-- above (a late "failed" event for a PaymentIntent that a *different*,
-- already-processed succeeded event settled first must never un-pay an
-- order). p_error is Stripe's own short decline message
-- (last_payment_error.message) — safe to store and to show a finance admin,
-- never a raw payload dump.
create or replace function public.apply_order_payment_failed(
  p_event_row_id bigint,
  p_order_id bigint,
  p_payment_intent_id text,
  p_error text
)
returns setof public.orders
language plpgsql
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payment_status = 'failed',
        payment_reference = p_payment_intent_id,
        payment_last_error = p_error
    where id = p_order_id
      and payment_status <> 'paid'
    returning *;
end;
$$;

-- charge.refunded. p_refund_amount_eur is Stripe's charge.amount_refunded —
-- a running cumulative total on the charge, not an incremental delta, so
-- setting (not adding to) refunded_amount_eur here is correct for both a
-- single full refund and a later top-up partial-then-full refund sequence.
-- No payment_status guard (a refund is expected to happen *after* paid), but
-- refunded_at only ever gets set once, so a redelivered/duplicate refund
-- event updates the amount without moving the original refund timestamp.
create or replace function public.apply_order_payment_refunded(
  p_event_row_id bigint,
  p_order_id bigint,
  p_refund_amount_eur numeric,
  p_reason text
)
returns setof public.orders
language plpgsql
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payment_status = 'refunded',
        status = 'refunded',
        refunded_amount_eur = p_refund_amount_eur,
        refunded_at = coalesce(refunded_at, now()),
        refund_reason = coalesce(refund_reason, p_reason)
    where id = p_order_id
    returning *;
end;
$$;

-- Ledger-only terminal state: an event this app acknowledges but never maps
-- to an order mutation (an unhandled event type — 'ignored', mirroring the
-- pre-existing "ack, don't reject" handling for everything but
-- account.updated), or one that failed to route to a real order (no
-- matching payment_reference, or an amount/currency reconciliation
-- mismatch — 'failed', surfaced in /admin/webhook-events for a human to
-- look at; Stripe is never asked to retry a delivery that will never
-- resolve itself, since retrying a mismatch produces the same mismatch).
-- p_related_order_id is optional — set when an order *was* found (e.g. the
-- reconciliation-mismatch case) so the admin queue can still link to it.
create or replace function public.mark_webhook_event_terminal(
  p_event_row_id bigint,
  p_status text,
  p_error text,
  p_related_order_id bigint
)
returns void
language plpgsql
as $$
begin
  update public.webhook_events
    set status = p_status,
        last_error = p_error,
        processed_at = case when p_status in ('processed', 'ignored') then now() else processed_at end,
        related_order_id = coalesce(p_related_order_id, related_order_id)
    where id = p_event_row_id;
end;
$$;

revoke execute on function public.claim_webhook_event(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_order_payment_succeeded(bigint, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.apply_order_payment_failed(bigint, bigint, text, text) from public, anon, authenticated;
revoke execute on function public.apply_order_payment_refunded(bigint, bigint, numeric, text) from public, anon, authenticated;
revoke execute on function public.mark_webhook_event_terminal(bigint, text, text, bigint) from public, anon, authenticated;
