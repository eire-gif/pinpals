-- ============================================================================
-- Three small things: deleting an alert, closing off old rounds, and seeing
-- who you'd be playing with
-- ============================================================================


-- ============ 1. A member may delete their own alerts ============
--
-- `notifications` has been insert- and delete-proof since 0042, on purpose:
-- the rows are written by notify_user() and nothing else, and a member who
-- could insert their own could forge one. Deleting is a different question.
-- The row is about them, only they can read it, and a list you cannot clear
-- is a list people stop opening.
--
-- So: DELETE, own rows only, and only DELETE — the UPDATE policy from 0042
-- plus prevent_notification_tampering() (0045) still confine an update to
-- read_at. INSERT stays revoked.
--
-- This is a real deletion, not a hidden flag. That is what was asked for and
-- it is the honest behaviour for a swipe labelled Delete; the cost is that a
-- deleted alert cannot be recovered, which is why the app does it one row at
-- a time on a deliberate gesture and "Mark all read" stays the bulk action.
--
-- Conversations get NO equivalent, and must not. A conversation has two
-- members and one row; deleting it would erase the other member's copy of a
-- deal, a dispute or an arrangement they never agreed to lose. The app's
-- swipe on a conversation sets the caller's own archived_at (0049), which
-- hides it for them and touches nothing of theirs.
create policy "Members delete their own notifications"
  on public.notifications
  for delete to authenticated
  using ((select auth.uid()) = user_id);

grant delete on public.notifications to authenticated;


-- ============ 2. Rounds close themselves once they are over ============
--
-- Nothing ever moved an invite out of 'open'. A round played last March is
-- still open today: it is filtered out of browse by a play_date predicate in
-- each of four places, which is four chances to forget, and it still counts
-- as a live invite everywhere that does not.
--
-- A full clear day must pass before a round is closed — `play_date <
-- current_date - 1`, not `< current_date`. A four-ball on Sunday evening is
-- not finished at one minute past midnight, and being wrong in that
-- direction would close a round people are still talking about. At 02:15 the
-- day after next, it certainly is over.
--
-- 'completed', not deleted. Confirmed rounds keeps a 'Played' list, which is
-- the record of who a member has played with — the thing that makes this a
-- community rather than a booking form. Interests are left exactly as they
-- are for the same reason.
--
-- Cancelled invites are left alone: they are already closed, and moving them
-- to 'completed' would claim a round happened that did not.
create or replace function public.complete_past_tee_times()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  closed integer;
begin
  update public.tee_time_invites
     set status = 'completed'
   where status in ('open', 'full')
     and play_date < (current_date - 1);

  get diagnostics closed = row_count;
  return closed;
end;
$$;

-- Same revoke-by-name as has_confirmed_place (0078): Supabase grants execute
-- on every new function to anon and authenticated explicitly, and `revoke
-- from public` does not touch an explicit per-role grant. That is how
-- notify_user() became anon-callable in 0075 — see
-- claude/incident-notify-user-grants-after-recreate.md.
revoke all on function public.complete_past_tee_times() from public, anon, authenticated;
grant execute on function public.complete_past_tee_times() to service_role;

comment on function public.complete_past_tee_times() is
  'Nightly sweep: moves open/full invites whose play_date is more than a clear day past to status completed. Returns how many were closed. Scheduled as pinpals-complete-past-tee-times.';

-- Rollback:
--   select cron.unschedule('pinpals-complete-past-tee-times');
do $$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available here, so the tee-time sweep was NOT scheduled. Expected on a local replay or in CI.';
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'pinpals-complete-past-tee-times') then
    perform cron.unschedule('pinpals-complete-past-tee-times');
  end if;

  -- 02:15 UTC daily. Deliberately not on the hour, and well away from the
  -- 03:20 account-deletion job, so two schedules never contend for the same
  -- minute.
  perform cron.schedule(
    'pinpals-complete-past-tee-times',
    '15 2 * * *',
    $job$ select public.complete_past_tee_times(); $job$
  );
end;
$$;


-- ============ 3. Who is already playing, on a round you could join ============
--
-- Until now, the confirmed players on a round were visible only to each
-- other (0078) and to the host. That is the right default for a round that
-- has filled up — it is a private four-ball at that point.
--
-- It is the wrong default for a round still looking for players. Asking to
-- join a group of strangers is a bigger step than asking to join a group
-- with somebody from your own club in it, and the answer to "who would I be
-- playing with" was unavailable at precisely the moment it mattered.
--
-- The widening is deliberately narrow, and each condition is load-bearing:
--
--   status = 'confirmed'   Pending and declined interests stay private. Who
--                          asked and was turned down is nobody else's
--                          business.
--
--   ti.status = 'open'     Once the round fills it reverts to the old rule.
--                          The invite's own SELECT policy already hides a
--                          non-open invite from everyone but its host, so
--                          this clause matches what a member can see anyway.
--
--   spaces_available > 0   The belt to that policy's braces. 0077 documents
--                          a real drift between `status` and
--                          `spaces_available`; if one is wrong, the stricter
--                          of the two wins here.
--
-- The `ti` subquery is itself subject to the invites SELECT policy, which is
-- what confines this to rounds the caller is entitled to see at all —
-- including the connections-only visibility rule. Nothing here bypasses it.
drop policy if exists "See own interest or interest on your invites" on public.tee_time_interests;
create policy "See own interest or interest on your invites"
  on public.tee_time_interests
  for select to authenticated
  using (
    -- 0028's two clauses, unchanged and first: the common reads are "my own
    -- row" and "a row on my own invite", and both settle without touching a
    -- function or a second table. This is also what keeps INSERT ...
    -- RETURNING working — see 0078's note and
    -- claude/incident-listing-creation-rls-returning-bug.md.
    (member_id = (select auth.uid()))
    or (exists (
      select 1 from public.tee_time_invites ti
      where ti.id = tee_time_interests.invite_id
        and ti.member_id = (select auth.uid())
    ))
    -- 0078: everyone confirmed for a round can see everyone else confirmed
    -- for it, however full it is.
    or (status = 'confirmed' and public.has_confirmed_place(invite_id))
    -- New: and on a round still looking for players, anyone who can see the
    -- round can see who is already in it.
    or (
      status = 'confirmed'
      and exists (
        select 1 from public.tee_time_invites ti
        where ti.id = tee_time_interests.invite_id
          and ti.status = 'open'
          and ti.spaces_available > 0
      )
    )
  );
