-- Performance pass (admin-scale audit): rewrite every RLS policy that calls
-- auth.uid() directly to instead call (select auth.uid()). This is the
-- standard Postgres/Supabase "auth_rls_initplan" fix: a bare auth.uid() call
-- inside a policy is re-evaluated once per row scanned, while wrapping it in
-- a `select` lets the planner treat it as a stable, single-evaluation
-- subquery (an "InitPlan") instead. This matters once tables like messages,
-- listings, and orders hold millions of rows.
--
-- This migration is a pure performance rewrite. Every `using`/`with check`
-- expression below is logically identical to the policy it replaces — same
-- tables, same columns, same operators, same ordering of conditions, same
-- `to <role>` clause. Nothing here changes who can read, insert, update, or
-- delete what. Policies that already went through a SECURITY DEFINER STABLE
-- wrapper function (is_staff(), used by every staff/admin policy) are
-- intentionally left untouched, since Postgres already evaluates a STABLE
-- function's result once per statement.
--
-- The exact current policy definitions were captured live from pg_policies
-- before writing this migration, so every drop/create pair below reproduces
-- its predecessor exactly aside from the auth.uid() wrapping.

-- connections
drop policy "Members remove declined connections" on public.connections;
create policy "Members remove declined connections" on public.connections
  for delete to authenticated
  using (
    ((requester_id = (select auth.uid())) or (recipient_id = (select auth.uid())))
    and (status = 'declined')
  );

drop policy "Members send connection requests" on public.connections;
create policy "Members send connection requests" on public.connections
  for insert to authenticated
  with check (
    (requester_id = (select auth.uid()))
    and (recipient_id <> (select auth.uid()))
    and (status = 'pending')
  );

drop policy "Members view their own connections" on public.connections;
create policy "Members view their own connections" on public.connections
  for select to authenticated
  using ((requester_id = (select auth.uid())) or (recipient_id = (select auth.uid())));

drop policy "Recipients answer connection requests" on public.connections;
create policy "Recipients answer connection requests" on public.connections
  for update to authenticated
  using ((recipient_id = (select auth.uid())) and (status = 'pending'))
  with check ((recipient_id = (select auth.uid())) and (status = any (array['accepted', 'declined'])));

-- conversations
drop policy "Members start eligible conversations" on public.conversations;
create policy "Members start eligible conversations" on public.conversations
  for insert to authenticated
  with check (
    ((user_a_id = (select auth.uid())) or (user_b_id = (select auth.uid())))
    and can_message(user_a_id, user_b_id)
  );

drop policy "Participants view their own conversations" on public.conversations;
create policy "Participants view their own conversations" on public.conversations
  for select to authenticated
  using ((user_a_id = (select auth.uid())) or (user_b_id = (select auth.uid())));

-- listings
drop policy "listings are readable unless removed" on public.listings;
create policy "listings are readable unless removed" on public.listings
  for select to public
  using ((status <> 'removed') or ((select auth.uid()) = seller_id));

drop policy "users can delete their own listings" on public.listings;
create policy "users can delete their own listings" on public.listings
  for delete to authenticated
  using ((select auth.uid()) = seller_id);

drop policy "users can insert their own listings" on public.listings;
create policy "users can insert their own listings" on public.listings
  for insert to authenticated
  with check ((select auth.uid()) = seller_id);

drop policy "users can update their own listings" on public.listings;
create policy "users can update their own listings" on public.listings
  for update to authenticated
  using ((select auth.uid()) = seller_id)
  with check ((select auth.uid()) = seller_id);

-- messages
drop policy "Participants send messages in their own conversations" on public.messages;
create policy "Participants send messages in their own conversations" on public.messages
  for insert to authenticated
  with check (
    (sender_id = (select auth.uid()))
    and (exists (
      select 1 from conversations c
      where (c.id = messages.conversation_id)
        and ((c.user_a_id = (select auth.uid())) or (c.user_b_id = (select auth.uid())))
    ))
  );

drop policy "Participants view conversation messages" on public.messages;
create policy "Participants view conversation messages" on public.messages
  for select to authenticated
  using (
    exists (
      select 1 from conversations c
      where (c.id = messages.conversation_id)
        and ((c.user_a_id = (select auth.uid())) or (c.user_b_id = (select auth.uid())))
    )
  );

-- offers
drop policy "buyers can create offers" on public.offers;
create policy "buyers can create offers" on public.offers
  for insert to public
  with check (
    ((select auth.uid()) = buyer_id)
    and (exists (
      select 1 from listings l
      where (l.id = offers.listing_id)
        and (l.seller_id <> (select auth.uid()))
        and (l.status = 'active')
    ))
  );

