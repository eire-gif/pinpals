-- Pinpals: marketplace trust & safety workflows (checkpoint: marketplace-trust-safety)
--
-- Extends the reporting/moderation system that already exists (0016, 0025,
-- 0049) rather than building a parallel one, and closes the specific gaps a
-- codebase survey found before this migration was written:
--
--   1. reports.target_type had no 'order' value — a buyer/seller had no way
--      to report an order at all. Added, plus three order-shaped categories
--      (item_not_as_described/item_not_received/payment_issue) and a
--      `wants_refund` flag so a report can double as a structured refund
--      REQUEST — never a refund itself. The actual money movement is
--      unchanged: staff still process it through the existing
--      requestOrderRefund() (src/app/admin/orders/[id]/actions.ts), which
--      already calls stripe.refunds.create() and lets the refund.updated/
--      refund.failed webhooks reconcile the final state (0023). This
--      migration adds no new Stripe call and no new money-movement table.
--      Because "order" is already in AUDIT_TARGET_TYPES (0009) and
--      refund.requested/completed/failed audit entries already use
--      targetType "order" (src/app/admin/orders/[id]/actions.ts), an order
--      report's existing `linked_action_id` picker (resolveReport(),
--      unchanged) automatically offers those refund actions to link a
--      report's resolution to, with no code change needed there at all.
--
--   2. blocking (0049) was wired into messaging but not into the offers
--      workflow (0048 predates 0049) — a blocked buyer could still place an
--      offer on a blocking seller's listing, and either side could still
--      counter/accept an existing offer after blocking. Closed at both
--      layers messaging itself uses for the same reason (defense in depth,
--      not redundancy): the RLS INSERT policy (belt) and the creation
--      trigger, for a specific, friendly rejection message (suspenders).
--      offer_action() gets the same check for 'accept'/'counter' only —
--      not 'decline'/'withdraw', which (like declining/closing a
--      conversation) should always still be possible to close out.
--
--   3. No "mute" concept existed at all (only block). Added as its own
--      table, `muted_users` — deliberately NOT integrated into can_message()/
--      the messages insert policy the way blocking is: a mute is a private,
--      one-directional "I don't want to see this" signal for the MUTER's
--      own inbox/notifications, never a veto on the other person's ability
--      to act. It needs no SECURITY DEFINER symmetric-lookup function like
--      is_blocked() either, since nothing ever needs to know "has the OTHER
--      person muted me" — only "have I muted them", which a normal
--      select-your-own-rows policy already answers.
--
--   4. No fraud/risk-flag concept existed. Added as `fraud_flags` — an
--      append-mostly (raise/clear, never edited) internal-only signal
--      table, same "no insert/update/delete policy for anon/authenticated,
--      only the service-role client after requireStaff()" shape as
--      `reports`/`admin_audit_log`. Nothing in this migration or the app
--      code it pairs with ever reads a fraud flag to automatically suspend,
--      remove, or restrict anything — see risk.ts's own header comment.
--      It is a signal for a human to review, never a verdict.
--
--   5. No escalation concept existed — "you have the role or you 404" was
--      the whole model. Added as three columns on `reports`
--      (escalated_to_role/escalated_at/escalated_by), the same "closely
--      related columns travel together, application code enforces
--      both-or-neither" convention assigned_admin/claimed_at already uses
--      on this exact table — not a new table, since an escalation is a
--      property of an existing report, not a new kind of record.
--
--   6. No retention/redaction concept existed for member-submitted report
--      content (distinct from sanitizeMetadata()'s audit-log-hygiene role —
--      see audit.ts). Added as two columns, `redacted_at`/`redacted_by`, and
--      a single privileged action (redactReport(), super_admin only) that
--      clears `description`/`evidence_refs` while preserving everything
--      else about the report (category, status, resolution, audit trail) —
--      a hook a future retention/erasure policy can call, not a policy
--      engine of its own.
--
-- Nothing here touches Stripe, payouts, or any money-movement path — see
-- (1) above. No suspension/removal mechanism changes: user suspension
-- (Supabase Auth ban) and listing removal (status='removed') were already
-- soft-state and already preserve order history (orders snapshot their own
-- listing_title/category/condition/image_url and keep buyer_id/seller_id
-- with no ON DELETE cascade from auth.users) — see
-- claude/phase-25-marketplace-trust-safety-summary.md for the full survey
-- this migration's design is based on.
--
-- Rollback:
--   alter table public.offers drop constraint if exists offers_buyer_id_not_blocked_ck; -- (no such constraint added; see policy/trigger below)
--   drop trigger if exists offers_prepare_and_validate on public.offers; -- then re-run 0048's original prepare_and_validate_offer()
--   -- then re-run 0048's original "buyers can create offers" policy body and offer_action() body
--   drop table if exists public.muted_users cascade;
--   drop table if exists public.fraud_flags cascade;
--   alter table public.reports
--     drop column if exists wants_refund,
--     drop column if exists escalated_to_role,
--     drop column if exists escalated_at,
--     drop column if exists escalated_by,
--     drop column if exists redacted_at,
--     drop column if exists redacted_by;
--   alter table public.reports drop constraint if exists reports_target_type_check;
--   alter table public.reports add constraint reports_target_type_check
--     check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation'));
--   alter table public.reports drop constraint if exists reports_category_check;
--   alter table public.reports add constraint reports_category_check
--     check (category in ('spam', 'harassment', 'inappropriate_content', 'scam_fraud', 'fake_listing', 'no_show', 'other'));

