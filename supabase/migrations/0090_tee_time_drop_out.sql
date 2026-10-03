-- Pinpals: dropping out of a tee time after confirming your place.
--
-- Until now a golfer could only hand a place back while it was still an
-- OFFER (status 'accepted'): "I can't make it" next to "Confirm my place".
-- The moment they confirmed, there was no way out on the website or in the
-- app — a golfer whose plans changed could only message the host and hope,
-- and the space stayed taken in the round's count.
--
-- This widens confirm_tee_time_place(p_interest_id, p_attending => false)
-- to accept a CONFIRMED place as well. Everything else about it is
-- unchanged:
--   * the same row lock on the invite, so a drop-out racing the host's
--     accept of somebody else cannot lose or double a space;
--   * the space goes back (+1, capped at the fourball's 3), and an invite
--     that had gone 'full' reopens — but a round the host has cancelled or
--     completed is left alone;
--   * the row lands on 'declined', exactly as declining an offer always has,
--     so every reader of the status (players list, confirmed-round
--     visibility in 0084, can_message, the inbox) already treats it as
--     "not in this round". No new status, nothing else to teach.
--
-- One new rule: you cannot drop out of a round that has already been
-- played. "Today" is Irish time, the same day boundary the app and the
-- tee-time sweep use, so a 7am round can still be dropped at 6am but not
-- the following morning — at which point it is history, and handing its
-- space back would reopen a round nobody can play.
--
-- Confirming (p_attending => true) still requires an open offer: a place
-- that was declined is gone, and must be asked for again.
--
-- The host is told by the same notifyPlaceWithdrawn() as before ("X can't
-- make it … the space is open again"), which reads correctly for both.
--
-- Same signature, so the grants in 0077 carry over; they are restated
-- below so the function-grants test reads this file's intent directly.
--
-- Rollback: re-run the confirm_tee_time_place definition from
-- 0077_tee_time_interest_atomicity.sql.

create or replace function public.confirm_tee_time_place(
  p_interest_id bigint,
  p_attending   boolean
)
returns table (
  interest_id  bigint,
  host_id      uuid,
  invite_id    bigint,
  club_name    text,
  play_date    date,
  new_status   text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_interest public.tee_time_interests%rowtype;
  v_invite   public.tee_time_invites%rowtype;
  v_status   text := case when p_attending then 'confirmed' else 'declined' end;
  v_today    date := (now() at time zone 'Europe/Dublin')::date;
begin
  if v_caller is null then
    raise exception 'You need to be signed in to confirm a place.';
  end if;

  select * into v_interest from public.tee_time_interests where id = p_interest_id;
  if not found then
    raise exception 'That tee-time offer no longer exists.';
  end if;
  if v_interest.member_id <> v_caller then
    raise exception 'That tee-time offer belongs to another member.';
  end if;

  if p_attending then
    if v_interest.status <> 'accepted' then
      raise exception 'That tee-time offer is no longer awaiting confirmation.';
    end if;
  else
    if v_interest.status = 'pending' then
      raise exception 'The host hasn''t offered you a place yet.';
    end if;
    if v_interest.status not in ('accepted', 'confirmed') then
      raise exception 'You''re not in this round any more.';
    end if;
  end if;

  -- Locked even on the confirming path, where no count changes: it keeps the
  -- host's own accept from interleaving with this update, and it means the
  -- returning-the-space branch below needs no second code path.
  select * into v_invite
  from public.tee_time_invites
  where id = v_interest.invite_id
  for update;

  if not found then
    raise exception 'That tee time no longer exists.';
  end if;

  if not p_attending and v_invite.play_date < v_today then
    raise exception 'That round has already been played.';
  end if;

  update public.tee_time_interests
    set status = v_status
    where id = p_interest_id;

  -- Dropping out hands the space back, and reopens an invite that had gone
  -- full. A cancelled or completed invite is left alone — a member pulling
  -- out of a round the host has already called off must not quietly reopen
  -- it.
  if not p_attending and v_invite.status not in ('cancelled', 'completed') then
    update public.tee_time_invites
      set spaces_available = least(spaces_available + 1, 3),
          status = 'open'
      where id = v_invite.id;
  end if;

  return query
    select p_interest_id,
           v_invite.member_id,
           v_invite.id,
           v_invite.club_name,
           v_invite.play_date,
           v_status;
end;
$function$;

revoke all on function public.confirm_tee_time_place(bigint, boolean) from public, anon;
grant execute on function public.confirm_tee_time_place(bigint, boolean) to authenticated, service_role;
