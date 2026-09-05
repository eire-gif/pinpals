-- Pinpals: member-to-member messaging + the admin moderation access model
--
-- ============ PRIVACY MODEL (read this before touching any of the below) ============
--
-- User-facing:
--  - A conversation only ever has two participants. Nobody who isn't one of
--    them can read or write to it — enforced by RLS on both tables below,
--    not just by the app never showing a UI for it.
--  - Two members may only START a conversation if they already have a
--    legitimate reason to talk: an accepted `connections` row, a marketplace
--    `offers` row between them, or an accepted/confirmed `tee_time_interests`
--    row between a tee-time host and an interested golfer. can_message()
--    below is the single choke-point function for that check — it's called
--    both by conversations' own insert policy (a database-level boundary,
--    not just an app-level one) and by startConversation() in
--    src/app/conversations/actions.ts (so a rejected attempt gets a friendly
--    error instead of a raw RLS violation).
--  - Messages are paginated with a keyset cursor on (created_at, id) — see
--    messages_conversation_created_idx below and listMessages() in
--    src/lib/messaging/queries.ts — never OFFSET, and never "load the whole
--    thread": a conversation can grow without bound.
--
-- Admin (privileged access):
--  - There is deliberately NO general "browse every conversation" admin
--    page or query anywhere in this app. The only way staff ever see message
--    content is through the existing /admin/reports/[id] detail page, for a
--    report whose target_type is 'message' or 'conversation' — reached the
--    same way every other report is (queue -> claim -> view). See
--    grantConversationAccess() in src/app/admin/reports/[id]/actions.ts.
--  - Opening that content requires a staff member to submit a reason, every
--    time (not just once per report) — the reason is required input on
--    grantConversationAccess(), and every call, including a "load older
--    messages" follow-up, writes a `conversation.access_viewed` row to
--    admin_audit_log with the actor, the report id, the conversation id, the
--    reason given, and a timestamp (see recordAdminAction()). Nothing else
--    in this app can read message content without going through that
--    Server Action.
--  - What's shown is minimized, not the full history by default: the first
--    reveal loads a bounded window of messages anchored on the reported
--    message (or the report's own filed-at time, for a whole-conversation
--    report), not the entire conversation — see getConversationAccessWindow()
--    in src/lib/admin/messaging.ts.
--  - Moderation (hideMessage()/restoreMessage()) never rewrites or deletes
--    `messages.body` — it only ever sets hidden_at/hidden_by/hidden_reason.
--    The original message text is preserved unless a future retention/legal
--    policy explicitly requires otherwise; this schema does not support
--    editing or deleting a message's content at all, by anyone, on purpose.