-- ============ REPORTS: 'order' target type, order-shaped categories, refund-request flag ============
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check
  check (target_type in ('user', 'listing', 'tee_time_invite', 'message', 'conversation', 'order'));

alter table public.reports drop constraint if exists reports_category_check;
alter table public.reports add constraint reports_category_check
  check (
    category in (
      'spam', 'harassment', 'inappropriate_content', 'scam_fraud', 'fake_listing', 'no_show', 'other',
      'item_not_as_described', 'item_not_received', 'payment_issue'
    )
  );

-- Set alongside an 'order' report by the member's own reportOrderIssue()
-- action (src/app/dashboard/orders/[id]/actions.ts) — never itself moves
-- any money; it only tells staff triaging the queue "this one is asking for
-- a refund", so it can be prioritized/filtered without staff having to open
-- and read every order report's free-text description first.
alter table public.reports add column if not exists wants_refund boolean not null default false;

-- Escalation: "hand this to a role that can actually act on it." Both-or-
-- neither by application convention (escalateReport()'s single UPDATE),
-- same as assigned_admin/claimed_at above — a DB constraint can't express
-- "all three or none" any more simply than that guarded UPDATE already
-- does. escalated_to_role is intentionally not staff_roles.role's full
-- domain: escalating TO 'support' isn't a real escalation (support is the
-- entry tier every report is already visible to), so it's excluded here.
alter table public.reports add column if not exists escalated_to_role text
  check (escalated_to_role in ('moderator', 'finance', 'admin', 'super_admin'));
alter table public.reports add column if not exists escalated_at timestamptz;
alter table public.reports add column if not exists escalated_by uuid references auth.users (id);

