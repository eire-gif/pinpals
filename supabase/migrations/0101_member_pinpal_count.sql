-- How many PinPals a member has (Oct 2026 feed redesign, phase 10).
--
-- The profile shows a member's golf identity: handicap (if shared), home
-- course, courses played, and how many PinPals (accepted connections) they
-- have. Everything but the last is already readable. `connections` is
-- readable only by the two members in a row (0006), which is right — who
-- someone is connected to is theirs — so a count needs a function.
--
-- It answers a NUMBER, never who. And it answers null when the caller and
-- the member have blocked each other in either direction, the same rule as
-- the profile page itself: a blocked member's page shows nothing about them.
-- auth.uid() is read inside; the member is the only argument.
--
-- Rollback: drop function if exists public.member_pinpal_count(uuid);

create or replace function public.member_pinpal_count(target_member_id uuid)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select case
    when (select auth.uid()) is null then null
    when public.is_blocked((select auth.uid()), target_member_id) then null
    else (
      select count(*)::integer
        from public.connections c
       where c.status = 'accepted'
         and (c.requester_id = target_member_id or c.recipient_id = target_member_id)
    )
  end;
$$;

revoke all on function public.member_pinpal_count(uuid) from public;
revoke execute on function public.member_pinpal_count(uuid) from anon;
grant execute on function public.member_pinpal_count(uuid) to authenticated;

comment on function public.member_pinpal_count(uuid) is
  'Phase 10: number of accepted connections a member has, for their profile. A count only, never who; null to anyone blocked either way and to anon.';
