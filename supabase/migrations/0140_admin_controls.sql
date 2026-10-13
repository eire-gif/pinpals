-- 0140 — Admin controls: hide / restore for courses, groups and group events,
-- and a staff-side account-deletion check (Oct 2026).
--
-- See claude/admin.md. The admin console gains the same set of controls on
-- every list: Edit, Hide / Restore, Remove / Add back (where the item has its
-- own "removed" state) and Delete permanently (super admin only). Most tables
-- already had a hide mechanism — listings ('removed'), tee times
-- ('cancelled'), posts, comments, course reviews, marketplace reviews
-- (hidden_at), pro shops ('suspended'). This migration adds the three that
-- were missing, and nothing else.
--
--   1. clubs: hidden_at / hidden_by / hidden_reason. A hidden course is gone
--      from the directory, search, pickers and course pages for members and
--      visitors (the read policy now requires hidden_at is null). Staff keep
--      reading it so the admin can find it to add back.
--   2. groups: hidden_at already existed (0120) and every member read already
--      excludes it. Adds hidden_by / hidden_reason so a hide records who and
--      why on the row, like posts do. Not granted to members — groups uses a
--      column-level grant (0120), so new columns are invisible to them.
--   3. society_outings (events for societies, crews and trips): hidden_at /
--      hidden_by / hidden_reason, and the members' read policy now requires
--      hidden_at is null. Entries, guests, itinerary items, payment claims and
--      payments all read through an EXISTS on society_outings, so they follow
--      automatically (a member still sees their own payment row).
--   4. can_delete_account_for(uuid): the body of can_delete_account() (0080)
--      for a member named by id rather than auth.uid(), so a super admin can
--      start the existing account-deletion process for someone. Service role
--      only — it answers questions about another member's orders and payouts.
--
-- Additive and idempotent: new nullable columns, policies re-created by name,
-- one new function. can_delete_account() itself is untouched. Old app builds
-- never select these columns.
--
-- Rollback:
--   drop function if exists public.can_delete_account_for(uuid);
--   drop policy if exists "society members read outings" on public.society_outings;
--   create policy "society members read outings" on public.society_outings
--     for select to authenticated using (public.is_group_member(group_id, (select auth.uid())));
--   drop policy if exists "visible clubs are readable by everyone" on public.clubs;
--   drop policy if exists "staff read hidden clubs" on public.clubs;
--   create policy "clubs are readable by everyone" on public.clubs for select using (true);
--   alter table public.society_outings drop column if exists hidden_at, drop column if exists hidden_by, drop column if exists hidden_reason;
--   alter table public.groups drop column if exists hidden_by, drop column if exists hidden_reason;
--   alter table public.clubs drop column if exists hidden_at, drop column if exists hidden_by, drop column if exists hidden_reason;


-- ============ 1. Courses ============

alter table public.clubs
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid,
  add column if not exists hidden_reason text;

alter table public.clubs drop constraint if exists clubs_hidden_reason_length;
alter table public.clubs
  add constraint clubs_hidden_reason_length check (hidden_reason is null or char_length(hidden_reason) <= 500);

-- The directory's own filter (country, name) stays fast with the hidden
-- rows left out of it.
create index if not exists clubs_hidden_idx on public.clubs (hidden_at) where hidden_at is not null;

drop policy if exists "clubs are readable by everyone" on public.clubs;
drop policy if exists "visible clubs are readable by everyone" on public.clubs;
create policy "visible clubs are readable by everyone"
  on public.clubs for select
  to anon, authenticated
  using (hidden_at is null);

-- Separate policy, authenticated only: is_staff() is not executable by anon
-- (0135), so it can't sit in a policy anon evaluates.
drop policy if exists "staff read hidden clubs" on public.clubs;
create policy "staff read hidden clubs"
  on public.clubs for select
  to authenticated
  using ((select public.is_staff()));


-- ============ 2. Groups ============

alter table public.groups
  add column if not exists hidden_by uuid,
  add column if not exists hidden_reason text;

alter table public.groups drop constraint if exists groups_hidden_reason_length;
alter table public.groups
  add constraint groups_hidden_reason_length check (hidden_reason is null or char_length(hidden_reason) <= 500);


-- ============ 3. Group events (society_outings) ============

alter table public.society_outings
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid,
  add column if not exists hidden_reason text;

alter table public.society_outings drop constraint if exists society_outings_hidden_reason_length;
alter table public.society_outings
  add constraint society_outings_hidden_reason_length check (hidden_reason is null or char_length(hidden_reason) <= 500);

drop policy if exists "society members read outings" on public.society_outings;
create policy "society members read outings" on public.society_outings
  for select to authenticated
  using (hidden_at is null and public.is_group_member(group_id, (select auth.uid())));


-- ============ 4. Staff-side account deletion check ============
--
-- Same rules, same wording as can_delete_account() (0080), for a named
-- member. Returns null when the account may go, else the obligation in the
-- way. Kept as a copy rather than re-pointing can_delete_account() at it, so
-- the member's own deletion path is not touched by this migration.

create or replace function public.can_delete_account_for(p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_order   record;
  v_count   integer;
begin
  if p_user_id is null then
    raise exception 'can_delete_account_for requires a member id';
  end if;

  select o.id, o.status, (o.seller_id = p_user_id) as is_seller
    into v_order
  from public.orders o
  where (o.buyer_id = p_user_id or o.seller_id = p_user_id)
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

  select o.id into v_order
  from public.orders o
  where o.seller_id = p_user_id
    and o.payout_status in ('pending', 'held')
  order by o.id
  limit 1;

  if found then
    return format('Order #%s still has a payout to come. It has to clear first.', v_order.id);
  end if;

  select count(*) into v_count
  from public.payouts p
  where p.user_id = p_user_id and p.status in ('pending', 'in_transit');

  if v_count > 0 then
    return 'This member has a payout on the way. It has to clear first.';
  end if;

  select count(*) into v_count
  from public.refunds r
  join public.orders o on o.id = r.order_id
  where (o.buyer_id = p_user_id or o.seller_id = p_user_id)
    and r.status in ('pending', 'requires_action');

  if v_count > 0 then
    return 'A refund on one of this member''s orders is still being processed.';
  end if;

  select count(*) into v_count
  from public.disputes d
  join public.orders o on o.id = d.order_id
  where (o.buyer_id = p_user_id or o.seller_id = p_user_id)
    and d.status not in ('won', 'lost', 'charge_refunded', 'warning_closed');

  if v_count > 0 then
    return 'A payment dispute on one of this member''s orders is still open.';
  end if;

  return null;
end;
$function$;

revoke all on function public.can_delete_account_for(uuid) from public, anon, authenticated;
grant execute on function public.can_delete_account_for(uuid) to service_role;
