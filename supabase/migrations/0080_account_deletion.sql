-- Pinpals: account deletion
--
-- App Store Review Guideline 5.1.1(v) requires an app that creates accounts to
-- offer account deletion inside the app, and says in terms that temporary
-- deactivation is not enough. GDPR Article 17 requires it regardless of Apple.
-- Data the operator is legally required to keep may be retained if the member
-- is told — which is the whole reason this migration is not a DELETE.
--
-- WHY THE SCHEMA WILL NOT LET US SIMPLY DELETE THE MEMBER. profiles cascades
-- from auth.users and twenty-two tables cascade from profiles, so the social
-- half of a member disappears cleanly. But orders.buyer_id, orders.seller_id,
-- payouts.user_id, refunds.requested_by, reports.*, support_cases.*,
-- admin_audit_log.actor_id and fraud_flags.* are all ON DELETE NO ACTION, so
-- `delete from auth.users` raises a foreign key violation for anybody who has
-- ever traded. That is correct: the subject of a financial or moderation
-- record must not be able to destroy it. Deletion is therefore
--
--   delete the member where nothing legally requires otherwise,
--   anonymise where something does.
--
-- Irish Revenue requires transaction records for six years, which is exactly
-- the retention Apple contemplates. Order, payout, refund and dispute rows
-- keep a user id as a foreign key and carry no readable identity once the
-- profile is scrubbed.
--
-- WHAT IS DELIBERATELY NOT IN THIS MIGRATION. No function here cancels tee
-- times, removes listings or performs the scrub. Every one of those needs a
-- notification — someone holding a confirmed place in a fourball that is about
-- to vanish has to be told — and notifyUser() lives in TypeScript, not in the
-- database. A SQL function that moved the rows would move them in silence.
-- Same reasoning as claude/mobile-app-api-build-spec.md §1. The database's job
-- here is to hold the request and to answer one question the member's own RLS
-- cannot: may this account go yet?
--
-- Rollback:
--   drop function if exists public.can_delete_account();
--   drop table if exists public.account_deletion_requests;
--   alter table public.profiles drop column if exists deleted_at;

-- ===========================================================================
-- 1. The tombstone on the profile
-- ===========================================================================
--
-- Set only when the scrub completes on the anonymise path. It is what every
-- "find a member" surface must now exclude — search, the member directory,
-- connection suggestions — so a scrubbed profile is never offered as somebody
-- to play golf with. A member who was fully deleted has no profile row at all
-- and needs no flag.

alter table public.profiles
  add column deleted_at timestamptz;

comment on column public.profiles.deleted_at is
  'Set when an account deletion scrub has anonymised this profile. Such a '
  'profile is retained only to keep order, payout and refund history '
  'referentially intact; it must be excluded from search, directories and '
  'suggestions.';

create index profiles_deleted_at_idx
  on public.profiles (deleted_at)
  where deleted_at is not null;

-- ===========================================================================
-- 2. The request
-- ===========================================================================
--
-- The 30-day window is a locked-out grace period, not a deactivation the
-- member can walk back by signing in: the auth user is banned and every
-- session revoked at the moment of the request. The delay exists so that a
-- deletion made in temper or by accident can be undone by asking, not so the
-- account keeps working. Apple allows a process that takes time provided the
-- member is told how long and gets a confirmation at the end; it does not
-- allow an account that still works.
--
-- ON DELETE CASCADE is deliberate. On the clean-delete path the auth user is
-- removed outright and this row goes with it — an account that left no
-- legally-required trace should leave no trace here either. The anonymise
-- path keeps its row, with outcome = 'anonymised'.

create table public.account_deletion_requests (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  scheduled_for timestamptz not null,
  completed_at  timestamptz,
  outcome       text,
  constraint account_deletion_requests_outcome_check
    check (outcome is null or outcome in ('deleted', 'anonymised')),
  -- An outcome without a completion, or the reverse, means the scrub died
  -- halfway. Make that state unrepresentable rather than something to detect
  -- later in a support ticket.
  constraint account_deletion_requests_outcome_with_completion
    check ((completed_at is null) = (outcome is null)),
  constraint account_deletion_requests_scheduled_after_request
    check (scheduled_for > requested_at)
);

-- One live request per member. A second press of the button must not create a
-- second row and quietly reset the clock.
create unique index account_deletion_requests_one_live_per_user
  on public.account_deletion_requests (user_id)
  where completed_at is null;

-- The scrub's own query: everything due and not yet done.
create index account_deletion_requests_due_idx
  on public.account_deletion_requests (scheduled_for)
  where completed_at is null;

alter table public.account_deletion_requests enable row level security;

