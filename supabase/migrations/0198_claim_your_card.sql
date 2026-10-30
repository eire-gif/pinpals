-- 0198 — Claim your card: the round lands in the claimer's scorecards, and
-- members can see how many golfers joined from the cards they sent
-- (Oct 2026, claude/claim-your-card.md)
--
-- "Send Mark his scorecard" (0118) already exists: a guest gets a private
-- link to their card from a round, and joining PinPals and opening it puts
-- them in the round and connects them with whoever sent it. Approved
-- mock-ups (canvas "PinPals Engagement Features", row 3) add:
--
-- 1. claim_round_guest() also saves the claimer's own scorecard from the
--    round (scorecard_from_live_round, as every member's card is saved
--    when a round finishes) — so the round is in My scorecards, their
--    Course Passport, course leaderboards and their year in golf at once.
--    If saving the card fails for any reason the claim still stands.
-- 2. my_guest_invite_stats() — how many cards you've sent and how many of
--    those golfers have joined, for "2 golfers have joined from your
--    cards" after a round. Counts only; never who.
--
-- Rollback: recreate claim_round_guest from 0118; drop function
--   public.my_guest_invite_stats().

create or replace function public.claim_round_guest(p_token text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := (select auth.uid());
  v_invite public.round_guest_invites;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  select * into v_invite from public.round_guest_invites where token = lower(btrim(p_token)) for update;
  if not found then
    raise exception 'That scorecard link isn''t valid' using errcode = 'P0002';
  end if;
  if v_invite.claimed_by is not null then
    if v_invite.claimed_by = v_me then
      return v_invite.round_id;
    end if;
    raise exception 'This scorecard has already been claimed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.live_round_players where round_id = v_invite.round_id and member_id = v_me) then
    raise exception 'You''re already in this round' using errcode = 'P0001';
  end if;

  update public.live_round_players set member_id = v_me
   where id = v_invite.player_id and member_id is null;
  update public.round_guest_invites set claimed_by = v_me, claimed_at = now()
   where token = v_invite.token;
  if v_invite.invited_by is not null and not public.is_blocked(v_invite.invited_by, v_me) then
    perform public.connect_members(v_invite.invited_by, v_me);
  end if;

  -- 0198: their own scorecard from the round, as a member's is saved when
  -- a round finishes. Best effort: the claim stands whatever happens here.
  begin
    perform public.scorecard_from_live_round(v_invite.round_id);
  exception when others then
    null;
  end;

  return v_invite.round_id;
end;
$$;

revoke all on function public.claim_round_guest(text) from public, anon;
grant execute on function public.claim_round_guest(text) to authenticated;

create or replace function public.my_guest_invite_stats()
returns table (sent integer, joined integer)
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int, count(claimed_by)::int
    from public.round_guest_invites
   where invited_by = (select auth.uid())
     and (select auth.uid()) is not null;
$$;

revoke all on function public.my_guest_invite_stats() from public, anon, authenticated;
grant execute on function public.my_guest_invite_stats() to authenticated;
