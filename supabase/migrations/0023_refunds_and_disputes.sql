-- Pinpals: marketplace refund administration + dispute visibility
--
-- Two new tables, both Stripe-backed projections in the same spirit as
-- `webhook_events` (0021) — Stripe is the source of truth for whether money
-- actually moved or a cardholder actually disputed a charge; these tables
-- are Pinpals' own timestamped record of that, written only through the
-- service-role client (an admin's refund click, or a verified webhook).
--
--   1. `refunds` — one row per refund ATTEMPT (not per order). The
--      pre-existing `orders.refund_reason`/`refunded_amount_eur`/
--      `refunded_at` columns (0019/0021) can only represent a single refund
--      event per order and have no notion of "requested but not yet
--      settled" or "failed" — this phase's task requires distinct
--      requested/succeeded/failed audit events and a partial-refund-aware
--      "refundable amount", neither of which fits in three order-level
--      columns. Those columns are left exactly as they are and keep being
--      written by the existing charge.refunded -> apply_order_payment_refunded
--      path (0021) as the order's own aggregate "current state" summary;
--      `refunds` is the detailed ledger sitting alongside it, one row per
--      Stripe Refund object.
--   2. `disputes` — no dispute/chargeback schema exists anywhere yet. One
--      row per Stripe Dispute object, upserted from
--      charge.dispute.created/updated/closed. Visibility only — this app
--      never submits evidence or otherwise acts on a dispute; the admin UI
--      links out to Stripe's own dispute tooling for that.
--
-- Same design rule as 0021 throughout: every function here takes only
-- Pinpals-internal ids and values already read from `orders` or a verified
-- Stripe payload, never a client-supplied payment id or amount — the task's
-- own explicit requirement — and every function is defined with
-- `set search_path = public` from the start (0021 needed a follow-up
-- migration, 0022, to add this after the fact; no reason to repeat that
-- here).

-- ============ refunds ============
create table public.refunds (
  id bigint generated always as identity primary key,

  order_id bigint not null references public.orders (id),

  -- Set once the synchronous stripe.refunds.create() call returns (almost
  -- always immediately — Stripe assigns the id before this app's request
  -- completes). Unique so a webhook reconciling a Refund object has exactly
  -- one row to update, and so the same Stripe refund can never be recorded
  -- twice even if a webhook redelivery races a slow admin request.
  stripe_refund_id text unique,
  stripe_payment_intent_id text not null,

  amount_eur numeric(8,2) not null check (amount_eur > 0),
  currency text not null default 'eur' check (currency = 'eur'),

  -- The admin's own typed justification — distinct from Stripe's short
  -- refund-reason enum (duplicate/fraudulent/requested_by_customer), which
  -- charge.refunded already threads into orders.refund_reason via 0021 and
  -- isn't duplicated here.
  reason text not null check (char_length(reason) <= 4000),

  -- Mirrors Stripe's own Refund.status values (including requires_action,
  -- Stripe's "still needs the customer to take an action" state for some
  -- payment methods) rather than collapsing them, so the mapping layer
  -- (src/lib/stripe/refunds.ts) never has to invent a value Stripe didn't
  -- report. Adding a new Stripe status value would need a migration, same
  -- tradeoff orders.status/payment_status already make.
  status text not null default 'pending'
    check (status in ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  failure_reason text,

  -- One request = one idempotency key, generated before the Stripe call and
  -- reused on any client-side retry of that same click — see
  -- create_refund_request() below and requestOrderRefund() in
  -- src/app/admin/orders/[id]/actions.ts.
  idempotency_key text not null unique,

  requested_by uuid not null references auth.users (id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.refunds enable row level security;

drop trigger if exists refunds_set_updated_at on public.refunds;
create trigger refunds_set_updated_at
  before update on public.refunds
  for each row
  execute function public.set_updated_at();

-- The order detail page's refund history section reads by order_id;
-- reconciliation webhooks look up by stripe_refund_id (already unique, so
-- no separate index needed there).
create index refunds_order_id_idx on public.refunds (order_id);
create index refunds_status_idx on public.refunds (status);

create policy "Staff can view refunds"
  on public.refunds for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for anon or authenticated: every write
-- goes through create_refund_request()/mark_refund_outcome() below, called
-- only from the service-role client (the refund Server Action and the
-- webhook route), same discipline as webhook_events (0021).
revoke insert, update, delete, truncate, references, trigger
  on public.refunds from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.refunds from authenticated;

-- ============ disputes ============
create table public.disputes (
  id bigint generated always as identity primary key,

  -- Nullable: a dispute always carries a payment_intent, but the matching
  -- order lookup can still miss (e.g. a charge that predates this app's own
  -- records, or one Stripe associates with a payment_intent this app never
  -- created) — this table stores every dispute Stripe reports regardless,
  -- same "never drop a Stripe event on the floor for a lookup miss"
  -- reasoning as webhook_events.related_order_id.
  order_id bigint references public.orders (id) on delete set null,

  stripe_dispute_id text not null unique,
  stripe_charge_id text,
  stripe_payment_intent_id text,

  amount_eur numeric(8,2) not null check (amount_eur >= 0),
  currency text not null default 'eur' check (currency = 'eur'),

  -- Stripe's own dispute reason enum (e.g. fraudulent, product_not_received)
  -- and status. Status intentionally has no check constraint, unlike
  -- refunds.status above: Stripe's dispute status list is longer and this
  -- table only ever displays it (never branches app logic on a specific
  -- value), so an unrecognised future status degrades to "shown as-is"
  -- rather than rejecting the webhook write outright.
  reason text,
  status text not null,

  evidence_due_by timestamptz,

  -- Whether this dispute came from a live-mode or test-mode Stripe event —
  -- lets the admin UI link to the matching dashboard.stripe.com/test/...
  -- URL rather than guessing.
  livemode boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.disputes enable row level security;

drop trigger if exists disputes_set_updated_at on public.disputes;
create trigger disputes_set_updated_at
  before update on public.disputes
  for each row
  execute function public.set_updated_at();

create index disputes_order_id_idx on public.disputes (order_id);
create index disputes_status_idx on public.disputes (status);

create policy "Staff can view disputes"
  on public.disputes for select
  to authenticated
  using (public.is_staff());

-- Written directly by the webhook handler via the service-role client (an
-- upsert-by-stripe_dispute_id, same shape as connect.ts's
-- syncConnectedAccountFromStripe()) rather than through a dedicated
-- function — a dispute row is a pure Stripe projection with no guard logic
-- to centralize (unlike refunds, nothing else in this app ever writes one).
revoke insert, update, delete, truncate, references, trigger
  on public.disputes from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.disputes from authenticated;

-- ============ Functions: refund lifecycle ============

-- Validates and inserts a 'pending' refund row in one transaction. This is
-- the second, DB-level line of defense (after the Server Action's own
-- checks) against the task's core requirement — never refund a
-- client-supplied amount without validating it against the order's actual
-- refundable state: `select ... for update` locks the order row for the
-- rest of this transaction, so two concurrent refund clicks against the
-- same order can never both compute the same "amount still refundable" and
-- both succeed (the second waits for the first's transaction to commit,
-- then re-reads the now-updated total).
--
-- "Still refundable" = total_eur minus every non-terminal-failed refund
-- already on this order (pending/requires_action/succeeded) — a pending
-- refund reserves its amount against the balance even before Stripe
-- confirms it, so two rapid clicks can't both reserve the same euros.
create or replace function public.create_refund_request(
  p_order_id bigint,
  p_amount_eur numeric,
  p_reason text,
  p_requested_by uuid,
  p_idempotency_key text
)
returns setof public.refunds
language plpgsql
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_already_reserved numeric;
  v_refundable numeric;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Order % not found.', p_order_id;
  end if;

  if v_order.payment_status not in ('paid', 'refunded') then
    raise exception 'Order % is not in a refundable payment state (%).', p_order_id, v_order.payment_status;
  end if;
  if v_order.payment_reference is null then
    raise exception 'Order % has no payment reference to refund.', p_order_id;
  end if;

  select coalesce(sum(amount_eur), 0) into v_already_reserved
    from public.refunds
    where order_id = p_order_id
      and status in ('pending', 'requires_action', 'succeeded');

  v_refundable := v_order.total_eur - v_already_reserved;

  if p_amount_eur <= 0 then
    raise exception 'Refund amount must be greater than zero.';
  end if;
  if p_amount_eur > v_refundable then
    raise exception 'Refund amount % exceeds the % still refundable on order %.', p_amount_eur, v_refundable, p_order_id;
  end if;

  return query
  insert into public.refunds (
    order_id, stripe_payment_intent_id, amount_eur, reason, requested_by, idempotency_key
  )
  values (
    p_order_id, v_order.payment_reference, p_amount_eur, p_reason, p_requested_by, p_idempotency_key
  )
  returning *;
end;
$$;

-- Records the outcome of a refund attempt — called both by the Server
-- Action right after stripe.refunds.create() returns (with whatever status
-- that synchronous response reported) and by the refund.updated/
-- refund.failed webhook handlers as Stripe's own later reconciliation.
-- Guards against a stale webhook regressing an already-terminal row (e.g. a
-- redelivered 'pending' event arriving after this app already recorded
-- 'succeeded'), same never-downgrade discipline as
-- apply_order_payment_succeeded() in 0021.
create or replace function public.mark_refund_outcome(
  p_refund_id bigint,
  p_stripe_refund_id text,
  p_status text,
  p_failure_reason text
)
returns setof public.refunds
language plpgsql
set search_path = public
as $$
begin
  return query
  update public.refunds
    set stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id),
        status = p_status,
        failure_reason = p_failure_reason
    where id = p_refund_id
      and status not in ('succeeded', 'failed', 'canceled')
    returning *;
end;
$$;

-- Same shape as mark_refund_outcome() but keyed by stripe_refund_id rather
-- than Pinpals' own row id — what the refund.updated/refund.failed webhook
-- handlers use, since a webhook only ever carries Stripe's id.
create or replace function public.mark_refund_outcome_by_stripe_id(
  p_stripe_refund_id text,
  p_status text,
  p_failure_reason text
)
returns setof public.refunds
language plpgsql
set search_path = public
as $$
begin
  return query
  update public.refunds
    set status = p_status,
        failure_reason = p_failure_reason
    where stripe_refund_id = p_stripe_refund_id
      and status not in ('succeeded', 'failed', 'canceled')
    returning *;
end;
$$;

revoke execute on function public.create_refund_request(bigint, numeric, text, uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_refund_outcome(bigint, text, text, text) from public, anon, authenticated;
revoke execute on function public.mark_refund_outcome_by_stripe_id(text, text, text) from public, anon, authenticated;
