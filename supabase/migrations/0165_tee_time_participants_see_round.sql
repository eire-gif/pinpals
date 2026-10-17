-- 0165 — A golfer can always see a round they're part of (Oct 2026)
--
-- For My rounds: one page for every tee time a member hosts, plays in or
-- has asked to join (claude/my-rounds-redesign.md).
--
-- THE GAP. "View visible open invites or own invites" (0028, 0065, 0132)
-- lets anyone other than the host read a round only while its status is
-- 'open'. That was written for browsing, and for browsing it is right. But
-- the same rule decides what a golfer who is IN a round can read, and there
-- it goes wrong three ways:
--
--   * The host presses Mark full, or the last place is taken: the round
--     disappears from the golfer's Confirmed rounds. They are still playing.
--   * The nightly sweep (0084) closes a played round as 'completed': it
--     disappears from their Played list, so there's no round to share.
--   * The host cancels: the golfer gets the alert, then finds no round
--     anywhere saying so. "Cancelled by Mark" is the one card that page
--     must be able to show.
--
-- THE FIX. One more way to pass the policy: you have a tee_time_interests
-- row on this round — asked, offered, playing, or turned down. Every one of
-- those people has already seen the round (you can only ask to join a
-- round you can see), so nothing is revealed that wasn't before; it just
-- stops vanishing once its status moves on.
--
-- A SECURITY DEFINER helper rather than an `exists` on tee_time_interests
-- in the policy: tee_time_interests' own SELECT policy reads
-- tee_time_invites, so a policy here that read tee_time_interests would
-- recurse. Same arrangement as tee_time_invited() (0132).
--
-- Not changed: who can see the OTHER golfers on a round. That is
-- tee_time_interests' policy (0078, 0084), and a full round still shows
-- its players only to its players.
--
-- Rollback:
--   drop policy if exists "View visible open invites or own invites" on public.tee_time_invites;
--   create policy "View visible open invites or own invites" on public.tee_time_invites
--     for select to public using (
--       ((status = 'open') or (member_id = (select auth.uid())))
--       and (public.invite_is_visible_row(visibility, member_id) or public.tee_time_invited(id)));
--   drop function if exists public.tee_time_participant(bigint);

create or replace function public.tee_time_participant(p_invite_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.tee_time_interests
     where invite_id = p_invite_id and member_id = (select auth.uid())
  );
$$;
revoke all on function public.tee_time_participant(bigint) from public, anon, authenticated;
grant execute on function public.tee_time_participant(bigint) to authenticated;

drop policy if exists "View visible open invites or own invites" on public.tee_time_invites;
create policy "View visible open invites or own invites"
  on public.tee_time_invites
  for select
  to public
  using (
    (
      ((status = 'open') or (member_id = (select auth.uid())))
      and (public.invite_is_visible_row(visibility, member_id) or public.tee_time_invited(id))
    )
    -- 0165: a round you asked to join, were offered, play in or were turned
    -- down for stays readable to you whatever its status.
    or ((select auth.uid()) is not null and public.tee_time_participant(id))
  );
