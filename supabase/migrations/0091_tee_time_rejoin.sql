-- Pinpals: asking again after dropping out of a round.
--
-- A golfer who cancelled their place (0090) could never ask for it back.
-- tee_time_interests is UNIQUE (invite_id, member_id), the drop-out left
-- their row at 'declined', and "I'm interested" simply inserted — so the
-- second request hit the constraint and was refused as "already expressed
-- interest". The app then showed "You're not in this round" with no way
-- forward, even when the round had a space and they could now make it.
--
-- Two kinds of 'declined' had to be told apart, because only one of them
-- should be allowed to ask again:
--   * the HOST said no — asking again would be pestering, and stays refused;
--   * the GOLFER handed the place back — asking again is entirely fair.
--
-- So:
--   1. `withdrawn_at` on tee_time_interests: set when the golfer drops out
--      through confirm_tee_time_place(…, false), cleared otherwise.
--   2. Backfilled from the host notifications that every drop-out has sent
--      since 0077 ('tee_time_place_withdrawn', carrying the interest id), so
--      golfers who dropped out before today can ask again too.
--   3. rejoin_tee_time(invite_id): puts the golfer's own withdrawn row back
--      to 'pending', under the same conditions as a first request (open
--      round, not their own, visible to them, not yet played). The host is
--      told exactly as for a first request — that notification is sent from
--      TypeScript (expressInterest() in src/lib/tee-times-operations.ts),
--      which now calls this when the insert meets the unique constraint.
--
-- Pending again means the host decides again: rejoining does not take a
-- space or skip the queue.
--
-- Rollback:
--   drop function if exists public.rejoin_tee_time(bigint);
--   alter table public.tee_time_interests drop column if exists withdrawn_at;
--   and re-run confirm_tee_time_place from 0090.

alter table public.tee_time_interests
  add column if not exists withdrawn_at timestamptz;

comment on column public.tee_time_interests.withdrawn_at is
  'When the golfer themselves handed the place back (confirm_tee_time_place(…, false)). Null for a host decline. Lets rejoin_tee_time() tell the two apart.';

-- Backfill: every golfer drop-out since 0077 notified the host with the
-- interest id in its data.
update public.tee_time_interests i
  set withdrawn_at = n.created_at
  from public.notifications n
  where n.type = 'tee_time_place_withdrawn'
    and (n.data ->> 'interestId') ~ '^[0-9]+$'
    and (n.data ->> 'interestId')::bigint = i.id
    and i.status = 'declined'
    and i.withdrawn_at is null;

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

  -- withdrawn_at marks a drop-out by the golfer themselves, as opposed to
  -- a host saying no — the one thing that lets them ask again later
  -- (rejoin_tee_time below).
  update public.tee_time_interests
    set status = v_status,
        withdrawn_at = case when p_attending then null else now() end
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

-- ===========================================================================

create or replace function public.rejoin_tee_time(p_invite_id bigint)
returns table (
  interest_id bigint,
  host_id     uuid,
  club_name   text,
  play_date   date
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_interest public.tee_time_interests%rowtype;
  v_invite   public.tee_time_invites%rowtype;
  v_today    date := (now() at time zone 'Europe/Dublin')::date;
begin
  if v_caller is null then
    raise exception 'You need to be signed in to ask for a place.';
  end if;

  select * into v_invite
  from public.tee_time_invites
  where id = p_invite_id
  for update;

  -- The same conditions the INSERT policy (0065) puts on a first request,
  -- plus "not yet played", which a first request gets from the invite
  -- being listed at all.
  if not found or not public.invite_is_visible_row(v_invite.visibility, v_invite.member_id) then
    raise exception 'This invite is no longer available.';
  end if;
  if v_invite.member_id = v_caller then
    raise exception 'You can''t express interest in your own invite.';
  end if;
  if v_invite.status <> 'open' or v_invite.play_date < v_today then
    raise exception 'This invite is no longer open.';
  end if;

  select * into v_interest
  from public.tee_time_interests
  where invite_id = p_invite_id and member_id = v_caller
  for update;

  if not found then
    raise exception 'You haven''t asked to join this round yet.';
  end if;
  if v_interest.status in ('pending', 'accepted', 'confirmed') then
    raise exception 'You''ve already expressed interest in this invite.';
  end if;
  if v_interest.withdrawn_at is null then
    raise exception 'The host has already answered your request for this round.';
  end if;

  update public.tee_time_interests
    set status = 'pending',
        withdrawn_at = null
    where id = v_interest.id;

  return query
    select v_interest.id, v_invite.member_id, v_invite.club_name, v_invite.play_date;
end;
$function$;

revoke all on function public.rejoin_tee_time(bigint) from public, anon;
grant execute on function public.rejoin_tee_time(bigint) to authenticated, service_role;
