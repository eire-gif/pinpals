-- 0082_realtime_authorization.sql
--
-- Live message updates, which have not actually worked since this Supabase
-- project was recreated.
--
-- ============================ What was broken ============================
--
-- src/lib/realtime.ts broadcasts on two private topics — `conversation-<id>`
-- for an open thread and `inbox-<userId>` for the inbox list — and its own
-- header comment says the receiving side is authorised by "RLS policies on
-- `realtime.messages` ... configured directly on the project rather than
-- through supabase/migrations/*.sql".
--
-- That configuration is gone. `realtime.messages` has row-level security
-- ENABLED and ZERO policies, which denies every read: no client can subscribe
-- to a private channel at all. Sending still works, the message still lands in
-- Postgres, the inbox still shows it on the next load — so nothing looks
-- broken, it just silently never arrives live. Same class of loss as
-- 0076_notify_user_grants_fix.sql: state that lived outside this repo's own
-- migrations and did not survive being recreated.
--
-- So it goes in a migration this time. Everything Realtime needs to authorise
-- a subscriber is now in version control, and a future recreate rebuilds it.
--
-- ========================== What this grants ============================
--
-- SELECT only, and only to `authenticated`. Receiving, never publishing:
-- broadcast() sends with the service-role key, so a member still cannot
-- publish a forged "new message" onto either topic. Spoofing one continues to
-- require a real, RLS-checked insert into public.messages.
--
-- The two policies are deliberately separate rather than one OR'd expression.
-- They answer different questions — "is this your own inbox" is a string
-- comparison, "are you in this conversation" is a lookup — and a policy that
-- did both would obscure which half let a subscriber in.

-- ---------------------------------------------------------------------------
-- Parsing a conversation topic
-- ---------------------------------------------------------------------------
--
-- `realtime.topic()` is whatever string the client asked to subscribe to, so
-- it is untrusted input and a bare `substring(...)::bigint` inside a policy is
-- a cast of attacker-chosen text. Two guards, both load-bearing:
--
--   * the regex means a non-conversation topic returns NULL rather than
--     raising, so the policy's EXISTS is simply false;
--   * the {1,18} bound keeps the digits inside bigint's range, because
--     'conversation-' followed by forty nines would otherwise raise
--     "value out of range" from inside a policy — an error, not a denial.
--
-- IMMUTABLE and not SECURITY DEFINER: it is pure string handling and reads
-- nothing, so it needs no privileges of its own.
create or replace function public.realtime_conversation_id(topic text)
returns bigint
language sql
immutable
parallel safe
as $$
  select case
    when topic ~ '^conversation-[0-9]{1,18}$'
    then substring(topic from 14)::bigint
    else null
  end;
$$;

comment on function public.realtime_conversation_id(text) is
  'Conversation id from a realtime topic like "conversation-42", or NULL if the topic is not one. Used by the realtime.messages receive policies.';

revoke all on function public.realtime_conversation_id(text) from public;
grant execute on function public.realtime_conversation_id(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Your own inbox ping
-- ---------------------------------------------------------------------------
--
-- One subscription for a member's entire inbox, never one per conversation —
-- 0049's own "avoid a subscription per row" rule. The payload is treated by
-- both clients as "go re-fetch", not as data to render, so the only thing this
-- policy has to get right is that the topic is that member's own.
drop policy if exists "Members receive their own inbox broadcasts" on realtime.messages;

create policy "Members receive their own inbox broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and topic = 'inbox-' || (select auth.uid())::text
);

-- ---------------------------------------------------------------------------
-- A conversation you are actually in
-- ---------------------------------------------------------------------------
--
-- Subscribed to only while that one thread is open. The check is against
-- public.conversations rather than anything carried in the topic, so it is the
-- same participant test that guards the messages themselves — a member cannot
-- listen to a thread by guessing its id.
drop policy if exists "Participants receive their conversation broadcasts" on realtime.messages;

create policy "Participants receive their conversation broadcasts"
on realtime.messages
for select
to authenticated
using (
  extension = 'broadcast'
  and exists (
    select 1
    from public.conversations c
    where c.id = public.realtime_conversation_id(topic)
      and (
        c.user_a_id = (select auth.uid())
        or c.user_b_id = (select auth.uid())
      )
  )
);

-- Rollback:
--   drop policy if exists "Participants receive their conversation broadcasts" on realtime.messages;
--   drop policy if exists "Members receive their own inbox broadcasts" on realtime.messages;
--   drop function if exists public.realtime_conversation_id(text);
