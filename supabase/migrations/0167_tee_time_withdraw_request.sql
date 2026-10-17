-- 0167 — Take back a request the host hasn't answered yet (Oct 2026)
--
-- My rounds (0165) shows every round a member has asked to join. A request
-- still waiting on the host had no way back: confirm_tee_time_place()
-- refuses a 'pending' row ("The host hasn't offered you a place yet"), and
-- rightly — that function hands a space back and tells the host "X can't
-- make it, the space is open again", neither of which is true of a request
-- that never held a space.
--
-- So a separate, smaller function. It only ever touches the caller's own
-- 'pending' row, and does what dropping out does to the row itself:
-- status 'declined', withdrawn_at now(). withdrawn_at is what tells a
-- golfer's own "no" from a host's (0091), so they can ask again later with
-- rejoin_tee_time(), and My rounds drops the card rather than showing it as
-- turned down. No space moves, because a pending request never took one.
--
-- The host is not notified: their "Needs your answer" simply loses the card.
-- Nothing they were relying on has changed.
--
-- Rollback:
--   drop function if exists public.withdraw_tee_time_request(bigint);

create or replace function public.withdraw_tee_time_request(p_interest_id bigint)
returns table (
  interest_id bigint,
  invite_id   bigint
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_interest public.tee_time_interests%rowtype;
begin
  if v_caller is null then
    raise exception 'You need to be signed in to withdraw a request.';
  end if;

  -- Locked, so a host answering at the same moment either lands first (and
  -- this then refuses, below) or waits and finds the request gone.
  select * into v_interest
  from public.tee_time_interests
  where id = p_interest_id
  for update;

  if not found then
    raise exception 'That request no longer exists.';
  end if;
  if v_interest.member_id <> v_caller then
    raise exception 'That request belongs to another member.';
  end if;
  if v_interest.status <> 'pending' then
    raise exception 'The host has already answered this request.';
  end if;

  update public.tee_time_interests
    set status = 'declined',
        withdrawn_at = now()
    where id = p_interest_id;

  return query select v_interest.id, v_interest.invite_id;
end;
$function$;

revoke all on function public.withdraw_tee_time_request(bigint) from public, anon, authenticated;
grant execute on function public.withdraw_tee_time_request(bigint) to authenticated, service_role;
