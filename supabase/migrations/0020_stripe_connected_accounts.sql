-- Pinpals: Stripe Connect seller onboarding / payout readiness
--
-- One row per Pinpals member who has started (or completed) Stripe Connect
-- Express onboarding. Created by startOrResumeOnboarding()
-- (src/app/dashboard/payouts/actions.ts) the moment a stripe.accounts.create()
-- call succeeds, then kept in sync by two independent paths, both via
-- src/lib/stripe/connect.ts's syncConnectedAccountFromStripe() so there is
-- exactly one place that interprets a Stripe Account payload:
--   1. The account.updated webhook (src/app/api/webhooks/stripe/route.ts) —
--      ongoing sync for anything that changes on Stripe's side.
--   2. A safe server-side stripe.accounts.retrieve() when the seller returns
--      from Stripe's hosted onboarding flow (src/app/dashboard/payouts/
--      return/route.ts) — so the UI is accurate immediately rather than
--      waiting on webhook delivery.
--   3. An admin's manual "Refresh from Stripe" action
--      (src/app/admin/payouts/[id]/actions.ts), audited.
--
-- Design rules this table follows (see the phase task):
--  - Store only the connected-account identifier and operational status
--    flags Stripe itself reports — charges_enabled/payouts_enabled/
--    details_submitted/requirements — never a Pinpals-invented "status"
--    enum. Stripe is the source of truth; this table is a synced, timestamped
--    read cache of it (see last_synced_at), same spirit as
--    admin-architecture-review.md's warning against pretending otherwise.
--  - No bank-account or other financial credentials are ever collected or
--    stored here — Stripe's hosted onboarding (Account Links) collects those
--    directly on Stripe's own domain; Pinpals never sees them.
--  - requirements_currently_due/requirements_past_due store Stripe's own
--    requirement *codes* (e.g. "individual.verification.document",
--    "external_account") — safe, non-sensitive field names describing what's
--    outstanding, never the values submitted for them.

create table if not exists public.stripe_connected_accounts (
  id bigint generated always as identity primary key,

  user_id uuid not null unique references auth.users (id) on delete cascade,
  stripe_account_id text not null unique,

  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,

  -- Stripe requirement codes, not values — see file header.
  requirements_currently_due text[] not null default '{}',
  requirements_past_due text[] not null default '{}',

  -- Stripe's own short code (e.g. "requirements.past_due", "rejected.fraud")
  -- when the account is disabled — safe operational metadata, no free text.
  disabled_reason text,

  last_synced_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.stripe_connected_accounts enable row level security;

drop trigger if exists stripe_connected_accounts_set_updated_at on public.stripe_connected_accounts;
create trigger stripe_connected_accounts_set_updated_at
  before update on public.stripe_connected_accounts
  for each row
  execute function public.set_updated_at();

-- user_id/stripe_account_id already have unique indexes from their
-- constraints above. /admin/payouts additionally sorts by "most recently
-- synced" by default (same reasoning as orders_created_at_idx) and the
-- "needs attention" filter checks payouts_enabled — cheap to index even at
-- this table's expected small size.
create index if not exists stripe_connected_accounts_updated_at_idx
  on public.stripe_connected_accounts (updated_at desc);
create index if not exists stripe_connected_accounts_payouts_enabled_idx
  on public.stripe_connected_accounts (payouts_enabled);

-- ============ RLS: stripe_connected_accounts ============
-- Staff can read every row — /admin/payouts itself is further gated to
-- FINANCE_ROLES (src/lib/admin/finance.ts) at the requireStaff() layer, not
-- here, same read-broad/gate-in-app split used for orders.
create policy "Staff can view seller connected accounts"
  on public.stripe_connected_accounts for select
  to authenticated
  using (public.is_staff());

-- A member can read their own row — this is what /dashboard/payouts reads
-- to show onboarding status, via the regular authenticated client, no
-- service-role client needed for this read.
create policy "Members can view their own connected account"
  on public.stripe_connected_accounts for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy for anon or authenticated: every write —
-- creating the row when onboarding starts, syncing it from a webhook or a
-- return-URL retrieve, an admin's manual refresh — goes through the
-- service-role client, same discipline as orders (0019). A member never
-- gets a direct write path to their own operational flags, even though
-- they're the one triggering the onboarding start.
revoke insert, update, delete, truncate, references, trigger
  on public.stripe_connected_accounts from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.stripe_connected_accounts from authenticated;