-- A member may see their own request — the settings page shows "your account
-- will be deleted on 19 October" — and may create it. Nobody may update or
-- delete one: completing a request is the scheduled job's work, running as
-- service_role, and a member who could delete their own request could unban
-- themselves by the back door.
create policy "Members see their own deletion request"
  on public.account_deletion_requests
  for select
  using (user_id = (select auth.uid()));

create policy "Members request their own deletion"
  on public.account_deletion_requests
  for insert
  with check (user_id = (select auth.uid()));

create policy "Staff see deletion requests"
  on public.account_deletion_requests
  for select
  -- is_staff() matches roles exactly and gives super_admin no implicit
  -- inheritance, so it is named rather than assumed.
  using (is_staff(array['admin', 'super_admin', 'support']));

-- ===========================================================================
-- 3. May this account go yet?
-- ===========================================================================
--
-- Returns null when deletion may proceed, or a sentence naming the obligation
-- that is holding it up. A sentence rather than a code because there is
-- exactly one caller and the member has to read it: "you cannot delete your
-- account" is a dead end, "Order #14 is paid but not yet delivered" is a thing
-- they can go and finish.
--
-- SECURITY DEFINER because a member cannot read payouts, refunds or disputes
-- under their own RLS, and the honest answer depends on all three. It takes no
-- parameters and derives the member from auth.uid(), so it can only ever
-- answer about the caller — the same property that makes
-- has_confirmed_place() safe in 0078.
--
-- Order matters: the most concrete obligation is reported first, because a
-- member with a shipped order and a pending payout should be told about the
-- order they can actually act on.

create function public.can_delete_account()
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid := (select auth.uid());
  v_order   record;
  v_count   integer;
begin
  if v_user_id is null then
    raise exception 'can_delete_account requires an authenticated member';
  end if;

  -- An order still in motion, as either side of it.
  select o.id, o.status, (o.seller_id = v_user_id) as is_seller
    into v_order
  from public.orders o
  where (o.buyer_id = v_user_id or o.seller_id = v_user_id)
    and o.status in (
      'pending', 'pending_payment', 'paid',
      'seller_confirmed', 'shipped', 'disputed'
    )
  order by o.id
  limit 1;

  if found then
    return case
      when v_order.status = 'disputed' then
        format('Order #%s is in dispute. It has to be resolved first.', v_order.id)
      when v_order.is_seller then
        format('Order #%s is still open as a sale. Complete or cancel it first.', v_order.id)
      else
        format('Order #%s is still open as a purchase. Complete or cancel it first.', v_order.id)
    end;
  end if;

  -- Money owed to them that has not landed.
  select o.id into v_order
  from public.orders o
  where o.seller_id = v_user_id
    and o.payout_status in ('pending', 'held')
  order by o.id
  limit 1;

  if found then
    return format(
      'Order #%s still has a payout to come. It has to clear first.',
      v_order.id
    );
  end if;

  select count(*) into v_count
  from public.payouts p
  where p.user_id = v_user_id and p.status in ('pending', 'in_transit');

  if v_count > 0 then
    return 'You have a payout on the way. It has to clear first.';
  end if;

  -- Money owed by them, or being argued over.
  select count(*) into v_count
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where (o.buyer_id = v_user_id or o.seller_id = v_user_id)
    and r.status in ('pending', 'requires_action');

  if v_count > 0 then
    return 'A refund on one of your orders is still being processed.';
  end if;

  -- Stripe's terminal dispute states. Anything else is still live, and the
  -- list is written the safe way round: an unfamiliar status blocks rather
  -- than waves the deletion through.
  select count(*) into v_count
  from public.disputes d
  join public.orders o on o.id = d.order_id
  where (o.buyer_id = v_user_id or o.seller_id = v_user_id)
    and d.status not in ('won', 'lost', 'charge_refunded', 'warning_closed');

  if v_count > 0 then
    return 'A payment dispute on one of your orders is still open.';
  end if;

  return null;
end;
$function$;

comment on function public.can_delete_account() is
  'Null when the calling member may delete their account, otherwise a '
  'sentence naming the obligation blocking it.';

-- `revoke ... from public` alone is NOT enough. The project runs
-- `alter default privileges in schema public grant execute on functions to
-- anon, authenticated`, so a newly created function carries an EXPLICIT
-- per-role grant that a revoke aimed at the PUBLIC pseudo-role leaves in
-- place. That is the notify_user() hole of 12 September 2026 and the
-- register_push_subscription() failure of 18 September. Revoke by name.
-- See claude/incident-notify-user-grants-after-recreate.md.
revoke all on function public.can_delete_account() from public, anon, authenticated;
grant execute on function public.can_delete_account() to authenticated, service_role;
