-- ============================================================================
-- One inbox: one number, and one way to clear it
-- ============================================================================
--
-- PinPals grew two unread systems that never met.
--
--   Alerts    notifications.read_at is null       counted with a head query
--   Messages  a per-side last_read_at cursor      counted by
--             conversation_unread_counts() (0049)
--
-- Four places counted messages, three counted alerts, and nothing anywhere
-- added the two together. The website's bell carried a number while its
-- Messages link carried nothing at all; the app's envelope carried a red dot
-- that could not say whether it meant one message or thirty.
--
-- The fix is not to merge the tables. They are different shapes for good
-- reasons: an alert is one row a member reads once, a conversation is a
-- running thread whose unread point moves. What they need to share is the
-- ARITHMETIC — so this migration adds the two functions that every surface
-- now calls, and no client is left to sum anything itself.
--
-- Both are SECURITY INVOKER. They aggregate over rows the caller's own RLS
-- policies already let them read and write one at a time; there is no
-- privilege here to bypass and nothing new is exposed.


-- ============ The number ============
--
-- Split rather than totalled, because the two counts mean different things
-- to a member ("3 messages, 2 alerts") even where the badge shows their sum.
-- Callers that want one number add them; callers that want the breakdown
-- have it without a second round trip.
--
-- Two deliberate exclusions:
--
--   Archived conversations. A member who archived a thread has said they are
--   done with it. Counting its unread messages in a badge they cannot see the
--   source of is how a badge becomes something people learn to ignore. Note
--   that conversation_unread_counts() does NOT exclude them — it is the
--   per-row pill, and an archived row showing its own count when you go
--   looking for it is correct. This is the badge, which is different.
--
--   'new_message' alerts. Every message already writes one (see
--   sendMessageTo() in src/lib/messaging-server.ts) and it is what carries
--   the email and the push. Counting it here would count every message twice,
--   once as a conversation and once as an alert, and no amount of marking
--   things read would reconcile the two. From this migration on, new_message
--   is a DELIVERY-ONLY type: written so it can be emailed and pushed, never
--   shown in a list, never counted. The conversation is the thing a member
--   reads.
create or replace function public.inbox_unread_counts()
returns table (message_count bigint, alert_count bigint)
language sql
security invoker
set search_path = public
stable
as $$
  select
    (
      select coalesce(count(*), 0)::bigint
      from public.conversations c
      join public.messages m on m.conversation_id = c.id
      where (c.user_a_id = (select auth.uid()) or c.user_b_id = (select auth.uid()))
        and case
              when c.user_a_id = (select auth.uid()) then c.user_a_archived_at
              else c.user_b_archived_at
            end is null
        and m.sender_id <> (select auth.uid())
        and m.created_at > coalesce(
              case
                when c.user_a_id = (select auth.uid()) then c.user_a_last_read_at
                else c.user_b_last_read_at
              end,
              '-infinity'::timestamptz
            )
    ),
    (
      select coalesce(count(*), 0)::bigint
      from public.notifications n
      where n.user_id = (select auth.uid())
        and n.read_at is null
        and n.type <> 'new_message'
    );
$$;

revoke all on function public.inbox_unread_counts() from public;
revoke execute on function public.inbox_unread_counts() from anon;
grant execute on function public.inbox_unread_counts() to authenticated;


-- ============ Clearing it ============
--
-- Marks read, and only marks read. Nothing is deleted and nothing is hidden:
-- the list a member scrolls back through tomorrow is the same list, minus the
-- emphasis. That makes the button safe to press by accident, which matters
-- more than a tidy list — notifications has no DELETE policy at all (0042)
-- and should not grow one for a convenience.
--
-- Three statements rather than one because a conversation stores the caller's
-- read cursor in whichever of two columns they happen to occupy, and the
-- tampering trigger from 0049 will refuse an update that touches the other
-- side's. Archived threads are left alone for the same reason they are left
-- out of the count above: the member already dealt with them, and moving
-- their cursor would quietly mark unread messages read in a thread nobody
-- asked about.
--
-- new_message alerts ARE cleared here even though nothing counts them. They
-- are invisible either way; leaving a pile of permanently-unread rows behind
-- would only wait to confuse whoever next writes a query against read_at.
create or replace function public.mark_inbox_read()
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  me uuid := (select auth.uid());
  now_at timestamptz := now();
begin
  if me is null then
    raise exception 'mark_inbox_read() requires a signed-in caller';
  end if;

  update public.notifications
     set read_at = now_at
   where user_id = me
     and read_at is null;

  update public.conversations
     set user_a_last_read_at = now_at
   where user_a_id = me
     and user_a_archived_at is null;

  update public.conversations
     set user_b_last_read_at = now_at
   where user_b_id = me
     and user_b_archived_at is null;
end;
$$;

revoke all on function public.mark_inbox_read() from public;
revoke execute on function public.mark_inbox_read() from anon;
grant execute on function public.mark_inbox_read() to authenticated;