drop policy "buyers can view their own offers" on public.offers;
create policy "buyers can view their own offers" on public.offers
  for select to public
  using ((select auth.uid()) = buyer_id);

drop policy "sellers can respond to offers" on public.offers;
create policy "sellers can respond to offers" on public.offers
  for update to public
  using (exists (select 1 from listings l where (l.id = offers.listing_id) and (l.seller_id = (select auth.uid()))))
  with check (exists (select 1 from listings l where (l.id = offers.listing_id) and (l.seller_id = (select auth.uid()))));

drop policy "sellers can view offers on their listings" on public.offers;
create policy "sellers can view offers on their listings" on public.offers
  for select to public
  using (exists (select 1 from listings l where (l.id = offers.listing_id) and (l.seller_id = (select auth.uid()))));

-- orders
drop policy "Buyers can view their own orders" on public.orders;
create policy "Buyers can view their own orders" on public.orders
  for select to authenticated
  using ((select auth.uid()) = buyer_id);

drop policy "Sellers can view their own orders" on public.orders;
create policy "Sellers can view their own orders" on public.orders
  for select to authenticated
  using ((select auth.uid()) = seller_id);

-- profiles
drop policy "users can delete their own profile" on public.profiles;
create policy "users can delete their own profile" on public.profiles
  for delete to authenticated
  using ((select auth.uid()) = id);

drop policy "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile" on public.profiles
  for insert to authenticated
  with check ((select auth.uid()) = id);

drop policy "users can update their own profile" on public.profiles;
create policy "users can update their own profile" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- staff_roles
drop policy "Staff can view their own staff row" on public.staff_roles;
create policy "Staff can view their own staff row" on public.staff_roles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- stripe_connected_accounts
drop policy "Members can view their own connected account" on public.stripe_connected_accounts;
create policy "Members can view their own connected account" on public.stripe_connected_accounts
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- tee_time_interests
drop policy "Hosts respond to interest" on public.tee_time_interests;
create policy "Hosts respond to interest" on public.tee_time_interests
  for update to authenticated
  using (exists (
    select 1 from tee_time_invites ti
    where (ti.id = tee_time_interests.invite_id) and (ti.member_id = (select auth.uid()))
  ))
  with check (exists (
    select 1 from tee_time_invites ti
    where (ti.id = tee_time_interests.invite_id) and (ti.member_id = (select auth.uid()))
  ));

drop policy "Members can express interest" on public.tee_time_interests;
create policy "Members can express interest" on public.tee_time_interests
  for insert to authenticated
  with check (
    (member_id = (select auth.uid()))
    and (exists (
      select 1 from tee_time_invites ti
      where (ti.id = tee_time_interests.invite_id)
        and (ti.member_id <> (select auth.uid()))
        and (ti.status = 'open')
    ))
  );

drop policy "Members confirm accepted interest" on public.tee_time_interests;
create policy "Members confirm accepted interest" on public.tee_time_interests
  for update to authenticated
  using ((member_id = (select auth.uid())) and (status = 'accepted'))
  with check ((member_id = (select auth.uid())) and (status = any (array['confirmed', 'declined'])));

drop policy "Members withdraw their own interest" on public.tee_time_interests;
create policy "Members withdraw their own interest" on public.tee_time_interests
  for delete to authenticated
  using (member_id = (select auth.uid()));

drop policy "See own interest or interest on your invites" on public.tee_time_interests;
create policy "See own interest or interest on your invites" on public.tee_time_interests
  for select to authenticated
  using (
    (member_id = (select auth.uid()))
    or (exists (
      select 1 from tee_time_invites ti
      where (ti.id = tee_time_interests.invite_id) and (ti.member_id = (select auth.uid()))
    ))
  );

-- tee_time_invites
drop policy "Create own invites" on public.tee_time_invites;
create policy "Create own invites" on public.tee_time_invites
  for insert to public
  with check (member_id = (select auth.uid()));

drop policy "Delete own invites" on public.tee_time_invites;
create policy "Delete own invites" on public.tee_time_invites
  for delete to public
  using (member_id = (select auth.uid()));

drop policy "Update own invites" on public.tee_time_invites;
create policy "Update own invites" on public.tee_time_invites
  for update to public
  using (member_id = (select auth.uid()))
  with check (member_id = (select auth.uid()));

drop policy "View open invites or own invites" on public.tee_time_invites;
create policy "View open invites or own invites" on public.tee_time_invites
  for select to public
  using ((status = 'open') or (member_id = (select auth.uid())));
