-- Pinpals: finance/admin payout visibility and reconciliation (Phase 12)
--
-- This app pays sellers with Stripe Connect *destination charges*
-- (src/app/dashboard/orders/[id]/actions.ts's createOrderPaymentIntent():
-- payment_intent.create({ transfer_data: { destination: sellerAccountId } })).
-- Stripe auto-creates exactly one Transfer per successful charge, crediting
-- the connected account's own Stripe balance; Stripe then sweeps that
-- balance into Payouts on its own schedule — a payout routinely aggregates
-- many orders' transfers into one bank deposit, never a fixed 1:1. This
-- migration is what lets a finance admin trace
-- order -> payment -> platform fee -> transfer -> payout status, without
-- ever assuming one payout equals one order (the task's own explicit
-- requirement).
--
-- Three pieces:
--   1. `payouts` — one row per Stripe Payout object per connected account.
--      Same "pure Stripe projection, no guard logic to centralize" shape as
--      `disputes` (0023): written by a direct service-role upsert
--      (src/lib/stripe/payouts.ts), not a dedicated SQL function, because
--      nothing here needs a transactional multi-statement guard the way a
--      money *state transition* does.
--   2. `orders.payout_reference` — forward-declared in 0019, never actually
--      written until now — starts holding the per-order Stripe Transfer id
--      (captured from charge.succeeded). `orders.payout_id` is new: the
--      many-orders-to-one-payout link, set once a payout is reconciled
--      against the transfers it actually swept up.
--   3. Two guarded functions (apply_order_transfer_captured,
--      apply_payout_reconciliation) for the two order-level state
--      transitions this phase adds — same never-downgrade discipline as
--      0021's apply_order_payment_*() functions, and, unlike 0021
--      (see 0022's follow-up fix), `set search_path = public` from the
--      start.
--
-- No raw bank-detail editing anywhere in this migration or the admin UI it
-- backs — a seller's own bank/account maintenance stays entirely inside
-- Stripe's hosted onboarding flow (src/app/dashboard/payouts/actions.ts's
-- startOrResumeOnboarding(), unchanged by this phase).