-- ============ CAN_MESSAGE() ============
-- SECURITY DEFINER + a fixed search_path, same discipline as is_staff()
-- (0007_staff_roles.sql) — callable from RLS policies on conversations
-- itself without recursion, and safe to call with two arbitrary user ids
-- since it only ever returns a boolean, never row data.
create or replace function public.can_message(a uuid, b uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    a <> b
    and (
      exists (
        select 1 from public.connections c
        where c.status = 'accepted'
          and least(c.requester_id, c.recipient_id) = least(a, b)
          and greatest(c.requester_id, c.recipient_id) = greatest(a, b)
      )
      or exists (
        select 1
        from public.offers o
        join public.listings l on l.id = o.listing_id
        where (o.buyer_id = a and l.seller_id = b)
           or (o.buyer_id = b and l.seller_id = a)
      )
      or exists (
        select 1
        from public.tee_time_interests ti
        join public.tee_time_invites inv on inv.id = ti.invite_id
        where ti.status in ('accepted', 'confirmed')
          and (
            (ti.member_id = a and inv.member_id = b)
            or (ti.member_id = b and inv.member_id = a)
          )
      )
    );
$$;

revoke all on function public.can_message(uuid, uuid) from public;
revoke execute on function public.can_message(uuid, uuid) from anon;
grant execute on function public.can_message(uuid, uuid) to authenticated;

-- ============ CONVERSATIONS ============
create table if not exists public.conversations (
  id bigint generated always as identity primary key,
  user_a_id uuid not null references public.profiles (id) on delete cascade,
  user_b_id uuid not null references public.profiles (id) on delete cascade,
  -- Denormalized so the conversation list can sort/paginate cheaply without
  -- a correlated subquery against messages per row — kept current by
  -- touch_conversation_last_message() below, never written directly by a
  -- client.
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversations_not_self check (user_a_id <> user_b_id)
);

-- One conversation per unordered pair, same pattern as
-- connections_member_pair_idx (0006_member_connections.sql).
create unique index if not exists conversations_member_pair_idx
  on public.conversations (least(user_a_id, user_b_id), greatest(user_a_id, user_b_id));
create index if not exists conversations_user_a_idx on public.conversations (user_a_id);
create index if not exists conversations_user_b_idx on public.conversations (user_b_id);
create index if not exists conversations_last_message_at_idx
  on public.conversations (last_message_at desc nulls last);

alter table public.conversations enable row level security;

create policy "Participants view their own conversations"
  on public.conversations for select
  to authenticated
  using (user_a_id = auth.uid() or user_b_id = auth.uid());

-- The actual eligibility boundary: a member can only create a conversation
-- they're a party to, and only with someone can_message() agrees they may
-- talk to. startConversation() (src/app/conversations/actions.ts) checks
-- this too, but only so it can show a friendly error — this policy is what
-- actually enforces it.
create policy "Members start eligible conversations"
  on public.conversations for insert
  to authenticated
  with check (
    (user_a_id = auth.uid() or user_b_id = auth.uid())
    and public.can_message(user_a_id, user_b_id)
  );

-- No update/delete policy for authenticated — last_message_at is maintained
-- only by the trigger below (SECURITY DEFINER), and nothing else on this row
-- is ever mutated by a participant. Explicit revoke rather than relying on
-- "no policy = no access" alone, same discipline as 0008/0010/0013/0016/0019.
revoke insert, update, delete, truncate, references, trigger
  on public.conversations from anon;
revoke update, delete, truncate, references, trigger
  on public.conversations from authenticated;

-- ============ MESSAGES ============
create table if not exists public.messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(trim(both from body)) > 0 and char_length(body) <= 4000),
  created_at timestamptz not null default now(),
  -- Moderation flag, never a content edit — see the privacy model note at
  -- the top of this file. hidden_by is nullable because it's set by a
  -- service-role write (staff aren't authenticated as themselves against
  -- this table), but always populated in practice by hideMessage().
  hidden_at timestamptz,
  hidden_by uuid references auth.users (id),
  hidden_reason text check (char_length(hidden_reason) <= 4000)
);

-- The pagination index the task requires: conversation_id + created_at, with
-- id as a stable tie-breaker for rows sharing a created_at timestamp. Every
-- read of a conversation's messages (user-facing and admin) goes through
-- this index via a keyset cursor — see listMessages() in
-- src/lib/messaging/queries.ts and getConversationAccessWindow() in
-- src/lib/admin/messaging.ts.
create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc, id desc);

alter table public.messages enable row level security;

create policy "Participants view conversation messages"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

create policy "Participants send messages in their own conversations"
  on public.messages for insert
  to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id
        and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
    )
  );

-- No update/delete policy for authenticated at all: senders can't edit or
-- delete a message once sent (out of scope for this phase — see the phase
-- summary's deferred list), and hiding one for moderation is a
-- service-role-only write (hideMessage()/restoreMessage() in
-- src/app/admin/reports/[id]/actions.ts) that only ever touches
-- hidden_at/hidden_by/hidden_reason — this is the DB-level enforcement of
-- "moderation actions must not alter original message history."
revoke insert, update, delete, truncate, references, trigger
  on public.messages from anon;
revoke update, delete, truncate, references, trigger
  on public.messages from authenticated;

-- ============ TOUCH conversations.last_message_at ============
create or replace function public.touch_conversation_last_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversations
    set last_message_at = new.created_at
    where id = new.conversation_id;
  return new;
end;
$$;

revoke all on function public.touch_conversation_last_message() from public, anon, authenticated;

drop trigger if exists messages_touch_conversation on public.messages;
create trigger messages_touch_conversation
  after insert on public.messages
  for each row
  execute function public.touch_conversation_last_message();