-- Redaction: a super_admin-only hook (redactReport(), always reason-required
-- like every other manual state repair in this app) that clears
-- description/evidence_refs while leaving the rest of the row (category,
-- status, resolution, timestamps) intact — the report itself, and the fact
-- it existed and was resolved a certain way, is part of the moderation
-- history and stays; only the free-text a member typed (which is where
-- someone else's personal data is most likely to have ended up) is cleared.
alter table public.reports add column if not exists redacted_at timestamptz;
alter table public.reports add column if not exists redacted_by uuid references auth.users (id);

create index if not exists reports_escalated_to_role_idx on public.reports (escalated_to_role) where escalated_to_role is not null;

-- ============ MUTED_USERS ============
-- A private, one-directional "don't surface this person to me" signal —
-- see this migration's header comment for why it's deliberately NOT wired
-- into can_message()/the messages insert policy the way blocking is: muting
-- never restricts what the muted person can do, only what the muter sees.
create table if not exists public.muted_users (
  muter_id uuid not null references public.profiles (id) on delete cascade,
  muted_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (muter_id, muted_id),
  constraint muted_users_not_self check (muter_id <> muted_id)
);

alter table public.muted_users enable row level security;

drop policy if exists "members view their own mute list" on public.muted_users;
create policy "members view their own mute list"
  on public.muted_users for select
  to authenticated
  using ((select auth.uid()) = muter_id);

drop policy if exists "members mute other members" on public.muted_users;
create policy "members mute other members"
  on public.muted_users for insert
  to authenticated
  with check ((select auth.uid()) = muter_id);

drop policy if exists "members unmute other members" on public.muted_users;
create policy "members unmute other members"
  on public.muted_users for delete
  to authenticated
  using ((select auth.uid()) = muter_id);

revoke update, truncate, references, trigger on public.muted_users from anon;
revoke update, truncate, references, trigger on public.muted_users from authenticated;

-- ============ FRAUD_FLAGS ============
-- Internal-only risk signal — never read by any automatic enforcement path
-- in this schema or the app code that pairs with it. Raised/cleared only by
-- staff (via the service-role client, after requireStaff() — same
-- write-path shape as `reports`/`admin_audit_log`), always with a note
-- (raising) or a reason (clearing), and always audited
-- (fraud_flag.raised/fraud_flag.cleared — see audit.ts).
create table if not exists public.fraud_flags (
  id bigint generated always as identity primary key,
  target_type text not null check (target_type in ('user', 'listing', 'order')),
  -- Text, not uuid/bigint — same reasoning as reports.target_id/
  -- admin_audit_log.target_id: targets mix uuid (profiles) and bigint
  -- (listings, orders) keys.
  target_id text not null,
  flag_type text not null check (
    flag_type in ('suspected_fraud', 'payment_risk', 'fake_identity', 'fee_evasion', 'account_takeover', 'other')
  ),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  note text not null check (char_length(trim(note)) > 0 and char_length(note) <= 4000),
  status text not null default 'open' check (status in ('open', 'cleared')),
  raised_by uuid not null references auth.users (id),
  raised_at timestamptz not null default now(),
  cleared_by uuid references auth.users (id),
  cleared_at timestamptz,
  clear_reason text check (char_length(clear_reason) <= 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fraud_flags enable row level security;

drop trigger if exists fraud_flags_set_updated_at on public.fraud_flags;
create trigger fraud_flags_set_updated_at
  before update on public.fraud_flags
  for each row
  execute function public.set_updated_at();

-- Same two query shapes as reports: "everything against one target" (a
-- user/listing/order detail page's own risk-flags panel) and "the open
-- queue" (/admin/risk-flags).
create index if not exists fraud_flags_target_idx on public.fraud_flags (target_type, target_id);
create index if not exists fraud_flags_status_idx on public.fraud_flags (status);
create index if not exists fraud_flags_created_at_idx on public.fraud_flags (created_at desc);

-- ============ RLS: fraud_flags ============
-- Read-only for any active staff member, same rationale as reports/
-- admin_user_notes: support needs to see a flag while triaging even though
-- only the raise/clear actions themselves are gated more narrowly in app
-- code (src/app/admin/risk-flags/actions.ts).
create policy "Staff can view fraud flags"
  on public.fraud_flags for select
  to authenticated
  using (public.is_staff());

-- No insert/update/delete policy for any role — every write (raise, clear)
-- happens through the service-role client, which always records a matching
-- admin_audit_log entry first (recordAdminAction() is called before every
-- write in src/app/admin/risk-flags/actions.ts).
revoke insert, update, delete, truncate, references, trigger
  on public.fraud_flags from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.fraud_flags from authenticated;

-- ============ OFFERS: block-aware insert policy ============
-- Same shape as messages' own block-aware insert policy (0049) — the RLS
-- "belt" half of the defense-in-depth pair described in this migration's
-- header comment. The trigger below is the "suspenders" half (a specific,
-- friendly rejection message); this policy is what's actually
-- authoritative if the trigger is ever bypassed by a privileged path.
drop policy if exists "buyers can create offers" on public.offers;
create policy "buyers can create offers"
  on public.offers for insert
  to public
  with check (
    (select auth.uid()) = buyer_id
    and exists (
      select 1 from public.listings l
      where l.id = offers.listing_id
        and l.seller_id <> (select auth.uid())
        and l.status = 'active'
        and l.sale_type = 'offers_allowed'
        and not public.is_blocked((select auth.uid()), l.seller_id)
    )
  );

-- ============ OFFERS: creation trigger — block check with a friendly message ============
-- Identical to 0048's prepare_and_validate_offer() with one addition: a
-- blocked buyer/seller pair is rejected with a specific message (surfaced
-- via KNOWN_OFFER_CREATE_REJECTION_SNIPPETS in
-- src/app/marketplace/[id]/actions.ts) rather than falling through to the
-- RLS policy's generic "row violates row-level security policy" error.
create or replace function public.prepare_and_validate_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing record;
  v_listing_price_cents integer;
  v_amount_cents integer;
begin
  if auth.uid() is null or public.is_staff() then
    return new;
  end if;

  select id, status, sale_type, price_cents, price_eur, seller_id
    into v_listing
    from public.listings
    where id = new.listing_id
    for update;

  if not found then
    raise exception 'Listing % not found', new.listing_id;
  end if;

  if v_listing.status <> 'active' then
    raise exception 'This listing is not currently accepting offers';
  end if;

  if v_listing.sale_type <> 'offers_allowed' then
    raise exception 'This listing does not accept offers';
  end if;

  if public.is_blocked(new.buyer_id, v_listing.seller_id) then
    raise exception 'You can''t make an offer on this listing right now — messaging or trading with this seller is blocked';
  end if;

  v_listing_price_cents := coalesce(v_listing.price_cents, round(v_listing.price_eur * 100)::integer);
  v_amount_cents := round(new.amount_eur * 100)::integer;

  if v_amount_cents < 100 then
    raise exception 'Offers must be at least EUR 1';
  end if;
  if v_amount_cents >= v_listing_price_cents then
    raise exception 'An offer must be less than the asking price — use Buy Now to pay the full price';
  end if;

  new.original_amount_eur := new.amount_eur;
  new.expires_at := now() + interval '48 hours';
  new.status := 'pending';

  return new;
end;
$$;

revoke execute on function public.prepare_and_validate_offer() from public, anon, authenticated;

drop trigger if exists offers_prepare_and_validate on public.offers;
create trigger offers_prepare_and_validate
  before insert on public.offers
  for each row
  execute function public.prepare_and_validate_offer();

-- ============ OFFER_ACTION(): block check on accept/counter only ============
-- Identical to 0048's offer_action() with one addition: a blocked pair
-- cannot continue/escalate an existing negotiation (accept/counter) — but
-- CAN still decline or withdraw, same "closing out is always allowed, only
-- advancing is vetoed" principle blocking already applies to messaging
-- (existing messages can still be read; only sending new ones is blocked).
create or replace function public.offer_action(
  p_offer_id bigint,
  p_caller_id uuid,
  p_action text,
  p_counter_amount_cents integer default null,
  p_checkout_minutes integer default 30
)
returns public.offers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing_id bigint;
  v_offer public.offers%rowtype;
  v_listing public.listings%rowtype;
  v_is_seller boolean;
  v_is_buyer boolean;
  v_now timestamptz := now();
  v_accept_amount_cents integer;
  v_listing_price_cents integer;
  v_amount_eur numeric(8,2);
  v_fee_eur numeric(8,2);
  v_total_eur numeric(8,2);
begin
  if p_caller_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_action not in ('accept', 'decline', 'counter', 'withdraw') then
    raise exception 'Unknown offer action: %', p_action;
  end if;

  select listing_id into v_listing_id from public.offers where id = p_offer_id;
  if not found then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  select * into v_listing from public.listings where id = v_listing_id for update;
  if not found then
    raise exception 'Listing % not found', v_listing_id;
  end if;

  select * into v_offer from public.offers where id = p_offer_id for update;
  if not found then
    raise exception 'Offer % not found', p_offer_id;
  end if;

  v_is_seller := (p_caller_id = v_listing.seller_id);
  v_is_buyer := (p_caller_id = v_offer.buyer_id);
  if not v_is_seller and not v_is_buyer then
    raise exception 'You are not a party to this offer';
  end if;

  if v_offer.status in ('pending', 'countered') and v_offer.expires_at < v_now then
    raise exception 'This offer has expired';
  end if;

  if p_action in ('accept', 'counter') and v_listing.status <> 'active' then
    raise exception 'This listing is no longer available';
  end if;

  if p_action in ('accept', 'counter') and public.is_blocked(v_offer.buyer_id, v_listing.seller_id) then
    raise exception 'This offer can''t be accepted or countered — messaging or trading between these members is blocked';
  end if;

  -- ============ withdraw: buyer, 'pending' only ============
  if p_action = 'withdraw' then
    if not v_is_buyer then
      raise exception 'Only the buyer can withdraw an offer';
    end if;
    if v_offer.status <> 'pending' then
      raise exception 'Only a pending offer can be withdrawn';
    end if;
    update public.offers set status = 'withdrawn' where id = v_offer.id returning * into v_offer;
    perform public.notify_user(
      v_listing.seller_id, 'offer_withdrawn', 'Offer withdrawn',
      format('A buyer withdrew their offer of %s on "%s".', public.format_eur(v_offer.amount_eur), v_listing.title)
    );
    return v_offer;
  end if;

  -- ============ seller responds to a 'pending' offer ============
  if v_offer.status = 'pending' then
    if not v_is_seller then
      raise exception 'Only the seller can respond to a pending offer';
    end if;

    if p_action = 'decline' then
      update public.offers set status = 'declined' where id = v_offer.id returning * into v_offer;
      perform public.notify_user(
        v_offer.buyer_id, 'offer_declined', 'Offer declined',
        format('Your offer of %s on "%s" was declined.', public.format_eur(v_offer.amount_eur), v_listing.title)
      );
      return v_offer;
    end if;

    if p_action = 'counter' then
      if p_counter_amount_cents is null then
        raise exception 'A counter offer needs an amount';
      end if;
      v_listing_price_cents := coalesce(v_listing.price_cents, round(v_listing.price_eur * 100)::integer);
      if p_counter_amount_cents <= round(v_offer.amount_eur * 100)::integer then
        raise exception 'A counter offer must be higher than the current offer';
      end if;
      if p_counter_amount_cents > v_listing_price_cents then
        raise exception 'A counter offer cannot exceed the asking price';
      end if;

      update public.offers
        set status = 'countered',
            amount_eur = round(p_counter_amount_cents / 100.0, 2),
            expires_at = v_now + interval '48 hours'
        where id = v_offer.id
        returning * into v_offer;

      perform public.notify_user(
        v_offer.buyer_id, 'offer_countered', 'Seller countered your offer',
        format('The seller countered your offer on "%s" with %s.', v_listing.title, public.format_eur(v_offer.amount_eur))
      );
      return v_offer;
    end if;

    v_accept_amount_cents := round(v_offer.amount_eur * 100)::integer;

  -- ============ buyer responds to a 'countered' offer ============
  elsif v_offer.status = 'countered' then
    if not v_is_buyer then
      raise exception 'Only the buyer can respond to a countered offer';
    end if;

    if p_action = 'decline' then
      update public.offers set status = 'declined' where id = v_offer.id returning * into v_offer;
      perform public.notify_user(
        v_listing.seller_id, 'offer_declined', 'Counter offer declined',
        format('Your counter offer of %s on "%s" was declined.', public.format_eur(v_offer.amount_eur), v_listing.title)
      );
      return v_offer;
    end if;

    if p_action = 'counter' then
      raise exception 'Only the seller can counter a pending offer';
    end if;

    v_accept_amount_cents := round(v_offer.amount_eur * 100)::integer;

  else
    raise exception 'Offer % (status %) cannot be acted on', v_offer.id, v_offer.status;
  end if;

  -- ============ shared accept path (from 'pending' or 'countered') ============
  update public.offers set status = 'accepted' where id = v_offer.id returning * into v_offer;

  update public.offers
    set status = 'declined'
    where listing_id = v_listing.id
      and status in ('pending', 'countered')
      and id <> v_offer.id;

  update public.listings set status = 'reserved' where id = v_listing.id;

  v_amount_eur := round(v_accept_amount_cents / 100.0, 2);
  v_fee_eur := round(v_amount_eur * 0.07, 2);
  v_total_eur := round(v_amount_eur + v_fee_eur, 2);

  insert into public.orders (
    listing_id, offer_id, buyer_id, seller_id,
    listing_title, listing_category, listing_condition, listing_image_url,
    amount_eur, platform_fee_eur, total_eur,
    reservation_expires_at
  ) values (
    v_listing.id, v_offer.id, v_offer.buyer_id, v_listing.seller_id,
    v_listing.title, v_listing.category, v_listing.condition, v_listing.image_url,
    v_amount_eur, v_fee_eur, v_total_eur,
    v_now + make_interval(mins => greatest(coalesce(p_checkout_minutes, 30), 1))
  );

  perform public.notify_user(
    v_offer.buyer_id, 'offer_accepted', 'Offer accepted - checkout now',
    format(
      'Your offer of %s on "%s" was accepted. Complete checkout within %s minutes to secure it.',
      public.format_eur(v_amount_eur), v_listing.title, greatest(coalesce(p_checkout_minutes, 30), 1)
    )
  );
  perform public.notify_user(
    v_listing.seller_id, 'offer_accepted', 'You accepted an offer',
    format(
      'You accepted an offer of %s on "%s". It''s reserved while the buyer checks out.',
      public.format_eur(v_amount_eur), v_listing.title
    )
  );

  return v_offer;
end;
$$;

revoke execute on function public.offer_action(bigint, uuid, text, integer, integer) from public, anon, authenticated;

-- ============ Member-facing dispute visibility ============
-- A buyer/seller has no RLS read path to `disputes` at all (0023 revokes
-- all of anon/authenticated) — deliberately, since a dispute row can carry
-- Stripe-internal detail. This gives a member's own order page just enough
-- to say "this order has an open dispute" without exposing the row itself.
-- SECURITY DEFINER so it can read across the RLS boundary; scoped tightly
-- to "is the caller a party to this specific order" before it reveals even
-- that much.
create or replace function public.get_order_dispute_status(p_order_id bigint)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select d.status
  from public.disputes d
  join public.orders o on o.id = d.order_id
  where d.order_id = p_order_id
    and (o.buyer_id = auth.uid() or o.seller_id = auth.uid())
  order by d.created_at desc
  limit 1;
$$;

revoke all on function public.get_order_dispute_status(bigint) from public;
revoke execute on function public.get_order_dispute_status(bigint) from anon;
grant execute on function public.get_order_dispute_status(bigint) to authenticated;