-- ============ payouts ============
create table public.payouts (
  id bigint generated always as identity primary key,

  user_id uuid not null references auth.users (id),
  -- Denormalized alongside user_id rather than joined from
  -- stripe_connected_accounts on every read — a payout row must stay
  -- meaningful even if that account row is ever deleted, and every admin
  -- list/detail query in this schema already denormalizes its own
  -- Stripe-account-id copy this way (see orders' own snapshot columns, 0019).
  stripe_account_id text not null,

  -- Unique so the webhook upsert and a manual "Sync from Stripe" admin
  -- action can never create two rows for the same Stripe Payout, no matter
  -- how many times either path runs.
  stripe_payout_id text not null unique,

  amount_eur numeric(10,2) not null check (amount_eur >= 0),
  currency text not null default 'eur' check (currency = 'eur'),

  -- Stripe's own Payout.status values, kept as a closed set (unlike
  -- disputes.status) since the admin "failed & blocked" queue and the
  -- reconciliation function below both branch on specific values here.
  status text not null
    check (status in ('paid', 'pending', 'in_transit', 'canceled', 'failed')),
  failure_code text,
  failure_message text,

  arrival_date timestamptz,
  -- 'standard' | 'instant'
  method text,
  -- 'bank_account' | 'card'
  type text,

  -- Whether this payout came from a live-mode or test-mode Stripe event —
  -- same reasoning as disputes.livemode (0023): lets the admin UI link to
  -- the matching dashboard.stripe.com/test/... URL.
  livemode boolean not null default false,

  -- When Stripe itself created the payout — the business-meaningful
  -- ordering for this table's default sort, distinct from created_at below
  -- (when Pinpals first learned about it, which can lag behind on a
  -- backfilled historical sync).
  stripe_created_at timestamptz not null,
  last_synced_at timestamptz not null default now(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.payouts enable row level security;

drop trigger if exists payouts_set_updated_at on public.payouts;
create trigger payouts_set_updated_at
  before update on public.payouts
  for each row
  execute function public.set_updated_at();

-- The ledger list filters by status (the "failed & blocked" queue) and by
-- seller, and default-sorts most-recent-first; the detail page's "which
-- orders swept into this payout" query goes through orders.payout_id
-- instead (indexed below), not a reverse lookup on this table.
create index payouts_user_id_idx on public.payouts (user_id);
create index payouts_status_idx on public.payouts (status);
create index payouts_stripe_account_id_idx on public.payouts (stripe_account_id);
create index payouts_stripe_created_at_idx on public.payouts (stripe_created_at desc);

create policy "Staff can view payouts"
  on public.payouts for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for anon or authenticated: every write goes
-- through the service-role client (the payout.* webhook handlers and the
-- admin "Sync from Stripe" action, both in src/lib/stripe/payouts.ts), same
-- discipline as every other privileged-write table in this schema.
revoke insert, update, delete, truncate, references, trigger
  on public.payouts from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.payouts from authenticated;

-- ============ orders: payout reconciliation additions ============

-- payout_id is the many-orders-to-one-payout link the task explicitly
-- requires designing for — set only once apply_payout_reconciliation() below
-- has matched this order's own transfer (payout_reference) against a
-- specific payout's swept transfers. on delete set null rather than
-- restrict/cascade: a payout row is never expected to be deleted in normal
-- operation, but an order's own history shouldn't become undeletable-by-fk
-- if one ever is.
alter table public.orders
  add column payout_id bigint references public.payouts (id) on delete set null;

create index orders_payout_id_idx on public.orders (payout_id);

-- Powers the reverse lookup apply_payout_reconciliation() runs (match
-- incoming transfer ids back to orders) — partial, since the huge majority
-- of historical rows predate any Stripe integration at all (0019) and will
-- never populate this column.
create index orders_payout_reference_idx on public.orders (payout_reference)
  where payout_reference is not null;

-- 'failed' is new: a payout that lands in this order's transfer failed or
-- was canceled by Stripe after the fact (a connected account that lost
-- payouts_enabled between the transfer and the sweep, for example) — no
-- such state existed anywhere in the payout_status vocabulary before this
-- phase, since nothing populated payout_status at all until now.
alter table public.orders
  drop constraint if exists orders_payout_status_check;
alter table public.orders
  add constraint orders_payout_status_check
  check (payout_status in ('not_started', 'pending', 'paid_out', 'held', 'failed'));

comment on column public.orders.payout_reference is
  'The Stripe Transfer id created automatically alongside this order''s destination charge (charge.succeeded''s own transfer field) — populated by apply_order_transfer_captured() below. Forward-declared in 0019, actually written starting this phase.';
comment on column public.orders.payout_id is
  'Which payouts row swept this order''s transfer into an actual bank deposit, once known. Nullable and often long-pending — Stripe aggregates many orders'' transfers into one payout on its own schedule, never a fixed 1:1.';

-- ============ Functions: order-level payout state transitions ============
-- Both service-role-only (called from src/lib/stripe/payouts.ts's webhook
-- handlers and the admin "Sync from Stripe" action) — no lower-privileged
-- caller to elevate from, so SECURITY DEFINER isn't needed, same reasoning
-- as 0021/0023's functions. `set search_path = public` from the start (see
-- 0022's follow-up fix for what happens when a migration skips this).

-- charge.succeeded. Guarded by `payout_status = 'not_started'` so a
-- redelivered/duplicate event (or one arriving after a later event already
-- moved this order on, e.g. a refund reversing the payout entirely) can
-- never clobber a row that has already progressed — mirrors 0021's
-- never-downgrade-a-paid-order discipline for the payout dimension.
create or replace function public.apply_order_transfer_captured(
  p_event_row_id bigint,
  p_order_id bigint,
  p_transfer_id text
)
returns setof public.orders
language plpgsql
set search_path = public
as $$
begin
  update public.webhook_events
    set status = 'processed',
        processed_at = now(),
        related_order_id = p_order_id
    where id = p_event_row_id;

  return query
  update public.orders
    set payout_reference = p_transfer_id,
        payout_status = 'pending'
    where id = p_order_id
      and payout_status = 'not_started'
    returning *;
end;
$$;

-- Called once per payout webhook/sync reconciliation pass (see
-- reconcilePayoutTransfers() in src/lib/stripe/payouts.ts), after Stripe's
-- balanceTransactions.list() has reported which transfer ids a given payout
-- actually swept up. Matches purely on orders.payout_reference — never a
-- caller-supplied order id — and never overwrites a row an admin has
-- manually set to 'held' (a deliberate manual hold always wins over an
-- automatic reconciliation pass, until a staff member explicitly releases
-- it). Idempotent: re-running the same payout's reconciliation (e.g. a
-- redelivered payout.paid event) reapplies the same values harmlessly.
create or replace function public.apply_payout_reconciliation(
  p_payout_id bigint,
  p_order_payout_status text,
  p_transfer_ids text[]
)
returns setof public.orders
language plpgsql
set search_path = public
as $$
begin
  return query
  update public.orders
    set payout_id = p_payout_id,
        payout_status = p_order_payout_status
    where payout_reference = any(p_transfer_ids)
      and payout_status <> 'held'
    returning *;
end;
$$;

revoke execute on function public.apply_order_transfer_captured(bigint, bigint, text) from public, anon, authenticated;
revoke execute on function public.apply_payout_reconciliation(bigint, text, text[]) from public, anon, authenticated;
